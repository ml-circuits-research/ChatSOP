/**
 * Demand analysis of a slice (experiments/proposal/reasoning-wires-proposal.md section 11.2 to 11.5, DS005 "Closedness and
 * completeness for the knowledge wires").
 *
 * Which stored facts can matter for a question? The question (one conjunction of atoms per alternative of its `any` groups) and the
 * rules it can reach (one conjunction per rule body) are CALL atoms. A fact matters when it matches a call atom. This module plans, before
 * any lookup, how every call atom is reached, the way a magic-set rewriting does:
 *
 *   - each conjunction is ordered greedily by sideways information passing: the atom with the most positions that are already bound (a
 *     constant, a variable of an earlier atom, a head variable seeded by the caller) comes first;
 *   - the head variables of a rule are seeded only at the positions that EVERY call site of its predicate binds (a greatest fixpoint, so a
 *     recursive rule is seeded by the constants of the question and by the variables its own body binds);
 *   - a call atom with at least one bound position is KEYED: the facts that can match it are found by looking up the values of the
 *     variable (or the constant) at one bound position; a call atom with no bound position is SCANNED: its predicate is looked up without
 *     a key, and the constants of what it returns key the atoms joined with it.
 *
 * At run time the module keeps the values each variable class can take (`dom`), fed by every retrieved fact, and says which keyed
 * lookups are still owed (`obligations`) and which predicates still need a scan (`nextScan`). When none is owed the demand is at a
 * FIXPOINT: every fact a bottom-up reasoner could use for these atoms has been requested. Completeness holds by induction on the join
 * order: a bound position takes values that an earlier, fully requested atom (or the caller, or a constant) already contributed, so the
 * domain of its class contains every value of every solution.
 *
 * The domain is deliberately liberal (variable classes of a rule head and of its call sites are merged, every position of a matching
 * fact contributes); a larger domain only costs more lookups, it never loses a solution. The plan is the strict part.
 *
 * The module is pure (no memory access); `retrieval.mjs` runs the lookups.
 */
import {variable} from '../../lib/types.mjs';
import {stable} from '../../lib/util.mjs';

const MAX_ALTERNATIVES = 32;

/** The conjunctions of a question's conditions: `any` groups are alternatives. Null when there are too many (the caller falls back). */
export function alternatives(conditions, cap = MAX_ALTERNATIVES) {
  const product = (lists) => {
    let acc = [[]];
    for (const list of lists) {
      const next = [];
      for (const a of acc) for (const b of list) { next.push([...a, ...b]); if (next.length > cap) return null; }
      acc = next;
    }
    return acc;
  };
  const expand = c => {
    if (c.kind === 'any') {
      const out = [];
      for (const child of c.children) { const sub = expand(child); if (!sub) return null; out.push(...sub); if (out.length > cap) return null; }
      return out;
    }
    if (c.kind === 'all') { const parts = c.children.map(expand); return parts.includes(null) ? null : product(parts); }
    return [[c]];
  };
  const lists = [];
  for (const c of conditions ?? []) { const sub = expand(c); if (!sub) return null; lists.push(sub); }
  return product(lists);
}

/**
 * The variables a question's comparisons fix to constants: `compare ?x equal c` and `compare any` of such lines ("Which is bigger,
 * Canada or Brazil?"). `compares` are trees of {kind: all|any, children} and {left, op, right}. Returns [{variable, values}].
 * Retrieval uses them as bindings (a comparison keeps the rows afterwards; it only tells which facts can matter), so the question
 * "which of A or B was born first" asks for the facts of A and B, not for the birth year of every person.
 */
export function equalityDomains(compares) {
  const out = [];
  const leafValues = node => (node.kind ? null : node.op === 'equal' && variable(node.left) && !variable(String(node.right)) && node.right !== undefined ? {variable: node.left, values: [node.right]} : null);
  const visit = node => {
    if (!node) return;
    if (!node.kind) { const d = leafValues(node); if (d) out.push(d); return; }
    if (node.kind === 'all') { node.children.forEach(visit); return; }
    const options = node.children.map(leafValues);
    if (options.length && options.every(Boolean) && options.every(o => o.variable === options[0].variable)) out.push({variable: options[0].variable, values: options.flatMap(o => o.values)});
  };
  (compares ?? []).forEach(visit);
  return out;
}

/** The conjunctions with each fixed variable replaced by each of its constants (one conjunction per constant); unchanged without domains or beyond the cap. */
export function bindDomains(conjunctions, domains, cap = 4 * MAX_ALTERNATIVES) {
  let current = conjunctions;
  for (const {variable: v, values} of domains) {
    const next = [];
    for (const atoms of current) {
      if (!atoms.some(a => a.a.includes(v))) { next.push(atoms); continue; }
      for (const value of values) next.push(atoms.map(a => ({...a, a: a.a.map(t => (t === v ? value : t))})));
    }
    if (next.length > cap) return conjunctions;
    current = next;
  }
  return current;
}

export const slot = (p, n) => `${p}/${n}`;

export class Demand {
  /**
   * @param conjunctions  arrays of the question's atoms, one array per alternative
   * @param rules         typed rules ({id, if: [atom], then: atom}) of the closure
   */
  constructor({conjunctions, rules = []}) {
    this.parent = new Map();
    this.dom = new Map();
    this.atoms = [];
    this.owners = [];
    conjunctions.forEach((atoms, j) => this.owners.push({id: 'query' + j, atoms: this.register('query' + j, atoms, 'query')}));
    this.heads = new Map();
    for (const r of rules) {
      const owner = {id: 'rule:' + r.id, atoms: this.register('rule:' + r.id, r.if, 'rule'), head: this.headOf('rule:' + r.id, r.then)};
      this.owners.push(owner);
      const key = slot(owner.head.p, owner.head.n);
      if (!this.heads.has(key)) this.heads.set(key, []);
      this.heads.get(key).push(owner);
    }
    this.align();
    this.plan();
  }

  term(owner, t) { return variable(t) ? {cls: owner + '|' + t, name: t} : {value: t}; }

  register(owner, atoms, origin) {
    return atoms.map(atom => {
      const call = {id: this.atoms.length, owner, origin, p: atom.p, n: atom.a.length, neg: atom.neg === true, terms: atom.a.map(t => this.term(owner, t)), bound: [], key: null};
      this.atoms.push(call);
      return call;
    });
  }

  headOf(owner, atom) { return {owner, p: atom.p, n: atom.a.length, terms: atom.a.map(t => this.term(owner, t))}; }

  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    for (let at = x; at !== root;) { const next = this.parent.get(at); this.parent.set(at, root); at = next; }
    return root;
  }

  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    this.parent.set(rb, ra);
    const moved = this.dom.get(rb);
    if (!moved) return;
    this.dom.delete(rb);
    if (!this.dom.has(ra)) this.dom.set(ra, new Map());
    for (const [key, entry] of moved) if (!this.dom.get(ra).has(key)) this.dom.get(ra).set(key, entry);
  }

  /** Merges, position by position, the variable classes of every rule head with those of the call atoms of the same predicate. */
  align() {
    for (const call of this.atoms) {
      for (const head of this.heads.get(slot(call.p, call.n)) ?? []) {
        for (let k = 0; k < call.n; k++) {
          const c = call.terms[k], h = head.head.terms[k];
          if (c.cls && h.cls) this.union(c.cls, h.cls);
          else if (c.cls) this.add(c.cls, h.value, 'seed');
          else if (h.cls) this.add(h.cls, c.value, 'seed');
        }
      }
    }
  }

  /** Orders one conjunction by sideways information passing; records on each atom the positions that are bound when it is reached. */
  order(owner, seeded) {
    const bound = new Set();
    if (owner.head) owner.head.terms.forEach((t, k) => { if (t.cls && seeded[k]) bound.add(t.cls); });
    const todo = owner.atoms.slice();
    owner.sequence = [];
    while (todo.length) {
      const score = a => a.terms.filter(t => t.cls === undefined || bound.has(t.cls)).length;
      let best = 0;
      todo.forEach((a, i) => { if (score(a) > score(todo[best])) best = i; });
      const [atom] = todo.splice(best, 1);
      atom.bound = atom.terms.map((t, i) => (t.cls === undefined || bound.has(t.cls) ? i : -1)).filter(i => i >= 0);
      // key by a bound variable (its values come from an earlier, fully requested atom) before a written constant (possibly a hub)
      atom.key = atom.bound.find(i => atom.terms[i].cls !== undefined) ?? atom.bound[0] ?? null;
      for (const t of atom.terms) if (t.cls) bound.add(t.cls);
      owner.sequence.push(atom);
    }
  }

  /**
   * The static plan: which head positions are seeded. A position is seeded when EVERY call site of the predicate binds it. Positions are
   * tried one at a time, on top of those already accepted (an accepted position changes the order of the bodies, so a position is accepted
   * only if the order it produces binds it at every call site), and a last pass drops any position the final order no longer supports.
   */
  plan() {
    const seeded = new Map([...this.heads.keys()].map(k => [k, Array(Number(k.split('/')[1])).fill(false)]));
    const reorder = () => { for (const owner of this.owners) this.order(owner, owner.head ? seeded.get(slot(owner.head.p, owner.head.n)) : []); };
    const supported = (key, k) => { const sites = this.atoms.filter(a => slot(a.p, a.n) === key); return sites.length > 0 && sites.every(a => a.bound.includes(k)); };
    for (let round = 0; round < 16; round++) {
      let changed = false;
      for (const [key, vector] of seeded) {
        for (let k = 0; k < vector.length; k++) {
          if (vector[k]) continue;
          vector[k] = true;
          reorder();
          if (supported(key, k)) changed = true; else { vector[k] = false; reorder(); }
        }
      }
      reorder();
      for (const [key, vector] of seeded) for (let k = 0; k < vector.length; k++) if (vector[k] && !supported(key, k)) { vector[k] = false; changed = true; reorder(); }
      if (!changed) break;
    }
    reorder();
    this.shareKeys();
  }

  /**
   * An atom bound at a variable and at a constant is keyed by the variable, unless another atom already has to look the same constant up:
   * then the shared lookup serves both and the per-value lookups are saved (the scope of a universal question repeats its restriction).
   */
  shareKeys() {
    const mustLookUp = new Set();
    for (const a of this.atoms) if (a.key !== null && a.terms[a.key].cls === undefined) mustLookUp.add(`${slot(a.p, a.n)}#${a.key}=${stable(a.terms[a.key].value)}`);
    for (const a of this.atoms) {
      if (a.key === null || a.terms[a.key].cls === undefined) continue;
      const shared = a.bound.find(i => a.terms[i].cls === undefined && mustLookUp.has(`${slot(a.p, a.n)}#${i}=${stable(a.terms[i].value)}`));
      if (shared !== undefined) a.key = shared;
    }
  }

  /** Records that class `cls` can take `value`, contributed by `from`. */
  add(cls, value, from, key = stable(value)) {
    const root = this.find(cls);
    if (!this.dom.has(root)) this.dom.set(root, new Map());
    const map = this.dom.get(root);
    if (!map.has(key)) map.set(key, {value});
    return map.size;
  }

  /** A retrieved fact enlarges the domains of the classes of every call atom it matches. */
  feed(fact) {
    const a = fact.atom;
    for (const call of this.atoms) {
      if (call.p !== a.p || call.n !== a.a.length) continue;
      if (call.terms.some((t, i) => t.cls === undefined && stable(t.value) !== stable(a.a[i]))) continue;
      call.terms.forEach((t, i) => { if (t.cls !== undefined) this.add(t.cls, a.a[i], 'fact'); });
    }
  }

  /** The keyed lookups owed now: the constant (or the domain values) at the key position of every keyed call atom. */
  obligations() {
    const out = new Map();
    for (const call of this.atoms) {
      if (call.key === null) continue;
      const t = call.terms[call.key];
      const values = t.cls === undefined ? [t.value] : [...(this.dom.get(this.find(t.cls))?.values() ?? [])].map(e => e.value);
      for (const value of values) {
        const key = `${slot(call.p, call.n)}#${call.key}=${stable(value)}`;
        if (!out.has(key)) out.set(key, {key, p: call.p, n: call.n, i: call.key, value});
      }
    }
    return [...out.values()];
  }

  /** The predicates (name/arity) that still need an unkeyed scan, in plan order (question atoms first). */
  scans() {
    const out = [];
    for (const call of this.atoms) if (call.key === null && !out.some(s => s.p === call.p && s.n === call.n)) out.push({p: call.p, n: call.n, origin: call.origin});
    return out.sort((x, y) => (x.origin === 'query' ? 0 : 1) - (y.origin === 'query' ? 0 : 1));
  }

  nextScan(scanned) { return this.scans().find(s => !scanned.has(slot(s.p, s.n))) ?? null; }

  /** The predicates (name/arity) of the call atoms. */
  predicates() { return [...new Set(this.atoms.map(c => slot(c.p, c.n)))]; }
}
