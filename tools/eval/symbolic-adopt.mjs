#!/usr/bin/env node
/** Sealed comparison of experiment eval-symbolic-accurate-adopt-v1 (preregistered in
 * status/preregistrations/eval-symbolic-accurate-adopt-v1.json): system A (frozen rules v1.6 + Stanza default package)
 * against system B (frozen rules v2.0 + Stanza accurate package) on the sealed clean-English test.
 *
 *   node tools/eval/symbolic-adopt.mjs run --system A|B --stage 100|300|full [--device cuda]
 *   node tools/eval/symbolic-adopt.mjs compare --stage 100|300|full
 *
 * The rules of both systems are the frozen copies under eval/reports/current/baseline-ud-rules/ (hash-checked by
 * tools/research/proofing-oracle.mjs loadFrozenRules): live edits of lib/ud-to-sop cannot change a score. Parses come from
 * the one configurable worker (lib/ud-to-sop/stanza.mjs) with the English pipeline forced (the messages are classified
 * clean English), batches of 64 on the GPU, cached per package in eval/reports/current/symbolic-accurate/sealed/.
 * Stages are the seeded stratified samples of eval-stanza-accurate-v1 (100, 300, full; sets-test.json). The rows are
 * opened only here, for the headline numbers; nothing is tuned on them (AGENTS.md rule 9). Scoring: strict execution
 * equivalence with the gold SOP (eval/run.mjs through tools/datasets/three-datasets/score.mjs; the wild suite by its accepted
 * golds) and the frame-normalized score beside it (Q-SYM-1). Paired cluster bootstrap over split_group_id, 10000
 * resamples, seed 7.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, writeJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {StanzaWorker} from '../../lib/ud-to-sop/stanza.mjs';
import {strictScores} from '../datasets/three-datasets/score.mjs';
import {loadFrozenRules} from '../research/proofing-oracle.mjs';
import {scoreAgainstAccepted} from './wild-suite.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/symbolic-accurate/sealed');
const SYSTEMS = {A: {package: 'default', rules: 'v1.6'}, B: {package: 'accurate', rules: 'v2.5'}};
const sha = t => createHash('sha256').update(t).digest('hex');
const args = argv => { const o = {command: argv[0]}; for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
const suiteOf = r => r.id.split('::')[0];

function stageRows(stage) {
  const rows = readJsonlShardedSync(path.join(ROOT, 'eval/suites/clean-english/test.jsonl'));
  const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/reports/current/stanza-accurate/sets-test.json'), 'utf8'));
  const ids = new Set(sets.stages[stage] ?? sets.stages.full);
  return rows.filter(r => ids.has(r.id));
}

function loadParses(pkg) {
  const file = path.join(OUT, `parses-${pkg}.jsonl`);
  const map = new Map();
  try { for (const r of readJsonlShardedSync(file)) map.set(r.k, r.parse); } catch { /* none yet */ }
  return map;
}

async function run(o) {
  const system = SYSTEMS[o.system];
  if (!system) throw Error('--system A|B');
  const rules = await loadFrozenRules(system.rules);
  const rows = stageRows(o.stage ?? 'full');
  const parses = loadParses(system.package);
  const masked = rows.map(r => rules.maskMessage(r.question));
  const todo = [...new Set(masked)].filter(m => !parses.has(sha(m)));
  let parseMs = 0;
  if (todo.length) {
    const worker = new StanzaWorker({device: o.device ?? 'cuda', package: system.package, env: {OMP_NUM_THREADS: '4'}});
    try {
      for (let i = 0; i < todo.length; i += 64) {
        const chunk = todo.slice(i, i + 64);
        const {parses: got, ms} = await worker.parseMany(chunk, chunk.map(() => 'en'));
        parseMs += ms;
        chunk.forEach((m, j) => parses.set(sha(m), got[j]));
      }
    } finally { await worker.stop(); }
    fs.mkdirSync(OUT, {recursive: true});
    writeJsonlShardedSync(path.join(OUT, `parses-${system.package}.jsonl`), [...parses].map(([k, parse]) => ({k, parse})));
  }
  const out = rows.map((r, i) => {
    const parse = parses.get(sha(masked[i]));
    try { return parse ? rules.convertParse(parse, r.question) : {sop: '', valid: false, outcome: 'noparse'}; } catch { return {sop: '', valid: false, outcome: 'crash'}; }
  });
  const records = rows.map(r => ({corpus: 'sealed', sourceId: r.id, wild: suiteOf(r) === 'formalizer-wild-v1', row: r, message: r.question}));
  const sopOf = new Map(records.map((rec, i) => [rec.sourceId, out[i].sop]));
  const scores = await strictScores(records, rec => sopOf.get(rec.sourceId), {wildScore: scoreAgainstAccepted});
  const recs = rows.map((r, i) => { const s = scores.get(`sealed::${r.id}`); return {id: r.id, group: r.split_group_id, suite: suiteOf(r), qt: r.question_type ?? 'unspecified', strict: Boolean(s.ok), frame: Boolean(s.ok || s.frame_ok), valid: Boolean(out[i].valid), outcome: out[i].outcome}; });
  fs.mkdirSync(path.join(OUT, 'runs'), {recursive: true});
  const summary = {system: o.system, ...system, stage: o.stage ?? 'full', rows: recs.length, strict: recs.filter(x => x.strict).length / recs.length, frame_normalized: recs.filter(x => x.frame).length / recs.length, invalid_or_crash: recs.filter(x => !x.valid).length, rules_sha256: rules.sums, parsed_now: todo.length, parse_ms: Math.round(parseMs)};
  fs.writeFileSync(path.join(OUT, 'runs', `${o.system}-${summary.stage}.json`), JSON.stringify({summary, records: recs}));
  console.log(JSON.stringify(summary));
}

const mulberry = seed => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** Paired cluster bootstrap of mean(b) - mean(a) over clusters (percentage points). */
export function pairedBootstrap(pairs, {resamples = 10000, seed = 7} = {}) {
  const groups = new Map();
  for (const {group, a, b} of pairs) { const g = groups.get(group) ?? {a: 0, b: 0, n: 0}; g.a += a; g.b += b; g.n++; groups.set(group, g); }
  const list = [...groups.values()], rand = mulberry(seed);
  const total = list.reduce((s, g) => ({a: s.a + g.a, b: s.b + g.b, n: s.n + g.n}), {a: 0, b: 0, n: 0});
  const deltas = [];
  for (let r = 0; r < resamples; r++) {
    let a = 0, b = 0, n = 0;
    for (let i = 0; i < list.length; i++) { const g = list[Math.floor(rand() * list.length)]; a += g.a; b += g.b; n += g.n; }
    deltas.push(100 * (b - a) / n);
  }
  deltas.sort((x, y) => x - y);
  const gained = pairs.filter(p => p.b && !p.a).length, lost = pairs.filter(p => p.a && !p.b).length;
  return {n: pairs.length, a: total.a / total.n, b: total.b / total.n, delta_pp: 100 * (total.b - total.a) / total.n, ci95_pp: [deltas[Math.floor(0.025 * resamples)], deltas[Math.floor(0.975 * resamples)]], gained, lost};
}

function compare(o) {
  const stage = o.stage ?? 'full';
  const load = s => JSON.parse(fs.readFileSync(path.join(OUT, 'runs', `${s}-${stage}.json`), 'utf8'));
  const A = load('A'), B = load('B');
  const byId = new Map(A.records.map(r => [r.id, r]));
  const joined = B.records.map(b => ({b, a: byId.get(b.id)})).filter(x => x.a);
  const table = (key, filter = () => true) => pairedBootstrap(joined.filter(x => filter(x.b)).map(({a, b}) => ({group: b.group, a: +a[key], b: +b[key]})));
  const result = {stage, A: A.summary, B: B.summary, strict: table('strict'), frame_normalized: table('frame'), per_suite: {}, per_question_type: {}};
  for (const suite of [...new Set(joined.map(x => x.b.suite))]) result.per_suite[suite] = {strict: table('strict', b => b.suite === suite), frame_normalized: table('frame', b => b.suite === suite)};
  for (const qt of [...new Set(joined.map(x => x.b.qt))]) { const n = joined.filter(x => x.b.qt === qt).length; result.per_question_type[qt] = {n, strict: pairedBootstrap(joined.filter(x => x.b.qt === qt).map(({a, b}) => ({group: b.group, a: +a.strict, b: +b.strict})), {resamples: 2000})}; }
  fs.writeFileSync(path.join(OUT, `compare-${stage}.json`), JSON.stringify(result, null, 1) + '\n');
  const f = x => `${x.a.toFixed(4)} -> ${x.b.toFixed(4)} ${x.delta_pp >= 0 ? '+' : ''}${x.delta_pp.toFixed(2)} pp [${x.ci95_pp.map(v => v.toFixed(2)).join(', ')}] (+${x.gained}/-${x.lost}, n ${x.n})`;
  console.log(`stage ${stage}\n strict: ${f(result.strict)}\n frame-normalized: ${f(result.frame_normalized)}`);
  for (const [s, v] of Object.entries(result.per_suite)) console.log(` ${s}: strict ${f(v.strict)}`);
  for (const [q, v] of Object.entries(result.per_question_type).sort((a, b) => a[1].strict.delta_pp - b[1].strict.delta_pp)) console.log(`  ${q.padEnd(16)} n ${String(v.n).padStart(4)} ${v.strict.delta_pp >= 0 ? '+' : ''}${v.strict.delta_pp.toFixed(1)} pp (${(100 * v.strict.a).toFixed(1)} -> ${(100 * v.strict.b).toFixed(1)}; +${v.strict.gained}/-${v.strict.lost})`);
}

/**
 * Lost rows of the legacy-source suites (owner decision of 2026-09-30: rows whose source is formalizer-ood-v1 or
 * formalizer-wild-v1 are learning material and may be used for rule development). The formalizer-v1 rows of the sealed test
 * are never printed.
 */
async function lost(o) {
  const stage = o.stage ?? 'full';
  const load = s => JSON.parse(fs.readFileSync(path.join(OUT, 'runs', `${s}-${stage}.json`), 'utf8'));
  const A = load('A'), B = load('B'), byId = new Map(A.records.map(r => [r.id, r]));
  const ids = B.records.filter(b => byId.get(b.id)?.strict && !b.strict && b.suite !== 'formalizer-v1').map(b => b.id);
  const rows = readJsonlShardedSync(path.join(ROOT, 'eval/suites/clean-english/test.jsonl')).filter(r => ids.includes(r.id));
  const ra = await loadFrozenRules(SYSTEMS.A.rules), rb = await loadFrozenRules(SYSTEMS.B.rules);
  const pa = loadParses('default'), pb = loadParses('accurate');
  const one = t => String(t).split('\n').map(x => x.trim()).filter(Boolean).join(' ; ');
  for (const r of rows.slice(Number(o.skip ?? 0), Number(o.skip ?? 0) + Number(o.n ?? 10))) {
    const parse = pb.get(sha(rb.maskMessage(r.question)));
    console.log(`\n== ${r.id} [${r.question_type}] ${JSON.stringify(r.question)}`);
    for (const sent of parse?.sentences ?? []) console.log('  [T] ' + sent.words.map(w => `${w.id}:${w.text}/${w.upos}>${w.head}:${w.deprel}`).join(' '));
    console.log('  A   : ' + one(ra.convertParse(pa.get(sha(ra.maskMessage(r.question))), r.question).sop).slice(0, 700));
    console.log('  B   : ' + one(rb.convertParse(parse, r.question).sop).slice(0, 700));
    console.log('  GOLD: ' + one((r.sop_targets_accepted ?? [r.sop_target])[0]).slice(0, 700));
  }
  console.log(`\n${ids.length} lost rows of the legacy-source suites`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  const fn = {run, compare, lost}[o.command];
  if (!fn) { console.error('commands: run | compare | lost'); process.exit(2); }
  Promise.resolve(fn(o)).catch(e => { console.error(e.stack); process.exit(1); });
}
