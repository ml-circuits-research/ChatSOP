#!/usr/bin/env node
/** Calibration report of the severity grader: judges (Grok, GLM) and the cascade against the gold severities of the calibration set. Writes eval/reports/current/severity/calibration.json and calibration.md. */
import fs from 'node:fs';
import path from 'node:path';
import {SEV_DIR, loadCalibration} from './severity-calibration.mjs';
import {loadVerdicts} from './severity-judge.mjs';
import {readJsonl} from './severity-local.mjs';
import {confusion, summaryMetrics, matrixMarkdown, fmt, wilson} from './severity/metrics.mjs';
import {isGoodEnough, rank} from './severity/scale.mjs';

const cal = loadCalibration();
const local = new Map(readJsonl(path.join(SEV_DIR, 'calibration-local.jsonl')).map(r => [r.id, r.local]));
const judges = {grok: loadVerdicts('severity_judge_grok'), glm: loadVerdicts('severity_judge_glm')};
const ensembleMax = (a, b) => (a && b ? (rank(a) >= rank(b) ? a : b) : a ?? b);
const ensembleMin = (a, b) => (a && b ? (rank(a) <= rank(b) ? a : b) : a ?? b);
const judgeOf = (name, id) => (name === 'max' ? ensembleMax(judges.grok.get(id), judges.glm.get(id)) : name === 'min' ? ensembleMin(judges.grok.get(id), judges.glm.get(id)) : judges[name].get(id) ?? null);
const pairsOf = fn => cal.map(r => ({id: r.id, gold: r.severity, pred: fn(r)}));

const cascade = (judge, {confirmLocalS4 = false} = {}) => r => {
  const l = local.get(r.id);
  if (l.decided) {
    if (confirmLocalS4 && l.severity === 'S4') { const j = judgeOf(judge, r.id); return j ?? 'S4'; }
    return l.severity;
  }
  return judgeOf(judge, r.id);
};
const arms = {
  'judge grok (all items, no local layers)': pairsOf(r => judgeOf('grok', r.id)),
  'judge glm (all items, no local layers)': pairsOf(r => judgeOf('glm', r.id)),
  'judge max(grok, glm) (worse of the two)': pairsOf(r => judgeOf('max', r.id)),
  'local layers only (undecided = unjudged)': pairsOf(r => (local.get(r.id).decided ? local.get(r.id).severity : null)),
  'cascade local + grok': pairsOf(cascade('grok')),
  'cascade local + glm': pairsOf(cascade('glm')),
  'cascade local + max(grok, glm) (upper bound: either judge says S4)': pairsOf(cascade('max')),
  'cascade local + min(grok, glm) (lower bound: both judges say S4)': pairsOf(cascade('min')),
  'cascade local + grok, S4 of the local layers confirmed by grok': pairsOf(cascade('grok', {confirmLocalS4: true})),
};
const out = {generated_at: new Date().toISOString(), items: cal.length, local_decided: [...local.values()].filter(l => l.decided).length, arms: {}};
const md = ['# Severity grader calibration', '', `Calibration set: ${cal.length} items (meaning-judge v2 labels, typed negatives mapped to S0-S4, 105 hand-written hard negatives and the case-by-case typed negatives hand-assigned). Local layers decide ${out.local_decided} items (layer 1 mechanical, layer 2 analysis comparison: equivalent only); the rest is the residue for the LLM judge.`, ''];
const gold = Object.fromEntries(['S0', 'S1', 'S2', 'S3', 'S4'].map(s => [s, cal.filter(r => r.severity === s).length]));
md.push(`Gold distribution: ${JSON.stringify(gold)}`, '');
md.push('| arm | exact | within one step | S4 recall | S4 missed as good (S0-S2) | false S4 (gold below S4) | S4 precision | good-enough agreement |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, pairs] of Object.entries(arms)) {
  const m = summaryMetrics(pairs.filter(p => p.pred !== null || name.startsWith('local')));
  out.arms[name] = {metrics: summaryMetrics(pairs), confusion: confusion(pairs)};
  md.push(`| ${name} | ${fmt(m.exact)} | ${fmt(m.within_one_step)} | ${fmt(m.s4_recall)} | ${fmt(m.s4_missed_as_good)} | ${fmt(m.false_s4)} | ${fmt(m.s4_precision)} | ${fmt(m.good_enough_agreement)} |`);
}
for (const [name, pairs] of Object.entries(arms)) md.push('', `## Confusion matrix: ${name}`, '', matrixMarkdown(out.arms[name].confusion));
// by type recall for the judges
md.push('', '## S4 recall by negative type (judge max, cascade local + max)', '', '| type | gold S4 items | judge max | cascade |', '| --- | ---: | ---: | ---: |');
const types = [...new Set(cal.filter(r => r.severity === 'S4').map(r => r.type))];
for (const t of types) {
  const items = cal.filter(r => r.severity === 'S4' && r.type === t);
  const a = items.filter(r => judgeOf('max', r.id) === 'S4').length, b = items.filter(r => cascade('max')(r) === 'S4').length;
  md.push(`| ${t} | ${items.length} | ${a} | ${b} |`);
}
md.push('', '## False S4 split by gold severity (S3 is the neighbouring level, S0-S2 are hard false alarms)', '', '| arm | gold S3 called S4 | gold S0-S2 called S4 |', '| --- | --- | --- |');
for (const [name, pairs] of Object.entries(arms)) {
  const s3 = pairs.filter(p => p.gold === 'S3'), low = pairs.filter(p => ['S0', 'S1', 'S2'].includes(p.gold));
  md.push(`| ${name} | ${fmt(wilson(s3.filter(p => p.pred === 'S4').length, s3.length))} | ${fmt(wilson(low.filter(p => p.pred === 'S4').length, low.length))} |`);
}
const missed = cal.filter(r => r.severity === 'S4' && cascade('max')(r) !== 'S4');
md.push('', `## S4 items the cascade (local + max) does not call S4: ${missed.length}`, '');
for (const r of missed.slice(0, 40)) md.push(`- ${r.id} [${r.type}] judged ${cascade('max')(r)} (grok ${judgeOf('grok', r.id)}, glm ${judgeOf('glm', r.id)}): "${r.message.slice(0, 110)}" => "${r.candidate.slice(0, 110)}"`);
const fs4 = cal.filter(r => r.severity !== 'S4' && cascade('max')(r) === 'S4');
md.push('', `## False S4 of the cascade (local + max): ${fs4.length}`, '');
for (const r of fs4.slice(0, 40)) md.push(`- ${r.id} [${r.type}, gold ${r.severity}] local ${local.get(r.id).decided ? local.get(r.id).severity : '-'}, grok ${judgeOf('grok', r.id)}, glm ${judgeOf('glm', r.id)}: "${r.message.slice(0, 100)}" => "${r.candidate.slice(0, 100)}"`);
fs.writeFileSync(path.join(SEV_DIR, 'calibration.json'), JSON.stringify(out, null, 1) + '\n');
fs.writeFileSync(path.join(SEV_DIR, 'calibration.md'), md.join('\n') + '\n');
console.log(md.slice(0, 14).join('\n'));
