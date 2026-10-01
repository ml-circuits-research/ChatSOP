/**
 * The validator of the query author (b): everything a backend's `query.sop` must satisfy before the shared path runs it.
 *
 *   1. admission, the same as for SymbolicLM's output (`Agent.validateVocabulary`: parse, model wire checks, links, anchoring);
 *   2. the author's contract: only `query`, `constraint`, `unclear` and `unparsed` wires, plus `stated` with `certainty supposed`
 *      (a supposition of the message, used through `if`/`unless`); never an assertion, an assumption or a knowledge wire;
 *   3. advice (fixable, never fatal after the last round): a relation phrase of a `match` that does not link to any predicate of the
 *      memory (`relation_not_in_vocabulary`) or whose roles no predicate declares (`role_not_declared`).
 *
 * Returns {ok, problems, advice, program}. `problems` must be fixed; `advice` is sent back in a repair round while rounds remain.
 */
import {parse, one, many, isMatch, parseMatch} from '../../sop/parser.mjs';
import {parseCondition} from '../../sop/conditions.mjs';
import {linkRelation} from '../../sop/linking.mjs';
import {copulaForm} from '../../sop/copula-linker.mjs';
import {nearestPredicates} from './retrieval.mjs';
import {fold} from '../../sop/text-keys.mjs';
import {Agent} from '../../server/agent.mjs';

export const AUTHOR_TYPES = Object.freeze(['query', 'constraint', 'unclear', 'unparsed', 'stated']);

const codeOf = message => /^([a-z][a-z0-9_]*):\s/.exec(message)?.[1] ?? 'invalid_wire';
const bare = message => message.replace(/^[a-z][a-z0-9_]*:\s+/, '');

function matchBlocks(wire) {
  const blocks = [];
  for (const text of [...many(wire, 'where'), ...many(wire, 'scope')]) {
    parseCondition(text, leaf => { if (isMatch(leaf)) blocks.push(parseMatch(leaf, '@' + wire.id + ' match', {partial: wire.fields.fragment !== undefined})); return leaf; });
  }
  return blocks;
}

/** The default admission: an Agent shell that only validates (no repository, no session). */
export function defaultAdmit(lexicon) {
  const agent = new Agent({repo: null, session: null, lexicon, config: {}});
  return (sop, text) => agent.validateVocabulary(sop, text);
}

export function validateQuery({sop, message, lexicon, admit = defaultAdmit(lexicon), mode = 'id', hints = null, mentions = null}) {
  const problems = [];
  const advice = [];
  if (typeof sop !== 'string' || !sop.trim()) return {ok: false, problems: [{code: 'missing_output', message: 'query.sop is missing or empty; write the query wires'}], advice, program: null};
  let program = null;
  try { program = admit(sop, message); } catch (error) { return {ok: false, problems: [{code: codeOf(error.message), message: bare(error.message)}], advice, program: null}; }
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
  }
  if (!problems.length && mentions?.length && program.wires.some(w => w.type === 'query')) problems.push(...unusedMentions(program, mentions));
  return {ok: problems.length === 0, problems, advice, program};
}

const quotedStrings = program => {
  const out = [];
  for (const wire of program.wires) for (const values of Object.values(wire.fields)) for (const text of values) for (const m of String(text).matchAll(/"((?:\\.|[^"\\])*)"/g)) { try { out.push(JSON.parse(`"${m[1]}"`)); } catch { /* not a string */ } }
  return out;
};

/**
 * Completeness of the parse: every name of the request that the memory knows (a strong mention: a capitalised word or several words) is used in the
 * query, as a value, as its listed id, or as an option of `compare any`. A name left out silently widens the question ("Italy or Portugal" without
 * the options ranks every country) and the answer is wrong, so it is a problem the author must fix.
 */
function unusedMentions(program, mentions) {
  const strings = quotedStrings(program).map(fold);
  const ids = new Set(quotedStrings(program));
  return mentions.filter(m => m.strong).filter(m => {
    const surface = fold(m.surface);
    return !strings.some(s => s.includes(surface) || (s.length > 2 && surface.includes(s))) && !m.candidates.some(id => ids.has(id));
  }).map(m => ({code: 'mention_not_used', message: `the request names ${JSON.stringify(m.surface)} but the query does not use it; write the name (or its listed id) as a value, or as an option of compare any: leaving it out widens the question and the answer would be wrong`}));
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
  if (typeof relation !== 'string' || !relation || copulaForm(relation)) return;
  const used = block.roles.map(r => r.name).filter(name => name !== 'time');
  const link = linkRelation(relation, used, lexicon, {exact: false, headVerb: true, values: null});
  if (link.status === 'unknown') advice.push({code: 'relation_not_in_vocabulary', wire: wire.id, message: `the relation ${JSON.stringify(relation)} matches no phrase of the vocabulary; use one of the listed phrases of the predicate that means this`});
  else if (link.status === 'role_mismatch') advice.push({code: 'role_not_declared', wire: wire.id, message: `the relation ${JSON.stringify(relation)} does not declare the roles ${used.join(', ')}; its predicates declare ${link.candidates.map(c => c.id + '(' + (c.roles ?? []).join(', ') + ')').join('; ')}`});
}

/** The kind of an `unclear` answer ('no_request', 'gibberish', 'ambiguous') when the whole output is one `unclear` wire; null otherwise. */
export function unclearKind(program) {
  const wires = program?.wires ?? [];
  return wires.length === 1 && wires[0].type === 'unclear' ? one(wires[0], 'kind') ?? 'unclear' : null;
}
