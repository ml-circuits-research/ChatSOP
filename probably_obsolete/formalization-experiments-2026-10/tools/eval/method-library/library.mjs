/**
 * The method library of the formalization-machine experiment as base-memory data (config/knowledge/formalizer-methods-v1, a research
 * layer read only by this harness; experiments/proposal/formalization-machine-phase1.md). Goal types, METHODs (match / requires /
 * decompose / solver) and primitives are `fp_` facts; this module reads them into a library object, renders the library block of the
 * prompt, checks a proposed method, and writes an admitted method back as SOP facts. Offline research harness, not the product path.
 *
 * Facts (one `holds` per fact wire, DS004; declared in 0001-vocabulary.sop):
 *   fp_primitive P / fp_primitive_text P "..." / fp_primitive_construct P "the SOP construct and engine"
 *   fp_gtype T / fp_gtype_text T "..." / fp_gtype_answer T number|yesno|entity|order|assignment|set|text / fp_gtype_operation T "..."
 *   fp_method M / fp_method_achieves M T / fp_method_solver M P / fp_method_text M "use when ..." / fp_method_seq M n / fp_method_added M stage
 *   fp_method_slot M S kind / fp_slot_text M S "..." / fp_slot_many M S / fp_slot_optional M S / fp_slot_choice M S value "operator"
 *   fp_method_decompose M S T      the slot is normally the output of a sub-goal of type T (the HTN decomposition)
 *   fp_method_formula M "..."      calculate: the formula over the slot names (the model never writes a formula)
 *   fp_method_clue M kind "..."    constraints: the requirement template of a clue kind over ?A ?B and K
 *   fp_method_fixed M field value  a frame field the method fixes (ask forced, task possible, distinct yes, domain positions, ...)
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {factsOf} from '../../../lib/formalize/protocol-data.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const LAYER = path.join(ROOT, 'config/knowledge/formalizer-methods-v1');
export const SLOT_KINDS = Object.freeze(['number', 'numbers', 'yesno', 'yesnos', 'menu', 'thing', 'things', 'atoms', 'rules', 'question', 'clues', 'tasks', 'pairs', 'table', 'variables', 'conditions', 'text', 'node']);
export const FUNCTIONS = Object.freeze(['sum', 'prod', 'max', 'min', 'count', 'mean', 'pick', 'ceil', 'floor', 'round', 'abs', 'round2']);

const circuitsOf = dir => fs.readdirSync(dir).filter(n => n.endsWith('.sop')).sort().map(file => ({file, text: fs.readFileSync(path.join(dir, file), 'utf8')}));

/** The library of the layer `dir` (default the shipped research layer): {primitives, goalTypes, methods, version}. */
export function loadLibrary(dir = LAYER) {
  const f = factsOf(circuitsOf(dir));
  const rows = p => f.get(p) ?? [];
  const primitives = new Map(rows('primitive').map(([p]) => [p, {id: p, text: '', construct: ''}]));
  for (const [p, t] of rows('primitive_text')) primitives.get(p).text = t;
  for (const [p, t] of rows('primitive_construct')) primitives.get(p).construct = t;
  const goalTypes = new Map(rows('gtype').map(([t]) => [t, {id: t, text: '', answer: '', operation: ''}]));
  for (const [t, x] of rows('gtype_text')) goalTypes.get(t).text = x;
  for (const [t, x] of rows('gtype_answer')) goalTypes.get(t).answer = x;
  for (const [t, x] of rows('gtype_operation')) goalTypes.get(t).operation = x;
  const methods = new Map(rows('method').map(([m]) => [m, {id: m, achieves: [], solver: null, text: '', seq: null, added: null, slots: [], formula: null, clues: {}, fixed: {}}]));
  const M = m => { if (!methods.has(m)) throw new Error(`fact about undeclared method ${m}`); return methods.get(m); };
  for (const [m, t] of rows('method_achieves')) M(m).achieves.push(t);
  for (const [m, p] of rows('method_solver')) M(m).solver = p;
  for (const [m, t] of rows('method_text')) M(m).text = t;
  for (const [m, n] of rows('method_seq')) M(m).seq = Number(n);
  for (const [m, n] of rows('method_added')) M(m).added = String(n);
  for (const [m, s, kind] of rows('method_slot')) M(m).slots.push({name: s, kind, text: '', many: false, optional: false, choices: [], subgoal: null});
  const S = (m, s) => { const x = M(m).slots.find(y => y.name === s); if (!x) throw new Error(`fact about undeclared slot ${m}.${s}`); return x; };
  for (const [m, s, t] of rows('slot_text')) S(m, s).text = t;
  for (const [m, s] of rows('slot_many')) S(m, s).many = true;
  for (const [m, s] of rows('slot_optional')) S(m, s).optional = true;
  for (const [m, s, v, op] of rows('slot_choice')) S(m, s).choices.push({value: String(v), op: String(op ?? v)});
  for (const [m, s, t] of rows('method_decompose')) S(m, s).subgoal = t;
  for (const [m, t] of rows('method_formula')) M(m).formula = t;
  for (const [m, k, t] of rows('method_clue')) M(m).clues[k] = t;
  for (const [m, k, v] of rows('method_fixed')) M(m).fixed[k] = v;
  return {primitives, goalTypes, methods, version: circuitsOf(dir).map(c => c.text).join('').length};
}

/** The library block of the prompt: primitives, goal types, methods with their slots (rendered from the data, no text in code). */
export function renderLibrary(lib) {
  const out = ['PRIMITIVES (the executable interpreters):', ...[...lib.primitives.values()].map(p => `- ${p.id}: ${p.text}`), '', 'GOAL TYPES:',
    ...[...lib.goalTypes.values()].map(t => `- ${t.id} (answer: ${t.answer}; operation: ${t.operation}): ${t.text}`), '', 'METHODS:'];
  for (const m of [...lib.methods.values()].sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999))) {
    out.push(`* ${m.id}  [achieves ${m.achieves.join(', ')}; solver ${m.solver}]  ${m.text}`);
    if (m.formula) out.push(`    formula: ${m.formula}`);
    for (const s of m.slots) out.push(`    slot ${s.name}: ${s.kind}${s.many ? ' (list)' : ''}${s.optional ? ' (optional)' : ''}${s.choices.length ? ` one of ${s.choices.map(c => c.value).join('|')}` : ''}${s.subgoal ? ` (usually a sub-goal of type ${s.subgoal})` : ''}${s.text ? ` - ${s.text}` : ''}`);
    for (const [k, t] of Object.entries(m.clues)) out.push(`    clue kind ${k}: ${t}`);
    // `unit` is a rendering annotation of the result (a clock time), not a frame field the filler sees.
    for (const [k, v] of Object.entries(m.fixed)) if (k !== 'unit') out.push(`    fixed ${k} = ${v}`);
  }
  return out.join('\n');
}

const IDENT = /^[a-z][a-z0-9_]{1,48}$/;

/** Checks a proposed method {id, achieves, solver, text, slots: [{name, kind, many?, optional?, text?, choices?, subgoal?}], formula?, clues?, fixed?}. */
export function checkMethod(spec, lib, {newGoalTypes = []} = {}) {
  const problems = [];
  if (!IDENT.test(spec.id ?? '')) problems.push(`id ${spec.id} must be lowercase_with_underscores`);
  if (lib.methods.has(spec.id)) problems.push(`method ${spec.id} already exists`);
  const types = new Set([...lib.goalTypes.keys(), ...newGoalTypes.map(t => t.id)]);
  for (const t of [].concat(spec.achieves ?? [])) if (!types.has(t)) problems.push(`goal type ${t} is unknown`);
  if (!lib.primitives.has(spec.solver)) problems.push(`solver ${spec.solver} is not a primitive`);
  const names = new Set();
  for (const s of spec.slots ?? []) {
    if (!IDENT.test(s.name ?? '') && !/^[a-z]$/.test(s.name ?? '')) problems.push(`slot name ${s.name}`);
    if (!SLOT_KINDS.includes(s.kind)) problems.push(`slot kind ${s.kind} of ${s.name}`);
    names.add(s.name);
  }
  // A fixed field may only set a frame switch of its solver; a fixed text or value would be an answer carried by the method.
  const FIXED = {calculate: ['series', 'unit'], deduce: ['ask'], constraints: ['task', 'direction', 'distinct', 'ask'], rank: ['direction'], abduce: ['ask'], justify: ['mode']};
  for (const k of Object.keys(spec.fixed ?? {})) if (!(FIXED[spec.solver] ?? []).includes(k)) problems.push(`fixed ${k} is not a frame switch of ${spec.solver}`);
  if (spec.solver === 'justify' && !spec.fixed?.mode) problems.push('a justify method without a mode adds nothing to justify_answer (the derivation of a node)');
  if (spec.solver === 'calculate') {
    if (!spec.formula) problems.push('a calculate method needs a formula');
    else for (const w of String(spec.formula).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) if (!names.has(w) && !FUNCTIONS.includes(w) && !['Math', 'true', 'false'].includes(w) && !(w === 'position' && spec.fixed?.series)) problems.push(`formula word ${w} is neither a slot nor a function`);
  }
  return problems;
}

const fact = (id, ...args) => `@${id} fact\n  holds ${args.join(' ')}\n`;
const txt = s => JSON.stringify(String(s));

/** The SOP facts of a method (appended to a layer file); `prefix` keeps the wire ids unique. */
export function methodSop(spec, {seq, stage, prefix = spec.id}) {
  const out = [`# --- ${spec.id}`];
  let k = 0;
  const id = () => `fpm_${prefix}_${++k}`;
  out.push(fact(id(), 'fp_method', spec.id));
  for (const t of [].concat(spec.achieves)) out.push(fact(id(), 'fp_method_achieves', spec.id, t));
  out.push(fact(id(), 'fp_method_solver', spec.id, spec.solver), fact(id(), 'fp_method_text', spec.id, txt(spec.text ?? '')));
  out.push(fact(id(), 'fp_method_seq', spec.id, seq), fact(id(), 'fp_method_added', spec.id, stage));
  for (const s of spec.slots ?? []) {
    out.push(fact(id(), 'fp_method_slot', spec.id, s.name, s.kind));
    if (s.text) out.push(fact(id(), 'fp_slot_text', spec.id, s.name, txt(s.text)));
    if (s.many) out.push(fact(id(), 'fp_slot_many', spec.id, s.name));
    if (s.optional) out.push(fact(id(), 'fp_slot_optional', spec.id, s.name));
    for (const c of s.choices ?? []) out.push(fact(id(), 'fp_slot_choice', spec.id, s.name, c.value, txt(c.op ?? c.value)));
    if (s.subgoal) out.push(fact(id(), 'fp_method_decompose', spec.id, s.name, s.subgoal));
  }
  if (spec.formula) out.push(fact(id(), 'fp_method_formula', spec.id, txt(spec.formula)));
  for (const [kind, t] of Object.entries(spec.clues ?? {})) out.push(fact(id(), 'fp_method_clue', spec.id, kind, txt(t)));
  for (const [f, v] of Object.entries(spec.fixed ?? {})) out.push(fact(id(), 'fp_method_fixed', spec.id, f, v));
  return out.join('\n');
}

/** The SOP facts of a goal type. */
export function goalTypeSop(t) {
  return [`# --- goal type ${t.id}`, fact(`fpg_${t.id}_1`, 'fp_gtype', t.id), fact(`fpg_${t.id}_2`, 'fp_gtype_text', t.id, txt(t.text)), fact(`fpg_${t.id}_3`, 'fp_gtype_answer', t.id, t.answer),
    fact(`fpg_${t.id}_4`, 'fp_gtype_operation', t.id, txt(t.operation))].join('\n');
}

/** The SOP facts of a primitive. */
export function primitiveSop(p) {
  return [`# --- primitive ${p.id}`, fact(`fpp_${p.id}_1`, 'fp_primitive', p.id), fact(`fpp_${p.id}_2`, 'fp_primitive_text', p.id, txt(p.text)), fact(`fpp_${p.id}_3`, 'fp_primitive_construct', p.id, txt(p.construct))].join('\n');
}
