import test from 'node:test';
import assert from 'node:assert/strict';
import {requestCandidates} from '../lib/query-author/structured/candidates.mjs';

 test('closed candidates cannot import unoffered predicates, facts or unsafe request numbers', () => {
  const lexicon = {predicates: {
    offered: {id: 'offered', roles: [{name: 'subject', type: 'entity'}, {name: 'object', type: 'int'}], facts: ['secret']},
    withheld: {id: 'withheld', roles: [{name: 'subject', type: 'entity'}]},
  }};
  const context = {files: [{path: 'input/message.txt', text: 'Ada at 2025-04-03, between -3 and 15; id123 and 9007199254740992 are not integers to invent.'}], retrieval: {predicates: ['offered'], entities: [{surface: 'Ada', candidates: ['ada']}]}};
  const actual = requestCandidates(context, lexicon);
  assert.deepEqual(actual.predicates, [{id: 'offered', roles: [{name: 'subject', type: 'entity'}, {name: 'object', type: 'int'}]}]);
  assert.deepEqual(actual.entities, ['Ada', 'ada']);
  assert.equal(actual.numbers.includes(123), false);
  assert.equal(actual.numbers.includes(9007199254740992), false);
  assert.equal(actual.numbers.includes(-3), true);
  assert.deepEqual(actual.times, ['2025-04-03']);
});
