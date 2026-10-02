import {ROLE_NAMES} from '../../../sop/enums.mjs';

const NUMBER_WORDS = {zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, once: 1, twice: 2, thrice: 3};
/** Request data only: never inspect stored facts, gold circuits or execution packets. */
export function requestCandidates(context, lexicon) {
  const message = context.files.find(f => f.path === 'input/message.txt')?.text ?? '';
  const predicates = (context.retrieval.predicates ?? []).map(id => lexicon.predicates[id]).filter(Boolean).map(p => ({
    id: p.id,
    roles: (p.roles?.length ? p.roles : (p.args ?? []).map((type, i) => ({name: ['subject', 'object'][i], type})))
      .map(r => ({name: r.name, type: r.type ?? 'entity'})),
  })).filter(p => p.roles.length > 0 && p.roles.length <= 4 && p.roles.every(r => ROLE_NAMES.includes(r.name)));
  const entities = [...new Set((context.retrieval.entities ?? []).flatMap(e => [e.surface, ...e.candidates]))];
  const numericLiterals = [...message.matchAll(/(?<![\p{L}\p{N}_])-?\d+(?![\p{L}\p{N}_])/gu)].map(m => Number(m[0])).filter(Number.isSafeInteger);
  const wordLiterals = (message.toLowerCase().match(/\b[a-z]+\b/g) ?? []).filter(word => Object.hasOwn(NUMBER_WORDS, word)).map(word => NUMBER_WORDS[word]);
  const numbers = [...new Set([...numericLiterals, ...wordLiterals])];
  const times = [...new Set([...message.matchAll(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?Z)?\b/g)].map(m => m[0]))];
  return {predicates, entities, numbers, times};
}
