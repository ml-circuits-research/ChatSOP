/**
 * Relational query modes over a closed evidence view: select, exists, count, explain, every.
 *
 * Answer statuses follow the four-valued evidence (supported = P only, refuted = N only, both, unknown). A query that finds no
 * row is `refuted` only when the evidence or a CLOSED predicate says no instance can exist (a ground atom with N evidence, a `not`
 * atom whose atom has P evidence, a positive atom of a closed predicate with no matching row, an `absent` atom that has P);
 * otherwise it is `unknown` (open world). A count over a predicate that is not closed is a lower bound (`bound: at_least`); an
 * `every` over an open domain without a counterexample is `unknown` with reason `open_domain`; a counterexample still refutes.
 */
import {join, unify} from './join.mjs';
import {conditionAlts, orderLeaves} from './program.mjs';
import {ProgramError, groundArgs, isVarTerm} from './values.mjs';
import {applyRowForms, quantifiedStatus} from './forms.mjs';

const stripVar = v => v.replace(/^\?/, '');
const rowKey = row => JSON.stringify(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : 1)));

/** A query's unbounded probe counter: the closure was already paid for, reading it is not budgeted. */
export const READ_BUDGET = {probe() {}, limits: {maxFanout: Infinity}};

/** Compile the `where` (and `scope`) part of a query wire. */
export function planQuery(wire, closed, {mode, select, forms = null}) {
  const fields = k => wire.fields.filter(f => f.key === k);
  const alts = conditionAlts(fields('where'), wire.id).map(a => orderLeaves(a, wire.id));
  const check = (altList, what) => {
    for (const alt of altList) for (const l of alt.leaves) {
      if (l.kind === 'atom' && l.mode === 'absent' && !closed.has(l.p)) throw new ProgramError('absent_needs_closed', `absent ${l.p} in the ${what} needs a closed predicate`, wire.id);
    }
  };
  check(alts, 'query');
  for (const alt of alts) for (const v of select) if (!alt.bound.has(v)) throw new ProgramError('select_unbound', `${v} is not bound by the where part`, wire.id);
  const scope = mode === 'every' ? conditionAlts(fields('scope'), wire.id) : [];
  if (mode === 'every' && !scope.length) throw new ProgramError('every_without_scope', 'mode every needs a scope', wire.id);
  const scopeAlts = scope.map(a => orderLeaves(a, wire.id, new Set(alts.flatMap(x => [...x.bound]))));
  check(scopeAlts, 'scope');
  const domainClosed = alts.every(alt => alt.leaves.every(l => l.kind !== 'atom' || l.mode !== 'pos' || closed.has(l.p)));
  const projection = select.length ? select : [...new Set(alts.flatMap(a => [...a.bound]))].sort();
  return {mode, alts, scopeAlts, select, projection, domainClosed, closed, wireId: wire.id, forms};
}

/** Does the literal (instantiated by `env`, other variables wildcards) have NO possible instance, by evidence or closure? */
function leafRefuted(l, env, ev, closed) {
  if (l.kind !== 'atom') return false;
  const args = l.args.map(a => (isVarTerm(a) && a.var in env ? env[a.var] : a));
  const ground = args.every(a => !isVarTerm(a));
  if (l.mode === 'pos') {
    if (ground && ev.get(true, l.p, args)) return true;
    if (!closed.has(l.p)) return false;
    return !ev.list(false, l.p).some(n => unify(args, n.args, {}) !== null);
  }
  return ground && Boolean(ev.get(false, l.p, args)); // `not` (needs N, has P) and `absent` (needs no P, has P)
}

const altRefuted = (alt, env, ev, closed) => alt.leaves.some(l => leafRefuted(l, env, ev, closed));

/** Conflict flag of a satisfied binding: some positive leaf also has N evidence, or some `not` leaf also has P. */
function conflicted(alt, env, ev) {
  return alt.leaves.some(l => {
    if (l.kind !== 'atom' || l.mode === 'absent') return false;
    const g = groundArgs(l.args, env);
    return g && Boolean(ev.get(l.mode === 'pos', l.p, g));
  });
}

/**
 * The join rows of the where part (full bindings, with their premises and conflict flag), the row forms applied, then projected
 * to the select variables and deduplicated. Returns {rows: Map(projected key -> {row, both, prem, env}), matches, state}:
 * `matches` are the join rows that survived the forms (the distinct answers are a projection of them).
 */
function collectRows(qp, ev, ctx) {
  const candidates = [];
  for (const alt of qp.alts) {
    for (const {env, prem} of join(alt.leaves, 0, {}, [], ctx)) candidates.push({env, prem, both: conflicted(alt, env, ev)});
  }
  const state = {notComputable: false, filtered: candidates.length, compared: false};
  const matches = applyRowForms(candidates, qp.forms, state);
  const rows = new Map();
  for (const m of matches) {
    const row = Object.fromEntries(qp.projection.map(v => [stripVar(v), m.env[v]]));
    const k = rowKey(row);
    const old = rows.get(k);
    if (!old || (old.both && !m.both)) rows.set(k, {row, both: m.both, prem: m.prem, env: m.env});
  }
  return {rows, matches, state, candidates};
}

/** The member rows of an `every` domain with the full binding of the domain variables. */
function domainEnvs(qp, ctx) {
  const seen = new Map();
  for (const alt of qp.alts) {
    for (const {env} of join(alt.leaves, 0, {}, [], ctx)) {
      const sub = Object.fromEntries([...alt.bound].sort().map(v => [v, env[v]]));
      seen.set(JSON.stringify(sub), sub);
    }
  }
  return [...seen.values()];
}

const statusOf = (p, n) => (p && n ? 'both' : p ? 'supported' : n ? 'refuted' : 'unknown');

/** Roots of the evidence a refutation by N evidence stands on (the contradicting literals of a ground query). */
function refutationRoots(qp, ev) {
  const roots = [];
  for (const alt of qp.alts) for (const l of alt.leaves) {
    if (l.kind !== 'atom') continue;
    const g = groundArgs(l.args, {});
    if (!g) continue;
    const n = l.mode === 'pos' ? ev.get(true, l.p, g) : l.mode === 'not' ? ev.get(false, l.p, g) : ev.get(false, l.p, g);
    if (n) roots.push(n);
  }
  return roots;
}

/**
 * Evaluate one view. Returns {status, rows, count?, bound?, reason?, roots, supportIncomplete, matches?, state?}. With row forms
 * (compare, filter, rank) a yes/no question whose known values all fail a numeric comparison is `refuted` ("Is the Dacia over
 * 5000?" with a price of 4000), and an ordering over a value that is not a number is `not_computable` (`value_not_numeric`).
 */
export function evaluatePart(qp, ev, ctx) {
  const {mode} = qp;
  if (mode === 'every') return qp.forms?.quantifier ? evaluateQuantified(qp, ev, ctx) : evaluateEvery(qp, ev, ctx);
  const {rows, matches, state, candidates} = collectRows(qp, ev, ctx);
  const list = [...rows.values()].sort((a, b) => (rowKey(a.row) < rowKey(b.row) ? -1 : 1));
  if (!list.length && state.notComputable) return {status: 'not_computable', reason: 'value_not_numeric', rows: [], roots: [], supportIncomplete: false, matches, state};
  const comparedAway = !list.length && state.filtered > 0 && state.compared && !state.notComputable && mode === 'exists';
  const refuted = comparedAway || (!list.length && qp.alts.every(alt => altRefuted(alt, {}, ev, qp.closed)));
  if (mode === 'count') {
    const exact = qp.domainClosed;
    const status = list.length || exact ? 'supported' : 'unknown';
    return {status, rows: list, count: list.length, ...(exact ? {} : {bound: 'at_least'}), roots: list.flatMap(r => r.prem), supportIncomplete: true, matches, state};
  }
  if (list.length) {
    const status = list.some(r => !r.both) ? 'supported' : 'both';
    const first = list.find(r => !r.both) ?? list[0];
    const all = mode === 'select' ? list.flatMap(r => r.prem) : first.prem;
    return {status, rows: list, roots: all, supportIncomplete: false, matches, state};
  }
  const refRoots = refuted ? refutationRoots(qp, ev) : [];
  const roots = comparedAway ? [...refRoots, ...candidates.flatMap(c => c.prem)] : refRoots;
  return {status: refuted ? 'refuted' : 'unknown', rows: [], roots, supportIncomplete: refuted && !roots.length, matches, state};
}

/**
 * `mode every` with a `quantifier`: a universal (or counting) question over the KNOWN members of the restriction (the `where`
 * part, row forms applied). Each member is supported (its scope is derivable), refuted (the scope is refuted by evidence) or
 * unknown; members are grouped by the selected variables and each group gets a status under the quantifier
 * (forms.quantifiedStatus). With `select` the answers are the supported groups. Open predicates do not make the answer unknown:
 * the check covers the known members only, and the packet says so (`known_members`).
 */
function evaluateQuantified(qp, ev, ctx) {
  const state = {notComputable: false, filtered: 0, compared: false};
  const found = new Map();
  for (const alt of qp.alts) for (const {env, prem} of join(alt.leaves, 0, {}, [], ctx)) {
    const k = JSON.stringify(Object.entries(env).sort());
    if (!found.has(k)) found.set(k, {env, prem});
  }
  const members = applyRowForms([...found.values()], qp.forms, state);
  const groups = new Map(), memberList = [];
  for (const m of members) {
    let status = 'unknown', support = [];
    for (const alt of qp.scopeAlts) {
      const first = join(alt.leaves, 0, m.env, [], ctx).next();
      if (!first.done) { status = 'supported'; support = first.value.prem; break; }
    }
    if (status === 'unknown' && qp.scopeAlts.every(alt => altRefuted(alt, m.env, ev, qp.closed))) {
      status = 'refuted';
      support = qp.scopeAlts.flatMap(alt => refutationFor(alt, m.env, ev));
    }
    memberList.push({env: m.env, status, prem: [...m.prem, ...support]});
    const key = JSON.stringify(qp.select.map(v => m.env[v]));
    if (!groups.has(key)) groups.set(key, {row: Object.fromEntries(qp.select.map(v => [stripVar(v), m.env[v]])), members: [], prem: []});
    const g = groups.get(key);
    g.members.push({env: m.env, status});
    g.prem.push(...m.prem, ...support);
  }
  const all = [...groups.values()].map(g => ({...g, status: quantifiedStatus(qp.forms.quantifier, g.members)}));
  let status, rows = [], roots;
  if (qp.select.length) {
    rows = all.filter(g => g.status === 'supported').map(g => ({row: g.row, both: false, prem: g.prem}));
    status = rows.length ? 'supported' : all.length && all.every(g => g.status === 'refuted') ? 'refuted' : 'unknown';
    roots = all.filter(g => g.status === status).flatMap(g => g.prem);
  } else {
    status = all.length ? all[0].status : 'unknown';
    roots = all.length ? all[0].prem : [];
  }
  const withStatus = which => memberList.filter(m => m.status === which).map(m => m.env);
  return {status, rows, roots, supportIncomplete: false, reason: 'known_members', quantified: true, members: memberList.length, memberList, counterexamples: withStatus('refuted'), undecided: withStatus('unknown'), state};
}

function evaluateEvery(qp, ev, ctx) {
  const members = domainEnvs(qp, ctx);
  let conflicts = 0, counter = null, unknown = 0;
  const roots = [];
  for (const env of members) {
    let holds = false;
    for (const alt of qp.scopeAlts) {
      const first = join(alt.leaves, 0, env, [], ctx).next();
      if (!first.done) {
        holds = true;
        roots.push(...first.value.prem);
        if (conflicted(alt, first.value.env, ev)) conflicts++;
        break;
      }
    }
    if (holds) continue;
    const refuted = qp.scopeAlts.every(alt => altRefuted(alt, env, ev, qp.closed));
    if (refuted) { counter = counter ?? env; roots.push(...qp.scopeAlts.flatMap(alt => refutationFor(alt, env, ev))); } else unknown++;
  }
  if (counter) return {status: 'refuted', rows: [], roots, supportIncomplete: false, counterexample: counter};
  if (!qp.domainClosed) return {status: 'unknown', reason: 'open_domain', rows: [], roots: [], supportIncomplete: true};
  if (unknown) return {status: 'unknown', reason: 'scope_unknown', rows: [], roots: [], supportIncomplete: true};
  // every member satisfies the scope by P evidence; a member whose scope atom ALSO has N evidence makes the universal both
  return {status: conflicts ? 'both' : 'supported', rows: [], roots, supportIncomplete: true};
}

function refutationFor(alt, env, ev) {
  const out = [];
  for (const l of alt.leaves) {
    if (l.kind !== 'atom') continue;
    const g = groundArgs(l.args, env);
    const n = g && (l.mode === 'pos' ? ev.get(true, l.p, g) : ev.get(false, l.p, g));
    if (n) out.push(n);
  }
  return out;
}

/**
 * Combine the outcomes of the parts of an interval query. `throughout` (during): a row or a claim must hold in every part;
 * `some` (overlaps): in at least one. Evidence per part is combined as P (positive holds) and N (negative holds).
 */
export function combineParts(qp, parts, how) {
  if (parts.length === 1) return parts[0];
  const throughout = how === 'throughout';
  const pOf = s => s === 'supported' || s === 'both', nOf = s => s === 'refuted' || s === 'both';
  const agg = f => (throughout ? parts.every(f) : parts.some(f));
  const roots = parts.flatMap(p => p.roots);
  const supportIncomplete = parts.some(p => p.supportIncomplete);
  if (['select', 'exists', 'explain', 'count'].includes(qp.mode)) {
    const maps = parts.map(p => new Map(p.rows.map(r => [rowKey(r.row), r])));
    const keys = throughout ? [...maps[0].keys()].filter(k => maps.every(m => m.has(k))) : [...new Set(maps.flatMap(m => [...m.keys()]))];
    const rows = keys.sort().map(k => {
      const rs = maps.map(m => m.get(k)).filter(Boolean);
      return {row: rs[0].row, both: rs.every(r => r.both), prem: rs.flatMap(r => r.prem)};
    });
    if (qp.mode === 'count') {
      const exact = qp.domainClosed;
      return {status: rows.length || exact ? 'supported' : 'unknown', rows, count: rows.length, ...(exact ? {} : {bound: 'at_least'}), roots: rows.flatMap(r => r.prem), supportIncomplete: true};
    }
    if (rows.length) return {status: rows.some(r => !r.both) ? 'supported' : 'both', rows, roots: rows.flatMap(r => r.prem), supportIncomplete};
  }
  const status = statusOf(agg(p => pOf(p.status)), agg(p => nOf(p.status)));
  const reason = parts.find(p => p.reason)?.reason;
  return {status, rows: [], roots, supportIncomplete: true, ...(reason && status === 'unknown' ? {reason} : {})};
}

