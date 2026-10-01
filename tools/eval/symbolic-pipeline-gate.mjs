#!/usr/bin/env node
/** Evaluation of the SymbolicLM rewrite pipeline (experiment eval-symbolic-pipeline-gate-v1): routing gate and acceptance check around
 * SymbolicProofingLLM, decided locally by SymbolicLM (lib/symbolic-lm/rewrite-gate.mjs). No training, no retraining.
 *
 *   node tools/eval/symbolic-pipeline-gate.mjs units                                   # every sentence unit of every set -> units.json
 *   node tools/eval/symbolic-pipeline-gate.mjs generate --model it2|it1 --url URL       # raw model output per unit (cached, greedy, message-only prompt)
 *   node tools/eval/symbolic-pipeline-gate.mjs parse                                    # Stanza accurate and default parses of units and raw outputs (GPU, one worker)
 *   node tools/eval/symbolic-pipeline-gate.mjs lm                                       # SymbolicLM result of every unit (g2: does SymbolicLM handle it alone)
 *   node tools/eval/symbolic-pipeline-gate.mjs arms                                     # write the arms: pair outputs, composed rewriter caches, decision statistics
 *
 * The arms are deterministic post-processing of the raw per-unit outputs: arm name `<model>-<gate>-<acceptance>` with gate g1 (trees),
 * g2 (trees_or_uncertain) or g3 (always) and acceptance `n` (off), `a` (certified) or `m` (certified_compare). Composed arms are written as
 * rewriter caches (`composed/cache/rewriter-<arm>.jsonl`, every unit with its final text) so that tools/eval/composed-score.mjs scores them
 * unchanged with `--gate all`; pair arms are written as `outputs/<arm>__<split>.jsonl` for tools/eval/symbolic-proofing-eval.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {shouldRewrite, acceptRewrite} from '../../lib/symbolic-lm/rewrite-gate.mjs';
import {openLm, handled} from './composed/lm.mjs';
import {endpointRewriter, cachedRewriter} from './composed/rewriters.mjs';
import {loadCases} from './composed-score.mjs';
import {AnalysisLayer} from './analysis-layer.mjs';
import {sentencesOf} from '../datasets/symbolic-proofing-v2/units.mjs';

export const WORK = path.join(ROOT, process.env.SYMPROOF_WORK ?? 'eval/reports/current/symbolic-pipeline-gate');
const SUITES = path.join(ROOT, 'eval/suites');
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

export const GATE_OF = {g1: 'trees', g2: 'trees_or_uncertain', g3: 'always'};
export const ACCEPT_OF = {n: 'off', a: 'certified', m: 'certified_compare'};
export const armName = (model, gate, accept) => `${model}-${gate}-${accept}`;
export const parseArm = name => { const [model, gate, accept] = name.split('-'); return {model, gate, accept}; };

/** Units of the sets: pair splits (norm-spaced sentences) and composed kinds (raw host-splitter texts, as the scorer sends them). */
export async function collectUnits() {
  const {loadSplit} = await import('./symbolic-proofing-eval.mjs');
  const sets = {};
  for (const split of ['test', 'sym500']) sets[split] = loadSplit(split).map(r => ({id: r.id, kind: r.kind, prompt: r.prompt, target: r.target, units: sentencesOf(r.prompt)}));
  for (const [kind, dataset] of [['K2', 'neuro_english'], ['K3', 'symbolic_english'], ['K5', 'symbolic_english'], ['K6', 'neuro_english']]) {
    sets[kind] = loadCases(kind, SUITES, dataset).map(r => ({id: r.id, units: splitSentences(r.message).map(u => u.text)}));
  }
  return sets;
}
const unitsFile = path.join(WORK, 'units.json');
const allUnits = sets => [...new Set(Object.values(sets).flatMap(rows => rows.flatMap(r => r.units)))];
const rawFile = model => path.join(WORK, 'cache', `raw-${model}.jsonl`);
export const loadRaw = model => new Map(readJsonl(rawFile(model)).map(r => [r.in, r.out]));

async function generate(model, url) {
  const sets = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
  const fn = cachedRewriter(endpointRewriter(url), rawFile(model));
  const units = allUnits(sets), have = loadRaw(model);
  let done = 0;
  for (const u of units) { if (!have.has(u)) await fn(u); if (++done % 500 === 0) console.log(`${model}: ${done}/${units.length}`); }
  console.log(JSON.stringify({model, units: units.length, new: units.filter(u => !have.has(u)).length}));
}

async function parseAll() {
  const sets = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
  const texts = [...allUnits(sets)];
  for (const model of ['it1', 'it2']) for (const out of loadRaw(model).values()) texts.push(out);
  for (const split of ['test', 'sym500']) for (const r of sets[split]) texts.push(r.prompt, r.target);
  const layer = new AnalysisLayer();
  console.log(JSON.stringify(await layer.ensure(texts)));
}

async function lmAll() {
  const sets = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
  const lm = await openLm({cacheDir: path.join(WORK, 'composed/cache')});
  try { let n = 0; for (const u of allUnits(sets)) { await lm.run(u); if (++n % 500 === 0) console.log(`lm ${n}`); } console.log(JSON.stringify({lm: lm.id, units: n})); } finally { await lm.close(); }
}

/** Decision of one unit under an arm: {sent, accepted, final, reasons, certified, uncertain, changed}. */
export function decide(unit, raw, {gate, accept}, facts, layer) {
  const certified = layer.localPass(unit), uncertain = !handled(facts);
  const sent = shouldRewrite(GATE_OF[gate], {certified, uncertain});
  if (!sent) return {sent: false, accepted: false, final: unit, reasons: [], certified, uncertain, changed: false};
  const outputCertified = layer.localPass(raw);
  const compareVerdict = accept === 'm' ? layer.localMeaning(unit, raw) : null;
  const verdict = acceptRewrite(unit, raw, {acceptance: ACCEPT_OF[accept], outputCertified, compareVerdict});
  const final = verdict.accepted ? raw : unit;
  return {sent: true, accepted: verdict.accepted, final, reasons: verdict.reasons, certified, uncertain, output_certified: outputCertified, changed: final.replace(/\s+/g, ' ').trim() !== unit.replace(/\s+/g, ' ').trim()};
}

export const ARMS = (() => {
  const list = [];
  for (const gate of ['g3', 'g1', 'g2']) for (const accept of ['n', 'a', 'm']) list.push(armName('it2', gate, accept));
  return list;
})();

async function arms(names) {
  const sets = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
  const layer = new AnalysisLayer();
  const lm = await openLm({cacheDir: path.join(WORK, 'composed/cache')});
  const stats = {};
  try {
    const factsOf = new Map();
    for (const u of allUnits(sets)) factsOf.set(u, await lm.run(u));
    for (const name of names) {
      const arm = parseArm(name), raw = loadRaw(arm.model);
      const cache = new Map();
      const unitStats = {sent: 0, accepted: 0, changed: 0, units: 0, rejected: {}};
      const decisions = new Map();
      for (const u of allUnits(sets)) {
        if (!raw.has(u)) throw Error(`no raw output of ${arm.model} for a unit: ${u.slice(0, 60)}`);
        const d = decide(u, raw.get(u), arm, factsOf.get(u), layer);
        decisions.set(u, d);
        cache.set(u, d.final);
      }
      for (const split of ['test', 'sym500']) {
        const rows = sets[split];
        writeJsonl(path.join(WORK, 'outputs', `${name}__${split}.jsonl`), rows.map(r => ({id: r.id, output: r.units.map(u => cache.get(u)).join(' ').trim(), units: r.units.length, sent: r.units.filter(u => decisions.get(u).sent).length, truncated: false, device: 'pipeline', mode: 'sentence'})));
        const per = {rows: rows.length, units: 0, sent: 0, accepted: 0, changed: 0};
        for (const r of rows) for (const u of r.units) { const d = decisions.get(u); per.units++; per.sent += d.sent; per.accepted += d.sent && d.accepted && d.changed; per.changed += d.changed; if (d.sent && !d.accepted) for (const why of d.reasons) unitStats.rejected[why] = (unitStats.rejected[why] ?? 0) + 1; }
        unitStats[split] = per;
      }
      for (const kind of ['K2', 'K3', 'K5', 'K6']) {
        const per = {cases: sets[kind].length, units: 0, sent: 0, changed: 0};
        for (const r of sets[kind]) for (const u of r.units) { const d = decisions.get(u); per.units++; per.sent += d.sent; per.changed += d.changed; }
        unitStats[kind] = per;
      }
      for (const kind of ['K2', 'K3', 'K5']) { /* composed caches are shared between kinds: one file per arm */ }
      const cacheLines = [...cache].map(([u, out]) => ({in: u, out}));
      writeJsonl(path.join(WORK, 'composed/cache', `rewriter-${name}.jsonl`), cacheLines);
      writeJsonl(path.join(WORK, 'composed/cache', `rewriter-${name}-sent.jsonl`), cacheLines);
      stats[name] = unitStats;
    }
  } finally { await lm.close(); }
  fs.writeFileSync(path.join(WORK, 'arm-stats.json'), JSON.stringify(stats, null, 1) + '\n');
  console.log(JSON.stringify(stats, null, 1));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2), o = args(rest);
  if (command === 'units') { const sets = await collectUnits(); fs.writeFileSync(unitsFile, JSON.stringify(sets)); console.log(JSON.stringify({units: allUnits(sets).length, sets: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.length]))})); }
  else if (command === 'generate') await generate(o.model, o.url);
  else if (command === 'parse') await parseAll();
  else if (command === 'lm') await lmAll();
  else if (command === 'arms') await arms(o.names ? String(o.names).split(',') : ARMS);
  else throw Error('usage: symbolic-pipeline-gate.mjs units|generate|parse|lm|arms');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
