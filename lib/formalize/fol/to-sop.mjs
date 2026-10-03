/**
 * SOP-IR (./to-ir.mjs) → SOP Lang circuits, one per query, deterministically.
 *   logic      facts become `stated` wires, rules become session `rule` wires, every predicate a session predicate (prefix `f_`, roles
 *              subject, object, topic, recipient by position; a position that holds a number is typed `value`) declared
 *              `closed true`: the problem is its own closed world (DS014 "Problems that state their own data"), so an underivable
 *              ground literal is refuted. Before/After get transitivity and After(a, b) ≡ Before(b, a).
 *   yes/no     the literal is queried; supported → true, refuted → false, anything else → no answer
 *   which      a session rule `fq_answer ?v` from the question's literals, queried with `select`; the answer is the list of things
 *              (an empty list when none exists: FOL's ∃x φ asked as a question is both "is there" and "which")
 *   value and compare   (the answer must reach a registry number through the dataflow: a written final number is refused)
 *              the Value definitions become numbered lines `name = expression` over the registry v1..vn (a number equal to
 *              a registry number is that number's index, so a perturbation moves it) and go through the expression program's static
 *              analysis and lowering (lib/formalize/expression-program.mjs); a violation is a rejection, reported
 * `compileIr(ir, {registry, names})` → {circuits: [{kind, query, sop, literals, decode(packet)}], rejected: [{why}]}.
 * `names`: Map slug → display text (the PSM's entity spans), so a constant `cedar` is shown and answered as "Cedar".
 */
import {analyseProgram, lowerProgram} from '../expression-program.mjs';
import {ARITH, MATH, RESERVED} from './to-ir.mjs';

const ROLES = ['subject', 'object', 'topic', 'recipient'];
export const slug = s => String(s).normalize('NFKD').replace(/\p{M}/gu, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const quote = s => JSON.stringify(String(s));

/** Predicate ids, arities and numeric positions of the logic part. */
function vocabulary(ir, extra = []) {
  const uses = new Map();
  for (const l of [...ir.facts, ...ir.rules.flatMap(r => [...r.when, r.then]), ...extra]) {
    const k = l.pred;
    if (!uses.has(k)) uses.set(k, new Set());
    uses.get(k).add(l.args.length);
  }
  const ids = new Map(), taken = new Set();
  for (const [pred, arities] of uses) for (const n of arities) {
    let id = `f_${slug(pred).slice(0, 40) || 'p'}${arities.size > 1 ? `_${n}` : ''}`;
    while (taken.has(id)) id += '_x';
    taken.add(id); ids.set(`${pred}/${n}`, id);
  }
  return ids;
}

function termText(t, names, literals) {
  if (t.var) return `?${slug(t.var) || 'v'}`;
  if ('num' in t) { literals.add(String(t.num)); return String(t.num); }
  if (t.const) { const shown = names.get(slug(t.const)) ?? t.const; literals.add(shown); return quote(shown); }
  throw new Error('a function term in a logic literal');
}

/** The logic part as SOP text (predicates, stated facts, rules) plus the literals it states. */
function logicText(ir, ids, names, literals, declare = []) {
  const out = [], numeric = new Map();
  const all = [...ir.facts, ...ir.rules.flatMap(r => [...r.when, r.then]), ...declare];
  for (const l of all) l.args.forEach((t, i) => { if ('num' in t) numeric.set(`${l.pred}/${l.args.length}/${i}`, true); });
  for (const [key, id] of ids) {
    const [pred, n] = [key.slice(0, key.lastIndexOf('/')), Number(key.slice(key.lastIndexOf('/') + 1))];
    if (n > ROLES.length) throw new Error(`${pred} has ${n} arguments (at most ${ROLES.length})`);
    const args = n === 0 ? 'subject:entity' : ROLES.slice(0, n).map((r, i) => `${r}:${numeric.get(`${pred}/${n}/${i}`) ? 'value' : 'entity'}`).join(' ');
    out.push(`@${id} predicate\n  args ${args}\n  closed true\n`);
  }
  // A negated condition is `absent` (the problem is a closed world, so NOT p holds when p is not derived; SOP's `not` in a condition
  // would need an explicitly false p); a negated conclusion stays `not` (it derives an explicitly false literal).
  const atom = (l, body = false) => { const id = ids.get(`${l.pred}/${l.args.length}`); const args = l.args.length ? l.args.map(t => termText(t, names, literals)) : [quote('problem')]; if (!l.args.length) literals.add('problem'); return `${l.negated ? (body ? 'absent ' : 'not ') : ''}${id} ${args.join(' ')}`; };
  ir.facts.forEach((f, k) => {
    const args = f.args.length ? f.args.map(t => termText(t, names, literals)) : [quote('problem')];
    if (!f.args.length) literals.add('problem');
    out.push(`@s${k + 1} stated\n  certainty asserted\n  relation "${ids.get(`${f.pred}/${f.args.length}`)}"\n${args.map((a, i) => `  role ${ROLES[i]} ${a}`).join('\n')}\n  polarity ${f.negated ? 'negated' : 'affirmed'}\n`);
  });
  ir.rules.forEach((r, k) => out.push(`@r${k + 1} rule\n${r.when.map(l => `  when ${atom(l, true)}`).join('\n')}\n  then ${atom(r.then)}\n`));
  // The agreed time construct: Before is transitive, After is its inverse.
  const b = ids.get(`${RESERVED.before}/2`), a = ids.get(`${RESERVED.after}/2`);
  if (b) out.push(`@r_before_trans rule\n  when ${b} ?x ?y\n  when ${b} ?y ?z\n  then ${b} ?x ?z\n`);
  if (a && b) out.push(`@r_after_before rule\n  when ${a} ?x ?y\n  then ${b} ?y ?x\n`, `@r_before_after rule\n  when ${b} ?x ?y\n  then ${a} ?y ?x\n`);
  return out;
}

const firstValue = p => { const a = (p?.answers ?? [])[0]; return a ? Object.values(a.binding ?? a)[0] : undefined; };
const valuesOf = p => (p?.answers ?? []).map(a => Object.values(a.binding ?? a)[0]).filter(v => v !== undefined);
const back = (names, v) => { const s = slug(String(v).replace(/^local_/, '')); for (const [k, shown] of names) if (k === s || slug(shown) === s) return shown; return String(v).replace(/^local_/, ''); };

/** The program lines of the value part: [{name, text}] or a rejection reason. */
export function programLines(ir, query, registry) {
  const defs = new Map(ir.values.map(v => [slug(v.name), v]));
  const lines = [], done = new Set(), visiting = new Set();
  const ref = x => {
    // A registry percentage means its fraction in a program (15% is 0.15): a written 0.15 is that number, a written 15 is 100 times it.
    const frac = registry.find(v => v.percent && Math.abs(v.value / 100 - x) < 1e-12), plain = registry.find(v => !v.percent && v.value === x), pct = registry.find(v => v.percent && v.value === x);
    return plain ? `v${plain.index}` : frac ? `v${frac.index}` : pct ? `(v${pct.index} * 100)` : String(x);
  };
  const expr = t => {
    if ('num' in t) return ref(t.num);
    if (t.const) { emit(slug(t.const)); return `q_${slug(t.const)}`; }
    if (t.fn && ARITH[t.fn] && t.args.length === 2) return `(${expr(t.args[0])} ${ARITH[t.fn]} ${expr(t.args[1])})`;
    if (t.fn && MATH.includes(t.fn) && t.args.length >= 1) return `Math.${t.fn}(${t.args.map(expr).join(', ')})`;
    throw new Error(`the term ${t.fn ?? t.var ?? '?'} is not arithmetic`);
  };
  const emit = name => {
    if (done.has(name)) return;
    if (visiting.has(name)) throw new Error(`${name} is defined by itself`);
    const d = defs.get(name);
    if (!d) throw new Error(`the quantity ${name} is used but never given a Value`);
    visiting.add(name);
    const text = expr(d.term);
    visiting.delete(name); done.add(name);
    lines.push({name: `q_${name}`, text});
  };
  if (query.kind === 'value') lines.push({name: 'answer1', text: expr({const: query.name})});
  else lines.push({name: 'answer1', text: `${expr(query.a)} ${query.op} ${expr(query.b)}`});
  // The answer line was pushed before its dependencies were emitted: move it last.
  const answer = lines.find(l => l.name === 'answer1');
  return [...lines.filter(l => l !== answer), answer];
}

export function compileIr(ir, {registry = [], names = new Map()} = {}) {
  const circuits = [], rejected = [];
  for (const q of ir.queries) {
    try {
      if (q.kind === 'value' || q.kind === 'compare') {
        const lines = programLines(ir, q, registry);
        // Static check (owner decision 2026-10-03, instead of perturbation): the answer must depend on the problem's data through the
        // dataflow; a circuit that only writes its final number computes nothing from the problem and is refused.
        const byName = new Map(lines.map(l => [l.name, l.text]));
        const reaches = (name, seen = new Set()) => !seen.has(name) && (seen.add(name), /\bv\d+\b/.test(byName.get(name) ?? '') || [...(byName.get(name) ?? '').matchAll(/\bq_\w+/g)].some(m => reaches(m[0], seen)));
        if (!reaches('answer1')) throw new Error('the answer computes nothing from the problem\'s numbers (a written value, not a computation)');
        const used = new Set(lines.flatMap(l => [...l.text.matchAll(/\bv(\d+)\b/g)].map(m => Number(m[1]))));
        const read = {lines: lines.map((l, i) => ({n: i + 1, name: l.name, text: l.text})), unused: registry.map(v => v.index).filter(k => !used.has(k))};
        const analysis = analyseProgram(read, registry);
        if (!analysis.ok) throw new Error(analysis.violations.map(v => v.message).slice(0, 2).join('; '));
        const low = lowerProgram(analysis, registry);
        circuits.push({kind: q.kind, query: q, sop: low.sop, literals: registry.map(v => String(v.value)), program: lines,
          decode: p => (q.kind === 'compare' ? (p.status === 'supported' ? true : p.status === 'refuted' ? false : null) : (v => (v === undefined ? null : Number(v)))(firstValue(p)))});
        continue;
      }
      const literals = new Set();
      if (q.kind === 'yesno') {
        const ids = vocabulary(ir, [q.lit]);
        const body = logicText(ir, ids, names, literals, [q.lit]);
        const id = ids.get(`${q.lit.pred}/${q.lit.args.length}`);
        const args = q.lit.args.length ? q.lit.args.map(t => termText(t, names, literals)) : [quote('problem')];
        body.push(`@q query\n  where match\n    relation "${id}"\n${args.map((a, i) => `    role ${ROLES[i]} ${a}`).join('\n')}\n    polarity ${q.lit.negated ? 'negated' : 'affirmed'}\n  end\n`);
        circuits.push({kind: 'yesno', query: q, sop: body.join('\n'), literals: [...literals], decode: p => (p.status === 'supported' ? true : p.status === 'refuted' ? false : null)});
      } else if (q.kind === 'which') {
        const ids = vocabulary(ir, q.lits);
        const body = logicText(ir, ids, names, literals, q.lits);
        const v = `?${slug(q.v) || 'v'}`;
        const atom = l => `${l.negated ? 'absent ' : ''}${ids.get(`${l.pred}/${l.args.length}`)} ${l.args.map(t => termText(t, names, literals)).join(' ')}`;
        body.push(`@fq_answer predicate\n  args subject:entity\n`, `@rq rule\n${q.lits.map(l => `  when ${atom(l)}`).join('\n')}\n  then fq_answer ${v}\n`,
          `@q query\n  select ?x\n  where match\n    relation "fq_answer"\n    role subject ?x\n    polarity affirmed\n  end\n`);
        circuits.push({kind: 'which', query: q, sop: body.join('\n'), literals: [...literals], decode: p => (['supported', 'refuted'].includes(p.status) || valuesOf(p).length ? valuesOf(p).map(x => back(names, x)) : null)});
      }
    } catch (error) { rejected.push({source: q.source, why: error.message}); }
  }
  return {circuits, rejected};
}
