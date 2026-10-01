/** Experiment eval-symbolic-layers-en-v1: structural diff of a rules SOP against its gold and automatic Layer-2
 * miss categories. Every category maps to one blame class: P (parser/input: a wrong lemma or token of a misspelled
 * word), R (rules), C (gold convention), L (language), E (evaluation). The categories are signals; the manual review
 * of half A (eval/reports/current/symbolic-layers/layer2-review-A.json) overrides them per item.
 */
import {parse, one, many, parseMatch, isMatch} from '../../sop/parser.mjs';
import {parseCondition} from '../../sop/conditions.mjs';
import {propositionOf} from '../../sop/propositions.mjs';

export const CLASS_OF = {
  P_typo_relation: 'P', P_typo_value: 'P',
  C_boundary: 'C', C_role: 'C', C_relational_noun: 'C', C_wording: 'C', C_assumed: 'C',
  R_preposition: 'R', R_argument: 'R', R_value_span: 'R', R_polarity: 'R', R_certainty: 'R', R_query_form: 'R', R_missing: 'R', R_extra: 'R', R_remark: 'R',
  R_statement_query: 'R', R_unclear: 'R', R_unclear_false: 'R', R_constraint: 'R', R_time: 'R',
  E_structure_equal: 'E',
};

const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}'? ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const toks = s => fold(s).split(' ').filter(Boolean);
const isVar = v => typeof v === 'string' && /^[?$]/.test(v);
const PREP = new Set(['to', 'after', 'for', 'at', 'in', 'on', 'with', 'of', 'by', 'from', 'about', 'into', 'near', 'under', 'over']);
const REMARK_SUBJECT = /^(the user|we|i|you|it|this|that|they|there|the user's .*)$/i;
function osa(a, b) {
  const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const typoOf = (a, b) => a !== b && a.length >= 3 && b.length >= 3 && osa(a, b) <= (b.length > 5 ? 2 : 1);

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

const literals = p => p.roles.filter(r => r.value !== '?').map(r => fold(r.value));
function alignScore(g, p) {
  const gl = literals(g), pl = literals(p);
  let s = 0;
  for (const v of gl) if (pl.some(x => x === v)) s += 3; else if (pl.some(x => x && v && (x.includes(v) || v.includes(x)))) s += 2;
  const gr = toks(g.relation), pr = toks(p.relation);
  s += gr.filter(t => pr.includes(t) || pr.some(x => typoOf(x, t))).length;
  if ((g.kind === 'match') === (p.kind === 'match')) s += 0.5;
  return s;
}

/** Categories of one miss: [{cat, detail}]. `executed` says whether assumed wires are irrelevant (report-only). */
export function diffCategories(predSop, goldSop, {executed = true, message = ''} = {}) {
  const P = programShape(predSop), G = programShape(goldSop);
  const out = [];
  const add = (cat, detail) => out.push({cat, detail});
  if (!P) { add('R_extra', 'prediction does not parse'); return out; }
  if (!G) return out;
  const gu = G.other.find(o => o.type === 'unclear'), pu = P.other.find(o => o.type === 'unclear');
  if (gu && !pu) { add('R_unclear', `gold unclear ${gu.kind}`); return out; }
  if (pu && !gu) { add('R_unclear_false', `predicted unclear ${pu.kind}`); return out; }
  if (gu && pu && gu.kind !== pu.kind) { add('R_unclear', `unclear ${pu.kind} for ${gu.kind}`); return out; }
  if (G.other.some(o => o.type === 'constraint') && !P.other.some(o => o.type === 'constraint')) add('R_constraint', 'numeric constraint not built');
  const pool = [...P.props];
  const pairs = [];
  for (const g of G.props) {
    if (executed && g.kind === 'assumed') { continue; }
    let best = null, bestScore = 0;
    for (const p of pool) { const s = alignScore(g, p); if (s > bestScore) { best = p; bestScore = s; } }
    if (best && bestScore >= 2) { pool.splice(pool.indexOf(best), 1); pairs.push([g, best]); }
    else if (g.kind === 'assumed') add('C_assumed', `gold assumed (${g.basis}) ${g.relation}`);
    else add('R_missing', `${g.kind} "${g.relation}" ${g.roles.map(r => r.name + '=' + r.value).join(' ')}`);
  }
  for (const p of pool) {
    if (p.kind === 'assumed' && executed) continue;
    const subj = p.roles.find(r => r.name === 'subject')?.value ?? '';
    if (p.kind !== 'match' && (REMARK_SUBJECT.test(subj) || !subj)) add('R_remark', `extra ${p.kind} "${p.relation}" subject "${subj}"`);
    else add('R_extra', `extra ${p.kind} "${p.relation}" ${p.roles.map(r => r.name + '=' + r.value).join(' ')}`);
  }
  for (const [g, p] of pairs) {
    if ((g.kind === 'match') !== (p.kind === 'match')) add('R_statement_query', `gold ${g.kind} predicted ${p.kind}: "${g.relation}"`);
    const gr = toks(g.relation), pr = toks(p.relation);
    const relSame = gr.join(' ') === pr.join(' ');
    let relHandled = relSame;
    if (!relSame) {
      const extraG = gr.filter(t => !pr.includes(t)), extraP = pr.filter(t => !gr.includes(t));
      const typo = extraP.some(x => extraG.some(t => typoOf(x, t))) || (extraP.length && extraG.length && typoOf(extraP.join(''), extraG.join('')));
      const valueWords = p.roles.filter(r => r.value !== '?').flatMap(r => toks(r.value));
      const gValueWords = g.roles.filter(r => r.value !== '?').flatMap(r => toks(r.value));
      if (typo) { add('P_typo_relation', `"${p.relation}" for "${g.relation}"`); relHandled = true; }
      else if (extraG.length && !extraP.length && extraG.every(t => valueWords.includes(t) || ['a', 'an', 'the'].includes(t)) && extraG.some(t => !PREP.has(t))) { add('C_boundary', `gold packs "${extraG.join(' ')}" into "${g.relation}"; rules: "${p.relation}" + value`); relHandled = true; }
      else if (extraP.length && !extraG.length && extraP.every(t => gValueWords.includes(t) || ['a', 'an', 'the', 'be'].includes(t)) && extraP.some(t => !PREP.has(t) && t !== 'be')) { add('C_boundary', `rules pack "${extraP.join(' ')}" into "${p.relation}"; gold "${g.relation}" + value`); relHandled = true; }
      else if ([...extraG, ...extraP].every(t => PREP.has(t))) { add('R_preposition', `"${p.relation}" for "${g.relation}"`); relHandled = true; }
      else if (extraP.every(t => PREP.has(t) || t === 'be') && extraG.every(t => PREP.has(t) || t === 'be')) { add('R_preposition', `"${p.relation}" for "${g.relation}"`); relHandled = true; }
    }
    // Roles and values.
    const gm = new Map(g.roles.map(r => [r.name, r.value])), pm = new Map(p.roles.map(r => [r.name, r.value]));
    for (const [name, gv] of gm) {
      const pv = pm.get(name);
      if (pv === undefined) {
        const other = [...pm].find(([n, v]) => !gm.has(n) && (v === '?') === (gv === '?') && (gv === '?' || fold(v) === fold(gv) || fold(v).includes(fold(gv)) || fold(gv).includes(fold(v))));
        if (other) {
          const swap = ['subject', 'object'].includes(name) && ['subject', 'object'].includes(other[0]);
          add(swap ? 'R_argument' : 'C_role', `${other[0]} for ${name} (${gv})`);
          if (fold(other[1]) !== fold(gv) && gv !== '?') add(fold(other[1]).includes(fold(gv)) ? 'R_value_span' : 'R_value_span', `"${other[1]}" for "${gv}"`);
          pm.delete(other[0]);
        } else if (gv === '?' && name === 'time') add('R_query_form', 'role time ?t missing');
        else if (!(!relHandled && false)) {
          // A gold value absorbed in the rules' relation (boundary) was already counted.
          if (!out.some(o => o.cat === 'C_boundary' && o.detail.includes(p.relation))) add(gv === '?' ? 'R_query_form' : 'R_missing', `role ${name} ${gv} missing`);
        }
        continue;
      }
      pm.delete(name);
      if (gv === '?' || pv === '?') { if ((gv === '?') !== (pv === '?')) add('R_query_form', `role ${name}: ${pv} for ${gv}`); continue; }
      const a = fold(pv), b = fold(gv);
      if (a === b) continue;
      const at = toks(pv), bt = toks(gv);
      if (at.length === bt.length && at.every((t, i) => t === bt[i] || typoOf(t, bt[i]))) add('P_typo_value', `"${pv}" for "${gv}"`);
      else if (a.includes(b) || b.includes(a)) add('R_value_span', `"${pv}" for "${gv}"`);
      else add('R_value_span', `"${pv}" for "${gv}" (different)`);
    }
    for (const [name, pv] of pm) {
      if (out.some(o => o.cat === 'C_boundary' && o.detail.includes(p.relation))) continue;
      const gAll = g.roles.map(r => fold(r.value)).join(' ');
      if (pv !== '?' && gAll.includes(fold(pv))) add('R_value_span', `split: ${name} "${pv}" belongs inside a gold value`);
      else if (name === 'time' || /\d{4}|monday|tuesday|morning/.test(fold(pv))) add('R_time', `extra role ${name} ${pv}`);
      else add('R_extra', `extra role ${name} ${pv}`);
    }
    if (g.polarity !== p.polarity) add('R_polarity', `${p.polarity} for ${g.polarity}: "${g.relation}"`);
    if (g.kind === 'stated' && p.kind === 'stated' && g.certainty !== p.certainty) add('R_certainty', `${p.certainty} for ${g.certainty}`);
    if (g.kind === 'stated' && p.kind === 'stated' && g.speaker !== p.speaker) add('R_certainty', `speaker ${p.speaker} for ${g.speaker}`);
    if (g.kind !== 'match' && p.kind !== 'match' && JSON.stringify(g.valid) !== JSON.stringify(p.valid)) add('R_time', `valid ${JSON.stringify(p.valid)} for ${JSON.stringify(g.valid)}`);
    if (!relHandled) add('C_wording', `"${p.relation}" for "${g.relation}"`);
  }
  // Query-level form: compare the queries in order.
  const gq = G.queries, pq = P.queries;
  if (gq.length !== pq.length && !out.some(o => o.cat === 'R_missing' || o.cat === 'R_statement_query')) add('R_query_form', `${pq.length} queries for ${gq.length}`);
  for (let i = 0; i < Math.min(gq.length, pq.length); i++) {
    const a = gq[i], b = pq[i];
    for (const k of ['mode', 'measure', 'rank', 'except', 'compare', 'fragment', 'quantifier', 'order', 'time']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) add(k === 'time' ? 'R_time' : 'R_query_form', `${k}: ${JSON.stringify(b[k])} for ${JSON.stringify(a[k])}`);
    if (a.select !== b.select) add('R_query_form', `select ${b.select} for ${a.select}`);
    if (a.blocks > b.blocks && !out.some(o => o.cat === 'R_missing')) add('C_relational_noun', `${b.blocks} match blocks for ${a.blocks}`);
  }
  void message;
  return out;
}

/** Blame classes of a category list, deduplicated, in a fixed order. */
export const classesOf = cats => ['P', 'L', 'R', 'C', 'E'].filter(c => cats.some(x => CLASS_OF[x.cat] === c));
