import {parse as parseKnowledge, validateProgram, tokens, leaves} from '../../sop/knowledge/index.mjs';
import {Lexicon} from '../../sop/lexicon.mjs';
import {canonical} from '../../sop/parser.mjs';
import {admitModel} from './admit.mjs';

// An aggregate is a definition over existing predicates like a rule (group-by count/sum/min/max); the knowledge validator checks it.
export const SESSION_TYPES = new Set(['predicate', 'rule', 'default', 'aggregate']);

/** Split by wire headers, retaining the exact authored text for both validators. */
export function splitCircuits(sop) {
  const starts = [...sop.matchAll(/^@([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)\s*$/gm)];
  const parts = starts.map((m, i) => ({id: m[1], type: m[2], text: sop.slice(m.index, starts[i + 1]?.index ?? sop.length)}));
  if (!starts.length || sop.slice(0, starts[0].index).split('\n').some(l => l.trim() && !l.trimStart().startsWith('#'))) throw new Error('invalid_wire: expected circuit headers');
  if (new Set(parts.map(p => p.id)).size !== parts.length) throw new Error('duplicate_id: wire ids must be unique');
  return {parts, model: parts.filter(p => !SESSION_TYPES.has(p.type)).map(p => p.text).join('\n'), definitions: parts.filter(p => SESSION_TYPES.has(p.type)).map(p => p.text).join('\n')};
}

/** Declarations for embeddings which supply a lexicon instead of layered circuits. */
export function predicateCircuits(lexicon) {
  const type = t => ['integer', 'value'].includes(t) ? t : 'entity';
  return [{name: 'memory-predicates.sop', text: Object.values(lexicon?.predicates ?? {}).map(p => `@${p.id} predicate\n  args ${p.roles?.length ? p.roles.map(r => `${r.name}:${type(r.type)}`).join(' ') : (p.args ?? []).map(type).join(' ') || 'none'}\n`).join('\n')}];
}

/**
 * A new session predicate defined only by rules whose positive and absent conditions read closed (complete) predicates is
 * itself complete: the least fixpoint over complete relations derives every instance (eval-generality-v1: "how many stations
 * can be reached" over a closed link list was answered "at least 3" for exactly 3). Defaults, explicit negations, aggregates
 * over open input and any open dependency keep the predicate open. The inferred declaration is written into the text.
 */
export function closeDerived(text, wires, lexicon) {
  const declared = new Set(wires.filter(w => w.type === 'predicate').map(w => w.id));
  const closed = new Set([...Object.values(lexicon?.predicates ?? {}).filter(p => p.closed === true).map(p => p.id),
    ...wires.filter(w => w.type === 'predicate' && w.fields.some(f => f.key === 'closed' && f.value.trim() === 'true')).map(w => w.id)]);
  const headOf = w => { const t = tokens(w.fields.find(f => f.key === (w.type === 'aggregate' ? 'yields' : 'then'))?.value ?? ''); return t[0] === 'not' ? null : t[0]; };
  const bodies = new Map();
  for (const w of wires.filter(w => ['rule', 'default', 'aggregate'].includes(w.type))) {
    const head = headOf(w);
    if (!head || !declared.has(head)) continue;
    const atoms = w.type === 'aggregate' ? w.fields.filter(f => f.key === 'over').map(f => ({kind: 'atom', neg: 'none', p: tokens(f.value)[0]})) : (w.conds ?? []).flatMap(c => leaves(c.tree));
    (bodies.get(head) ?? bodies.set(head, []).get(head)).push(w.type === 'default' ? null : atoms);
  }
  // Greatest fixpoint, so a recursive definition (path over link and path) can close: drop a candidate while one of its
  // conditions reads anything other than a closed predicate or a remaining candidate.
  const inferred = new Set([...bodies].filter(([head, list]) => !closed.has(head) && !list.some(b => b === null)).map(([head]) => head));
  let changed = true;
  while (changed) {
    changed = false;
    for (const head of [...inferred]) {
      const ok = bodies.get(head).every(atoms => atoms.every(a => a.kind !== 'atom' || (['none', 'absent'].includes(a.neg) && (closed.has(a.p) || (a.neg === 'none' && inferred.has(a.p))))));
      if (!ok) { inferred.delete(head); changed = true; }
    }
  }
  if (!inferred.size) return text;
  return text.replace(/^@([A-Za-z][A-Za-z0-9_]*)\s+predicate\s*$/gm, (line, id) => inferred.has(id) ? `${line}\n  closed true` : line);
}

export function admitCircuits(sop, text, lexicon, {circuits = predicateCircuits(lexicon), policy = {}, admit = admitModel} = {}) {
  const split = splitCircuits(sop);
  let effective = lexicon;
  const definitions = parseKnowledge(split.definitions);
  if (split.definitions) {
    const check = validateProgram([...circuits.map(c => ({...c, role: 'knowledge'})), {name: 'coding-agent.sop', text: split.definitions, role: 'knowledge'}], {authoring: true});
    const problem = check.problems.find(p => p.severity !== 'warning');
    if (problem) throw new Error(`${problem.code}: ${problem.message}`);
    definitions.wires = check.wires.filter(w => w.file === 'coding-agent.sop');
    const known = new Set([...Object.keys(lexicon?.predicates ?? {}), ...definitions.wires.filter(w => w.type === 'predicate').map(w => w.id)]);
    for (const wire of definitions.wires) {
      for (const field of wire.fields) if (['source', 'approval', 'approved_by', 'approved_at', 'state'].includes(field.key)) throw new Error('governance_not_allowed: the runtime assigns origin and approval');
      const relations = (wire.conds ?? []).flatMap(c => leaves(c.tree)).filter(l => l.kind === 'atom').map(l => l.p);
      if (wire.type === 'rule' || wire.type === 'default') {
        const then = tokens(wire.fields.find(f => f.key === 'then')?.value ?? '');
        relations.push(then[0] === 'not' ? then[1] : then[0]);
      }
      if (wire.type === 'aggregate') for (const field of wire.fields.filter(f => ['over', 'yields'].includes(f.key))) relations.push(tokens(field.value)[0]);
      for (const relation of relations) if (!known.has(relation)) throw new Error(`unknown_predicate: ${relation} is neither in memory nor declared in this output`);
    }
    split.definitions = closeDerived(split.definitions, definitions.wires, lexicon);
    // Keep the memory's indexed entity tables; only the tiny turn-local predicate layer is new.
    effective = Object.assign(Object.create(Object.getPrototypeOf(lexicon ?? {})), lexicon ?? {});
    const added = Lexicon.fromCircuits([{name: 'coding-agent.sop', text: split.definitions}]);
    effective.predicates = {...lexicon?.predicates, ...added.predicates};
  }
  const model = admit(split.model, text, effective, policy);
  if (definitions.wires.length && model.wires.some(w => w.type === 'unclear')) throw new Error('unclear_not_alone: clarification cannot install definitions');
  const defs = definitions.wires.map(w => ({id: w.id, type: w.type, line: w.line, fields: Object.fromEntries([...new Set(w.fields.map(f => f.key))].map(k => [k, w.fields.filter(f => f.key === k).map(f => [f.value, ...(f.block ?? []).map(b => b.text)].join('\n'))]))}));
  const byId = new Map([...model.wires, ...defs].map(w => [w.id, w]));
  return {wires: split.parts.map(p => byId.get(p.id)), modelSop: canonical(model), definitionSop: split.definitions, lexicon: effective, origin: 'coding_agent'};
}
