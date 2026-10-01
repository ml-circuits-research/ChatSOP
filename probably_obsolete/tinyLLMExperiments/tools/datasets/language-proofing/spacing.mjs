/** Deterministic spacing and doubled-punctuation repair for LanguageProofingLLM iteration 3 (experiment train-language-proofing-gemma270m-it3).
 * `normalizeSpacing` is the mechanical definition of the repair (spaces before , ; ! ? and a sentence-final period, doubled spaces, a missing space after a
 * comma that is followed by a letter, runs of the same , ; ! ? and a doubled period). `perturb` applies the inverse operations to a clean sentence, so a
 * perturbed prompt always normalizes back to its clean target. Pure functions; seeded by a text hash, no randomness from the clock.
 */
import crypto from 'node:crypto';

export const OPS = ['space-before-final', 'space-before-comma', 'no-space-after-comma', 'double-space', 'double-final', 'double-comma'];

export function normalizeSpacing(text) {
  return String(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,;!?])/g, '$1')
    .replace(/[ \t]+\.(?!\.)(?=\s|$)/g, '.')
    .replace(/,(?=\p{L})/gu, ', ')
    .replace(/([,;!?])\1+/g, '$1')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .trim();
}

export const hasSpacingDefect = text => normalizeSpacing(text) !== String(text).trim();

const seeded = (text, salt) => parseInt(crypto.createHash('sha256').update(`${salt}\u0000${text}`).digest('hex').slice(0, 8), 16);

/** Applies one operation to a clean sentence; returns null when it does not apply. */
export function applyOp(text, op, seed = 0) {
  const pick = (n, salt) => seeded(text, `${seed}:${op}:${salt}`) % n;
  const last = text.at(-1);
  switch (op) {
    case 'space-before-final': return /[?!.]$/.test(text) && !/\.\.$/.test(text) ? `${text.slice(0, -1)} ${last}` : null;
    case 'space-before-comma': { const at = [...text.matchAll(/,(?= \p{L})/gu)].map(m => m.index); return at.length ? `${text.slice(0, at[pick(at.length, 'c')])} ${text.slice(at[pick(at.length, 'c')])}` : null; }
    case 'no-space-after-comma': { const at = [...text.matchAll(/, (?=\p{L})/gu)].map(m => m.index); return at.length ? `${text.slice(0, at[pick(at.length, 'n')] + 1)}${text.slice(at[pick(at.length, 'n')] + 2)}` : null; }
    case 'double-space': { const at = [...text.matchAll(/ (?=\S)/g)].map(m => m.index); return at.length ? `${text.slice(0, at[pick(at.length, 's')])} ${text.slice(at[pick(at.length, 's')])}` : null; }
    case 'double-final': return /[?!]$/.test(text) ? `${text}${last.repeat(1 + pick(2, 'r'))}` : /\.$/.test(text) && !/\.\.$/.test(text) ? `${text}.` : null;
    case 'double-comma': { const at = [...text.matchAll(/,(?= \p{L})/gu)].map(m => m.index); return at.length ? `${text.slice(0, at[pick(at.length, 'd')])},${text.slice(at[pick(at.length, 'd')])}` : null; }
    default: throw Error(`unknown spacing op ${op}`);
  }
}

/** Applies a list of operations in order; every step must apply and the result must normalize back to the clean text. */
export function perturb(text, ops, seed = 0) {
  let out = text;
  for (const op of ops) { out = applyOp(out, op, seed); if (out === null) return null; }
  return out !== text && normalizeSpacing(out) === text ? out : null;
}
