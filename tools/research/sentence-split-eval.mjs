#!/usr/bin/env node
/** Experiment eval-sentence-split-v1: formalize a message whole (S0), sentence by sentence (S1) or each sentence
 * together with the previous one (S2), and merge the per-sentence circuits on the host (lib/sentence-split.mjs).
 *
 * Inference only (llama.cpp `llama-server` on CPU, the request of lib/formalizer-endpoint.mjs: the text is the
 * only user turn, greedy decoding). Every model input is an exact substring of the user's message.
 *
 *   node tools/research/sentence-split-eval.mjs predict --set <dev-pilot|long|short|wild> --url <endpoint> --model <label> [--parallel 4]
 *     [--stage N] [--device <label>] [--ids file]   # nested stratified stage of N rows; device recorded per row
 *   node tools/research/sentence-split-score.mjs --model <label> --sets long,short,wild [--reps 2000]
 *
 * `predict` appends one record per row to eval/reports/current/sentence-split/work/<model>/<set>.calls.jsonl
 * (resumable): the S0 call, one S1 call per sentence unit and one S2 call per unit after the first (the slice of
 * the message from the previous unit's start to this unit's end). The calls of one row run in sequence inside one
 * worker, so the three conditions share the same load. A message with one unit reuses its S0 call for S1 and S2
 * (the same input text). `score` merges, writes `<set>.<condition>.predictions.jsonl`, evaluates (tolerant
 * execution through eval/run.mjs `evaluate`, DS016 wire F1, wild accepted/decision match and proposition F1) and
 * writes paired cluster-bootstrap deltas to `<model>/results.json`.
 *
 * Merge variants scored from the same calls:
 *   S1         each unit alone, merged;
 *   S2         the preregistered S2 variant (PREREGISTERED_S2: S2dedupe, fixed by the dev pilot);
 *   S2dedupe   unit 1 alone, then each pair output, identical wires dropped at merge;
 *   S2diff     unit 1 alone, then each pair output minus the previous unit's own S1 output (multiset of wire keys);
 *   S2hybrid   (exploratory) S1, except that a unit with an anaphora cue uses its pair output minus the previous
 *              unit's own output; only those pairs count in its latency.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {predictMessage} from '../../lib/formalizer-endpoint.mjs';
import {splitSentences, mergePrograms} from '../../lib/sentence-split.mjs';
import {sampleRows} from './predict-endpoint.mjs';
import {rowWireComparison} from '../../eval/metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = file => path.join(root, file);
export const REPORT_DIR = 'eval/reports/current/sentence-split';
const MAX_TOKENS_WHOLE = 6144, MAX_TOKENS_UNIT = 1024;
export const PREREGISTERED_S2 = 'S2dedupe'; // fixed by the dev pilot (higher pooled wire F1 than S2diff: 0.892 vs 0.842)

// Anaphora and ellipsis cues (EN, RO) that send a unit to its pair call in the exploratory S2hybrid.
const ANAPHORA = /(?<![\p{L}\p{N}])(he|she|it|they|him|her|them|his|hers|its|their|theirs|this|these|those|the same|such|el|ea|ei|ele|îl|il|îi|ii|acesta|aceasta|acestea|aceștia|acela|aceea|acolo|la fel|dânsul|dânsa)(?![\p{L}\p{N}])/iu;

const readJsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
function languageSlice(row) { return row.language === 'mixed' || row.code_switch ? 'mixed' : row.language; }

/** The rows of a named set (deterministic). */
export function rowsOf(set) {
  const test = () => readJsonlShardedSync(at('eval/suites/formalizer-v1/test.jsonl')).map(row => ({...row, suite: 'formalizer-v1'}));
  const ood = () => readJsonlShardedSync(at('eval/suites/formalizer-ood-v1/test.jsonl')).map(row => ({...row, suite: 'formalizer-ood-v1'}));
  const multiShort = rows => rows.filter(row => row.family !== 'long_message' && splitSentences(row.question).length >= 2);
  const stratified = (rows, count, seed) => {
    const strata = new Map();
    for (const row of rows) { const key = `${row.language}|${row.code_switch ? 'cs' : 'plain'}`; if (!strata.has(key)) strata.set(key, []); strata.get(key).push(row); }
    const keys = [...strata.keys()].sort();
    const quotas = keys.map(key => Math.floor(count * strata.get(key).length / rows.length));
    let rest = count - quotas.reduce((a, b) => a + b, 0);
    keys.map((key, i) => [i, count * strata.get(key).length / rows.length - quotas[i]]).sort((a, b) => b[1] - a[1]).slice(0, rest).forEach(([i]) => quotas[i]++);
    return keys.flatMap((key, i) => sampleRows(strata.get(key), quotas[i], seed));
  };
  if (set === 'long') return test().filter(row => row.family === 'long_message');
  if (set === 'short') return [...stratified(multiShort(test()), 200, 42), ...stratified(multiShort(ood()), 200, 42)];
  if (set === 'wild') return readJsonlShardedSync(at('eval/suites/formalizer-wild-v1/test.jsonl')).map(row => ({...row, suite: 'formalizer-wild-v1'}));
  if (set === 'dev-pilot') {
    const dev = readJsonlShardedSync(at('datasets_archive/formalizer-v1/dev.jsonl')).map(row => ({...row, suite: 'formalizer-v1-dev'}));
    return [...sampleRows(dev.filter(row => row.family === 'long_message'), 20, 7), ...sampleRows(multiShort(dev), 100, 7)];
  }
  throw Error(`Unknown set ${set}`);
}

/** The model inputs of one message: the whole message, the units and the pairs (exact message slices). */
export function inputsOf(message) {
  const units = splitSentences(message);
  return {units, pairs: units.slice(1).map((unit, i) => message.slice(units[i].start, unit.end))};
}

async function call(url, text, maxTokens) {
  try {
    const r = await predictMessage(url, text, {maxTokens});
    return {text: r.text, ms: r.ms, finish: r.finish, completion_tokens: r.usage?.completion_tokens ?? null};
  } catch (error) { return {text: '', ms: null, error: error.message}; }
}

/** Nested stratified stage of a set (owner rule of 2026-09-29: evaluate in stages, stop when the answer is clear).
 * Rows get a seeded rank (mulberry32 over the shuffled index); a stage of N takes, per language stratum, the
 * lowest-ranked rows in proportion to the stratum, so a larger stage contains the smaller one. */
export function stageRows(rows, count) {
  if (!count || count >= rows.length) return rows;
  const ranked = sampleRows(rows, rows.length, 42);
  let state = 42 >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rank = new Map(ranked.map(row => [row.id, random()]));
  const strata = new Map();
  for (const row of rows) { const key = `${row.suite}|${languageSlice(row)}`; if (!strata.has(key)) strata.set(key, []); strata.get(key).push(row); }
  const keep = new Set();
  for (const list of strata.values()) list.sort((a, b) => rank.get(a.id) - rank.get(b.id)).slice(0, Math.round(count * list.length / rows.length)).forEach(row => keep.add(row.id));
  return rows.filter(row => keep.has(row.id));
}

async function predict({set, url, model, parallel = 4, stage = 0, device = 'unspecified', ids = null}) {
  const dir = at(`${REPORT_DIR}/work/${model}`);
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `${set}.calls.jsonl`);
  const done = new Set(readJsonl(file).map(record => record.id));
  const only = ids ? new Set(fs.readFileSync(ids, 'utf8').split(/\s+/).filter(Boolean)) : null;
  const rows = stageRows(rowsOf(set), Number(stage)).filter(row => !done.has(row.id) && (!only || only.has(row.id)));
  let next = 0, finished = 0;
  const started = performance.now();
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      const {units, pairs} = inputsOf(row.question);
      const s0 = await call(url, row.question, MAX_TOKENS_WHOLE);
      const s1 = units.length > 1 ? [] : [{...s0, reused: 'S0'}];
      if (units.length > 1) for (const unit of units) s1.push(await call(url, unit.text, MAX_TOKENS_UNIT));
      const s2 = [];
      for (const pair of pairs) s2.push(await call(url, pair, MAX_TOKENS_UNIT));
      fs.appendFileSync(file, JSON.stringify({id: row.id, device, units: units.map(u => u.text), pairs, S0: s0, S1: s1, S2: s2}) + '\n');
      if (++finished % 25 === 0) console.log(`${set} ${finished}/${rows.length} rows, ${((performance.now() - started) / 1000).toFixed(0)} s`);
    }
  }
  await Promise.all(Array.from({length: parallel}, worker));
  console.log(`${set}: ${finished} rows predicted in ${((performance.now() - started) / 1000).toFixed(0)} s`);
}

const sum = values => values.reduce((a, b) => a + (b ?? 0), 0);
/** Merged predictions and per-row latency (sum of the calls a condition needs) of one calls record. */
export function conditionsOf(record) {
  const s1 = record.S1.map(c => c.text), s2 = record.S2.map(c => c.text);
  const single = record.units.length <= 1;
  const out = {};
  out.S0 = {sop: record.S0.text, ms: record.S0.ms, calls: 1, stats: null};
  if (single) {
    for (const name of ['S1', 'S2dedupe', 'S2diff', 'S2hybrid']) out[name] = {...out.S0, calls: 1};
  } else {
    const s1ms = sum(record.S1.map(c => c.ms)), s2ms = sum(record.S2.map(c => c.ms));
    let merged = mergePrograms(s1.map(text => ({text})));
    out.S1 = {sop: merged.sop, ms: s1ms, calls: s1.length, stats: merged.stats};
    merged = mergePrograms([{text: s1[0]}, ...s2.map(text => ({text}))]);
    out.S2dedupe = {sop: merged.sop, ms: record.S1[0].ms + s2ms, calls: 1 + s2.length, stats: merged.stats};
    merged = mergePrograms([{text: s1[0]}, ...s2.map((text, i) => ({text, exclude: [s1[i]]}))]);
    out.S2diff = {sop: merged.sop, ms: sum(record.S1.slice(0, -1).map(c => c.ms)) + s2ms, calls: s1.length - 1 + s2.length, stats: merged.stats};
    const cue = record.units.map((unit, i) => i > 0 && ANAPHORA.test(unit));
    merged = mergePrograms(s1.map((text, i) => cue[i] ? {text: s2[i - 1], exclude: [s1[i - 1]]} : {text}));
    out.S2hybrid = {sop: merged.sop, ms: sum(record.S1.map((c, i) => cue[i] ? 0 : c.ms)) + sum(record.S2.map((c, i) => cue[i + 1] ? c.ms : 0)) + sum(record.S1.map((c, i) => cue[i + 1] && cue[i] ? c.ms : 0)),
      calls: cue.filter(x => !x).length + 2 * cue.filter(Boolean).length - cue.filter((x, i) => x && !cue[i - 1] ).length, stats: {...merged.stats, pair_units: cue.filter(Boolean).length}};
  }
  out.S2 = out[PREREGISTERED_S2];
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...rest] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, '')] = rest[i + 1];
  if (command === 'predict') await predict({...options, parallel: Number(options.parallel ?? 4)});
  else { console.error('usage: sentence-split-eval.mjs predict --set <set> --url <url> --model <label>   (scoring: node tools/research/sentence-split-score.mjs)'); process.exitCode = 2; }
}
export {rowWireComparison, languageSlice};
