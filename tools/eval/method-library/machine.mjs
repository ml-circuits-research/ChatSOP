/**
 * The formalization machine of experiments/proposal/formalization-machine-phase1.md (owner's "Analysis 3"): a filled method tree
 * (goals → typed nodes, each node a METHOD of the library with its slots filled by references) is checked against the library, its slots
 * are resolved to concrete values, every node is executed by its method's primitive as one SOP circuit in dependency order (a node's
 * output feeds the slots that reference it), and every goal ends in a known state. Offline research harness, not the product path.
 *
 * The model writes only the tree: goal types, method names and slot fillings (references to the numbers v1..vn of the registry, to
 * other nodes nK, names copied from the problem, atoms and clues in the frame formats). It never writes a formula; a constant that is not
 * in the problem is allowed only as {"const": x, "why": "..."} and is counted.
 *
 * Goal states (machine level, before the gold): EXECUTED | MISSING_METHOD | UNSUPPORTED_PRIMITIVE | FILL_ERROR | ENGINE_ERROR |
 * a status the model declared (AMBIGUOUS, MISSING_INFORMATION, MISSING_CONCEPT, MISSING_METHOD, UNSUPPORTED_PRIMITIVE, CONTRADICTORY).
 */
import {PRIMITIVES, varOf} from './primitives.mjs';

export const DECLARED = Object.freeze(['AMBIGUOUS', 'MISSING_INFORMATION', 'MISSING_CONCEPT', 'MISSING_METHOD', 'UNSUPPORTED_PRIMITIVE', 'CONTRADICTORY']);
export const OUTCOMES = Object.freeze(['SOLVED', 'PARTIALLY_FORMALIZED', 'AMBIGUOUS', 'MISSING_INFORMATION', 'MISSING_CONCEPT', 'MISSING_METHOD', 'UNSUPPORTED_PRIMITIVE', 'CONTRADICTORY', 'WRONG']);

class FillError extends Error {}
const isRef = (x, p) => typeof x === 'string' && new RegExp(`^${p}\\d+$`).test(x.trim());

/** The JSON object of a model answer (the first {...} block that parses), or null. */
export function readTree(text) {
  const s = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  for (let end = s.lastIndexOf('}'); end > start; end = s.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* shorter */ }
  }
  return null;
}

/** Nodes in dependency order (a node after every node its slots reference); throws on a cycle or an unknown node reference. */
function orderNodes(nodes) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const refs = n => [...JSON.stringify(n.slots ?? {}).matchAll(/"(n\d+)"/g)].map(m => m[1]);
  const out = [], state = new Map();
  const visit = id => {
    if (state.get(id) === 2) return; if (state.get(id) === 1) throw new FillError(`node ${id} depends on itself`);
    const n = byId.get(id); if (!n) throw new FillError(`node ${id} is referenced but not defined`);
    state.set(id, 1); refs(n).forEach(visit); state.set(id, 2); out.push(n);
  };
  nodes.forEach(n => visit(n.id));
  return out;
}

/**
 * Runs a tree. `lib` the library, `registry` [{index, value, percent}] of the problem. Returns {goals: [{id, type, state, node, result,
 * reason}], nodes: {id: {method, result, error}}, consts, usedMethods, flags}.
 */
export async function runTree(tree, {lib, registry, extra = null}) {
  const methods = new Map([...lib.methods, ...(extra?.methods ?? [])]);
  const goalTypes = new Map([...lib.goalTypes, ...(extra?.goalTypes ?? [])]);
  const reg = new Map(registry.map(v => [`v${v.index}`, v.percent ? v.value / 100 : v.value]));
  const consts = [], flags = [];
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes.filter(n => n && typeof n.id === 'string') : [];
  const results = new Map(), errors = new Map();
  let ordered = [];
  try { ordered = orderNodes(nodes); } catch (error) { for (const n of nodes) errors.set(n.id, {state: 'FILL_ERROR', reason: error.message}); }

  const value = (x, want, where) => {
    if (x && typeof x === 'object' && !Array.isArray(x) && 'const' in x) { consts.push({where, value: x.const, why: x.why ?? null}); return x.const; }
    if (typeof x === 'number' || typeof x === 'boolean') { consts.push({where, value: x, why: null}); return x; }
    if (isRef(x, 'v')) { const v = reg.get(x.trim()); if (v === undefined) throw new FillError(`${where}: ${x} is not a number of the problem`); return v; }
    if (isRef(x, 'n')) {
      const id = x.trim();
      if (errors.has(id)) throw new FillError(`${where}: depends on ${id}, which failed (${errors.get(id).reason})`);
      const r = results.get(id); if (!r) throw new FillError(`${where}: ${id} has no result`);
      if (want === 'number' && r.kind !== 'number') throw new FillError(`${where}: ${id} gives a ${r.kind}, a number is needed`);
      if (want === 'yesno' && r.kind !== 'yesno') throw new FillError(`${where}: ${id} gives a ${r.kind}, a yes/no is needed`);
      return r.value;
    }
    if (typeof x === 'string' && want === 'number' && /^-?\d+(\.\d+)?$/.test(x.trim())) { consts.push({where, value: Number(x), why: null}); return Number(x); }
    throw new FillError(`${where}: ${JSON.stringify(x)} is not a reference (vK, nK) or {"const": ..., "why": ...}`);
  };

  for (const n of ordered) {
    if (errors.has(n.id)) continue;
    const m = methods.get(n.method);
    if (!m) { errors.set(n.id, {state: 'MISSING_METHOD', reason: `no method ${n.method} in the library`}); continue; }
    if (!PRIMITIVES[m.solver] && m.solver !== 'justify') { errors.set(n.id, {state: 'UNSUPPORTED_PRIMITIVE', reason: `the solver ${m.solver} of ${m.id} has no interpreter`}); continue; }
    try {
      const frame = await frameOf(n, m, {value, results, flags});
      let r = m.solver === 'justify' ? justify(frame, {results, nodes, methods}) : frame.series ? await series(frame) : await PRIMITIVES[m.solver](frame);
      if (frame.post) r = finishClues(r, frame.post);
      // A primitive that refused its frame before building a circuit is a filling error; a circuit the engines did not answer is an engine error.
      if (r.kind === 'error') errors.set(n.id, {state: r.sop ? 'ENGINE_ERROR' : 'FILL_ERROR', reason: r.detail, sop: r.sop});
      else results.set(n.id, {...r, method: m.id, ...(m.fixed.unit ? {unit: m.fixed.unit} : {})});
    } catch (error) {
      errors.set(n.id, {state: error instanceof FillError ? 'FILL_ERROR' : 'ENGINE_ERROR', reason: error.message});
    }
  }

  const goals = (Array.isArray(tree?.goals) ? tree.goals : []).map((g, i) => {
    const id = g.id ?? `g${i + 1}`;
    const declared = String(g.status ?? '').toUpperCase();
    if (DECLARED.includes(declared)) return {id, type: g.type ?? null, state: declared, reason: g.reason ?? null};
    if (g.type && !goalTypes.has(g.type)) return {id, type: g.type, state: 'MISSING_METHOD', reason: `goal type ${g.type} is not in the library`};
    const node = String(g.node ?? '').trim();
    if (!node) return {id, type: g.type, state: 'FILL_ERROR', reason: 'the goal names no node'};
    if (errors.has(node)) return {id, type: g.type, node, state: errors.get(node).state, reason: errors.get(node).reason};
    const r = results.get(node);
    if (!r) return {id, type: g.type, node, state: 'FILL_ERROR', reason: `node ${node} is not defined`};
    return {id, type: g.type, node, state: 'EXECUTED', result: r};
  });
  // The methods of the tree that executed (the composition actually used), for coverage and reuse.
  const used = [...new Set([...results.values()].map(r => r.method))];
  const nodeReport = Object.fromEntries(nodes.map(n => [n.id, {method: n.method, ...(results.has(n.id) ? {kind: results.get(n.id).kind, value: results.get(n.id).value} : {}), ...(errors.has(n.id) ? {error: errors.get(n.id)} : {})}]));
  return {goals, nodes: nodeReport, consts, usedMethods: used, attempted: [...new Set(nodes.map(n => n.method))], flags};
}

/** The frame of a node for its method's primitive (structure only: slot values substituted into the method's data). */
async function frameOf(n, m, {value, results, flags}) {
  const slots = n.slots ?? {};
  for (const s of m.slots) if (!s.optional && !(s.name in slots) && !(s.name in m.fixed)) throw new FillError(`${n.id}: slot ${s.name} of ${m.id} is not filled`);
  for (const k of Object.keys(slots)) if (!m.slots.some(s => s.name === k)) throw new FillError(`${n.id}: ${m.id} has no slot ${k}`);
  const slot = name => m.slots.find(s => s.name === name);
  const list = (name) => { const v = slots[name]; if (v === undefined) return []; if (!Array.isArray(v)) throw new FillError(`${n.id}: slot ${name} must be a list`); return v; };
  const menu = name => {
    const s = slot(name), v = slots[name] ?? m.fixed[name];
    const c = s?.choices.find(x => x.value === String(v));
    if (s?.choices.length && !c) throw new FillError(`${n.id}: slot ${name} must be one of ${s.choices.map(x => x.value).join('|')}`);
    return c ? c.op : v;
  };
  switch (m.solver) {
    case 'calculate': {
      let expr = m.formula;
      const inputs = {};
      // List slots: sum/prod/max/min/count/mean/pick over the items; scalar slots: by name; menu slots: their operator.
      // Menu slots first (a menu may name the list function, like largest → max), then lists, then scalars.
      for (const s of [...m.slots].sort((a, b) => (b.kind === 'menu') - (a.kind === 'menu'))) {
        if (!(s.name in slots) && !(s.name in m.fixed)) continue;
        if (s.kind === 'menu') { const op = menu(s.name); expr = expr.replace(new RegExp(`(?<![\\w])${s.name}(?![\\w])(\\s*\\()?`, 'g'), (_, call) => call ? `${op}(` : ` ${op} `); continue; }
        if (s.many || s.kind === 'numbers' || s.kind === 'yesnos') {
          const items = list(s.name).map((x, i) => { const name = `${s.name}_${i + 1}`; inputs[name] = value(x, s.kind === 'yesnos' ? 'yesno' : 'number', `${n.id}.${s.name}[${i}]`); return name; });
          if (!items.length) throw new FillError(`${n.id}: slot ${s.name} is empty`);
          const sub = {sum: `(${items.join(' + ')})`, prod: `(${items.join(' * ')})`, max: items.length > 1 ? `Math.max(${items.join(', ')})` : items[0], min: items.length > 1 ? `Math.min(${items.join(', ')})` : items[0],
            count: String(items.length), mean: `((${items.join(' + ')}) / ${items.length})`, all: `(${items.join(' && ')})`, any: `(${items.join(' || ')})`};
          expr = expr.replace(new RegExp(`(sum|prod|max|min|count|mean|all|any)\\(\\s*${s.name}\\s*\\)`, 'g'), (_, f) => sub[f]);
          expr = expr.replace(new RegExp(`pick\\(\\s*${s.name}\\s*,\\s*([^)]+)\\)`, 'g'), (_, idx) => items.slice(0, -1).reduceRight((acc, it, i) => `((${idx.trim()}) == ${i + 1} ? ${it} : ${acc})`, items.at(-1)));
          if (new RegExp(`(?<![\\w])${s.name}(?![\\w])`).test(expr)) throw new FillError(`${n.id}: the formula uses the list ${s.name} outside sum/prod/max/min/count/mean/pick`);
          continue;
        }
        inputs[s.name] = value(slots[s.name], s.kind === 'yesno' ? 'yesno' : 'number', `${n.id}.${s.name}`);
      }
      expr = expr.replace(/(?<![\w.])(ceil|floor|round|abs)\(/g, 'Math.$1(').replace(/(?<![\w.])round2\(([^()]*(?:\([^()]*\))*[^()]*)\)/g, '(Math.round(($1) * 100) / 100)');
      // A series method (fixed series = the slot that counts the terms): the formula over `position` for position 1..count, a list.
      if (m.fixed.series) {
        const count = Number(inputs[m.fixed.series]);
        if (!Number.isInteger(count) || count < 1 || count > 60) throw new FillError(`${n.id}: ${m.fixed.series} must be a whole number from 1 to 60`);
        return {series: Array.from({length: count}, (_, i) => ({expr, inputs: {...inputs, position: i + 1}}))};
      }
      return {expr, inputs};
    }
    case 'rank': {
      const options = list('options').map(String);
      const scores = list('score'), feasible = slots.feasible === undefined ? null : list('feasible');
      if (!options.length) throw new FillError(`${n.id}: no options`);
      if (scores.length !== options.length) throw new FillError(`${n.id}: ${scores.length} scores for ${options.length} options`);
      if (feasible && feasible.length !== options.length) throw new FillError(`${n.id}: ${feasible.length} feasibility values for ${options.length} options`);
      return {options: options.map((o, i) => ({name: o, score: value(scores[i], 'number', `${n.id}.score[${i}]`), feasible: feasible ? value(feasible[i], 'yesno', `${n.id}.feasible[${i}]`) : undefined})), direction: menu('direction') ?? m.fixed.direction};
    }
    case 'deduce': {
      const question = typeof slots.question === 'string' ? {atom: slots.question} : {...(slots.question ?? {})};
      if (m.fixed.ask) question.ask = m.fixed.ask;
      const facts = [...list('facts').map(String)];
      // A yes/no node of another primitive may enter as a fact (`fact_from: [{node, atom}]`): the atom when yes, its negation when no.
      for (const f of slots.fact_from ? list('fact_from') : []) { const v = value(f.node, 'yesno', `${n.id}.fact_from`); facts.push(v ? f.atom : `not ${f.atom}`); }
      if (question.atom && facts.some(f => f.replace(/\s+/g, ' ').trim() === String(question.atom).replace(/\s+/g, ' ').trim())) flags.push({node: n.id, flag: 'answer_as_fact'});
      return {facts, rules: list('rules'), question};
    }
    case 'constraints': {
      if (Object.keys(m.clues).length) return clueFrame(n, m, {slots, list, value});
      const variables = list('variables').map(v => ({name: String(v.name).startsWith('?') ? String(v.name) : `?${v.name}`, min: Number(value(v.min, 'number', `${n.id}.min`)), max: Number(value(v.max, 'number', `${n.id}.max`))}));
      return {variables, all_different: list('all_different').map(x => String(x).startsWith('?') ? String(x) : `?${x}`), require: list('conditions'), task: m.fixed.task ?? slots.task ?? 'possible', claim: slots.claim ?? null, ask: m.fixed.ask ?? null,
        objective: slots.objective ?? null, direction: slots.direction ?? m.fixed.direction ?? null, select: list('select').map(x => String(x).startsWith('?') ? String(x) : `?${x}`)};
    }
    case 'schedule':
      return {tasks: list('tasks').map((t, i) => ({name: String(t.name), duration: value(t.duration, 'number', `${n.id}.tasks[${i}]`)})), after: list('after').map(p => [String(p[0]), String(p[1])]),
        setup: slots.setup === undefined ? 0 : value(slots.setup, 'number', `${n.id}.setup`)};
    case 'abduce':
      return {hypotheses: list('hypotheses').map(String), table: list('table').map(r => ({observation: String(r.observation), hypothesis: String(r.hypothesis), effect: String(r.effect)})), ask: m.fixed.ask ?? slots.ask ?? 'best'};
    case 'justify': {
      const target = String(slots.node ?? '');
      if (!results.has(target)) throw new FillError(`${n.id}: ${target} has no result to justify`);
      return {target, mode: m.fixed.mode ?? 'derivation'};
    }
    default: throw new FillError(`${n.id}: no frame for solver ${m.solver}`);
  }
}

/** A series: the formula once per position (each one calculate circuit); the list of values. */
async function series({series: frames}) {
  const values = [];
  for (const f of frames) { const r = await PRIMITIVES.calculate(f); if (r.kind !== 'number') return r; values.push(r.value); }
  return {kind: 'list', value: values, status: 'supported', sop: null};
}

/** A clue-based constraint frame (order or assignment): one integer variable per thing, the clue templates of the method as requirements. */
function clueFrame(n, m, {slots, list, value}) {
  const things = list('things').map(String);
  const values = slots.values === undefined ? null : list('values').map(String);
  if (things.length < 2) throw new FillError(`${n.id}: at least two things`);
  const size = values ? values.length : slots.size !== undefined ? Number(value(slots.size, 'number', `${n.id}.size`)) : things.length;
  const v = name => { const i = things.findIndex(t => t.toLowerCase() === String(name).toLowerCase()); if (i < 0) throw new FillError(`${n.id}: ${name} is not one of the things`); return varOf(things[i]); };
  const k = x => {
    if (values) { const i = values.findIndex(t => t.toLowerCase() === String(x).toLowerCase()); if (i >= 0) return i + 1; }
    const num = Number(typeof x === 'object' ? value(x, 'number', `${n.id}.k`) : isRef(x, 'v') ? value(x, 'number', `${n.id}.k`) : x);
    if (!Number.isInteger(num)) throw new FillError(`${n.id}: ${JSON.stringify(x)} is neither a value nor a position`);
    return num;
  };
  const require = [];
  for (const [i, c] of list('clues').entries()) {
    const t = m.clues[c.kind];
    if (!t) throw new FillError(`${n.id}: clue ${i + 1} kind ${c.kind} is not one of ${Object.keys(m.clues).join(', ')}`);
    const fill = s => s.replace(/\?A\b/g, () => v(c.a)).replace(/\?B\b/g, () => v(c.b)).replace(/\?C\b/g, () => v(c.c)).replace(/\bK\b/g, () => String(k(c.k))).replace(/\bN\b/g, String(size));
    for (const part of t.split(/\s*&\s*/)) {
      const alts = part.split(/\s*\|\s*/).map(fill);
      require.push(alts.length === 1 ? alts[0] : {any: alts});
    }
  }
  const vars = things.map(varOf);
  const ask = slots.ask_thing !== undefined ? {thing: String(slots.ask_thing)} : slots.ask_value !== undefined ? {value: slots.ask_value} : null;
  return {variables: vars.map(name => ({name, min: 1, max: size})), all_different: m.fixed.distinct === 'no' ? [] : vars, require, task: 'possible', select: vars,
    post: {things, values, ask, order: !values}};
}

/**
 * The justification of an executed node (the runtime's derivation, rendered): its method, its resolved inputs, its result. Mode
 * `structure`: the decomposition itself (the sub-problems that read only the problem's data, and the nodes that join them).
 */
function justify({target, mode = 'derivation'}, {results, nodes, methods}) {
  const lines = [];
  if (mode === 'structure') {
    const sub = new Set(), join = [];
    const walk = id => { const n = nodes.find(x => x.id === id); if (!n) return; const refs = [...JSON.stringify(n.slots).matchAll(/"(n\d+)"/g)].map(x => x[1]); if (!refs.length) sub.add(id); else { join.push(id); refs.forEach(walk); } };
    walk(target);
    const show = id => { const n = nodes.find(x => x.id === id); return `${id} (${n?.method}: ${methods.get(n?.method)?.text ?? ''}) = ${JSON.stringify(results.get(id)?.value)}`; };
    lines.push(`${sub.size} independent sub-problems on the stated data:`, ...[...sub].map(id => `  ${show(id)}`), `${join.length} joining steps:`, ...[...new Set(join)].reverse().map(id => `  ${show(id)}`));
    return {kind: 'text', value: lines.join('\n'), status: 'justified', sop: null};
  }
  const walk = (id, depth) => {
    const r = results.get(id), n = nodes.find(x => x.id === id), m = methods.get(n?.method);
    if (!r || depth > 6) return;
    lines.push(`${'  '.repeat(depth)}${id} = ${JSON.stringify(r.value)} by ${m?.id} (${m?.text ?? ''}) from ${JSON.stringify(n.slots)}`);
    for (const ref of [...JSON.stringify(n.slots).matchAll(/"(n\d+)"/g)].map(x => x[1])) walk(ref, depth + 1);
  };
  walk(target, 0);
  return {kind: 'text', value: lines.join('\n'), status: 'justified', sop: null};
}

/** The post-processing of a clue frame's assignment: the order of the things, a thing's value, or the thing of a value. */
export function finishClues(r, post) {
  if (r.kind !== 'assignment' || !post) return r;
  const pos = Object.fromEntries(post.things.map(t => [t, r.value[varOf(t)]]));
  if (post.ask?.thing) { const p = pos[post.things.find(t => t.toLowerCase() === post.ask.thing.toLowerCase())]; return {...r, kind: post.values ? 'entity' : 'number', value: post.values ? post.values[p - 1] : p}; }
  if (post.ask?.value !== undefined) {
    const want = post.values ? post.values.findIndex(x => x.toLowerCase() === String(post.ask.value).toLowerCase()) + 1 : Number(post.ask.value);
    const hit = post.things.filter(t => pos[t] === want);
    return {...r, kind: hit.length === 1 ? 'entity' : 'set', value: hit.length === 1 ? hit[0] : hit};
  }
  if (post.order) return {...r, kind: 'order', value: [...post.things].sort((a, b) => pos[a] - pos[b])};
  return {...r, kind: 'assignment', value: Object.fromEntries(post.things.map(t => [t, post.values[pos[t] - 1]]))};
}

/**
 * One circuit for the arithmetic part of a tree (the N-way candidate, lib/formalize/dual-check.mjs): when every node the goals reach is
 * a calculate method (no series), the nodes become lines `nK = <the method's formula over vK, nJ and constants>` of one expression
 * program over the problem's registry, the goals' nodes its answers `answer1..`, analysed and lowered by
 * lib/formalize/expression-program.mjs. Its stated values are the registry numbers, so the circuit can be perturbed like any other
 * candidate. Returns {sop, program, answers: [goal ids]} or null (a goal outside arithmetic, or a fill the analysis refuses).
 */
export async function composeCalculation(tree, {lib, registry, analyse, lower}) {
  const nodes = new Map((tree?.nodes ?? []).map(n => [n.id, n]));
  const goals = (tree?.goals ?? []).filter(g => g.node && nodes.has(String(g.node).trim()));
  if (!goals.length) return null;
  const need = new Set(), stack = goals.map(g => String(g.node).trim());
  while (stack.length) { const id = stack.pop(); if (need.has(id)) continue; const n = nodes.get(id); if (!n) return null; need.add(id); stack.push(...[...JSON.stringify(n.slots ?? {}).matchAll(/"(n\d+)"/g)].map(m => m[1])); }
  let ordered;
  try { ordered = orderNodes([...need].map(id => nodes.get(id))); } catch { return null; }
  const reg = new Set(registry.map(v => `v${v.index}`));
  const symbol = x => {
    if (x && typeof x === 'object' && !Array.isArray(x) && 'const' in x) return x.const;
    if (typeof x === 'number' || typeof x === 'boolean') return x;
    if (isRef(x, 'v') && reg.has(x.trim())) return x.trim();
    if (isRef(x, 'n') && need.has(x.trim())) return x.trim();
    if (typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x.trim())) return Number(x);
    throw new FillError(`not a reference: ${JSON.stringify(x)}`);
  };
  const lines = [];
  for (const n of ordered) {
    const m = lib.methods.get(n.method);
    if (!m || m.solver !== 'calculate' || m.fixed.series) return null;
    let frame;
    try { frame = await frameOf(n, m, {value: symbol, results: new Map(), flags: []}); } catch { return null; }
    let text = frame.expr;
    for (const name of Object.keys(frame.inputs).sort((a, b) => b.length - a.length)) {
      const v = frame.inputs[name];
      text = text.replace(new RegExp(`(?<![\\w.])${name}(?![\\w])`, 'g'), typeof v === 'boolean' ? String(v) : typeof v === 'number' ? `(${v})` : v);
    }
    lines.push({n: lines.length + 1, name: n.id, text});
  }
  goals.forEach((g, i) => lines.push({n: lines.length + 1, name: `answer${i + 1}`, text: String(g.node).trim()}));
  const used = new Set(lines.flatMap(l => [...l.text.matchAll(/\bv(\d+)\b/g)].map(m => Number(m[1]))));
  const an = analyse({lines, unused: registry.map(v => v.index).filter(k => !used.has(k))}, registry);
  if (!an.ok) return null;
  try { return {sop: lower(an, registry).sop, program: an.program, answers: goals.map(g => g.id)}; } catch { return null; }
}
