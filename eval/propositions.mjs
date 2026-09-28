/**
 * Stated/assumed separation and `basis` metrics (DS021, DS016). They are
 * reported separately from formalization accuracy: canonical match and
 * execution signatures ignore `basis`, and `basis` never changes a result.
 */
import {one} from '../sop/parser.mjs';
import {propositionKey, propositionOf} from '../sop/propositions.mjs';
import {fraction} from './contracts.mjs';

/** Keyword propositions of a parsed program, keyed without basis or certainty. */
export function propositionsOf(program) {
  return program.wires.filter(w => w.type === 'stated' || w.type === 'assumed').map(w => ({
    id: w.id, kind: w.type, key: propositionKey(propositionOf(w)), basis: w.type === 'assumed' && w.fields.basis ? one(w, 'basis') : null,
  }));
}

/** The program with every `assumed.basis` removed; used for basis-blind canonical comparison. */
export const withoutBasis = program => ({...program, wires: program.wires.map(w => w.type === 'assumed' && w.fields.basis
  ? {...w, fields: Object.fromEntries(Object.entries(w.fields).filter(([key]) => key !== 'basis'))} : w)});

/** Pair gold and predicted propositions by identity: folded relation phrase, role values, polarity and validity strings. */
export function compareProgramPropositions(goldProgram, predictedProgram) {
  const gold = propositionsOf(goldProgram), predicted = propositionsOf(predictedProgram);
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
  const sum = key => comparisons.reduce((n, c) => n + c[key], 0);
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
    separation_accuracy: fraction(sum('separation_correct'), sum('matched')),
    stated_as_assumed: sum('stated_as_assumed'), assumed_as_stated: sum('assumed_as_stated'),
    basis: {labelled: basis.length, coverage: fraction(covered.length, basis.length), accuracy: fraction(covered.filter(b => b.predicted === b.gold).length, covered.length), confusion},
  };
}
