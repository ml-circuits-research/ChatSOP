#!/usr/bin/env node
/**
 * Local layers (1 mechanical, 2 analysis comparison) of the severity cascade (DS016 "Graded severity") for rewrite pairs.
 *   node tools/eval/severity-local.mjs --pairs pairs.jsonl --out local.jsonl [--device cpu|cuda]
 * `pairs.jsonl`: {id, a: original, b: rewrite}. Output per pair: {id, local: {severity|null, decided, layer, flags}} where layer is exact, mechanical, analysis or residue.
 * Pairs the local layers cannot decide stay undecided (severity null): they are the residue for the LLM severity judge (tools/eval/severity-judge.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import {mechanicalSeverity, mechanicalChecks, MECHANICAL_VERSION} from '../../lib/severity/mechanical.mjs';
import {severityFromComparison} from '../../lib/severity/analysis-map.mjs';
import {comparePairs} from './analysis-compare.mjs';

export const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(path.resolve(f)), {recursive: true}); fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };

/** Layers 1 and 2 for every pair; `device` is for the Stanza parse of the analysis layer (cpu by default). */
export async function localGrade(pairs, {device = 'auto', analysis = true, trustAnalysisS4 = false} = {}) {
  const out = new Map();
  const needAnalysis = [];
  for (const p of pairs) {
    const m = mechanicalSeverity(p.a, p.b);
    if (m.decided) out.set(p.id, {severity: m.severity, decided: true, layer: m.severity === 'S0' ? 'exact' : 'mechanical', flags: m.flags});
    else { out.set(p.id, {severity: null, decided: false, layer: 'residue', flags: m.flags}); needAnalysis.push(p); }
  }
  if (analysis && needAnalysis.length) {
    const verdicts = await comparePairs(needAnalysis.map(p => ({id: p.id, a: p.a, b: p.b})), {device});
    for (const v of verdicts) {
      const prev = out.get(v.id), r = severityFromComparison(v);
      const flags = [...prev.flags, ...r.flags];
      if (r.decided && (r.severity === 'S0' || trustAnalysisS4)) out.set(v.id, {severity: r.severity, decided: true, layer: 'analysis', flags, analysis: {verdict: v.verdict, failed: v.failedChecks, reasons: v.reasons.slice(0, 4)}});
      else out.set(v.id, {severity: null, decided: false, layer: 'residue', flags, analysis: {verdict: v.verdict, failed: v.failedChecks, reasons: v.reasons.slice(0, 4)}});
    }
  }
  return pairs.map(p => ({id: p.id, local: out.get(p.id)}));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.pairs || !args.out) { console.error('usage: --pairs pairs.jsonl --out local.jsonl [--device cpu]'); process.exit(2); }
  const pairs = readJsonl(args.pairs).map(r => ({id: r.id, a: String(r.a), b: String(r.b)}));
  const res = await localGrade(pairs, {device: args.device ?? 'auto'});
  writeJsonl(args.out, res);
  const count = {};
  for (const r of res) { const k = `${r.local.layer}:${r.local.severity ?? '-'}`; count[k] = (count[k] ?? 0) + 1; }
  console.log(JSON.stringify({version: MECHANICAL_VERSION, n: res.length, count}));
}
