// ChatSOP's TinyAgent layer: config/tinyagent.json merges over the built-in defaults, names tiers only, and registers the project's
// TaskLambdas (the project modules of jobs/lambdas/, the job folders, the task templates) without a loading problem. No server, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLayers} from '../../TinyAgent/lib/config.mjs';
import {loadLambdas, validateParams} from '../../TinyAgent/lib/lambda/registry.mjs';
import {TINYAGENT_CONFIG} from '../../lib/tinyagent.mjs';

test('the project layer: tiers, local models, runner and TaskLambdas', async () => {
  const {config, layers} = loadLayers({project: TINYAGENT_CONFIG, user: false, env: {}});
  assert.equal(layers.at(-1), TINYAGENT_CONFIG);
  for (const t of ['nano', 'micro', 'tiny', 'small', 'medium', 'good', 'best', 'structure', 'formalizer']) assert.ok(config.tiers[t], t);
  assert.equal(config.tiers.supertiny, 'micro');
  assert.ok(config.providers.local.start.gguf.endsWith('.gguf') && config.providers.local.start.startAtBoot);
  assert.ok(config.runner.dataDir.endsWith('state/llm-jobs'));
  const {lambdas, problems} = await loadLambdas(config);
  assert.deepEqual(problems, []);
  for (const n of ['chat', 'job', 'task', 'write-lambda', 'formalize', 'chat-batch', 'extract-table', 'bulk-review', 'formalization-improve']) assert.ok(lambdas.has(n), n);
  assert.ok(validateParams(lambdas.get('formalize').params, {message: 'Is 7 prime?'}).ok);
  assert.ok(!validateParams(lambdas.get('chat-batch').params, {mode: 'nope'}).ok);
});
