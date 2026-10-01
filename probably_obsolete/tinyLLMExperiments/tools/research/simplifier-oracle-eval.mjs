#!/usr/bin/env node
/** Symbolic-path upper bound with an oracle simplifier (study "neural simplifier + symbolic NLP", DS022
 * "Simple-text rendering"): paired comparison of the UD → SOP baseline on the raw messages versus the oracle
 * simple text of the same rows.
 *
 *   node tools/research/simplifier-oracle-eval.mjs compare --suite test|ood|wild --stage N --dir eval/reports/current/simplifier/symbolic/work
 *
 * Reads `<suite>-raw-report-<tag>.json` and `<suite>-oracle-report-<tag>.json` (eval/run.mjs reports for test/OOD,
 * tools/eval/wild-suite.mjs reports for wild; tag = stage for test/OOD, `all` for wild), restricts both to the first
 * N ids of the stage order (`<suite>-stage<N>.ids.json`, or the whole sample), and prints per-metric means with a
 * paired bootstrap 95% interval of the difference (oracle − raw), 2000 resamples, fixed seed.
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const METRICS = {
  labelled: ['execution_equivalent_tolerant', 'canonical_match_tolerant', 'execution_equivalent', 'runtime_valid'],
  wild: ['accepted_match_tolerant', 'shape_match', 'decision_match', 'proposition_f1', 'query_f1'],
};

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function pairedBootstrap(a, b, { resamples = 2000, seed = 20260929 } = {}) {
  const n = a.length, d = a.map((x, i) => b[i] - x), random = rng(seed), means = [];
  for (let r = 0; r < resamples; r++) { let sum = 0; for (let i = 0; i < n; i++) sum += d[Math.floor(random() * n)]; means.push(sum / n); }
  means.sort((x, y) => x - y);
  const mean = d.reduce((s, x) => s + x, 0) / n;
  return { diff: +mean.toFixed(4), lo: +means[Math.floor(0.025 * resamples)].toFixed(4), hi: +means[Math.floor(0.975 * resamples) - 1].toFixed(4) };
}

export function compare({ suite, stage, dir }) {
  const wild = suite === 'wild';
  const tag = wild ? 'all' : String(stage);
  const load = condition => JSON.parse(fs.readFileSync(path.join(dir, `${suite}-${condition}-report-${tag}.json`), 'utf8')).records;
  const raw = new Map(load('raw').map(r => [r.id, r])), oracle = new Map(load('oracle').map(r => [r.id, r]));
  const idsFile = path.join(dir, `${suite}-stage${stage}.ids.json`);
  let ids = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, 'utf8')) : [...oracle.keys()];
  if (wild) { const order = fs.readFileSync(path.join(dir, 'wild-oracle-input.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l).id); ids = order.slice(0, Number(stage) || order.length); }
  ids = ids.filter(id => raw.has(id) && oracle.has(id));
  const out = { suite, stage: ids.length, metrics: {} };
  for (const metric of METRICS[wild ? 'wild' : 'labelled']) {
    const a = ids.map(id => Number(raw.get(id)[metric])), b = ids.map(id => Number(oracle.get(id)[metric]));
    const mean = list => +(list.reduce((s, x) => s + x, 0) / list.length).toFixed(4);
    out.metrics[metric] = { raw: mean(a), oracle: mean(b), ...pairedBootstrap(a, b) };
  }
  // Language slices of the primary metric.
  const primary = wild ? 'accepted_match_tolerant' : 'execution_equivalent_tolerant';
  out.by_language = {};
  for (const language of [...new Set(ids.map(id => raw.get(id).language))]) {
    const sub = ids.filter(id => raw.get(id).language === language);
    const a = sub.map(id => Number(raw.get(id)[primary])), b = sub.map(id => Number(oracle.get(id)[primary]));
    out.by_language[language] = { rows: sub.length, raw: +(a.reduce((s, x) => s + x, 0) / sub.length).toFixed(4), oracle: +(b.reduce((s, x) => s + x, 0) / sub.length).toFixed(4) };
  }
  return out;
}

if (process.argv[2] === 'compare') console.log(JSON.stringify(compare({ suite: arg('suite'), stage: arg('stage', 'all'), dir: arg('dir', 'eval/reports/current/simplifier/symbolic/work') }), null, 1));
