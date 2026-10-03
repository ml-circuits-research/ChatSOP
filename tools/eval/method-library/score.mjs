/**
 * Gold comparison and the outcome taxonomy of the formalization-machine experiment (experiments/proposal/formalization-machine-phase1.md).
 * Eval-side code: it reads the books' gold answers (datasets_sources, local only) and never feeds anything back to the formalizer.
 *
 * A problem's executed goals are compared with its gold answer deterministically when the gold is a number, numbers, yes/no, a name or
 * an ordered list of names and the executed answers have the same shape; otherwise a judge (proxy tier `medium`) gives match | partial |
 * mismatch from the question, the reference answer and the executed answers (never the model's own wording of the goals).
 *
 * Outcome (exactly one per problem):
 *   some goal executed: mismatch → WRONG; match and every goal executed → SOLVED; otherwise PARTIALLY_FORMALIZED (blocked_by = the
 *   state of the first goal that did not execute, or `incomplete_answer`);
 *   nothing executed: the first of MISSING_METHOD, UNSUPPORTED_PRIMITIVE, MISSING_CONCEPT, MISSING_INFORMATION, AMBIGUOUS, CONTRADICTORY
 *   among the goals' states, else PARTIALLY_FORMALIZED (blocked_by fill_error | engine_error | no_tree).
 */
export const PRIORITY = Object.freeze(['MISSING_METHOD', 'UNSUPPORTED_PRIMITIVE', 'MISSING_CONCEPT', 'MISSING_INFORMATION', 'AMBIGUOUS', 'CONTRADICTORY']);

/** The gold of a book item: {yesno?, numbers?, entity?, list?, text}. Eval-side reading of the books' answer fields. */
export function goldOf(item) {
  const g = {text: String(item.answer ?? '')};
  const v = item.answer_value;
  if (typeof v === 'boolean') g.yesno = v;
  const m = /^The correct answer is (yes|no)\b/i.exec(item.answer ?? '');
  if (m) g.yesno = m[1].toLowerCase() === 'yes';
  if (typeof v === 'number') g.numbers = [v];
  if (Array.isArray(v) && v.length && v.every(x => typeof x === 'number')) g.numbers = v;
  if (typeof v === 'string' && v.trim()) g.entity = v;
  if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string')) g.list = v;
  if (typeof v === 'string' && /,/.test(v) && item.answer_kind === 'entity') g.list = v.split(/\s*,\s*/);
  return g;
}

const norm = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/^(the|option|case|plan|route)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const near = (a, b) => Math.abs(a - b) <= Math.max(0.011, 0.005 * Math.abs(b));

/** The executed answers of a run: [{goal, kind, value}]. */
export const executedAnswers = run => run.goals.filter(g => g.state === 'EXECUTED').map(g => ({goal: g.id, type: g.type, kind: g.result.kind, value: g.result.value, method: g.result.method, ...(g.result.unit ? {unit: g.result.unit} : {})}));

/** A value in minutes since midnight as a clock time (the `unit minutes_of_day` annotation of a method). */
export const clockOf = m => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** Deterministic verdict, or null when only a judge can compare. */
export function deterministicVerdict(gold, answers) {
  if (!answers.length) return null;
  const yes = answers.filter(a => a.kind === 'yesno');
  const nums = answers.flatMap(a => a.kind === 'number' ? [a.value] : a.kind === 'list' ? a.value.filter(x => typeof x === 'number') : a.kind === 'assignment' ? Object.values(a.value).filter(x => typeof x === 'number') : []);
  if (gold.yesno !== undefined && yes.length === 1 && answers.length === 1) return yes[0].value === gold.yesno ? 'match' : 'mismatch';
  if (gold.numbers && nums.length && gold.numbers.every(g => nums.some(h => near(h, g)))) return answers.length === nums.length || answers.every(a => ['number', 'assignment', 'list'].includes(a.kind)) ? 'match' : null;
  if (gold.numbers && answers.length === 1 && answers[0].kind === 'number' && gold.numbers.length === 1 && !near(answers[0].value, gold.numbers[0])) return 'mismatch';
  if (gold.list && answers.length === 1 && answers[0].kind === 'order') return answers[0].value.map(norm).join('|') === gold.list.map(norm).join('|') ? 'match' : 'mismatch';
  if (gold.entity && answers.length === 1 && answers[0].kind === 'entity' && norm(answers[0].value) === norm(gold.entity)) return 'match';
  return null;
}

/** The executed answers as lines for the judge (kinds and values only). */
export function renderAnswers(answers) {
  const show = a => a.kind === 'yesno' ? (a.value ? 'yes' : 'no') : a.kind === 'undetermined' ? 'cannot be determined from the stated data' : a.kind === 'contradiction' ? 'no solution: the stated conditions contradict each other'
    : a.kind === 'order' ? a.value.join(', ') + ' (in this order)' : a.kind === 'list' ? a.value.map(x => typeof x === 'number' ? Number(x.toPrecision(10)) : x).join(', ') + ' (a sequence)' : a.kind === 'set' ? (a.value.length ? a.value.join(', ') + ' (all of these)' : 'none') : a.kind === 'assignment' ? Object.entries(a.value).map(([k, v]) => `${k.replace(/^\?/, '')} = ${v}`).join('; ')
    : a.kind === 'number' && a.unit === 'minutes_of_day' ? `${clockOf(a.value)} (a clock time)`
    : a.kind === 'text' ? `derivation:\n${a.value}` : typeof a.value === 'number' ? String(Number(a.value.toPrecision(10))) : String(a.value);
  return answers.map((a, i) => `answer ${i + 1} (${a.kind}): ${show(a)}`).join('\n');
}

export const JUDGE_SYSTEM = 'You compare a system\'s answers with a reference answer. Reply with one JSON object only.';
/** The judge question (eval-side template). */
export function judgeQuestion(item, answers) {
  return [`Question:\n${item.question}`, `Reference answer:\n${item.answer}`, `The system's answers (computed by executing a formalization; one per part it answered):\n${renderAnswers(answers)}`,
    'Verdict:\n- "match": every part the question asks is answered and agrees with the reference (wording, units, rounding to the reference precision and extra correct detail do not matter; "cannot be determined" agrees with a reference that says the data do not decide it);\n- "partial": everything answered agrees with the reference, but some part the question asks is not answered;\n- "mismatch": some answer contradicts the reference, or answers something else than what the reference gives.\nReply {"verdict": "match" | "partial" | "mismatch", "reason": "<one short sentence>"}'].join('\n\n');
}

/** The outcome of a run given the verdict (null when nothing executed). */
export function classify(run, {verdict}) {
  const goals = run.goals ?? [];
  const executed = goals.filter(g => g.state === 'EXECUTED');
  const firstBlock = goals.find(g => g.state !== 'EXECUTED');
  const blockOf = g => !g ? 'incomplete_answer' : PRIORITY.includes(g.state) ? g.state : g.state === 'ENGINE_ERROR' ? 'engine_error' : 'fill_error';
  if (executed.length) {
    if (verdict === 'mismatch') return {outcome: 'WRONG', blocked_by: null};
    if (verdict === 'match' && executed.length === goals.length) return {outcome: 'SOLVED', blocked_by: null};
    return {outcome: 'PARTIALLY_FORMALIZED', blocked_by: verdict === 'match' || executed.length < goals.length ? blockOf(firstBlock) : 'incomplete_answer'};
  }
  if (!goals.length) return {outcome: 'PARTIALLY_FORMALIZED', blocked_by: 'no_tree'};
  for (const s of PRIORITY) if (goals.some(g => g.state === s)) return {outcome: s, blocked_by: s};
  return {outcome: 'PARTIALLY_FORMALIZED', blocked_by: blockOf(firstBlock)};
}

/** The failure cause of a non-SOLVED outcome (for "MISSING_METHOD dominates"): the outcome, or what blocked a partial formalization. */
export const causeOf = c => c.outcome === 'PARTIALLY_FORMALIZED' ? c.blocked_by : c.outcome;
