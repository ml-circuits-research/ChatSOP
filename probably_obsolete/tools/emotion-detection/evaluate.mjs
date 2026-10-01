#!/usr/bin/env node
/** Evaluates the EmotionDetectionSystem strategies on the 300-message set against the two judges (DS029, experiment
 * emotion-detection-v1). Reference per kind and message: "positive" when BOTH judges (Grok, GLM) list the kind,
 * "negative" when NEITHER does, "disputed" otherwise (disputed messages are left out of that kind's precision/recall and
 * reported separately). Also reports precision against each judge alone, symbolic latency, the neural strategy per
 * model (thresholds tuned on the odd-numbered half and scored on the even half) and the cascade.
 *   node tools/emotion-detection/evaluate.mjs        -> eval/reports/current/emotion-detection/results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSymbolicStrategy} from '../../lib/emotion-detection/index.mjs';
import {signalsFromScores} from '../../lib/emotion-detection/strategies/neural.mjs';
import {loadConfig} from '../../lib/emotion-detection/index.mjs';
import {PRAGMATIC_KINDS} from '../../sop/enums.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'eval/reports/current/emotion-detection');
const jl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const items = jl(path.join(DIR, 'eval-set.jsonl'));
const KINDS = PRAGMATIC_KINDS.filter(k => k !== 'unclassified');
const kindsOf = answer => new Set((answer?.signals ?? []).map(s => s.kind).filter(k => KINDS.includes(k)));

const grok = new Map(jl(path.join(ROOT, 'datasets_sources/emotion_grok/output/verdicts.jsonl')).map(r => [r.id, kindsOf(r.answer)]));
const glm = new Map([1, 2, 3].flatMap(n => jl(path.join(ROOT, `datasets_sources/emotion_glm_${n}/output/verdicts.jsonl`))).map(r => [r.id, kindsOf(r.answer)]));
const RO = /[ăâîșțşţ]|\b(și|să|de la|nu|cu|pe|că|cine|unde|este|sunt|mai|iar|te rog|vă rog|mulțumesc|mersi|salut|bună|cred|poate|când|ce|dacă|spune|fost)\b/i;
const isRo = m => RO.test(m);

const strategy = createSymbolicStrategy();
const t0 = performance.now();
const symbolic = new Map(items.map(i => [i.id, new Set(strategy.detect(i.message).filter(s => s.score >= 0.5).map(s => s.kind))]));
const symbolicMs = (performance.now() - t0) / items.length;

const neuralRaw = new Map(jl(path.join(DIR, 'neural-scores.jsonl')).map(r => [r.id, r.scores]));
const neuralConfig = loadConfig().strategies.neural;

function confusion(pred, kind, ids) {
  let tp = 0, fp = 0, fn = 0, tn = 0, disputed = 0, fpGrok = 0, predicted = 0, predGrokOnly = 0;
  for (const id of ids) {
    const g = grok.get(id), m = glm.get(id);
    if (!g || !m) continue;
    const p = pred.get(id)?.has(kind) ?? false, a = g.has(kind), b = m.has(kind);
    if (p) { predicted++; if (!a) fpGrok++; }
    if (a && b) p ? tp++ : fn++;
    else if (!a && !b) p ? fp++ : tn++;
    else { disputed++; if (p) predGrokOnly++; }
  }
  const prec = tp + fp ? tp / (tp + fp) : null, rec = tp + fn ? tp / (tp + fn) : null;
  return {tp, fp, fn, tn, disputed, disputedPredicted: predGrokOnly, predicted, precision: prec, recall: rec, f1: prec && rec ? 2 * prec * rec / (prec + rec) : null, support: tp + fn};
}
const table = (pred, ids = items.map(i => i.id)) => Object.fromEntries(KINDS.map(k => [k, confusion(pred, k, ids)]));

// Neural: per (model, label) threshold sweep on the odd half, scored on the even half; English messages only.
const english = items.filter(i => !isRo(i.message)).map(i => i.id);
const oddIds = english.filter((_, i) => i % 2 === 0), evenIds = english.filter((_, i) => i % 2 === 1);
const grid = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
const perModel = {};
for (const [model, map] of Object.entries(neuralConfig.map)) {
  perModel[model] = {};
  for (const [label, kind] of Object.entries(map)) {
    const predAt = th => new Map(english.map(id => [id, new Set((neuralRaw.get(id)?.[model]?.[label] ?? 0) >= th ? [kind] : [])]));
    const dev = grid.map(th => ({th, c: confusion(predAt(th), kind, oddIds)}));
    const ok = dev.filter(d => d.c.predicted >= 2 && d.c.precision !== null && d.c.precision >= 0.85).sort((a, b) => (b.c.recall ?? 0) - (a.c.recall ?? 0) || a.th - b.th)[0];
    const th = ok?.th ?? 0.95;
    perModel[model][label] = {kind, threshold: th, tunedPrecisionOk: Boolean(ok), test: confusion(predAt(th), kind, evenIds), default05: confusion(predAt(0.5), kind, english)};
  }
}
const thresholds = Object.fromEntries(Object.entries(perModel).flatMap(([m, labels]) => Object.entries(labels).map(([l, v]) => [`${m}.${l}`, v.threshold])));
const neuralPred = th => new Map(items.map(i => [i.id, new Set(signalsFromScores(neuralRaw.get(i.id) ?? {}, {...neuralConfig, thresholds: th}).map(s => s.kind))]));
const neuralDefault = neuralPred({}), neuralTuned = neuralPred(thresholds);

const devIds = items.filter((_, i) => i % 2 === 0).map(i => i.id), testIds = items.filter((_, i) => i % 2 === 1).map(i => i.id);
const bySource = {handwritten: items.filter(i => i.source === 'handwritten').map(i => i.id), datasets: items.filter(i => i.source !== 'handwritten').map(i => i.id)};
const symSplit = {dev_error_analysis_half: table(symbolic, devIds), test_untouched_half: table(symbolic, testIds), handwritten: table(symbolic, bySource.handwritten), datasets: table(symbolic, bySource.datasets)};
const micro = t => { const a = Object.values(t).reduce((x, c) => ({tp: x.tp + c.tp, fp: x.fp + c.fp, fn: x.fn + c.fn}), {tp: 0, fp: 0, fn: 0}); return {precision: a.tp / (a.tp + a.fp), recall: a.tp / (a.tp + a.fn), ...a}; };
const symMicro = Object.fromEntries(Object.entries(symSplit).map(([k, t]) => [k, micro(t)]));
const sym = table(symbolic), symEn = table(symbolic, english);
const neuDef = table(neuralDefault, english), neuTuned = table(neuralTuned, evenIds);
const union = (a, b) => new Map(items.map(i => [i.id, new Set([...(a.get(i.id) ?? []), ...(b.get(i.id) ?? [])])]));
const cascadeAll = union(symbolic, neuralTuned);

// Policy: a (strategy, kind) pair is `on` at precision >= 0.85 over >= 3 predictions, `experimental` at >= 0.6, else `off`.
const policy = {};
const decide = c => (c.predicted >= 3 && c.precision !== null && c.precision >= 0.85 ? 'on' : c.predicted >= 3 && c.precision !== null && c.precision >= 0.6 ? 'experimental' : c.predicted === 0 ? 'untested' : 'off');
for (const k of KINDS) policy[`symbolic.${k}`] = decide(sym[k]);
for (const [model, labels] of Object.entries(perModel)) for (const [, v] of Object.entries(labels)) {
  const key = `${model}.${v.kind}`; const d = decide(v.default05);
  if (!policy[key] || ['on', 'experimental', 'off', 'untested'].indexOf(d) < ['on', 'experimental', 'off', 'untested'].indexOf(policy[key])) policy[key] = d;
}
const judgeAgreement = Object.fromEntries(KINDS.map(k => {
  let both = 0, either = 0;
  for (const i of items) { const a = grok.get(i.id)?.has(k), b = glm.get(i.id)?.has(k); if (a && b) both++; if (a || b) either++; }
  return [k, {both, either, jaccard: either ? both / either : null}];
}));
const coverage = {items: items.length, grok: grok.size, glm: glm.size, english: english.length, romanianOrMixed: items.length - english.length};
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify({coverage, symbolicMsPerMessage: symbolicMs, judgeAgreement, symbolic: sym, symbolicSplits: symSplit, symbolicMicro: symMicro, symbolicEnglishOnly: symEn, neuralDefaultThreshold05EnglishOnly: neuDef, neuralPerLabel: perModel, neuralTunedEvenHalf: neuTuned, cascadeAll: table(cascadeAll), thresholds, policy}, null, 1) + '\n');
const pct = v => (v === null ? '  -  ' : (v * 100).toFixed(0).padStart(3) + '%');
console.log(JSON.stringify(symMicro));
console.log(JSON.stringify(coverage), 'symbolic ms/message', symbolicMs.toFixed(3));
console.log('kind'.padEnd(22), 'sup', 'symb P', 'symb R', '|', 'neur P', 'neur R', '| cascade P R | policy symbolic');
const cas = table(cascadeAll);
for (const k of KINDS) console.log(k.padEnd(22), String(sym[k].support).padStart(3), pct(sym[k].precision), ' ', pct(sym[k].recall), ' |', pct(neuDef[k].precision), ' ', pct(neuDef[k].recall), ' |', pct(cas[k].precision), pct(cas[k].recall), '|', policy[`symbolic.${k}`]);
