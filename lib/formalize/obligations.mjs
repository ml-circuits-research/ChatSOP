/**
 * Semantic obligations of a formalization (experiments/proposal/formalization-research-directions.md, variant C; coordinator
 * decision 2026-10-02). A formalization is answered only when it meets what the problem obliges, each item checked by structure:
 *   parts      every asked part of the question (the model lists them: one closed question) has an answer of the right kind;
 *   coverage   every registry number is used or explicitly listed as unused (the static analysis);
 *   sign       an asked quantity the model declared positive or whole is positive or a whole number >= 0;
 *   names      no open name remains (an unknown name, a `new:` without a node).
 * The record gives `formalized` (the share of obligations met, %), the unresolved ones, and one targeted question for the first failed
 * one, asked again to the same tier. A part the model calls an explanation is reported as not formalized and does not block an answer.
 * The goal question and the re-ask texts are step-by-step templates (they may stay in code for now: AGENTS.md "No hardcoded
 * understanding"); reading the model's lines is structure (indices, a closed menu), never an interpretation of the user's words.
 */
const strip = text => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*|`/g, '').trim();
const KINDS = Object.freeze(['number', 'yes or no', 'which thing', 'explanation']);
const SIGNS = Object.freeze(['positive', 'whole', 'any']);
const COMPUTABLE = new Set(['number', 'yes or no', 'which thing']);

/** The question that lists the asked parts (one closed question; every line is read by index and closed menus). */
export function goalsQuestion(message) {
  return [`Problem:\n${message}`,
    'List each separate thing the question asks for, in the order asked, one per line:',
    'gK: <what is asked, a few words> | <kind> | <sign>',
    `kind is one of: ${KINDS.join(', ')}. sign is one of: positive (it can only be above zero), whole (a count of whole things, zero or more), any.`,
    'Example:\ng1: total cost in coins | number | positive\ng2: is the budget enough | yes or no | any'].join('\n\n');
}

/** `gK: what | kind | sign` lines → [{k, what, kind, sign}] (menus matched by their words; an unknown sign is `any`), or null. */
export function readGoals(text) {
  const out = [];
  for (const line of strip(text).split('\n')) {
    const m = /^\s*(?:[-*]\s*)?g(\d+)\s*[:=.-]\s*(.+?)\s*\|\s*([^|]+?)\s*(?:\|\s*([^|]+?)\s*)?$/i.exec(line);
    if (!m) continue;
    const kind = KINDS.find(k => m[3].toLowerCase().startsWith(k)) ?? KINDS.find(k => m[3].toLowerCase().includes(k));
    if (!kind) continue;
    const sign = SIGNS.find(s => String(m[4] ?? '').toLowerCase().startsWith(s)) ?? 'any';
    out.push({k: out.length + 1, what: m[2].slice(0, 80), kind, sign});
  }
  return out.length ? out.slice(0, 8) : null;
}

const kindOf = v => typeof v === 'boolean' ? 'yes or no' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'which thing' : null;

/**
 * The obligation record of an expression-path result `expr` with the engines' answer values `values` (one per program answer, in
 * order) against the asked parts `goals` (null: the parts could not be read; then only coverage and names are checked).
 * Returns {formalized, obligations: [{id, ok, why}], unresolved: [ids], blocking: bool, not_formalized: [parts], question}.
 */
export function obligationsOf({expr, values = [], goals = null}) {
  const ob = [], add = (id, ok, why = null, block = true) => ob.push({id, ok, ...(ok ? {} : {why}), block});
  if (!expr || expr.status === 'no_numbers') add('numbers', false, 'the problem gives no numbers to compute from');
  else if (expr.status !== 'ok') add('program', false, `no accepted program (${(expr.analysis?.violations ?? []).map(v => v.code).join(', ') || expr.status})`);
  else {
    const codes = new Set(expr.analysis.violations.map(v => v.code));
    add('coverage', !codes.has('unused_number'), 'a registry number is neither used nor listed as unused');
    add('names', !codes.has('unknown_name') && !codes.has('unknown_registry_index'), 'a name is used that no line defines');
  }
  const notFormalized = (goals ?? []).filter(g => !COMPUTABLE.has(g.kind)).map(g => `g${g.k}: ${g.what}`);
  if (expr?.status === 'ok' && goals) {
    const parts = goals.filter(g => COMPUTABLE.has(g.kind));
    parts.forEach((g, i) => {
      const v = values[i];
      if (v === undefined || v === null) { add(`part:g${g.k}`, false, `g${g.k} (${g.what}) has no answer`); return; }
      // A choice may be among numbers ("which of 13, 14, 16"): a which-thing part is met by a number or a text, a yes/no only by yes/no.
      if (g.kind === 'which thing' ? kindOf(v) === 'yes or no' : kindOf(v) !== g.kind) { add(`kind:g${g.k}`, false, `g${g.k} (${g.what}) must be ${g.kind}, the answer is ${JSON.stringify(v)}`); return; }
      add(`part:g${g.k}`, true);
      if (g.kind === 'number' && g.sign === 'positive') add(`sign:g${g.k}`, v > 0, `g${g.k} (${g.what}) came out ${v}, but it can only be above zero`);
      if (g.kind === 'number' && g.sign === 'whole') add(`sign:g${g.k}`, Number.isInteger(v) && v >= 0, `g${g.k} (${g.what}) came out ${v}, but it is a count of whole things`);
    });
  }
  for (const p of notFormalized) add(`explain:${p.split(':')[0]}`, false, `${p} is an explanation, not a computation`, false);
  const met = ob.filter(o => o.ok).length, failed = ob.filter(o => !o.ok && o.block);
  return {formalized: ob.length ? Math.round(100 * met / ob.length) : 0, obligations: ob.map(({block, ...o}) => o), unresolved: ob.filter(o => !o.ok).map(o => o.id),
    blocking: failed.length > 0, not_formalized: notFormalized, question: failed.length ? reask(failed[0], goals, values) : null};
}

/** One targeted question for the first failed obligation (a re-ask of the program to the same tier). */
function reask(o, goals, values) {
  const parts = (goals ?? []).filter(g => COMPUTABLE.has(g.kind));
  if (o.id.startsWith('part:')) return `The question asks for ${parts.length} things, in this order: ${parts.map((g, i) => `answer${i + 1} = ${g.what} (${g.kind})`).join('; ')}. Your lines answer ${values.filter(v => v !== null && v !== undefined).length}. Write the lines again so that answer1..answer${parts.length} are exactly these, each computed from the numbers (never a written result).`;
  if (o.id.startsWith('kind:')) { const k = parts.findIndex(g => `kind:g${g.k}` === o.id); return `answer${k + 1} must be ${parts[k].kind} (${parts[k].what}). Write the lines again so that answer${k + 1} is that.`; }
  if (o.id.startsWith('sign:')) { const k = parts.findIndex(g => `sign:g${g.k}` === o.id); return `answer${k + 1} (${parts[k].what}) came out ${values[k]}, but it must be ${parts[k].sign === 'whole' ? 'a whole number, zero or more' : 'above zero'}. Check the order of each subtraction and division and the rounding, and write the lines again.`; }
  return o.why;
}

/** The packet fields of an obligation record (the result packet carries them next to the answer). */
export const packetFields = record => ({formalized: record.formalized, unresolved_obligations: record.unresolved, ...(record.not_formalized.length ? {not_formalized: record.not_formalized} : {}), ...(record.question ? {clarification: record.question} : {})});
