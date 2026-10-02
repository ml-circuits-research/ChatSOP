import test from 'node:test';
import assert from 'node:assert/strict';
import {createQueryParser, queryParserSettings} from '../server/query-parser.mjs';
import {checkStrategy, FORMALIZATION_STRATEGIES} from '../lib/formalize/strategies.mjs';
import {Lexicon} from '../sop/lexicon.mjs';

const lexicon = Lexicon.fromCircuits([{name: 't', text: '@ana entity\n  kind entity\n  label en "Ana"\n@cleared predicate\n  args subject:entity\n'}]);
const SOP = '@q query\n  where match\n    relation "cleared"\n    role subject "ana"\n    polarity affirmed\n  end\n';

/** A stub local strategy factory: records which strategy ran and returns an authorQuery-shaped result. */
function stubLocal() {
  const runs = [];
  const factory = (name, local) => ({name, settings: local, server: {stop: async () => runs.push({stopped: name})},
    availability: async () => ({available: true, models: [local.alias], skipped: []}),
    run: async args => { runs.push({name, message: args.message}); return {ok: true, status: 'validated', sop: SOP, program: {wires: []}, rounds: 1, usage: {cost_usd: 0}, model: local.alias, steps: [{}, {}, {}]}; }});
  return {runs, factory};
}

test('formalization strategies are named and selectable in config and by the environment; an unknown one is refused', () => {
  assert.deepEqual(FORMALIZATION_STRATEGIES, ['CodingAgent', 'LocalLLMDirect', 'LocalLLMStepByStep', 'InternalReasoningStepByStep']);
  assert.equal(queryParserSettings({}).strategy, 'CodingAgent');
  assert.equal(queryParserSettings({queryParser: {strategy: 'LocalLLMDirect'}}, {}).strategy, 'LocalLLMDirect');
  assert.equal(queryParserSettings({}, {CHATSOP_FORMALIZER: 'LocalLLMStepByStep'}).strategy, 'LocalLLMStepByStep');
  assert.equal(queryParserSettings({queryParser: {local: {alias: 'small'}}}, {}).local.slots.join(','), 'direct,steps,reasoning');
  assert.throws(() => checkStrategy('Guess'), e => e.code === 'invalid_strategy');
});

test('a turn runs the strategy the session chose, never a substitute, and the parse record names it', async () => {
  const {runs, factory} = stubLocal();
  const parser = createQueryParser({settings: queryParserSettings({queryParser: {strategy: 'CodingAgent', local: {alias: 'qwen-test', endpoint: 'http://127.0.0.1:9/v1'}}}, {}), localFactory: factory});
  const done = await parser.parse({message: 'Is Ana cleared?', lexicon, strategy: 'LocalLLMStepByStep'});
  assert.equal(done.parse.strategy, 'LocalLLMStepByStep');
  assert.equal(done.parse.parser, 'local_llm_step_by_step');
  assert.equal(done.parse.steps, 3);
  assert.equal(done.parse.model, 'qwen-test');
  assert.deepEqual(runs, [{name: 'LocalLLMStepByStep', message: 'Is Ana cleared?'}]);
  const direct = await parser.parse({message: 'Is Ana cleared now?', lexicon, strategy: 'LocalLLMDirect'});
  assert.equal(direct.parse.parser, 'local_llm_direct');
  await assert.rejects(parser.parse({message: 'x', lexicon, strategy: 'Other'}), e => e.code === 'invalid_strategy');
  await parser.stop();
  assert.deepEqual(runs.filter(r => r.stopped).map(r => r.stopped).sort(), ['LocalLLMDirect', 'LocalLLMStepByStep']);
});

test('the strategies listing reports a local endpoint that does not answer as unavailable, without starting anything', async () => {
  const parser = createQueryParser({settings: queryParserSettings({queryParser: {local: {endpoint: 'http://127.0.0.1:9/v1'}}}, {}),
    fetchImpl: async () => { throw new Error('connection refused'); }});
  const listed = await parser.strategies();
  assert.deepEqual(listed.map(s => s.id), ['CodingAgent', 'LocalLLMDirect', 'LocalLLMStepByStep', 'InternalReasoningStepByStep']);
  const local = listed.find(s => s.id === 'LocalLLMStepByStep');
  assert.equal(local.available, false);
  assert.match(local.reason, /does not answer/);
});
