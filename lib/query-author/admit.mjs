import {parse, one, unquote} from '../../sop/parser.mjs';
import {MODEL_TYPES, checkModelWire} from '../../sop/declarative.mjs';
import {checkModelLinks} from '../../sop/clauses.mjs';
import {englishDictionary} from '../../sop/dictionary.mjs';
import {propositionOf} from '../../sop/propositions.mjs';
import {mentionedIn, mentionedThroughLexicon, mentionedThroughDictionary} from '../../sop/linking.mjs';
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
