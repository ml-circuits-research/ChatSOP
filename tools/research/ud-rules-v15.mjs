#!/usr/bin/env node
/** Experiment eval-ud-rules-v15-v1: UD -> SOP rules v1.5, focused on Romanian and the known v1.4 gaps.
 *
 *   node tools/research/ud-rules-v15.mjs dev --language ro [--n 400] [--seed 5] [--dir <rules dir>] [--rules <label>]
 *   node tools/research/ud-rules-v15.mjs categorize --rules <label>            # buckets dev failures into the known v1.5 gap categories
 *   node tools/research/ud-rules-v15.mjs sample                                # fresh stratified sample (blocked until translator-agent's preregistration exists)
 *   node tools/research/ud-rules-v15.mjs convert --rules v1.4|v1.5 [--dir <dir>] [--stage 150|300|full]
 *   node tools/research/ud-rules-v15.mjs compare [--stage 150|300|full]        # paired v1.5 - v1.4, strict and host-normalized
 *
 * Preregistration: status/preregistrations/eval-ud-rules-v15-v1.json. Stanza runs on the CPU only. v1.5 is developed
 * on datasets_archive/formalizer-v1/dev.jsonl only, in the scratch copy tools/research/ud-rules-v15-draft/ (not imported by
 * the live runtime) until translator-agent (lib/ud-to-sop/lib/symbolic-lm/lib/languages-util/lib/translator-service)
 * records a `done` or `blocked` journal event; only then is the draft ported into lib/ud-to-sop. Outputs:
 * eval/reports/current/ud-rules-v15/.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {mulberry, stages, tolerantScores, goldsOf} from './ud-baseline-eval.mjs';
import {QGROUP, lengthBucket} from './symbolic-layers.mjs';
import * as v14 from './ud-rules-v14.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = path.join(ROOT, 'eval/reports/current/ud-rules-v15');
const SUITES = {test: 'eval/suites/formalizer-v1/test.jsonl', ood: 'eval/suites/formalizer-ood-v1/test.jsonl', wild: 'eval/suites/formalizer-wild-v1/test.jsonl'};
const QUOTA = {test: 240, ood: 180, wild: 180};
const STAGES = [150, 300];
const SEED = 20261001;
const DEV = 'datasets_archive/formalizer-v1/dev.jsonl';
const OOD = 'eval/suites/formalizer-ood-v1/test.jsonl';

const sha = text => createHash('sha256').update(text).digest('hex');
const {readJsonl, writeJsonl, writeJson, loadRules, convertRows, strictScores, normalizedScores, pairedDelta} = v14;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function argumentsOf(argv) {
  const [command, ...rest] = argv; const args = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); args[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return args;
}
const clusterOf = row => row.semantic_case_id ?? row.id;

// ------------------------------------------------------------------ consumed-row bookkeeping (for the fresh sample)

/** Every row already consumed by an earlier experiment on the sealed suites, by id and by semantic case. */
function consumedIdsAndCases() {
  const ids = new Set(); const cases = new Set();
  const add = (id, caseId) => { ids.add(id); if (caseId) cases.add(caseId); };
  // eval-symbolic-layers-en-v1 (400 EN test/ood/wild rows)
  for (const item of readJson(path.join(ROOT, 'eval/reports/current/symbolic-layers/sample.json')).items) add(item.id, item.semantic_case_id ?? item.id);
  // eval-ud-rules-v14-v1 (600 test/ood/wild rows, en/ro/mixed)
  for (const item of readJson(path.join(ROOT, 'eval/reports/current/ud-rules-v14/sample.json')).items) add(item.id, item.semantic_case_id ?? item.id);
  // eval-symbolic-lm-v1 oodRo (clean monolingual RO rows of the sealed OOD suite; final numbers were read)
  const oodRows = readJsonlShardedSync(path.join(ROOT, OOD));
  for (const row of oodRows) if (row.language === 'ro' && !row.code_switch && !(row.noise?.length)) add(row.id, row.semantic_case_id ?? row.id);
  // translator-agent's consumed rows, once its preregistration exists (coordination requirement of this task).
  const translatorPrereg = fs.readdirSync(path.join(ROOT, 'status/preregistrations')).find(f => /translator-compare/i.test(f));
  let translatorStatus = 'not registered yet: sample draw blocked';
  if (translatorPrereg) {
    const doc = readJson(path.join(ROOT, 'status/preregistrations', translatorPrereg));
    // eval-translator-compare-v1's own recorded deviation: every formalizer-v1 dev.jsonl row is already an exact
    // partition of eval-symbolic-lm-v1's arms (roA+roB+mixed+noisyRo+noisyEn+cleanEn = 5131 = dev.jsonl's full
    // length), so it draws its RO (150) and mixed (100) rows from datasets_archive/formalizer-v1/train.jsonl instead -
    // disjoint from the test/OOD/wild sealed suites this script samples from. No id overlap is therefore possible;
    // recorded for the audit trail rather than swept for ids.
    translatorStatus = `read from ${translatorPrereg} (id ${doc.id}, registered_at ${doc.registered_at}): its rows are drawn from datasets_archive/formalizer-v1/train.jsonl (deviation "${(doc.sets?.deviation_from_instructions ?? '').slice(0, 80)}…"), disjoint from the test/OOD/wild suites sampled here`;
  }
  return {ids, cases, translatorPrereg, translatorStatus};
}

// ------------------------------------------------------------------ development (dev-only) analysis

/** Development score + full row detail on formalizer-v1 dev rows (the only data v1.5 may be tuned on). */
async function devCommand(args) {
  const n = Number(args.n ?? 400);
  const rows = readJsonlShardedSync(path.join(ROOT, DEV)).filter(r => !args.language || r.language === args.language);
  const random = mulberry(Number(args.seed ?? 5));
  const sample = [...rows].sort(() => random() - 0.5).slice(0, n);
  const items = sample.map(row => ({id: row.id, source: 'test', language: row.language, row}));
  const rules = await loadRules(args.dir);
  const label = String(args.rules ?? 'dev');
  const predictions = await convertRows(sample, rules, path.join(OUT, 'dev', 'parses-' + label + '.jsonl'));
  const strict = strictScores(items, predictions, path.join(OUT, 'dev', 'scoring-' + label));
  const rowsOut = items.map(it => ({id: it.id, language: it.language, question_type: it.row.question_type, question: it.row.question, match: strict.get(it.id).match, d1: strict.get(it.id).d1_all_f1, sop: predictions.find(p => p.id === it.id).sop, valid: predictions.find(p => p.id === it.id).valid, outcome: predictions.find(p => p.id === it.id).outcome, gold: it.row.sop_target}));
  writeJsonl(path.join(OUT, 'dev', `dev-${label}.jsonl`), rowsOut);
  const by = key => Object.fromEntries([...new Set(rowsOut.map(r => r[key]))].map(v => [v, (mean(rowsOut.filter(r => r[key] === v).map(r => r.match)) * 100).toFixed(1)]));
  console.log(`dev ${label}: match ${(mean(rowsOut.map(r => r.match)) * 100).toFixed(1)}% (${rowsOut.length}); by language`, by('language'));
  return rowsOut;
}

/** Buckets dev-only failures into the known v1.5 gap categories (regex heuristics on the message text, for triage only). */
function categorizeCommand(args) {
  const label = String(args.rules ?? 'dev');
  const rows = readJsonl(path.join(OUT, 'dev', `dev-${label}.jsonl`));
  const CATS = [
    ['ro_claim_tail', /(se confirm[aă]|e adev[aă]rat|e corect)\s*\?\s*$/i],
    ['ro_de_weekday', /\bde\s+(luni|mar[tț]i|miercuri|joi|vineri|s[aâ]mb[aă]t[aă]|duminic[aă])\b/i],
    ['verb_as_noun_after_name', /\b[A-ZȘȚĂÂÎ][a-zșțăâî]+\s+(lucreaz[aă]|locuie[sș]te|conduce|preda|studiaz[aă]|munce[sș]te)\b/i],
    ['tr_since', /^\s*since\b.*;.*\bis it\b/i],
    ['be_held_at_in', /\bheld\s+(at|in)\b/i],
    ['context_intrebare', /context\s*:.*[iî]ntrebare\s*:/i],
    ['ro_impersonal_reflexive', /\bse\s+(poate|confirm[aă]|[sș]tie|spune|crede|presupune|consider[aă])\b/i],
  ];
  const out = {label, total: rows.length, failures: rows.filter(r => !r.match).length, categories: {}};
  for (const [name, re] of CATS) {
    const matches = rows.filter(r => re.test(r.question));
    const fails = matches.filter(r => !r.match);
    out.categories[name] = {n: matches.length, failing: fails.length, ids: fails.slice(0, 20).map(r => r.id)};
  }
  const uncategorizedFails = rows.filter(r => !r.match && !CATS.some(([, re]) => re.test(r.question)));
  out.uncategorized_failures = uncategorizedFails.length;
  writeJson(path.join(OUT, 'dev', `categories-${label}.json`), out);
  console.log(JSON.stringify(out, null, 1));
  return out;
}

// ------------------------------------------------------------------ fresh held-out sample (test/ood/wild)

const stratum = (source, row) => [source, row.language, QGROUP[row.question_type] ?? 'other', lengthBucket(row.question)].join('|');

function sampleCommand() {
  const file = path.join(OUT, 'sample.json');
  if (fs.existsSync(file)) throw Error('sample.json exists: the fresh sample is drawn once (delete it only to abandon the experiment)');
  const {ids: consumedIds, cases: consumedCasesDirect, translatorPrereg, translatorStatus} = consumedIdsAndCases();
  if (!translatorPrereg) throw Error('translator-agent has not registered a preregistration yet (status/preregistrations/*translator*.json not found). Per coordination instructions, wait for it before drawing the fresh v1.5 sample.');
  const random = mulberry(SEED);
  const out = {seed: SEED, drawn_at: new Date().toISOString(), rules_at_draw: 'ud-rules-v1.4 (lib/ud-to-sop identical to frozen-rules-v1.4)', translator_consumed_source: translatorStatus,
    method: 'per source: every language, one row per semantic case, excluding rows/cases consumed by eval-symbolic-layers-en-v1, eval-ud-rules-v14-v1, eval-symbolic-lm-v1 (oodRo) and translator-agent\'s preregistration; strata source x language x question-type group x length; proportional largest-remainder allocation with at least 1 per non-empty stratum; nested stages 150 and 300 (seed 42)', sources: {}, items: []};
  for (const [source, suite] of Object.entries(SUITES)) {
    const rows = readJsonlShardedSync(path.join(ROOT, suite));
    const consumedCases = new Set([...consumedCasesDirect, ...rows.filter(row => consumedIds.has(row.id)).map(clusterOf)]);
    const seen = new Set();
    const eligible = rows.filter(row => !consumedIds.has(row.id) && !consumedCases.has(clusterOf(row))).filter(row => { const k = clusterOf(row); if (seen.has(k)) return false; seen.add(k); return true; });
    const groups = new Map();
    for (const row of eligible) { const k = stratum(source, row); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row); }
    const keys = [...groups.keys()].sort();
    for (const k of keys) { const list = groups.get(k); for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } }
    const total = QUOTA[source];
    const alloc = new Map(keys.map(k => [k, 1]));
    let left = total - keys.length;
    const exact = keys.map(k => ({k, want: left * groups.get(k).length / eligible.length}));
    for (const e of exact) { const add = Math.min(groups.get(e.k).length - 1, Math.floor(e.want)); alloc.set(e.k, alloc.get(e.k) + add); }
    left = total - [...alloc.values()].reduce((a, b) => a + b, 0);
    for (const e of [...exact].sort((a, b) => (b.want % 1) - (a.want % 1) || a.k.localeCompare(b.k))) { if (left <= 0) break; if (alloc.get(e.k) < groups.get(e.k).length) { alloc.set(e.k, alloc.get(e.k) + 1); left--; } }
    out.sources[source] = {suite, suite_sha256: sha(fs.readFileSync(path.join(ROOT, suite))), rows: rows.length, excluded_rows: rows.length - eligible.length, eligible: eligible.length, allocation: Object.fromEntries(alloc)};
    for (const k of keys) for (const row of groups.get(k).slice(0, alloc.get(k))) out.items.push({id: row.id, source, language: row.language, stratum: k, qtype: row.question_type, qgroup: QGROUP[row.question_type] ?? 'other', length: lengthBucket(row.question), chars: row.question.length});
  }
  const staged = stages(out.items, item => item.stratum, STAGES, 42);
  out.stages = Object.fromEntries(Object.entries(staged).map(([k, ids2]) => [k, ids2]));
  writeJson(file, out);
  const count = key => out.items.reduce((a, it) => ({...a, [it[key]]: (a[it[key]] ?? 0) + 1}), {});
  console.log('items', out.items.length, count('source'), count('language'), count('qgroup'), Object.fromEntries(Object.entries(out.stages).map(([k, v]) => [k, v.length])));
}

function loadItems(stage = 'full') {
  const sample = readJson(path.join(OUT, 'sample.json'));
  const ids = new Set(sample.stages[stage] ?? sample.stages.full);
  const rows = {};
  for (const [source, file] of Object.entries(SUITES)) rows[source] = new Map(readJsonlShardedSync(path.join(ROOT, file)).map(r => [r.id, r]));
  return sample.items.filter(item => ids.has(item.id)).map(item => ({...item, row: rows[item.source].get(item.id)}));
}

const SLICES = [['all', () => true], ['test', it => it.source === 'test'], ['ood', it => it.source === 'ood'], ['wild', it => it.source === 'wild'],
  ['en', it => it.language === 'en'], ['ro', it => it.language === 'ro'], ['mixed', it => it.language === 'mixed'],
  ['wild-en', it => it.source === 'wild' && it.language === 'en'], ['wild-ro', it => it.source === 'wild' && it.language === 'ro'], ['wild-mixed', it => it.source === 'wild' && it.language === 'mixed']];

async function convertCommand(args) {
  const label = String(args.rules ?? 'v1.5');
  const stage = String(args.stage ?? 'full');
  const items = loadItems(stage);
  const rules = await loadRules(args.dir);
  const predictions = await convertRows(items.map(it => it.row), rules, path.join(OUT, 'cache', 'parses-' + label + '.jsonl'));
  writeJsonl(path.join(OUT, `predictions-${label}.jsonl`), predictions);
  console.log(`rules ${label} (${rules.base}): ${predictions.length} predictions; admitted ${(mean(predictions.map(p => (p.valid ? 1 : 0))) * 100).toFixed(1)}%`);
}

async function compareCommand(args) {
  const {loadFrames} = await import('../../sop/frames.mjs');
  const stage = String(args.stage ?? 'full');
  const items = loadItems(stage);
  const ids = new Set(items.map(it => it.id));
  const frames = loadFrames();
  const result = {stage, rows: items.length, frames_digest: frames.digest, versions: {}, paired: {}};
  const scored = {};
  for (const label of ['v1.4', 'v1.5']) {
    const predictions = readJsonl(path.join(OUT, `predictions-${label}.jsonl`)).filter(p => ids.has(p.id));
    if (predictions.length !== items.length) throw Error(`predictions-${label}.jsonl covers ${predictions.length}/${items.length} rows of stage ${stage}`);
    const strict = strictScores(items, predictions, path.join(OUT, 'scoring', label + '-strict'));
    const norm = await normalizedScores(items, predictions, path.join(OUT, 'scoring', label + '-normalized'), frames);
    scored[label] = {strict, normalized: norm.scores};
    writeJsonl(path.join(OUT, `scores-${label}.jsonl`), items.map(it => ({id: it.id, source: it.source, language: it.language, qgroup: it.qgroup, strict: strict.get(it.id).match, normalized: norm.scores.get(it.id).match, d1_all_f1: strict.get(it.id).d1_all_f1, normalized_d1_all_f1: norm.scores.get(it.id).d1_all_f1, valid: predictions.find(p => p.id === it.id).valid})));
    result.versions[label] = Object.fromEntries(SLICES.map(([name, f]) => {
      const list = items.filter(f);
      return [name, {n: list.length, strict: mean(list.map(it => strict.get(it.id).match)), normalized: mean(list.map(it => norm.scores.get(it.id).match)), d1_all_f1: mean(list.map(it => strict.get(it.id).d1_all_f1)), admitted: mean(list.map(it => (predictions.find(p => p.id === it.id).valid ? 1 : 0)))}];
    }));
  }
  for (const [name, f] of SLICES) {
    const list = items.filter(f);
    if (!list.length) continue;
    result.paired[name] = {
      strict: pairedDelta(list, scored['v1.4'].strict, scored['v1.5'].strict),
      normalized: pairedDelta(list, scored['v1.4'].normalized, scored['v1.5'].normalized),
      d1_all_f1: pairedDelta(list, scored['v1.4'].strict, scored['v1.5'].strict, 'd1_all_f1'),
    };
  }
  const v15 = readJsonl(path.join(OUT, 'predictions-v1.5.jsonl')).filter(p => ids.has(p.id));
  const broken = mean(v15.map(p => (!p.sop || !p.valid ? 1 : 0)));
  const all = result.paired.all.strict;
  result.stop_check = {invalid_or_empty_share_v15: broken, broken: broken > 0.2, harm: all.ci95[1] < 0};
  writeJson(path.join(OUT, `compare-${stage}.json`), result);
  const pct = x => (x === null || x === undefined ? '-' : (x * 100).toFixed(1));
  for (const [name, p] of Object.entries(result.paired)) console.log(name.padEnd(10), `n ${String(p.strict.n).padStart(3)} strict ${pct(p.strict.a)} -> ${pct(p.strict.b)} d ${pct(p.strict.delta)} [${pct(p.strict.ci95[0])}, ${pct(p.strict.ci95[1])}] +${p.strict.gained}/-${p.strict.lost} | norm ${pct(p.normalized.a)} -> ${pct(p.normalized.b)} d ${pct(p.normalized.delta)} [${pct(p.normalized.ci95[0])}, ${pct(p.normalized.ci95[1])}]`);
  console.log('stop check', result.stop_check);
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const commands = {dev: devCommand, categorize: categorizeCommand, sample: sampleCommand, convert: convertCommand, compare: compareCommand};
  if (commands[args.command]) return commands[args.command](args);
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
