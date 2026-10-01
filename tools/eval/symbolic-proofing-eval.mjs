#!/usr/bin/env node
/** Evaluation of a SymbolicProofingLLM checkpoint (experiment train-symbolic-proofing-gemma270m-it1), auditor side (tools/eval).
 *
 *   node tools/eval/symbolic-proofing-eval.mjs inputs   --split dev|test|sym300
 *   node tools/eval/symbolic-proofing-eval.mjs generate --split S --name NAME (--model DIR | --identity)   # HF bf16 greedy, message-only prompt
 *   node tools/eval/symbolic-proofing-eval.mjs generate --split S --name NAME --url http://127.0.0.1:PORT                 # llama.cpp greedy
 *   node tools/eval/symbolic-proofing-eval.mjs agree    --split S --a NAME --b NAME [--n 50]                        # HF vs llama.cpp
 *   node tools/eval/symbolic-proofing-eval.mjs prepare  --split S --names a,b,c      # record parses, write the judge items (then run the omp judge)
 *   node tools/eval/symbolic-proofing-eval.mjs score    --split S --name NAME
 *   node tools/eval/symbolic-proofing-eval.mjs compare  --split S --a NAME --b NAME                       # paired bootstrap of the accepted-rate difference
 *
 * Splits: `dev` (datasets/neuro_english/proofing/proofreader/dev.jsonl, selection), `test` (the sealed pair file
 * eval/suites/neuro_english/proofing-test.jsonl, read only here), `sym300` (300 random messages, seed 20260930, of
 * datasets/symbolic_english/dev.jsonl: the break-rate check on messages SymbolicLM already handles).
 * The oracle is SymbolicLM, the FINAL engine (config/symbolic-lm.json, rules of lib/ud-to-sop), through the composed
 * evaluation's cached instance (tools/eval/composed/lm.mjs). Repair pairs: the output is accepted when its SOP equals the SOP
 * of the verified target (canonical blocks, tools/eval/composed/sop-canon.mjs); on the sealed pairs with a gold SOP the strict
 * gold comparison (eval/run.mjs execution equivalence) and the frame-normalized one (sop/frames.mjs) are reported separately
 * (tools/datasets/neuro-oracle/classify.mjs goldMatches). Identity pairs and sym300: the output is broken when its SOP no
 * longer matches (gold, else the SOP of the input). No training happens here.
 * Outputs: eval/reports/current/symbolic-proofing-it1/.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {openLm, handled} from './composed/lm.mjs';
import {compareParagraph} from './composed/sop-canon.mjs';
import {wilson} from './composed/stats.mjs';
import {goldSources, goldMatches} from '../datasets/neuro-oracle/classify.mjs';
import {goldFiles, sealedRows} from './neuro-oracle-test.mjs';
import {scoreAgainstAccepted} from './wild-suite.mjs';
import {checks, bootstrap} from '../research/proofing.mjs';
import {AnalysisLayer, writeJudgeItems} from './analysis-layer.mjs';
import {loadCases} from './composed-score.mjs';
import {sentencesOf, pronounCount, lostFillers, asksQuestion} from '../datasets/symbolic-proofing-v2/units.mjs';
import {appendMeaningItems, meaningItemId, meaningVotes} from '../datasets/neuro-oracle/judge.mjs';

const WORK = path.join(ROOT, process.env.SYMPROOF_WORK ?? 'eval/reports/current/symbolic-proofing-it1');
const TEST_FILE = 'eval/suites/neuro_english/proofing-test.jsonl';
const DEV_FILE = process.env.SYMPROOF_DEV ?? 'datasets/neuro_english/proofing/proofreader/dev.jsonl';
const MEANING_EVAL_DIR = path.join(ROOT, process.env.SYMPROOF_MEANING_DIR ?? 'datasets_sources/symbolic_proofing_it2_eval_meaning_judge');
const SYM_FILE = 'datasets/symbolic_english/dev.jsonl';
const GENERATE = path.join(ROOT, 'training/python/generate_causal.py');
const PYTHON = process.env.GEN_PYTHON ?? path.join(process.env.HOME, 'nlp-venv/bin/python');
/** SYMPROOF_ALLOW_PENDING=1: an item without a judge verdict does not stop the scorer; it counts as not judged good (a lower bound of the with-judges columns, exact local-only columns). */
const ALLOW_PENDING = process.env.SYMPROOF_ALLOW_PENDING === '1';
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Rows of a split: {id, prompt, target, kind}. */
export function loadSplit(split) {
  if (split === 'dev') {
    const audit = new Map(readJsonl(path.join(ROOT, 'datasets/neuro_english/proofing/audit.jsonl')).map(a => [a.id, a.failure_kind ?? null]));
    return readJsonl(path.join(ROOT, DEV_FILE)).map(r => ({id: r.id, prompt: r.prompt, target: r.target, kind: r.kind, failure_kind: audit.get(r.id) ?? null}));
  }
  if (split === 'test') return readJsonl(path.join(ROOT, TEST_FILE)).map(r => ({id: r.id, prompt: r.prompt, target: r.target, kind: r.kind, failure_kind: r.failure_kind ?? null, has_gold: r.has_gold, verification: r.verification, decomposition: r.decomposition ?? false, tokens: r.tokens?.total ?? null}));
  if (split === 'long') {
    // inputs longer than anything in training (longest training prompt: about 3,000 characters): sealed composed paragraphs concatenated to about 8,500 characters
    const read = dataset => readJsonlShardedSync(path.join(ROOT, 'eval/suites', dataset, 'test-composed.jsonl'));
    const k3 = read('symbolic_english').filter(r => r.kind === 'K3'), k2 = read('neuro_english').filter(r => r.kind === 'K2'), random = rng(20260930);
    const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const build = (pool, kind, count, prefix) => {
      const order = shuffle(pool), out = [];
      let at = 0;
      for (let n = 0; n < count; n++) {
        const prompt = [], target = [];
        while (prompt.join(' ').length < 8500 && at < order.length) { prompt.push(order[at].message); target.push(kind === 'identity' ? order[at].message : order[at].expected_text); at++; }
        out.push({id: `long::${prefix}${String(n + 1).padStart(2, '0')}`, prompt: prompt.join(' '), target: target.join(' '), kind, n_paragraphs: prompt.length});
      }
      return out;
    };
    return [...build(k3, 'identity', 8, 'identity-'), ...build(k2, 'repair', 8, 'mixed-')];
  }
  if (split === 'sym300') {
    // the sample is frozen in inputs-sym300.jsonl when it is first generated: datasets/symbolic_english/dev.jsonl may be rebuilt by the data agents
    if (fs.existsSync(inputFile('sym300'))) return readJsonl(inputFile('sym300')).map(r => ({id: r.id, prompt: r.text, target: r.text, kind: 'identity'}));
    const rows = readJsonlShardedSync(path.join(ROOT, SYM_FILE)), random = rng(20260930), index = rows.map((_, i) => i);
    for (let i = index.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [index[i], index[j]] = [index[j], index[i]]; }
    return index.slice(0, 300).sort((a, b) => a - b).map(i => ({id: rows[i].id, prompt: rows[i].message, target: rows[i].message, kind: 'identity'}));
  }
  if (split === 'trainfit') {
    // capacity check: 400 repair and 400 identity pairs of the TRAINING file (seed 20260930), frozen in inputs-trainfit.jsonl; the model is asked about pairs it was trained on
    if (fs.existsSync(inputFile('trainfit'))) return readJsonl(inputFile('trainfit')).map(r => ({id: r.id, prompt: r.text, target: r.target, kind: r.kind}));
    const rows = readJsonl(path.join(ROOT, DEV_FILE.replace(/dev\.jsonl$/, 'train.jsonl'))), random = rng(20260930);
    const pick = kind => { const l = rows.filter(r => r.kind === kind); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l.slice(0, 400); };
    return [...pick('repair'), ...pick('identity')].map(r => ({id: r.id, prompt: r.prompt, target: r.target, kind: r.kind}));
  }
  if (split === 'sym500') {
    // 500 random working sentences of the sealed symbolic_english test (seed 20260930): SymbolicLM already handles them, so any change of the analysis or the text is damage
    if (fs.existsSync(inputFile('sym500'))) return readJsonl(inputFile('sym500')).map(r => ({id: r.id, prompt: r.text, target: r.text, kind: 'identity'}));
    const rows = readJsonlShardedSync(path.join(ROOT, 'eval/suites/symbolic_english/test.jsonl')), random = rng(20260930), pool = [];
    for (const r of rows) { const units = sentencesOf(r.message).filter(u => u.length >= 8 && u.length <= 400); if (units.length) pool.push({id: r.id, units}); }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, 500).map(p => { const k = Math.floor(random() * p.units.length); return {id: `${p.id}@s${k}`, prompt: p.units[k], target: p.units[k], kind: 'identity'}; });
  }
  throw Error(`unknown split ${split}`);
}

const inputFile = split => path.join(WORK, `inputs-${split}.jsonl`);
const outputFile = (name, split) => path.join(WORK, 'outputs', `${name}__${split}.jsonl`);
const scoreFile = (name, split) => path.join(WORK, 'scores', `${name}__${split}.json`);

/** Greedy decoding through a llama.cpp `llama-server` chat endpoint (message-only prompt, prompt cache off), one row at a time. */
async function generateEndpoint(rows, url, out, {maxTokens = 3000} = {}) {
  const records = [];
  for (const r of rows) {
    const t0 = Date.now();
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: r.prompt}], temperature: 0, top_k: 1, seed: 0, cache_prompt: false, max_tokens: maxTokens})});
    if (!res.ok) throw Error(`endpoint ${res.status}`);
    const data = await res.json(), choice = data.choices?.[0];
    records.push({id: r.id, output: String(choice?.message?.content ?? '').trim(), in_tokens: data.usage?.prompt_tokens ?? null, out_tokens: data.usage?.completion_tokens ?? null, truncated: choice?.finish_reason === 'length', ms: Date.now() - t0, device: 'llama.cpp'});
  }
  writeJsonl(out, records);
}

/** Agreement of two output files (HF greedy vs llama.cpp greedy) on the first `n` rows of a split. */
function agree(split, a, b, n) {
  const A = new Map(readJsonl(outputFile(a, split)).map(r => [r.id, r.output])), B = new Map(readJsonl(outputFile(b, split)).map(r => [r.id, r.output]));
  const ids = loadSplit(split).map(r => r.id).filter(id => A.has(id) && B.has(id)).slice(0, n);
  const same = ids.filter(id => norm(A.get(id)) === norm(B.get(id)));
  const differ = ids.filter(id => norm(A.get(id)) !== norm(B.get(id))).map(id => ({id, a: A.get(id).slice(0, 200), b: B.get(id).slice(0, 200)}));
  console.log(JSON.stringify({split, a, b, rows: ids.length, identical: same.length, differ}, null, 1));
}

async function generateRows(rows, split, out, o) {
  if (o.url) return generateEndpoint(rows, o.url, out, {maxTokens: Number(o['max-tokens'] ?? 3000)});
  if (o.identity) { writeJsonl(out, rows.map(r => ({id: r.id, output: r.prompt, in_tokens: null, out_tokens: null, truncated: false, ms: 0, device: 'none'}))); return; }
  const inFile = `${out}.in.jsonl`;
  writeJsonl(inFile, rows.map(r => ({id: r.id, text: r.prompt})));
  const res = spawnSync(PYTHON, [GENERATE, '--model', path.resolve(ROOT, o.model), '--in', inFile, '--out', out, '--batch', String(o.batch ?? 16), '--device', o.device ?? 'cuda', '--max-new', String(o['max-new'] ?? 3000)], {stdio: ['ignore', 'inherit', 'inherit']});
  if (res.status !== 0) throw Error(`generation failed (${res.status})`);
  fs.unlinkSync(inFile);
}

/** Generation of a split. With `--units true` every input is cut by the host splitter and EVERY sentence goes to the model (the chat's sendAll); the outputs are joined with a space. Identical sentences are generated once. */
async function generate(split, name, o) {
  const rows = loadSplit(split);
  const out = outputFile(name, split);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  if (!fs.existsSync(inputFile(split))) writeJsonl(inputFile(split), rows.map(r => ({id: r.id, text: r.prompt, ...(split === 'trainfit' ? {target: r.target, kind: r.kind} : {})})));
  if (o.units !== 'true') return generateRows(rows, split, out, o);
  const unitOf = new Map(), perRow = rows.map(r => sentencesOf(r.prompt).map(u => { if (!unitOf.has(u)) unitOf.set(u, `u${unitOf.size}`); return u; }));
  const unitRows = [...unitOf].map(([text, id]) => ({id, prompt: text}));
  const tmp = `${out}.units.jsonl`;
  await generateRows(unitRows, split, tmp, o);
  const byId = new Map(readJsonl(tmp).map(r => [r.id, r]));
  writeJsonl(out, rows.map((r, i) => {
    const parts = perRow[i].map(u => byId.get(unitOf.get(u)));
    return {id: r.id, output: parts.map(p => p.output).join(' ').trim(), units: parts.length, in_tokens: parts.reduce((a, p) => a + (p.in_tokens ?? 0), 0), out_tokens: parts.reduce((a, p) => a + (p.out_tokens ?? 0), 0), truncated: parts.some(p => p.truncated), ms: parts.reduce((a, p) => a + (p.ms ?? 0), 0), device: parts[0]?.device ?? null, mode: 'sentence'};
  }));
  fs.unlinkSync(tmp);
}

const names = text => new Set((String(text).match(/(?<=[\p{L}\p{N},;:] )\p{Lu}[\p{L}'’-]+/gu) ?? []).map(x => x.toLowerCase()));
const numbers = text => (String(text).match(/\d+(?:[.,]\d+)?/g) ?? []).sort().join('|');
/** Meaning checks: names (non-initial capitalized tokens of the input still occur in the output), numbers (same multiset), negation, quantifiers, question mark, non-empty. */
export function meaning(input, output) {
  const c = checks({language: 'en'}, input, output, null);
  const low = String(output).toLowerCase();
  const lostNames = [...names(input)].filter(n => !low.includes(n));
  const m = {negation: c.negation, quantifiers: c.quantifiers, question: c.question, nonempty: c.nonempty, names: lostNames.length === 0, numbers: numbers(input) === numbers(output)};
  m.ok = Object.values(m).every(Boolean);
  m.lost_names = lostNames;
  return m;
}

/** Every text the analysis layer needs for the named runs of a split (inputs, verified targets, outputs): parses are recorded and the judge items written. */
async function prepare(split, nameList) {
  const rows = loadSplit(split), texts = [];
  for (const r of rows) texts.push(r.prompt, r.target);
  for (const name of nameList) for (const o of readJsonl(outputFile(name, split))) texts.push(o.output);
  const layer = new AnalysisLayer();
  const parses = await layer.ensure(texts);
  const items = layer.pendingItems(texts);
  console.log(JSON.stringify({split, names: nameList, texts: new Set(texts).size, parses, ...writeJudgeItems(items), pending_items: items.length}));
}

/** Two-vote meaning items (omp folder MEANING_EVAL_DIR) of every changed repair output that passes the hard mechanical checks and is not the verified target. */
function meaningPrepare(split, nameList) {
  const rows = new Map(loadSplit(split).map(r => [r.id, r])), pairs = [], layer = new AnalysisLayer();
  let localEquivalent = 0;
  for (const name of nameList) for (const o of readJsonl(outputFile(name, split))) {
    const r = rows.get(o.id);
    if (!r || r.kind !== 'repair' || norm(o.output) === norm(r.prompt) || norm(o.output) === norm(r.target)) continue;
    const m = meaning(r.prompt, o.output);
    if (!(m.names && m.numbers && m.negation && m.nonempty)) continue;
    // local first: the analysis comparison calls the pair equivalent, no LLM needed
    if (layer.localMeaning(r.prompt, o.output) === 'equivalent') { localEquivalent++; continue; }
    pairs.push({cid: `${split}::${r.id}`, message: r.prompt, candidate: o.output});
  }
  const added = appendMeaningItems(pairs, MEANING_EVAL_DIR);
  const task = path.join(MEANING_EVAL_DIR, 'TASK.md');
  if (fs.existsSync(task)) fs.writeFileSync(task, fs.readFileSync(task, 'utf8').replaceAll('datasets_sources/resplit_meaning_judge/', path.relative(ROOT, MEANING_EVAL_DIR) + '/'));
  console.log(JSON.stringify({split, names: nameList, pairs: pairs.length, local_equivalent_skipped: localEquivalent, ...added}));
}

async function score(split, name) {
  const rows = loadSplit(split), outs = new Map(readJsonl(outputFile(name, split)).map(r => [r.id, r]));
  if (outs.size !== rows.length) throw Error(`${outs.size} outputs for ${rows.length} rows`);
  const layer = new AnalysisLayer();
  layer.reloadVerdicts();
  const lm = await openLm();
  try {
    // gold comparison of the sealed pairs that have a gold SOP
    let gold = new Map();
    if (split === 'test') {
      const neuro = sealedRows('neuro_english'), symbolic = sealedRows('symbolic_english'), byId = new Map([...symbolic, ...neuro].map(r => [r.id, r]));
      const list = [], results = new Map();
      for (const r of rows) {
        const src = byId.get(r.id);
        if (!src?.gold_sop) continue;
        const text = outs.get(r.id).output;
        const res = await lm.run(text);
        list.push({cid: r.id, id: r.id, text});
        results.set(r.id, {sop: res.sop, valid: res.valid});
      }
      const {sources} = goldSources(list.map(l => byId.get(l.id)), goldFiles());
      gold = await goldMatches(list, results, byId, sources, {wildScore: scoreAgainstAccepted});
    }
    const records = [], votes = fs.existsSync(MEANING_EVAL_DIR) ? meaningVotes(MEANING_EVAL_DIR) : new Map();
    for (const r of rows) {
      const o = outs.get(r.id), output = o.output, input = r.prompt;
      const out = await lm.run(output), tgt = r.target === input ? await lm.run(input) : await lm.run(r.target), inp = await lm.run(input);
      const reference = r.kind === 'identity' ? inp : tgt;
      const sopMatch = out.valid && compareParagraph(out.sop, [reference.sop]).exact;
      const g = gold.get(r.id);
      const strict = g ? Boolean(g.ok) : sopMatch, normalized = g ? Boolean(g.ok || g.frame_ok) : sopMatch;
      const gIn = layer.gate(input), gOut = layer.gate(output), gTgt = layer.gate(r.target), mean = meaning(input, output);
      if (!ALLOW_PENDING && (gIn.pending || gOut.pending)) throw Error(`judge verdicts pending for ${r.id}; run prepare and the judge first`);
      // meaning kept (owner direction 2026-10-01): unchanged, equal to the verified target, or the hard mechanical checks (names, numbers, negation, non-empty) hold AND the two-vote meaning judge says yes
      const unchangedText = norm(output) === norm(input), exactText = norm(output) === norm(r.target);
      const hard = mean.names && mean.numbers && mean.negation && mean.nonempty;
      // local first (owner direction 2026-10-01): an output equal to the target, or one that the local analysis comparison calls equivalent, needs no LLM; only the residue is judged
      const locEq = r.kind === 'repair' && !unchangedText && !exactText && hard && layer.localMeaning(input, output) === 'equivalent';
      const vote = votes.get(meaningItemId(`${split}::${r.id}`, input, output)) ?? null;
      const judgeNeeded = r.kind === 'repair' && !unchangedText && !exactText && hard && !locEq;
      if (!ALLOW_PENDING && judgeNeeded && vote === null) throw Error(`meaning judge verdict pending for ${r.id}; run meaning-prepare and the judge first`);
      const meaningKept = unchangedText || exactText || (hard && (locEq || vote === 'yes'));
      const meaningLocal = unchangedText || exactText || (hard && locEq);
      const localOut = layer.localPass(output);
      const cut = norm(output).length > 3 * norm(input).length + 120 || Boolean(o.truncated) || (() => { const u = sentencesOf(output).map(x => x.toLowerCase()); return u.length > 2 && new Set(u).size < u.length; })();
      records.push({
        analysis: {in_pass: gIn.pass, out_pass: gOut.pass, target_pass: gTgt.pass, same_analysis: norm(output) === norm(input) || layer.sameAnalysis(input, output), out_sentences: gOut.sentences, in_sentences: gIn.sentences,
          out_failed: gOut.failed, good: gOut.pass && meaningKept, good_mechanical: gOut.pass && mean.ok, meaning_kept: meaningKept, judge: locEq ? 'local_equivalent' : vote, judge_needed: judgeNeeded, local_in_pass: layer.localPass(input), local_out_pass: localOut, local_good: localOut && meaningLocal, shape_out: layer.shape(output), shape_target: layer.shape(r.target)},
        id: r.id, kind: r.kind, failure_kind: r.failure_kind ?? null, has_gold: Boolean(g), decomposition: r.decomposition ?? false, tokens: r.tokens ?? null, input_chars: input.length, output_chars: output.length,
        unchanged: unchangedText, exact_text: exactText, runaway: cut, pronoun_dropped: pronounCount(output) < pronounCount(input), filler_dropped: lostFillers(input, output).length > 0, statement_to_question: /\?/.test(output) && !/\?/.test(input) && !asksQuestion(input), empty: !norm(output), truncated: Boolean(o.truncated),
        sop_match: sopMatch, strict, normalized, parsed_clean: out.valid && out.outcome === 'converted' && !out.unparsed.length, handled: handled(out),
        input_handled: handled(inp), meaning: mean, input, target: r.target, output,
      });
    }
    const summary = summarize(records, split);
    fs.mkdirSync(path.dirname(scoreFile(name, split)), {recursive: true});
    fs.writeFileSync(scoreFile(name, split), JSON.stringify({name, split, generated_at: new Date().toISOString(), lm_id: lm.id, summary, records}, null, 1) + '\n');
    console.log(JSON.stringify({name, split, summary}, null, 1));
  } finally { await lm.close(); }
}

/** Recompute the meaning fields of every score file under the local-first rule (an output equal to the target, or equivalent by the local analysis comparison, needs no LLM; the rest uses the two-vote judge) without calling any model. */
async function remeaning() {
  const layer = new AnalysisLayer();
  layer.reloadVerdicts();
  const votes = fs.existsSync(MEANING_EVAL_DIR) ? meaningVotes(MEANING_EVAL_DIR) : new Map();
  const dir = path.join(WORK, 'scores'), report = [];
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const file = path.join(dir, name), d = JSON.parse(fs.readFileSync(file, 'utf8'));
    let judged = 0, local = 0, agree = {local_equivalent_and_judge_yes: 0, local_equivalent_and_judge_no: 0};
    for (const r of d.records) {
      const m = r.meaning, hard = m.names && m.numbers && m.negation && m.nonempty;
      const locEq = r.kind === 'repair' && !r.unchanged && !r.exact_text && hard && layer.localMeaning(r.input, r.output) === 'equivalent';
      const vote = votes.get(meaningItemId(`${d.split}::${r.id}`, r.input, r.output)) ?? null;
      const needed = r.kind === 'repair' && !r.unchanged && !r.exact_text && hard && !locEq;
      if (needed && vote === null) throw Error(`meaning judge verdict pending for ${r.id} in ${name}`);
      if (locEq) { local++; if (vote === 'yes') agree.local_equivalent_and_judge_yes++; else if (vote === 'no') agree.local_equivalent_and_judge_no++; }
      if (needed) judged++;
      const kept = r.unchanged || r.exact_text || (hard && (locEq || vote === 'yes')), keptLocal = r.unchanged || r.exact_text || (hard && locEq);
      Object.assign(r.analysis, {meaning_kept: kept, judge: locEq ? 'local_equivalent' : vote, judge_needed: needed, good: r.analysis.out_pass && kept, local_in_pass: layer.localPass(r.input), local_out_pass: layer.localPass(r.output), local_good: layer.localPass(r.output) && keptLocal});
    }
    d.summary = summarize(d.records, d.split);
    d.local_first = {judge_needed: judged, local_equivalent: local, ...agree};
    fs.writeFileSync(file, JSON.stringify(d, null, 1) + '\n');
    report.push({file: name, repair_rows: d.records.filter(r => r.kind === 'repair').length, judge_needed: judged, local_equivalent: local, ...agree});
  }
  console.log(JSON.stringify(report, null, 1));
}

const w = (k, n) => wilson(k, n);
/** Rates with Wilson intervals, by kind. */
export function summarize(records, split) {
  const repair = records.filter(r => r.kind === 'repair'), identity = records.filter(r => r.kind === 'identity');
  const count = (list, f) => list.filter(f).length;
  const out = {rows: records.length, repair_rows: repair.length, identity_rows: identity.length};
  // PRIMARY (owner direction 2026-09-30): grammatical analysis and meaning; the SOP columns below are secondary
  if (repair.length) {
    const failing = repair.filter(r => !r.analysis.in_pass);
    out.primary_repair = {
      input_analysis_correct: w(count(repair, r => r.analysis.in_pass), repair.length),
      target_analysis_correct: w(count(repair, r => r.analysis.target_pass), repair.length),
      output_analysis_correct: w(count(repair, r => r.analysis.out_pass), repair.length),
      output_meaning_ok_mechanical: w(count(repair, r => r.meaning.ok), repair.length),
      output_analysis_correct_and_meaning_ok: w(count(repair, r => r.analysis.good), repair.length),
      output_meaning_kept: w(count(repair, r => r.analysis.meaning_kept ?? r.meaning.ok), repair.length),
      input_analysis_correct_local: w(count(repair, r => r.analysis.local_in_pass), repair.length),
      output_analysis_correct_local: w(count(repair, r => r.analysis.local_out_pass), repair.length),
      output_analysis_correct_and_meaning_local: w(count(repair, r => r.analysis.local_good), repair.length),
      meaning_judge_needed: w(count(repair, r => r.analysis.judge_needed), repair.length),
      output_analysis_correct_and_meaning_ok_mechanical_only: w(count(repair, r => r.analysis.good_mechanical ?? r.analysis.good), repair.length),
      output_pronoun_dropped: w(count(repair, r => r.pronoun_dropped), repair.length),
      output_filler_dropped: w(count(repair, r => r.filler_dropped), repair.length),
      output_statement_to_question: w(count(repair, r => r.statement_to_question), repair.length),
      output_runaway: w(count(repair, r => r.runaway), repair.length),
      fixed_of_failing_inputs: w(count(failing, r => r.analysis.good), failing.length),
      worse_than_input: w(count(repair, r => r.analysis.in_pass && !r.analysis.out_pass), count(repair, r => r.analysis.in_pass)),
      output_one_clause_sentences: w(repair.reduce((a, r) => a + (r.analysis.shape_out?.one_clause ?? 0), 0), repair.reduce((a, r) => a + (r.analysis.shape_out?.sentences ?? 0), 0)),
      output_explicit_subject_sentences: w(repair.reduce((a, r) => a + (r.analysis.shape_out?.subject ?? 0), 0), repair.reduce((a, r) => a + (r.analysis.shape_out?.sentences ?? 0), 0)),
      target_one_clause_sentences: w(repair.reduce((a, r) => a + (r.analysis.shape_target?.one_clause ?? 0), 0), repair.reduce((a, r) => a + (r.analysis.shape_target?.sentences ?? 0), 0)),
      sentence_count_equals_target: w(count(repair, r => r.analysis.shape_out?.sentences === r.analysis.shape_target?.sentences), repair.length),
    };
  }
  if (identity.length) {
    const working = identity.filter(r => r.analysis.in_pass);
    out.primary_identity = {
      analysis_changed: w(count(identity, r => !r.analysis.same_analysis), identity.length),
      working_inputs: working.length,
      working_analysis_changed: w(count(working, r => !r.analysis.same_analysis), working.length),
      working_no_longer_analysis_correct: w(count(working, r => !r.analysis.out_pass), working.length),
      text_changed: w(count(identity, r => !r.unchanged), identity.length),
      analysis_changed_or_text_changed: w(count(identity, r => !r.unchanged || !r.analysis.same_analysis), identity.length),
      runaway: w(count(identity, r => r.runaway), identity.length),
      pronoun_dropped: w(count(identity, r => r.pronoun_dropped), identity.length),
      meaning_broken_mechanical: w(count(identity, r => !r.meaning.ok), identity.length),
    };
  }
  // the pairs come from the SOP-proxy split (journal incident of 2026-09-30): a repair pair whose source row failed only in the SOP layer
  // (failure_kind rules or gold_convention) probably never needed a rewrite at the analysis layer
  // failure_kind is the ANALYSIS-layer kind since the re-split of 2026-09-30 night (trees_differ, judge_*, ...); the old SOP-layer kinds only occur in records of the SOP-proxy split.
  const group = r => (r.failure_kind === 'trees_differ' ? 'trees_differ' : ['judge_ac', 'judge_a', 'judge_c'].includes(r.failure_kind) ? 'judge_rejected' : ['parser', 'unknown'].includes(r.failure_kind) ? 'parser_or_unknown (SOP-proxy split)' : ['rules', 'gold_convention'].includes(r.failure_kind) ? 'rules_or_convention (SOP-proxy split)' : 'composed_or_other');
  out.repair_by_source_failure_kind = {};
  for (const g of [...new Set(repair.map(group))].sort()) {
    const list = repair.filter(r => group(r) === g);
    if (!list.length) continue;
    const failing = list.filter(r => !r.analysis.in_pass);
    out.repair_by_source_failure_kind[g] = {rows: list.length, input_analysis_correct: w(count(list, r => r.analysis.in_pass), list.length), output_analysis_correct: w(count(list, r => r.analysis.out_pass), list.length),
      output_analysis_correct_and_meaning_ok: w(count(list, r => r.analysis.good), list.length), fixed_of_failing_inputs: w(count(failing, r => r.analysis.good), failing.length), worse_than_input: w(count(list, r => r.analysis.in_pass && !r.analysis.out_pass), count(list, r => r.analysis.in_pass)),
      sop_accepted: w(count(list, r => r.sop_match), list.length)};
  }
  if (repair.length) Object.assign(out, {
    repair_accepted_sop: w(count(repair, r => r.sop_match), repair.length),
    repair_strict_gold: w(count(repair, r => r.strict), repair.length), repair_normalized_gold: w(count(repair, r => r.normalized), repair.length),
    repair_exact_text: w(count(repair, r => r.exact_text), repair.length), repair_left_unchanged: w(count(repair, r => r.unchanged), repair.length),
    repair_parsed_clean: w(count(repair, r => r.parsed_clean), repair.length), repair_meaning_ok: w(count(repair, r => r.meaning.ok), repair.length),
  });
  if (identity.length) Object.assign(out, {
    identity_break: w(count(identity, r => !r.strict), identity.length), identity_break_normalized: w(count(identity, r => !r.normalized), identity.length),
    identity_text_changed: w(count(identity, r => !r.unchanged), identity.length), identity_meaning_broken: w(count(identity, r => !r.meaning.ok), identity.length),
    identity_parsed_clean: w(count(identity, r => r.parsed_clean), identity.length),
  });
  out.empty_or_truncated = w(count(records, r => r.empty || r.truncated), records.length);
  out.parsed_clean_all = w(count(records, r => r.parsed_clean), records.length);
  out.meaning_ok_all = w(count(records, r => r.meaning.ok), records.length);
  if (split === 'test') {
    const dec = repair.filter(r => r.decomposition);
    out.repair_decomposition_rows = {accepted: w(count(dec, r => r.sop_match), dec.length), exact_text: w(count(dec, r => r.exact_text), dec.length)};
    const long = repair.filter(r => (r.tokens ?? 0) >= 500);
    out.repair_long_rows_500plus_tokens = {accepted: w(count(long, r => r.sop_match), long.length), unchanged: w(count(long, r => r.unchanged), long.length)};
  }
  return out;
}

function compare(split, a, b) {
  const A = new Map(JSON.parse(fs.readFileSync(scoreFile(a, split), 'utf8')).records.map(r => [r.id, r])), B = new Map(JSON.parse(fs.readFileSync(scoreFile(b, split), 'utf8')).records.map(r => [r.id, r]));
  const res = {};
  for (const kind of ['repair', 'identity']) {
    const ids = [...A.keys()].filter(id => A.get(id).kind === kind);
    if (!ids.length) continue;
    const metric = r => Number(kind === 'repair' ? r.analysis.good : r.analysis.same_analysis), clusters = ids.map(id => [[metric(A.get(id)), metric(B.get(id))]]);
    const ci = bootstrap(clusters);
    const delta = clusters.reduce((s, c) => s + c[0][1] - c[0][0], 0) / clusters.length;
    res[kind] = {n: ids.length, metric: 'analysis layer (repair: output analysis correct and meaning ok; identity: same analysis as the input)', a, b, delta: Math.round(delta * 1000) / 1000, ci95: ci.map(x => Math.round(x * 1000) / 1000)};
  }
  console.log(JSON.stringify(res, null, 1));
}

// ------------------------------------------------------------------ composed suites, analysis layer
const COMPOSED = path.join(WORK, 'composed');
const SUITE_ROOT = path.join(ROOT, 'eval/suites');
/** Finished runs of the composed scorer: [{file, name, kind, mode, dataset}] (K6 runs are `<name>__K6-<dataset>.jsonl`). */
function composedRuns(nameList) {
  const dir = path.join(COMPOSED, 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => {
    const m = /^(.*)__(K\d)(?:-([a-z_]+))?(?:__(sentence|paragraph))?\.jsonl$/.exec(f);
    return m ? {file: path.join(dir, f), name: m[1], kind: m[2], dataset: m[3] ?? null, mode: m[4] ?? (m[2] === 'K6' ? 'whole' : null)} : null;
  }).filter(r => r && (!nameList || nameList.includes(r.name)));
}
const datasetOf = run => run.dataset ?? (run.kind === 'K2' ? 'neuro_english' : 'symbolic_english');

async function composedPrepare(nameList) {
  const texts = [];
  for (const run of composedRuns(nameList)) {
    const cases = new Map(loadCases(run.kind, SUITE_ROOT, datasetOf(run)).map(r => [r.id, r]));
    for (const rec of readJsonl(run.file)) { const row = cases.get(rec.id); if (!row || rec.error) continue; texts.push(row.message, row.expected_text, rec.output); }
  }
  const layer = new AnalysisLayer(), parses = await layer.ensure(texts), items = layer.pendingItems(texts);
  console.log(JSON.stringify({texts: new Set(texts).size, parses, ...writeJudgeItems(items), pending_items: items.length}));
}

/** Two-vote meaning items of the composed outputs that changed the message (hard mechanical checks passed, not the expected text). */
async function composedMeaningPrepare(nameList) {
  const pairs = [], layer = new AnalysisLayer();
  let localEquivalent = 0;
  for (const run of composedRuns(nameList)) {
    const cases = new Map(loadCases(run.kind, SUITE_ROOT, datasetOf(run)).map(r => [r.id, r]));
    for (const rec of readJsonl(run.file)) {
      const row = cases.get(rec.id);
      if (!row || rec.error || norm(rec.output) === norm(row.message) || norm(rec.output) === norm(row.expected_text)) continue;
      const m = meaning(row.message, rec.output);
      if (!(m.names && m.numbers && m.negation && m.nonempty)) continue;
      if (layer.localMeaning(row.message, rec.output) === 'equivalent') { localEquivalent++; continue; }
      pairs.push({cid: `composed::${row.id}`, message: row.message, candidate: rec.output});
    }
  }
  const unique = new Map(pairs.map(p => [meaningItemId(p.cid, p.message, p.candidate), p]));
  const added = appendMeaningItems([...unique.values()], MEANING_EVAL_DIR);
  const task = path.join(MEANING_EVAL_DIR, 'TASK.md');
  if (fs.existsSync(task)) fs.writeFileSync(task, fs.readFileSync(task, 'utf8').replaceAll('datasets_sources/resplit_meaning_judge/', path.relative(ROOT, MEANING_EVAL_DIR) + '/'));
  console.log(JSON.stringify({pairs: unique.size, local_equivalent_skipped: localEquivalent, ...added}));
}

async function composedScore(nameList) {
  const layer = new AnalysisLayer();
  layer.reloadVerdicts();
  const votes = fs.existsSync(MEANING_EVAL_DIR) ? meaningVotes(MEANING_EVAL_DIR) : new Map();
  const lm = await openLm();
  const summaries = [];
  try {
    for (const run of composedRuns(nameList)) {
      const cases = new Map(loadCases(run.kind, SUITE_ROOT, datasetOf(run)).map(r => [r.id, r]));
      const records = [];
      for (const rec of readJsonl(run.file)) {
        const row = cases.get(rec.id);
        if (!row || rec.error) continue;
        const input = row.message, output = rec.output, expected = row.expected_text;
        const gIn = layer.gate(input), gOut = layer.gate(output), gExp = layer.gate(expected);
        if (!ALLOW_PENDING && (gIn.pending || gOut.pending || gExp.pending)) throw Error(`judge verdicts pending in ${run.file}`);
        const mean = meaning(input, output), so = layer.shape(output), se = layer.shape(expected);
        const hard = mean.names && mean.numbers && mean.negation && mean.nonempty, unchangedText = norm(input) === norm(output), exactText = norm(output) === norm(expected);
        const vote = votes.get(meaningItemId(`composed::${row.id}`, input, output)) ?? null;
        const locEq = !unchangedText && !exactText && hard && layer.localMeaning(input, output) === 'equivalent';
        if (!ALLOW_PENDING && !unchangedText && !exactText && hard && !locEq && vote === null) throw Error(`meaning judge verdict pending for ${row.id} in ${run.file}; run composed-meaning-prepare and the judge first`);
        const meaningKept = unchangedText || exactText || (hard && (locEq || vote === 'yes'));
        const meaningLocal = unchangedText || exactText || (hard && locEq);
        const judgeNeeded = !unchangedText && !exactText && hard && !locEq;
        records.push({id: row.id, n_sentences: row.n_sentences, unchanged: norm(input) === norm(output), in_pass: gIn.pass, out_pass: gOut.pass, expected_pass: gExp.pass,
          out_sentences: gOut.sentences, out_sentences_pass: gOut.sentences - gOut.failed.length, in_sentences: gIn.sentences, in_sentences_pass: gIn.sentences - gIn.failed.length, expected_sentences: gExp.sentences, expected_sentences_pass: gExp.sentences - gExp.failed.length,
          same_analysis: norm(input) === norm(output) || layer.sameAnalysis(input, output), meaning_ok: meaningKept, meaning_ok_mechanical: mean.ok, good: gOut.pass && meaningKept, local_out_pass: layer.localPass(output), local_good: layer.localPass(output) && meaningLocal, judge_needed: judgeNeeded, out_sentences_local: (layer.info(output)?.sentences ?? []).filter(x => x.tree === 'identical').length, pronoun_kept: pronounCount(output) >= pronounCount(input), runaway: norm(output).length > 3 * norm(input).length + 120, shape_out: so, shape_expected: se, sentence_count_equals_expected: so?.sentences === se?.sentences});
      }
      const n = records.length, k = f => records.filter(f).length, sum = f => records.reduce((a, r) => a + (f(r) ?? 0), 0);
      const failing = records.filter(r => !r.in_pass);
      const summary = {run: `${run.name} ${run.kind}${run.dataset ? '-' + run.dataset : ''} ${run.mode}`, name: run.name, kind: run.kind, mode: run.mode, cases: n,
        input_analysis_correct: w(k(r => r.in_pass), n), output_analysis_correct: w(k(r => r.out_pass), n), expected_analysis_correct: w(k(r => r.expected_pass), n),
        sentences_correct_in: w(sum(r => r.in_sentences_pass), sum(r => r.in_sentences)), sentences_correct_out: w(sum(r => r.out_sentences_pass), sum(r => r.out_sentences)), sentences_correct_expected: w(sum(r => r.expected_sentences_pass), sum(r => r.expected_sentences)),
        output_meaning_ok_mechanical: w(k(r => r.meaning_ok_mechanical ?? r.meaning_ok), n), output_meaning_kept: w(k(r => r.meaning_ok), n), output_analysis_correct_and_meaning_ok: w(k(r => r.good), n), output_analysis_correct_local: w(k(r => r.local_out_pass), n), output_analysis_correct_and_meaning_local: w(k(r => r.local_good), n), sentences_correct_out_local: w(sum(r => r.out_sentences_local), sum(r => r.out_sentences)), judge_needed: w(k(r => r.judge_needed), n), pronouns_kept: w(k(r => r.pronoun_kept ?? true), n), runaway: w(k(r => r.runaway), n),
        fixed_of_failing_inputs: w(failing.filter(r => r.good).length, failing.length), worse_than_input: w(k(r => r.in_pass && !r.out_pass), k(r => r.in_pass)),
        text_unchanged: w(k(r => r.unchanged), n), same_analysis_as_input: w(k(r => r.same_analysis), n),
        sentence_count_equals_expected: w(k(r => r.sentence_count_equals_expected), n),
        output_one_clause_sentences: w(sum(r => r.shape_out?.one_clause), sum(r => r.shape_out?.sentences)), expected_one_clause_sentences: w(sum(r => r.shape_expected?.one_clause), sum(r => r.shape_expected?.sentences)),
        output_explicit_subject_sentences: w(sum(r => r.shape_out?.subject), sum(r => r.shape_out?.sentences)), expected_explicit_subject_sentences: w(sum(r => r.shape_expected?.subject), sum(r => r.shape_expected?.sentences))};
      summaries.push(summary);
      fs.writeFileSync(path.join(COMPOSED, `analysis__${run.name}__${run.kind}${run.dataset ? '-' + run.dataset : ''}__${run.mode}.json`), JSON.stringify({generated_at: new Date().toISOString(), summary, records}, null, 1) + '\n');
    }
  } finally { await lm.close(); }
  fs.writeFileSync(path.join(COMPOSED, 'analysis-summary.json'), JSON.stringify({generated_at: new Date().toISOString(), summaries}, null, 1) + '\n');
  console.log(JSON.stringify({runs: summaries.length}));
}

/** CPU speed through a llama-server started with -ngl 0 -t 4: per message wall time and the server's own generation speed. */
async function speed(split, url, n) {
  const rows = loadSplit(split).filter(r => r.prompt.length < 1200).slice(0, n), records = [];
  for (const r of rows) {
    const t0 = Date.now();
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: r.prompt}], temperature: 0, top_k: 1, seed: 0, cache_prompt: false, max_tokens: 1500})});
    const data = await res.json(), ms = Date.now() - t0;
    records.push({id: r.id, ms, prompt_tokens: data.usage?.prompt_tokens, out_tokens: data.usage?.completion_tokens, predicted_per_second: data.timings?.predicted_per_second ?? null, prompt_per_second: data.timings?.prompt_per_second ?? null});
  }
  const sorted = [...records].sort((a, b) => a.ms - b.ms), q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].ms;
  const tokens = records.reduce((a, r) => a + r.out_tokens, 0), seconds = records.reduce((a, r) => a + r.ms, 0) / 1000;
  const speeds = records.map(r => r.predicted_per_second).filter(Boolean).sort((a, b) => a - b);
  console.log(JSON.stringify({split, url, messages: records.length, ms_p50: q(0.5), ms_p90: q(0.9), ms_mean: Math.round(seconds * 1000 / records.length), out_tokens_mean: Math.round(tokens / records.length * 10) / 10, tokens_per_second_overall: Math.round(tokens / seconds * 10) / 10, generation_tokens_per_second_p50: speeds[Math.floor(speeds.length / 2)]}));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2), o = args(rest);
  if (command === 'inputs') writeJsonl(inputFile(o.split), loadSplit(o.split).map(r => ({id: r.id, text: r.prompt, ...(o.split === 'trainfit' ? {target: r.target, kind: r.kind} : {})})));
  else if (command === 'generate') await generate(o.split, o.name, o);
  else if (command === 'agree') agree(o.split, o.a, o.b, Number(o.n ?? 50));
  else if (command === 'prepare') await prepare(o.split, String(o.names).split(','));
  else if (command === 'score') await score(o.split, o.name);
  else if (command === 'remeaning') await remeaning();
  else if (command === 'meaning-prepare') meaningPrepare(o.split, String(o.names).split(','));
  else if (command === 'composed-prepare') await composedPrepare(o.names ? String(o.names).split(',') : null);
  else if (command === 'composed-meaning-prepare') await composedMeaningPrepare(o.names ? String(o.names).split(',') : null);
  else if (command === 'composed-score') await composedScore(o.names ? String(o.names).split(',') : null);
  else if (command === 'speed') await speed(o.split ?? 'dev', o.url, Number(o.n ?? 30));
  else if (command === 'compare') compare(o.split, o.a, o.b);
  else throw Error('usage: symbolic-proofing-eval.mjs inputs|generate|agree|prepare|score|compare ...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
