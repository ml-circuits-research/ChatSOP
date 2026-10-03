/**
 * Path A, method (top-down, templates; the method library config/knowledge/formalizer-methods-v1): what is asked → the goal type
 * (a closed menu of the library's goal types, filtered by structure: without numbers only the goal types that need none) → a method
 * among those that achieve it → its slots by registry index (or `sub`: a sub-goal, asked the same way, depth at most 4; the constants 0 and 1 are allowed as identity values). SOP comes
 * from each method's template, executed node by node by the machine (tools/eval/method-library/machine.mjs runTree: calculate, rank
 * and deduce primitives write and run the circuits). Methods of other solvers (constraints, schedule, abduce) are not routed by
 * this tree: the path stops honestly with no result.
 */
import {loadLibrary} from '../method-library/library.mjs';
import {runTree} from '../method-library/machine.mjs';
import {readAtom} from '../method-library/primitives.mjs';
import {ask, numbersBlock, answerLines, readChoice, readIndex, readRef, keyLines, withValues, ReadError} from './common.mjs';

const SOLVERS = new Set(['calculate', 'rank', 'deduce']);
const NOT_ASKED = new Set(['explain_answer', 'describe_decomposition', 'find_test']);
const NEEDS_NO_NUMBERS = new Set(['is_forced', 'is_true', 'find_who', 'count_things', 'find_order', 'find_assignment', 'best_explanation']);
let LIB = null;
const lib = () => (LIB ??= loadLibrary());

/** A `fact:` / `rule:` / `question:` block → {facts, rules, question} for the deduce primitive, or null. */
export function readLogic(text) {
  const facts = [], rules = [];
  let question = null;
  for (const l of answerLines(text)) {
    let m;
    if ((m = /^fact\s*:\s*(.+)$/i.exec(l))) facts.push(m[1].trim().replace(/[.;]$/, ''));
    else if ((m = /^rule\s*:\s*if\s+(.+?)\s+then\s+(.+)$/i.exec(l))) {
      const [cond, unless] = m[1].split(/\s+unless\s+/i);
      rules.push({if: cond.split(/\s+and\s+/i).map(s => s.trim()), unless: unless ? unless.split(/\s+and\s+/i).map(s => s.trim()) : [], then: m[2].trim().replace(/[.;]$/, '')});
    } else if ((m = /^question\s*:\s*(.+)$/i.exec(l))) question = m[1].trim().replace(/[?.]$/, '');
  }
  if (!(question && (facts.length || rules.length))) return null;
  // Every atom must be `[not ]relation term [term]` (the deduce primitive's notation); a bad one is named in the one re-ask.
  const bad = [];
  const check = a => { try { readAtom(a); } catch (error) { bad.push(error.message); } };
  facts.forEach(check); rules.forEach(r => [...r.if, ...r.unless, r.then].forEach(check)); check(question);
  if (bad.length) throw new ReadError(`${bad.slice(0, 3).join('; ')}. An atom is one relation word and one or two quoted names or ?x, like: fact: likes "Ana" "Mara"`);
  return {facts, rules, question};
}

export async function pathA({item, registry, ctx}) {
  const L = lib();
  const base = {problem: item.question, numbers: numbersBlock(registry)};
  const parts = await ask(ctx, 'A_parts', base, t => {
    const out = answerLines(t).map(l => /^g\d+\s*[:.)-]\s*(.+)$/i.exec(l)?.[1]).filter(Boolean);
    return out.length ? out.slice(0, 3) : null;
  }, {maxTokens: 150});
  if (!parts) return {status: 'unreadable', at: 'A_parts'};
  const types = [...L.goalTypes.values()].filter(t => !NOT_ASKED.has(t.id) && (registry.length || NEEDS_NO_NUMBERS.has(t.id)));
  const nodes = [], goals = [], goalNode = new Map();
  // Each further asked thing gets its own question budget (a root-to-leaf path per part).
  ctx.maxQuestions += 6 * (parts.value.length - 1);
  let n = 0;

  // One node: choose a method for `part` among those achieving `type`, fill its slots; `sub` slots become sub-nodes (depth ≤ 3).
  const node = async (part, typeIds, depth) => {
    const methods = [...L.methods.values()].filter(m => m.achieves.some(t => typeIds.includes(t)) && SOLVERS.has(m.solver))
      .filter(m => registry.length || m.solver !== 'calculate').sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999));
    if (!methods.length) throw Object.assign(new Error(`no routed method for ${typeIds.join('/')}`), {status: 'no_method'});
    let m = methods[0];
    if (methods.length > 1) {
      // Answered by NAME (a closed choice without positions: a numbered menu drew position-1 answers on dev1).
      const byName = t => { const w = String(t).toLowerCase().replace(/[`*"'.]/g, '').trim(); const hit = methods.findIndex(x => w === x.id || w.startsWith(`${x.id} `) || w.startsWith(`${x.id}:`)); if (hit >= 0) return hit + 1; const inside = methods.map((x, i) => [i + 1, x.id]).filter(([, id]) => new RegExp(`\\b${id}\\b`).test(w)); return inside.length === 1 ? inside[0][0] : null; };
      const c = await ask(ctx, 'A_method', {...base, part, menu: methods.map(x => `- ${x.id}: ${x.text}${x.formula ? `; ${x.formula}` : ''}`).join('\n')}, byName, {maxTokens: 20});
      if (!c) throw Object.assign(new Error('A_method unreadable'), {status: 'unreadable'});
      m = methods[c.value - 1];
    }
    const id = `n${++n}`;
    const entry = {id, method: m.id, slots: {}};
    nodes.push(entry);
    if (m.solver === 'deduce') {
      const wantsVar = ['who', 'count'].includes(m.fixed.ask);
      const a = await ask(ctx, 'A_logic', {problem: item.question, part, method: m.id, method_text: m.text}, t => {
        const r = readLogic(t);
        if (r && wantsVar !== /\?[a-z]/i.test(r.question)) throw new ReadError(wantsVar ? 'the question must contain ?x (who or how many)' : 'the question must name things in quotes, without ?x (yes or no)');
        return r;
      }, {maxTokens: 700});
      if (!a) throw Object.assign(new Error('A_logic unreadable'), {status: 'unreadable'});
      entry.slots = {facts: a.value.facts, rules: a.value.rules, question: a.value.question};
      return id;
    }
    const slots = m.slots.filter(s => !(s.name in m.fixed));
    const describe = s => `${s.name}: ${s.kind === 'menu' ? `one of ${s.choices.map(c => c.value).join(' | ')}` : s.many || ['numbers', 'yesnos', 'things'].includes(s.kind) ? 'a list' : s.kind === 'yesno' ? 'a yes/no value (usually sub)' : s.kind === 'thing' ? 'a name from the problem' : 'a number'}${s.optional ? ' (optional: leave out if not needed)' : ''}${s.text ? ` - ${s.text}` : ''}`;
    const reader = t => {
      const got = new Map(keyLines(t));
      const out = {};
      for (const s of slots) {
        const raw = got.get(s.name.toLowerCase());
        if (raw === undefined || raw === '' || /^(none|-|n\/a)$/i.test(raw)) { if (s.optional) continue; return null; }
        if (s.kind === 'menu') { const c = s.choices.find(x => raw.toLowerCase().includes(x.value.toLowerCase())); if (!c) return null; out[s.name] = c.value; continue; }
        const item1 = x => (/^sub\b/i.test(x.trim()) ? {sub: true} : s.kind.startsWith('yesno') && /^(yes|true)$/i.test(x.trim()) ? true : s.kind.startsWith('yesno') && /^(no|false)$/i.test(x.trim()) ? false : /^g\d+$/i.test(x.trim()) && goalNode.has(x.trim().toLowerCase()) ? goalNode.get(x.trim().toLowerCase()) : /^\s*[01]\s*$/.test(x) && !registry.some(r => r.value === Number(x)) ? {const: Number(x), why: 'identity constant'} : /^\s*[-−+]/.test(x) ? null : readRef(x, registry) ? `v${readRef(x, registry)}` : null);
        if (s.kind === 'things') { out[s.name] = raw.split(/\s*,\s*/).map(x => x.trim()).filter(Boolean); continue; }
        if (s.many || ['numbers', 'yesnos'].includes(s.kind)) {
          const parts = raw.split(/\s*,\s*|\s+and\s+/), xs = parts.map(item1); if (!xs.length) return null;
          const badItem = parts.find((p, i) => xs[i] === null); if (badItem !== undefined) throw new ReadError(`${s.name}: "${badItem.trim().slice(0, 30)}" is not a number of the problem; write vK, or sub for a value that must be computed first`);
          // A sum, product, mean or all/any over one item is no combination: the reader names it (structure: the formula's function).
          if (xs.length < 2 && new RegExp(`(?:sum|prod|mean|all|any)\\(\\s*${s.name}\\s*\\)`).test(m.formula ?? '')) throw new ReadError(`${s.name} needs at least two values for ${m.id}`);
          out[s.name] = xs; continue;
        }
        const x = item1(raw); if (x === null) throw new ReadError(`${s.name}: "${raw.slice(0, 30)}" is not a number of the problem; write vK, or sub for a value that must be computed first`); out[s.name] = x;
      }
      return out;
    };
    const a = await ask(ctx, 'A_slots', {...base, part, method: m.id, method_text: m.text, formula: m.formula ? `\nFormula: ${m.formula}` : '', earlier: goalNode.size ? `an asked thing already found (${[...goalNode.keys()].map(g => `${g}: ${parts.value[Number(g.slice(1)) - 1]}`).join('; ')}), ` : '', slots: slots.map(describe).join('\n')}, reader, {maxTokens: 250});
    if (!a) throw Object.assign(new Error('A_slots unreadable'), {status: 'unreadable'});
    for (const s of slots) {
      const v = a.value[s.name];
      if (v === undefined) continue;
      const one = async (x, i) => {
        if (!(x && typeof x === 'object' && x.sub === true)) return x; // never `x.sub` on a string: String.prototype.sub exists
        if (depth >= 4) throw Object.assign(new Error('sub-goals deeper than 4'), {status: 'too_deep'});
        const want = s.kind === 'yesno' || s.kind === 'yesnos' ? ['check_condition'] : ['find_value'];
        return node(`${s.text || s.name}${Array.isArray(v) ? ` (item ${i + 1})` : ''}, an input of "${m.text}" for: ${part}`, want, depth + 1);
      };
      if (Array.isArray(v) && s.kind !== 'things') { const xs = []; for (const [i, x] of v.entries()) xs.push(await one(x, i)); entry.slots[s.name] = xs; }
      else entry.slots[s.name] = await one(v, 0);
    }
    return id;
  };

  try {
    for (const [i, part] of parts.value.entries()) {
      const g = await ask(ctx, 'A_goal', {...base, part, menu: types.map((t, k) => `${k + 1}. ${t.text}`).join('\n')}, t => readChoice(t, types.map(x => x.id)), {maxTokens: 20});
      if (!g) return {status: 'unreadable', at: 'A_goal'};
      const type = types[g.value - 1].id;
      const root = await node(part, [type], 1);
      goals.push({id: `g${i + 1}`, type, node: root});
      goalNode.set(`g${i + 1}`, root);
    }
  } catch (error) {
    return {status: error.status ?? 'error', why: error.message};
  }
  const tree = {goals, nodes};
  const exec = async values => {
    const r = await runTree(tree, {lib: L, registry: withValues(registry, values)});
    const out = r.goals.map(g => (g.state === 'EXECUTED' ? g.result.value : null));
    return out.every(v => v === null || v === undefined) ? null : out.filter(v => v !== null && v !== undefined);
  };
  const first = await exec(new Map(registry.map(v => [v.index, v.value])));
  if (!first) {
    const r = await runTree(tree, {lib: L, registry});
    return {status: 'not_executed', why: r.goals.map(g => `${g.state}: ${g.reason ?? ''}`).join('; ').slice(0, 300), tree};
  }
  return {status: 'ok', exec, tree};
}
