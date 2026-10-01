#!/usr/bin/env node
/** Regression runner of the symbolic_english dataset (owner decision 2026-09-30, DS008 "Three datasets").
 *
 *   node tools/symbolic-regression.mjs [--split train,dev,test] [--limit N] [--jobs N] [--report file]
 *   node tools/symbolic-regression.mjs --update            # explicit re-baseline of rows that changed but did not fail
 *   node tools/symbolic-regression.mjs --update --accept-gold <row id>,<row id> --reason "<why the gold was wrong>"   # also re-baselines the named failing rows and replaces their gold (a bad gold; the reason is stored on the row)
 *   node tools/symbolic-regression.mjs --replay tests/fixtures/symbolic-english/sample.json   # recorded parses, no Stanza
 *   node tools/symbolic-regression.mjs record-fixture [--n 12]                                # re-records that fixture
 *   node tools/symbolic-regression.mjs record-parses [--device auto] [--out file]            # Stanza parses of every row, once
 *   node tools/symbolic-regression.mjs --replay eval/reports/current/symbolic-regression/parses.json   # rules only, seconds (with --update: re-baselines from the full parse cache of the current Stanza model)
 *
 * `--device auto|cuda|cpu` (default auto: the GPU only when it is free, lib/ud-to-sop/device.mjs). A rule change is checked fastest by replaying the recorded
 * parses of all rows (`record-parses` once per Stanza model, then `--replay <cache>`): the parser is not re-run, so any
 * difference comes from the rules. A parser or model change needs the live run.
 *
 * Re-runs SymbolicLM (`analyze(message, {route: 'direct', language: 'auto'})`, CPU) on every row of
 * datasets/symbolic_english/{train,dev}.jsonl and eval/suites/symbolic_english/test.jsonl and compares the grammatical
 * analysis and the SOP with the stored ones (lib/symbolic-lm/regression.mjs): same, analysis_changed_sop_same,
 * sop_changed_equivalent, sop_changed, now_failing. Exit code 1 when a row is `sop_changed` or `now_failing`. The
 * stored rows are the baseline: `--update` rewrites the analysis and SOP of the rows that changed without failing (and
 * their manifest hashes); rows that now fail are never re-baselined silently (rebuild the datasets instead).
 * The full run needs Stanza (about 0.6 s per row per worker); tests/symbolic-regression.test.mjs uses recorded parses.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../lib/jsonl-shards.mjs';
import {SymbolicLM, createSymbolicLM, stanzaModelId} from '../lib/symbolic-lm/index.mjs';
import {classifyRow, currentOf, emptyCounts, FAILING_CLASSES} from '../lib/symbolic-lm/regression.mjs';
import {hasGoldMatch} from './datasets/three-datasets/rows.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATASET = 'symbolic_english';
const splitFile = split => (split === 'test' ? `eval/suites/${DATASET}/test.jsonl` : `datasets/${DATASET}/${split}.jsonl`);
const REPORT_DIR = 'eval/reports/current/symbolic-regression';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { (out._ ??= []).push(argv[i]); continue; }
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

export function readRows(splits) {
  const rows = [];
  for (const split of splits) {
    const file = path.join(ROOT, splitFile(split));
    if (!jsonlExists(file)) continue;
    for (const row of readJsonlShardedSync(file)) rows.push(row);
  }
  return rows;
}

/** A SymbolicLM whose Stanza calls are answered from recorded parses (`parses['<language>|<masked text>']`). */
export function replayLm(parses, {full = false} = {}) {
  const worker = {start: async () => ({ready: true}), stop: async () => {}, request: async ({text, language}) => {
    const parse = parses[`${language ?? 'auto'}|${text}`];
    if (!parse) throw Error(`no recorded parse for ${language ?? 'auto'}|${text}`);
    return {parse, ms: 0};
  }};
  return new SymbolicLM(full ? {worker} : {worker, lexicons: {has: () => false, perMillion: () => 0}});
}

/** Run SymbolicLM on rows; returns {results: Map(id -> current)}. `options` are analyze() options. */
export async function runRows(rows, lm, options = {route: 'direct', language: 'auto'}, onProgress = null) {
  const results = new Map();
  for (const row of rows) {
    let now;
    try { now = currentOf(await lm.analyze(row.message, options)); }
    catch (error) { now = {sop: '', sop_valid: false, outcome: 'crash', unparsed: [], analysis: null, error: String(error.message ?? error).slice(0, 200)}; }
    results.set(row.id, now);
    if (onProgress && results.size % 50 === 0) onProgress(results.size, rows.length);
  }
  return results;
}

/** Source rows (with their verification world) of gold-verified rows whose SOP changed, keyed by row id. */
async function goldStillMatches(changed) {
  const {archived} = await import('../lib/dataset-paths.mjs');
  const {strictScores} = await import('./datasets/three-datasets/score.mjs');
  const wanted = new Map(changed.map(({row}) => [`${row.source.corpus}::${row.source.id}`, row]));
  const sources = {'formalizer-v1': [archived('formalizer-v1/train.jsonl'), archived('formalizer-v1/dev.jsonl'), 'eval/suites/formalizer-v1/test.jsonl'], 'formalizer-ood-v1': ['eval/suites/formalizer-ood-v1/test.jsonl'],
    'formalizer-wild-v1': ['eval/suites/formalizer-wild-v1/test.jsonl'], 'proofing-diverse-dev': [archived('proofing-diverse-dev/diverse-dev.jsonl')]};
  const records = [];
  for (const [corpus, files] of Object.entries(sources)) {
    const need = new Set([...wanted.keys()].filter(k => k.startsWith(corpus + '::')).map(k => k.slice(corpus.length + 2)));
    if (!need.size) continue;
    for (const file of files) for (const source of readJsonlShardedSync(path.join(ROOT, file))) if (need.has(source.id)) records.push({corpus, sourceId: source.id, wild: corpus === 'formalizer-wild-v1', row: source, message: source.question});
  }
  const byKey = new Map(changed.map(({row, now}) => [`${row.source.corpus}::${row.source.id}`, now.sop]));
  const {scoreAgainstAccepted} = await import('./eval/wild-suite.mjs'); // rows of the wild corpus are scored against their accepted golds
  const scores = await strictScores(records, r => byKey.get(`${r.corpus}::${r.sourceId}`), {wildScore: scoreAgainstAccepted});
  return new Map(changed.map(({row}) => [row.id, scores.get(`${row.source.corpus}::${row.source.id}`)?.ok ?? null]));
}

/** Classify all rows; gold-verified rows with a changed SOP are re-scored against their gold. */
export async function compareRows(rows, results, {rescoreGold = true} = {}) {
  let classes = new Map(rows.map(row => [row.id, classifyRow(row, results.get(row.id))]));
  if (rescoreGold) {
    const changed = rows.filter(row => hasGoldMatch(row) && ['sop_changed', 'now_failing'].includes(classes.get(row.id)) && results.get(row.id).sop_valid && results.get(row.id).sop !== row.sop)
      .map(row => ({row, now: results.get(row.id)}));
    if (changed.length) {
      const still = await goldStillMatches(changed);
      for (const {row} of changed) classes.set(row.id, classifyRow(row, results.get(row.id), {goldStillMatches: still.get(row.id)}));
    }
  }
  const counts = emptyCounts();
  for (const cls of classes.values()) counts[cls]++;
  return {classes, counts, failing: FAILING_CLASSES.some(cls => counts[cls] > 0)};
}

function runChildren(jobs, argv) {
  return Promise.all(Array.from({length: jobs}, (_, index) => new Promise((resolve, reject) => {
    const partial = path.join(ROOT, REPORT_DIR, `partial-${index}.json`);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv, '--shard', `${index}/${jobs}`, '--partial', partial], {stdio: ['ignore', 'inherit', 'inherit']});
    child.on('exit', code => (code === 0 || code === 1 ? resolve(partial) : reject(Error(`shard ${index} exited with ${code}`))));
  })));
}

function rewriteBaseline(rows, updates, splits, accepted = new Map()) {
  return (async () => {
    const {writeSplit, updateManifest} = await import('./datasets/three-datasets/write.mjs');
    const {codeHashes} = await import('./datasets/three-datasets/hashes.mjs');
    const parser = stanzaModelId();
    for (const split of splits) {
      const part = rows.filter(r => r.split === split).map(row => {
        const now = updates.get(row.id);
        if (!now) return row;
        const next = {...row, analysis: now.analysis, sop: now.sop, sop_valid: now.sop_valid, outcome: now.outcome, unparsed: now.unparsed, symbolic_lm: {...row.symbolic_lm, stanza: parser}};
        if (accepted.has(row.id)) Object.assign(next, {gold_sop: now.sop, gold_corrected: {previous_gold_sop: row.gold_sop ?? null, reason: accepted.get(row.id), at: new Date().toISOString()}});
        return next;
      });
      // the sealed test lives only under eval/suites (AGENTS.md rule 9): never write datasets/<name>/test.jsonl
      const written = await writeSplit(DATASET, split, part, split === 'test' ? {base: path.join(ROOT, splitFile('test'))} : undefined);
      const patch = {sha256: {[written.path]: written.sha256}, bytes: {[written.path]: written.bytes}, baseline_updated_at: new Date().toISOString(), symbolic_lm: {stanza: parser, code_sha256: codeHashes()}};
      updateManifest(DATASET, patch);
      if (split === 'test') {
        const file = path.join(ROOT, 'eval/suites', DATASET, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        Object.assign(manifest, {sha256: written.sha256, bytes: written.bytes, rows: written.rows, baseline_updated_at: patch.baseline_updated_at});
        fs.writeFileSync(file + '.tmp', JSON.stringify(manifest, null, 1) + '\n');
        fs.renameSync(file + '.tmp', file); // atomic (the audit page indexes files by byte range)
      }
    }
  })();
}

async function recordFixture(o) {
  const n = Number(o.n ?? 12);
  const {maskMessage} = await import('../lib/ud-to-sop/index.mjs');
  const all = readRows(['train']).filter(r => r.analysis_verified === 'analysis_gate' && hasGoldMatch(r) && maskMessage(r.message) === r.message); // rows whose analysis passed the gate and whose SOP matches the gold
  const step = Math.max(1, Math.floor(all.length / n));
  const rows = Array.from({length: n}, (_, i) => all[i * step]).filter(Boolean);
  const lm = await createSymbolicLM({device: 'cpu'});
  const parses = {};
  const request = lm.worker.request.bind(lm.worker);
  lm.worker.request = async payload => { const answer = await request(payload); parses[`${payload.language ?? 'auto'}|${payload.text}`] = answer.parse; return answer; };
  try { for (const row of rows) await lm.analyze(row.message, {route: 'direct', language: 'en'}); } finally { await lm.stop(); }
  const file = path.join(ROOT, 'tests/fixtures/symbolic-english/sample.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({note: 'Recorded by `node tools/symbolic-regression.mjs record-fixture`: symbolic_english train rows whose analysis passed the gate and whose SOP matches the gold SOP, and the Stanza parses of their messages, so the regression runner can be tested without Python.', stanza: stanzaModelId(), rows, parses}, null, 1) + '\n');
  console.log(`recorded ${rows.length} rows, ${Object.keys(parses).length} parses -> tests/fixtures/symbolic-english/sample.json`);
}

/** Records the Stanza parses of every row (the live run's options) into a cache that `--replay` reads. */
async function recordParses(o) {
  const rows = readRows(String(o.split ?? 'train,dev,test').split(','));
  const lm = await createSymbolicLM({device: o.device ?? 'auto', threads: Number(o.threads ?? 4)});
  const parses = {};
  const request = lm.worker.request.bind(lm.worker), parseMany = lm.worker.parseMany.bind(lm.worker);
  lm.worker.request = async payload => { const answer = await request(payload); parses[`${payload.language ?? 'auto'}|${payload.text}`] = answer.parse; return answer; };
  lm.worker.parseMany = async (texts, languages = []) => { const answer = await parseMany(texts, languages); texts.forEach((text, i) => { parses[`${languages[i] ?? 'auto'}|${text}`] = answer.parses[i]; }); return answer; };
  let done = 0;
  // Batches of 64 messages (`analyzeMany`): one GPU pass per batch instead of one request per message; same parses.
  try {
    for (let i = 0; i < rows.length; i += 64) {
      const chunk = rows.slice(i, i + 64).map(r => r.message);
      try { await lm.analyzeMany(chunk, {route: 'direct', language: 'auto'}); } catch { for (const m of chunk) { try { await lm.analyze(m, {route: 'direct', language: 'auto'}); } catch { /* the replay reports the crash */ } } }
      done += chunk.length;
      process.stderr.write(`\r${done}/${rows.length}`);
    }
  } finally { await lm.stop(); }
  const file = path.resolve(ROOT, o.out ?? path.join(REPORT_DIR, 'parses.json'));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({note: 'Stanza parses of every symbolic_english row, recorded by `node tools/symbolic-regression.mjs record-parses`; replay with --replay.', stanza: stanzaModelId(), device: o.device ?? 'auto', recorded_at: new Date().toISOString(), parses}) + '\n');
  console.log(`recorded ${Object.keys(parses).length} parses of ${rows.length} rows -> ${path.relative(ROOT, file)}`);
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o._?.[0] === 'record-fixture') return recordFixture(o);
  if (o._?.[0] === 'record-parses') return recordParses(o);
  const splits = String(o.split ?? 'train,dev,test').split(',');
  const jobs = Number(o.jobs ?? 1);
  const fixture = o.replay ? JSON.parse(fs.readFileSync(path.resolve(ROOT, o.replay), 'utf8')) : null;
  // a re-baseline from recorded parses is exact only for the full parse cache of the Stanza model in use (same parses as a live run)
  if (fixture && o.update && (fixture.rows || fixture.stanza !== stanzaModelId())) throw Error('--update with --replay needs the full parse cache (record-parses) recorded with the current Stanza model');
  if (o.update && (o.limit || o.shard)) throw Error('--update needs the full run (no --limit or --shard)');
  let rows = fixture?.rows ?? readRows(splits);
  if (o.limit) rows = rows.slice(0, Number(o.limit));
  if (jobs > 1 && !o.shard && !fixture) {
    const passthrough = process.argv.slice(2).filter((x, i, a) => !['--jobs', '--update', '--report', '--accept-gold', '--reason'].includes(x) && !['--jobs', '--report', '--accept-gold', '--reason'].includes(a[i - 1]));
    const partials = await runChildren(jobs, passthrough);
    const merged = {classes: {}, now: {}};
    for (const file of partials) { const part = JSON.parse(fs.readFileSync(file, 'utf8')); Object.assign(merged.classes, part.classes); Object.assign(merged.now, part.now); fs.unlinkSync(file); }
    return finish(rows, new Map(Object.entries(merged.classes)), new Map(Object.entries(merged.now).map(([id, now]) => [id, now])), o, splits);
  }
  if (o.shard) { const [i, n] = String(o.shard).split('/').map(Number); rows = rows.filter((_, index) => index % n === i); }
  const lm = fixture ? replayLm(fixture.parses, {full: !fixture.rows}) : await createSymbolicLM({device: o.device ?? 'auto', threads: Number(o.threads ?? 4)});
  let results;
  try { results = await runRows(rows, lm, fixture?.rows ? {route: 'direct', language: 'en'} : {route: 'direct', language: 'auto'}, (done, total) => process.stderr.write(`\r${done}/${total}`)); }
  finally { await lm.stop(); }
  const {classes} = await compareRows(rows, results);
  if (o.partial) {
    fs.mkdirSync(path.dirname(o.partial), {recursive: true});
    const changed = rows.filter(r => classes.get(r.id) !== 'same');
    fs.writeFileSync(o.partial, JSON.stringify({classes: Object.fromEntries(rows.map(r => [r.id, classes.get(r.id)])), now: Object.fromEntries(changed.map(r => [r.id, results.get(r.id)]))}));
    return;
  }
  return finish(rows, classes, results, o, splits);
}

async function finish(rows, classes, results, o, splits) {
  const counts = emptyCounts();
  for (const row of rows) counts[classes.get(row.id)]++;
  const failing = FAILING_CLASSES.some(cls => counts[cls] > 0);
  const listed = rows.filter(r => classes.get(r.id) !== 'same').map(r => ({id: r.id, split: r.split, class: classes.get(r.id), message: r.message, was: r.sop, now: results.get(r.id)?.sop ?? null, error: results.get(r.id)?.error ?? null}));
  const report = {generated_at: new Date().toISOString(), dataset: DATASET, rows: rows.length, counts, failing, stanza: stanzaModelId(), changed: listed.slice(0, 500), changed_total: listed.length};
  const file = path.resolve(ROOT, o.report ?? path.join(REPORT_DIR, o.replay ? 'report-replay.json' : 'report.json'));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify({rows: rows.length, counts, failing, report: path.relative(ROOT, file)}, null, 1));
  if (o.update) {
    const accepted = new Map(String(o['accept-gold'] ?? '').split(',').filter(Boolean).map(id => [id, o.reason]));
    if (accepted.size && (typeof o.reason !== 'string' || !o.reason)) throw Error('--accept-gold needs --reason "<why the gold was wrong>"');
    const wrong = [...accepted.keys()].filter(id => classes.get(id) !== 'now_failing' || !results.get(id)?.sop_valid);
    if (wrong.length) throw Error(`--accept-gold names rows that do not fail with a valid SOP: ${wrong.join(', ')}`);
    const updates = new Map(rows.filter(r => ['analysis_changed_sop_same', 'sop_changed_equivalent', 'sop_changed'].includes(classes.get(r.id)) || accepted.has(r.id)).map(r => [r.id, results.get(r.id)]));
    if (updates.size) { await rewriteBaseline(rows, updates, splits, accepted); console.log(`re-baselined ${updates.size} rows (${accepted.size} with a corrected gold)`); }
    if (counts.now_failing > accepted.size) { console.log(`${counts.now_failing} rows now fail and were NOT re-baselined: rebuild the datasets (node tools/datasets/build-three-datasets.mjs)`); process.exitCode = 1; }
    return;
  }
  if (failing) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
