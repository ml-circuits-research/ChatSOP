#!/usr/bin/env node
/**
 * Judging and reporting of the translate-compare study (eval/reports/current/translate-compare/, 2026-10-01), CPU only, judges through omp task folders.
 *   node tools/eval/translate-compare/judge.mjs pairs  --stage s1 --messages 60 [--arms a,b,...] [--glm-sessions 3]
 *   node tools/eval/translate-compare/judge.mjs report --messages 60|all [--arms a,b,...] [--out FILE.json]
 * Every arm is judged the same way as the `natural` suite (tools/eval/natural-score.mjs): per original SENTENCE against its own translation, and per MESSAGE
 * against the arm's sentences joined, by Grok `grok-4.20-0309-non-reasoning` and GLM `glm-5.3-flash`, with the severity prompt of lib/severity/judge-prompt.mjs
 * PLUS three study rules (owner decisions of 2026-10-01): a project term kept verbatim or quoted is not a meaning change; a correct pronoun resolution is
 * not an error; a misspelled word is read as the intended word. Upper = the worse judge, lower = the milder; where the judges disagree on S3 or S4 the case is
 * "excusable ambiguity" and is reported apart. Verdicts live in datasets_sources/tc_<stage>_<judge>[N]/ and are shared by pair id (a pair is judged once).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {JUDGE_SYSTEM} from '../../../lib/severity/judge-prompt.mjs';
import {folder} from '../severity-calibration.mjs';
import {loadVerdicts} from '../severity-judge.mjs';
import {pairId} from '../severity-apply.mjs';
import {rank} from '../../../lib/severity/scale.mjs';
import {wilson} from '../../../lib/severity/metrics.mjs';
import {T, sentences, readArm, armNames, readJsonl, writeJsonl, wordCount} from './lib.mjs';

export const SYSTEM_V2 = JUDGE_SYSTEM.replace(/\n\nAnswer with one JSON object[\s\S]*$/, '') + `

Rules for this study (the ORIGINAL is a message from a software developer to an AI assistant, usually Romanian written without diacritics and with typos; the REWRITE is its English translation):
- A project term, code name, file name, identifier or English word that the REWRITE keeps verbatim, or inside quotation marks, is NOT a meaning change.
- A pronoun that resolves a dropped Romanian subject correctly ("I", "you", "we", "it") is not an error.
- A word the ORIGINAL misspells is read as the word the writer meant; translating the intended word is correct.
- Judge the meaning, not the style: a stiff but correct translation is S0 or S1.

Answer with one JSON object and nothing else: {"severity": "S0|S1|S2|S3|S4", "reason": "<at most 20 words>"}`;

const [cmd, ...rest] = process.argv[1] === new URL(import.meta.url).pathname ? process.argv.slice(2) : [];
const val = k => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : null);
const messagesLimit = val('--messages') && val('--messages') !== 'all' ? Number(val('--messages')) : Infinity;
const wantArms = val('--arms') ? val('--arms').split(',') : null;

export const loadJudges = () => ({g: judgeMap('grok'), z: judgeMap('glm')});
export {units, sevOf};
const tcStages = () => fs.readdirSync(path.join(ROOT, 'datasets_sources')).filter(n => /^tc_s\w+_(grok|glm\d*)$/.test(n));
const judgeMap = judge => new Map(tcStages().filter(n => n.replace(/^tc_s\w+_/, '').replace(/\d+$/, '') === judge).flatMap(n => fs.existsSync(path.join(ROOT, 'datasets_sources', n, 'output/verdicts.jsonl')) ? [...loadVerdicts(n)] : []));

/** Units of one arm inside the first `limit` messages: sentence pairs and message pairs. */
function units(armName, limit) {
  const arm = readArm(armName), out = [], byMsg = new Map();
  for (const s of sentences()) {
    if (s.mi >= limit) continue;
    const r = arm.get(s.id);
    if (!r || r.out === undefined) continue;
    out.push({arm: armName, level: 'sentence', key: s.id, w: s.words, a: s.text, b: r.out, ms: r.ms});
    const m = byMsg.get(s.msg) ?? byMsg.set(s.msg, {mi: s.mi, parts: [], orig: [], complete: true}).get(s.msg);
    m.parts.push(r.out); m.orig.push(s.text);
  }
  for (const [msg, m] of byMsg) out.push({arm: armName, level: 'message', key: msg, w: wordCount(m.orig.join(' ')), a: m.orig.join(' '), b: m.parts.join(' ')});
  return out.filter(u => u.b.trim() || true);
}
/** The original message text for a message pair is the sentences joined (the host splitter's sentences, whitespace-normalised), identical for every arm. */

function pairs() {
  const stage = val('--stage') ?? 's1';
  const arms = wantArms ?? armNames();
  const have = new Set([...judgeMap('grok').keys()].filter(id => judgeMap('glm').has(id)));
  const todo = new Map();
  for (const name of arms) for (const u of units(name, messagesLimit)) { if (!u.b.trim()) continue; const id = pairId({a: u.a, b: u.b}); if (!have.has(id)) todo.set(id, {id, message: u.a, candidate: u.b}); }
  const list = [...todo.values()];
  const sessions = Number(val('--glm-sessions') ?? 3);
  const made = [];
  made.push(folder(`tc_${stage}_grok`, list, {system: SYSTEM_V2}).dir);
  for (let k = 0; k < sessions; k++) made.push(folder(`tc_${stage}_glm${k + 1}`, list.filter((_, i) => i % sessions === k), {system: SYSTEM_V2}).dir);
  console.log(JSON.stringify({stage, arms, pairs: list.length, folders: made.map(d => path.relative(ROOT, d))}));
}

const sevOf = (id, g, z) => {
  const a = g.get(id) ?? null, b = z.get(id) ?? null;
  const up = a && b ? (rank(a) >= rank(b) ? a : b) : a ?? b, lo = a && b ? (rank(a) <= rank(b) ? a : b) : a ?? b;
  return {upper: up, lower: lo, grok: a, glm: b};
};
const bad = (s, which) => s[which] && rank(s[which]) >= 3;
const share = (k, n) => ({k, n, rate: n ? k / n : null, ci: n ? wilson(k, n) : null});
const pct = s => (s.rate === null ? 'n/a' : `${(100 * s.rate).toFixed(1)}%`);
const SB = [['<8', w => w < 8], ['8-20', w => w >= 8 && w <= 20], ['21-40', w => w > 20 && w <= 40], ['>40', w => w > 40]];
const MB = [['<15', w => w < 15], ['15-40', w => w >= 15 && w <= 40], ['>40', w => w > 40]];

export function measure(us, g, z) {
  const j = us.map(u => ({...u, sev: sevOf(pairId({a: u.a, b: u.b}), g, z)})).filter(u => u.sev.upper);
  const one = list => ({n: list.length,
    good_upper: share(list.filter(u => !bad(u.sev, 'upper')).length, list.length), good_lower: share(list.filter(u => !bad(u.sev, 'lower')).length, list.length),
    s4_upper: share(list.filter(u => u.sev.upper === 'S4').length, list.length),
    firm_s3p: share(list.filter(u => bad(u.sev, 'upper') && bad(u.sev, 'lower')).length, list.length), excusable_s3p: share(list.filter(u => bad(u.sev, 'upper') && !bad(u.sev, 'lower')).length, list.length)});
  const level = (lv, bands) => { const l = j.filter(u => u.level === lv); return {all: one(l), ...Object.fromEntries(bands.map(([n, f]) => [n, one(l.filter(u => f(u.w)))]))}; };
  return {sentence: level('sentence', SB), message: level('message', MB), judged: j.length, rows: j};
}

function report() {
  const arms = wantArms ?? armNames();
  const g = judgeMap('grok'), z = judgeMap('glm');
  const out = {generated_at: new Date().toISOString(), messages: Number.isFinite(messagesLimit) ? messagesLimit : 'all', judge_models: {grok: 'xai-oauth/grok-4.20-0309-non-reasoning', glm: 'zai/glm-5.3-flash'}, prompt: 'severity-judge-v1 + study rules (SYSTEM_V2)', arms: {}};
  for (const name of arms) {
    const us = units(name, messagesLimit);
    const m = measure(us, g, z);
    const lat = us.filter(u => u.level === 'sentence' && typeof u.ms === 'number').map(u => u.ms).sort((x, y) => x - y);
    const {rows, ...rest} = m;
    out.arms[name] = {...rest, units: us.length, latency_ms_median: lat.length ? lat[Math.floor(lat.length / 2)] : null};
  }
  const file = val('--out') ?? path.join(T, `report-${Number.isFinite(messagesLimit) ? messagesLimit : 'all'}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  const row = (name, a) => `| ${name} | ${['sentence', 'message'].map(l => `${a[l].all.n} | ${pct(a[l].all.good_upper)} | ${pct(a[l].all.good_lower)} | ${pct(a[l].all.s4_upper)}`).join(' | ')} |`;
  console.log(['| arm | sent n | good(up) | good(lo) | S4 | msg n | good(up) | good(lo) | S4 |', '| --- | ---: | --- | --- | --- | ---: | --- | --- | --- |', ...Object.entries(out.arms).map(([n, a]) => row(n, a))].join('\n'));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const fn = {pairs, report}[cmd];
  if (!fn) { console.error('usage: pairs --stage s1 --messages 60 | report --messages 60|all'); process.exit(2); }
  fn();
}
