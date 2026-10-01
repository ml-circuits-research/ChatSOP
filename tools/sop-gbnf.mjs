#!/usr/bin/env node
/**
 * A llama.cpp GBNF grammar for the MODEL surface of SOP Lang (DS021): the `stated`, `assumed`, `unclear`, `query`,
 * `constraint` and `unparsed` wires in their canonical line layout, one keyword per line. Grammar-constrained decoding
 * (llama-server `grammar`) lets the small formalizer emit only programs of this shape.
 *
 * Everything that names a value comes from the exported contracts, so the grammar follows the parser:
 * the wire types (`MODEL_TYPES`), their fields and cardinalities (`SPEC`), the proposition keywords
 * (`MATCH_KEYWORDS`), roles (`ROLE_NAMES`), polarity, certainty, basis, validity forms, `unclear` kinds and
 * reply languages, query modes, measures, fragments, the words-only comparators, arithmetic words, rank,
 * quantifier and order words, the constraint tasks and directions, the clause-link keywords (`LINK_WORDS`, at most
 * `MAX_LINKS` lines `KEYWORD $id` per stated/assumed/query wire, after its other fields), the `unparsed` hints and
 * span length (`UNPARSED_HINTS`, `MAX_SPAN`), and the block words (`all`, `any`, `match`, `end`). A role value may
 * be a `$id` wire reference (stated/assumed and match blocks) or a `?variable` (match blocks, and placeholders of
 * unparsed spans in stated/assumed); a constraint expression may name `$q`. `FIELD_ORDER` fixes the canonical order of the fields; `generateGbnf` checks it against `SPEC` so a new
 * field cannot silently fall out of the grammar.
 *
 * The grammar is deliberately the canonical sub-language that the corpora and `canonical()` write:
 * fields in `FIELD_ORDER`, roles in `ROLE_NAMES` order (which also makes each role unique), two-space indentation
 * that grows by two per block level, one blank line between wires. Checks that are not context-free stay with the
 * parser and the compiler: unique wire ids, the time-variable rules, `measure` on a time variable, duplicate
 * readings, statement anchoring and host linking, and the cross-wire rules of clauses (sop/clauses.mjs): link and
 * reference targets, at most one `$id` role value per wire, duplicate link lines, cycles, and the pairing of a
 * placeholder `?variable` with exactly one `unparsed` span.
 *
 *   node tools/sop-gbnf.mjs [--out grammar.gbnf] [--depth 4] [--strings canonical|parser]
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {SPEC, MATCH_KEYWORDS, ROLE_NAMES, POLARITIES, CERTAINTIES, BASES, VALIDITY_FORMS, QUERY_MODES, TIME_MEASURES,
  COMPARATOR_WORDS, ARITHMETIC_WORDS, RANK_WORDS, QUANTIFIER_WORDS, ORDER_WORDS, FRAGMENT_KINDS, LINK_WORDS, MAX_LINKS, UNPARSED_HINTS, MAX_SPAN,
  ENUMS} from '../sop/parser.mjs';
import {GROUP_OPENERS, MATCH_OPENER, BLOCK_CLOSER} from '../sop/conditions.mjs';
import {MODEL_TYPES} from '../sop/declarative.mjs';
import {READING_KINDS} from '../sop/unclear.mjs';

/** Canonical field order per model wire type (the order the corpora and `canonical()` write). */
export const FIELD_ORDER = Object.freeze({
  stated: ['relation', 'role', 'polarity', 'valid', 'certainty', 'speaker', ...LINK_WORDS],
  assumed: ['relation', 'role', 'polarity', 'valid', 'basis', ...LINK_WORDS],
  unclear: ['kind', 'reading', 'language'],
  query: ['mode', 'fragment', 'asof', 'select', 'rank', 'measure', 'quantifier', 'where', 'scope', 'at', 'during', 'except', 'compare', 'order', 'limit', ...LINK_WORDS],
  constraint: ['var', 'require', 'claim', 'objective', 'direction', 'task', 'unit', 'select'],
  unparsed: ['span', 'near', 'hint'],
});
/** Wire types that carry clause-link lines (`because $s2`), always after their other fields. */
export const LINKED_TYPES = Object.freeze(['stated', 'assumed', 'query']);
/** SPEC fields a model wire never writes (DS021): trusted-circuit operator syntax and host plumbing. */
export const EXCLUDED_FIELDS = Object.freeze({query: {filter: 'operator syntax; the model writes compare/except/order words', span: 'host plumbing written by linking', overlaps: 'written by the UD-to-SOP rules (v2.7); the decoding grammar of the small models keeps at/during'}});
/** Default maximal nesting of `all`/`any` groups inside a condition field (the parser allows 32; the corpora use at most 2). */
export const DEFAULT_DEPTH = 4;

const lit = text => JSON.stringify(text);
const alt = values => '(' + values.map(lit).join(' | ') + ')';
const ind = n => lit(' '.repeat(n));

function checkFieldOrder() {
  for (const type of MODEL_TYPES) {
    const spec = SPEC[type], order = FIELD_ORDER[type];
    if (!spec || !order) throw Error(`sop-gbnf: no field order for model wire type ${type}`);
    const declared = [...(spec.one ?? []), ...(spec.many ?? [])];
    for (const field of order) if (!declared.includes(field)) throw Error(`sop-gbnf: ${type}.${field} is not a SPEC field`);
    for (const field of declared) if (!order.includes(field) && !EXCLUDED_FIELDS[type]?.[field]) throw Error(`sop-gbnf: SPEC field ${type}.${field} is neither ordered nor excluded`);
  }
  for (const keyword of MATCH_KEYWORDS) for (const type of ['stated', 'assumed']) if (!FIELD_ORDER[type].includes(keyword)) throw Error(`sop-gbnf: ${type} lacks proposition keyword ${keyword}`);
  for (const type of LINKED_TYPES) {
    const order = FIELD_ORDER[type], first = order.indexOf(LINK_WORDS[0]);
    if (first < 0 || order.slice(first).join() !== LINK_WORDS.join()) throw Error(`sop-gbnf: ${type} must end with the link keywords`);
  }
}

/**
 * Returns the GBNF text. `depth` bounds the nesting of all/any groups inside a condition field. `strings` chooses
 * how a quoted string may start: `canonical` (the corpora: no leading blank) or `parser` (as the parser accepts:
 * leading spaces before the first nonblank character, which a model may emit as a separate token).
 */
export function generateGbnf({depth = DEFAULT_DEPTH, strings = 'canonical'} = {}) {
  if (!['canonical', 'parser'].includes(strings)) throw Error('sop-gbnf: strings is canonical or parser');
  checkFieldOrder();
  const rules = new Map();
  const rule = (name, body) => { if (!rules.has(name)) rules.set(name, body); return name; };
  const [MATCH, END] = [MATCH_OPENER, BLOCK_CLOSER];
  const kw = (indent, key, rest) => `${ind(indent)} ${lit(key + ' ')} ${rest} "\\n"`;
  // A condition field: the keyword, then a block rule that writes its own line ends.
  const kwBlock = (indent, key, blockRule) => `${ind(indent)} ${lit(key + ' ')} ${blockRule}`;

  // Lexical rules: JSON strings (nonempty, not starting with blank), role values (no sigil), integers, variables.
  rule('esc', '"\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F]{4})');
  rule('str-char', '[^"\\\\\\x00-\\x1F] | esc');
  const lead = strings === 'parser' ? ' | " "+ ([^"\\\\\\x00-\\x20] | esc)' : '';
  rule('string', `"\\"" ([^"\\\\\\x00-\\x20] | esc${lead}) str-char* "\\""`);
  rule('value-string', `"\\"" ([^"\\\\\\x00-\\x20?$~] | esc${lead}) str-char* "\\""`);
  rule('integer', '"-"? [0-9]{1,15}');
  rule('number', '"-"? [0-9]{1,15} ("." [0-9]{1,15})?');
  rule('variable', '"?" [A-Za-z] [A-Za-z0-9_]*');
  rule('ref', '"$" [A-Za-z] [A-Za-z0-9_]*');
  rule('cvar', '"?" [a-z] [a-z0-9_]*');
  rule('wire-id', '"@" [A-Za-z] [A-Za-z0-9_]*');
  // A statement role value: as written in the message, a `$id` proposition argument, or the placeholder ?variable of
  // an unparsed span. A match role value: as written, a query unknown, or a `$id` (proposition or chained query).
  rule('stated-value', 'value-string | integer | variable | ref');
  rule('query-value', 'value-string | integer | variable | ref');
  rule('operand', 'variable | integer | string');
  rule('comparator', alt(Object.keys(COMPARATOR_WORDS)));
  rule('arith', alt(Object.keys(ARITHMETIC_WORDS)));
  rule('group-opener', alt(GROUP_OPENERS));
  rule('polarity', alt(POLARITIES));

  // Roles in ROLE_NAMES order, 1..4 of them (each name at most once), at a given indentation and value kind.
  // roles(i,k): role lines from inventory index i on, k lines already written. An exhausted inventory ends the list.
  function roles(indent, value, {min = 1} = {}) {
    const name = (i, k) => `roles-${value}-${indent}-${i}-${k}`;
    for (let i = ROLE_NAMES.length; i >= 0; i--) for (let k = 4; k >= 0; k--) {
      if (i === ROLE_NAMES.length || k === 4) { if (k >= min) rule(name(i, k), '""'); continue; }
      const options = [];
      if (rules.has(name(i + 1, k + 1))) options.push(`${kw(indent, 'role', `${lit(ROLE_NAMES[i] + ' ')} ${value}`)} ${name(i + 1, k + 1)}`);
      if (rules.has(name(i + 1, k))) options.push(name(i + 1, k));
      if (options.length) rule(name(i, k), options.join(' | '));
    }
    return name(0, 0);
  }
  const relationLine = indent => kw(indent, 'relation', 'string');
  const polarityLine = indent => kw(indent, 'polarity', 'polarity');
  function validLines(indent) {
    const [on, from, until] = VALIDITY_FORMS;
    const line = form => kw(indent, 'valid', `${lit(form + ' ')} string`);
    return rule('valid-' + indent, `(${line(on)} | (${line(from)})? (${line(until)})?)`);
  }
  // A proposition: relation, roles, polarity. `partial` (a follow-up fragment) may omit relation, polarity and roles.
  function proposition(indent, value, {partial = false} = {}) {
    const name = `prop-${partial ? 'partial-' : ''}${value}-${indent}`;
    if (!partial) return rule(name, `${relationLine(indent)} ${roles(indent, value)} ${polarityLine(indent)}`);
    const optional = roles(indent, value, {min: 0}), some = roles(indent, value);
    return rule(name, `(${relationLine(indent)} ${optional} | ${some}) (${polarityLine(indent)})?`);
  }
  // A condition block whose opener sits at indentation `indent` (inline after the field keyword at level 2):
  // children at indent + 2, the closer at indent. `leaf(indent)` returns the rule of one leaf, ending in "\n".
  function block(prefix, indent, level, leafAt, {matchLeaf}) {
    const name = `${prefix}-${indent}`;
    if (rules.has(name)) return name;
    rules.set(name, null);
    const leaf = matchLeaf ? `${lit(MATCH + '\n')} ${leafAt(indent + 2)} ${ind(indent)} ${lit(END + '\n')}` : leafAt(indent);
    const options = [leaf];
    if (level < depth) options.push(`group-opener "\\n" (${ind(indent + 2)} ${block(prefix, indent + 2, level + 1, leafAt, {matchLeaf})})+ ${ind(indent)} ${lit(END + '\n')}`);
    rules.set(name, options.join(' | '));
    return name;
  }

  // Clause links: at most MAX_LINKS lines `KEYWORD $id` after the other fields of a stated, assumed or query wire.
  rule('link-line', `${ind(2)} ${alt(LINK_WORDS)} " " ref "\\n"`);
  const links = rule('links', `link-line{0,${MAX_LINKS}}`);

  // stated / assumed
  rule('stated-wire', `wire-id " stated\\n" ${proposition(2, 'stated-value')} (${validLines(2)})? ${kw(2, 'certainty', alt(CERTAINTIES))} (${kw(2, 'speaker', `("user" | string)`)})? ${links}`);
  rule('assumed-wire', `wire-id " assumed\\n" ${proposition(2, 'stated-value')} (${validLines(2)})? (${kw(2, 'basis', alt(BASES))})? ${links}`);

  // unparsed: one verbatim span of the message (1..MAX_SPAN characters), the wire it belongs near, and a hint
  rule('span-string', `"\\"" ([^"\\\\\\x00-\\x20] | esc${lead}) str-char{0,${MAX_SPAN - 1}} "\\""`);
  rule('unparsed-wire', `wire-id " unparsed\\n" ${kw(2, 'span', 'span-string')} (${kw(2, 'near', 'ref')})? (${kw(2, 'hint', alt(UNPARSED_HINTS))})?`);

  // unclear: a kind with readings (2..4) or without; an optional reply language.
  const plainKinds = ENUMS.unclear.kind.filter(kind => !READING_KINDS.includes(kind));
  const language = `(${kw(2, 'language', alt(ENUMS.unclear.language))})?`;
  const unclearOptions = [`${kw(2, 'kind', alt(plainKinds))} ${language}`];
  if (READING_KINDS.length) unclearOptions.push(`${kw(2, 'kind', alt(READING_KINDS))} (${kw(2, 'reading', 'string')}){2,4} ${language}`);
  rule('unclear-wire', `wire-id " unclear\\n" (${unclearOptions.join(' | ')})`);

  // query
  const matchBlock = partial => block(partial ? 'cond-partial' : 'cond', 2, 0, indent => proposition(indent, 'query-value', {partial}), {matchLeaf: true});
  const where = partial => rule(`where${partial ? '-partial' : ''}`, `(${kwBlock(2, 'where', matchBlock(partial))})+`);
  const whereFull = where(false), wherePartial = where(true);
  const scope = rule('scope', kwBlock(2, 'scope', matchBlock(false)));
  rule('compare-leaf', `variable " " comparator " " operand`);
  const compareBlock = block('cmp', 2, 0, () => 'compare-leaf "\\n"', {matchLeaf: false});
  const time = key => kw(2, key, 'string');
  const select = rule('select', kw(2, 'select', 'variable (" " variable)*'));
  const selectOne = rule('select-one', kw(2, 'select', 'variable'));
  const rank = rule('rank', kw(2, 'rank', `${alt(RANK_WORDS)} " " variable`));
  const measure = rule('measure', kw(2, 'measure', alt(TIME_MEASURES)));
  const quantifierWords = QUANTIFIER_WORDS.map(word => word === 'at_least' ? `${lit(word + ' ')} [1-9] [0-9]{0,5}` : lit(word));
  const quantifier = rule('quantifier', kw(2, 'quantifier', `(${quantifierWords.join(' | ')})`));
  const tail = rule('query-tail', `(${time('at')} | ${time('during')})? (${kw(2, 'except', 'variable " " operand')})* (${kwBlock(2, 'compare', compareBlock)})* (${kw(2, 'order', `variable " " ${alt(ORDER_WORDS)} " " variable`)})? (${kw(2, 'limit', '[1-9] [0-9]{0,3}')})?`);
  const asof = `(${time('asof')})?`;
  const mode = value => kw(2, 'mode', lit(value));
  const [SELECT, EXISTS, COUNT, EXPLAIN, EVERY] = ['select', 'exists', 'count', 'explain', 'every'];
  for (const m of [SELECT, EXISTS, COUNT, EXPLAIN, EVERY]) if (!QUERY_MODES.includes(m)) throw Error(`sop-gbnf: query mode ${m} is not in QUERY_MODES`);
  const fragment = kw(2, 'fragment', alt(FRAGMENT_KINDS));
  const queryBodies = [
    // select (explicit or default): a measure only with exactly one selected variable
    `(${mode(SELECT)})? ${asof} (${selectOne} (${rank})? (${measure})? | ${select} (${rank})? | ${rank})? ${whereFull} ${tail}`,
    // follow-up fragment: partial match blocks
    `(${mode(SELECT)})? ${fragment} ${asof} (${select})? ${wherePartial} ${tail}`,
    `${kw(2, 'mode', alt([EXISTS, COUNT]))} ${asof} (${select})? (${rank})? ${whereFull} ${tail}`,
    // explain selects nothing
    `${mode(EXPLAIN)} ${asof} (${rank})? ${whereFull} ${tail}`,
    // every needs a scope; a quantifier belongs to every only
    `${mode(EVERY)} ${asof} (${select})? (${rank})? (${quantifier})? ${whereFull} ${scope} ${tail}`,
  ];
  rule('query-wire', `wire-id " query\\n" (${queryBodies.join(' | ')}) ${links}`);

  // constraint: words-only leaves, a task, and a claim or a selected result
  rule('word-term', 'variable | ref | number | string');
  rule('word-expr', 'word-term (" " arith " " word-term)*');
  rule('word-leaf', 'word-expr " " comparator " " word-expr');
  const boolBlock = block('bool', 2, 0, () => 'word-leaf "\\n"', {matchLeaf: false});
  const [PROVE, POSSIBLE, OPTIMIZE] = ['prove', 'possible', 'optimize'];
  for (const t of [PROVE, POSSIBLE, OPTIMIZE]) if (!ENUMS.constraint.task.includes(t)) throw Error(`sop-gbnf: constraint task ${t} is not in ENUMS`);
  const head = `(${kw(2, 'var', 'cvar " int" (" " integer " " integer)?')})* (${kwBlock(2, 'require', boolBlock)})*`;
  const claim = kwBlock(2, 'claim', boolBlock);
  const task = `(${kw(2, 'objective', 'word-expr')} (${kw(2, 'direction', alt(ENUMS.constraint.direction))})? ${kw(2, 'task', lit(OPTIMIZE))} | ${kw(2, 'task', alt([PROVE, POSSIBLE]))}) (${kw(2, 'unit', '[A-Za-z] [A-Za-z_]*')})?`;
  rule('constraint-wire', `wire-id " constraint\\n" ${head} (${claim} ${task} (${select})? | ${task} ${select})`);

  // program: one unclear wire alone, or stated/assumed/query/constraint/unparsed wires separated by at most one blank line
  const content = ['stated', 'assumed', 'query', 'constraint', 'unparsed'].filter(type => MODEL_TYPES.has(type)).map(type => type + '-wire');
  rule('content-wire', content.join(' | '));
  rule('program', `(unclear-wire | content-wire ("\\n"? content-wire)*) "\\n"?`);
  rule('root', 'program');

  const order = ['root', 'program', ...[...rules.keys()].filter(name => !['root', 'program'].includes(name))];
  return `# SOP Lang model surface (DS021), generated by tools/sop-gbnf.mjs from the parser contracts. Do not edit.\n`
    + order.map(name => `${name} ::= ${rules.get(name)}`).join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2)) {
  const at = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const text = generateGbnf({depth: Number(at('--depth') ?? DEFAULT_DEPTH), strings: at('--strings') ?? 'canonical'});
  const out = at('--out');
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true}); fs.writeFileSync(out, text); console.error(`wrote ${out} (${text.split('\n').length - 1} rules, ${text.length} bytes)`); }
  else process.stdout.write(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
