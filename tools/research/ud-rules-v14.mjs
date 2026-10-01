#!/usr/bin/env node
/** Experiment eval-ud-rules-v14-v1: rules ud-rules-v1.4 against v1.3 on a fresh held-out sample, strict and host-normalized.
 *
 *   node tools/research/ud-rules-v14.mjs sample                              # fresh stratified sample (before any v1.4 change)
 *   node tools/research/ud-rules-v14.mjs convert --rules v1.3|v1.4 [--dir <frozen rules dir>] [--stage 150|300|full]
 *   node tools/research/ud-rules-v14.mjs compare [--stage 150|300|full]      # paired v1.4 - v1.3, strict and host-normalized
 *   node tools/research/ud-rules-v14.mjs dev --rules <label> [--dir <dir>] [--n 400]   # development score on formalizer-v1 dev
 *   node tools/research/ud-rules-v14.mjs frames-misses                       # Q-SYM-2: host normalization on the 146 Layer-2 misses
 *
 * Preregistration: status/preregistrations/eval-ud-rules-v14-v1.json. Stanza runs on the CPU only (another agent
 * owns the GPU). The fresh sample excludes every row of the consumed eval-symbolic-layers-en-v1 sample and every
 * surface variant of its semantic cases. Outputs: eval/reports/history/ud-rules-v14/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {mulberry, stages, tolerantScores, goldsOf} from './ud-baseline-eval.mjs';
import {bootstrap} from './spellfix-eval.mjs';
import {QGROUP, lengthBucket} from './symbolic-layers.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = path.join(ROOT, 'eval/reports/history/ud-rules-v14');
const SUITES = {test: 'eval/suites/formalizer-v1/test.jsonl', ood: 'eval/suites/formalizer-ood-v1/test.jsonl', wild: 'eval/suites/formalizer-wild-v1/test.jsonl'};
const QUOTA = {test: 240, ood: 180, wild: 180};
const STAGES = [150, 300];
const SEED = 20260930;
const CONSUMED = 'eval/reports/current/symbolic-layers/sample.json';

const sha = text => createHash('sha256').update(text).digest('hex');
export const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
export const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
export const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function argumentsOf(argv) {
  const [command, ...rest] = argv; const args = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); args[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return args;
}
const clusterOf = row => row.semantic_case_id ?? row.id;

// ------------------------------------------------------------------ sample

/** Stratum of a row: source x language x question-type group x length. */
const stratum = (source, row) => [source, row.language, QGROUP[row.question_type] ?? 'other', lengthBucket(row.question)].join('|');

function sampleCommand() {
  const file = path.join(OUT, 'sample.json');
  if (fs.existsSync(file)) throw Error('sample.json exists: the fresh sample is drawn once (delete it only to abandon the experiment)');
  const consumed = readJson(path.join(ROOT, CONSUMED)).items;
  const consumedIds = new Set(consumed.map(item => item.id));
  const random = mulberry(SEED);
  const out = {seed: SEED, drawn_at: new Date().toISOString(), rules_at_draw: 'ud-rules-v1.3 (lib/ud-to-sop identical to frozen-rules-v1.3)',
    method: 'per source: every language, one row per semantic case, excluding the consumed eval-symbolic-layers-en-v1 sample (ids and semantic cases); strata source x language x question-type group x length; proportional largest-remainder allocation with at least 1 per non-empty stratum; nested stages 150 and 300 drawn from the sample by the same strata (seed 42)', sources: {}, items: []};
  for (const [source, suite] of Object.entries(SUITES)) {
    const rows = readJsonlShardedSync(path.join(ROOT, suite));
    const consumedCases = new Set(rows.filter(row => consumedIds.has(row.id)).map(clusterOf));
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
  out.stages = Object.fromEntries(Object.entries(staged).map(([k, ids]) => [k, ids]));
  writeJson(file, out);
  const count = key => out.items.reduce((a, it) => ({...a, [it[key]]: (a[it[key]] ?? 0) + 1}), {});
  console.log('items', out.items.length, count('source'), count('language'), count('qgroup'), Object.fromEntries(Object.entries(out.stages).map(([k, v]) => [k, v.length])));
}

/** Sample items joined with their suite rows (optionally one stage). */
export function loadItems(stage = 'full') {
  const sample = readJson(path.join(OUT, 'sample.json'));
  const ids = new Set(sample.stages[stage] ?? sample.stages.full);
  const rows = {};
  for (const [source, file] of Object.entries(SUITES)) rows[source] = new Map(readJsonlShardedSync(path.join(ROOT, file)).map(r => [r.id, r]));
  return sample.items.filter(item => ids.has(item.id)).map(item => ({...item, row: rows[item.source].get(item.id)}));
}

// ------------------------------------------------------------------ rules loading and conversion

/**
 * Load a rules version: the working tree (lib/ud-to-sop) or a frozen copy. A frozen copy imports `../../sop/…`,
 * so it is copied into a scratch tree whose `sop` is a symbolic link to the repository's sop/.
 */
export async function loadRules(dir) {
  if (!dir) {
    const mod = await import(pathToFileURL(path.join(ROOT, 'lib/ud-to-sop/index.mjs')).href);
    return {convertParse: mod.convertParse, maskMessage: mod.maskMessage, base: 'lib/ud-to-sop'};
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-rules-'));
  fs.mkdirSync(path.join(scratch, 'lib/ud-to-sop'), {recursive: true});
  for (const name of fs.readdirSync(path.resolve(dir))) if (name.endsWith('.mjs')) fs.copyFileSync(path.join(path.resolve(dir), name), path.join(scratch, 'lib/ud-to-sop', name));
  fs.symlinkSync(path.join(ROOT, 'sop'), path.join(scratch, 'sop'));
  fs.symlinkSync(path.join(ROOT, 'lib'), path.join(scratch, 'lib-repo'));
  const mod = await import(pathToFileURL(path.join(scratch, 'lib/ud-to-sop/index.mjs')).href);
  return {convertParse: mod.convertParse, maskMessage: mod.maskMessage, base: path.relative(ROOT, path.resolve(dir))};
}

/** Parse (CPU) and convert rows with a rules version; parses are cached by the masked text. */
export async function convertRows(rows, rules, cacheFile) {
  const {StanzaWorker} = await import('../../lib/ud-to-sop/stanza.mjs');
  const cache = new Map(readJsonl(cacheFile).map(p => [p.key, p.parse]));
  const masked = rows.map(row => rules.maskMessage(row.question));
  const todo = [...new Set(masked.filter(text => !cache.has(sha(text))))];
  if (todo.length) {
    const worker = new StanzaWorker({device: 'cpu'});
    await worker.start();
    const fresh = [];
    for (let i = 0; i < todo.length; i += 32) {
      const chunk = todo.slice(i, i + 32);
      const {parses} = await worker.parseMany(chunk);
      chunk.forEach((text, j) => { cache.set(sha(text), parses[j]); fresh.push({key: sha(text), parse: parses[j]}); });
      if ((i / 32) % 10 === 0) console.error(`  parsed ${Math.min(i + 32, todo.length)}/${todo.length}`);
    }
    await worker.stop();
    fs.mkdirSync(path.dirname(cacheFile), {recursive: true});
    fs.appendFileSync(cacheFile, fresh.map(p => JSON.stringify(p)).join('\n') + '\n');
  }
  return rows.map((row, i) => {
    let r;
    try { r = rules.convertParse(cache.get(sha(masked[i])), row.question); } catch (error) { r = {sop: '', valid: false, outcome: 'crash', error: error.message, notes: []}; }
    return {id: row.id, sop: r.sop, valid: r.valid, outcome: r.outcome, error: r.error ?? null};
  });
}

// ------------------------------------------------------------------ scoring

/** Strict match of predictions: test/OOD tolerant execution (eval/run.mjs, unchanged), wild D1-tolerant all-F1 = 1. */
export function strictScores(items, predictions, dir) {
  fs.mkdirSync(dir, {recursive: true});
  const bySop = new Map(predictions.map(p => [p.id, p.sop]));
  const out = new Map();
  for (const source of ['test', 'ood']) {
    const rows = items.filter(it => it.source === source).map(it => it.row);
    if (!rows.length) continue;
    const suite = path.join(dir, source + '.suite.jsonl'), pred = path.join(dir, source + '.predictions.jsonl'), rep = path.join(dir, source + '.evaluation.json');
    writeJsonl(suite, rows);
    writeJsonl(pred, rows.map(r => ({id: r.id, sop: bySop.get(r.id) ?? ''})));
    execFileSync(process.execPath, [path.join(ROOT, 'eval/run.mjs'), '--file', suite, '--predictions', pred, '--out', rep], {cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], maxBuffer: 1 << 28});
    for (const r of readJson(rep).records) out.set(r.id, {match: r.execution_equivalent_tolerant ? 1 : 0});
    fs.rmSync(suite);
  }
  for (const it of items) {
    const t = tolerantScores(bySop.get(it.id) ?? '', goldsOf(it.row));
    const o = out.get(it.id) ?? {match: t.all === 1 ? 1 : 0};
    out.set(it.id, {...o, d1_all_f1: t.all});
  }
  return out;
}

/**
 * Host-normalized match (separately labelled; never replaces strict): the prediction is rewritten by the host frame
 * normalization (sop/frames.mjs: relation synonyms, relation+preposition frames -> role, boundary shift) before the
 * same scorer; for the wild suite (no world) both prediction and gold are normalized.
 */
export async function normalizedScores(items, predictions, dir, frames) {
  const {normalizeProgram} = await import('../../sop/frames.mjs');
  const normalized = predictions.map(p => ({...p, sop: normalizeProgram(p.sop, frames).sop}));
  const out = strictScores(items, normalized, dir);
  for (const it of items.filter(x => x.source === 'wild')) {
    const pred = normalized.find(p => p.id === it.id)?.sop ?? '';
    const t = tolerantScores(pred, goldsOf(it.row).map(g => normalizeProgram(g, frames).sop));
    out.set(it.id, {match: t.all === 1 ? 1 : 0, d1_all_f1: t.all});
  }
  return {scores: out, predictions: normalized};
}

/** Paired cluster bootstrap of b - a over the listed items (10,000 resamples, seed 7). */
export function pairedDelta(items, a, b, key = 'match') {
  const clusters = new Map();
  let gained = 0, lost = 0;
  for (const it of items) {
    const x = a.get(it.id)?.[key], y = b.get(it.id)?.[key];
    if (x === undefined || y === undefined) continue;
    if (y > x) gained++; else if (y < x) lost++;
    const k = clusterOf(it.row);
    if (!clusters.has(k)) clusters.set(k, []);
    clusters.get(k).push([x, y]);
  }
  const pairs = [...clusters.values()].flat();
  if (!pairs.length) return null;
  return {n: pairs.length, a: mean(pairs.map(p => p[0])), b: mean(pairs.map(p => p[1])), delta: mean(pairs.map(p => p[1] - p[0])), ci95: bootstrap([...clusters.values()]), gained, lost};
}

const SLICES = [['all', () => true], ['test', it => it.source === 'test'], ['ood', it => it.source === 'ood'], ['wild', it => it.source === 'wild'],
  ['en', it => it.language === 'en'], ['ro', it => it.language === 'ro'], ['mixed', it => it.language === 'mixed'],
  ['wild-en', it => it.source === 'wild' && it.language === 'en'], ['wild-ro', it => it.source === 'wild' && it.language === 'ro'], ['wild-mixed', it => it.source === 'wild' && it.language === 'mixed']];

// ------------------------------------------------------------------ commands

async function convertCommand(args) {
  const label = String(args.rules ?? 'v1.4');
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
  for (const label of ['v1.3', 'v1.4']) {
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
      strict: pairedDelta(list, scored['v1.3'].strict, scored['v1.4'].strict),
      normalized: pairedDelta(list, scored['v1.3'].normalized, scored['v1.4'].normalized),
      d1_all_f1: pairedDelta(list, scored['v1.3'].strict, scored['v1.4'].strict, 'd1_all_f1'),
      normalization_gain_v14: pairedDelta(list, scored['v1.4'].strict, scored['v1.4'].normalized),
      normalization_gain_v13: pairedDelta(list, scored['v1.3'].strict, scored['v1.3'].normalized),
    };
  }
  const v14 = readJsonl(path.join(OUT, 'predictions-v1.4.jsonl')).filter(p => ids.has(p.id));
  const broken = mean(v14.map(p => (!p.sop || !p.valid ? 1 : 0)));
  const all = result.paired.all.strict;
  result.stop_check = {invalid_or_empty_share_v14: broken, broken: broken > 0.2, harm: all.ci95[1] < 0};
  writeJson(path.join(OUT, `compare-${stage}.json`), result);
  const pct = x => (x === null || x === undefined ? '-' : (x * 100).toFixed(1));
  for (const [name, p] of Object.entries(result.paired)) console.log(name.padEnd(10), `n ${String(p.strict.n).padStart(3)} strict ${pct(p.strict.a)} -> ${pct(p.strict.b)} d ${pct(p.strict.delta)} [${pct(p.strict.ci95[0])}, ${pct(p.strict.ci95[1])}] +${p.strict.gained}/-${p.strict.lost} | norm ${pct(p.normalized.a)} -> ${pct(p.normalized.b)} d ${pct(p.normalized.delta)} [${pct(p.normalized.ci95[0])}, ${pct(p.normalized.ci95[1])}]`);
  console.log('stop check', result.stop_check);
}

/** Development score on formalizer-v1 dev rows (the only data used to tune v1.4). */
async function devCommand(args) {
  const n = Number(args.n ?? 400);
  const rows = readJsonlShardedSync(path.join(ROOT, 'datasets_archive/formalizer-v1/dev.jsonl')).filter(r => !args.language || r.language === args.language);
  const random = mulberry(Number(args.seed ?? 5));
  const sample = [...rows].sort(() => random() - 0.5).slice(0, n);
  const items = sample.map(row => ({id: row.id, source: 'test', language: row.language, row}));
  const rules = await loadRules(args.dir);
  const label = String(args.rules ?? 'dev');
  const predictions = await convertRows(sample, rules, path.join(OUT, 'dev', 'parses-' + label + '.jsonl'));
  const strict = strictScores(items, predictions, path.join(OUT, 'dev', 'scoring-' + label));
  const rowsOut = items.map(it => ({id: it.id, language: it.language, question_type: it.row.question_type, question: it.row.question, match: strict.get(it.id).match, d1: strict.get(it.id).d1_all_f1, sop: predictions.find(p => p.id === it.id).sop, gold: it.row.sop_target}));
  writeJsonl(path.join(OUT, 'dev', `dev-${label}.jsonl`), rowsOut);
  const by = key => Object.fromEntries([...new Set(rowsOut.map(r => r[key]))].map(v => [v, (mean(rowsOut.filter(r => r[key] === v).map(r => r.match)) * 100).toFixed(1)]));
  console.log(`dev ${label}: match ${(mean(rowsOut.map(r => r.match)) * 100).toFixed(1)}% (${rowsOut.length}); by language`, by('language'));
}

/**
 * Q-SYM-2 analysis: which of the 146 Layer-2 misses of eval-symbolic-layers-en-v1 (sealed rows never used to build
 * the frame list) become matches when the host frame normalization rewrites the v1.3 output, by cumulative level.
 */
async function framesMissesCommand() {
  const {Frames, normalizeProgram} = await import('../../sop/frames.mjs');
  const cases = readJsonl(path.join(ROOT, 'eval/reports/current/symbolic-layers/layer2-cases.jsonl'));
  const rows = {};
  for (const [source, file] of Object.entries(SUITES)) rows[source] = new Map(readJsonlShardedSync(path.join(ROOT, file)).map(r => [r.id, r]));
  const items = cases.map(c => ({id: c.id, source: c.source, language: 'en', row: rows[c.source].get(c.id), cats: new Set(c.categories.map(x => x.cat))}));
  const variants = {
    'list: synonyms': {sources: ['world', 'train'], levels: ['synonym']},
    'list: synonyms + roles': {sources: ['world', 'train'], levels: ['synonym', 'role']},
    'list: + boundary': {sources: ['world', 'train'], levels: ['synonym', 'role', 'boundary']},
    'list: + boundary + time': {sources: ['world', 'train'], levels: ['synonym', 'role', 'boundary', 'time']},
    'list + WordNet': {sources: ['world', 'train', 'wordnet'], levels: ['synonym', 'role', 'boundary', 'time']},
    'list + WordNet + generic single-oblique': {sources: ['world', 'train', 'wordnet'], levels: ['synonym', 'role', 'boundary', 'time', 'generic']},
  };
  const base = strictScores(items, cases.map(c => ({id: c.id, sop: c.rules_v13_sop})), path.join(OUT, 'scoring', 'misses-strict'));
  const out = {population: 'the 146 Layer-2 misses of eval-symbolic-layers-en-v1 under ud-rules-v1.3 (layer2-cases.jsonl); none of these rows was used to build the frame list', strict_matches: [...base.values()].filter(v => v.match).length, variants: {}};
  const slices = {all: () => true, C_role: it => it.cats.has('C_role'), C_boundary: it => it.cats.has('C_boundary'), C_only: it => [...it.cats].every(c => c.startsWith('C_')), R_any: it => [...it.cats].some(c => c.startsWith('R_'))};
  const perCase = new Map(items.map(it => [it.id, {id: it.id, source: it.source, categories: [...it.cats]}]));
  for (const [name, v] of Object.entries(variants)) {
    const frames = Frames.load({sources: v.sources});
    const normalized = cases.map(c => ({id: c.id, sop: normalizeProgram(c.rules_v13_sop, frames, {levels: v.levels}).sop}));
    const scores = strictScores(items.filter(it => it.source !== 'wild'), normalized, path.join(OUT, 'scoring', 'misses-' + name.replace(/\W+/g, '-')));
    for (const it of items.filter(x => x.source === 'wild')) {
      const t = tolerantScores(normalized.find(p => p.id === it.id).sop, goldsOf(it.row).map(g => normalizeProgram(g, frames, {levels: v.levels}).sop));
      scores.set(it.id, {match: t.all === 1 ? 1 : 0});
    }
    const changes = cases.reduce((a, c) => { for (const ch of normalizeProgram(c.rules_v13_sop, frames, {levels: v.levels}).changes) a[ch.kind] = (a[ch.kind] ?? 0) + 1; return a; }, {});
    out.variants[name] = {frames: frames.frames.length, changes, resolved: Object.fromEntries(Object.entries(slices).map(([k, f]) => { const list = items.filter(f); return [k, {n: list.length, resolved: list.filter(it => scores.get(it.id)?.match).length}]; }))};
    for (const it of items) if (scores.get(it.id)?.match) perCase.get(it.id)[name] = 1;
  }
  writeJson(path.join(OUT, 'frames-misses.json'), out);
  writeJsonl(path.join(OUT, 'frames-misses-cases.jsonl'), [...perCase.values()]);
  for (const [name, v] of Object.entries(out.variants)) console.log(name.padEnd(42), Object.entries(v.resolved).map(([k, r]) => `${k} ${r.resolved}/${r.n}`).join('  '), JSON.stringify(v.changes));
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const commands = {sample: sampleCommand, convert: convertCommand, compare: compareCommand, dev: devCommand, 'frames-misses': framesMissesCommand};
  if (commands[args.command]) return commands[args.command](args);
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
