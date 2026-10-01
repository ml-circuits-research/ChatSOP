/**
 * A test double of the host's linking step for the end-to-end execution check (owner priority 2026-10-01, step 3): the
 * model-language program SymbolicLM wrote (`match` blocks of strings) becomes a knowledge-language circuit of
 * `reasoning/strategies/js-reference` (atoms over predicate and entity symbols). It is a hand-made lexicon, not the
 * product linker: `link.relations` maps a relation phrase to a predicate and its role order, `link.entities` maps a
 * string to a symbol. A phrase or string the lexicon does not know is reported (`unlinked`), never guessed, like the host.
 * The `stated` wires with `certainty supposed` named by `if $s` become supposed `fact` wires; `assumed` wires are
 * reported, not added (they are model additions); the five reasoning modes pass through as the query `mode`.
 */
import {parse, one, many, parseMatch} from '../../../sop/parser.mjs';
import {parseCondition} from '../../../sop/conditions.mjs';
import {propositionOf} from '../../../sop/propositions.mjs';
import {normalizeTime} from '../../../sop/linking.mjs';
import {formatTime} from '../../../lib/time.mjs';

const symbol = (value, link, unlinked) => {
  if (typeof value === 'number' || /^[?$]/.test(value) || /^-?\d+$/.test(value)) return String(value);
  const id = link.entities[value];
  if (!id) { unlinked.push({kind: 'entity', text: value}); return '?unlinked'; }
  return id;
};

/** One proposition as a knowledge atom `[not] predicate arg…` in the predicate's role order; null when it cannot be linked. */
function atom(p, link, unlinked) {
  const entry = link.relations[p.relation];
  if (!entry) { unlinked.push({kind: 'relation', text: p.relation}); return null; }
  const byRole = new Map(p.roles.map(r => [r.name, r.value]));
  const extra = [...byRole.keys()].filter(r => !entry.roles.includes(r));
  if (extra.length || entry.roles.some(r => !byRole.has(r))) { unlinked.push({kind: 'roles', text: `${p.relation}: ${[...byRole.keys()].join(' ')}`}); return null; }
  const args = entry.roles.map(r => symbol(byRole.get(r), link, unlinked));
  return `${p.polarity === 'negated' ? 'not ' : ''}${entry.predicate}${args.length ? ' ' + args.join(' ') : ''}`;
}

/** A condition tree as lines: one atom, or an `all`/`any` group whose children are indented by two spaces. */
function conditionLines(text, link, unlinked) {
  const tree = parseCondition(text, leaf => parseMatch(leaf, 'match', {partial: true}));
  const lines = node => (node.children ? [node.kind, ...node.children.flatMap(lines).map(l => '  ' + l), 'end'] : [atom(node, link, unlinked)]);
  return lines(tree);
}
const field = (key, lines) => lines.map((l, i) => (i === 0 ? `  ${key} ${l}` : '  ' + l)).join('\n');

const interval = (text, now) => { const p = normalizeTime(JSON.parse(text), now); return p ? formatTime(p.from) + ' ' + formatTime(p.until) : null; };

/** Lowers a model program; returns `{queries: [{id, text}], facts: [text], unlinked, assumed}`. */
export function lowerModelProgram(sop, link, {now = Date.parse('2026-10-01')} = {}) {
  const program = parse(sop);
  const unlinked = [], assumed = [], facts = [], queries = [];
  for (const w of program.wires) {
    if (w.type === 'assumed') { assumed.push(w.id); continue; }
    if (w.type === 'stated' && one(w, 'certainty') === 'supposed') {
      const a = atom(propositionOf(w), link, unlinked);
      if (a) facts.push(`@${w.id} fact\n  holds ${a}\n  status supposed\n`);
      continue;
    }
    if (w.type !== 'query') continue;
    const lines = [`@${w.id} query`];
    if (one(w, 'mode')) lines.push(`  mode ${one(w, 'mode')}`);
    for (const text of many(w, 'where')) lines.push(field('where', conditionLines(text, link, unlinked)));
    if (w.fields.scope) lines.push(field('scope', conditionLines(one(w, 'scope'), link, unlinked)));
    if (one(w, 'select')) lines.push('  select ' + one(w, 'select'));
    for (const c of many(w, 'compare')) lines.push('  compare ' + c);
    if (one(w, 'rank')) lines.push('  rank ' + one(w, 'rank'));
    for (const key of ['overlaps', 'during']) if (one(w, key)) { const t = interval(one(w, key), now); if (t) lines.push(`  ${key} ${t}`); else unlinked.push({kind: 'time', text: one(w, key)}); }
    if (one(w, 'at')) { const p = normalizeTime(JSON.parse(one(w, 'at')), now); if (p) lines.push('  at ' + formatTime(p.from)); else unlinked.push({kind: 'time', text: one(w, 'at')}); }
    for (const target of many(w, 'if')) lines.push(`  if ${target}`);
    queries.push({id: w.id, text: lines.join('\n') + '\n'});
  }
  return {queries, facts, unlinked, assumed};
}
