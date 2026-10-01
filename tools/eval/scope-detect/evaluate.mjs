#!/usr/bin/env node
/**
 * Scope-detect study driver (CPU only).
 *   node tools/eval/scope-detect/evaluate.mjs pairs [--glm-sessions 3]      write the judge folders (Grok, GLM x N) for the labelled set
 *   node tools/eval/scope-detect/evaluate.mjs detect                         run the detector on the set -> detections.jsonl
 *   node tools/eval/scope-detect/evaluate.mjs report [--split dev|test|all]  merge the two judges, score the detector, write summary.json
 * Two judge votes (Grok, GLM). Both agree on the label -> gold; they disagree -> "excusable ambiguity", reported apart and not scored.
 * A wire type is gold for an item only when both judges list it; listed by one judge only -> disputed (not scored either way).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {detectScope, WIRES, LABELS, SCOPE_DETECT_VERSION} from '../../../lib/symbolic-lm/scope-detect.mjs';
import {readJsonl, writeJsonl, OUT, SET_FILE, judgeFolder, shuffle} from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const val = (k, d = null) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d);
const DET_FILE = path.join(OUT, 'detections.jsonl');
const set = () => readJsonl(SET_FILE);
const userText = r => r.sentence.text.trim();
/** Deterministic dev/test halves of the set (hash of the id), so tuning on dev leaves test untouched. */
export const half = id => { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h % 2 ? 'test' : 'dev'; };

function pairs() {
  const items = set().map(r => ({id: r.id, user: userText(r)}));
  const made = [judgeFolder('scope_judge_grok', items, {model: 'xai-oauth/grok-4.20-0309-non-reasoning'})];
  const n = Number(val('--glm-sessions', 3));
  for (let k = 0; k < n; k++) made.push(judgeFolder(`scope_judge_glm${k + 1}`, items.filter((_, i) => i % n === k), {model: 'zai/glm-5.3-flash'}));
  console.log(made.join('\n'));
}

async function detect() {
  const rows = set().map(r => { const t0 = performance.now(); const d = detectScope(r.sentence, {language: r.language}); return {id: r.id, set: r.set, half: half(r.id), text: userText(r), language: r.language, label: d.label, wires: d.wires.map(w => ({wire: w.wire, score: w.score})), cues: d.cues.map(c => ({wire: c.wire, type: c.type, text: c.text, weight: c.weight})), features: d.features, reason: d.reason, ms: performance.now() - t0}; });
  writeJsonl(DET_FILE, rows);
  const ms = rows.map(r => r.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({rows: rows.length, version: SCOPE_DETECT_VERSION, median_ms: ms[ms.length >> 1], p95_ms: ms[Math.floor(ms.length * 0.95)]}));
}

const folderRows = prefix => fs.readdirSync(path.join(ROOT, 'datasets_sources')).filter(n => n === prefix || new RegExp(`^${prefix}\\d+$`).test(n)).flatMap(n => readJsonl(path.join(ROOT, 'datasets_sources', n, 'output/verdicts.jsonl')));
export function verdictMap(prefix) {
  const m = new Map();
  for (const r of folderRows(prefix)) {
    const a = r.answer ?? {}; const label = LABELS.includes(a.label) ? a.label : null;
    if (label) m.set(r.id, {label, wires: label === 'needs_knowledge_authoring' ? [...new Set((a.wires ?? []).map(String).filter(w => WIRES.includes(w)))] : [], reason: a.reason ?? ''});
  }
  return m;
}
const wilson = (k, n, z = 1.96) => { if (!n) return [0, 0]; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; };
const pct = x => Math.round(x * 1000) / 10;
const prf = (tp, fp, fn) => ({tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, f1: tp ? 2 * tp / (2 * tp + fp + fn) : null, precision_ci: wilson(tp, tp + fp).map(pct), recall_ci: wilson(tp, tp + fn).map(pct)});

export function merge(rowsSet, det, g, z) {
  const detById = new Map(det.map(d => [d.id, d]));
  return rowsSet.map(r => {
    const a = g.get(r.id), b = z.get(r.id), d = detById.get(r.id);
    const agree = a && b && a.label === b.label;
    const gold = agree ? a.label : null;
    const wires = agree && gold === 'needs_knowledge_authoring' ? {both: a.wires.filter(w => b.wires.includes(w)), either: [...new Set([...a.wires, ...b.wires])]} : {both: [], either: []};
    return {id: r.id, set: r.set, half: half(r.id), text: userText(r), language: r.language, grok: a ?? null, glm: b ?? null, judged: !!(a && b), agree: !!agree, gold, gold_wires: wires.both, disputed_wires: wires.either.filter(w => !wires.both.includes(w)), det: d};
  });
}

export function score(items) {
  const judged = items.filter(i => i.judged), agreed = judged.filter(i => i.agree);
  const confusion = {};
  for (const l of LABELS) confusion[l] = Object.fromEntries(LABELS.map(m => [m, 0]));
  for (const i of agreed) confusion[i.gold][i.det.label]++;
  const perClass = Object.fromEntries(LABELS.map(l => [l, prf(confusion[l][l], LABELS.reduce((s, m) => s + (m === l ? 0 : confusion[m][l]), 0), LABELS.reduce((s, m) => s + (m === l ? 0 : confusion[l][m]), 0))]));
  // binary: needs authoring vs everything else
  const NA = 'needs_knowledge_authoring';
  const bin = prf(agreed.filter(i => i.gold === NA && i.det.label === NA).length, agreed.filter(i => i.gold !== NA && i.det.label === NA).length, agreed.filter(i => i.gold === NA && i.det.label !== NA).length);
  const perWire = {};
  for (const w of WIRES) {
    let tp = 0, fp = 0, fn = 0, disputed = 0;
    for (const i of agreed) {
      const pred = i.det.wires.some(x => x.wire === w), gold = i.gold_wires.includes(w), dis = i.disputed_wires.includes(w);
      if (dis) { disputed++; continue; }
      if (pred && gold) tp++; else if (pred) fp++; else if (gold) fn++;
    }
    perWire[w] = {...prf(tp, fp, fn), disputed};
  }
  // lenient: a wire is gold when EITHER judge listed it (the judges differ on whether `rule`, `temporal` and `integrity` come with `norm`)
  const perWireEither = {};
  for (const w of WIRES) {
    let tp = 0, fp = 0, fn = 0;
    for (const i of agreed) { const pred = i.det.wires.some(x => x.wire === w), gold = i.gold_wires.includes(w) || i.disputed_wires.includes(w); if (pred && gold) tp++; else if (pred) fp++; else if (gold) fn++; }
    perWireEither[w] = prf(tp, fp, fn);
  }
  const bySet = {};
  for (const s of [...new Set(items.map(i => i.set))]) {
    const sub = agreed.filter(i => i.set === s);
    bySet[s] = {judged: items.filter(i => i.set === s && i.judged).length, agreed: sub.length, gold_needs_authoring: sub.filter(i => i.gold === NA).length, detected_needs_authoring: sub.filter(i => i.det.label === NA).length, binary: prf(sub.filter(i => i.gold === NA && i.det.label === NA).length, sub.filter(i => i.gold !== NA && i.det.label === NA).length, sub.filter(i => i.gold === NA && i.det.label !== NA).length), accuracy: sub.length ? sub.filter(i => i.gold === i.det.label).length / sub.length : null};
  }
  return {items: items.length, judged: judged.length, agreed: agreed.length, disputed: judged.length - agreed.length, accuracy: agreed.length ? agreed.filter(i => i.gold === i.det.label).length / agreed.length : null, confusion, per_class: perClass, binary_needs_authoring: bin, per_wire: perWire, per_wire_either_judge: perWireEither, by_set: bySet};
}

function naturalShare(items) {
  const nat = items.filter(i => i.set === 'natural' && i.judged);
  const agreed = nat.filter(i => i.agree);
  const NA = 'needs_knowledge_authoring';
  const gold = agreed.filter(i => i.gold === NA).length, det = nat.filter(i => i.det.label === NA).length;
  const eitherJudge = nat.filter(i => i.grok.label === NA || i.glm.label === NA).length;
  return {sentences: nat.length, agreed: agreed.length, judges_disagree: nat.length - agreed.length, gold_share: agreed.length ? gold / agreed.length : null, gold_share_ci: wilson(gold, agreed.length).map(pct), detector_share: nat.length ? det / nat.length : null, detector_share_ci: wilson(det, nat.length).map(pct), either_judge_share: nat.length ? eitherJudge / nat.length : null};
}

/** The 50 sentences labelled by hand (blind to the detector and the judges), compared with each. */
function mine(all) {
  const labels = readJsonl(path.join(OUT, 'my-labels.jsonl'));
  const byId = new Map(all.map(i => [i.id, i]));
  const rows = labels.map(l => ({...l, item: byId.get(l.id)})).filter(r => r.item);
  const same = (a, b) => a === b;
  const out = {n: rows.length, mine_counts: Object.fromEntries(LABELS.map(l => [l, rows.filter(r => r.label === l).length]))};
  for (const [name, get] of [['grok', i => i.grok?.label], ['glm', i => i.glm?.label], ['detector', i => i.det.label], ['judges_agree', i => i.agree ? i.gold : null]]) {
    const used = rows.filter(r => get(r.item)); out[name] = {n: used.length, agree_with_me: used.filter(r => same(get(r.item), r.label)).length};
    out[name].share = used.length ? out[name].agree_with_me / used.length : null;
  }
  const NA = 'needs_knowledge_authoring';
  const b = prf(rows.filter(r => r.label === NA && r.item.det.label === NA).length, rows.filter(r => r.label !== NA && r.item.det.label === NA).length, rows.filter(r => r.label === NA && r.item.det.label !== NA).length);
  out.detector_binary_vs_me = {tp: b.tp, fp: b.fp, fn: b.fn, precision: b.precision, recall: b.recall};
  out.disagreements_with_detector = rows.filter(r => r.label !== r.item.det.label).map(r => ({text: r.item.text.slice(0, 110), mine: r.label, detector: r.item.det.label, wires: r.item.det.wires.map(w => w.wire)}));
  return out;
}

function report() {
  const split = val('--split', 'all');
  const det = readJsonl(DET_FILE);
  const all = merge(set(), det, verdictMap('scope_judge_grok'), verdictMap('scope_judge_glm'));
  const pick = s => (s === 'all' ? all : all.filter(i => i.half === s));
  const result = {version: SCOPE_DETECT_VERSION, judge_models: {grok: 'xai-oauth/grok-4.20-0309-non-reasoning', glm: 'zai/glm-5.3-flash'}, all: score(pick('all')), dev: score(pick('dev')), test: score(pick('test')), natural_share: {all: naturalShare(pick('all')), test: naturalShare(pick('test'))}};
  const kappa = (() => { const j = all.filter(i => i.judged); const n = j.length; if (!n) return null; const po = j.filter(i => i.agree).length / n; const pe = LABELS.reduce((s, l) => s + (j.filter(i => i.grok.label === l).length / n) * (j.filter(i => i.glm.label === l).length / n), 0); return (po - pe) / (1 - pe); })();
  result.my_labels = mine(all);
  result.judge_agreement = {kappa, label_counts: Object.fromEntries(['grok', 'glm'].map(k => [k, Object.fromEntries(LABELS.map(l => [l, all.filter(i => i.judged && i[k].label === l).length]))]))};
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(result, null, 1));
  writeJsonl(path.join(OUT, 'merged.jsonl'), all);
  console.log(JSON.stringify({judged: result.all.judged, agreed: result.all.agreed, accuracy: result.all.accuracy, binary: result.all.binary_needs_authoring, natural: result.natural_share.all, kappa}, null, 1));
}

if (process.argv[1] === new URL(import.meta.url).pathname) { if (cmd === 'pairs') pairs(); else if (cmd === 'detect') await detect(); else if (cmd === 'report') report(); else { console.error('usage: pairs | detect | report'); process.exit(2); } }
