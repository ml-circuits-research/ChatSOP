#!/usr/bin/env node
/** Development harness of rules v2.0 (experiment eval-symbolic-accurate-adopt-v1, preregistered in
 * status/preregistrations/eval-symbolic-accurate-adopt-v1.json).
 *
 *   node tools/research/rules-v2-dev.mjs record --package accurate|default [--device cuda] [--set dev|control|all]
 *   node tools/research/rules-v2-dev.mjs score  --parses accurate|default --rules live|v1.6 [--set dev|control|all] [--name run]
 *   node tools/research/rules-v2-dev.mjs diff   --a run --b run [--show 40]
 *
 * Development rows: the clean-English rows with a gold SOP of the train and dev splits of the three datasets (source
 * corpora formalizer-v1 and proofing-diverse-dev, split groups sealed by another suite excluded). Control rows: the
 * archive clean-English dev rows in groups that the sealed proofing suite holds; they are only scored, never
 * inspected. Parses are recorded once per package (GPU, one worker) as `{'en|<masked text>': parse}` shards under
 * eval/reports/current/symbolic-accurate/parses-<package>/; `score` replays the rules on them (no Stanza) and scores
 * strictly against the gold SOP with the row's verification world (tools/datasets/three-datasets/score.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, writeJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {trainDevFormalizerRecords} from '../datasets/three-datasets/inputs.mjs';
import {strictScores} from '../datasets/three-datasets/score.mjs';
import {StanzaWorker} from '../../lib/ud-to-sop/stanza.mjs';
import {maskMessage, convertParse} from '../../lib/ud-to-sop/index.mjs';
import {loadFrozenRules} from './proofing-oracle.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = path.join(ROOT, 'eval/reports/current/symbolic-accurate');
const args = argv => { const o = {command: argv[0]}; for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

/** Development and control records (clean English, gold SOP, verification world). */
export function devRecords(which = 'dev') {
  const sealed = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/reports/current/three-datasets/sealed-text-hashes.json'), 'utf8'));
  const dev = trainDevFormalizerRecords({excludeGroups: new Set(sealed.groups ?? [])}).filter(r => r.partition === 'clean_en' && !r.noisy && r.language === 'en');
  const all = trainDevFormalizerRecords().filter(r => r.partition === 'clean_en' && !r.noisy && r.language === 'en');
  const have = new Set(dev.map(r => `${r.corpus}::${r.sourceId}`));
  const control = all.filter(r => !have.has(`${r.corpus}::${r.sourceId}`)).map(r => ({...r, control: true}));
  return which === 'dev' ? dev : which === 'control' ? control : [...dev, ...control];
}

const parsesDir = pkg => path.join(OUT, `parses-${pkg}`);
export function loadParses(pkg) {
  const file = path.join(parsesDir(pkg), 'parses.jsonl');
  const map = new Map();
  try { for (const r of readJsonlShardedSync(file)) map.set(r.k, r.parse); } catch { /* none yet */ }
  return map;
}

async function record(o) {
  const pkg = o.package ?? 'accurate';
  const records = devRecords(o.set ?? 'all');
  const known = loadParses(pkg);
  const texts = [...new Set(records.map(r => maskMessage(r.message)))].filter(t => !known.has('en|' + t));
  if (!texts.length) return console.log('nothing to record');
  const worker = new StanzaWorker({device: o.device ?? 'cuda', package: pkg, env: {OMP_NUM_THREADS: '4'}});
  const t0 = performance.now();
  try {
    for (let i = 0; i < texts.length; i += 64) {
      const chunk = texts.slice(i, i + 64);
      const {parses} = await worker.parseMany(chunk, chunk.map(() => 'en'));
      chunk.forEach((t, j) => known.set('en|' + t, parses[j]));
      if ((i / 64) % 20 === 0) process.stderr.write(`\r${i}/${texts.length}`);
    }
  } finally { await worker.stop(); }
  fs.rmSync(parsesDir(pkg), {recursive: true, force: true});
  fs.mkdirSync(parsesDir(pkg), {recursive: true});
  writeJsonlShardedSync(path.join(parsesDir(pkg), 'parses.jsonl'), [...known].map(([k, parse]) => ({k, parse})));
  console.log(`\nrecorded ${texts.length} parses (${Math.round(performance.now() - t0)} ms), ${known.size} in store`);
}

/** Score the records with rules `rules` (`live` or a frozen version) on the recorded parses of `pkg`. */
export async function scoreRun({parses, rules = 'live', set = 'dev', records = null}) {
  const recs = records ?? devRecords(set);
  const convert = rules === 'live' ? convertParse : (await loadFrozenRules(rules)).convertParse;
  const mask = rules === 'live' ? maskMessage : (await loadFrozenRules(rules)).maskMessage;
  const sop = new Map();
  for (const r of recs) {
    const masked = mask(r.message);
    const parse = parses.get('en|' + masked);
    let out;
    try { out = parse ? convert(parse, r.message) : {sop: '', valid: false, outcome: 'noparse'}; } catch (error) { out = {sop: '', valid: false, outcome: 'crash', error: String(error.message).slice(0, 100)}; }
    sop.set(`${r.corpus}::${r.sourceId}`, out);
  }
  // Scores are memoized per (row, SOP text): only a changed prediction is executed again.
  const cacheFile = path.join(OUT, 'score-cache.json');
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const ck = r => `${r.corpus}::${r.sourceId}|${createHash('sha1').update(sop.get(`${r.corpus}::${r.sourceId}`).sop).digest('hex').slice(0, 12)}`;
  const todo = recs.filter(r => !cache[ck(r)]);
  if (todo.length) {
    const fresh = await strictScores(todo, r => sop.get(`${r.corpus}::${r.sourceId}`).sop);
    for (const r of todo) { const s = fresh.get(`${r.corpus}::${r.sourceId}`); cache[ck(r)] = [s.ok ? 1 : 0, s.frame_ok ? 1 : 0]; }
    fs.mkdirSync(OUT, {recursive: true});
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  }
  return recs.map(r => {
    const key = `${r.corpus}::${r.sourceId}`, o = sop.get(key), [okBit, frameBit] = cache[ck(r)], s = {ok: Boolean(okBit), frame_ok: Boolean(frameBit)};
    return {id: key, control: Boolean(r.control), split: r.split, qt: r.questionType ?? r.row.question_type ?? 'unspecified', family: r.family, message: r.message, tree: (parses.get('en|' + mask(r.message))?.sentences ?? []).map(t => t.words.map(w => `${w.id}:${w.text}/${w.upos}>${w.head}:${w.deprel}`).join(' ')), ok: s.ok, frame_ok: s.frame_ok, sop: o.sop, outcome: o.outcome};
  });
}

export const summarize = rows => {
  const by = (f) => { const m = {}; for (const r of rows) { const k = f(r); (m[k] ??= {n: 0, ok: 0, frame: 0}); m[k].n++; m[k].ok += r.ok; m[k].frame += (r.ok || r.frame_ok) ? 1 : 0; } return m; };
  const tot = rows.length, ok = rows.filter(r => r.ok).length, frame = rows.filter(r => r.ok || r.frame_ok).length;
  return {n: tot, strict: ok / tot, ok, frame_normalized: frame / tot, by_split: by(r => r.control ? 'control' : r.split), by_qt: by(r => r.qt)};
};

async function scoreCommand(o) {
  const parses = loadParses(o.parses ?? 'accurate');
  if (!parses.size) throw Error('no recorded parses: run record first');
  const rows = await scoreRun({parses, rules: o.rules ?? 'live', set: o.set ?? 'dev'});
  const name = o.name ?? `${o.parses ?? 'accurate'}-${o.rules ?? 'live'}`;
  fs.mkdirSync(path.join(OUT, 'runs'), {recursive: true});
  fs.writeFileSync(path.join(OUT, 'runs', name + '.json'), JSON.stringify({name, at: new Date().toISOString(), parses: o.parses ?? 'accurate', rules: o.rules ?? 'live', summary: summarize(rows), rows}));
  const s = summarize(rows);
  console.log(`${name}: n=${s.n} strict ${(100 * s.strict).toFixed(2)}% (${s.ok}) frame-normalized ${(100 * s.frame_normalized).toFixed(2)}%`);
  for (const [k, v] of Object.entries(s.by_split)) console.log(`  ${k}: ${(100 * v.ok / v.n).toFixed(1)}% of ${v.n}`);
  if (o.types) for (const [k, v] of Object.entries(s.by_qt).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n)) console.log(`  ${k.padEnd(28)} ${(100 * v.ok / v.n).toFixed(1).padStart(5)}% of ${v.n}`);
}

const readRun = name => JSON.parse(fs.readFileSync(path.join(OUT, 'runs', name + '.json'), 'utf8'));
function diffCommand(o) {
  const a = readRun(o.a), b = readRun(o.b);
  const byId = new Map(a.rows.map(r => [r.id, r]));
  const gained = [], lost = [];
  for (const r of b.rows) { const p = byId.get(r.id); if (!p) continue; if (r.ok && !p.ok) gained.push(r); if (!r.ok && p.ok) lost.push({...r, before: p.sop}); }
  console.log(`${o.a} -> ${o.b}: gained ${gained.length}, lost ${lost.length}`);
  const cnt = {};
  for (const r of [...gained.map(r => ['+', r]), ...lost.map(r => ['-', r])]) { const k = r[0] + ' ' + r[1].qt; cnt[k] = (cnt[k] ?? 0) + 1; }
  console.log(Object.entries(cnt).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `${k}: ${v}`).join('\n'));
  if (o.show) for (const r of lost.slice(0, Number(o.show))) console.log('LOST', r.id, r.qt, JSON.stringify(r.message));
}

/** Print rows with tree, produced SOP and gold: --run R [--vs A] [--lost|--gained|--fail] [--qt T] [--n 5] [--skip 0] [--grep text] [--trees accurate|default|both]. */
async function showCommand(o) {
  const run = readRun(o.run), vs = o.vs ? readRun(o.vs) : null;
  const prev = vs ? new Map(vs.rows.map(r => [r.id, r])) : null;
  let rows = run.rows;
  if (o.lost) rows = rows.filter(r => !r.ok && prev.get(r.id)?.ok);
  else if (o.gained) rows = rows.filter(r => r.ok && prev.get(r.id) && !prev.get(r.id).ok);
  else if (o.fail) rows = rows.filter(r => !r.ok);
  if (o.qt) rows = rows.filter(r => r.qt === o.qt);
  if (o.nonprop) { const {programShape} = await import('./symbolic-layers-diff.mjs'); const {loadFrames, normalizeProgram} = await import('../../sop/frames.mjs'); const fr = loadFrames(); const nz = t => { try { return normalizeProgram(t, fr).sop; } catch { return t; } }; const goldAll = JSON.parse(fs.readFileSync(path.join(OUT, 'gold-cache.json'), 'utf8')); const full = p => `${p.kind === 'match' ? 'm' : p.kind[0]} ${p.relation} | ${p.roles.map(x => x.name + '=' + x.value).sort().join(' ; ')} | ${p.polarity}`; rows = rows.filter(r => { if (r.ok || r.frame_ok) return false; const a = (programShape(nz(r.sop))?.props ?? []).map(full), b = (programShape(nz(goldAll[r.id]))?.props ?? []).map(full); return a.every(x => b.includes(x)) && b.every(x => a.includes(x)); }); }
  if (o.grep) rows = rows.filter(r => r.message.includes(o.grep));
  if (o.frame) rows = rows.filter(r => !r.ok && !r.frame_ok);
  if (o.group) { const seen = new Set(); rows = rows.filter(r => { const g = r.id.split('_').slice(0, 2).join('_'); if (seen.has(g)) return false; seen.add(g); return true; }); }
  const wanted = rows.slice(Number(o.skip ?? 0), Number(o.skip ?? 0) + Number(o.n ?? 5));
  const goldFile = path.join(OUT, 'gold-cache.json');
  if (!fs.existsSync(goldFile)) fs.writeFileSync(goldFile, JSON.stringify(Object.fromEntries(devRecords('all').map(r => [`${r.corpus}::${r.sourceId}`, r.row.sop_target]))));
  const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
  const one = t => String(t).split('\n').map(x => x.trim()).filter(Boolean).join(' ; ');
  console.log(`${rows.length} rows match; showing ${wanted.length}`);
  for (const r of wanted) {
    console.log(`\n== ${r.id} [${r.qt}] ${JSON.stringify(o.diff ? r.message.slice(0, 600) : r.message)}`);
    if (o.diff) { const {programShape} = await import('./symbolic-layers-diff.mjs'); const key = p => `${p.kind === 'match' ? 'm' : p.kind[0]} ${p.relation} | ${p.roles.map(x => x.name + '=' + x.value).sort().join(' ; ')} | ${p.polarity}`; const {loadFrames, normalizeProgram} = await import('../../sop/frames.mjs'); const fr = loadFrames(); const nz = t => { try { return normalizeProgram(t, fr).sop; } catch { return t; } }; const a = programShape(nz(r.sop))?.props ?? [], b = programShape(nz(gold[r.id]))?.props ?? []; const ka = a.map(key), kb = b.map(key); for (const k of ka) if (!kb.includes(k)) console.log('  OUT+ ' + k); for (const k of kb) if (!ka.includes(k)) console.log('  GOLD+ ' + k); continue; }
    for (const t of r.tree ?? []) console.log('  [T] ' + t);
    if (prev?.get(r.id)?.tree && o.trees === 'both') for (const t of prev.get(r.id).tree) console.log('  [P] ' + t);
    console.log('  OUT : ' + one(r.sop));
    if (prev?.get(r.id)) console.log('  PREV: ' + one(prev.get(r.id).sop));
    console.log('  GOLD: ' + one(gold[r.id]));
  }
}

/** Frequency of the diff signatures of the failing rows (frame-normalized diff, values masked): --run R [--top 30] [--ex 2]. */
async function sigCommand(o) {
  const {programShape} = await import('./symbolic-layers-diff.mjs');
  const {loadFrames, normalizeProgram} = await import('../../sop/frames.mjs');
  const fr = loadFrames(); const nz = t => { try { return normalizeProgram(t, fr).sop; } catch { return t; } };
  const run = readRun(o.run), gold = JSON.parse(fs.readFileSync(path.join(OUT, 'gold-cache.json'), 'utf8'));
  const sigs = new Map();
  for (const r of run.rows) {
    if (r.ok || r.frame_ok || (o.qt && r.qt !== o.qt)) continue;
    const key = p => `${p.kind === 'match' ? 'm' : p.kind[0]}:${o.rel ? p.relation.split(' ')[0] : ''}:${p.roles.map(x => x.name).sort().join(',')}:${p.polarity[0]}`;
    const full = p => `${p.kind === 'match' ? 'm' : p.kind[0]} ${p.relation} | ${p.roles.map(x => x.name + '=' + x.value).sort().join(' ; ')} | ${p.polarity}`;
    const a = programShape(nz(r.sop))?.props ?? [], b = programShape(nz(gold[r.id]))?.props ?? [];
    const fa = a.map(full), fb = b.map(full);
    const outOnly = a.filter((_, i) => !fb.includes(fa[i])), goldOnly = b.filter((_, i) => !fa.includes(fb[i]));
    const sig = [...outOnly.map(x => 'OUT ' + key(x)), ...goldOnly.map(x => 'GOLD ' + key(x))].sort().join(' || ') || 'nonprop-difference';
    if (!sigs.has(sig)) sigs.set(sig, []);
    sigs.get(sig).push(r);
  }
  const rows = [...sigs].sort((x, y) => y[1].length - x[1].length);
  console.log(`${rows.reduce((n, [, v]) => n + v.length, 0)} failing rows, ${rows.length} signatures`);
  for (const [sig, list] of rows.slice(0, Number(o.top ?? 30))) {
    console.log(`${String(list.length).padStart(4)}  ${sig}`);
    for (const r of list.slice(0, Number(o.ex ?? 0))) console.log('        ' + JSON.stringify(r.message).slice(0, 150));
  }
}

/** Blame categories of the failing rows of a run (symbolic-layers-diff.mjs): --run R [--qt T] [--cat R_missing --n 5 to list rows]. */
async function blameCommand(o) {
  const {diffCategories} = await import('./symbolic-layers-diff.mjs');
  const run = readRun(o.run);
  const gold = JSON.parse(fs.readFileSync(path.join(OUT, 'gold-cache.json'), 'utf8'));
  const tally = {}, rowsBy = {}, byQt = {};
  let failing = 0;
  for (const r of run.rows) {
    if (r.ok || (o.qt && r.qt !== o.qt)) continue;
    if (!o.all && r.frame_ok) continue; // frame-recoverable rows are gold conventions
    failing++;
    let cats = [];
    try { cats = diffCategories(r.sop, gold[r.id], {executed: true, message: r.message}).map(c => c.cat); } catch { cats = ['crash']; }
    if (!cats.length) cats = ['none'];
    for (const c of new Set(cats)) { tally[c] = (tally[c] ?? 0) + 1; (rowsBy[c] ??= []).push(r); (byQt[r.qt] ??= {})[c] = ((byQt[r.qt] ??= {})[c] ?? 0) + 1; }
  }
  console.log(`failing rows (not frame-recoverable unless --all): ${failing}`);
  console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join('\n'));
  if (o.bytype) for (const [qt, m] of Object.entries(byQt).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0)).slice(0, 12)) console.log(qt.padEnd(14), Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(' '));
  if (o.cat) {
    const gold2 = gold; const one = t => String(t).split('\n').map(x => x.trim()).filter(Boolean).join(' ; ');
    for (const r of (rowsBy[o.cat] ?? []).slice(Number(o.skip ?? 0), Number(o.skip ?? 0) + Number(o.n ?? 5))) {
      console.log(`\n== ${r.id} [${r.qt}] ${JSON.stringify(r.message)}`);
      for (const t of r.tree ?? []) console.log('  [T] ' + t);
      console.log('  OUT : ' + one(r.sop)); console.log('  GOLD: ' + one(gold2[r.id]));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  const run = {record, score: scoreCommand, diff: diffCommand, show: showCommand, blame: blameCommand, sig: sigCommand}[o.command];
  if (!run) { console.error('commands: record | score | diff'); process.exit(2); }
  Promise.resolve(run(o)).catch(e => { console.error(e.stack); process.exit(1); });
}
