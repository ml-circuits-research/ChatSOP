#!/usr/bin/env node
/** Experiment `eval-spellfix-preproc-v1` (status/preregistrations/eval-spellfix-preproc-v1.json): measures the
 * spelling-correction pre-step (`lib/languages-util/spellfix.mjs`, moved from `lib/spellfix.mjs` on 2026-09-29 into
 * the LanguagesUtil component) and builds the spellfixed condition for the formalizer.
 *
 *   quality  --suite S --out report.json [--log changes.jsonl]
 *       Corrector quality against the generator's noise records (DS022): word-level operations carry the clean
 *       word (`from`) and the noisy one (`to`), so a change is exact when it maps `to` back to `from`. Clean rows
 *       (no noise) measure damage. A synthetic diacritic test strips the diacritics of clean Romanian rows
 *       (names kept) and checks their restoration token by token. Reports the corrector's latency per message.
 *   apply    --suite S --out changed-suite.jsonl --log changes.jsonl
 *       Writes only the rows whose message the corrector changes, with `question` replaced (evaluation copy;
 *       the model still sees exactly one message). Unchanged rows keep their raw-condition prediction.
 *   merge    --raw raw.predictions.jsonl --changed changed.predictions.jsonl --out spellfixed.predictions.jsonl
 *   compare  --raw evaluation.json --fixed evaluation.json --suite S --out comparison.json [--changed changed-suite.jsonl] [--mode wild]
 *       Paired per-slice deltas (noise level x language, clean/noisy, changed/unchanged) of tolerant execution
 *       equivalence, canonical match and parse (wild: accepted-gold match, decision match, proposition F1), with a
 *       paired cluster-bootstrap 95% interval (clusters = semantic cases; 10,000 resamples, seed 7) and an exact McNemar test.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {loadSpellfix, SPELLFIX_VERSION, DEFAULTS} from '../../lib/languages-util/spellfix.mjs';
import {foldDiacritics} from '../../lib/languages-util/spellfix/keyboard.mjs';

const WORD_OPS = new Set(['typo', 'dictation', 'autocorrect', 'sms', 'space_merge', 'space_split', 'phonetic']);
const DIACRITIC_OPS = new Set(['diacritic_drop', 'diacritic_wrong', 'diacritic_cedilla', 'strip_diacritics', 'strip_diacritics_partial', 'phonetic']);

function args(argv) {
  const out = {_: argv[0]};
  for (let i = 1; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw Error(`Bad option ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const languageSlice = row => (row.code_switch ? 'mixed' : row.language);
const noiseSlice = row => row.noise_level ?? 'none';
const ratio = (n, d) => ({numerator: n, denominator: d, value: d ? n / d : null});
function quantiles(values) {
  const s = [...values].sort((a, b) => a - b), at = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {count: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s.at(-1)};
}

/** Word-level noise targets of a row: the noisy surface and the clean word it replaced. */
function wordTargets(row) {
  return (row.noise ?? []).filter(op => WORD_OPS.has(op.op) && typeof op.from === 'string' && typeof op.to === 'string' &&
    /[\p{L}]{2,}/u.test(op.from) && /[\p{L}]{2,}/u.test(op.to)).map(op => ({op, noisy: op.to.toLowerCase(), clean: op.from.toLowerCase(), hit: false}));
}

/** Diacritic folding for matching only: â and î are one letter apart in the noise model (phonetic â/î). */
const fold = word => foldDiacritics(word).replace(/ş/g, 's').replace(/ţ/g, 't');
const looseEqual = (x, y) => fold(x) === fold(y) || fold(x.replace(/â/g, 'î')) === fold(y.replace(/â/g, 'î'));
function undoesInside(op, from, to) {
  if (typeof op.from !== 'string' || typeof op.to !== 'string' || op.from === op.to) return false;
  const noisy = op.to.toLowerCase(), clean = op.from.toLowerCase();
  if (!noisy) return false;
  for (let i = from.indexOf(noisy); i >= 0; i = from.indexOf(noisy, i + 1)) {
    if (from.slice(0, i) + clean + from.slice(i + noisy.length) === to) return true;
  }
  return false;
}

function stripDiacriticsKeepNames(text) {
  return text.replace(/\S+/gu, chunk => (/^[^\p{L}]*\p{Lu}/u.test(chunk) ? chunk : foldDiacritics(chunk).replace(/ş/g, 's').replace(/ţ/g, 't')));
}

export function quality(spell, rows, logFile) {
  const log = logFile ? fs.openSync(logFile, 'w') : null;
  const ms = [], byOp = {}, bySlice = {};
  const totals = {changes: 0, exact: 0, partial: 0, diacritic_unverified: 0, false_positive: 0, clean_rows: 0, clean_rows_changed: 0, clean_changes: 0, clean_tokens: 0,
    targets: 0, targets_nonword: 0, targets_hit: 0, targets_nonword_hit: 0, targets_realword: 0, targets_realword_hit: 0};
  const slice = key => (bySlice[key] ??= {rows: 0, rows_changed: 0, changes: 0, exact: 0, partial: 0, diacritic_unverified: 0, false_positive: 0, targets: 0, targets_hit: 0});
  const examples = {exact: [], partial: [], false_positive: [], missed_nonword: []};
  for (const row of rows) {
    const result = spell.fix(row.question);
    ms.push(result.ms);
    const targets = wordTargets(row);
    const diacriticNoise = (row.noise ?? []).some(op => DIACRITIC_OPS.has(op.op));
    const s = slice(`${noiseSlice(row)}|${languageSlice(row)}`);
    s.rows++; if (result.changes.length) s.rows_changed++;
    const verdicts = [];
    for (const change of result.changes) {
      const from = change.from.toLowerCase(), to = change.to.toLowerCase();
      const target = targets.find(t => !t.hit && t.noisy === from && t.clean === to);
      // Partial: right word, diacritics not (both) restored, or the noisy word was later stripped of diacritics too.
      const partial = targets.find(t => !t.hit && looseEqual(t.noisy, from) && looseEqual(t.clean, to));
      let verdict;
      if (target) { target.hit = true; verdict = 'exact'; }
      // An operation applied inside a longer word (the generator also replaces substrings, e.g. dictation "că"->"ca"
      // inside "călătorește"): undoing it at one position reproduces the change.
      else if ((row.noise ?? []).some(op => undoesInside(op, from, to))) verdict = 'exact';
      else if (partial) { partial.hit = true; verdict = 'partial'; }
      else if (diacriticNoise && looseEqual(from, to)) verdict = 'diacritic_unverified';
      else verdict = 'false_positive';
      totals.changes++; totals[verdict]++; s.changes++; s[verdict]++;
      verdicts.push({...change, verdict});
      if (examples[verdict]?.length < 25) examples[verdict].push({id: row.id, from: change.from, to: change.to, kind: change.kind, noise: row.noise});
    }
    for (const t of targets) {
      const nonword = !spell.known(t.noisy.replace(/\s+/g, '')) || t.noisy.includes(' ');
      const k = `${t.op.op}${t.op.kind ? ':' + t.op.kind : ''}`;
      const o = (byOp[k] ??= {targets: 0, hit: 0, nonword: 0, nonword_hit: 0});
      o.targets++; totals.targets++; s.targets++;
      if (t.hit) { o.hit++; totals.targets_hit++; s.targets_hit++; }
      if (nonword) { o.nonword++; totals.targets_nonword++; if (t.hit) { o.nonword_hit++; totals.targets_nonword_hit++; } else if (examples.missed_nonword.length < 25) examples.missed_nonword.push({id: row.id, noisy: t.noisy, clean: t.clean, op: t.op.op}); }
      else { totals.targets_realword++; if (t.hit) totals.targets_realword_hit++; }
    }
    if (!row.noise_level) {
      totals.clean_rows++; totals.clean_tokens += row.question.split(/\s+/).filter(Boolean).length;
      if (result.changes.length) totals.clean_rows_changed++;
      totals.clean_changes += result.changes.length;
    }
    if (log && result.changes.length) fs.writeSync(log, JSON.stringify({id: row.id, noise_level: row.noise_level ?? null, language: languageSlice(row), changes: verdicts}) + '\n');
  }
  if (log) fs.closeSync(log);
  // Synthetic diacritic restoration on clean Romanian rows (names and capitalized words keep their diacritics).
  const synth = {rows: 0, tokens_stripped: 0, restored_exact: 0, changed_wrong: 0, changes: 0, rows_token_count_changed: 0};
  for (const row of rows.filter(r => !r.noise_level && !r.code_switch && r.language === 'ro')) {
    const stripped = stripDiacriticsKeepNames(row.question);
    if (stripped === row.question) continue;
    synth.rows++;
    const fixed = spell.fix(stripped).text;
    const a = row.question.split(/(\s+)/), b = stripped.split(/(\s+)/), c = fixed.split(/(\s+)/);
    if (a.length !== c.length) { synth.rows_token_count_changed++; continue; }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) { synth.tokens_stripped++; if (c[i] === a[i]) synth.restored_exact++; }
      if (c[i] !== b[i]) { synth.changes++; if (c[i] !== a[i]) synth.changed_wrong++; }
    }
  }
  return {
    format: 'chatsop-spellfix-quality-v1', corrector: SPELLFIX_VERSION, parameters: DEFAULTS, rows: rows.length,
    precision_exact: ratio(totals.exact, totals.changes),
    precision_lower_bound_note: 'diacritic changes on rows whose noise record is character-level cannot be matched to a clean word; they are counted separately (neither correct nor false positive).',
    precision_verifiable: ratio(totals.exact, totals.exact + totals.partial + totals.false_positive),
    precision_verifiable_with_partial: ratio(totals.exact + totals.partial, totals.exact + totals.partial + totals.false_positive),
    recall_all_word_ops: ratio(totals.targets_hit, totals.targets),
    recall_nonword_ops: ratio(totals.targets_nonword_hit, totals.targets_nonword),
    recall_realword_ops: ratio(totals.targets_realword_hit, totals.targets_realword),
    damage_clean_rows: ratio(totals.clean_rows_changed, totals.clean_rows),
    damage_changes_per_1000_tokens: totals.clean_tokens ? 1000 * totals.clean_changes / totals.clean_tokens : null,
    totals, by_operation: byOp, by_slice: bySlice,
    synthetic_diacritics: {...synth, recall: ratio(synth.restored_exact, synth.tokens_stripped), precision: ratio(synth.changes - synth.changed_wrong, synth.changes)},
    latency_ms: quantiles(ms), examples,
  };
}

/** Paired cluster bootstrap of the mean delta: clusters (semantic cases, DS010) are resampled with replacement. */
export function bootstrap(clusters, reps = 10000, seed = 7) {
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = clusters.length, deltas = [];
  if (!n) return null;
  const sums = clusters.map(pairs => [pairs.reduce((a, p) => a + p[1] - p[0], 0), pairs.length]);
  for (let r = 0; r < reps; r++) {
    let d = 0, m = 0;
    for (let i = 0; i < n; i++) { const [sum, count] = sums[Math.floor(random() * n)]; d += sum; m += count; }
    deltas.push(d / m);
  }
  deltas.sort((a, b) => a - b);
  return [deltas[Math.floor(0.025 * reps)], deltas[Math.floor(0.975 * reps)]];
}
export function mcnemar(b, c) { // exact two-sided binomial test on discordant pairs
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  let logC = 0, p = 0;
  for (let i = 0; i <= n; i++) { if (i > 0) logC += Math.log((n - i + 1) / i); if (i <= k) p += Math.exp(logC - n * Math.LN2); }
  return Math.min(1, 2 * p);
}
/** Per-slice paired deltas. `value(record)` is a number in [0, 1]; `keys(row)` lists the slices of a row. */
function paired(recordsRaw, recordsFixed, rows, value, keys, cluster) {
  const fixedById = new Map(recordsFixed.map(r => [r.id, r]));
  const rowById = new Map(rows.map(r => [r.id, r]));
  const groups = {};
  for (const raw of recordsRaw) {
    const fixed = fixedById.get(raw.id), row = rowById.get(raw.id);
    if (!fixed || !row) continue;
    const pair = [Number(value(raw) ?? 0), Number(value(fixed) ?? 0)];
    for (const key of keys(row)) ((groups[key] ??= new Map()).get(cluster(row)) ?? groups[key].set(cluster(row), []).get(cluster(row))).push(pair);
  }
  const out = {};
  for (const [key, clusterMap] of Object.entries(groups).sort()) {
    const clusters = [...clusterMap.values()], pairs = clusters.flat();
    const raw = pairs.reduce((a, p) => a + p[0], 0), fixed = pairs.reduce((a, p) => a + p[1], 0);
    const b = pairs.filter(p => p[0] > p[1]).length, c = pairs.filter(p => p[1] > p[0]).length;
    out[key] = {rows: pairs.length, clusters: clusters.length, raw: raw / pairs.length, spellfixed: fixed / pairs.length, delta: (fixed - raw) / pairs.length,
      ci95: bootstrap(clusters), helped: c, hurt: b, mcnemar_p: mcnemar(b, c)};
  }
  return out;
}
const suiteKeys = row => ['all', `noise:${noiseSlice(row)}`, `language:${languageSlice(row)}`, `noise:${noiseSlice(row)}|language:${languageSlice(row)}`,
  row.noise_level ? 'noisy' : 'clean', `${row.noise_level ? 'noisy' : 'clean'}|language:${languageSlice(row)}`, `length:${row.question.length > 300 ? 'long' : 'short'}`];

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  if (a._ === 'quality' || a._ === 'apply') {
    const rows = readJsonlShardedSync(a.suite);
    const started = performance.now();
    const spell = loadSpellfix();
    const loadSeconds = (performance.now() - started) / 1000;
    if (a._ === 'quality') {
      const report = {...quality(spell, rows, a.log), suite: a.suite, load_seconds: loadSeconds};
      fs.mkdirSync(path.dirname(path.resolve(a.out)), {recursive: true});
      fs.writeFileSync(a.out, JSON.stringify(report, null, 2) + '\n');
      const pick = k => report[k].value?.toFixed(4);
      console.log(JSON.stringify({rows: rows.length, precision_exact: pick('precision_exact'), precision_verifiable: pick('precision_verifiable'), recall_nonword: pick('recall_nonword_ops'),
        recall_all: pick('recall_all_word_ops'), damage_rows: pick('damage_clean_rows'), damage_per_1000: report.damage_changes_per_1000_tokens?.toFixed(3),
        changes: report.totals.changes, exact: report.totals.exact, diacritic_unverified: report.totals.diacritic_unverified, fp: report.totals.false_positive,
        synth: report.synthetic_diacritics, latency_p50: report.latency_ms.p50.toFixed(3), latency_p99: report.latency_ms.p99.toFixed(3)}));
      return;
    }
    const out = [], log = [];
    for (const row of rows) {
      const result = spell.fix(row.question);
      if (!result.changes.length) continue;
      out.push({...row, question: result.text, question_raw: row.question});
      log.push({id: row.id, raw: row.question, fixed: result.text, changes: result.changes});
    }
    fs.mkdirSync(path.dirname(path.resolve(a.out)), {recursive: true});
    fs.writeFileSync(a.out, out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
    if (a.log) fs.writeFileSync(a.log, log.map(r => JSON.stringify(r)).join('\n') + (log.length ? '\n' : ''));
    console.log(JSON.stringify({suite: a.suite, rows: rows.length, changed: out.length}));
    return;
  }
  if (a._ === 'merge') {
    const changed = new Map(readJsonl(a.changed).map(r => [r.id, r]));
    const merged = readJsonl(a.raw).map(r => changed.get(r.id) ?? r);
    fs.mkdirSync(path.dirname(path.resolve(a.out)), {recursive: true});
    fs.writeFileSync(a.out, merged.map(r => JSON.stringify({id: r.id, sop: r.sop})).join('\n') + '\n');
    console.log(JSON.stringify({rows: merged.length, replaced: changed.size}));
    return;
  }
  if (a._ === 'compare') {
    const raw = JSON.parse(fs.readFileSync(a.raw, 'utf8')).records, fixed = JSON.parse(fs.readFileSync(a.fixed, 'utf8')).records;
    const rows = readJsonlShardedSync(a.suite);
    const changedIds = a.changed ? new Set(readJsonl(a.changed).map(r => r.id)) : null;
    const wild = a.mode === 'wild';
    const keys = row => [...(wild ? ['all', `language:${row.language}`] : suiteKeys(row)),
      ...(changedIds ? [changedIds.has(row.id) ? 'changed_by_spellfix' : 'unchanged_by_spellfix'] : [])];
    const cluster = row => row.semantic_case_id ?? row.id;
    const metrics = wild
      ? {accepted_match: r => r.accepted_match, decision_match: r => r.decision_match, proposition_f1: r => r.proposition_f1, parsed: r => (r.parsed ? 1 : 0)}
      : {tolerant_execution_equivalence: r => r.execution_equivalent_tolerant, canonical_match: r => r.canonical_match, parse: r => r.syntax_valid};
    const report = {format: 'chatsop-spellfix-comparison-v1', suite: a.suite, raw: a.raw, spellfixed: a.fixed, rows: rows.length,
      interval: 'paired cluster bootstrap by semantic_case_id (row id when absent), 10,000 resamples, seed 7; McNemar exact on rows',
      metrics: Object.fromEntries(Object.entries(metrics).map(([name, fn]) => [name, paired(raw, fixed, rows, r => (typeof fn(r) === 'boolean' ? (fn(r) ? 1 : 0) : fn(r)), keys, cluster)]))};
    fs.mkdirSync(path.dirname(path.resolve(a.out)), {recursive: true});
    fs.writeFileSync(a.out, JSON.stringify(report, null, 2) + '\n');
    const t = Object.values(report.metrics)[0];
    for (const key of Object.keys(t)) if (!key.includes('|')) console.log(key.padEnd(24), String(t[key].rows).padStart(5), t[key].raw.toFixed(4), t[key].spellfixed.toFixed(4), t[key].delta.toFixed(4), t[key].ci95?.map(x => x.toFixed(4)).join('..'), `+${t[key].helped}/-${t[key].hurt}`, t[key].mcnemar_p.toFixed(4));
    return;
  }
  throw Error('Usage: spellfix-eval.mjs quality|apply|merge|compare ...');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
