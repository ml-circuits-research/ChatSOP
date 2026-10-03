/**
 * Path Z, the direct answer (owner, 2026-10-03): tier tiny solves the problem itself (it may think briefly) and ends with one line
 * `FINAL ANSWER: <short answer>`; only that line is read (a value, a choice, yes/no or a short list; parts separated by semicolons).
 * A reply without the line, or whose final answer is itself a derivation, is asked once more with the format reminder. Z is never
 * definitive and never a proof: it is one vote that a symbolic path must confirm (accept.mjs). Its answer cannot be perturbed, so it
 * votes on the problem's own numbers only.
 */
import {ask, ReadError} from './common.mjs';

/** The short final answer of a reply: the text after the last "final answer" marker (structure: the marker the question asks for). */
export function finalAnswerOf(text) {
  const t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*|`|\\boxed\{([^}]*)\}/g, '$1');
  const all = [...t.matchAll(/final\s+answer\s*[:=]\s*(.+)/gi)];
  if (!all.length) return null;
  const line = all.at(-1)[1].trim().replace(/[.\s]+$/, '');
  if (!line) return null;
  if (line.length > 120 || /=/.test(line)) throw new ReadError('the final answer must be the answer only, short, without a calculation');
  return line;
}

/** {status, answers: [short strings], text} */
export async function pathZ({item, ctx}) {
  const a = await ask(ctx, 'Z_answer', {problem: item.question}, finalAnswerOf, {maxTokens: 1200});
  if (!a) return {status: ctx.infra ? 'unavailable' : 'unreadable', answers: null};
  return {status: 'ok', answers: a.value.split(/\s*;\s*/).filter(Boolean), text: a.value};
}
