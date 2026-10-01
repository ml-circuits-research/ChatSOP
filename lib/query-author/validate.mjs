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

export function validateQuery({sop, message, lexicon, admit = defaultAdmit(lexicon)}) {
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
      for (const block of blocks) {
        const relation = block.relation;
        if (typeof relation !== 'string' || !relation || copulaForm(relation)) continue;
        const used = block.roles.map(r => r.name).filter(name => name !== 'time'); // a time role the predicate does not declare is host work (span)
        const link = linkRelation(relation, used, lexicon, {exact: false, headVerb: true, values: null});
        if (link.status === 'unknown') advice.push({code: 'relation_not_in_vocabulary', wire: wire.id, message: `the relation ${JSON.stringify(relation)} matches no phrase of the vocabulary; use one of the listed phrases of the predicate that means this, or keep it and say so in report.md`});
        else if (link.status === 'role_mismatch') advice.push({code: 'role_not_declared', wire: wire.id, message: `the relation ${JSON.stringify(relation)} does not declare the roles ${used.join(', ')}; its predicates declare ${link.candidates.map(c => c.id + '(' + (c.roles ?? []).join(', ') + ')').join('; ')}`});
      }
    }
  }
  return {ok: problems.length === 0, problems, advice, program};
}

/** The kind of an `unclear` answer ('no_request', 'gibberish', 'ambiguous') when the whole output is one `unclear` wire; null otherwise. */
export function unclearKind(program) {
  const wires = program?.wires ?? [];
  return wires.length === 1 && wires[0].type === 'unclear' ? one(wires[0], 'kind') ?? 'unclear' : null;
}
