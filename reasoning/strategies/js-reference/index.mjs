/**
 * js-reference: the deliberately simple, auditable ORACLE of the proposed reasoning core (experiments/proposal/reasoning-wires-proposal.md,
 * sections 4 to 6). Every other strategy is shadow-checked against it. Correctness and clarity beat speed: naive stratified
 * bottom-up evaluation, nested-loop joins, enumeration for constraints, breadth of constructs over speed.
 *
 * STATUS: the product's reference route. The registry (`reasoning/registry.mjs`) routes `reference`, `js-reference` and `js-oracle` to this
 * oracle through the runtime bridge (`reasoning/bridge`); the other strategies are shadow-checked against it by the smoke harness.
 *
 * Interface (5.1 to 5.3):
 *   capabilities          the feature declaration; a circuit that needs another feature throws NotExpressibleError, it is never weakened;
 *   prepare(theory, o)    parse the knowledge circuits once -> handle (no learning, no cost to report);
 *   ask(problem, budget)  problem = {theory | handle, query, requested?}; theory = text or {knowledge}; query = the query circuit text
 *                         (a `query` wire, or a `constraint` wire, plus optional `policy` and supposed `fact` wires); returns the packet;
 *   update(handle, delta) additions {add: text} and retractions {remove: [ids]}; the oracle recomputes, so a handle is never stale.
 *
 * The packet follows 5.3: status, complete, rows, count, bound, conditional (per row, verified, with nonmonotone and
 * conditional_unknown), used (one sufficient support set, used_incomplete when it rests on negation as failure), proof,
 * explain, plan, hypotheses, missing and blockers, budget, retrieval, route, timings, ignored, notes, and `sensitivity` (the
 * predicates a partial retrieval must have complete for the answer to be valid, judged on the DESUGARED program).
 * Not implemented, declared `not_expressible`: modes of work (method, norms, procedures, amendment, conform).
 */
import {parse, tokens} from './wires.mjs';
import {selectInForce, supposedWireIds} from './governance.mjs';
import {desugar} from './desugar.mjs';
import {compileProgram, sliceProgram, conditionAlts} from './program.mjs';
import {saturate} from './engine.mjs';
import {Budget, BudgetStop, CEILINGS} from './budget.mjs';
import {planQuery, evaluatePart, combineParts, readBudget} from './query.mjs';
import {timeParts, viewAt} from './timeview.mjs';
import {proofOf, usedOf, explainOf} from './support.mjs';
import {parseConstraint, solveConstraint} from './constraint.mjs';
import {readForms} from './forms.mjs';
import {planSearch} from './plan.mjs';
import {abduce} from './abduce.mjs';
import {whyNot} from './whynot.mjs';
import {withConditional} from './conditional.mjs';
import {ProgramError, NotExpressibleError} from './values.mjs';
import {ORDER_SAMPLING, ORDER_SAMPLING_MODES} from '../../../sop/enums.mjs';
import {sampleAnswers} from '../../sample.mjs';

export {ProgramError, NotExpressibleError};

const SUPPORTED = ['facts', 'select', 'open_world', 'classical_negation', 'conflict', 'rules', 'recursion', 'conjunction', 'exists', 'every', 'every_grouped', 'count', 'explain', 'used', 'why_not', 'temporal', 'interval', 'throughout', 'snapshot_derived', 'whatif', 'epistemic_status', 'naf', 'closed_world', 'closed_derived', 'compare_in_rules', 'compute_in_rules', 'aggregate', 'default', 'overrides', 'strict_contrary', 'integrity', 'constraint', 'optimize', 'plan', 'abduce', 'zero_arity', 'budget', 'budget_probes', 'retrieval', 'versions', 'time_vars', 'exact_arithmetic', 'compute_in_recursion'];
const UNSUPPORTED = ['blocked_info', 'method', 'htn_choice', 'on_failure', 'norms_hard', 'norms_soft', 'temporal_norms', 'procedures', 'procedure_render', 'amendment', 'check_plan', 'abduce_waive'];

export const capabilities = {
  id: 'js-reference',
  features: SUPPORTED,
  notExpressible: UNSUPPORTED,
  delivery: 'slice',
  limits: {max_wires: Infinity, max_arity: 6, integer_range: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]},
  guarantee: 'exact',
  provides: ['explain', 'used', 'proof'],
  budgetKeys: Object.keys(CEILINGS),
  determinism: 'deterministic',
  isolation: false
};

const f1 = (w, k) => w.fields.find(f => f.key === k);
const ASSUMED = ['supposed', 'hedged', 'reported'];
const LINKS_OTHER_THAN_IF = ['because', 'so', 'unless', 'although', 'so_that', 'before', 'after', 'when', 'while'];
const MODES = ['select', 'exists', 'count', 'explain', 'every', 'why_not', 'plan', 'abduce', 'conform', 'procedure'];

// ---------------------------------------------------------------------------------------------------------- handle

function readWires(text, what) {
  const {wires, errors} = parse(text ?? '');
  if (errors.length) throw new ProgramError(errors[0].code, `${what}: ${errors[0].message} (line ${errors[0].line})`);
  return wires;
}

export function prepare(theory) {
  const knowledge = typeof theory === 'string' ? theory : theory?.knowledge ?? '';
  const wires = theory?.wires ?? readWires(knowledge, 'knowledge');
  return {kind: 'js-reference-handle', knowledge, wires};
}

/**
 * Close facts under rules and hand back the evidence (the derivation of every literal): the primitive of the bounded controllers
 * that search over states (abduction, planning, simulation) and of hosts that keep their own fact objects. `wires` are `fact` and
 * `rule` wires (already in force); `blocked` lists conclusions never derived. A budget stop is `exhausted`, never an exception.
 */
export function closeFacts({wires, budget = {}, blocked = []}) {
  const b = new Budget(budget);
  const program = compileProgram(wires, {origin: new Map()});
  const closure = saturate(program, program.facts, b, {blocked});
  return {ev: closure.ev, exhausted: closure.exhausted, program, budget: b};
}

export function update(handle, delta = {}) {
  const removed = new Set(delta.remove ?? []);
  const wires = [...handle.wires.filter(w => !removed.has(w.id)), ...(delta.add ? readWires(delta.add, 'delta') : [])];
  return {...handle, wires, knowledge: undefined};
}

// ------------------------------------------------------------------------------------------------------- the query

function readQuery(wire, excluded) {
  const one = k => f1(wire, k)?.value.trim() ?? null;
  const span = k => (one(k) ? tokens(one(k)) : null);
  const q = {
    wire, mode: one('mode') ?? 'select', select: tokens(one('select') ?? ''), at: one('at'), during: span('during'), overlaps: span('overlaps'),
    asof: one('asof'), policy: one('policy')?.replace(/^\$/, '') ?? null, limit: one('limit') ? Number(one('limit')) : Infinity,
    ifs: wire.fields.filter(f => f.key === 'if').map(f => f.value.trim().slice(1)).filter(id => !excluded.has(id))
  };
  q.forms = ['compare', 'rank', 'filter', 'quantifier', 'except', 'limit'].some(k => f1(wire, k)) ? readForms(wire) : null;
  if (!MODES.includes(q.mode)) throw new ProgramError('bad_enum', `mode must be one of ${MODES.join(', ')}`, wire.id);
  const other = [];
  // compare, rank, filter, except, quantifier and limit are run by the oracle (forms.mjs); order, measure and the clause links are linked by the host
  // `order random` (DS004 "Sampling") is run here for a direct call (the StrategyRouter applies it itself after any route); a temporal order is the host's
  const sampling = wire.fields.filter(f => f.key === 'order' && ORDER_SAMPLING.includes(f.value.trim()));
  if (sampling.length > 1) throw new ProgramError('order_random_repeated', 'a query takes at most one order random line', wire.id);
  if (sampling.length && !ORDER_SAMPLING_MODES.includes(q.mode)) throw new ProgramError('order_random_mode', `order random samples the answers of mode ${ORDER_SAMPLING_MODES.join('|')}, not mode ${q.mode}`, wire.id);
  q.sample = sampling.length > 0;
  if (wire.fields.some(f => f.key === 'order' && !sampling.includes(f))) other.push('order');
  for (const k of ['measure', ...LINKS_OTHER_THAN_IF]) if (f1(wire, k)) other.push(k);
  if (other.length) throw new NotExpressibleError(['query_' + other[0]], `query field "${other[0]}" is linked by the host, not run by this strategy`);
  if (['conform', 'procedure'].includes(q.mode) || f1(wire, 'via') || f1(wire, 'trace')) throw new NotExpressibleError(['check_plan', 'procedure_render', 'method'], `mode ${q.mode} (modes of work) is not expressible by js-reference`);
  return q;
}

function readPolicy(wires, q) {
  // a constraint circuit has no query wire to name a policy: its policy wire, if any, is the one that applies
  const w = wires.find(x => x.type === 'policy' && (!q || x.id === q.policy));
  if (!w) return {limits: {}, effort: 'normal', partial: 'allow', procedures: false, binding: 'strict'};
  const limits = {};
  for (const f of w.fields) if (f.key in CEILINGS) limits[f.key] = Number(f.value);
  return {limits, effort: f1(w, 'effort')?.value.trim() ?? 'normal', partial: f1(w, 'partial')?.value.trim() ?? 'allow', procedures: Boolean(f1(w, 'procedures')), binding: f1(w, 'binding')?.value.trim() ?? 'strict'};
}

/** Requested limits only tighten: the smaller of the caller's `budget` argument and the policy wire. */
function mergeLimits(a, b) {
  const out = {...a};
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? Math.min(out[k], v) : v;
  return out;
}

export function assumptionIds(handle, queryText) {
  return assumptionIdsOf(handle, readWires(queryText, 'query'));
}

function assumptionIdsOf(handle, qw) {
  const ids = [];
  for (const w of [...handle.wires, ...qw]) if (w.type === 'fact' && ASSUMED.includes(f1(w, 'status')?.value.trim())) ids.push(w.id);
  const q = qw.find(w => w.type === 'query');
  if (q) ids.push(...supposedWireIds([q], handle.wires));
  return [...new Set(ids)];
}

// -------------------------------------------------------------------------------------------------------- one solve

/** Compile the circuits in force (governance, supposed wires, sugar) for one set of excluded assumptions. */
function buildProgram(handle, qWires, q, excluded) {
  const supposed = supposedWireIds(q ? [{...q.wire, fields: q.wire.fields.filter(f => !(f.key === 'if' && excluded.has(f.value.trim().slice(1))))}] : [], handle.wires).filter(id => !excluded.has(id));
  const inForce = selectInForce(handle.wires, {asof: q?.asof ?? null, include: supposed}).filter(w => !(w.type === 'fact' && excluded.has(w.id)));
  const {wires, origin} = desugar([...inForce, ...qWires.filter(w => w.type === 'fact')]);
  return compileProgram(wires, {origin});
}

function sensitivityOf({program: sp}, qp) {
  const slice = sp.slice;
  const strict = sp.edges.filter(e => e.strict && slice.has(e.to));
  const over = [...new Set([...strict.map(e => e.from), ...(qp && ['count', 'every'].includes(qp.mode) ? qp.alts.flatMap(a => a.leaves.filter(l => l.kind === 'atom').map(l => l.p)) : [])])];
  const defaults = [...slice].filter(p => /^x_.+_blocked$/.test(p)).map(p => p.slice(2, -8));
  const absentInQuery = qp ? qp.alts.some(a => a.leaves.some(l => l.kind === 'atom' && l.mode === 'absent')) : false;
  // A ranking (superlative, ordinal) names the best of ALL the candidates: a fact missing from a partial slice can change the winner (R-P2).
  const monotone = !strict.length && !absentInQuery && !(qp && (['count', 'every'].includes(qp.mode) || qp.forms?.rank));
  return {monotone, over, defaults, aggregates: sp.aggregates.map(a => a.id)};
}

const baseInfo = (extra = {}) => ({strategy: 'js-reference', guarantee: 'exact', ...extra});

function constraintPacket(wire, budget) {
  const out = solveConstraint(parseConstraint(wire), budget);
  return baseInfo({...out, budget: budget.snapshot(), used: [], notes: []});
}

function relationalPacket({q, qp, sliced, parts, how, exhausted, policy, budget, notes, viewSize}) {
  const outcome = combineParts(qp, parts, how);
  const sensitivity = sensitivityOf(sliced, qp);
  const common = {
    budget: budget.snapshot(Boolean(exhausted)), sensitivity, ignored: sliced.ignored, notes: [...notes],
    retrieval: {complete: true, truncated: false, keyed: false, steps: 0, wires: viewSize, probes: 0}
  };
  if (exhausted) {
    const partialOk = sensitivity.monotone && policy.partial !== 'forbid' && ['select', 'exists', 'explain'].includes(qp.mode) && outcome.rows.length && ['supported', 'both'].includes(outcome.status);
    if (!partialOk) return baseInfo({status: 'budget_exhausted', complete: false, reason: exhausted.reason, ...common});
    return baseInfo({status: outcome.status, complete: false, reason: exhausted.reason, ...(qp.mode === 'select' ? {rows: outcome.rows.map(r => r.row)} : {}), ...common, ...supportFields(outcome, false)});
  }
  const packet = {status: outcome.status, complete: true, ...common};
  if (outcome.reason) packet.reason = outcome.reason;
  // a count is a number, not a list: only `select` returns rows (the strategies agree on this, so the shadow check can compare packets)
  if (qp.mode === 'select') {
    packet.rows = outcome.rows.map(r => r.row);
    if (q.sample) {
      const drawn = sampleAnswers(packet.rows, {limit: q.limit, seed: q.seed});
      packet.rows = drawn.items;
      packet.sample = drawn.sample;
      if (drawn.truncated) packet.truncated = true;
    } else if (q.forms && packet.rows.length > q.forms.limit) { packet.rows = packet.rows.slice(0, q.forms.limit); packet.truncated = true; }
  }
  if (outcome.quantified) Object.assign(packet, {members: outcome.members, counterexamples: outcome.counterexamples, undecided: outcome.undecided});
  if (qp.mode === 'every' && qp.select.length) packet.rows = outcome.rows.map(r => r.row);
  if (qp.mode === 'count') { packet.count = outcome.count; if (outcome.bound) packet.bound = outcome.bound; }
  Object.assign(packet, supportFields(outcome, true));
  if (qp.mode === 'explain' && outcome.rows.length) {
    const first = outcome.rows.find(r => !r.both) ?? outcome.rows[0];
    packet.explain = explainOf(first.prem);
    packet.proof = proofOf(first.prem);
  }
  return baseInfo(packet);
}

function supportFields(outcome, complete) {
  if (!complete || !['supported', 'refuted', 'both'].includes(outcome.status)) return {used: []};
  const {used, used_incomplete: incomplete} = usedOf(outcome.roots);
  return {used, ...(incomplete || outcome.supportIncomplete ? {used_incomplete: true} : {})};
}

/** One complete solve of the circuits with some assumptions removed. Returns a packet without `conditional`. */
function solveOnce(handle, qWires, excluded, budgetArg, opts = {}) {
  const live = qWires.filter(w => !(w.type === 'fact' && excluded.has(w.id)));
  const queryWire = live.find(w => w.type === 'query');
  const constraintWire = live.find(w => w.type === 'constraint');
  const q = queryWire ? readQuery(queryWire, excluded) : null;
  if (q && opts.forms) q.forms = opts.forms;
  if (q) q.seed = opts.seed;
  const policy = readPolicy(live, q);
  const budget = new Budget(mergeLimits(budgetArg, policy.limits), {effort: policy.effort, verification: opts.verification});
  if (constraintWire && !queryWire) return constraintPacket(constraintWire, budget);
  if (!q) throw new ProgramError('no_query', 'the query circuit holds neither a query nor a constraint');
  if (policy.procedures) throw new NotExpressibleError(['procedures'], 'policy procedures selects modes of work, which are not expressible');

  const program = buildProgram(handle, live, q, excluded);
  if (program.unsupported.length && ['plan', 'why_not', 'abduce'].includes(q.mode)) throw new NotExpressibleError(program.unsupported);
  const seeds = conditionAlts(q.wire.fields.filter(f => ['where', 'scope'].includes(f.key)), q.wire.id).flatMap(alt => alt.filter(l => l.kind === 'atom' || l.kind === 'timeof').map(l => l.p));
  const wantsPlan = q.mode === 'plan';
  const planPreds = wantsPlan ? program.actions.flatMap(a => [...a.requires, ...a.adds, ...a.removes].map(x => x.p)) : [];
  const sliced = sliceProgram(program, [...seeds, ...planPreds]);
  const started = performance.now();
  const notes = new Set();

  if (wantsPlan) {
    const out = planSearch({program: sliced.program, facts: sliced.program.facts, goalWire: q.wire, budget});
    return baseInfo({...out, budget: budget.snapshot(), ignored: sliced.ignored, notes: [...(out.notes ?? [])], retrieval: {complete: true, truncated: false, keyed: false, steps: 0, wires: sliced.program.facts.length, probes: 0}, timings: {ask: Math.round(performance.now() - started)}});
  }

  const qp = planQuery(q.wire, program.closed, {mode: q.mode === 'why_not' || q.mode === 'abduce' ? 'select' : q.mode, select: q.select, forms: q.forms});
  qp.mode = q.mode === 'why_not' || q.mode === 'abduce' ? q.mode : qp.mode;

  if (q.mode === 'abduce') {
    const out = abduce({program: sliced.program, facts: sliced.program.facts, qp, budget, limit: q.limit});
    return baseInfo({...out, budget: budget.snapshot(), ignored: sliced.ignored, notes: [], sensitivity: sensitivityOf(sliced, qp), timings: {ask: Math.round(performance.now() - started)}});
  }

  const {how, instants} = timeParts(sliced.program.facts, q);
  const parts = [];
  const detail = opts.detail ? {parts: [], program: sliced.program} : null;
  let exhausted = null, viewSize = 0;
  instants.forEach((t, i) => {
    if (exhausted) return;
    const view = viewAt(sliced.program.facts, t);
    viewSize = Math.max(viewSize, view.length);
    const closure = saturate(sliced.program, view, i === 0 ? budget : budget.child());
    for (const n of closure.ctx.notes) notes.add(n);
    exhausted = closure.exhausted;
    const rctx = {ev: closure.ev, stored: closure.ctx.stored, budget: readBudget(budget), notes};
    if (q.mode === 'why_not') parts.push({closure, rctx});
    else {
      // reading is not counted against the probe ceilings, but the wall clock stops it: a stop is an incomplete part, never an answer
      try { parts.push(evaluatePart(qp, closure.ev, rctx)); } catch (e) {
        if (!(e instanceof BudgetStop)) throw e;
        exhausted = exhausted ?? {reason: e.reason, key: e.key};
        parts.push({status: 'unknown', rows: [], roots: [], supportIncomplete: true});
        return;
      }
      // `reread(fields, mode, select, forms)`: another condition over the SAME closure (the host asks for the opposite of a ground claim)
      detail?.parts.push({instant: t, outcome: parts.at(-1), ev: closure.ev, reread: (fields, rmode = 'select', rselect = [], forms = null) => evaluatePart(planQuery({id: 'reread', fields}, program.closed, {mode: rmode, select: rselect, forms}), closure.ev, rctx)});
    }
  });

  if (q.mode === 'why_not') return whyNotPacket({q, qp, sliced, parts, exhausted, budget, notes, started});
  const packet = relationalPacket({q, qp, sliced, parts, how, exhausted, policy, budget, notes, viewSize});
  packet.timings = {ask: Math.round(performance.now() - started)};
  if (detail) packet.detail = detail;
  return packet;
}

function whyNotPacket({q, qp, sliced, parts, exhausted, budget, notes, started}) {
  const common = {budget: budget.snapshot(Boolean(exhausted)), ignored: sliced.ignored, notes: [...notes], sensitivity: sensitivityOf(sliced, qp), timings: {ask: Math.round(performance.now() - started)}};
  if (exhausted) return baseInfo({status: 'budget_exhausted', complete: false, reason: exhausted.reason, ...common});
  const {closure, rctx} = parts[0];
  const claim = evaluatePart({...qp, mode: 'exists'}, closure.ev, rctx);
  try {
    const out = whyNot({program: sliced.program, ev: closure.ev, goalAlts: qp.alts, budget, limit: q.limit});
    return baseInfo({status: claim.status, complete: !out.truncated, missing: claim.rows.length ? [] : out.missing, blockers: out.blockers, ...common, budget: budget.snapshot(false)});
  } catch (e) {
    if (e instanceof BudgetStop) return baseInfo({status: 'budget_exhausted', complete: false, reason: e.reason, ...common, budget: budget.snapshot(false)});
    throw e;
  }
}

// -------------------------------------------------------------------------------------------------------------- ask

/**
 * Answer a problem. Throws ProgramError for an invalid circuit and NotExpressibleError for a circuit that needs a feature
 * declared unsupported; budget exhaustion is a packet (`budget_exhausted` with a `reason`), never an exception.
 */
function runAsk(problem, budgetArg, verification = false) {
  const t0 = performance.now();
  const handle = problem.handle ?? prepare(problem.theory ?? '');
  const qWires = problem.queryWires ?? readWires(problem.query, 'query');
  // `conditional: false` skips the per-row verification runs (a host that reports assumptions itself, like the runtime bridge);
  // `forms` replaces the form fields of the query wire with already structured ones; `detail` returns the raw evaluation of each part
  const ids = problem.conditional === false ? [] : assumptionIdsOf(handle, qWires);
  const opts = {forms: problem.forms ?? null, detail: Boolean(problem.detail), verification, seed: problem.seed ?? Date.now()};
  const packet = withConditional(ids, excluded => solveOnce(handle, qWires, excluded, budgetArg, opts));
  const requested = problem.requested ?? null;
  return {
    ...packet,
    route: {requested, chosen: 'js-reference', reason: requested ? 'explicit request' : 'direct call to the oracle', fallback: null},
    timings: {...(packet.timings ?? {}), total: Math.round(performance.now() - t0)}
  };
}

export function ask(problem, budgetArg = {}) {
  return runAsk(problem, budgetArg);
}

/** Offline/report verifier over the original problem, not over engine-produced facts. Never changes ordinary execution ceilings. */
export function verifyAnswer(problem, budgetArg = {}) {
  return runAsk(problem, budgetArg, true);
}

export const jsReference = {...capabilities, capabilities, prepare, ask, update};
export default jsReference;
