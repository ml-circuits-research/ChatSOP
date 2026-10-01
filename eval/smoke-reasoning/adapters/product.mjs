/**
 * Adapters for the strategies that exist TODAY in reasoning/: `reference` (bounded JavaScript) and `advanced` with the
 * SWI-Prolog and Z3 backends. They lower the proposed circuits to the CURRENT product SOP wires and run them through
 * sop/runtime.mjs unchanged (read-only use of the product; nothing in sop/ or reasoning/ is modified).
 *
 * Lowering is deliberately honest: a circuit that uses something the current runtime cannot state (negation as
 * failure, compare/compute in rule bodies, aggregate, default, integrity, method, why_not, any-groups, status other
 * than observed) is reported "not expressible", never silently weakened. The only translations made are the ones the
 * product already documents: a supposed/hedged/reported fact becomes `source assumption` consumed through `assume`,
 * and a `policy` wire becomes the Runtime policy option.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse, tokens, parseCondition, leaves} from '../validator.mjs';
import {selectInForce, supposedWireIds} from '../lib/governance.mjs';

export class NotExpressible extends Error {}

/** The product parser's wire ceiling (sop/runtime.mjs DEFAULT_POLICY.maxWires): the declared `max_wires` capability of the product strategies (proposal 5.1). */
export const PRODUCT_MAX_WIRES = 2048;
/** The product's default work ceilings (sop/runtime.mjs DEFAULT_POLICY), declared so a cut on one of them is reported as a capability limit. */
const PRODUCT_CEILINGS = {maxRounds: 32, maxJoins: 30000, maxFacts: 10000, maxNodes: 5000};

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

/** Point the product at the private solver binaries (already on disk under tools/.solvers) when none is on PATH. */
export function solverEnv() {
  const env = {...process.env};
  const swi = path.join(repo, 'tools/.solvers/swi/swipl'), z3 = path.join(repo, 'tools/.solvers/z3/bin/z3');
  if (!env.SWIPL_BIN && fs.existsSync(swi)) env.SWIPL_BIN = swi;
  if (!env.Z3_BIN && fs.existsSync(z3)) env.Z3_BIN = z3;
  return env;
}

const f1 = (w, key) => w.fields.find(f => f.key === key);
const fAll = (w, key) => w.fields.filter(f => f.key === key);

function atomLines(field, keyword) {
  const sink = [];
  const tree = parseCondition(field, sink);
  if (sink.length) throw new NotExpressible('bad condition: ' + sink[0].message);
  const out = [];
  for (const l of leaves(tree)) {
    if (l.kind === 'atom' && (l.terms.length < 1 || l.terms.length > 4)) throw new NotExpressible('the current runtime takes 1 to 4 terms per atom (zero-arity and 5 to 6 term atoms are proposed)');
    if (l.kind === 'atom' && l.neg !== 'absent') out.push(`  ${keyword} ${l.neg === 'not' ? 'not ' : ''}${l.p} ${l.terms.join(' ')}`);
    else if (l.kind === 'atom') throw new NotExpressible('negation as failure (absent) is not available in the current runtime');
    else throw new NotExpressible(`${l.kind} in a condition is not available in the current runtime`);
  }
  if (tree.kind === 'any') throw new NotExpressible('any-groups in rule bodies are not available in the current runtime');
  return out;
}

/** Lower knowledge and query circuits to current product SOP text. Returns {text, options, meta}. */
export function lowerToProduct({knowledge, query, backendLines = [], reasoningLine = null, addAt = false}) {
  const kwAll = parse(knowledge).wires, qw = parse(query).wires;
  const qAsof = qw.find(w => w.type === 'query')?.fields.find(f => f.key === 'asof')?.value.trim() ?? null;
  // governance: only approved wires bind; `asof` selects the version in force; wires the query supposes (`if`) join as conditional
  const kw = selectInForce(kwAll, {asof: qAsof, include: supposedWireIds(qw, kwAll)});
  const lines = [], facts = [], rules = [], actions = [], hyps = [], assumptions = [];
  const policy = {};
  const dropped = [];
  const lowerFact = (w, forceAssumption = false) => {
    const status = f1(w, 'status')?.value.trim() ?? 'observed';
    const holds = f1(w, 'holds').value;
    const arity = tokens(holds).filter((t, i) => !(i === 0 && t === 'not')).length - 1;
    if (arity < 1 || arity > 4) throw new NotExpressible('the current runtime takes 1 to 4 terms per atom (zero-arity and 5 to 6 term atoms are proposed)');
    const valid = f1(w, 'valid')?.value ?? 'timeless';
    const conditional = forceAssumption || status !== 'observed';
    lines.push(`@${w.id} fact`, `  holds ${holds}`, `  valid ${valid}`);
    if (conditional) { lines.push('  source assumption'); assumptions.push(w.id); } else if (f1(w, 'source')) lines.push(`  source ${f1(w, 'source').value}`);
  };
  for (const w of kw) {
    switch (w.type) {
      case 'predicate': dropped.push(w.id); break;
      case 'fact': lowerFact(w); if (!assumptions.includes(w.id)) facts.push(w.id); break;
      case 'rule': {
        lines.push(`@${w.id} rule`);
        for (const f of fAll(w, 'when')) lines.push(...atomLines(f, 'when'));
        { const ar = tokens(f1(w, 'then').value).filter((t, i) => !(i === 0 && t === 'not')).length - 1; if (ar < 1 || ar > 4) throw new NotExpressible('the current runtime takes 1 to 4 terms per atom (zero-arity and 5 to 6 term atoms are proposed)'); }
        lines.push(`  then ${f1(w, 'then').value}`);
        if (f1(w, 'mode')) lines.push(`  mode ${f1(w, 'mode').value}`);
        rules.push(w.id);
        break;
      }
      case 'action': {
        lines.push(`@${w.id} action`);
        for (const k of ['params', 'cost']) if (f1(w, k)) lines.push(`  ${k} ${f1(w, k).value}`);
        for (const k of ['requires', 'adds', 'removes']) for (const f of fAll(w, k)) lines.push(`  ${k} ${f.value}`);
        actions.push(w.id);
        break;
      }
      case 'hypothesis': {
        lines.push(`@${w.id} hypothesis`);
        for (const k of ['holds', 'assume', 'cost']) for (const f of fAll(w, k)) lines.push(`  ${k} ${f.value}`);
        hyps.push(w.id);
        break;
      }
      default: throw new NotExpressible(`wire type ${w.type} is not available in the current runtime`);
    }
  }
  // Query circuit: a policy, supposition facts, one query or one constraint.
  const q = qw.find(w => w.type === 'query'), c = qw.find(w => w.type === 'constraint');
  for (const w of qw) {
    if (w.type === 'policy') for (const f of w.fields) policy[f.key] = Number(f.value);
    else if (w.type === 'fact') lowerFact(w, true);
  }
  const needs = [...facts.map(x => '$' + x), ...rules.map(x => '~' + x)];
  if (c) {
    lines.push(`@${c.id} constraint`);
    for (const f of c.fields) lines.push(`  ${f.key} ${f.value}`);
    const select = f1(c, 'select') ? tokens(f1(c, 'select').value) : [];
    if (select.length) lines.push('@answer solve', `  constraint $${c.id}`, ...select.map(v => `  output ${v} one`), ...backendLines, ...(reasoningLine ? [reasoningLine] : []));
    else lines.push('@answer reason', `  constraint $${c.id}`, ...backendLines, ...(reasoningLine ? [reasoningLine] : []));
    return {text: lines.join('\n') + '\n', options: {policy}, dropped, kind: 'constraint'};
  }
  if (!q) throw new NotExpressible('no query in the query circuit');
  const mode = f1(q, 'mode')?.value.trim() ?? 'select';
  const where = fAll(q, 'where');
  if (['why_not', 'conform', 'procedure'].includes(mode)) throw new NotExpressible(`mode ${mode} is not available in the current runtime`);
  if (mode === 'plan') {
    lines.push('@goal goal'); for (const f of where) lines.push(...atomLines(f, 'where'));
    lines.push('@world pack', `  items ${needs.join(' ')}`);
    lines.push('@acts pack', `  items ${actions.map(a => '~' + a).join(' ')}`);
    lines.push('@answer plan', '  data $world', '  actions $acts', '  goal ~goal', ...backendLines, ...(reasoningLine ? [reasoningLine] : []));
    return {text: lines.join('\n') + '\n', options: {policy}, dropped, kind: 'plan'};
  }
  lines.push(`@${q.id} query`);
  for (const f of where) lines.push(...atomLines(f, 'where'));
  if (f1(q, 'during')) throw new NotExpressible('during means "throughout the interval" in the proposal; the current runtime\'s during is "overlaps some instant"');
  for (const k of ['select', 'at']) if (f1(q, k)) lines.push(`  ${k} ${f1(q, k).value}`);
  if (f1(q, 'overlaps')) lines.push(`  during ${f1(q, 'overlaps').value}`);
  // asof only selects governed wires in the smoke suite (the facts carry no known-at metadata): it is not passed on
  if (addAt && !f1(q, 'at') && !f1(q, 'overlaps')) lines.push('  at 2026-09-26');
  const outMode = mode === 'abduce' ? 'exists' : mode;
  lines.push(`  mode ${outMode}`);
  for (const f of fAll(q, 'scope')) lines.push(...atomLines(f, 'scope'));
  const ifs = fAll(q, 'if').map(f => f.value.trim().slice(1));
  for (const k of ['unless', 'because', 'so', 'although', 'so_that', 'before', 'after', 'when', 'while']) if (f1(q, k)) throw new NotExpressible(`link keyword ${k} is not lowered by this adapter`);
  lines.push('@world pack', `  items ${needs.join(' ')}`);
  if (mode === 'abduce') {
    lines.push('@cands pack', `  items ${hyps.map(h => '~' + h).join(' ')}`);
    lines.push('@answer abduce', `  query $${q.id}`, '  data $world', '  candidates $cands');
    return {text: lines.join('\n') + '\n', options: {policy}, dropped, kind: 'abduce'};
  }
  const hasTime = Boolean(f1(q, 'overlaps'));
  lines.push(`@answer ${hasTime ? 'temporal' : 'reason'}`, `  query $${q.id}`, '  data $world', ...backendLines);
  if (reasoningLine) lines.push(reasoningLine);
  const assume = [...new Set([...ifs, ...assumptions])];
  if (assume.length) lines.push(`  assume ${assume.length === 1 ? '$' + assume[0] : '$assumed'}`);
  if (assume.length > 1) lines.splice(lines.indexOf('@world pack') + 0, 0, '@assumed pack', `  items ${assume.map(a => '$' + a).join(' ')}`);
  return {text: lines.join('\n') + '\n', options: {policy}, dropped, kind: mode};
}

const stripVar = b => Object.fromEntries(Object.entries(b ?? {}).map(([k, v]) => [k.replace(/^\?/, ''), v]));
const atomStr = a => [a.neg ? 'not' : null, a.p, ...a.a].filter(Boolean).join(' ');

/** Normalize a Runtime result packet. */
export function normalize(a, kind) {
  const out = {status: a.status, complete: a.complete ?? true, route: a.route ? `${a.route.operation}/${a.route.backend}${a.route.fallback ? ' (fallback)' : ''}` : undefined};
  if (a.complete === false && a.status === 'unknown') out.status = 'budget_exhausted';
  if (a.kind === 'planning' && a.depthLimited && a.complete === false) out.reason = 'horizon'; // the product's own flag for a plan-length cut, in the proposal's vocabulary
  if (a.hypothetical) out.conditional = true;
  if (['select', 'count'].includes(a.kind)) out.rows = (a.answers ?? []).map(x => stripVar(x.binding));
  if (a.kind === 'count') out.count = a.count;
  if (a.kind === 'constraint') {
    out.witness = a.witness ?? undefined;
    if (a.objective !== undefined) out.objective = a.objective;
    const bound = Object.entries(a.outputProjection ?? {}).filter(([, v]) => v.status === 'bound');
    if (bound.length) out.witness = Object.fromEntries(bound.map(([k, v]) => [k.replace(/^\?/, ''), v.value]));
  }
  if (a.kind === 'planning') {
    const p = a.plans?.[0];
    if (p) out.plan = {steps: p.steps.length, cost: p.steps.reduce((s, x) => s + (x.cost ?? 1), 0), names: p.steps.map(x => x.action)};
  }
  if (a.kind === 'abduction') out.hypotheses = (a.explanations ?? []).map(e => e.assumptions.map(atomStr));
  if (kind === 'explain' && a.proof) out.explain = {depth: a.depth, uses: a.proof.filter(p => p.kind === 'observed').map(p => atomStr(p.atom))};
  return out;
}

async function execute(adapter, c, ctx) {
  const low = lowerToProduct({knowledge: c.knowledge, query: c.query, backendLines: adapter.backendLines(c), reasoningLine: adapter.reasoningLine, addAt: adapter.addAt});
  const unsupported = adapter.refuse?.(low);
  if (unsupported) throw new NotExpressible(unsupported);
  // a circuit above the declared max_wires is a capability limit, never a wrong answer (the product parser would refuse it with "Too many wires")
  const wires = (low.text.match(/^@/gm) ?? []).length;
  if (adapter.max_wires && wires > adapter.max_wires) throw new NotExpressible(`max_wires: the lowered circuit has ${wires} wires, the declared limit is ${adapter.max_wires}`);
  Object.assign(process.env, solverEnv());
  const {Runtime} = await import(path.join(repo, 'sop/runtime.mjs'));
  const text = low.text;
  const rt = new Runtime({now: Date.parse('2026-09-26'), policy: low.options.policy});
  const r = await rt.run(text);
  ctx.lowered = text;
  const out = normalize(r.result, low.kind);
  // the product honestly says `complete: false` when it reaches its own default ceilings (rounds 32, probes 30,000, ...). On a case that asks for the
  // exact answer that is a capability limit of this legacy route (the case policy can only tighten the ceilings, never raise them), not a wrong answer
  const asksForBudget = c.expected?.budget || c.expected?.acceptable_if_incomplete || c.expected?.complete === false;
  if (out.complete === false && adapter.ceilings && !asksForBudget) throw new NotExpressible(`budget: the product stopped at its own default ceilings (${Object.entries(adapter.ceilings).map(([k, v]) => k + ' ' + v).join(', ')}); the exact answer is beyond this route`);
  return out;
}

const RELATIONAL = ['budget_probes', 'facts', 'select', 'open_world', 'classical_negation', 'rules', 'recursion', 'conflict', 'count', 'every', 'exists', 'conjunction', 'explain', 'whatif', 'epistemic_status', 'budget', 'temporal', 'interval', 'plan', 'abduce'];

export const referenceJs = {
  id: 'js-reference', status: 'available', origin: 'reasoning/ (reference strategy)',
  description: 'Current `reference` strategy: bounded JavaScript Horn, explicit negation as evidence, finite integer constraints, JS controllers for plan and abduce.',
  supports: new Set([...RELATIONAL, 'constraint', 'optimize']), max_wires: PRODUCT_MAX_WIRES, ceilings: PRODUCT_CEILINGS,
  backendLines: () => [], reasoningLine: '  reasoning reference',
  async available() { return {ok: true}; },
  run(c, ctx) { return execute(this, c, ctx); }
};

export const advancedProlog = {
  id: 'prolog-swi', status: 'available', origin: 'reasoning/ (advanced strategy, SWI-Prolog backend)', addAt: true,
  description: 'Current `advanced` strategy with backend prolog: SWI computes the Horn closure at a point in time; JS rebuilds the proof and checks agreement. Only deduce-style modes.',
  supports: new Set(['facts', 'select', 'open_world', 'classical_negation', 'rules', 'recursion', 'conflict', 'count', 'every', 'exists', 'conjunction', 'explain', 'whatif', 'epistemic_status', 'budget', 'budget_probes', 'temporal']), max_wires: PRODUCT_MAX_WIRES, ceilings: PRODUCT_CEILINGS,
  backendLines: () => ['  backend prolog'], reasoningLine: '  reasoning advanced',
  refuse: low => (['plan', 'abduce', 'constraint'].includes(low.kind) ? `backend prolog does not implement ${low.kind} (explicit_backend_not_available_for_mode)` : /^  during /m.test(low.text) ? 'the Prolog adapter handles point-in-time queries only, not intervals' : null),
  async available() { const s = solverEnv(); return fs.existsSync(s.SWIPL_BIN ?? '') ? {ok: true} : {ok: false, reason: 'swipl not found (set SWIPL_BIN)'}; },
  run(c, ctx) { return execute(this, c, ctx); }
};

export const advancedZ3 = {
  id: 'z3-lia', status: 'available', origin: 'reasoning/ (advanced strategy, Z3 backend)',
  description: 'Current `advanced` strategy with backend z3: QF_LIA constraints and optimisation. Not a Horn backend.',
  supports: new Set(['constraint', 'optimize']), max_wires: PRODUCT_MAX_WIRES, ceilings: PRODUCT_CEILINGS,
  backendLines: () => ['  backend z3'], reasoningLine: '  reasoning advanced',
  async available() { const s = solverEnv(); return fs.existsSync(s.Z3_BIN ?? '') ? {ok: true} : {ok: false, reason: 'z3 not found (set Z3_BIN)'}; },
  run(c, ctx) { return execute(this, c, ctx); }
};
