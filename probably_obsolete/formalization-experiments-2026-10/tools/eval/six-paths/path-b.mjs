/**
 * Path B, compute (bottom-up, procedural): the asked parts (one closed question of lib/formalize/obligations.mjs), then a program of
 * `name = expression` lines over v1..vn with two verified exemplars (F1, strict leave-one-out by section), re-asked once only when the
 * static analysis finds a violation. SOP comes from lowering the expression AST (lib/formalize/expression-program.mjs). This module
 * wraps the dual-formalization code and never edits it.
 */
import {expressionQuestion, readProgram, analyseProgram, EXPRESSION_SYSTEM} from '../../../lib/formalize/expression-program.mjs';
import {goalsQuestion, readGoals} from '../../../lib/formalize/obligations.mjs';
import {retrieve, loadExemplarIndex} from '../../../lib/formalize/exemplars.mjs';
import {questions, fill} from './common.mjs';
import {programResult} from './program.mjs';

export async function pathB({item, registry, ctx, exclude}) {
  if (!registry.length) return {status: 'no_numbers'};
  ctx.questions++;
  const g = await ctx.chat([{role: 'system', content: questions().system}, {role: 'user', content: goalsQuestion(item.question)}], 300);
  const goals = g.ok ? readGoals(g.text) : null;
  ctx.trace.push({id: 'B_parts', answer: g.text?.slice(0, 600) ?? null, read: goals ? 'ok' : null});
  const parts = (goals ?? []).filter(x => x.kind !== 'explanation');
  const partsLine = parts.length ? fill(questions().text('B_parts_line'), {parts: parts.map((x, i) => `answer${i + 1} = ${x.what} (${x.kind})`).join('; ')}) : '';
  const exemplars = retrieve(loadExemplarIndex(), registry, {k: 2, exclude});
  let again = null;
  for (let round = 0; round < 2; round++) {
    const q = expressionQuestion(item.question, registry, {again, exemplars}) + (partsLine ? `\n\n${partsLine}` : '');
    ctx.questions++;
    const r = await ctx.chat([{role: 'system', content: EXPRESSION_SYSTEM}, {role: 'user', content: q}], 700);
    ctx.trace.push({id: 'B_program', round, answer: r.ok ? r.text.slice(0, 1500) : null, reason: r.ok ? null : r.reason});
    if (!r.ok) return {status: 'unavailable'};
    const read = readProgram(r.text);
    const an = read ? analyseProgram(read, registry) : {ok: false, violations: [{message: 'no `name = expression` line'}]};
    if (an.ok) {
      const lines = an.program.lines.map(l => ({name: l.name, text: l.text}));
      // The analysed lines (yes/no texts and copied numbers normalized) are checked and lowered again by the common back end.
      const res = programResult(read.lines.filter(l => lines.some(x => x.name === l.name)), registry, {message: item.question});
      if (res.ok) return {status: 'ok', exec: res.exec, program: res.program};
      again = res.violations.slice(0, 3).join('; ');
    } else again = an.violations.slice(0, 3).map(v => v.message).join('; ');
  }
  return {status: 'rejected', why: again};
}
