import {parse, one, many, unquote, isMatch, parseMatch} from '../../sop/parser.mjs';
import {MODEL_TYPES, checkModelWire} from '../../sop/declarative.mjs';
import {checkModelLinks} from '../../sop/clauses.mjs';
import {parseCondition} from '../../sop/conditions.mjs';
import {copulaForm} from '../../sop/copula-linker.mjs';
import {englishDictionary} from '../../sop/dictionary.mjs';
import {propositionOf} from '../../sop/propositions.mjs';
import {linkRelation, mentionedIn, mentionedThroughLexicon, mentionedThroughDictionary} from '../../sop/linking.mjs';
import {assert} from '../util.mjs';

/** Model admission shared by the chat and the author; no execution or storage. */
export function admitModel(sop, text, lexicon, policy = {}) {
  const program = parse(sop);
  if (program.wires.some(w => w.type === 'unclear')) assert(program.wires.length === 1, 'unclear_not_alone: unclear must be the only wire of the model output');
  const dictionary = policy.dictionary === false ? null : englishDictionary();
  const verbatim = value => String(value).normalize('NFC').toLocaleLowerCase('ro').replace(/\s+/g, ' ').trim();
  for (const wire of program.wires) {
    assert(MODEL_TYPES.has(wire.type), 'wire_not_allowed: Model output must be declarative: stated, assumed, unclear, query, constraint or unparsed');
    checkModelWire(wire);
    if ((wire.type === 'stated' || wire.type === 'assumed') && lexicon?.predicates) {
      const proposition = propositionOf(wire);
      const predicate = lexicon.predicates[proposition.relation];
      if (predicate) {
        const declared = new Set((predicate.roles ?? []).map(role => role.name));
        for (const role of proposition.roles) {
          if (role.name === 'time' && !declared.has('time') && typeof role.value === 'string') continue; // quoted validity, not an argument
          assert(declared.has(role.name), `undeclared_role: ${predicate.id} has no role ${role.name}; declared roles: ${[...declared].join(', ')}`);
        }
      }
    }
    if (wire.type === 'query' && lexicon?.predicates) {
      for (const condition of [...many(wire, 'where'), ...many(wire, 'scope')]) {
        parseCondition(condition, leaf => {
          if (!isMatch(leaf)) return leaf;
          const match = parseMatch(leaf, '@' + wire.id + ' match', {partial: wire.fields.fragment !== undefined});
          const predicate = lexicon.predicates[match.relation];
          const used = match.roles.map(role => role.name).filter(name => name !== 'time');
          if (!predicate && match.relation && !copulaForm(match.relation)) {
            const link = linkRelation(match.relation, used, lexicon, {exact: false, headVerb: false});
            if (link.status === 'role_mismatch') throw new Error(`undeclared_role: ${JSON.stringify(match.relation)} cannot use roles ${used.join(', ')}; declared roles: ${link.candidates.map(candidate => `${candidate.id}(${candidate.roles?.join(', ') ?? ''})`).join('; ')}`);
          }
          if (!predicate) return leaf; // Unknown phrases can still link after frame normalization.
          const declared = new Set((predicate.roles ?? []).map(role => role.name));
          for (const role of match.roles) {
            if (role.name !== 'time' || declared.has('time')) {
              assert(declared.has(role.name), `undeclared_role: ${predicate.id} has no role ${role.name}; declared roles: ${[...declared].join(', ')}`);
            }
          }
          return leaf;
        });
      }
    }
    if (wire.type === 'stated') {
      const p = propositionOf(wire);
      for (const {name, value} of p.roles) {
        if (value && typeof value === 'object' || typeof value === 'string' && value.startsWith('?')) continue;
        assert(mentionedIn(value, text) || mentionedThroughLexicon(value, text, lexicon) || mentionedThroughDictionary(value, text, dictionary), 'stated_value_not_in_message: ' + JSON.stringify(value) + ' (role ' + name + ' of @' + wire.id + ') is not mentioned in this message; use assumed, a query variable or an unparsed span');
      }
      if (p.speaker !== 'user') assert(mentionedIn(p.speaker, text), 'stated_value_not_in_message: speaker ' + JSON.stringify(p.speaker) + ' of @' + wire.id + ' is not mentioned in this message');
    }
    if (wire.type === 'unparsed') {
      const span = unquote(one(wire, 'span'));
      assert(verbatim(text).includes(verbatim(span)), 'unparsed_span_not_in_message: ' + JSON.stringify(span) + ' of @' + wire.id + ' is not a verbatim part of this message');
    }
  }
  checkModelLinks(program);
  return program;
}
