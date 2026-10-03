// ChatSOP's TinyAgent layer: config/tinyagent.json merges over the built-in defaults, names tiers only, and registers the project's
// skills (SkillPlugins of jobs/skills/, the job folders, the task templates) without a loading problem. No server, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLayers} from '../../TinyAgent/lib/config.mjs';
import {loadSkills, validateInputs} from '../../TinyAgent/lib/skills.mjs';
import {TINYAGENT_CONFIG} from '../../lib/tinyagent.mjs';

test('the project layer: tiers, local models, runner and skills', async () => {
  const {config, layers} = loadLayers({project: TINYAGENT_CONFIG, user: false, env: {}});
  assert.equal(layers.at(-1), TINYAGENT_CONFIG);
  for (const t of ['nano', 'micro', 'tiny', 'small', 'medium', 'good', 'best', 'structure', 'formalizer']) assert.ok(config.tiers[t], t);
  assert.equal(config.tiers.supertiny, 'micro');
  assert.ok(config.providers.local.start.gguf.endsWith('.gguf') && config.providers.local.start.startAtBoot);
  assert.ok(config.runner.dataDir.endsWith('state/llm-jobs'));
  const {skills, problems} = await loadSkills(config);
  assert.deepEqual(problems, []);
  for (const n of ['chat', 'job', 'task', 'write-plugin', 'formalize', 'chat-batch', 'extract-table', 'bulk-review', 'formalization-improve']) assert.ok(skills.has(n), n);
  assert.ok(validateInputs(skills.get('formalize').inputs, {message: 'Is 7 prime?'}).ok);
  assert.ok(!validateInputs(skills.get('chat-batch').inputs, {mode: 'nope'}).ok);
});
