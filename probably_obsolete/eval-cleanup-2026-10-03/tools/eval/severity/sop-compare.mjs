/**
 * Interpretation severity (DS012 "Graded severity"): the SOP Lang that SymbolicLM produced for a message against the gold SOP, as S0-S4 or NONE.
 * Pure and deterministic (no model): both programs are reduced to propositions (stated/assumed wires and the match blocks of queries) and query shapes
 * (`programShape` of ./program-shape.mjs), propositions are aligned by shared literals and relation words, and every difference gets a
 * severity from the scale of tools/eval/severity/scale.mjs; the result is the worst one. Order of roles, wire ids and the active/passive form of a relation
 * ("be repaired by" with swapped roles) are not differences. `sopSeverity(pred, gold, {message})` returns {severity, findings}.
 */
import {programShape} from './program-shape.mjs';
import {parse} from '../../../sop/parser.mjs';
import {LINK_WORDS} from '../../../sop/enums.mjs';
import {worst} from './scale.mjs';

export const SOP_COMPARE_VERSION = 'severity-sop-v1';
const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]s\b/g, '').replace(/[^\p{L}\p{N}? ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const DET = new Set(['the', 'a', 'an']);
const valueTokens = v => fold(v).split(' ').filter(t => t && !DET.has(t));
const REL_STOP = new Set(['be', 'a', 'an', 'the', 'of', 'to', 'at', 'in', 'on', 'by', 'for', 'with', 'from', 'as']);
const stem = t => t.replace(/(ing|ed|es|s|d)$/, '');
const relTokens = r => fold(r).split(' ').filter(t => t && !REL_STOP.has(t)).map(stem);
const isVar = v => v === '?';
const typo = (a, b) => a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a) || [...a].filter((c, i) => c !== b[i]).length <= 1 && a.length === b.length);

/** Passive relation `be <participle> by` is the active relation with swapped subject and object. */
function activeForm(p) {
  const m = /^be (\w+) by$/.exec(fold(p.relation));
  if (!m) return p;
  const roles = p.roles.map(r => (r.name === 'subject' ? {...r, name: 'object'} : r.name === 'object' ? {...r, name: 'subject'} : r));
  return {...p, relation: m[1], roles, passive: true};
}

const PRONOUN = new Set(['he', 'she', 'it', 'they', 'them', 'him', 'her', 'his', 'hers', 'its', 'their', 'who', 'someone', 'whoever', 'the user', 'i', 'you', 'we', 'she s', 'he s', 'they both', 'it s']);
function valueSeverity(pv, gv, messageTokens) {
  if (!isVar(pv) && !isVar(gv) && PRONOUN.has(fold(pv)) && !PRONOUN.has(fold(gv))) return {severity: 'S3', why: 'pronoun left unresolved'};
  if (isVar(pv) || isVar(gv)) return isVar(pv) && isVar(gv) ? null : {severity: 'S3', why: 'placeholder versus value'};
  const a = valueTokens(pv), b = valueTokens(gv);
  if (a.join(' ') === b.join(' ')) return null;
  if (a.length === b.length && a.every((t, i) => t === b[i] || typo(t, b[i]))) return null;
  const digits = x => x.filter(t => /\d/.test(t));
  if (digits(a).join() !== digits(b).join()) return {severity: 'S4', why: 'number or date differs'};
  const inA = b.filter(t => a.includes(t) || a.some(x => typo(x, t))).length, inB = a.filter(t => b.includes(t) || b.some(x => typo(x, t))).length;
  if (inA === b.length || inB === a.length) {
    if (a.length > b.length) {
      const extra = a.filter(t => !b.includes(t));
      return {severity: extra.every(t => messageTokens.has(t)) ? 'S2' : 'S4', why: 'value has extra words'};
    }
    return {severity: 'S2', why: 'value lost words'};
  }
  if (inA || inB) return {severity: 'S3', why: 'values overlap partly'};
  return {severity: 'S4', why: 'different entity'};
}

const alignScore = (g, p) => {
  let s = 0;
  const gl = g.roles.filter(r => !isVar(r.value)).flatMap(r => valueTokens(r.value)), pl = p.roles.filter(r => !isVar(r.value)).flatMap(r => valueTokens(r.value));
  for (const t of new Set(gl)) if (pl.includes(t) || pl.some(x => typo(x, t))) s += 1;
  const gr = relTokens(g.relation), pr = relTokens(p.relation);
  s += gr.filter(t => pr.includes(t)).length * 1.5;
  return s;
};

function linkWords(sop) {
  try { return parse(String(sop ?? '')).wires.flatMap(w => LINK_WORDS.filter(k => w.fields[k]).map(() => null).length ? LINK_WORDS.filter(k => w.fields[k]) : []); } catch { return []; }
}
function groupKinds(sop) {
  const out = {all: 0, any: 0};
  for (const l of String(sop ?? '').split('\n')) { const t = l.trim().replace(/^where\s+/, ''); if (t === 'all' || t === 'any') out[t]++; }
  return out;
}

export function sopSeverity(predSop, goldSop, {message = '', outcome = null, synonyms = null} = {}) {
  const findings = [];
  const add = (severity, kind, detail) => findings.push({severity, kind, detail});
  const done = () => ({severity: findings.reduce((a, f) => worst(a, f.severity), 'S0'), findings});
  if (outcome === 'crash') { add('NONE', 'crash', 'SymbolicLM failed'); return done(); }
  const P = predSop && String(predSop).trim() ? programShape(predSop) : null;
  const G = programShape(goldSop);
  if (!G) return {severity: null, findings: [{severity: null, kind: 'no_gold', detail: 'gold does not parse'}]};
  const hasContent = S => S && (S.props.length || S.queries.length || S.other.some(o => o.type === 'constraint'));
  const pUnclear = P?.other.find(o => o.type === 'unclear'), gUnclear = G.other.find(o => o.type === 'unclear');
  const messageTokens = new Set(valueTokens(String(message).replace(/\?/g, ' ')));
  const messageText = ` ${fold(String(message).replace(/\?/g, ' '))} `;
  if (!P || (!hasContent(P) && !pUnclear)) { add('NONE', 'empty', 'no interpretation'); return done(); }
  if (gUnclear) {
    if (pUnclear) { if (pUnclear.kind !== gUnclear.kind) add('S2', 'unclear_kind', `${pUnclear.kind} for ${gUnclear.kind}`); }
    else add('S3', 'gold_unclear', `gold says ${gUnclear.kind} but a content reading was produced`);
    return done();
  }
  if (pUnclear && !hasContent(P)) { add('NONE', 'unclear', `unclear ${pUnclear.kind} where a clear reading exists`); return done(); }
  if (!hasContent(P)) { add('NONE', 'empty', 'only unparsed spans'); return done(); }

  const gProps = G.props.filter(p => p.kind !== 'assumed').map(activeForm), pProps = P.props.filter(p => p.kind !== 'assumed').map(activeForm);
  const pool = [...pProps], pairs = [], gLeft = [...gProps];
  const scored = [];
  gProps.forEach((g, gi) => pProps.forEach((p, pi) => { const sc = alignScore(g, p); if (sc >= 1) scored.push({g, p, sc, d: Math.abs(gi - pi)}); }));
  scored.sort((x, y) => y.sc - x.sc || x.d - y.d);
  for (const c of scored) if (gLeft.includes(c.g) && pool.includes(c.p)) { gLeft.splice(gLeft.indexOf(c.g), 1); pool.splice(pool.indexOf(c.p), 1); pairs.push([c.g, c.p]); }
  for (const g of gLeft) add(pairs.length || pool.length ? 'S2' : 'S3', 'missing', `${g.kind} "${g.relation}" ${g.roles.map(r => r.name + '=' + r.value).join(' ')}`);
  if (gProps.length && !pairs.length && pProps.length) add('S4', 'nothing_aligned', 'no gold proposition has a counterpart (a different interpretation)');
  for (const p of pool) {
    const novel = p.roles.some(r => !isVar(r.value) && valueTokens(r.value).some(t => !messageTokens.has(t) && !/^\d+$/.test(t)));
    add(novel ? 'S4' : 'S3', 'extra', `extra ${p.kind} "${p.relation}" ${p.roles.map(r => r.name + '=' + r.value).join(' ')}`);
  }
  const certaintyRank = {asserted: 2, hedged: 1, supposed: 0};
  for (const [g, p] of pairs) {
    if ((g.kind === 'match') !== (p.kind === 'match')) add(g.kind === 'match' ? 'S4' : 'S3', 'statement_query', `gold ${g.kind} predicted ${p.kind}`);
    if (g.polarity !== p.polarity) add('S4', 'polarity', `${p.polarity} for ${g.polarity}: "${g.relation}"`);
    const gr = relTokens(g.relation), pr = relTokens(p.relation);
    const extraG = gr.filter(t => !pr.includes(t)), extraP = pr.filter(t => !gr.includes(t));
    const dropP0 = !extraP.length ? extraG.map(stem) : [], dropG0 = !extraG.length ? extraP.map(stem) : [];
    const absorbedOf = (extra, roles) => (extra.length ? roles.filter(r => !isVar(r.value) && valueTokens(r.value).length && valueTokens(r.value).every(t => extra.includes(stem(t)))).map(r => r.name) : []);
    const dropP = absorbedOf(dropP0, p.roles), dropG = absorbedOf(dropG0, g.roles);
    if (gr.join(' ') !== pr.join(' ')) {
      const same = gr.length === pr.length && gr.every((t, i) => t === pr[i] || typo(t, pr[i]));
      const subset = gr.every(t => pr.includes(t)) || pr.every(t => gr.includes(t));
      const syn = synonyms && gr.length === 1 && pr.length === 1 && synonyms(gr[0], pr[0]);
      const boundary = (extraG.length && !extraP.length && dropP.length) || (extraP.length && !extraG.length && dropG.length);
      if (same || boundary) { /* typo or boundary convention */ } else if (syn || subset) add('S1', 'relation_wording', `"${p.relation}" for "${g.relation}"`);
      else add('S3', 'relation', `"${p.relation}" for "${g.relation}"`);
    } else if (fold(g.relation) !== fold(p.relation) && !g.passive && !p.passive) add('S1', 'preposition', `"${p.relation}" for "${g.relation}"`);
    // boundary convention: "qualify for the bonus" + subject equals "qualify for" + subject + object "the bonus" (roles in dropP / dropG are absorbed by the other relation)
    const gm = new Map(g.roles.filter(r => !dropG.includes(r.name)).map(r => [r.name, r.value])), pm = new Map(p.roles.filter(r => !dropP.includes(r.name)).map(r => [r.name, r.value]));
    for (const [name, gv] of gm) {
      const pv = pm.get(name);
      if (pv === undefined) {
        const other = [...pm].find(([n, v]) => !gm.has(n) && !isVar(gv) && !isVar(v) && !valueSeverity(v, gv, messageTokens));
        if (other) { add(['subject', 'object'].includes(name) && ['subject', 'object'].includes(other[0]) ? 'S4' : ['subject', 'object'].includes(name) || ['subject', 'object'].includes(other[0]) ? 'S2' : 'S1', 'role', `${gv} is ${other[0]}, gold ${name}`); pm.delete(other[0]); }
        else add(['subject', 'object'].includes(name) ? 'S3' : 'S2', 'role_missing', `role ${name} ${gv}`);
        continue;
      }
      pm.delete(name);
      const v = valueSeverity(pv, gv, messageTokens);
      if (v) {
        const swapped = (name === 'subject' || name === 'object') && [...gm].some(([n2, v2]) => n2 !== name && ['subject', 'object'].includes(n2) && !isVar(pv) && !isVar(v2) && !valueSeverity(pv, v2, messageTokens) && pm.has(n2) && !valueSeverity(pm.get(n2), gv, messageTokens));
        add(swapped ? 'S4' : v.severity, swapped ? 'role_swap' : 'value', `${name}: "${pv}" for "${gv}" (${v.why})`);
      }
    }
    for (const [name, pv] of pm) { if (isVar(pv)) continue; const known = valueTokens(pv).every(t => messageTokens.has(t)); add(known ? 'S2' : 'S4', 'role_extra', `role ${name} "${pv}"`); }
    const gc = certaintyRank[g.certainty ?? 'asserted'] ?? 2, pc = certaintyRank[p.certainty ?? 'asserted'] ?? 2;
    if (gc !== pc) add(pc > gc ? 'S4' : 'S1', 'certainty', `${p.certainty} for ${g.certainty}`);
    if (Boolean(g.speaker) !== Boolean(p.speaker)) add(g.speaker ? 'S4' : 'S3', 'speaker', g.speaker ? 'reported claim became asserted' : 'speaker invented');
    if ((g.kind === 'assumed') !== (p.kind === 'assumed')) add('S1', 'basis', `${p.kind} for ${g.kind}`);
  }
  // queries
  const nq = Math.max(G.queries.length, P.queries.length);
  for (let i = 0; i < Math.min(G.queries.length, P.queries.length); i++) {
    const g = G.queries[i], p = P.queries[i];
    if ((g.mode ?? 'default') !== (p.mode ?? 'default')) add('S3', 'query_mode', `${p.mode} for ${g.mode}`);
    if (g.select !== p.select) add('S3', 'query_select', `${p.select} selected for ${g.select}`);
    if ((g.measure ?? null) !== (p.measure ?? null)) add('S3', 'query_measure', `${p.measure} for ${g.measure}`);
    for (const k of ['rank', 'except', 'compare', 'fragment', 'order']) if (g[k] !== p[k]) add('S2', `query_${k}`, `${k}: ${p[k]} for ${g[k]}`);
    if ((g.quantifier ?? null) !== (p.quantifier ?? null)) add(g.quantifier && p.quantifier ? 'S4' : 'S3', 'query_quantifier', `${p.quantifier} for ${g.quantifier}`);
    if (g.time !== p.time) add('S2', 'query_time', `${p.time} for ${g.time}`);
  }
  if (G.queries.length !== P.queries.length && nq) add(G.queries.length > P.queries.length ? 'S2' : 'S3', 'query_count', `${P.queries.length} queries for ${G.queries.length}`);
  const gg = groupKinds(goldSop), pg = groupKinds(predSop);
  if (gg.all !== pg.all || gg.any !== pg.any) add(gg.any !== pg.any && (gg.any === 0 || pg.any === 0) && gg.all + gg.any === pg.all + pg.any ? 'S4' : 'S2', 'group', `all/any ${pg.all}/${pg.any} for ${gg.all}/${gg.any}`);
  const gl = linkWords(goldSop), pl = linkWords(predSop);
  for (const k of new Set([...gl, ...pl])) {
    const a = gl.filter(x => x === k).length, b = pl.filter(x => x === k).length;
    if (a > b) add(['if', 'unless', 'when'].includes(k) ? 'S4' : 'S2', 'link_lost', `${k} x${a - b}`);
    const inMessage = {because: ['because', 'since', 'as', 'given'], so: ['so', 'then'], if: ['if', 'suppose', 'supposing', 'assuming', 'hypothetically', 'then'], unless: ['unless'], although: ['although', 'though', 'even'], before: ['before'], after: ['after'], when: ['when'], while: ['while'], so_that: ['so']}[k] ?? [k];
    if (b > a) add(inMessage.some(w => messageText.includes(` ${w} `)) ? 'S2' : ['because', 'so'].includes(k) ? 'S3' : 'S4', 'link_invented', `${k} x${b - a}`);
  }
  const gcn = G.other.filter(o => o.type === 'constraint').length, pcn = P.other.filter(o => o.type === 'constraint').length;
  if (gcn !== pcn) add('S2', 'constraint', `${pcn} constraint wires for ${gcn}`);
  return done();
}
