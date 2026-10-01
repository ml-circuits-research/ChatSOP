/** Signals to `pragmatic` wires (DS029, docs/wire_typs/pragmatic.html). The wires are host-emitted advisory circuits for
 * the reasoner; the small formalizer never authors them. */
import {MAX_SPAN, PRAGMATIC_KINDS, PRAGMATIC_BASES} from '../../sop/enums.mjs';

const score = s => String(Math.min(1, Math.max(0, Math.round(s * 100) / 100)));
const id = (taken, n) => { let i = n; while (taken.has('p' + i)) i += 1; taken.add('p' + i); return 'p' + i; };

/** One wire per signal; `taken` is the set of wire ids already used by the program (so ids never collide). */
export function signalToWire(signal, {taken = new Set(), index = 1, near = null} = {}) {
  if (!PRAGMATIC_KINDS.includes(signal.kind)) throw new Error('unknown pragmatic kind ' + signal.kind);
  const lines = [`@${id(taken, index)} pragmatic`, `  kind ${signal.kind}`, `  score ${score(signal.score)}`];
  if (signal.span) lines.push('  span ' + JSON.stringify(signal.span.length > MAX_SPAN ? signal.span.slice(0, MAX_SPAN) : signal.span));
  if (near) lines.push('  near $' + near);
  lines.push(`  source ${signal.source}`, `  basis ${PRAGMATIC_BASES.includes(signal.basis) ? signal.basis : 'classifier'}`);
  return lines.join('\n');
}

/** The SOP text of a list of signals (`''` when there are none). `taken` lists ids of the program they join. */
export function signalsToSop(signals, {taken = new Set()} = {}) {
  return signals.map((s, i) => signalToWire(s, {taken, index: i + 1, near: s.near})).join('\n\n');
}
