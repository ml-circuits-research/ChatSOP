#!/usr/bin/env node
/**
 * Equivalence of two SHORT answers (owner, 2026-10-03): the symbolic catalog of lib/formalize/equivalence.mjs first (structure, units
 * and entities through the memory, entailment through the reasoner), and only the text that remains goes to the proxy tier `equivalence`
 * (local Qwen3-4B, no fallback), whose one job is to say whether A implies B and B implies A, only for free-text paraphrases: answers
 * with numbers or short labels are decided deterministically (a mismatch is "not equivalent"). The tier is used only with a prompt
 * that has NO false positive and accuracy >= MIN_ACCURACY on the pairs of the labelled calibration set
 * (tools/eval/six-paths/equivalence-calibration.jsonl) that reach it; otherwise the answer is "not equivalent".
 *
 *   node tools/eval/six-paths/equivalence.mjs calibrate     accuracy of every prompt variant (written to state/six-paths/equivalence.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {client, questions, fill, ROOT} from './common.mjs';
import {decide, yesNoOf, numberOf} from '../../../lib/formalize/equivalence.mjs';
import {seedLexicon} from '../../../lib/knowledge-seeds.mjs';
import {deduce} from '../method-library/primitives.mjs';

export const MIN_ACCURACY = 0.9;
const CALIBRATION = fileURLToPath(new URL('./equivalence-calibration.jsonl', import.meta.url));
const fold = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\b(?:the|a|an|option|plan)\b/g, ' ').replace(/[^a-z0-9.%]+/g, ' ').trim();
const near = (h, g) => Math.abs(h - g) <= Math.max(1e-9, 0.005 * Math.abs(g));

/** The memory used by the symbolic checks: the commonsense base (units with facts, entities with labels and aliases). */
let LEX = null;
export const lexicon = () => (LEX ??= seedLexicon('commonsense-v1'));

/** The reasoner for the entailment check: the deduce primitive (closed world over the claim and the rules). */
const entail = async (facts, rules, atom) => { const r = await deduce({facts, rules, question: {ask: 'forced', atom}}); return r.kind === 'yesno' ? r.value : null; };

/** Counts of the deciding checks (reported per round). */
export const STATS = {};

/** The symbolic verdict (lib/formalize/equivalence.mjs) without the tier: true, false, or null (unknown). */
export async function sameDeterministic(a, b, {problem = '', ordered = false} = {}) {
  const r = await decide(a, b, {lexicon: lexicon(), problem, ordered, entail});
  return r.verdict === 'equivalent' ? true : r.verdict === 'different' ? false : null;
}

/** Values of a short answer for the scorer: yes/no, numbers, or the text. */
export function valuesOf(answer) {
  const yn = yesNoOf(answer);
  if (yn !== null && !/\d/.test(String(answer))) return {kind: 'yesno', value: yn};
  const n = numberOf(answer);
  if (n) return {kind: 'number', values: [n.percent ? n.value / 100 : n.value]};
  const nums = [...String(answer).replace(/(\d),(\d{3})/g, '$1$2').matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
  if (yn !== null) return {kind: 'yesno', value: yn};
  if (nums.length === 1) return {kind: 'number', values: nums};
  return {kind: 'text', text: String(answer)};
}

let calibrated = null;
/** The calibrated prompt id and its accuracy (from state/six-paths/equivalence.json), or null when none reaches MIN_ACCURACY. */
export function calibratedPrompt() {
  if (calibrated !== null) return calibrated;
  const f = path.join(ROOT, 'state/six-paths/equivalence.json');
  const c = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  calibrated = c && c.prompt && c.false_positives === 0 && c.accuracy >= MIN_ACCURACY ? c : false;
  return calibrated;
}

const PROMPTS = ['EQ_a', 'EQ_b'];
const readSame = t => (/^\W*(same|yes)\b/i.test(t) ? true : /^\W*(different|no)\b/i.test(t) ? false : null);

/** One tier call with prompt `id`: true, false or null. */
async function tierSame(chat, id, a, b) {
  const r = await chat([{role: 'user', content: fill(questions().text(id), {a: String(a), b: String(b)})}], 5);
  return r.ok ? readSame(r.text) : null;
}

/** Whether two short answers state the same result: deterministic, then the calibrated tier, else false. */
export async function equivalent(a, b, {chat = null, problem = '', ordered = false} = {}) {
  const c = calibratedPrompt();
  const tier = c && chat ? (x, y) => tierSame(chat, c.prompt, x, y) : null;
  const r = await decide(a, b, {lexicon: lexicon(), problem, ordered, entail, tier, stats: STATS});
  return r.verdict === 'equivalent';
}

/** Accuracy of every prompt on the calibration set (tier `equivalence`, also on the pairs the deterministic step decides). */
async function calibrate() {
  const pairs = fs.readFileSync(CALIBRATION, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const {chat} = client({tier: 'equivalence', run: 'six-paths-equivalence-calibration', purpose: 'job:six-paths-equivalence'});
  const L = ['# Equivalence tier calibration', '', `${pairs.length} labelled pairs (invented, tools/eval/six-paths/equivalence-calibration.jsonl).`, ''];
  const det = [];
  for (const p of pairs) det.push(await sameDeterministic(p.a, p.b));
  L.push(`Deterministic step: decides ${det.filter(x => x !== null).length}, correct ${pairs.filter((p, i) => det[i] !== null && det[i] === p.same).length}.`, '', '| prompt | accuracy (all pairs) | accuracy (pairs left by the deterministic step) | errors |', '|---|---|---|---|');
  let best = null;
  for (const id of PROMPTS) {
    const got = [];
    for (const p of pairs) got.push(await tierSame(chat, id, p.a, p.b));
    const ok = pairs.filter((p, i) => got[i] === p.same).length;
    const left = pairs.map((p, i) => [p, i]).filter(([, i]) => det[i] === null);
    const okLeft = left.filter(([p, i]) => got[i] === p.same).length;
    const errors = pairs.map((p, i) => (got[i] === p.same ? null : `${p.a} / ${p.b} → ${got[i]}`)).filter(Boolean);
    L.push(`| ${id} | ${ok}/${pairs.length} | ${okLeft}/${left.length} | ${errors.join('; ')} |`);
    const acc = left.length ? okLeft / left.length : ok / pairs.length;
    const fp = left.filter(([p, i]) => got[i] === true && !p.same).length;
    L[L.length - 1] += ` false positives on the tier's pairs: ${fp} |`;
    if (fp === 0 && (!best || acc > best.accuracy)) best = {prompt: id, accuracy: acc, all: ok / pairs.length, false_positives: fp};
  }
  best ??= {prompt: null, accuracy: 0, false_positives: null};
  L.push('', best.prompt ? `Chosen: ${best.prompt} (accuracy ${Math.round(100 * best.accuracy)}% on the pairs the deterministic step leaves, 0 false positives; used only at >= ${Math.round(100 * MIN_ACCURACY)}%).` : 'No prompt without false positives: the tier is not used (not equivalent).');
  fs.mkdirSync(path.join(ROOT, 'state/six-paths'), {recursive: true});
  fs.writeFileSync(path.join(ROOT, 'state/six-paths/equivalence.json'), JSON.stringify(best));
  fs.writeFileSync(path.join(ROOT, 'state/six-paths/equivalence.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) calibrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
