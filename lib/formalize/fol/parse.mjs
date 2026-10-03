/**
 * A reader of first-order logic as the LFM writes it (fvossel/t5-base-nl-to-fol and the extension of
 * experiments/proposal/structure-and-formalizer-models.md §5), into an AST. Structure only: tokens, precedence, scopes.
 *
 * Syntax accepted
 *   quantifiers   FORALLx / EXISTSx (also glued: FORALLxFORALLy, NOTEXISTSy) and ∀x / ∃x; a quantifier's scope is the formula that
 *                 follows it (as far right as it goes)
 *   connectives   NOT (also glued to the next capitalised word: NOTPenguin), AND, OR, XOR, IMPLIES, IFF / EQUIV, and ¬ ∧ ∨ ⊕ → ↔;
 *                 precedence NOT > AND > OR > XOR > IMPLIES (right-associative) > IFF
 *   atoms         Name(t1, ..., tn) or a bare Name (0-ary); terms are names, numbers, or function terms f(t1, ...)
 * A name is a variable when an enclosing quantifier binds it; otherwise a constant. A lowercase one-letter name that no quantifier
 * binds is a free variable (read as universally quantified, the convention of the training data) and is reported.
 *
 * AST: {type: 'atom', pred, args} | {type: 'not', a} | {type: 'and'|'or'|'xor'|'implies'|'iff', a, b} |
 *      {type: 'forall'|'exists', v, a};  terms: {var} | {const} | {num} | {fn, args}.
 * `parseFol(text)` → {ok: true, ast, free: [vars], repaired} or {ok: false, why}.
 */
const KEYWORDS = new Map([['AND', 'and'], ['OR', 'or'], ['XOR', 'xor'], ['IMPLIES', 'implies'], ['IFF', 'iff'], ['EQUIV', 'iff'], ['NOT', 'not']]);
const SYMBOLS = new Map([['¬', 'not'], ['∧', 'and'], ['∨', 'or'], ['⊕', 'xor'], ['→', 'implies'], ['↔', 'iff'], ['⇒', 'implies'], ['⇔', 'iff'], ['&', 'and'], ['|', 'or']]);

/** Tokens: {t: 'lp'|'rp'|'comma'|'op'|'q'|'name'|'num', v}. */
export function tokenize(text) {
  const s = String(text ?? '').trim().replace(/\.$/, ''), out = [];
  let i = 0;
  const word = /[A-Za-z0-9_][A-Za-z0-9_.+'-]*/y;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { out.push({t: 'lp'}); i++; continue; }
    if (c === ')') { out.push({t: 'rp'}); i++; continue; }
    if (c === ',') { out.push({t: 'comma'}); i++; continue; }
    if (c === '-' && s[i + 1] === '>') { out.push({t: 'op', v: 'implies'}); i += 2; continue; }
    if (c === '<' && s.slice(i, i + 3) === '<->') { out.push({t: 'op', v: 'iff'}); i += 3; continue; }
    if (SYMBOLS.has(c)) { out.push({t: 'op', v: SYMBOLS.get(c)}); i++; continue; }
    if (c === '∀' || c === '∃') {
      const m = /^[a-z][a-z0-9_]*/.exec(s.slice(i + 1).trimStart());
      if (!m) throw new Error(`quantifier ${c} without a variable`);
      out.push({t: 'q', v: c === '∀' ? 'forall' : 'exists', x: m[0]});
      i = s.indexOf(m[0], i + 1) + m[0].length; continue;
    }
    word.lastIndex = i;
    const m = word.exec(s);
    if (!m) throw new Error(`unexpected character "${c}"`);
    i += m[0].length;
    out.push(...splitWord(m[0].replace(/[.]+$/, '')));
  }
  return out;
}

/** One word → tokens: quantifiers and NOT glued to what follows are split off. */
function splitWord(w) {
  const out = [];
  while (w) {
    let m;
    if ((m = /^(FORALL|EXISTS)([a-z][a-z0-9_]*)/.exec(w))) { out.push({t: 'q', v: m[1] === 'FORALL' ? 'forall' : 'exists', x: m[2]}); w = w.slice(m[0].length); continue; }
    if (KEYWORDS.has(w)) { out.push({t: 'op', v: KEYWORDS.get(w)}); break; }
    if ((m = /^NOT(?=[A-Z])/.exec(w)) && w.length > 3) { out.push({t: 'op', v: 'not'}); w = w.slice(3); continue; }
    if (/^-?\d+(?:\.\d+)?$/.test(w)) { out.push({t: 'num', v: Number(w)}); break; }
    out.push({t: 'name', v: w}); break;
  }
  return out;
}

class Parser {
  constructor(tokens) { this.k = tokens; this.i = 0; }
  peek() { return this.k[this.i]; }
  next() { return this.k[this.i++]; }
  op(v) { const p = this.peek(); if (p?.t === 'op' && p.v === v) { this.i++; return true; } return false; }
  expect(t) { const p = this.next(); if (p?.t !== t) throw new Error(`expected ${t === 'rp' ? ')' : t === 'lp' ? '(' : t} at token ${this.i}`); return p; }
  iff() { let a = this.imp(); while (this.op('iff')) a = {type: 'iff', a, b: this.imp()}; return a; }
  imp() { const a = this.xor(); return this.op('implies') ? {type: 'implies', a, b: this.imp()} : a; }
  xor() { let a = this.or(); while (this.op('xor')) a = {type: 'xor', a, b: this.or()}; return a; }
  or() { let a = this.and(); while (this.op('or')) a = {type: 'or', a, b: this.and()}; return a; }
  and() { let a = this.unary(); while (this.op('and')) a = {type: 'and', a, b: this.unary()}; return a; }
  unary() {
    const p = this.peek();
    if (!p) throw new Error('formula ends too early');
    if (this.op('not')) return {type: 'not', a: this.unary()};
    if (p.t === 'q') { this.i++; return {type: p.v, v: p.x, a: this.iff()}; }
    if (p.t === 'lp') { this.i++; const a = this.iff(); this.expect('rp'); return a; }
    if (p.t === 'name') {
      this.i++;
      if (this.peek()?.t !== 'lp') return {type: 'atom', pred: p.v, args: []};
      this.i++;
      const args = this.peek()?.t === 'rp' ? [] : this.terms();
      this.expect('rp');
      return {type: 'atom', pred: p.v, args};
    }
    throw new Error(`unexpected ${p.t === 'op' ? p.v.toUpperCase() : p.t === 'num' ? p.v : p.t} at token ${this.i}`);
  }
  terms() { const out = [this.term()]; while (this.peek()?.t === 'comma') { this.i++; out.push(this.term()); } return out; }
  term() {
    const p = this.next();
    if (p?.t === 'num') return {num: p.v};
    if (p?.t !== 'name') throw new Error(`expected a term at token ${this.i}`);
    if (this.peek()?.t === 'lp') { this.i++; const args = this.terms(); this.expect('rp'); return {fn: p.v, args}; }
    return {name: p.v};
  }
}

/** Names bound by quantifiers become {var}; the others {const}; free one-letter lowercase names become {var} and are reported. */
function bind(node, bound, free) {
  const term = t => {
    if (t.fn) return {fn: t.fn, args: t.args.map(term)};
    if ('num' in t) return t;
    if (bound.has(t.name)) return {var: t.name};
    if (/^[a-z]$/.test(t.name)) { free.add(t.name); return {var: t.name}; }
    return {const: t.name};
  };
  switch (node.type) {
    case 'atom': return {...node, args: node.args.map(term)};
    case 'not': return {type: 'not', a: bind(node.a, bound, free)};
    case 'forall': case 'exists': return {type: node.type, v: node.v, a: bind(node.a, new Set([...bound, node.v]), free)};
    default: return {type: node.type, a: bind(node.a, bound, free), b: bind(node.b, bound, free)};
  }
}

export function parseFol(text) {
  let tokens;
  try { tokens = tokenize(text); } catch (error) { return {ok: false, why: error.message}; }
  if (!tokens.length) return {ok: false, why: 'empty'};
  // One repair, structural only: unmatched closing parentheses at the end are dropped, missing ones at the end are added.
  let depth = 0, repaired = false;
  const kept = [];
  for (const t of tokens) { if (t.t === 'lp') depth++; if (t.t === 'rp') { if (depth === 0) { repaired = true; continue; } depth--; } kept.push(t); }
  while (depth-- > 0) { kept.push({t: 'rp'}); repaired = true; }
  const p = new Parser(kept);
  try {
    const raw = p.iff();
    if (p.i < kept.length) return {ok: false, why: `unexpected text after the formula at token ${p.i}`};
    const free = new Set();
    let ast = bind(raw, new Set(), free);
    for (const v of [...free].reverse()) ast = {type: 'forall', v, a: ast};
    return {ok: true, ast, free: [...free], repaired};
  } catch (error) { return {ok: false, why: error.message}; }
}

/** The AST back as text (for reports and tests). */
export function showFol(n) {
  const t = x => (x.fn ? `${x.fn}(${x.args.map(t).join(', ')})` : 'num' in x ? String(x.num) : x.var ?? x.const);
  switch (n.type) {
    case 'atom': return n.args.length ? `${n.pred}(${n.args.map(t).join(', ')})` : n.pred;
    case 'not': return `NOT ${showFol(n.a)}`;
    case 'forall': case 'exists': return `${n.type.toUpperCase()}${n.v} (${showFol(n.a)})`;
    default: return `(${showFol(n.a)} ${n.type.toUpperCase()} ${showFol(n.b)})`;
  }
}
