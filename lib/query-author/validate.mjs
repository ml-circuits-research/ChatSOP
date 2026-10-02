/**
 * The validator of the query author (b): everything a backend's `query.sop` must satisfy before the shared path runs it.
 *
 * Admission combines model-wire checks with the knowledge validator for turn-local definitions.
 * Assertions and raw fact wires remain forbidden. Mention and question-form omissions are errors.
 * Phrase-mode vocabulary misses remain repair advice.
 *
 * Returns {ok, problems, advice, program}. `problems` must be fixed; `advice` is sent back in a repair round while rounds remain.
 */
import {one, many, words, isMatch, parseMatch} from '../../sop/parser.mjs';
import {parseCondition} from '../../sop/conditions.mjs';
import {definitelyBound} from '../../lib/conditions.mjs';
import {propositionOf} from '../../sop/propositions.mjs';
import {linkRelation} from '../../sop/linking.mjs';
import {copulaForm} from '../../sop/copula-linker.mjs';
import {nearestPredicates} from './retrieval.mjs';
import {fold} from '../../sop/text-keys.mjs';
import {admitCircuits} from './session.mjs';

export const AUTHOR_TYPES = Object.freeze(['query', 'constraint', 'unclear', 'unparsed', 'stated', 'assumed', 'predicate', 'rule', 'default']);

const codeOf = message => /^([a-z][a-z0-9_]*):\s/.exec(message)?.[1] ?? 'invalid_wire';
const bare = message => message.replace(/^[a-z][a-z0-9_]*:\s+/, '');

function matchBlocks(wire) {
  const blocks = [];
  for (const text of [...many(wire, 'where'), ...many(wire, 'scope')]) {
    parseCondition(text, leaf => { if (isMatch(leaf)) blocks.push(parseMatch(leaf, '@' + wire.id + ' match', {partial: wire.fields.fragment !== undefined})); return leaf; });
  }
  return blocks;
}

/** Admission without a repository; callers with a memory supply its layered circuits. */
export function defaultAdmit(lexicon, circuits) {
  return (sop, text) => admitCircuits(sop, text, lexicon, {circuits});
}

export function validateQuery({sop, message, lexicon, circuits, admit = defaultAdmit(lexicon, circuits), mode = 'id', hints = null, mentions = null}) {
  const problems = [];
  const advice = [];
  if (typeof sop !== 'string' || !sop.trim()) return {ok: false, problems: [{code: 'missing_output', message: 'query.sop is missing or empty; write the query wires'}], advice, program: null};
  let program = null;
  try { program = admit(sop, message); } catch (error) { return {ok: false, problems: [{code: codeOf(error.message), message: bare(error.message)}], advice, program: null}; }
  lexicon = program.lexicon ?? lexicon;
  for (const wire of program.wires) {
    if (!AUTHOR_TYPES.includes(wire.type)) problems.push({code: 'wire_not_allowed', wire: wire.id, message: `a ${wire.type} wire is not allowed here: write only query, constraint, unclear or unparsed wires`});
    else if (wire.type === 'stated' && one(wire, 'certainty') !== 'supposed') problems.push({code: 'fact_not_allowed', wire: wire.id, message: 'a stated wire is allowed only for a supposition of the message (certainty supposed, linked by if or unless); never write an assertion of the world'});
  }
  if (!program.wires.some(w => ['query', 'constraint', 'unclear'].includes(w.type))) problems.push({code: 'no_query', message: 'write at least one query wire, or unclear when the request cannot be answered'});
  if (!problems.length && lexicon?.predicates) {
    for (const wire of program.wires.filter(w => w.type === 'query')) {
      let blocks = [];
      try { blocks = matchBlocks(wire); } catch { blocks = []; }
      for (const block of blocks) (mode === 'id' ? checkIds : checkPhrases)(block, wire, lexicon, problems, advice, hints);
    }
    for (const wire of program.wires.filter(w => w.type === 'assumed')) checkIds(propositionOf(wire), wire, lexicon, problems, advice, hints);
  }
  if (!problems.length) for (const wire of program.wires.filter(w => w.type === 'query')) problems.push(...unboundQuestionVariables(wire));
  if (!problems.length && program.wires.some(w => w.type === 'query')) problems.push(...missingQuestionForms(program, message, mentions));
  if (!problems.length && mentions?.length && program.wires.some(w => w.type === 'query' || w.type === 'constraint')) problems.push(...unusedMentions(program, mentions, message));
  return {ok: problems.length === 0, problems, advice, program};
}

const quotedStrings = text => {
  const out = [];
  for (const m of String(text).matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    try { out.push(JSON.parse(`"${m[1]}"`)); } catch { /* already rejected by admission */ }
  }
  return out;
};

/** Only values in questions or numeric constraints count as using a name. Definitions and assumptions cannot hide a dropped option. */
function questionValues(program) {
  const values = [];
  for (const wire of program.wires) {
    if (wire.type === 'query') {
      for (const block of matchBlocks(wire)) for (const role of block.roles) if (typeof role.value === 'string' && !role.value.startsWith('?')) values.push(role.value);
      for (const field of ['compare', 'except']) for (const text of many(wire, field)) values.push(...quotedStrings(text));
    } else if (wire.type === 'constraint') {
      for (const field of ['require', 'claim', 'objective']) for (const text of many(wire, field)) values.push(...quotedStrings(text));
    }
  }
  return values;
}

/** A name can label a numeric unknown without appearing as a string operand. Only an explicit
 * "let x be NAME's assignment" declaration binds that name to ?x; a bare declaration or select
 * cannot cover a missing requirement about that unknown. */
function constraintNameBindings(program, message) {
  const labels = new Map();
  const text = fold(message ?? '').replaceAll('_', ' ');
  for (const match of text.matchAll(/\b(?:let|and)\s+([a-z][a-z0-9_]*)\s+be\s+([\p{L}\p{N}][\p{L}\p{N} .-]*?)['’]s\s+assignment\b/gu)) {
    labels.set(fold(match[2]).trim(), `?${match[1]}`);
  }
  const used = [];
  for (const wire of program.wires.filter(w => w.type === 'constraint')) {
    const declared = new Set(many(wire, 'var').map(line => words(line)[0]));
    const constrained = new Set();
    for (const field of ['require', 'claim', 'objective']) {
      for (const text of many(wire, field)) {
        for (const [, name] of text.replace(/"(?:\\.|[^"\\])*"/g, '').matchAll(/\?([a-z][a-z0-9_]*)\b/g))
          if (declared.has(`?${name}`)) constrained.add(`?${name}`);
      }
    }
    used.push(constrained);
  }
  return {labels, used};
}

/** Admission checks syntax, but a projected or compared unknown must be bound by every
 * alternative of the restriction, just as in lowerQuery's native condition tree. */
function unboundQuestionVariables(wire) {
  if (wire.fields.fragment) return []; // a follow-up's missing roles come from caller-owned context
  const condition = text => parseCondition(text, leaf => {
    const match = parseMatch(leaf);
    const variables = match.roles.map(role => role.value).filter(value => typeof value === 'string' && value.startsWith('?'));
    return {kind: 'atom', a: match.polarity === 'absent' ? [] : variables, absent: match.polarity === 'absent' ? variables : []};
  });
  const where = many(wire, 'where').map(condition);
  const bound = definitelyBound(where);
  const problems = [];
  const checkAbsence = (node, context) => {
    if (node.kind === 'all') {
      for (const child of node.children) {
        const others = node.children.filter(sibling => sibling !== child);
        checkAbsence(child, new Set([...context, ...definitelyBound(others)]));
      }
    } else if (node.kind === 'any') {
      for (const child of node.children) checkAbsence(child, context);
    } else for (const name of node.absent) if (!context.has(name)) problems.push({code: 'unsafe_absence_variable', wire: wire.id,
      message: `${name} under polarity absent needs a positive or explicit-negative evidence match in the same conjunction to bind it; absence alone cannot enumerate unknown values`});
  };
  for (const tree of where) checkAbsence(tree, bound);
  if (wire.fields.scope) checkAbsence(condition(one(wire, 'scope')), bound);
  const check = (value, field) => {
    if (value?.startsWith('?') && !bound.has(value)) problems.push({code: 'unbound_query_variable', wire: wire.id,
      message: `${field} uses ${value} but no where match binds it in every alternative; put ${value} in a where match role, or use a variable already bound there`});
  };
  for (const value of words(one(wire, 'select', ''))) check(value, 'select');
  for (const text of many(wire, 'compare')) parseCondition(text, leaf => {
    const [left,,right] = words(leaf);
    check(left, 'compare');
    check(right, 'compare');
    return leaf;
  });
  for (const text of many(wire, 'except')) check(words(text)[0], 'except');
  if (wire.fields.rank) check(words(one(wire, 'rank'))[1], 'rank');
  return problems;
}

/**
 * A known, strong name has to constrain the requested answer. It is not enough for an unrelated
 * assumption, definition, relation label or explanatory span to repeat the name.
 */
function unusedMentions(program, mentions, message) {
  const values = questionValues(program);
  const strings = values.map(fold);
  const ids = new Set(values);
  const {labels, used} = constraintNameBindings(program, message);
  const missing = mentions.filter(m => m.strong).filter(m => {
    const surface = fold(m.surface);
    const name = surface.replace(/['’]s$/, '').replaceAll('_', ' ').trim();
    return !strings.some(s => s.includes(surface) || (s.length > 2 && surface.includes(s))) &&
      !m.candidates.some(id => ids.has(id)) && !used.some(constrained => constrained.has(labels.get(name)));
  }).map(m => ({code: 'mention_not_used', message: `the request names ${JSON.stringify(m.surface)} but the query does not use it; write the name (or its listed id) as a query value, or bind its explicitly named numeric variable in a constraint requirement or claim: leaving it out widens the question and the answer would be wrong`}));
  const named = [...new Set(labels.values())];
  const relevant = used.filter(constrained => named.some(variable => constrained.has(variable)));
  // One question about one named assignment has one numeric scope. Separate wires ask
  // independent questions even when each happens to mention both unknowns.
  if (named.length > 1 && !missing.length && (String(message).match(/\?/g) ?? []).length === 1 &&
    relevant.length > 1) {
    missing.push({code: 'constraint_split', message: `the named numeric variables ${named.join(', ')} describe one assignment; put all their requirements and one task in the same constraint wire, not independent problems`});
  }
  return missing;
}

/**
 * Guard only explicit English cues, not inferred intent or a general language parse. An "at least"
 * threshold can be either a quantified set or a comparison against a numeric attribute.
 */
function missingQuestionForms(program, message, mentions) {
  const queries = program.wires.filter(w => w.type === 'query');
  const text = String(message ?? '').replace(/\s+/g, ' ').toLowerCase();
  const problems = [];
  const quantifiers = [
    [/\bnot all\b/, 'not_all'],
    [/\bmost\b/, 'most'],
    [/\bhalf\b/, 'half'],
    [/\bnone\b/, 'none']
  ];
  // A superlative ("most populous") and a quantity of an object ("half a litre")
  // are not quantified sets. Require an overt subject followed by a finite verb.
  const quantifiedSubject = /\b(?:most|half|none|not all)(?:\s+of\s+the)?\s+(?:[\w-]+\s+){1,3}(?:are|were|have|has|do|does|did|can|will)\b/;
  const quantifiedQuestion = /\b(?:do|does|did|are|were|is|was|have|has)\s+(?:most|half|none|not all)\b/;
  if (quantifiedSubject.test(text) || quantifiedQuestion.test(text)) {
    for (const [cue, word] of quantifiers) {
      if (!cue.test(text)) continue;
      if (!queries.some(w => one(w, 'mode') === 'every' && one(w, 'quantifier') === word)) {
        problems.push({code: 'quantifier_not_used', message: `the request explicitly says ${JSON.stringify(cue.exec(text)[0])}; preserve it with mode every and quantifier ${word}`});
      }
    }
  }
  for (const match of text.matchAll(/\bat least ([1-9]\d*)\b/g)) {
    const count = match[1];
    if (!queries.some(w => (one(w, 'mode') === 'every' && one(w, 'quantifier') === `at_least ${count}`) ||
      many(w, 'compare').some(c => new RegExp(`\\bat_least ${count}\\b`).test(c)))) {
      problems.push({code: 'quantifier_not_used', message: `the request explicitly says "at least ${count}"; preserve the bound as quantifier at_least ${count} or compare ?value at_least ${count}`});
    }
  }
  const comparativeCue = /\b(?:which|who|what)\b.*\b(?:bigger|larger|smaller|older|younger|higher|lower|faster|slower|earlier|later|first|last|more|less|most|least|best|worst|longer|shorter)\b.*\bor\b/.test(text);
  const named = (mentions ?? []).filter(m => m.strong);
  const surface = fold(text);
  // Nearest known names around "or" are the options, not every name elsewhere in the request.
  const optionMentions = comparativeCue ? [...surface.matchAll(/\bor\b/g)].map(or => {
    const before = named.map(m => ({m, at: surface.lastIndexOf(fold(m.surface), or.index)}))
      .filter(item => item.at >= 0 && item.at + fold(item.m.surface).length <= or.index)
      .sort((a, b) => b.at - a.at)[0]?.m;
    const after = named.map(m => ({m, at: surface.indexOf(fold(m.surface), or.index + or[0].length)}))
      .filter(item => item.at >= 0)
      .sort((a, b) => a.at - b.at)[0]?.m;
    return before && after && before !== after ? [before, after] : null;
  }).find(Boolean) ?? [] : [];
  const choice = optionMentions.length === 2;
  const optionsIn = (text, parseLeaf) => {
    const tree = parseCondition(text, parseLeaf);
    const groups = node => node?.kind === 'any'
      ? [node, ...node.children.flatMap(groups)]
      : node?.children?.flatMap(groups) ?? [];
    return groups(tree).some(group => group.children.length >= 2 &&
      optionMentions.every(m => {
        const forms = [fold(m.surface), ...m.candidates.map(fold)];
        return group.children.some(child => child.values?.some(value => forms.includes(fold(value))));
      }));
  };
  if (choice && !queries.some(w => {
    if (!w.fields.rank) return false;
    if (many(w, 'compare').some(c => optionsIn(c, leaf => ({values: quotedStrings(leaf)})))) return true;
    return many(w, 'where').some(c => optionsIn(c, leaf => ({
      values: isMatch(leaf) ? parseMatch(leaf).roles.map(role => role.value).filter(value => typeof value === 'string' && !value.startsWith('?')) : []
    })));
  })) {
    problems.push({code: 'comparison_options_not_used', message: 'the comparative choice names options; restrict the ranked candidates to those options (compare any or where any), then rank their value'});
  }
  if (/\b(?:is|was|are|were)\b.*\b(?:bigger|larger|smaller|older|younger|higher|lower|faster|slower|earlier|later|longer|shorter)\s+than\b/.test(text) &&
    !queries.some(w => many(w, 'compare').some(c => /\?(?:[A-Za-z][A-Za-z0-9_]*)\s+(?:above|below|at_least|at_most)\s+\?(?:[A-Za-z][A-Za-z0-9_]*)/.test(c)))) {
    problems.push({code: 'comparison_not_used', message: 'the request compares two things; preserve the ordering with compare ?left above|below ?right'});
  }
  return problems;
}

const describePredicate = p => `${p.id}(${(p.roles ?? []).map(r => r.name + ':' + r.type).join(', ')})`;

/** Id mode: the relation is a predicate id of the memory, its roles are declared, entity ids are listed hints and fit the role class. */
function checkIds(block, wire, lexicon, problems, advice, hints) {
  const relation = block.relation;
  if (typeof relation !== 'string' || !relation) return;
  const predicate = Object.hasOwn(lexicon.predicates, relation) ? lexicon.predicates[relation] : null;
  if (!predicate) {
    const near = nearestPredicates(relation, lexicon, 5).map(id => describePredicate(lexicon.predicates[id]));
    problems.push({code: 'unknown_predicate', wire: wire.id, message: `relation ${JSON.stringify(relation)} is not a predicate id of the memory; write the id of one of the candidates${near.length ? ' (nearest: ' + near.join('; ') + ')' : ''}, or unclear with kind relation_not_in_memory if none means what the request asks`});
    return;
  }
  if (block.polarity === 'absent' && predicate.closed !== true) problems.push({code: 'absence_needs_closed', wire: wire.id,
    message: `${predicate.id} is not declared closed true in the memory or this turn; absence requires an exhaustive reviewed relation. Use polarity negated only if the request asks for explicit contrary evidence, otherwise report unclear`});
  const declared = new Map((predicate.roles ?? []).map(r => [r.name, r.type]));
  for (const role of block.roles) {
    if (role.name === 'time') continue; // a time role the predicate does not declare is host work (span)
    if (!declared.has(role.name)) { problems.push({code: 'undeclared_role', wire: wire.id, message: `${predicate.id} declares the roles ${describePredicate(predicate)}; it has no role ${role.name}`}); continue; }
    const value = role.value;
    if (typeof value !== 'string' || value.startsWith('?') || !Object.hasOwn(lexicon.entities ?? {}, value)) continue;
    if (hints && !hints.has(value) && !lexicon.isClass?.(value)) { problems.push({code: 'entity_id_not_listed', wire: wire.id, message: `${JSON.stringify(value)} is the id of an entity of the memory that is not in the entity hints; write the name as it is in the request, or an id from the hints`}); continue; }
    const type = declared.get(role.name);
    const fits = !type || type === 'entity' || lexicon.entities[value].entityType === type || (lexicon.isClass?.(type) && lexicon.classesOf(value).has(type));
    if (!fits) problems.push({code: 'class_mismatch', wire: wire.id, message: `${value} (${lexicon.entities[value].entityType}) cannot be the ${role.name} of ${predicate.id}, which expects ${type}; check the roles or the entity`});
  }
}

/** Phrase mode (a measured arm): the phrase must link to a predicate of the memory; a miss is advice, not a problem. */
function checkPhrases(block, wire, lexicon, problems, advice) {
  const relation = block.relation;
  if (typeof relation !== 'string' || !relation || (block.polarity !== 'absent' && copulaForm(relation))) return;
  const used = block.roles.map(r => r.name).filter(name => name !== 'time');
  const link = copulaForm(relation) ? {status: 'unknown'} : linkRelation(relation, used, lexicon, {exact: false, headVerb: true, values: null});
  if (block.polarity === 'absent' && (link.status !== 'bound' || lexicon.predicates[link.id]?.closed !== true)) {
    problems.push({code: 'absence_needs_closed', wire: wire.id,
      message: `the relation ${JSON.stringify(relation)} must link unambiguously to a predicate declared closed true before absence can be asked. Use polarity negated only for explicit contrary evidence, otherwise report unclear`});
    return;
  }
  if (link.status === 'unknown') advice.push({code: 'relation_not_in_vocabulary', wire: wire.id, message: `the relation ${JSON.stringify(relation)} matches no phrase of the vocabulary; use one of the listed phrases of the predicate that means this`});
  else if (link.status === 'role_mismatch') advice.push({code: 'role_not_declared', wire: wire.id, message: `the relation ${JSON.stringify(relation)} does not declare the roles ${used.join(', ')}; its predicates declare ${link.candidates.map(c => c.id + '(' + (c.roles ?? []).join(', ') + ')').join('; ')}`});
}

/** The kind of an `unclear` answer ('no_request', 'gibberish', 'ambiguous') when the whole output is one `unclear` wire; null otherwise. */
export function unclearKind(program) {
  const wires = program?.wires ?? [];
  return wires.length === 1 && wires[0].type === 'unclear' ? one(wires[0], 'kind') ?? 'unclear' : null;
}
