// LLMJobs (the self-contained job runner) as part of npm test, plus ChatSOP's job library: the jobs, templates and plugins under jobs/.
import '../LLMJobs/test/runner.test.mjs';
import '../LLMJobs/test/task.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig, loadJob, loadTemplates, validatePlan, tierChains} from '../LLMJobs/lib/index.mjs';
import * as sopCheck from '../jobs/plugins/sop-check.mjs';
import * as extractChecks from '../jobs/templates/extract-table/checks.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const JOBS = path.join(ROOT, 'jobs');

test('ChatSOP job library: the config names tiers only, every job and prompt template loads, the planner catalog validates', async () => {
  const config = loadConfig({jobDir: JOBS, env: {}});
  assert.equal(config.file, path.join(JOBS, 'llmjobs.config.json'));
  assert.equal(config.dataDir, path.join(ROOT, 'state', 'llm-jobs'), 'run state stays in the gitignored state/ folder');
  assert.deepEqual(config.roles, {planner: 'good', decider: 'good', auditor: 'medium', worker: 'small', 'worker-short': 'tiny'});
  for (const name of fs.readdirSync(JOBS).filter(n => fs.existsSync(path.join(JOBS, n, 'job.json')))) {
    const spec = JSON.parse(fs.readFileSync(path.join(JOBS, name, 'job.json'), 'utf8'));
    assert.ok(typeof spec.models === 'string' || spec.ladder, `${name}: names a tier or role, not a concrete model`);
    const job = await loadJob(path.join(JOBS, name), {config});
    assert.equal(job.spec.name, name);
  }
  const templates = loadTemplates(config.templatesDir);
  assert.deepEqual(Object.keys(templates).sort(), ['analyze-document', 'bulk-review', 'extract-table', 'ingest-document', 'label-entities']);
  const samples = {'analyze-document': {rights: 'owner-provided'}, 'extract-table': {columns: ['product', 'price']}, 'label-entities': {labels: ['person', 'date']}, 'ingest-document': {rights: 'cleared'}, 'bulk-review': {review_kind: 'knowledge-wires'}};
  for (const t of Object.values(templates)) {
    const v = validatePlan({template: t.name, params: samples[t.name]}, {templates, target: t.targets[0], limits: config.limits, tiers: Object.keys(tierChains(config))});
    assert.ok(v.ok, `${t.name}: ${v.problems.join('; ')}`);
    if (t.kind === 'prompt') {
      const job = await loadJob(t.dir, {params: v.plan.params, config});
      assert.ok(job.spec.ladderChains.length >= 2);
    } else assert.ok(fs.existsSync(path.join(t.dir, t.adapter)));
  }
});

test('ChatSOP plugins: the SOP check runs the knowledge validator and the quote check; extract-table grounds every value in its quote', () => {
  const PRED = '@works_in predicate\n  args subject:entity object:entity\n  description "where a person works"\n';
  const item = {text: 'Ann works in the Workshop.'};
  assert.ok(sopCheck.check(item, sopCheck.parse(`${PRED}\n@f1 fact\n  holds works_in ann workshop\n  quote "Ann works in the Workshop."\n`)).ok);
  const bad = sopCheck.check(item, sopCheck.parse(`${PRED}\n@f1 fact\n  holds works_in ann workshop\n  quote "Ann works in the Workshops."\n`));
  assert.ok(!bad.ok && bad.problems.some(p => p.startsWith('quote_not_in_source')));
  assert.ok(!sopCheck.check(item, sopCheck.parse('@f1 fact\n  holds\n')).ok, 'the validator rejects a broken program');
  const text = 'Apples cost 3 EUR per kilo.';
  const ctx = {params: {columns: ['product', 'price']}};
  assert.ok(extractChecks.check({text}, {records: [{record: {product: 'Apples', price: '3 EUR'}, quote: 'Apples cost 3 EUR per kilo.'}]}, ctx).ok);
  const v = extractChecks.check({text}, {records: [{record: {product: 'Apples', price: '4 EUR'}, quote: 'Apples cost 3 EUR per kilo.'}]}, ctx);
  assert.ok(!v.ok && /price/.test(v.problems[0]));
});
