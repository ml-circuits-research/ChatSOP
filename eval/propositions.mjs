/**
 * Stated/assumed separation and `basis` metrics (DS021, DS016). They are
 * reported separately from formalization accuracy: canonical match and
 * execution signatures ignore `basis`, and `basis` never changes a result.
 */
import {one} from '../sop/parser.mjs';
import {defaultDictionary} from '../sop/dictionary.mjs';
import {fraction} from './contracts.mjs';

import {foldText, wireItems} from '../sop/wire-items.mjs';

export {foldText, wireItems};

let dictionary = null;
const cache = new Map();
/** Dictionary comparison of two slot strings (`Dictionary.sameMeaning`), memoized; the dictionary loads once. */
export function sameSlot(a, b) {
  if (a.slot !== b.slot) return false;
  if (foldText(a.text) === foldText(b.text)) return true;
  const key = a.slot + '\0' + a.text + '\0' + b.text;
  if (!cache.has(key)) {
    dictionary ??= defaultDictionary();
    cache.set(key, dictionary.sameMeaning(a.text, b.text, a.slot));
  }
  return cache.get(key);
}
/** Tolerant equality of two items: the same skeleton and every slot the same by the dictionary. */
export const sameItemTolerant = (a, b) => a.skeleton === b.skeleton && a.slots.length === b.slots.length && a.slots.every((s, i) => sameSlot(s, b.slots[i]));

/**
 * Multiset matching of gold and predicted items. Strict pairs equal keys; with `tolerant`, the items left over are
 * then paired greedily (gold order) with `sameItemTolerant`, so a tolerant match count is never below the strict
 * one. Items with a null key (unparsable) never match. Returns {matched, goldMatched: Set of gold indices}.
 */
export function matchItems(gold, predicted, {tolerant = false} = {}) {
  const used = new Set(), goldMatched = new Set();
  const pool = new Map();
  predicted.forEach((item, index) => { if (item.key !== null) { if (!pool.has(item.key)) pool.set(item.key, []); pool.get(item.key).push(index); } });
  gold.forEach((item, index) => {
    const list = pool.get(item.key);
    if (list?.length) { used.add(list.shift()); goldMatched.add(index); }
  });
  if (tolerant) gold.forEach((item, index) => {
    if (goldMatched.has(index) || item.key === null) return;
    const at = predicted.findIndex((p, j) => !used.has(j) && p.key !== null && sameItemTolerant(item, p));
    if (at >= 0) { used.add(at); goldMatched.add(index); }
  });
  return {matched: goldMatched.size, goldMatched, predictedMatched: used};
}

/**
 * Keyword propositions of a parsed program, keyed without basis or certainty and without wire ids (`wireItems`);
 * the wire kind is not part of the key. `unparsed` wires are not propositions.
 */
export function propositionsOf(program) {
  const items = wireItems(program.wires);
  return program.wires.map((w, i) => [w, items[i]]).filter(([w]) => w.type === 'stated' || w.type === 'assumed').map(([w, item]) => ({
    id: w.id, kind: w.type, key: item.key.slice(w.type.length), skeleton: item.skeleton.slice(w.type.length), slots: item.slots,
    basis: w.type === 'assumed' && w.fields.basis ? one(w, 'basis') : null,
  }));
}

/** The program with every `assumed.basis` removed; used for basis-blind canonical comparison. */
export const withoutBasis = program => ({...program, wires: program.wires.map(w => w.type === 'assumed' && w.fields.basis
  ? {...w, fields: Object.fromEntries(Object.entries(w.fields).filter(([key]) => key !== 'basis'))} : w)});

/**
 * Pair gold and predicted propositions by identity: folded relation phrase, role values, polarity and validity
 * strings. `tolerant_matched` also pairs, among the propositions left over, those whose relation phrases and quoted
 * values mean the same by the dictionary (`Dictionary.sameMeaning`). `unparsed` wires are counted apart.
 */
export function compareProgramPropositions(goldProgram, predictedProgram) {
  const gold = propositionsOf(goldProgram), predicted = propositionsOf(predictedProgram);
  const tolerant = matchItems(gold, predicted, {tolerant: true});
  const unparsed = program => program.wires.filter(w => w.type === 'unparsed').length;
  const pool = new Map();
  for (const p of predicted) { if (!pool.has(p.key)) pool.set(p.key, []); pool.get(p.key).push(p); }
  const pairs = [];
  let missing = 0;
  for (const g of gold) {
    const list = pool.get(g.key);
    if (!list?.length) { missing++; continue; }
    const same = list.findIndex(p => p.kind === g.kind);
    pairs.push([g, list.splice(same < 0 ? 0 : same, 1)[0]]);
  }
  return {
    gold: gold.length, predicted: predicted.length, matched: pairs.length, missing,
    tolerant_matched: tolerant.matched, gold_unparsed: unparsed(goldProgram), predicted_unparsed: unparsed(predictedProgram),
    extra: [...pool.values()].reduce((n, list) => n + list.length, 0),
    separation_correct: pairs.filter(([g, p]) => g.kind === p.kind).length,
    stated_as_assumed: pairs.filter(([g, p]) => g.kind === 'stated' && p.kind === 'assumed').length,
    assumed_as_stated: pairs.filter(([g, p]) => g.kind === 'assumed' && p.kind === 'stated').length,
    basis: pairs.filter(([g, p]) => g.kind === 'assumed' && p.kind === 'assumed' && g.basis).map(([g, p]) => ({gold: g.basis, predicted: p.basis})),
  };
}

/**
 * Aggregate per-record comparisons. Basis coverage counts labelled gold
 * assumptions whose matched prediction emits any basis; an omitted basis is
 * uncovered, not wrong. Accuracy is exact agreement among covered wires.
 */
export function propositionMetrics(comparisons) {
  const sum = key => comparisons.reduce((n, c) => n + (c[key] ?? 0), 0);
  const basis = comparisons.flatMap(c => c.basis);
  const covered = basis.filter(b => b.predicted !== null);
  const confusion = {};
  for (const b of basis) {
    const row = confusion[b.gold] ??= {};
    const label = b.predicted ?? 'unspecified';
    row[label] = (row[label] ?? 0) + 1;
  }
  return {
    rows_with_propositions: comparisons.filter(c => c.gold || c.predicted).length,
    gold_propositions: sum('gold'), predicted_propositions: sum('predicted'), matched_propositions: sum('matched'),
    proposition_recall: fraction(sum('matched'), sum('gold')),
    proposition_precision: fraction(sum('matched'), sum('predicted')),
    proposition_recall_tolerant: fraction(sum('tolerant_matched'), sum('gold')),
    proposition_precision_tolerant: fraction(sum('tolerant_matched'), sum('predicted')),
    gold_unparsed: sum('gold_unparsed'), predicted_unparsed: sum('predicted_unparsed'),
    separation_accuracy: fraction(sum('separation_correct'), sum('matched')),
    stated_as_assumed: sum('stated_as_assumed'), assumed_as_stated: sum('assumed_as_stated'),
    basis: {labelled: basis.length, coverage: fraction(covered.length, basis.length), accuracy: fraction(covered.filter(b => b.predicted === b.gold).length, covered.length), confusion},
  };
}
