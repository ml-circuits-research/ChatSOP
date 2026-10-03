/**
 * The primitive interpreters of the formalization-machine experiment (experiments/proposal/formalization-machine-phase1.md; owner's
 * "Analysis 3" in experiments/proposal/owner-notes-2026-10-02-formalization.md). Offline research harness: nothing here is on the
 * product path.
 *
 * A primitive takes a resolved frame (concrete numbers, yes/no values, names, atoms; never text to interpret) and writes one SOP circuit
 * from it, which the product's engines execute through an Agent turn whose formalizer returns the circuit (the same route as
 * tools/eval/formalization-regression/expression.mjs). Every interpreter is structure: it builds wires from slots; it never reads the
 * problem's words. The primitive names, their texts and the SOP construct each one uses are data in
 * config/knowledge/formalizer-methods-v1 (`fp_primitive*`); this module is the code half the data names.
 *
 * Result of a primitive: {kind, value, status, sop, detail}
 *   kind: number | yesno | entity | list | set | undetermined | contradiction | text | error
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyseProgram, lowerProgram} from '../../../lib/formalize/expression-program.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let world = null;
/** The product's engines over a scratch memory: `run(sop, literals)` → the result packet of one Agent turn. */
export async function engines() {
  if (world) return world;
  const [{Repository}, {Agent}, {seedLexicon}] = await Promise.all([import('../../../memory/repository.mjs'), import('../../../server/agent.mjs'), import('../../../lib/knowledge-seeds.mjs')]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'method-lib-'));
  const repo = new Repository(root, {memory: JSON.parse(fs.readFileSync(path.join(ROOT, 'config/runtime.json'), 'utf8')).memory});
  repo.init('base');
  const lexicon = seedLexicon('core-min');
  let n = 0;
  // The message lists every literal the circuit states, so the validator's "stated value in the message" guard admits them.
  const run = async (sop, literals = []) => {
    const session = repo.session('base', 'ml', `c${++n}`);
    try {
      const message = `values: ${[...new Set(literals.map(String))].join(' ; ') || 'none'}`;
      const r = await new Agent({repo, session, lexicon, config: {}}).turn(message, {language: 'en', formalizer: {formalize: async () => sop}});
      return r.packet ?? {status: 'error', error: 'no packet'};
    } catch (error) { return {status: 'error', error: error.message}; }
    finally { try { repo.discard(session); } catch { /* gone */ } }
  };
  world = {run, lexicon, dispose: () => fs.rmSync(root, {recursive: true, force: true})};
  return world;
}

const q = s => JSON.stringify(String(s));
const fmt = v => typeof v === 'number' ? String(Number(v.toPrecision(12))) : q(v);
/** A predicate id from a model's relation name (prefixed, so it never collides with the base vocabulary). */
export const relId = name => `r_${String(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x'}`;
const answersOf = p => (p.answers ?? []).map(a => a.binding ?? a);
const slugOf = s => String(s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/^local_/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/** A returned symbol (`local_option_a`) → the name as the frame wrote it ("Option A"), by its slug; unknown symbols stay as they are. */
const nameBack = (names, v) => names.find(n => slugOf(n) === slugOf(v)) ?? String(v);
const fail = (detail, sop = null) => ({kind: 'error', value: null, status: 'error', sop, detail});

// ---------------------------------------------------------------- calculate (session rules with compute/compare)

/**
 * calculate: `expr` is an expression over input names (already expanded from the method's formula template); `inputs` maps each name
 * to a number or a yes/no. The inputs become registry values (a yes/no as 1/0 compared with 1), the line `answer = expr` is analysed and
 * lowered by lib/formalize/expression-program.mjs and executed.
 */
export async function calculate({expr, inputs}) {
  const names = Object.keys(inputs);
  const registry = [], map = new Map();
  names.forEach((name, i) => {
    const v = inputs[name];
    const value = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
    if (!Number.isFinite(value)) throw new Error(`input ${name} is not a number (${JSON.stringify(v)})`);
    registry.push({index: i + 1, value, span: String(value), context: name});
    map.set(name, typeof v === 'boolean' ? `(v${i + 1} == 1)` : `v${i + 1}`);
  });
  // Input names → registry references (longest names first, whole words only).
  let text = expr;
  for (const name of [...names].sort((a, b) => b.length - a.length)) text = text.replace(new RegExp(`(?<![\\w.])${name}(?![\\w])`, 'g'), map.get(name));
  const read = {lines: [{n: 1, name: 'answer', text}], unused: registry.map(r => r.index)};
  const an = analyseProgram(read, registry);
  if (!an.ok) return fail(`calculate: ${an.violations.map(v => v.message).join('; ')} [${text}]`);
  let low;
  try { low = lowerProgram(an, registry); } catch (error) { return fail(`calculate lowering: ${error.message}`); }
  const w = await engines();
  const p = await w.run(low.sop, registry.map(r => r.value));
  const type = an.program.lines.at(-1).type;
  if (type === 'boolean') {
    if (p.status === 'supported') return {kind: 'yesno', value: true, status: p.status, sop: low.sop};
    if (p.status === 'refuted') return {kind: 'yesno', value: false, status: p.status, sop: low.sop};
    return {kind: 'error', value: null, status: p.status, sop: low.sop, detail: `calculate: yes/no not decided (${p.status} ${p.error ?? ''})`};
  }
  const vals = answersOf(p).map(b => Object.values(b)[0]).filter(v => v !== undefined);
  if (!vals.length) return {kind: 'error', value: null, status: p.status, sop: low.sop, detail: `calculate: no value (${p.status} ${p.error ?? ''})`};
  const v = vals[0];
  if (typeof v === 'number') return {kind: 'number', value: v, status: p.status, sop: low.sop};
  return {kind: 'entity', value: String(v), status: p.status, sop: low.sop};
}

// ---------------------------------------------------------------- rank (choice: stated options, a rank query)

/** rank: options [{name, score: number, feasible: boolean|undefined}], direction lowest|highest → the best option(s). */
export async function rank({options, direction}) {
  if (!options.length) return fail('rank: no options');
  if (!['lowest', 'highest'].includes(direction)) return fail(`rank: direction must be lowest or highest, not ${direction}`);
  const out = ['@r_option predicate\n  args subject:entity\n', '@r_raw_score predicate\n  args subject:entity object:value\n', '@r_feasible predicate\n  args subject:entity\n',
    '@r_score predicate\n  args subject:entity object:value\n'];
  const literals = [];
  options.forEach((o, k) => {
    literals.push(o.name, o.score);
    out.push(`@o${k + 1} stated\n  certainty asserted\n  relation "r_option"\n  role subject ${q(o.name)}\n  polarity affirmed\n`);
    out.push(`@s${k + 1} stated\n  certainty asserted\n  relation "r_raw_score"\n  role subject ${q(o.name)}\n  role object ${fmt(o.score)}\n  polarity affirmed\n`);
    if (o.feasible !== false) out.push(`@f${k + 1} stated\n  certainty asserted\n  relation "r_feasible"\n  role subject ${q(o.name)}\n  polarity affirmed\n`);
  });
  out.push('@rs rule\n  when r_option ?o\n  when r_feasible ?o\n  when r_raw_score ?o ?v\n  then r_score ?o ?v\n');
  out.push(`@q query\n  select ?o\n  where match\n    relation "r_score"\n    role subject ?o\n    role object ?v\n    polarity affirmed\n  end\n  rank ${direction} ?v\n`);
  const sop = out.join('\n');
  if (!options.some(o => o.feasible !== false)) return {kind: 'set', value: [], status: 'none_feasible', sop, detail: 'no option is feasible'};
  const w = await engines();
  const p = await w.run(sop, literals);
  const vals = [...new Set(answersOf(p).map(b => b.o ?? Object.values(b)[0]).filter(v => v !== undefined).map(v => nameBack(options.map(o => o.name), v)))];
  if (!vals.length) return {kind: 'error', value: null, status: p.status, sop, detail: `rank: no answer (${p.status} ${p.error ?? ''})`};
  return vals.length === 1 ? {kind: 'entity', value: vals[0], status: p.status, sop} : {kind: 'set', value: vals, status: 'tie', sop, detail: 'tie'};
}

// ---------------------------------------------------------------- deduce (facts, rules, defaults; closed or open world)

/** An atom string `[not ]relation term [term]` → {negated, relation, args: [SOP terms]}; terms are "quoted names", ?vars or numbers. */
export function readAtom(text) {
  let s = String(text ?? '').trim();
  let negated = false;
  const m = /^not\s+/i.exec(s);
  if (m) { negated = true; s = s.slice(m[0].length); }
  const toks = [...s.matchAll(/"(?:[^"\\]|\\.)*"|“[^”]*”|\?[A-Za-z_][\w]*|[^\s]+/g)].map(x => x[0]);
  if (toks.length < 2 || toks.length > 3) throw new Error(`atom "${text}" must be a relation with one or two terms`);
  const [relation, ...rest] = toks;
  if (/^["?]/.test(relation)) throw new Error(`atom "${text}" must start with a relation name`);
  const args = rest.map(t => t.startsWith('?') ? t.toLowerCase() : t.startsWith('"') ? JSON.stringify(JSON.parse(t)) : t.startsWith('“') ? JSON.stringify(t.slice(1, -1)) : /^-?\d+(\.\d+)?$/.test(t) ? t : JSON.stringify(t));
  return {negated, relation: relId(relation), args};
}

/**
 * deduce: facts (ground atoms, `not` = explicitly false), rules [{if: [atoms], unless: [atoms], then: atom}], question {ask, atom}:
 *   forced  yes when the atom is derived, else no (the problem is its own closed world: "does it follow, is it forced");
 *   truth   yes when derived, no when its negation is derived, else undetermined (open world: "is it true");
 *   who     the values of the ?variable of the atom; count: how many.
 */
export async function deduce({facts = [], rules = [], question}) {
  let fs_, rs, qa;
  try {
    // A fact written twice is one fact (the validator refuses a repeated statement).
    fs_ = [...new Map(facts.map(readAtom).map(a => [`${a.negated}|${a.relation}|${a.args.join(' ')}`, a])).values()];
    rs = rules.map(r => ({when: [].concat(r.if ?? r.when ?? []).map(readAtom), unless: [].concat(r.unless ?? []).map(readAtom), then: readAtom(r.then)}));
    qa = readAtom(question?.atom);
  } catch (error) { return fail(`deduce: ${error.message}`); }
  const ask = question?.ask ?? 'forced';
  if (!['forced', 'truth', 'who', 'count'].includes(ask)) return fail(`deduce: ask must be forced, truth, who or count, not ${ask}`);
  const arity = new Map();
  const note = a => { if (arity.has(a.relation) && arity.get(a.relation) !== a.args.length) throw new Error(`relation ${a.relation} used with ${a.args.length} and ${arity.get(a.relation)} terms`); arity.set(a.relation, a.args.length); };
  try { [...fs_, ...rs.flatMap(r => [...r.when, ...r.unless, r.then]), qa].forEach(note); } catch (error) { return fail(`deduce: ${error.message}`); }
  for (const f of fs_) if (f.args.some(t => t.startsWith('?'))) return fail(`deduce: a fact must be ground (${f.relation} ${f.args.join(' ')})`);
  for (const r of rs) {
    const bound = new Set(r.when.filter(a => !a.negated).flatMap(a => a.args.filter(t => t.startsWith('?'))));
    for (const t of [...r.then.args, ...r.unless.flatMap(a => a.args), ...r.when.filter(a => a.negated).flatMap(a => a.args)]) if (t.startsWith('?') && !bound.has(t)) return fail(`deduce: variable ${t} of a rule is not bound by a positive condition`);
  }
  const roleNames = n => n === 2 ? ['subject', 'object'] : ['subject'];
  // The problem is its own closed world (DS014 "Problems that state their own data"): every relation is complete, except the asked one
  // under `truth` (there, absence is undetermined, not false).
  const out = [...arity].map(([p, n]) => `@${p} predicate\n  args ${roleNames(n).map(r => `${r}:entity`).join(' ')}\n${ask === 'truth' && p === qa.relation ? '' : '  closed true\n'}`);
  const literals = [];
  fs_.forEach((f, k) => { literals.push(...f.args.map(t => JSON.parse(t))); out.push(`@s${k + 1} stated\n  certainty asserted\n  relation "${f.relation}"\n${f.args.map((t, i) => `  role ${roleNames(f.args.length)[i]} ${t}`).join('\n')}\n  polarity ${f.negated ? 'negated' : 'affirmed'}\n`); });
  const atom = a => `${a.negated ? 'not ' : ''}${a.relation} ${a.args.join(' ')}`;
  rs.forEach((r, k) => out.push(`@r${k + 1} rule\n${[...r.when.map(a => `  when ${atom(a)}`), ...r.unless.map(a => `  when absent ${a.relation} ${a.args.join(' ')}`)].join('\n')}\n  then ${atom(r.then)}\n`));
  const ground = !qa.args.some(t => t.startsWith('?'));
  if ((ask === 'forced' || ask === 'truth') && !ground) return fail('deduce: a yes/no question needs a ground atom');
  if ((ask === 'who' || ask === 'count') && ground) return fail('deduce: a who/count question needs a ?variable');
  const match = `  where match\n    relation "${qa.relation}"\n${qa.args.map((t, i) => `    role ${roleNames(qa.args.length)[i]} ${t}`).join('\n')}\n    polarity ${qa.negated ? 'negated' : 'affirmed'}\n  end\n`;
  // The asked things are anchored by one stated fact each, so the linker knows them even when no fact mentions them.
  if (ground) {
    out.push('@r_asked predicate\n  args subject:entity\n');
    qa.args.filter(t => t.startsWith('"')).forEach((t, k) => { literals.push(JSON.parse(t)); out.push(`@sa${k + 1} stated\n  certainty asserted\n  relation "r_asked"\n  role subject ${t}\n  polarity affirmed\n`); });
  }
  if (ask === 'forced') {
    const yes = `${qa.negated ? 'not ' : ''}${qa.relation} ${qa.args.join(' ')}`, anchor = qa.args[0];
    out.push(`@r_follows predicate\n  args subject:entity\n`, `@rq rule\n  when ${yes}\n  then r_follows ${anchor}\n`, `@rqn rule\n  when absent ${qa.negated ? 'not ' : ''}${qa.relation} ${qa.args.join(' ')}\n  then not r_follows ${anchor}\n`);
    out.push(`@q query\n  where match\n    relation "r_follows"\n    role subject ${anchor}\n    polarity affirmed\n  end\n`);
  } else if (ask === 'truth') out.push(`@q query\n${match}`);
  else { const v = qa.args.find(t => t.startsWith('?')); out.push(`@q query\n${ask === 'count' ? '  mode count\n' : ''}  select ${v}\n${match}`); }
  const sop = out.join('\n');
  const w = await engines();
  const p = await w.run(sop, literals);
  if (p.status === 'error') return fail(`deduce: ${p.error}`, sop);
  if (p.status === 'inconsistent' || p.status === 'contradiction') return {kind: 'contradiction', value: null, status: p.status, sop};
  if (ask === 'forced' || ask === 'truth') {
    if (p.status === 'supported') return {kind: 'yesno', value: true, status: p.status, sop};
    if (p.status === 'refuted') return {kind: 'yesno', value: false, status: p.status, sop};
    if (ask === 'truth') return {kind: 'undetermined', value: null, status: p.status, sop};
    return fail(`deduce: ${p.status}`, sop);
  }
  const names = literals.map(String);
  const vals = [...new Set(answersOf(p).map(b => Object.values(b)[0]).filter(v => v !== undefined).map(v => nameBack(names, v)))];
  if (ask === 'count') {
    const n = p.count ?? p.answers?.[0]?.count ?? vals.length;
    return {kind: 'number', value: Number(n), status: p.status, sop};
  }
  return {kind: vals.length === 1 ? 'entity' : 'set', value: vals.length === 1 ? vals[0] : vals, status: p.status, sop};
}

// ---------------------------------------------------------------- constraints (integer CSP: constraint wire, solved by the runtime)

const VAR = /^\?[a-z][a-z0-9_]*$/;
/** A variable name from a thing's name (structure: lowercase, letters and digits). */
export const varOf = name => { const s = String(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); return `?${/^[a-z]/.test(s) ? s : `x_${s}`}`.slice(0, 40); };

/**
 * constraints: variables [{name: ?x, min, max}], all_different [?x...], require [comparison lines in words, or {any: [...]} groups],
 * task possible|prove|optimize, claim (prove/possible), objective + direction (optimize), select [?x...].
 * Result: the selected values when every solution agrees (unique), `undetermined` when the solutions disagree, `contradiction` when
 * no assignment satisfies the requirements; prove → yes/no/undetermined.
 */
export async function constraints({variables = [], all_different = [], require = [], task = 'possible', claim = null, objective = null, direction = null, select = [], ask = null, raw = false}) {
  if (ask === 'count') return countSolutions({variables, all_different, require});
  // Existence without a claim or a selection: select every variable; one or several solutions mean yes, none means no.
  if (task === 'possible' && !select.length && !claim && !raw) {
    const r = await constraints({variables, all_different, require, task, select: variables.map(v => v.name)});
    if (r.kind === 'contradiction') return {...r, kind: 'yesno', value: false};
    if (r.kind === 'assignment' || r.kind === 'undetermined') return {...r, kind: 'yesno', value: true};
    return r;
  }
  if (!variables.length) return fail('constraints: no variables');
  for (const v of variables) if (!VAR.test(v.name) || !Number.isSafeInteger(v.min) || !Number.isSafeInteger(v.max) || v.min > v.max) return fail(`constraints: bad variable ${JSON.stringify(v)}`);
  const lines = [...variables.map(v => `  var ${v.name} int ${v.min} ${v.max}`)];
  const ad = [...new Set(all_different)];
  for (let i = 0; i < ad.length; i++) for (let j = i + 1; j < ad.length; j++) lines.push(`  require ${ad[i]} not_equal ${ad[j]}`);
  const group = (g, ind) => typeof g === 'string' ? [`${ind}${g}`] : g.any ? [`${ind}any`, ...g.any.flatMap(x => group(x, `${ind}  `)), `${ind}end`] : g.all ? [`${ind}all`, ...g.all.flatMap(x => group(x, `${ind}  `)), `${ind}end`] : [];
  for (const r of require) {
    if (typeof r === 'string') lines.push(`  require ${r}`);
    else { const g = group(r, '    '); lines.push(`  require ${g[0].trim()}`, ...g.slice(1)); }
  }
  // A raw existence check (counting) asks for one model through a claim every assignment satisfies, which yields a witness.
  if (claim) lines.push(`  claim ${claim}`);
  else if (raw && !select.length) lines.push(`  claim ${variables[0].name} equal ${variables[0].name}`);
  lines.push(`  task ${task}`);
  if (task === 'optimize') { if (!objective) return fail('constraints: optimize needs an objective'); lines.push(`  objective ${objective}`, `  direction ${direction === 'max' ? 'max' : 'min'}`); }
  if (select.length) lines.push(`  select ${select.join(' ')}`);
  const sop = `@c constraint\n${lines.join('\n')}\n`;
  const literals = [...sop.matchAll(/(?<![\w?])-?\d+(?![\w])/g)].map(m => m[0]);
  const w = await engines();
  const p = await w.run(sop, literals);
  if (p.status === 'error') return fail(`constraints: ${p.error}`, sop);
  if (['impossible', 'inconsistent'].includes(p.status)) return {kind: 'contradiction', value: null, status: p.status, sop};
  if (p.status === 'clarify') return {kind: 'undetermined', value: null, status: p.status, sop, detail: 'several solutions disagree on the selected values'};
  if (task === 'prove' && !select.length) {
    if (p.status === 'entailed') return {kind: 'yesno', value: true, status: p.status, sop};
    if (p.status === 'refuted') return {kind: 'yesno', value: false, status: p.status, sop};
    return {kind: 'undetermined', value: null, status: p.status, sop};
  }
  if (task === 'possible' && !select.length) return {kind: 'yesno', value: p.status === 'possible', status: p.status, sop, witness: p.witness ?? null};
  const proj = p.outputProjection ?? {};
  const values = Object.fromEntries(Object.entries(proj).filter(([, x]) => x.status === 'bound').map(([k, x]) => [k, x.value]));
  if (select.length && Object.keys(values).length < select.length) return {kind: 'undetermined', value: values, status: p.status, sop, detail: 'not every selected value is fixed'};
  return {kind: 'assignment', value: values, status: p.status, sop};
}

/**
 * The number of solutions (`ask: count`): solve, exclude the found assignment by an `any` group of not_equal lines, solve again, until
 * no assignment is left (at most 200; beyond that the count is reported as a lower bound by an error).
 */
async function countSolutions({variables, all_different, require}) {
  const seen = [];
  for (let i = 0; i <= 200; i++) {
    const exclude = seen.map(w => ({any: variables.map(v => `${v.name} not_equal ${w[v.name.slice(1)]}`)}));
    const r = await constraints({variables, all_different, require: [...require, ...exclude], task: 'possible', raw: true});
    if (r.kind === 'contradiction' || (r.kind === 'yesno' && r.value === false)) return {kind: 'number', value: seen.length, status: 'counted', sop: r.sop, detail: `${seen.length} solutions`};
    if (r.kind === 'error') return r;
    const w = r.witness;
    if (!w) return fail('constraints: no witness to count', r.sop);
    seen.push(w);
  }
  return fail('constraints: more than 200 solutions');
}

// ---------------------------------------------------------------- schedule (earliest finish over precedence: compute rules)

/** schedule: tasks [{name, duration}], after [[later, earlier]], setup (number) → the earliest finish (unlimited parallel work). */
export async function schedule({tasks, after = [], setup = 0}) {
  const names = tasks.map(t => t.name);
  for (const [a, b] of after) if (!names.includes(a) || !names.includes(b)) return fail(`schedule: unknown task in ${a} after ${b}`);
  const preds = new Map(names.map(n => [n, after.filter(([a]) => a === n).map(([, b]) => b)]));
  const order = [], state = new Map();
  const visit = n => { if (state.get(n) === 2) return true; if (state.get(n) === 1) return false; state.set(n, 1); for (const p of preds.get(n)) if (!visit(p)) return false; state.set(n, 2); order.push(n); return true; };
  for (const n of names) if (!visit(n)) return {kind: 'contradiction', value: null, status: 'cycle', sop: null, detail: 'the precedence has a cycle'};
  const id = new Map(names.map((n, i) => [n, `f${i + 1}`]));
  const inputs = {setup: Number(setup) || 0};
  tasks.forEach((t, i) => { inputs[`d${i + 1}`] = Number(t.duration); });
  // One expression: the finish of each task inlined (structure: the topological order), the earliest finish is their maximum.
  const finish = new Map();
  for (const n of order) {
    const d = `d${names.indexOf(n) + 1}`;
    const ps = preds.get(n).map(p => finish.get(p));
    finish.set(n, ps.length === 0 ? `(setup + ${d})` : ps.length === 1 ? `(${ps[0]} + ${d})` : `(Math.max(${ps.join(', ')}) + ${d})`);
  }
  const all = [...finish.values()];
  const expr = all.length === 1 ? all[0] : `Math.max(${all.join(', ')})`;
  if (expr.length > 4000) return fail('schedule: too large');
  return calculate({expr, inputs});
}

// ---------------------------------------------------------------- abduce (hypotheses ruled out by observations, support counted)

/**
 * abduce: hypotheses [names], table [{observation, hypothesis, effect: supports|contradicts}], ask consistent|best.
 * Closed world over the stated table: a hypothesis contradicted by an observation is ruled out; `best` ranks the consistent ones by the
 * number of observations that support them (an aggregate count), a tie is a set.
 */
export async function abduce({hypotheses, table = [], ask = 'best'}) {
  if (!hypotheses?.length) return fail('abduce: no hypotheses');
  for (const r of table) if (!hypotheses.includes(r.hypothesis)) return fail(`abduce: ${r.hypothesis} is not a listed hypothesis`);
  const out = ['@r_hyp predicate\n  args subject:entity\n  closed true\n', '@r_supports predicate\n  args subject:entity object:entity\n  closed true\n',
    '@r_contradicts predicate\n  args subject:entity object:entity\n  closed true\n', '@r_out predicate\n  args subject:entity\n  closed true\n', '@r_ok predicate\n  args subject:entity\n  closed true\n',
    '@r_support_n predicate\n  args subject:entity object:integer\n', '@r_ok_score predicate\n  args subject:entity object:integer\n', '@r_sup1 predicate\n  args subject:entity object:entity\n'];
  const literals = [];
  hypotheses.forEach((h, k) => { literals.push(h); out.push(`@h${k + 1} stated\n  certainty asserted\n  relation "r_hyp"\n  role subject ${q(h)}\n  polarity affirmed\n`); });
  table.forEach((r, k) => { literals.push(r.observation, r.hypothesis); if (r.effect === 'supports' || r.effect === 'contradicts') out.push(`@t${k + 1} stated\n  certainty asserted\n  relation "r_${r.effect}"\n  role subject ${q(r.observation)}\n  role object ${q(r.hypothesis)}\n  polarity affirmed\n`); });
  out.push('@ro rule\n  when r_contradicts ?o ?h\n  then r_out ?h\n', '@rk rule\n  when r_hyp ?h\n  when absent r_out ?h\n  then r_ok ?h\n');
  if (ask === 'discriminate') {
    // Observations that separate the hypotheses: one listed hypothesis is supported by the observation and another is contradicted.
    out.push('@r_disc predicate\n  args subject:entity\n', '@rd rule\n  when r_supports ?o ?h1\n  when r_contradicts ?o ?h2\n  then r_disc ?o\n');
    out.push('@q query\n  select ?o\n  where match\n    relation "r_disc"\n    role subject ?o\n    polarity affirmed\n  end\n');
  } else if (ask === 'consistent') {
    out.push('@q query\n  select ?h\n  where match\n    relation "r_ok"\n    role subject ?h\n    polarity affirmed\n  end\n');
  } else {
    // Every hypothesis supports itself once (a row per hypothesis), so a hypothesis without support counts 1 and stays rankable.
    out.push('@rs1 rule\n  when r_hyp ?h\n  then r_sup1 ?h ?h\n', '@rs2 rule\n  when r_supports ?o ?h\n  then r_sup1 ?o ?h\n');
    out.push('@agg aggregate\n  over r_sup1 ?o ?h\n  group ?h\n  count as ?n\n  yields r_support_n ?h ?n\n');
    out.push('@rk2 rule\n  when r_ok ?h\n  when r_support_n ?h ?n\n  then r_ok_score ?h ?n\n');
    out.push('@q query\n  select ?h\n  where match\n    relation "r_ok_score"\n    role subject ?h\n    role object ?n\n    polarity affirmed\n  end\n  rank highest ?n\n');
  }
  const sop = out.join('\n');
  const w = await engines();
  const p = await w.run(sop, literals);
  if (p.status === 'error') return fail(`abduce: ${p.error}`, sop);
  const vals = [...new Set(answersOf(p).map(b => b.h ?? b.o ?? Object.values(b)[0]).filter(v => v !== undefined).map(v => nameBack([...hypotheses, ...table.map(r => r.observation)], v)))];
  if (!vals.length && ask === 'discriminate') return {kind: 'set', value: [], status: p.status, sop, detail: 'no observation separates the hypotheses'};
  if (!vals.length) return {kind: 'contradiction', value: null, status: p.status, sop, detail: 'every hypothesis is ruled out'};
  return vals.length === 1 ? {kind: 'entity', value: vals[0], status: p.status, sop} : {kind: 'set', value: vals, status: p.status, sop};
}

export const PRIMITIVES = Object.freeze({calculate, rank, deduce, constraints, schedule, abduce});
