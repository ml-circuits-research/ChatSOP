/** The propositions and the query shapes of a program (stated/assumed wires, the match blocks of queries), the input of the severity comparison. */
import {parse, one, many, parseMatch, isMatch} from '../../../sop/parser.mjs';
import {parseCondition} from '../../../sop/conditions.mjs';
import {propositionOf} from '../../../sop/propositions.mjs';

const isVar = v => typeof v === 'string' && /^[?$]/.test(v);

/** Props and query shapes of a program; null when it does not parse. */
export function programShape(sop) {
  let program;
  try { program = parse(String(sop ?? '')); } catch { return null; }
  const props = [], queries = [], other = [];
  for (const w of program.wires) {
    if (w.type === 'stated' || w.type === 'assumed') {
      const p = propositionOf(w);
      props.push({kind: w.type, wire: w.id, relation: p.relation ?? '', roles: p.roles.map(r => ({name: r.name, value: isVar(r.value) || typeof r.value === 'object' ? '?' : String(r.value)})), polarity: p.polarity ?? 'affirmed', certainty: p.certainty ?? null, speaker: p.speaker ?? null, basis: p.basis ?? null, valid: w.fields.valid ?? []});
    } else if (w.type === 'query') {
      const q = {wire: w.id, mode: one(w, 'mode') ?? null, select: (one(w, 'select') ?? '').split(/\s+/).filter(Boolean).length, measure: one(w, 'measure') ?? null, rank: !!w.fields.rank, except: !!w.fields.except, compare: !!w.fields.compare,
        fragment: !!w.fields.fragment, quantifier: one(w, 'quantifier') ?? null, order: !!w.fields.order, time: ['at', 'during', 'asof'].filter(k => w.fields[k]).join(','), blocks: 0};
      for (const text of [...many(w, 'where'), ...many(w, 'scope')]) parseCondition(text, leaf => {
        if (isMatch(leaf)) { const m = parseMatch(leaf, 'm', {partial: true}); q.blocks++; props.push({kind: 'match', wire: w.id, relation: m.relation ?? '', roles: m.roles.map(r => ({name: r.name, value: isVar(r.value) || typeof r.value === 'object' ? '?' : String(r.value)})), polarity: m.polarity ?? 'affirmed'}); }
        return leaf;
      });
      queries.push(q);
    } else other.push({type: w.type, kind: one(w, 'kind') ?? null});
  }
  return {props, queries, other};
}

