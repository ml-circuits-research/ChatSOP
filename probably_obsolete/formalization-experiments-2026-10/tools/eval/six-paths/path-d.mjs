/**
 * Path D, backward (goal regression): what must be found → for each quantity, what is needed to get it (registry numbers, quantities
 * already in the plan, or new intermediate quantities) and how they combine (a closed menu, config/knowledge/formalizer-six-paths-v1
 * `fp_sp_combine`; asked first, then the inputs in the shape the combination takes: first/second, one input, or a list) → recursion until every leaf is a registry number. SOP comes from the dependency tree as a rule graph: one session
 * rule per node (lowered through lib/formalize/expression-program.mjs). The expression of each combination is structure (the menu
 * entry's arithmetic), never an interpretation of the problem's words.
 */
import {ask, numbersBlock, questions, answerLines, ident, readRef, readChoice, ReadError} from './common.mjs';
import {programResult} from './program.mjs';

const BINARY = new Set(['difference', 'quotient', 'ceil_quotient', 'floor_quotient', 'remainder', 'percent_of', 'increase_percent', 'decrease_percent', 'at_most', 'at_least', 'below', 'above', 'equal']);
const UNARY = new Set(['round', 'copy']);
const YESNO = new Set(['at_most', 'at_least', 'below', 'above', 'equal', 'all', 'any']);

/** The expression of a combination over input terms; `pct(t)` is the fraction of a percentage input. */
function combine(op, xs, pct) {
  const [a, b] = xs;
  switch (op) {
    case 'sum': return xs.join(' + ');
    case 'product': return xs.map(x => `(${x})`).join(' * ');
    case 'difference': return `${a} - (${b})`;
    case 'quotient': return `(${a}) / (${b})`;
    case 'ceil_quotient': return `Math.ceil((${a}) / (${b}))`;
    case 'floor_quotient': return `Math.floor((${a}) / (${b}))`;
    case 'remainder': return `(${a}) % (${b})`;
    case 'percent_of': return `${pct(a)} * (${b})`;
    case 'increase_percent': return `(${a}) * (1 + ${pct(b)})`;
    case 'decrease_percent': return `(${a}) * (1 - ${pct(b)})`;
    case 'min': return xs.length > 1 ? `Math.min(${xs.join(', ')})` : a;
    case 'max': return xs.length > 1 ? `Math.max(${xs.join(', ')})` : a;
    case 'mean': return `(${xs.join(' + ')}) / ${xs.length}`;
    case 'round': return `Math.round(${a})`;
    case 'copy': return a;
    case 'at_most': return `${a} <= ${b}`;
    case 'at_least': return `${a} >= ${b}`;
    case 'below': return `${a} < ${b}`;
    case 'above': return `${a} > ${b}`;
    case 'equal': return `${a} == ${b}`;
    case 'all': return xs.join(' && ');
    case 'any': return xs.join(' || ');
    default: return null;
  }
}

export async function pathD({item, registry, ctx}) {
  if (!registry.length) return {status: 'no_numbers'};
  // Two questions per quantity (combination, then its inputs): a root-to-leaf path of 3 quantities is 7 questions.
  ctx.maxQuestions = Math.max(ctx.maxQuestions, 13);
  const base = {problem: item.question, numbers: numbersBlock(registry)};
  const goalsAns = await ask(ctx, 'D_goal', base, t => {
    const out = answerLines(t).map(l => /^goal\s*\d*\s*:\s*([^:|]+?)\s*:\s*([^|]+?)\s*(?:\|\s*(.+))?$/i.exec(l)).filter(Boolean)
      .map(m => ({name: ident(m[1]), what: m[2].slice(0, 120), yesno: /yes/i.test(m[3] ?? '') && !/number/i.test(m[3] ?? '')})).filter(g => g.name);
    if (out.some(g => /^v\d+$/.test(g.name))) throw new ReadError('a goal is what the question asks for, with a new lowercase name, never a number vK of the problem');
    return out.length ? out.slice(0, 3) : null;
  }, {maxTokens: 200});
  if (!goalsAns) return {status: 'unreadable', at: 'D_goal'};
  const nodes = new Map(); // name → {what, inputs, op}
  const order = [];
  const queue = goalsAns.value.map(g => g.name);
  for (const g of goalsAns.value) nodes.set(g.name, {what: g.what, yesno: g.yesno});
  const menu = questions().combine;
  const ops = menu.map(([op]) => op);
  const plan = () => [...nodes].map(([n, x]) => x.op ? `${n} (${x.what}) = ${x.op}(${x.inputs.join(', ')})` : `${n} (${x.what}): to find`).join('\n');
  while (queue.length) {
    const name = queue.shift();
    const node = nodes.get(name);
    if (node.op) continue;
    // Step 1: the combination (closed menu, filtered by the node's kind: a yes/no quantity is combined by a yes/no entry).
    const choices = menu.map(([op, t], i) => ({op, t, k: i + 1})).filter(c => (node.yesno ? YESNO.has(c.op) : !YESNO.has(c.op)));
    const comb = await ask(ctx, 'D_combine', {...base, plan: plan(), node: name, what: node.what, menu: choices.map((c, i) => `${i + 1}. ${c.t}`).join('\n')}, t => {
      const c = t.replace(/^\s*combin\w*\s*[:=]\s*/i, '');
      let k = readChoice(c, choices.map(x => x.t));
      if (!k && /^(?:\w+\s*\+\s*)+\w+$/.test(c.trim())) k = choices.findIndex(x => x.op === 'sum') + 1;
      if (!k && /^(?:\w+\s*[*×]\s*)+\w+$/.test(c.trim())) k = choices.findIndex(x => x.op === 'product') + 1;
      return k >= 1 ? choices[k - 1].op : null;
    }, {maxTokens: 30});
    if (!comb) return {status: 'unreadable', at: `D_combine ${name}`};
    const op = comb.value;
    // Step 2: the inputs, in the shape the combination takes (first and second, one input, or a list).
    const shape = BINARY.has(op) ? 'first: <input>\nsecond: <input>' : UNARY.has(op) ? 'input: <input>' : 'inputs: <input>, <input>, ...';
    const parseInput = raw => {
      raw = raw.replace(/[<>]/g, '').trim();
      const v = /^(?:v\d+\b|-?\d[\d,.]*%?$)/i.test(raw) ? readRef(raw, registry) : null;
      if (v) return {ref: `v${v}`};
      const m = /^([A-Za-z_][\w ]*?)\s*(?:\((.*)\))?$/.exec(raw);
      const id = m ? ident(m[1]) : null;
      if (!id) throw new ReadError(`"${raw.slice(0, 40)}" is neither a number vK nor a quantity name`);
      return {ref: id, what: m[2] ?? null};
    };
    const a = await ask(ctx, 'D_inputs', {...base, plan: plan(), node: name, what: node.what, combination: menu.find(([o]) => o === op)[1], shape}, t => {
      const kv = new Map(answerLines(t).map(l => /^(first|second|inputs?)\s*[:=]\s*(.+)$/i.exec(l)).filter(Boolean).map(m => [m[1].toLowerCase(), m[2]]));
      let inputs;
      if (BINARY.has(op)) { if (!kv.has('first') || !kv.has('second')) return null; inputs = [parseInput(kv.get('first')), parseInput(kv.get('second'))]; }
      else { const raw = kv.get('inputs') ?? kv.get('input'); if (!raw) return null; inputs = raw.split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean).map(parseInput); }
      if (UNARY.has(op) && inputs.length !== 1) throw new ReadError(`this combination takes exactly one input, and ${inputs.length} were listed`);
      if (!inputs.length) return null;
      if (inputs.some(x => x.ref === name)) throw new ReadError(`${name} cannot be an input of itself; name the quantities it is computed from`);
      return {op, inputs};
    }, {maxTokens: 200});
    if (!a) return {status: 'unreadable', at: `D_inputs ${name}`};
    node.op = a.value.op; node.inputs = a.value.inputs.map(x => x.ref);
    if (node.inputs.includes(name)) return {status: 'rejected', why: `${name} needs itself`};
    for (const x of a.value.inputs) if (!/^v\d+$/.test(x.ref)) {
      if (!nodes.has(x.ref)) { nodes.set(x.ref, {what: x.what ?? x.ref}); queue.push(x.ref); }
    }
    if (ctx.questions >= ctx.maxQuestions && queue.length) return {status: 'budget', why: 'more than the question budget'};
  }
  // Dependency order (inputs first); a cycle is a rejection.
  const state = new Map();
  const visit = n => {
    if (/^v\d+$/.test(n)) return true;
    if (state.get(n) === 2) return true; if (state.get(n) === 1) return false;
    state.set(n, 1); for (const x of nodes.get(n).inputs) if (!visit(x)) return false; state.set(n, 2); order.push(n); return true;
  };
  for (const g of goalsAns.value) if (!visit(g.name)) return {status: 'rejected', why: 'cycle'};
  const pct = t => (/^v\d+$/.test(t) && registry.find(v => `v${v.index}` === t)?.percent ? t : `((${t}) / 100)`);
  const safe = n => (n === 'answer' || /^answer\d+$/.test(n) ? `${n}_q` : n);
  const lines = order.map(n => ({name: safe(n), text: combine(nodes.get(n).op, nodes.get(n).inputs.map(x => (/^v\d+$/.test(x) ? x : safe(x))), pct)}));
  goalsAns.value.forEach((g, i) => lines.push({name: `answer${i + 1}`, text: safe(g.name)}));
  const res = programResult(lines, registry, {message: item.question});
  if (!res.ok) return {status: 'rejected', why: res.violations.slice(0, 3).join('; ')};
  return {status: 'ok', exec: res.exec, program: res.program};
}
