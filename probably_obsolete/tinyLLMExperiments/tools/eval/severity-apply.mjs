#!/usr/bin/env node
/**
 * Graded severity of the current systems (DS016 "Graded severity", Task B). Subcommands, in order:
 *   pairs      write the rewrite pair sets and the deduplicated list (eval/reports/current/severity/apply/)
 *   local      layers 1 and 2 (tools/eval/severity-local.mjs) for every pair, CPU parse
 *   folders    write the omp judge folders for the residue (one per judge model)
 *   report     merge local layers and judge verdicts into S0-S4/NONE per row, distributions, examples (apply/summary.json and apply.md)
 * Rewrite sets: a = the reference text the rewrite must keep the meaning of, b = the system output.
 *   sp-*   SymbolicProofingLLM pair test (a = input, b = output), per arm it2, it1, base
 *   lp-*   LanguageProofingLLM test600 (a = the verified English target, which is the input itself for identity pairs; the mechanical and analysis layers are English-only)
 * Interpretation sets (SymbolicLM message -> SOP vs gold) are graded by tools/eval/severity-interpretation.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {SEV_DIR} from './severity-calibration.mjs';
import {readJsonl, writeJsonl, localGrade} from './severity-local.mjs';
import {folderFromPairs, loadVerdicts} from './severity-judge.mjs';
import {distributionStats, fmt} from './severity/metrics.mjs';
import {SEVERITIES, rank} from './severity/scale.mjs';

export const APPLY = path.join(SEV_DIR, 'apply');
const R = 'eval/reports/current';
const scoreRecords = f => JSON.parse(fs.readFileSync(path.join(ROOT, R, f), 'utf8')).records;
export const SETS = {
  'sp-it2-test': () => scoreRecords('symbolic-proofing-it2/scores/it2__test.json').map(r => ({id: r.id, a: r.input, b: r.output ?? '', kind: r.kind})),
  'sp-it1-test': () => scoreRecords('symbolic-proofing-it2/scores/it1__test.json').map(r => ({id: r.id, a: r.input, b: r.output ?? '', kind: r.kind})),
  'sp-base-test': () => scoreRecords('symbolic-proofing-it2/scores/base__test.json').map(r => ({id: r.id, a: r.input, b: r.output ?? '', kind: r.kind})),
  'sp-it2-sym500': () => scoreRecords('symbolic-proofing-it2/scores/it2__sym500.json').map(r => ({id: r.id, a: r.input, b: r.output ?? '', kind: r.kind})),
  'sp-it1-sym500': () => scoreRecords('symbolic-proofing-it2/scores/it1__sym500.json').map(r => ({id: r.id, a: r.input, b: r.output ?? '', kind: r.kind})),
  'lp-it1-test600': () => scoreRecords('language-proofing-it1/scores/lp-it1__test600.json').map(r => ({id: r.id, a: r.target ?? r.input, b: r.output ?? '', kind: r.pair, source_input: r.input, noref: !r.target})),
  'lp-it2-test600': () => scoreRecords('language-proofing-it2/scores/lp-it2__test600.json').map(r => ({id: r.id, a: r.target ?? r.input, b: r.output ?? '', kind: r.pair, source_input: r.input, noref: !r.target})),
};
const keyOf = p => `${p.a}\u0001${p.b}`;
const hash = s => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.codePointAt(0)) >>> 0; return h.toString(36); };
export const pairId = p => `p${hash(keyOf(p))}${p.a.length}`;

async function pairs() {
  const all = new Map();
  for (const [name, fn] of Object.entries(SETS)) {
    let rows; try { rows = fn(); } catch (e) { console.error(name, 'missing', e.message); continue; }
    writeJsonl(path.join(APPLY, `${name}.rows.jsonl`), rows);
    for (const r of rows) all.set(pairId(r), {id: pairId(r), a: r.a, b: r.b, ...(r.noref ? {noref: true} : {})});
    console.log(name, rows.length);
  }
  writeJsonl(path.join(APPLY, 'pairs.jsonl'), [...all.values()]);
  console.log('unique pairs', all.size);
}
async function local() {
  const pairsList = readJsonl(path.join(APPLY, 'pairs.jsonl'));
  // a row without an English reference (Romanian or mixed source, no verified target) has no English-only local layers: judge only
  const withRef = pairsList.filter(p => !p.noref);
  const res = [...await localGrade(withRef, {device: 'cpu'}), ...pairsList.filter(p => p.noref).map(p => ({id: p.id, local: {severity: null, decided: false, layer: 'residue', flags: [{kind: 'no_english_reference', severity: null, certain: false, detail: 'judge only'}]}}))];
  writeJsonl(path.join(APPLY, 'local.jsonl'), res);
  const c = {};
  for (const r of res) { const k = `${r.local.layer}:${r.local.severity ?? '-'}`; c[k] = (c[k] ?? 0) + 1; }
  console.log(JSON.stringify(c));
}
function folders() {
  const pairsList = new Map(readJsonl(path.join(APPLY, 'pairs.jsonl')).map(p => [p.id, p]));
  const suffix = process.argv[3] ?? '';
  const have = new Set(['severity_apply_grok', 'severity_apply2_grok'].flatMap(n => [...loadVerdicts(n).keys()]));
  const residue = readJsonl(path.join(APPLY, 'local.jsonl')).filter(r => !r.local.decided && !(suffix && have.has(r.id))).map(r => pairsList.get(r.id));
  writeJsonl(path.join(APPLY, `residue${suffix}.jsonl`), residue);
  for (const name of [`severity_apply${suffix}_grok`, `severity_apply${suffix}_glm`]) console.log(JSON.stringify(folderFromPairs(name, residue)));
}

export function gradeRows(rows, local, judges) {
  return rows.map(r => {
    const id = pairId(r), l = local.get(id);
    let sev = null, layer = null;
    if (!r.b || !String(r.b).trim()) { sev = 'NONE'; layer = 'empty'; }
    else if (l?.decided) { sev = l.severity; layer = l.layer; }
    else {
      const g = judges.grok.get(id), z = judges.glm.get(id);
      layer = 'judge';
      const upper = g && z ? (rank(g) >= rank(z) ? g : z) : g ?? z ?? null, lower = g && z ? (rank(g) <= rank(z) ? g : z) : g ?? z ?? null;
      return {...r, id: r.id, pid: id, severity: upper, severity_lower: lower, layer, judge_grok: g ?? null, judge_glm: z ?? null};
    }
    return {...r, pid: id, severity: sev, severity_lower: sev, layer};
  });
}

function report() {
  const local = new Map(readJsonl(path.join(APPLY, 'local.jsonl')).map(r => [r.id, r.local]));
  const judges = {grok: new Map(['severity_apply_grok', 'severity_apply2_grok'].flatMap(n => (fs.existsSync(path.join(ROOT, 'datasets_sources', n)) ? [...loadVerdicts(n)] : []))), glm: new Map(['severity_apply_glm', 'severity_apply2_glm'].flatMap(n => (fs.existsSync(path.join(ROOT, 'datasets_sources', n)) ? [...loadVerdicts(n)] : [])))};
  const out = {generated_at: new Date().toISOString(), sets: {}};
  const md = ['# Graded severity of the current systems (rewrites)', '', 'Severity per row = local layers (exact, mechanical certain S4, analysis equivalent), else the LLM judges on the residue. `upper` takes the worse of Grok and GLM (calibrated recall of S4 98%), `lower` the milder (both judges must say S4; calibrated false-S4 rate lowest). The true catastrophic rate lies between the two.', ''];
  for (const name of Object.keys(SETS)) {
    const f = path.join(APPLY, `${name}.rows.jsonl`);
    if (!fs.existsSync(f)) continue;
    const graded = gradeRows(readJsonl(f), local, judges);
    writeJsonl(path.join(APPLY, `${name}.graded.jsonl`), graded);
    out.sets[name] = {};
    for (const kind of ['all', ...new Set(graded.map(r => r.kind))]) {
      const rows = graded.filter(r => kind === 'all' || r.kind === kind);
      const ungraded = rows.filter(r => !r.severity).length;
      const up = distributionStats(rows.filter(r => r.severity).map(r => r.severity)), lo = distributionStats(rows.filter(r => r.severity).map(r => r.severity_lower));
      out.sets[name][kind] = {rows: rows.length, ungraded, upper: up, lower: lo};
    }
  }
  md.push('| set | kind | rows | S0 | S1 | S2 | S3 | S4 | NONE | good enough (S0-S2) | catastrophic S4 upper | catastrophic S4 lower | ungraded |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |');
  for (const [name, kinds] of Object.entries(out.sets)) for (const [kind, v] of Object.entries(kinds)) {
    const c = v.upper.counts;
    md.push(`| ${name} | ${kind} | ${v.rows} | ${c.S0} | ${c.S1} | ${c.S2} | ${c.S3} | ${c.S4} | ${c.NONE} | ${fmt(v.upper.good_enough)} | ${fmt(v.upper.catastrophic)} | ${fmt(v.lower.catastrophic)} | ${v.ungraded} |`);
  }
  md.push('', '## Examples (10 per severity, upper estimate; A = reference or input, B = output)', '');
  for (const name of ['sp-it2-test', 'lp-it2-test600']) {
    const graded = readJsonl(path.join(APPLY, `${name}.graded.jsonl`));
    md.push(`### ${name}`, '');
    for (const sev of SEVERITIES) {
      const ex = graded.filter(r => r.severity === sev && r.a !== r.b).slice(0, 10);
      if (!ex.length) continue;
      md.push(`**${sev}** (${graded.filter(r => r.severity === sev).length})`, '');
      for (const r of ex) md.push(`- [${r.layer}${r.judge_grok ? ` ${r.judge_grok}/${r.judge_glm}` : ''}] A: ${JSON.stringify(r.a.slice(0, 150))} B: ${JSON.stringify(r.b.slice(0, 150))}`);
      md.push('');
    }
  }
  fs.writeFileSync(path.join(APPLY, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync(path.join(APPLY, 'apply.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'pairs') await pairs(); else if (cmd === 'local') await local(); else if (cmd === 'folders') folders(); else if (cmd === 'report') report();
  else { console.error('usage: pairs | local | folders | report'); process.exit(2); }
}
