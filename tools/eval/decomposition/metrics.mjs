/**
 * Pure metric functions of the decomposition evaluation (DS016 "Decomposition and detectability"). No I/O, no model.
 *
 * Per case and arm the scorer has: the severity of what the user is told (the summary `S` of the interpretation) against what they wrote
 * (`severity`, graded by lib/severity: upper and lower estimates), the severity of the rewritten text itself (`severity_rewrite`),
 * and the interpretation facts: sentences of the analysed text, how many are certified, and whether the interpretation MARKS something
 * (a not-represented span, a sentence shown as uncertain, or a partial-acceptance leftover).
 *   catastrophic           severity S4
 *   failure                severity S3 or S4 (S3: wrong but noticeable, includes a dropped or changed question; S4: catastrophic)
 *   detectable failure     a failure while the interpretation marks something; silent failure: a failure with no marker
 *   acceptable             good enough (S0 to S2), or a failure that is detectable; its complement is the silent failure rate
 */
import {rank, isGoodEnough} from '../../../lib/severity/scale.mjs';
import {wilson} from '../../../lib/severity/metrics.mjs';

/** What the interpretation marks: not-represented spans, sentences shown as uncertain or empty, partial-acceptance leftovers. */
export function markers(interp, {leftovers = []} = {}) {
  if (!interp?.available) return {marked: true, unavailable: true, not_represented: 0, uncertain: 0, leftover: 0, reasons: ['no interpretation']};
  const sentences = interp.sentences ?? [];
  const uncertain = sentences.filter(s => s.status !== 'verified').length;
  const notRepresented = new Set([...(interp.not_represented ?? []), ...sentences.flatMap(s => s.not_represented ?? [])]).size;
  const leftover = sentences.filter(s => leftovers.some(l => l.replace(/\s+/g, ' ').trim().toLowerCase() === String(s.text).replace(/\s+/g, ' ').trim().toLowerCase())).length;
  const reasons = [];
  if (notRepresented) reasons.push('not_represented');
  if (uncertain) reasons.push('uncertain');
  if (leftover) reasons.push('partial_leftover');
  return {marked: reasons.length > 0, unavailable: false, not_represented: notRepresented, uncertain, leftover, reasons};
}

/** The text the user is shown as "I understood": the CNL of every verified sentence, the original wording of a sentence shown as uncertain. */
export function understoodText(interp) {
  if (!interp?.available) return '';
  return (interp.sentences ?? []).map(s => (s.status === 'verified' && s.cnl_sentences?.length ? s.cnl_sentences.join(' ') : String(s.text ?? '').trim())).filter(Boolean).join(' ');
}

export const maxSeverity = (a, b) => (a === null ? b : b === null ? a : rank(b) > rank(a) ? b : a);

/** Counts and rates over case records `{severity, severity_lower, marked, ...}`; `which` picks the estimate (`severity` upper or `severity_lower`). */
export function failureStats(records, which = 'severity') {
  const graded = records.filter(r => r[which]);
  const n = graded.length;
  const sev = r => r[which];
  const c4 = graded.filter(r => sev(r) === 'S4'), c3p = graded.filter(r => rank(sev(r)) >= 3 && sev(r) !== 'NONE'), none = graded.filter(r => sev(r) === 'NONE');
  const good = graded.filter(r => isGoodEnough(sev(r)));
  const silentFail = graded.filter(r => (rank(sev(r)) >= 3) && !r.marked), silent4 = c4.filter(r => !r.marked);
  const w = k => wilson(k, n);
  return {n, ungraded: records.length - n,
    catastrophic: w(c4.length), catastrophic_detectable: w(c4.filter(r => r.marked).length), catastrophic_silent: w(silent4.length),
    failure_s3plus: w(c3p.length + none.length), failure_detectable: w(c3p.filter(r => r.marked).length), silent_meaning_change: w(silentFail.length),
    good_enough: w(good.length), acceptable: w(n - silentFail.length), none: w(none.length)};
}

/** Sentence-count and certification figures of the analysed output texts: `{sentences, certified, expected}` per record. */
export function shapeStats(records) {
  const n = records.length;
  const sum = f => records.reduce((a, r) => a + f(r), 0);
  const sentences = sum(r => r.sentences), certified = sum(r => r.certified_sentences);
  return {n, sentences, certified_sentences: wilson(certified, sentences), all_certified_cases: wilson(records.filter(r => r.all_certified).length, n),
    mean_sentences: n ? sentences / n : null, mean_expected: n ? sum(r => r.expected) / n : null,
    count_equals_expected: wilson(records.filter(r => r.sentences === r.expected).length, n), at_least_expected: wilson(records.filter(r => r.sentences >= r.expected).length, n),
    changed: wilson(records.filter(r => r.changed).length, n), decomposed: wilson(records.filter(r => r.sentences > r.input_sentences).length, n)};
}

/** Exact two-sided sign test (binomial, p = 0.5) on the discordant pairs. */
export function signTest(b, c) {
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  let tail = 0, term = 0.5 ** n; // C(n, 0) * 0.5^n
  for (let i = 0; i <= k; i++) { tail += term; term = term * (n - i) / (i + 1); }
  return Math.min(1, 2 * tail);
}

/** Paired comparison of two arms on the same cases: `fn(record)` is a boolean; returns {a, b, only_a, only_b, p, diff_pp}. */
export function paired(rowsA, rowsB, fn) {
  const byId = new Map(rowsB.map(r => [r.id, r]));
  let onlyA = 0, onlyB = 0, both = 0, n = 0;
  for (const r of rowsA) { const o = byId.get(r.id); if (!o) continue; n++; const x = fn(r), y = fn(o); if (x && y) both++; else if (x) onlyA++; else if (y) onlyB++; }
  return {n, a: both + onlyA, b: both + onlyB, only_a: onlyA, only_b: onlyB, p: signTest(onlyA, onlyB), diff_pp: n ? (100 * (onlyA - onlyB)) / n : null};
}
