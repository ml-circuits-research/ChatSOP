/**
 * Problem mode of LocalLLMStepByStep (DS022 "LocalLLMStepByStep", DS014 "Problems that state their own data"): a message that gives
 * its own numbers, things or conditions and asks about them is modelled from its own text. The small model answers short structured
 * questions (which kind of result, the values the problem gives as `name = number` lines, the formulas of the asked values, the options,
 * or the facts and rules of a deduction); the system writes the circuit: one session predicate per value or property, `stated` wires
 * for the given data, session rules whose `compute` lines are the formulas, and the queries. The engines compute; the model never
 * writes a result. Reading the model's lines is structure (names, numbers, arithmetic), never an interpretation of the user's words.
 */
import {numberMentioned} from '../admit.mjs';
import {readChoice, readChoices} from './answers.mjs';

/** The kinds of result a problem asks for (the first problem question). */
export const PROBLEM_KINDS = Object.freeze([
  ['compute', 'one or more numbers computed from the numbers the problem gives (a total, a cost, an average, a time, a difference)'],
  ['choose', 'which of several options, things or plans is best (cheapest, largest, fastest, lowest score), judged by a number computed for each'],
  ['deduce', 'whether something follows (yes or no) from facts and rules the problem states'],
  ['other', 'none of these'],
]);

const strip = text => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*|`/g, '').trim();
const lines = text => strip(text).split('\n').map(s => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
const RESERVED = new Set(['not', 'absent', 'compare', 'compute', 'order', 'start_of', 'end_of', 'all', 'any', 'end', 'match', 'else', 'if', 'then', 'and']);
/** A predicate-safe name from the model's own words (structure: lower case, underscores). */
export const slug = text => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'n_$1').slice(0, 40);
const number = text => { const t = String(text).replace(/[,  ](?=\d{3}\b)/g, ''); return /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : null; };

export const problemQuestions = {
  kind: () => `Answer about the same request. The request is a problem that gives its own data. What does it ask for?\n${PROBLEM_KINDS.map(([, text], i) => `${i + 1}. ${text}`).join('\n')}\nReply with the number only.`,
  values: () => 'List every number the problem gives, one per line, as `name = number`. The name is a short name of what the number is, made of words of the problem joined by underscores, and it names the thing the number belongs to when there are several (like `cost_plan_a = 400`, `price_per_unit = 8`). Copy each number exactly as the problem writes it (11% is `rate_percent = 11`). Do not compute anything.',
  formulas: (names, kind) => `The values are: ${names.join(', ')}.\nWrite how each value the question asks for is computed from these values, one line per value, as \`new_name = formula\`. A formula uses only the value names above, names defined on earlier lines, numbers, + - * / ^ and parentheses, // (whole division) and % (remainder), and round(x, 0.01), ceil(x), floor(x); a yes/no check is one comparison, like \`fits = need <= capacity\`.${kind === 'choose' ? ' Write one line per option, for the number the options are judged by.' : ''} Do not compute the result.`,
  options: names => `Which computed value belongs to which option? Write one line per option, as \`option name as the problem writes it = value name\`, using these value names: ${names.join(', ')}.`,
  direction: () => 'Is the best option the one with the lowest or the highest value?\n1. lowest\n2. highest\nReply with the number only.',
  facts: () => 'List the facts the problem states about its things, one per line, as `thing | property` (or `thing | not property` when it does not hold). Copy each thing as the problem writes it; a property is a few words joined by underscores (like `Zed | is_glorp`).',
  rules: () => 'List the general rules the problem states, one per line, as `if property and property then property` (write `not property` for a property that does not hold), using the same property names. Reply "none" if there are none.',
  question: () => 'Write what the question asks as one line `thing | property` (or `thing | not property`).',
  asked: names => `Which of these values does the question ask for?\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}\nReply with the numbers separated by commas.`,
  again: what => `That could not be read. ${what}`,
};

/** `name = number` lines; numbers must be written in the message (a percentage written as a fraction is kept as written). */
export function readValues(text, message) {
  const out = [];
  for (const line of lines(text)) {
    const m = /^([A-Za-z][\w ]*?)\s*[=:]\s*(-?[\d][\d,.  ]*)\s*(%?)\s*(?:[A-Za-z%$€£].*)?$/.exec(line);
    if (!m) continue;
    const name = slug(m[1]), value = number(m[2].trim().replace(/\.$/, ''));
    if (!name || value === null || out.some(v => v.name === name)) continue;
    if (numberMentioned(value, message)) out.push({name, value});
    else if (numberMentioned(Math.round(value * 1e6) / 1e4, message)) out.push({name, value: Math.round(value * 1e6) / 1e4, percent: true});
  }
  return out.length ? out : null;
}

/** Arithmetic of a formula → {lines: compute lines, result: ?var, uses: [names]} or null. Operators + - * / ^, parentheses, round/ceil/floor. */
export function readFormula(expression, known) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][\w]*)|(\*\*|\/\/|[-+*/^(),×·÷−%]))/y;
  const text = String(expression).trim();
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) { if (/^\s*$/.test(text.slice(at))) break; return null; }
    at = re.lastIndex;
    if (m[1] !== undefined) tokens.push({t: 'num', v: Number(m[1])});
    else if (m[2] !== undefined) tokens.push({t: 'name', v: m[2]});
    else tokens.push({t: 'op', v: {'×': '*', '·': '*', '÷': '/', '−': '-', '**': '^'}[m[3]] ?? m[3]});
  }
  let i = 0, counter = 0;
  const out = [], uses = new Set();
  const fresh = () => `?t${++counter}`;
  const peek = () => tokens[i], take = () => tokens[i++];
  const WORDS = {'+': 'plus', '-': 'minus', '*': 'times', '/': 'divided_by', '//': 'whole_divided_by', '%': 'modulo', '^': 'power'};
  const emit = (a, word, b) => { const v = fresh(); out.push(`compute ${v} ${a} ${word} ${b}`); return v; };
  const primary = () => {
    const tok = take();
    if (!tok) throw new Error('end');
    if (tok.t === 'num') return String(tok.v);
    if (tok.t === 'op' && tok.v === '(') { const v = sum(); if (take()?.v !== ')') throw new Error(')'); return v; }
    if (tok.t === 'op' && tok.v === '-') { const v = primary(); return /^\d/.test(v) ? '-' + v : emit('0', 'minus', v); }
    if (tok.t === 'name') {
      const fn = tok.v.toLowerCase();
      if (['round', 'ceil', 'floor'].includes(fn) && peek()?.v === '(') {
        take();
        const arg = sum();
        let step = '1';
        if (peek()?.v === ',') { take(); const s = take(); if (s?.t !== 'num') throw new Error('step'); step = String(s.v); }
        if (take()?.v !== ')') throw new Error(')');
        return emit(arg, {round: 'rounded_to', ceil: 'rounded_up_to', floor: 'rounded_down_to'}[fn], step);
      }
      const name = slug(tok.v);
      if (!known.has(name)) throw new Error(`unknown ${name}`);
      uses.add(name);
      return `?v_${name}`;
    }
    throw new Error('token');
  };
  const power = () => { let a = primary(); while (peek()?.v === '^') { take(); a = emit(a, 'power', primary()); } return a; };
  const product = () => { let a = power(); while (['*', '/', '//', '%'].includes(peek()?.v)) { const op = take().v; a = emit(a, WORDS[op], power()); } return a; };
  const sum = () => { let a = product(); while (['+', '-'].includes(peek()?.v)) { const op = take().v; a = emit(a, WORDS[op], product()); } return a; };
  try {
    const result = sum();
    if (i !== tokens.length) return null;
    // A formula that is only a name or a number still needs one line that binds the result.
    const final = out.length ? result : emit(result, 'plus', '0');
    return {lines: out, result: final, uses: [...uses]};
  } catch { return null; }
}

const CHECKS = [['>=', 'at_least', 'below'], ['≥', 'at_least', 'below'], ['<=', 'at_most', 'above'], ['≤', 'at_most', 'above'], ['!=', 'not_equal', 'equal'], ['≠', 'not_equal', 'equal'], ['==', 'equal', 'not_equal'], ['>', 'above', 'at_most'], ['<', 'below', 'at_least'], ['=', 'equal', 'not_equal']];

/**
 * `new_name = formula` lines over the known names; each line may use the names of earlier lines. A formula that compares two sides
 * (`card_ok = price >= 20`) is a check: its rules derive the yes or the explicit no, and the question about it is yes/no.
 */
export function readFormulas(text, names) {
  const known = new Set(names), checks = new Set(), out = [];
  for (const line of lines(text)) {
    const m = /^([A-Za-z][\w ]*?)\s*=(?!=)\s*(.+)$/.exec(line);
    if (!m) continue;
    const name = slug(m[1]);
    if (!name || known.has(name)) continue;
    const body = m[2].replace(/≈.*$/, '').trim();
    // A check: comparisons and earlier checks joined by "and" (`ok = cost <= budget and fits`).
    const parts = body.replace(/^\((.*)\)$/, '$1').split(/\s+and\s+|\s*&&\s*/i);
    if (parts.some(part => CHECKS.some(([symbol]) => part.includes(symbol)) || checks.has(slug(part)))) {
      const conditions = [];
      for (const [k, part] of parts.entries()) {
        const flag = slug(part.replace(/^\(|\)$/g, ''));
        if (checks.has(flag)) { conditions.push({flag}); continue; }
        const check = CHECKS.find(([symbol]) => part.includes(symbol));
        if (!check) { conditions.length = 0; break; }
        const [symbol, word, opposite] = check, at = part.indexOf(symbol);
        const rename = (f, side) => f && {...f, lines: f.lines.map(l => l.replace(/\?t(\d+)/g, (_, n) => `?c${k}${side}${n}`)), result: f.result.replace(/^\?t(\d+)$/, `?c${k}${side}$1`)};
        const left = rename(readFormula(part.slice(0, at).replace(/^\(/, ''), known), 'l'), right = rename(readFormula(part.slice(at + symbol.length).replace(/\)$/, ''), known), 'r');
        if (!left || !right) { conditions.length = 0; break; }
        conditions.push({word, opposite, left: left.result, right: right.result, lines: [...left.lines, ...right.lines], uses: [...new Set([...left.uses, ...right.uses])]});
      }
      if (!conditions.length) continue;
      known.add(name); checks.add(name);
      out.push({name, check: {conditions}, lines: [], uses: [...new Set(conditions.flatMap(c => c.uses ?? []))]});
      continue;
    }
    const formula = readFormula(body.replace(/=.*$/, ''), known);
    if (!formula) continue;
    known.add(name);
    out.push({name, ...formula});
  }
  return out.length ? out : null;
}

/** `thing | property` lines → [{thing, property, negated}] with the thing written in the message. */
export function readFacts(text, message, {single = false} = {}) {
  const out = [];
  const folded = String(message).toLowerCase();
  for (const line of lines(text)) {
    const m = /^(.+?)\s*\|\s*(not\s+)?(.+)$/i.exec(line);
    if (!m) continue;
    // The thing is written as in the message; a name the model wrote with underscores is matched with spaces.
    let thing = m[1].trim().replace(/^["“]|["”]$/g, '');
    const property = slug(m[3]);
    if (!folded.includes(thing.toLowerCase()) && folded.includes(thing.replace(/_/g, ' ').toLowerCase())) thing = thing.replace(/_/g, ' ');
    if (!thing || !property || !folded.includes(thing.toLowerCase())) continue;
    out.push({thing, property, negated: Boolean(m[2])});
    if (single) break;
  }
  return out.length ? out : null;
}

/** `if a and not b then c` lines → [{when: [{property, negated}], then: {property, negated}}]. */
export function readRules(text) {
  if (/^\s*none\b/i.test(strip(text))) return [];
  const out = [];
  for (const line of lines(text)) {
    const m = /^if\s+(.+?)\s*,?\s+then\s+(.+)$/i.exec(line);
    if (!m) continue;
    const literal = s => { const n = /^\s*not\s+/i.test(s); const p = slug(s.replace(/^\s*not\s+/i, '')); return p ? {property: p, negated: n} : null; };
    const when = m[1].split(/\s+and\s+/i).map(literal), then = literal(m[2]);
    if (when.every(Boolean) && then) out.push({when, then});
  }
  return out.length ? out : null;
}

/** A session predicate id that does not collide with the memory's vocabulary or a reserved word. */
function predicateId(name, lexicon, taken) {
  let id = /^[a-z]/.test(name) ? name : `p_${name}`;
  if (RESERVED.has(id) || lexicon?.predicates?.[id] || lexicon?.entities?.[id]) id = `${id}_value`;
  while (taken.has(id)) id = `${id}_x`;
  taken.add(id);
  return id;
}

const stated = (id, relation, roles, negated = false) => `@${id} stated\n  certainty asserted\n  relation "${relation}"\n${roles.map(([name, value]) => `  role ${name} ${typeof value === 'number' ? value : JSON.stringify(value)}`).join('\n')}\n  polarity ${negated ? 'negated' : 'affirmed'}\n`;

/** The circuit of an arithmetic problem: value predicates, stated values, one rule per formula, the queries. */
export function arithmeticCircuit({values, formulas, options = [], direction = null, asked: wanted = null, lexicon}) {
  const taken = new Set(), id = new Map();
  for (const v of values) id.set(v.name, predicateId(v.name, lexicon, taken));
  for (const f of formulas) id.set(f.name, predicateId(f.name, lexicon, taken));
  // A percentage the model wrote as a fraction (0.11 for "11%") is stated as written (11) and divided by 100 in its own rule.
  const percent = new Map(values.filter(v => v.percent).map(v => [v.name, predicateId(`${v.name}_percent`, lexicon, taken)]));
  const out = [];
  for (const pid of [...id.values(), ...percent.values()]) out.push(`@${pid} predicate\n  args object:value\n`);
  values.forEach((v, k) => out.push(stated(`s${k + 1}`, percent.get(v.name) ?? id.get(v.name), [['object', v.value]])));
  for (const [name, pid] of percent) out.push(`@${id.get(name)}_rule rule\n  when ${pid} ?p\n  when compute ?f ?p divided_by 100\n  then ${id.get(name)} ?f\n`);
  formulas.forEach((f, k) => {
    const when = [...f.uses.map(u => `  when ${id.get(u)} ?v_${u}`), ...f.lines.map(l => `  when ${l}`)].join('\n');
    if (!f.check) { out.push(`@r${k + 1} rule\n${when}${when ? '\n' : ''}  then ${id.get(f.name)} ${f.result}\n`); return; }
    // A check derives its yes when every condition holds (`then NAME 1`) and its explicit no when one condition fails (`then not NAME 1`,
    // one rule per condition), so the yes/no question is supported or refuted, never left unknown.
    const lines = c => c.flag ? [] : [...c.uses.map(u => `  when ${id.get(u)} ?v_${u}`), ...c.lines.map(l => `  when ${l}`)];
    const yes = f.check.conditions.flatMap(c => c.flag ? [`  when ${id.get(c.flag)} 1`] : [...lines(c), `  when compare ${c.left} ${c.word} ${c.right}`]);
    out.push(`@r${k + 1} rule\n${[...new Set(yes)].join('\n')}\n  then ${id.get(f.name)} 1\n`);
    f.check.conditions.forEach((c, j) => out.push(`@r${k + 1}n${j + 1} rule\n${(c.flag ? [`  when not ${id.get(c.flag)} 1`] : [...lines(c), `  when compare ${c.left} ${c.opposite} ${c.right}`]).join('\n')}\n  then not ${id.get(f.name)} 1\n`));
  });
  const used = new Set(formulas.flatMap(f => f.uses));
  // The values the question asks for (the model's choice), else the values no other formula uses.
  const asked = wanted?.length ? formulas.filter(f => wanted.includes(f.name)) : formulas.filter(f => !used.has(f.name));
  if (options.length && direction) {
    out.push('@option_score predicate\n  args subject:entity object:value\n');
    options.forEach((o, k) => out.push(stated(`o${k + 1}`, 'is_option', [['subject', o.option]])));
    out.unshift('@is_option predicate\n  args subject:entity\n');
    options.forEach((o, k) => out.push(`@ro${k + 1} rule\n  when ${id.get(o.value)} ?v\n  when is_option ${JSON.stringify(o.option)}\n  then option_score ${JSON.stringify(o.option)} ?v\n`));
    out.push(`@q query\n  select ?o\n  where match\n    relation "option_score"\n    role subject ?o\n    role object ?v\n    polarity affirmed\n  end\n  rank ${direction} ?v\n`);
    out.push(`@q2 query\n  select ?o ?v\n  where match\n    relation "option_score"\n    role subject ?o\n    role object ?v\n    polarity affirmed\n  end\n`);
  } else {
    asked.forEach((f, k) => out.push(f.check ? `@q${k ? k + 1 : ''} query\n  where match\n    relation "${id.get(f.name)}"\n    role object 1\n    polarity affirmed\n  end\n`
      : `@q${k ? k + 1 : ''} query\n  select ?x\n  where match\n    relation "${id.get(f.name)}"\n    role object ?x\n    polarity affirmed\n  end\n`));
  }
  return out.join('\n');
}

/** The circuit of a deduction: one unary property predicate per property, stated facts, the rules, the yes/no query. */
export function deductionCircuit({facts, rules, question, lexicon}) {
  const taken = new Set(), id = new Map();
  const props = [...new Set([...facts.map(f => f.property), ...rules.flatMap(r => [...r.when.map(w => w.property), r.then.property]), question.property])];
  for (const p of props) id.set(p, predicateId(p, lexicon, taken));
  const out = [...props.map(p => `@${id.get(p)} predicate\n  args subject:entity\n`)];
  facts.forEach((f, k) => out.push(stated(`s${k + 1}`, id.get(f.property), [['subject', f.thing]], f.negated)));
  rules.forEach((r, k) => out.push(`@r${k + 1} rule\n${r.when.map(w => `  when ${w.negated ? 'not ' : ''}${id.get(w.property)} ?x`).join('\n')}\n  then ${r.then.negated ? 'not ' : ''}${id.get(r.then.property)} ?x\n`));
  out.push(`@q query\n  where match\n    relation "${id.get(question.property)}"\n    role subject ${JSON.stringify(question.thing)}\n    polarity ${question.negated ? 'negated' : 'affirmed'}\n  end\n`);
  return out.join('\n');
}

/**
 * The problem questions. `oracle` is the step-by-step oracle (read/choice/left). Returns {sop, report} or null when the problem
 * kind is "other" or an answer cannot be read twice (the caller then states honestly that it could not formalize the request).
 */
export async function problemCircuit(oracle, {message, lexicon}) {
  const tries = async (name, prompt, reader, again, tokens) => { try { return await oracle.read(name, prompt, reader, problemQuestions.again(again), tokens); } catch { return null; } };
  const n = await tries('problem_kind', problemQuestions.kind(), t => readChoice(t, PROBLEM_KINDS.length), `Reply with one number from 1 to ${PROBLEM_KINDS.length}.`, 8);
  const kind = n ? PROBLEM_KINDS[n - 1][0] : null;
  if (!kind || kind === 'other') return null;
  if (kind === 'deduce') {
    const facts = await tries('problem_facts', problemQuestions.facts(), t => readFacts(t, message), 'One line per fact, like `Zed | is_glorp`.', 200);
    if (!facts) return null;
    const rules = await tries('problem_rules', problemQuestions.rules(), readRules, 'One line per rule, like `if is_glorp then is_blue`, or "none".', 200) ?? [];
    const question = (await tries('problem_question', problemQuestions.question(), t => readFacts(t, message, {single: true}), 'One line, like `Zed | is_blue`.', 40))?.[0];
    if (!question) return null;
    return {sop: deductionCircuit({facts, rules, question, lexicon}), report: {kind, facts: facts.length, rules: rules.length}};
  }
  const values = await tries('problem_values', problemQuestions.values(), t => readValues(t, message), 'One line per number, like `cost_plan_a = 400`, with numbers written in the problem.', 300);
  if (!values) return null;
  const names = values.map(v => v.name);
  const formulas = await tries('problem_formulas', problemQuestions.formulas(names, kind), t => readFormulas(t, names), 'One line per asked value, like `total = price * quantity`, using only the listed names and numbers.', 300);
  if (!formulas) return null;
  let options = [], direction = null;
  if (kind === 'choose') {
    const computed = formulas.map(f => f.name);
    const readOptions = t => {
      const out = [];
      for (const line of lines(t)) {
        const m = /^(.+?)\s*[=:|]\s*([A-Za-z][\w ]*)$/.exec(line);
        if (!m) continue;
        const option = m[1].trim().replace(/^["“]|["”]$/g, ''), value = slug(m[2]);
        if (String(message).toLowerCase().includes(option.toLowerCase()) && computed.includes(value)) out.push({option, value});
      }
      return out.length > 1 ? out : null;
    };
    options = await tries('problem_options', problemQuestions.options(computed), readOptions, 'One line per option, like `Plan A = total_plan_a`.', 200) ?? [];
    const d = options.length ? await tries('problem_direction', problemQuestions.direction(), t => readChoice(t, 2), 'Reply with 1 or 2.', 8) : null;
    direction = d === 1 ? 'lowest' : d === 2 ? 'highest' : null;
  }
  let asked = null;
  if (!direction && formulas.length > 1) {
    const picked = await tries('problem_asked', problemQuestions.asked(formulas.map(f => f.name)), t => readChoices(t, formulas.length), 'Reply with the numbers separated by commas.', 24);
    if (picked && picked[0] !== 0) asked = picked.map(k => formulas[k - 1].name);
  }
  return {sop: arithmeticCircuit({values, formulas, options, direction, asked, lexicon}), report: {kind, values: values.length, formulas: formulas.length, options: options.length, direction}};
}
