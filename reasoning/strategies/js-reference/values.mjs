/**
 * Values of the js-reference strategy: terms, atom keys, time instants, comparison and integer arithmetic.
 *
 * A ground term is a JavaScript number (a safe integer) or a string (a symbol, a date, or the decoded text of a JSON-quoted
 * term). A variable inside a rule is the object `{var: '?x'}`. Quoted text and a symbol with the same characters are the same
 * value (documented limit); an integer never equals a string.
 */
import {VAR, INTEGER, DATE} from './wires.mjs';

export class ProgramError extends Error {
  constructor(code, message, wire = null) {
    super(`${code}: ${message}`);
    this.code = code;
    this.wire = wire;
  }
}

/** Raised when the circuit needs a feature the strategy declares unsupported (the harness reports `not_expressible`). */
export class NotExpressibleError extends Error {
  constructor(features, message) {
    super(message ?? `not expressible by js-reference: ${features.join(', ')}`);
    this.features = features;
  }
}

export const isVarTerm = t => typeof t === 'object' && t !== null && 'var' in t;

export function termValue(token) {
  if (INTEGER.test(token)) return Number(token);
  if (token.startsWith('"')) return JSON.parse(token);
  return token;
}

export const toTerm = token => (VAR.test(token) ? {var: token} : termValue(token));

export const showValue = v => (typeof v === 'string' && /[^A-Za-z0-9_.:\-]/.test(v) ? JSON.stringify(v) : String(v));

/** Key of a ground argument vector: numbers and strings never collide. */
export const argsKey = args => JSON.stringify(args);

export const atomText = (neg, p, args) => [neg ? 'not' : null, p, ...args.map(showValue)].filter(x => x !== null).join(' ');

export function varsOfTerms(terms, out = new Set()) {
  for (const t of terms) if (isVarTerm(t)) out.add(t.var);
  return out;
}

/** Substitute bindings into terms; returns the ground value vector or null when a variable is unbound. */
export function groundArgs(args, env) {
  const out = [];
  for (const a of args) {
    if (isVarTerm(a)) {
      if (!(a.var in env)) return null;
      out.push(env[a.var]);
    } else out.push(a);
  }
  return out;
}

export const termIn = (t, env) => (isVarTerm(t) ? env[t.var] : t);

// ---- time ----

export const parseInstant = s => (s === 'beginning' ? -Infinity : s === 'open' ? Infinity : Date.parse(s));

/** `valid START END` or `timeless` -> {from, to} in milliseconds (start inclusive, end exclusive) or null for timeless. */
export function parseValidity(text) {
  const t = (text ?? 'timeless').trim();
  if (t === 'timeless') return null;
  const [a, b] = t.split(/\s+/);
  return {from: parseInstant(a), to: parseInstant(b), fromText: a, toText: b};
}

export const validAt = (valid, t) => valid === null || (valid.from <= t && t < valid.to);

const isTimeText = v => typeof v === 'string' && DATE.test(v);

/** Position on a number line for ordering comparisons: an integer, or a date as milliseconds; null for entities and text. */
export function ordinal(v) {
  if (typeof v === 'number') return v;
  if (isTimeText(v)) return parseInstant(v);
  return null;
}

/** `compare A WORD B`: false on a type error (an ordering needs integers or times on both sides). */
export function compareValues(word, a, b) {
  if (word === 'equal' || word === 'not_equal') {
    const same = isTimeText(a) && isTimeText(b) ? parseInstant(a) === parseInstant(b) : a === b;
    return word === 'equal' ? same : !same;
  }
  const x = ordinal(a), y = ordinal(b);
  if (x === null || y === null) return false;
  switch (word) {
    case 'above': return x > y;
    case 'below': return x < y;
    case 'at_least': return x >= y;
    case 'at_most': return x <= y;
    default: return false;
  }
}

/** `order ?t1 WORD ?t2` over time values. */
export function orderValues(word, a, b) {
  const x = ordinal(a), y = ordinal(b);
  if (x === null || y === null) return false;
  return word === 'before' ? x < y : word === 'after' ? x > y : x === y;
}

/** Integer arithmetic of `compute`: division truncates toward zero; returns undefined for a zero divisor or a non-integer. */
export function compute(word, a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return undefined;
  let r;
  switch (word) {
    case 'plus': r = a + b; break;
    case 'minus': r = a - b; break;
    case 'times': r = a * b; break;
    case 'divided_by': if (b === 0) return undefined; r = Math.trunc(a / b); break;
    default: return undefined;
  }
  return Number.isSafeInteger(r) ? r : undefined;
}
