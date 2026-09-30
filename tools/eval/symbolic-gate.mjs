#!/usr/bin/env node
/** Judge runs and reports of the symbolic_english gate (experiments eval-symbolic-gate-v1, preregistered in
 * status/preregistrations/eval-symbolic-gate-v1.json, and eval-symbolic-accurate-adopt-v1).
 *
 *   node tools/eval/symbolic-gate.mjs judge [--condition c|b|both] [--limit N] [--parallel 8] [--budget 25]
 *   node tools/eval/symbolic-gate.mjs audit [--parallel 6] [--model claude-fable-5-1]
 *   node tools/eval/symbolic-gate.mjs report            # symbolic-gate-report.md/json
 *   node tools/eval/symbolic-gate.mjs inventory         # symbolic-forms-inventory.md
 *
 * `judge` reads the work lists written by the assemblers (text keys and sentence indexes), so the sealed suites are only
 * touched through the observations of the builders; `audit`, `report` and `inventory` read the built dataset files,
 * including the sealed test (this tool lives in tools/eval/ like the sealed suite builders). Verdicts are appended to
 * eval/reports/current/three-datasets/judge/*.jsonl; every paid call is in the ledger (cap 30 USD).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {loadCache, textKey, DEFAULT_ANALYSIS_DIR} from '../datasets/three-datasets/analysis.mjs';
import {loadAccurate, compareAnalyses} from '../datasets/three-datasets/accurate.mjs';
import {compareSentence} from '../../lib/symbolic-lm/uncertainty.mjs';
import {JUDGE_DIR, readWorklists, loadVerdicts, loadVerdictStores, verdictOf, isGood} from '../datasets/three-datasets/gate.mjs';
import {judgeUnit, Ledger, pool, HAIKU} from '../research/parse-judge.mjs';

const SEED = 20260930;
const STRONG = 'claude-fable-5-1';
const args = argv => { const o = {command: argv[0]}; for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
const rank = key => crypto.createHash('sha1').update(`${SEED}|${key}`).digest('hex');
const append = (name, lines) => { fs.mkdirSync(JUDGE_DIR, {recursive: true}); fs.appendFileSync(path.join(JUDGE_DIR, name), lines.map(l => JSON.stringify(l)).join('\n') + '\n'); };
const ledgerOf = budget => new Ledger(path.join(JUDGE_DIR, 'ledger.json'), Number(budget ?? 30));
const cacheDir = path.join(JUDGE_DIR, 'cache');
const read = (rel) => readJsonlShardedSync(path.join(ROOT, rel));

/** Every built row of symbolic_english, all splits. */
export const symbolicRows = () => ['datasets/symbolic_english/train.jsonl', 'datasets/symbolic_english/dev.jsonl', 'eval/suites/symbolic_english/test.jsonl'].flatMap(read);

/** Word objects of a compact sentence, the input of the parse judge. */
const wordsOf = tokens => tokens.map(([id, text, lemma, upos, head, deprel]) => ({id, text, lemma, upos, head, deprel}));
const unitOf = sentence => ({text: sentence.text, sentence: {words: wordsOf(sentence.tokens)}});

/** Wilson score interval. */
export function wilson(k, n, z = 1.96) {
  if (!n) return {p: null, lo: null, hi: null, k, n};
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return {p, lo: (c - m) / d, hi: (c + m) / d, k, n};
}

// ------------------------------------------------------------------ judge
/**
 * Accurate gate (experiment eval-symbolic-accurate-adopt-v1): condition c (then b for the sentences whose tree differs from
 * the default package's and that c accepts) on the current tree of every sentence of the no-gold rows of the work lists.
 * A sentence with identical default and current trees reuses the stored default-tree verdict (`gate-verdicts.jsonl`); every
 * new verdict goes to `gate-verdicts-accurate.jsonl`, every paid call to `ledger-accurate.json` (cap `--budget`, default 25 USD).
 * Sentences left without a verdict when the budget ends keep their row out of symbolic_english (flag pending_judge).
 */
async function judgeCommand(o) {
  const cache = loadCache(), defaults = loadCache(DEFAULT_ANALYSIS_DIR);
  const lists = readWorklists();
  if (!lists.length) throw Error('no work list: run the assemblers first');
  const keys = [...new Set(lists.flatMap(l => Object.keys(l.nogold ?? {})))].sort((a, b) => rank(a).localeCompare(rank(b)));
  const identicalOf = k => { const d = defaults.get(k)?.analysis?.sentences ?? [], c = cache.get(k)?.analysis?.sentences ?? []; return c.map((s, i) => Boolean(d[i]) && d.length === c.length && compareSentence(d[i].tokens, s.tokens) === 'identical'); };
  const ledger = new Ledger(path.join(JUDGE_DIR, 'ledger-accurate.json'), Number(o.budget ?? 25));
  const condition = o.condition ?? 'both';
  const run = async (name, collect) => {
    const stores = loadVerdictStores();
    const items = [];
    for (const k of keys) { const sentences = cache.get(k)?.analysis?.sentences ?? [], same = identicalOf(k); sentences.forEach((sentence, i) => { if (collect(stores, k, i, same[i])) items.push({k, i, sentence}); }); }
    const todo = o.limit ? items.slice(0, Number(o.limit)) : items;
    console.error(`${name}: ${items.length} sentence judgements, running ${todo.length}`);
    let n = 0, unusable = 0;
    await pool(todo, Number(o.parallel ?? 8), async item => {
      if (ledger.exceeded()) return;
      const r = await judgeUnit(unitOf(item.sentence), {condition: name, model: HAIKU, thinking: 2048, dir: cacheDir, ledger});
      if (r.error === 'budget exhausted') return;
      if (r.unusable) unusable++;
      append('gate-verdicts-accurate.jsonl', [{k: item.k, sentence: item.i, condition: name, model: HAIKU, verdict: r.verdict, note: r.note, cost_usd: r.cost_usd, cached: r.cached}]);
      if (++n % 50 === 0) process.stderr.write(`\r${name} ${n}/${todo.length} unusable ${unusable} ledger ${ledger.data.total_usd}`);
    });
    console.error(`\n${name} done ${n}, unusable ${unusable}, ledger total ${ledger.data.total_usd} USD`);
    return {n, unusable};
  };
  if (['c', 'both'].includes(condition)) await run('c', (stores, k, i, same) => verdictOf(stores, k, i, 'c', same) === undefined);
  if (['b', 'both'].includes(condition) && !ledger.exceeded()) await run('b', (stores, k, i, same) => !same && isGood(verdictOf(stores, k, i, 'c', same)) && verdictOf(stores, k, i, 'b', same) === undefined);
  if (ledger.exceeded()) console.error('BUDGET CAP REACHED: the remaining sentences stay without a verdict (pending_judge)');
}

// ------------------------------------------------------------------ audit
const ACCEPTED = new Set(['parsers_agree', 'judge_bc', 'parsers_agree_and_judge_bc']);
const SAMPLE_FILE = path.join(JUDGE_DIR, 'audit-sample.json');
/** Every built row of symbolic_english and neuro_english by text key (the frozen audit sample may include rows the tightened gate moved). */
export function rowsByKey() {
  const map = new Map();
  for (const rel of ['datasets/neuro_english/train.jsonl', 'datasets/neuro_english/dev.jsonl', 'eval/suites/neuro_english/test.jsonl']) for (const r of read(rel)) map.set(textKey(r.message), r);
  for (const r of symbolicRows()) map.set(textKey(r.message), r);
  return map;
}
/** The audit sample as recorded when it was drawn: {stratum: {size, keys}}; null before the first draw. */
export function frozenSample() {
  if (!fs.existsSync(SAMPLE_FILE)) return null;
  const {strata} = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const rows = rowsByKey();
  return Object.fromEntries(Object.entries(strata).map(([name, {size, keys}]) => [name, {size, rows: keys.map(k => rows.get(k)).filter(Boolean)}]));
}
/** Audit strata: accepted no-gold rows by route (5% capped at 120) and, to estimate the whole dataset, gold-matching rows by agreement class (deviation D1). */
export function auditStrata(rows, accurate = loadAccurate()) {
  const cache = loadCache();
  const pick = (list, n) => list.slice().sort((a, b) => rank(textKey(a.message)).localeCompare(rank(textKey(b.message)))).slice(0, n);
  const withSentences = rows.filter(r => r.analysis?.sentences?.length);
  const nogold = withSentences.filter(r => ACCEPTED.has(r.analysis_verified));
  const total = Math.min(120, Math.ceil(0.05 * nogold.length));
  const judged = nogold.filter(r => r.analysis_verified !== 'parsers_agree'), identical = nogold.filter(r => r.analysis_verified === 'parsers_agree');
  const nJudged = Math.min(judged.length, Math.max(Math.min(20, judged.length), Math.round(total * judged.length / Math.max(nogold.length, 1))));
  const gold = withSentences.filter(r => r.analysis_verified === 'gold_sop_match');
  const goldBy = cls => gold.filter(r => (r.verification?.stanza_default_accurate ?? compareAnalyses(cache.get(textKey(r.message))?.analysis, accurate.get(textKey(r.message)))?.row) === cls);
  const strata = {
    nogold_identical: {list: identical, n: total - nJudged}, nogold_judged: {list: judged, n: nJudged},
    gold_identical: {list: goldBy('identical'), n: 30}, gold_noncore_diff: {list: goldBy('noncore_diff'), n: 20}, gold_core_diff: {list: goldBy('core_diff'), n: 30},
  };
  return Object.fromEntries(Object.entries(strata).map(([name, {list, n}]) => [name, {size: list.length, rows: pick(list, n)}]));
}

async function auditCommand(o) {
  const model = o.model ?? STRONG;
  let strata = frozenSample();
  if (!strata) {
    strata = auditStrata(symbolicRows());
    fs.writeFileSync(SAMPLE_FILE, JSON.stringify({seed: SEED, note: 'audit sample of eval-symbolic-gate-v1, frozen when drawn (text keys only); strata sizes are the populations at that time', strata: Object.fromEntries(Object.entries(strata).map(([n, v]) => [n, {size: v.size, keys: v.rows.map(r => textKey(r.message))}]))}) + '\n');
  }
  const done = loadVerdicts('audit-verdicts.jsonl');
  const items = [];
  for (const rows of Object.values(strata)) for (const r of rows.rows) r.analysis.sentences.forEach((s, i) => { const k = textKey(r.message); if (!done.has(`${k}|${i}|a`)) items.push({k, i, sentence: s}); });
  console.error(`audit: ${items.length} sentences with ${model}`);
  const ledger = ledgerOf(o.budget);
  let n = 0;
  await pool(items, Number(o.parallel ?? 6), async item => {
    if (ledger.exceeded()) return;
    const r = await judgeUnit(unitOf(item.sentence), {condition: 'a', model, dir: cacheDir, ledger});
    if (r.error === 'budget exhausted') return;
    append('audit-verdicts.jsonl', [{k: item.k, sentence: item.i, condition: 'a', model, verdict: r.verdict, note: r.note, issues: r.issues, cost_usd: r.cost_usd}]);
    if (++n % 20 === 0) process.stderr.write(`\r${n}/${items.length} ledger ${ledger.data.total_usd}`);
  });
  console.error(`\ndone ${n}, ledger total ${ledger.data.total_usd} USD`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const o = args(process.argv.slice(2));
  const run = {judge: judgeCommand, audit: auditCommand}[o.command];
  const other = async () => { const m = await import('./symbolic-gate-report.mjs'); return m[o.command](o); };
  (run ?? other)(o).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
