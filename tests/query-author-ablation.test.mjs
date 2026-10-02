import test from 'node:test';
import assert from 'node:assert/strict';
import {ablationFetchInterceptor, sopToCircuit} from '../lib/query-author/structured/intercept.mjs';
import {compileCircuit} from '../lib/query-author/structured/compiler.mjs';

const candidates = {predicates: [{id: 'born', roles: [{name: 'subject', type: 'person'}]}],
  entities: ['Maria'], numbers: [], times: ['2020-01-01']};
const lexicon = {predicates: {born: candidates.predicates[0]}};
const context = {files: [{path: 'input/message.txt', text: 'When was Maria born?'}],
  retrieval: {predicates: ['born'], entities: [{surface: 'Maria', candidates: ['Maria']}]}, user: 'When was Maria born? Write query.sop.'};

test('SOP time comparison preserves offered time type through the original strict JSON compiler', () => {
  const sop = '@q query\n  where all\n    match\n      relation "born"\n      role subject "Maria"\n      role time ?t\n      polarity affirmed\n    end\n  end\n  compare all\n    ?t equal "2020-01-01"\n  end\n';
  const circuit = sopToCircuit(sop, candidates);
  assert.deepEqual(circuit.circuit.tests.items[0].right, {kind: 'time', value: '2020-01-01'});
  compileCircuit(circuit, candidates);
  assert.throws(() => compileCircuit({...circuit, circuit: {...circuit.circuit, tests: {op: 'all', items: [
    {...circuit.circuit.tests.items[0], right: {kind: 'time', value: 'unoffered'}}]} }}, candidates), /offered value/);
});

test('malformed staged selections refuse before argument generation and retain completed-step metadata', async () => {
  const run = async answers => {
    const calls = [], reports = [];
    const fetch = ablationFetchInterceptor({variant: 'steps', context, lexicon, onCall: call => reports.push(call),
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(init.body).response_format.json_schema.name);
        return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(answers.shift())}}],
          usage: {prompt_tokens: 10, completion_tokens: 5}}));
      }});
    await assert.rejects(fetch('http://unused/v1/chat/completions', {method: 'POST', body: JSON.stringify({model: 'test',
      messages: [{role: 'system', content: 'unused'}, {role: 'user', content: 'unused'}], max_tokens: 100})}));
    return {calls, reports};
  };
  const extra = await run([{kind: 'lookup', answer: 'Maria'}]);
  assert.deepEqual(extra.calls, ['form_choice']);
  assert.match(extra.reports[0].error, /invalid form choice/);
  assert.deepEqual(extra.reports[0].steps.map(step => step.name), ['form']);
  const unknown = await run([{kind: 'lookup'}, {predicates: ['secret']}]);
  assert.deepEqual(unknown.calls, ['form_choice', 'predicate_choice']);
  assert.match(unknown.reports[0].error, /unoffered predicates/);
  assert.deepEqual(unknown.reports[0].steps.map(step => step.name), ['form', 'predicates']);
});
