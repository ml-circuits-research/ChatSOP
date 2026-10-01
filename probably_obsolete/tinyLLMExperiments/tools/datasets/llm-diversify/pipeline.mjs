#!/usr/bin/env node
/** LLM diversification pipeline, paraphrase layer (DS022 "LLM diversification"; owner decision D2 of 2026-09-29).
 *
 *   node tools/datasets/llm-diversify/pipeline.mjs paraphrase [--corpus formalizer-v1] [--rows 300] [--n 3]
 *        [--seed 20260929] [--concurrency 8] [--stage1 50] [--out eval/reports/current/llm-diversify/pilot] [--force]
 *   node tools/datasets/llm-diversify/pipeline.mjs report [--out <dir>]      # re-render <dir>-summary.md from summary.json
 *   node tools/datasets/llm-diversify/pipeline.mjs mix --base <rows.jsonl> --llm <rows.jsonl> --out <rows.jsonl> [--max-share 0.4]
 *
 * `paraphrase` samples train/dev rows deterministically (family x language), asks Claude Haiku for N paraphrases of
 * each MESSAGE (the writer never sees the target), and keeps a paraphrase only when every filter passes:
 *   (a) anchors: names and literal values as written, relation-phrase content words, numbers (anchors.mjs);
 *   (b) cues: question form and count, negation count, certainty, quantifiers, presupposition triggers;
 *   (c) judge: an independent Haiku call with a different prompt says the meaning is the same (yes/no + reason);
 *   (d) no-copy: against the cached source datasets (no-copy.mjs) and the sealed suites (sealed-guard.mjs, run as a
 *       separate sealed-auditor process that returns pass/fail only), plus no duplicate of a train/dev message;
 *   (e) execution: the unchanged gold, run with the paraphrase as the input text against the row's verification
 *       world, reproduces the stored expected result.
 * The gold target is reused unchanged. Stage 1 (the first `--stage1` sampled rows) also runs judge controls
 * (identical pairs must be judged the same, pairs with a swapped or replaced name must not) and applies the early
 * stopping rule: below 20% acceptance or below 85% control accuracy the run stops (exit 3) unless `--force`.
 * Outputs (under --out): candidates.jsonl (every candidate with its filter results), accepted.jsonl (corpus rows),
 * summary.json and ../<out name>-summary.md (report.mjs); calls are cached under ../cache and logged in calls.jsonl. No training.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../../lib/jsonl-shards.mjs';
import {checkNoCopy, tokens} from '../no-copy.mjs';
import {executeTarget} from '../diversity/execute.mjs';
import {hash32} from '../diversity/text.mjs';
import {createClient, parseJsonAnswer, sha256, MODEL} from './haiku.mjs';
import {PARAPHRASE_SYSTEM, JUDGE_SYSTEM, paraphraseUser, judgeUser, promptHashes} from './prompts.mjs';
import {protectedOf, anchorProblems, cueProblems} from './anchors.mjs';
import {stratifiedSample, languageSlice} from './sample.mjs';
import {paraphraseRow, applyQuota, METHOD, MAX_LLM_SHARE} from './rows.mjs';
import {referenceOf, diversityAgainst} from './diversity.mjs';
import {renderSummary} from './report.mjs';
import {corpusDir} from '../../../lib/dataset-paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const args = process.argv.slice(2);
const command = args[0];
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const LANGUAGE_NAME = {en: 'English', ro: 'Romanian', mixed: 'mixed'};
const FILTERS = ['anchors', 'cues', 'execution', 'no_copy_sources', 'no_copy_sealed', 'not_duplicate', 'judge'];
const writeJsonl = (file, rows) => fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
const rate = (k, n) => n ? +(k / n).toFixed(4) : null;

// ---------------------------------------------------------------- stage work
async function paraphraseOne(client, row, n) {
  const kept = protectedOf(row);
  const user = paraphraseUser({message: row.question, language: LANGUAGE_NAME[languageSlice(row)], protectedSpans: kept.spans.map(s => s.text), keyWords: kept.keyWords, n});
  const call = await client.complete({system: PARAPHRASE_SYSTEM, user, purpose: 'paraphrase'});
  const parsed = parseJsonAnswer(call.text);
  const folded = text => tokens(text).join(' ');
  const seen = new Set([folded(row.question)]);
  const texts = [];
  for (const item of Array.isArray(parsed) ? parsed : []) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const text = item.trim().replace(/\s+/g, ' ');
    if (seen.has(folded(text))) continue;
    seen.add(folded(text));
    texts.push(text);
  }
  return {row, kept, call, parse_ok: Array.isArray(parsed), texts: texts.slice(0, n), user_sha256: sha256(user)};
}

async function judge(client, a, b) {
  const call = await client.complete({system: JUDGE_SYSTEM, user: judgeUser({a, b}), purpose: 'judge'});
  const parsed = parseJsonAnswer(call.text);
  return {same: parsed?.same === true, parsed: typeof parsed?.same === 'boolean', reason: String(parsed?.reason ?? call.text ?? '').slice(0, 300), key: call.key, cost_usd: call.cost_usd ?? 0};
}

const answersKey = answers => JSON.stringify([...(answers ?? [])].map(a => JSON.stringify(a)).sort());
async function executionAgrees(row, text) {
  const result = await executeTarget({...row, question: text}, row.sop_target);
  return result.status === row.expected?.status && answersKey(result.answers) === answersKey(row.expected?.answers);
}

/** Judge controls: an identical pair must be judged the same; a pair with a name swapped or replaced must not. */
function controlsFor(rows) {
  const names = rows.flatMap(row => protectedOf(row).spans.filter(s => s.mode === 'exact' && /^\p{Lu}/u.test(s.text)).map(s => s.text));
  const out = [];
  for (const row of rows) {
    out.push({id: row.id, kind: 'identical', a: row.question, b: row.question, expect: true});
    const spans = protectedOf(row).spans.filter(s => s.mode === 'exact' && /^\p{Lu}/u.test(s.text) && row.question.split(s.text).length === 2);
    let b = null;
    if (spans.length >= 2) b = row.question.replace(spans[0].text, '\u0000').replace(spans[1].text, spans[0].text).replace('\u0000', spans[1].text);
    else if (spans.length === 1) {
      const other = names.filter(name => !row.question.includes(name) && !name.includes(spans[0].text));
      if (other.length) b = row.question.replace(spans[0].text, other[hash32(row.id) % other.length]);
    }
    if (b && b !== row.question) out.push({id: row.id, kind: spans.length >= 2 ? 'swapped_names' : 'replaced_name', a: row.question, b, expect: false});
  }
  return out;
}

/** Filter (d): cached source datasets (in memory) and the sealed suites (separate sealed-auditor process). */
async function noCopy(candidates, dir) {
  const report = await checkNoCopy(candidates.map(c => ({id: c.cid, split: 'candidate', question: c.text, lineage: c.lineage})), {name: 'llm-paraphrase-candidates', examples: Infinity});
  const sourceFail = new Set([...report.long_span.examples.map(e => e.id), ...report.identifiers.examples.map(e => e.id), ...report.paired.examples.filter(e => e.distinctive.length).map(e => e.id)]);
  const input = path.join(dir, 'sealed-guard.input.jsonl'), output = path.join(dir, 'sealed-guard.verdicts.jsonl');
  writeJsonl(input, candidates.map(c => ({cid: c.cid, text: c.text, source_message: c.source_message})));
  const run = spawnSync(process.execPath, [path.join(here, 'sealed-guard.mjs'), '--in', input, '--out', output], {encoding: 'utf8', maxBuffer: 1 << 26});
  if (run.status !== 0) throw Error(`sealed guard failed: ${run.stderr}`);
  const verdicts = new Map(fs.readFileSync(output, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).map(v => [v.cid, v]));
  fs.rmSync(input);
  return {sourceFail, verdicts, sourceReport: {pass: report.pass, rows_with_shared_8gram: report.long_span.rows_with_shared_8gram, rows_with_identifier: report.identifiers.rows_with_identifier, global_4gram_distinct_rate: report.global_4gram.distinct_rate, source_texts_scanned: report.source_texts_scanned}};
}

async function runStage(client, rows, n, trainMessages, dir, controls) {
  const produced = [];
  await Promise.all(rows.map(async row => produced.push(await paraphraseOne(client, row, n))));
  produced.sort((a, b) => rows.indexOf(a.row) - rows.indexOf(b.row));
  const candidates = [];
  for (const p of produced) p.texts.forEach((text, index) => candidates.push({cid: `${p.row.id}_lp${index}`, index, row: p.row, p, text, source_message: p.row.question, lineage: p.row.lineage}));
  const judged = await Promise.all(candidates.map(c => judge(client, c.row.question, c.text)));
  const controlResults = await Promise.all(controls.map(async c => ({...c, verdict: await judge(client, c.a, c.b)})));
  const {sourceFail, verdicts, sourceReport} = await noCopy(candidates, dir);
  for (const [i, c] of candidates.entries()) {
    const sealed = verdicts.get(c.cid);
    c.problems = {anchors: anchorProblems(c.row, c.text, c.p.kept), cues: cueProblems(c.row, c.text)};
    c.results = {
      anchors: !c.problems.anchors.length, cues: !c.problems.cues.length,
      execution: await executionAgrees(c.row, c.text),
      no_copy_sources: !sourceFail.has(c.cid), no_copy_sealed: Boolean(sealed?.pass),
      not_duplicate: !trainMessages.has(tokens(c.text).join(' ')),
      judge: judged[i].same,
    };
    c.sealed = sealed ? {hits: Object.keys(sealed.hits), sealed_names_added: sealed.sealed_names_added} : null;
    c.judge = judged[i];
    c.accepted = FILTERS.every(f => c.results[f]);
  }
  return {produced, candidates, controlResults, sourceReport};
}

function stageStats(stage) {
  const {produced, candidates, controlResults} = stage;
  const byFilter = Object.fromEntries(FILTERS.map(f => [f, rate(candidates.filter(c => c.results[f]).length, candidates.length)]));
  let alive = candidates;
  const funnel = {};
  for (const f of FILTERS) { alive = alive.filter(c => c.results[f]); funnel[f] = alive.length; }
  const controls = {};
  for (const kind of [...new Set(controlResults.map(c => c.kind))]) {
    const list = controlResults.filter(c => c.kind === kind);
    controls[kind] = {n: list.length, correct: list.filter(c => c.verdict.same === c.expect).length, accuracy: rate(list.filter(c => c.verdict.same === c.expect).length, list.length)};
  }
  const accepted = candidates.filter(c => c.accepted);
  return {
    source_rows: produced.length, writer_parse_failures: produced.filter(p => !p.parse_ok).length,
    candidates: candidates.length, accepted: accepted.length, acceptance_rate: rate(accepted.length, candidates.length),
    source_rows_with_an_accepted_paraphrase: new Set(accepted.map(c => c.row.id)).size,
    pass_rate_by_filter: byFilter, funnel_in_order: funnel,
    judge_agreement_with_mechanical_filters: rate(candidates.filter(c => c.results.anchors && c.results.cues && c.results.execution).filter(c => c.results.judge).length, candidates.filter(c => c.results.anchors && c.results.cues && c.results.execution).length),
    judge_controls: controls,
  };
}

function breakdown(candidates, key) {
  const groups = {};
  for (const c of candidates) (groups[key(c)] ??= []).push(c);
  return Object.fromEntries(Object.entries(groups).sort().map(([k, list]) => [k, {candidates: list.length, accepted: list.filter(c => c.accepted).length, rate: rate(list.filter(c => c.accepted).length, list.length)}]));
}

function reasonOf(c) {
  const failed = FILTERS.filter(f => !c.results[f]);
  return failed.map(f => f === 'anchors' || f === 'cues' ? `${f}: ${c.problems[f].join('; ')}` : f === 'judge' ? `judge: ${c.judge.reason}` : f === 'no_copy_sealed' ? `no_copy_sealed: ${c.sealed?.hits.join(', ') || ''}${c.sealed?.sealed_names_added ? ' +sealed name' : ''}` : f).join(' | ');
}

async function paraphrase() {
  const corpus = opt('corpus', 'formalizer-v1');
  const count = Number(opt('rows', 300)), n = Number(opt('n', 3)), seed = Number(opt('seed', 20260929));
  const stage1 = Number(opt('stage1', 50)), force = args.includes('--force');
  const out = path.resolve(opt('out', path.join(root, 'eval/reports/current/llm-diversify/pilot')));
  fs.mkdirSync(out, {recursive: true});
  const rows = ['train', 'dev'].flatMap(split => readJsonlShardedSync(path.join(root, corpusDir(corpus, root), `${split}.jsonl`)));
  const trainMessages = new Set(rows.map(row => tokens(row.question).join(' ')));
  const sample = stratifiedSample(rows.filter(row => row.split === 'train'), {count, seed});
  const client = createClient({cacheDir: path.join(out, '..', 'cache'), logFile: path.join(out, 'calls.jsonl'), concurrency: Number(opt('concurrency', 8))});
  const started = Date.now();
  const stages = [];
  try {
    const first = sample.slice(0, stage1);
    const s1 = await runStage(client, first, n, trainMessages, out, controlsFor(first));
    const s1stats = stageStats(s1);
    const controlAccuracy = Math.min(...Object.values(s1stats.judge_controls).map(c => c.accuracy ?? 0));
    const stop = s1stats.acceptance_rate < 0.2 || controlAccuracy < 0.85;
    stages.push({stage: 1, rows: first.length, ...s1stats, early_stopping: {rule: 'stop if stage-1 acceptance < 20% or judge-control accuracy < 85%', acceptance_rate: s1stats.acceptance_rate, min_control_accuracy: controlAccuracy, stop, forced: stop && force}});
    console.error(`stage 1: ${JSON.stringify(stages[0].early_stopping)}`);
    let all = s1;
    if (!stop || force) {
      const s2 = await runStage(client, sample.slice(stage1), n, trainMessages, out, []);
      stages.push({stage: 2, rows: sample.length - stage1, ...stageStats(s2)});
      all = {produced: [...s1.produced, ...s2.produced], candidates: [...s1.candidates, ...s2.candidates], controlResults: s1.controlResults, sourceReport: s2.sourceReport};
    }
    await finish({corpus, rows, sample, n, seed, out, client, stages, all, started, stopped: stop && !force});
    if (stop && !force) process.exitCode = 3;
  } finally { client.close(); }
}

async function finish({corpus, rows, sample, n, seed, out, client, stages, all, started, stopped}) {
  const {candidates} = all;
  const hashes = promptHashes();
  const accepted = candidates.filter(c => c.accepted).map(c => paraphraseRow(c.row, {index: c.index, text: c.text, trace: {
    model: MODEL, date: new Date().toISOString().slice(0, 10),
    prompts: {paraphrase: {...hashes.paraphrase, user_sha256: c.p.user_sha256}, judge: hashes.judge},
    judge: {same: true, reason: c.judge.reason}, filters: c.results, cache_keys: {paraphrase: c.p.call.key, judge: c.judge.key},
  }}));
  writeJsonl(path.join(out, 'accepted.jsonl'), accepted);
  writeJsonl(path.join(out, 'candidates.jsonl'), candidates.map(c => ({cid: c.cid, source_id: c.row.id, family: c.row.family, language: languageSlice(c.row), source_message: c.row.question, text: c.text,
    accepted: c.accepted, results: c.results, problems: c.problems, judge: {same: c.judge.same, reason: c.judge.reason}, sealed: c.sealed})));
  writeJsonl(path.join(out, 'judge-controls.jsonl'), all.controlResults.map(c => ({id: c.id, kind: c.kind, expect: c.expect, same: c.verdict.same, reason: c.verdict.reason, b: c.b})));
  // Diversity: accepted paraphrases and all candidates against train+dev; dev against train as the generator baseline.
  const trainOnly = rows.filter(row => row.split === 'train');
  const refAll = referenceOf(rows), refTrain = referenceOf(trainOnly);
  const sources = [...new Map(candidates.filter(c => c.accepted).map(c => [c.row.id, c.row])).values()];
  const diversity = {
    reference: `${corpus} train+dev messages (${rows.length})`,
    accepted_paraphrases_vs_train_dev: diversityAgainst(accepted, refAll),
    their_source_rows_vs_train_minus_self: 'by construction 0 new (the sources are train rows); see the dev baseline',
    generator_baseline_dev_vs_train: diversityAgainst(rows.filter(row => row.split === 'dev'), refTrain),
    within_set: {source_rows: diversityAgainst(sources, referenceOf([])), accepted_paraphrases: diversityAgainst(accepted, referenceOf([]))},
  };
  const cost = client.stats.cost_usd + 0;
  const calls = fs.existsSync(path.join(out, 'calls.jsonl')) ? fs.readFileSync(path.join(out, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => !l.error) : [];
  const totalCost = calls.reduce((s, l) => s + (l.cost_usd ?? 0), 0);
  const ms = calls.map(l => l.ms).sort((a, b) => a - b);
  const pick = (list, k) => [...list].sort((a, b) => hash32(a.cid) - hash32(b.cid)).slice(0, k);
  const rejected = candidates.filter(c => !c.accepted);
  const rejectedExamples = [];
  for (const f of FILTERS) rejectedExamples.push(...pick(rejected.filter(c => !c.results[f] && !rejectedExamples.includes(c)), f === 'judge' || f === 'anchors' || f === 'cues' ? 3 : 1));
  const summary = {
    format: 'chatsop-llm-diversify-pilot-v1', method: METHOD, model: MODEL, generated_at: new Date().toISOString(), corpus, seed, paraphrases_per_row: n,
    prompts: hashes, sample: {rows: sample.length, by_family: countBy(sample, r => r.family), by_language: countBy(sample, languageSlice)},
    stopped_early: stopped, stages,
    overall: stageStats(all),
    by_language: breakdown(candidates, c => languageSlice(c.row)),
    by_family: breakdown(candidates, c => c.row.family),
    no_copy_sources_report: all.sourceReport,
    diversity,
    cost: {calls_made_this_run: client.stats.calls, cached_calls_this_run: client.stats.cached, failed_calls: client.stats.failed,
      total_usd_all_logged_calls: +totalCost.toFixed(4), logged_calls: calls.length,
      usd_per_accepted_row: accepted.length ? +(totalCost / accepted.length).toFixed(5) : null,
      latency_ms: {p50: ms[Math.floor(ms.length / 2)] ?? null, p90: ms[Math.floor(ms.length * 0.9)] ?? null},
      wall_clock_s: Math.round((Date.now() - started) / 1000), note: `cost_usd is the headless total_cost_usd per call; this run added ${cost.toFixed(4)} USD`},
    quota: {max_llm_share: MAX_LLM_SHARE, note: 'applyQuota (rows.mjs) keeps LLM-authored rows at most this share of any build'},
    examples: {
      accepted: pick(candidates.filter(c => c.accepted), 10).map(c => ({source_id: c.row.id, family: c.row.family, language: languageSlice(c.row), message: c.row.question, paraphrase: c.text, judge: c.judge.reason})),
      rejected: rejectedExamples.slice(0, 10).map(c => ({source_id: c.row.id, family: c.row.family, language: languageSlice(c.row), message: c.row.question, paraphrase: c.text, why: reasonOf(c)})),
    },
  };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(out, '..', `${path.basename(out)}-summary.md`), renderSummary(summary, readHistory(out)));
  console.log(JSON.stringify({stopped, candidates: candidates.length, accepted: accepted.length, acceptance: summary.overall.acceptance_rate, cost: summary.cost.total_usd_all_logged_calls}));
}

/** Optional hand-written record of why a run's prompts or filters changed (`<out>/history.json`). */
const readHistory = out => fs.existsSync(path.join(out, 'history.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'history.json'), 'utf8')) : null;

const countBy = (list, key) => list.reduce((t, x) => ({...t, [key(x)]: (t[key(x)] ?? 0) + 1}), {});

function mix() {
  const base = readJsonlShardedSync(path.resolve(opt('base'))), llm = readJsonlShardedSync(path.resolve(opt('llm')));
  const result = applyQuota(base, llm, {maxShare: Number(opt('max-share', MAX_LLM_SHARE))});
  writeJsonl(path.resolve(opt('out')), result.rows);
  console.log(JSON.stringify({rows: result.rows.length, llm_kept: result.kept, llm_dropped: result.dropped, llm_share: +result.llm_share.toFixed(4)}));
}

function report() {
  const out = path.resolve(opt('out', path.join(root, 'eval/reports/current/llm-diversify/pilot')));
  fs.writeFileSync(path.join(out, '..', `${path.basename(out)}-summary.md`), renderSummary(JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')), readHistory(out)));
}

if (command === 'paraphrase') await paraphrase();
else if (command === 'mix') mix();
else if (command === 'report') report();
else { console.error('usage: pipeline.mjs paraphrase [options] | mix --base <jsonl> --llm <jsonl> --out <jsonl>'); process.exitCode = 2; }
