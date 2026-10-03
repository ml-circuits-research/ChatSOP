/**
 * The judge of the six-paths experiment: the book's answer, never another model's solution. Owner requirement (2026-10-03): every
 * answer scored wrong is checked for a mismatch of FORMAT only, deterministically first:
 *   numbers     tolerance (0.5% relative), the gold's own rounding (an answer that rounds to the gold at the gold's decimals),
 *               a percentage against its fraction (44.1 and 0.441);
 *   units       a conversion between two units of one dimension, both named in the problem or the gold answer, through the memory's
 *               unit facts (config/knowledge/commonsense-v1 `dimension_of`, `base_amount`, with the units' labels and aliases);
 *   clock       a clock time in the gold text (7:30, 7:30 pm) against minutes since midnight or hours;
 *   parts       a multi-part gold of which the answer gives the asked parts (every answered value is a gold value);
 *   yes/no      a gold text that starts with yes or no ("Yes, 28") against a yes/no answer;
 *   names/lists a set comparison of folded names (case, accents, articles, order).
 * Only an answer that stays wrong and is a text (a name) goes to one cached judge call on tier `small`, which compares the answer with
 * the gold (never solves). Gold defects are found structurally: the gold value is not among the numbers of the gold's own answer text.
 * Verdicts: correct (strict), format (correct after normalization; listed apart so the strict scorer can be fixed), wrong, no_result,
 * gold_defect. This is evaluation code reading the gold; it is never product code.
 */
import fs from 'node:fs';
import path from 'node:path';
import {goldOf} from '../formalization-regression/expression.mjs';
import {ROOT} from './common.mjs';

const fold = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/^(?:the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The gold of an item: number(s), yes/no, or names; null when the answer is an explanation (not scored here). */
export function goldFor(item) {
  const g = rawGold(item);
  // A numeric gold whose answer text's first sentence states none of its numbers ("Neither. Friday last ticket 11:30.", "The table.
  // Double of 40 would be 80.") is a text answer with incidental numbers: a structural gold defect, not scored and not sampled.
  if (g?.kind === 'number' && item.answer) {
    const first = String(item.answer).split(/(?<=[.!?])\s+/)[0].replace(/(\d),(\d{3})/g, '$1$2');
    const nums = [...first.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
    if (!g.values.some(v => nums.some(t => near(t, v) || near(t / 100, v) || near(t * 100, v)))) return {kind: 'defect', why: 'the gold numbers are incidental to a text answer', text: item.answer};
  }
  return g;
}

function rawGold(item) {
  const g = goldOf(item);
  if (g) return {...g, text: item.answer ?? ''};
  const v = item.answer_value;
  if (item.answer_kind === 'entity' && typeof v === 'string' && v.trim()) return {kind: 'names', values: v.split(/\s*,\s*/).map(fold).filter(Boolean), ordered: v.includes(','), text: item.answer ?? ''};
  if (item.answer_kind === 'list' && Array.isArray(v) && v.length && v.every(x => typeof x === 'number')) return {kind: 'number', values: v, text: item.answer ?? ''};
  if (item.answer_kind === 'list' && Array.isArray(v) && v.length && v.every(x => typeof x === 'string')) return {kind: 'names', values: v.map(fold), text: item.answer ?? ''};
  return null;
}

// ---------------------------------------------------------------- units from the memory's unit facts
let UNITS = null;
function units() {
  if (UNITS) return UNITS;
  const dir = path.join(ROOT, 'config/knowledge');
  const names = new Map(), dim = new Map(), base = new Map();
  for (const layer of ['core-min', 'core-en', 'commonsense-v1']) {
    const d = path.join(dir, layer);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter(x => x.endsWith('.sop'))) {
      let cur = null;
      for (const line of fs.readFileSync(path.join(d, f), 'utf8').split('\n')) {
        let m;
        if ((m = /^@(\S+)\s+entity\b/.exec(line))) { cur = m[1]; continue; }
        if (/^@/.test(line)) cur = null;
        if (cur && (m = /^\s+(?:label|alias)\s+en\s+"([^"]+)"/.exec(line))) { if (!names.has(cur)) names.set(cur, []); names.get(cur).push(m[1].toLowerCase()); }
        if ((m = /^\s+holds\s+dimension_of\s+(\S+)\s+(\S+)/.exec(line))) dim.set(m[1], m[2]);
        if ((m = /^\s+holds\s+base_amount\s+(\S+)\s+(\S+)/.exec(line))) base.set(m[1], Number(m[2]));
      }
    }
  }
  UNITS = [...base].filter(([u]) => dim.has(u)).map(([u, b]) => ({id: u, dim: dim.get(u), base: b, names: [u.replace(/^cs_u_/, '').replace(/_/g, ' '), ...(names.get(u) ?? [])]}));
  return UNITS;
}
/** The memory's units named in a text (labels and aliases of config/knowledge unit entities with a base amount). */
export const unitsIn = text => units().filter(u => mentioned(u, text));
const mentioned = (u, text) => u.names.some(n => n.length > 1 && new RegExp(`(?<![a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i').test(text));

const near = (h, g, rel = 0.005) => Math.abs(h - g) <= Math.max(1e-9, rel * Math.abs(g));
const decimalsOf = g => { const s = String(g); return s.includes('.') ? s.split('.')[1].length : 0; };
const roundsTo = (h, g) => { const d = decimalsOf(g); return d >= 1 && Number(h.toFixed(d)) === g; };

/** Why a number `h` equals gold `g` up to format, or null. */
function numberFormat(h, g, ctx) {
  if (roundsTo(h, g)) return 'rounding';
  if (near(h * 100, g) || near(h / 100, g)) return 'percent';
  for (const a of ctx.units) for (const b of ctx.units) if (a !== b && a.dim === b.dim && near(h * a.base / b.base, g)) return `unit ${a.names[0]}→${b.names[0]}`;
  for (const c of ctx.clock) if (near(h, c.minutes) || near(h, c.hours) || near(h, c.minutes % 720) || near(h * 60, c.minutes)) return 'clock';
  return null;
}

/**
 * The verdict of an answer list against an item: {verdict, why}. `answers` are the executed values in order (null = no result).
 */
export function judgeDeterministic(item, gold, answers) {
  if (!answers || !answers.length) return {verdict: 'no_result'};
  const vs = answers.filter(v => v !== null && v !== undefined).flat();
  const text = `${item.question}\n${gold.text}`;
  if (gold.kind === 'yes_no') {
    const b = vs.find(v => typeof v === 'boolean');
    if (b === undefined) return {verdict: 'wrong', why: 'no yes/no answer'};
    return b === gold.value ? {verdict: 'correct'} : {verdict: 'wrong'};
  }
  if (gold.kind === 'number') {
    const nums = vs.filter(v => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))).map(Number);
    const strict = nums.length && gold.values.every(g => nums.some(h => near(h, g) || (gold.percent && near(h * 100, g))));
    if (strict) return {verdict: 'correct'};
    const yn = /^\s*(yes|no)\b/i.exec(gold.text);
    if (yn && vs.some(v => typeof v === 'boolean')) return vs.find(v => typeof v === 'boolean') === (yn[1].toLowerCase() === 'yes') ? {verdict: 'format', why: 'yes/no in the gold text'} : {verdict: 'wrong'};
    if (!nums.length) return {verdict: 'wrong', why: 'no number'};
    const ctx = {units: units().filter(u => mentioned(u, text)), clock: [...gold.text.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/gi)].map(m => { let h = Number(m[1]) % 12 + (/p/i.test(m[3] ?? '') ? 12 : 0); if (!m[3]) h = Number(m[1]); const minutes = h * 60 + Number(m[2]); return {minutes, hours: minutes / 60}; })};
    const why = [];
    const all = gold.values.every(g => nums.some(h => { if (near(h, g)) return true; const w = numberFormat(h, g, ctx); if (w) why.push(w); return Boolean(w); }));
    if (all) return {verdict: 'format', why: [...new Set(why)].join(', ') || 'tolerance'};
    // A multi-part gold of which the answer gives the asked part(s): every answered number is a gold number.
    if (gold.values.length > 1 && nums.every(h => gold.values.some(g => near(h, g) || numberFormat(h, g, ctx)))) return {verdict: 'format', why: 'answered part of a multi-part gold'};
    // A clock gold whose value is minutes in the text.
    return {verdict: 'wrong'};
  }
  if (gold.kind === 'names') {
    const got = vs.map(v => (typeof v === 'string' ? fold(v) : typeof v === 'number' ? String(v) : null)).filter(Boolean);
    if (!got.length) return {verdict: 'wrong', why: 'no name'};
    const a = new Set(got), b = new Set(gold.values);
    if (got.length === gold.values.length && got.every((x, i) => x === gold.values[i])) return {verdict: 'correct'};
    if (a.size === b.size && [...a].every(x => b.has(x))) return {verdict: gold.ordered ? 'wrong' : 'format', why: gold.ordered ? 'order differs' : 'order'};
    if ([...b].every(x => [...a].some(y => y.includes(x) || x.includes(y))) && a.size === b.size) return {verdict: 'format', why: 'name form'};
    return {verdict: 'wrong', judge: true};
  }
  return {verdict: 'wrong'};
}

/** Structural gold defect: the gold numbers are absent from the numbers of the gold's own answer text. */
export function goldDefect(item, gold) {
  if (gold.kind !== 'number' || !gold.text) return null;
  const inText = [...String(gold.text).replace(/(\d),(\d{3})/g, '$1$2').matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
  if (!inText.length) return null;
  return gold.values.every(g => inText.some(t => near(t, g) || near(t / 100, g) || near(t * 100, g))) ? null : `gold value ${gold.values.join(', ')} is not in its answer text`;
}

/**
 * Gold defects found by the controlling agent while reviewing traces (local, gitignored: they name book problems): one JSON line
 * {id, why} per problem whose stored answer value contradicts its own answer text.
 */
export const REVIEWED_DEFECTS = path.join(ROOT, 'datasets_sources/six-paths/gold-defects.jsonl');
let reviewedCache = null;
const reviewedDefects = () => (reviewedCache ??= new Map(fs.existsSync(REVIEWED_DEFECTS) ? fs.readFileSync(REVIEWED_DEFECTS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r.why]) : []));

/** One cached judge call (tier `small`) for a remaining text answer: compares, never solves. */
export async function judgeText(chat, gold, answers) {
  const prompt = `Gold answer of a problem: ${gold.text}\nCandidate answer: ${answers.map(a => JSON.stringify(a)).join(', ')}\n\nDo the two answers state the same result, possibly in another format (other units, rounding, naming, order)? Do not solve the problem. Reply with one word: same or different.`;
  const r = await chat([{role: 'user', content: prompt}], 10);
  if (!r.ok) return null;
  return /^\W*same\b/i.test(r.text) ? 'same' : /^\W*different\b/i.test(r.text) ? 'different' : null;
}

/** The full verdict: deterministic, then the gold defect check, then the judge for remaining names. */
export async function verdictOf(item, answers, {chat = null} = {}) {
  const gold = goldFor(item);
  if (!gold) return {verdict: 'unscorable'};
  if (gold.kind === 'defect') return {verdict: 'gold_defect', why: gold.why};
  const reviewed = reviewedDefects().get(item.id);
  if (reviewed) return {verdict: 'gold_defect', why: `reviewed: ${reviewed}`};
  const d = judgeDeterministic(item, gold, answers);
  if (d.verdict === 'wrong') {
    const defect = goldDefect(item, gold);
    if (defect) return {verdict: 'gold_defect', why: defect};
    if (d.judge && chat) { const j = await judgeText(chat, gold, answers); if (j === 'same') return {verdict: 'format', why: 'judge: same result'}; }
  }
  return d;
}

/** Correct for the tables: strict or format-only. */
export const isCorrect = v => v === 'correct' || v === 'format';
