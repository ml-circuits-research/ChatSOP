import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {adminServer, repoPath, tempDir, withEnv} from './helpers.mjs';
import {appendJournal} from '../lib/journal.mjs';
import {projectStatus} from '../server/project.mjs';
import {projectPage} from '../server/pages/project.mjs';
import {evaluationGuide, METRIC_DEFINITIONS} from '../server/eval-guide.mjs';
import {lineDiff, targetForm} from '../server/eval-browser.mjs';
import {SITE_MENU, renderSiteHeader, docsHeaderHtml} from '../server/pages/site-menu.mjs';
import {jsonlExists, readJsonlShardedSync} from '../lib/jsonl-shards.mjs';

const PASSWORD = 'correct horse battery';
const SUITE = 'formalizer-v1';
const skip = jsonlExists(repoPath(`eval/suites/${SUITE}/test.jsonl`)) ? false : `eval/suites/${SUITE} is absent`;
const serve = t => adminServer(t, {password: PASSWORD});
const htmlGet = (base, route) => fetch(base + route, {headers: {Accept: 'text/html'}, redirect: 'manual'});

test('signed-out browsers are sent to /login and API clients get 401 on /eval and /experiments', async t => {
  const {base, call} = await serve(t);
  for (const route of ['/eval', '/eval/guide', '/experiments', '/experiments/timeline', '/experiments/topics']) {
    const page = await htmlGet(base, route);
    assert.equal(page.status, 303, route);
    assert.equal(page.headers.get('location'), '/login?next=' + encodeURIComponent(route));
  }
  for (const route of ['/eval', '/eval/api/suites', `/eval/api/cases?suite=${SUITE}`, '/experiments', '/experiments/api/status', '/project/api/status']) {
    const response = await call(route);
    assert.equal(response.status, 401, route);
    assert.equal(response.body.error.code, 'unauthorized');
  }
  const execute = await call('/eval/api/execute', {method: 'POST', body: {suite: SUITE, id: 'x'}});
  assert.equal(execute.status, 401);
});

test('/eval API: suite tree, paginated rows and a row in full', {skip}, async t => {
  const {call, session} = await serve(t);
  const page = await call('/eval', {cookie: session});
  assert.equal(page.status, 200);
  assert.match(page.text, /id="panes"/);
  const index = await call('/eval/api/suites', {cookie: session});
  assert.equal(index.status, 200);
  const names = index.body.suites.map(entry => entry.suite);
  assert.ok(names.includes(SUITE));
  assert.ok(names.includes('formalizer-ood-v1'), 'the out-of-distribution suite is listed');
  assert.deepEqual(index.body.artifacts.map(group => group.group), ['predictions', 'registry', 'current', 'history']);
  assert.equal(index.body.artifacts.find(group => group.group === 'history').historical, true);

  const facets = await call(`/eval/api/facets?suite=${SUITE}`, {cookie: session});
  const rowsInSuite = readJsonlShardedSync(repoPath(`eval/suites/${SUITE}/test.jsonl`)).length;
  assert.equal(facets.body.rows, rowsInSuite);
  const track = facets.body.groups.find(group => group.key === 'track');
  assert.equal(Object.values(track.values).reduce((a, b) => a + b, 0), rowsInSuite);

  const first = await call(`/eval/api/cases?suite=${SUITE}&limit=10&page=1`, {cookie: session});
  assert.equal(first.body.total, rowsInSuite);
  assert.equal(first.body.items.length, Math.min(10, rowsInSuite));
  const second = await call(`/eval/api/cases?suite=${SUITE}&limit=10&page=2`, {cookie: session});
  assert.notEqual(second.body.items[0].id, first.body.items[0].id);
  const filtered = await call(`/eval/api/cases?suite=${SUITE}&language=en&limit=200`, {cookie: session});
  assert.ok(filtered.body.items.every(item => item.language === 'en'));

  const id = first.body.items[0].id;
  const detail = await call(`/eval/api/case?suite=${SUITE}&id=${encodeURIComponent(id)}`, {cookie: session});
  assert.equal(detail.status, 200);
  const row = readJsonlShardedSync(repoPath(`eval/suites/${SUITE}/test.jsonl`)).find(entry => entry.id === id);
  assert.equal(detail.body.target, row.sop_target ?? row.target);
  assert.equal(detail.body.message, [...(row.context_assertions ?? []), row.question].join('\n'));
  assert.deepEqual(detail.body.expected, row.expected ?? null);
  assert.ok(['current', 'legacy', 'undetermined'].includes(detail.body.form));
  assert.ok(detail.body.pipeline.length >= 6);
  for (const step of detail.body.pipeline) assert.match(step.cite.file, /^eval\//);
  // formalizer-v1 has gold-copy baseline predictions declared by a sidecar manifest.
  if (fs.existsSync(repoPath('eval/predictions/baseline-formalizer-test-formalization.jsonl'))) {
    assert.ok(detail.body.predictions.length >= 1);
    assert.ok(detail.body.predictions[0].diff.every(line => line.op === ' '), 'a gold copy has no diff');
  }
  assert.equal((await call(`/eval/api/case?suite=${SUITE}&id=no-such-row`, {cookie: session})).status, 400);
  assert.equal((await call('/eval/api/cases?suite=no-such-suite', {cookie: session})).status, 400);

  const artifacts = await call('/eval/api/artifacts?group=history', {cookie: session});
  assert.ok(artifacts.body.items.every(item => item.historical));
  if (artifacts.body.items.length) {
    const file = await call('/eval/api/artifact?path=' + encodeURIComponent(artifacts.body.items[0].path), {cookie: session});
    assert.equal(file.status, 200);
    assert.equal(file.body.historical, true);
  }
  assert.equal((await call('/eval/api/artifact?path=' + encodeURIComponent('../AGENTS.md'), {cookie: session})).status, 400, 'only indexed artifact files are served');

  const guide = await call('/eval/guide', {cookie: session});
  assert.equal(guide.status, 200);
  assert.match(guide.text, /How evaluation works/);
  assert.match(guide.text, /eval\/run\.mjs:\d+/);
});

test('the evaluation guide cites resolvable lines and documents every computed metric', () => {
  const guide = evaluationGuide();
  const cites = [...guide.sections.flatMap(section => section.claims.flatMap(claim => claim.cites)), ...guide.metrics.map(metric => metric.cite)];
  const missing = cites.filter(item => !item.found);
  // Anchors are text, not line numbers, so moved lines still resolve; a missing anchor means the claim went stale.
  assert.equal(missing.length, 0, 'unresolved anchors: ' + missing.map(item => item.file + ' ' + item.anchor).join('; '));
  const source = fs.readFileSync(repoPath('eval/metrics.mjs'), 'utf8');
  const computed = [...source.matchAll(/^\s{6}([a-z_]+): (?:rate|fraction)\(/gm)].map(match => match[1]);
  const documented = new Set(METRIC_DEFINITIONS.map(metric => metric.key.split('.').at(-1)));
  for (const name of computed) assert.ok(documented.has(name), `metric ${name} is not explained`);
});

test('line diff and target form', () => {
  assert.deepEqual(lineDiff('a\nb\n', 'a\nc\n'), [{op: ' ', line: 'a'}, {op: '-', line: 'b'}, {op: '+', line: 'c'}]);
  assert.equal(targetForm({sop_target: '@q query\n  where parent ana maria\n'}), 'legacy');
  assert.equal(targetForm({sop_target: '@p premise\n  holds parent ana maria\n'}), 'legacy');
  assert.equal(targetForm({sop_target: '@s stated\n  relation "work at"\n'}), 'current');
  assert.equal(targetForm({sop_target: '@q query\n  where match\n    relation "x"\n  end\n'}), 'current');
  assert.equal(targetForm({sop_target: '@c constraint\n  claim ?x > 5\n'}), 'undetermined');
});

test('/experiments/timeline renders from a fixture journal and experiment registry', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'journal.jsonl');
  appendJournal({ts: '2026-09-28T08:00:00Z', area: 'data', actor: 'a', title: 'Older data event', detail: '', links: [], state: 'done'}, {file});
  appendJournal({ts: '2026-09-28T09:00:00Z', area: 'language', actor: 'owner', title: 'Newer decision', detail: 'd', links: ['AGENTS.md'], state: 'decision'}, {file});
  fs.writeFileSync(path.join(dir, 'experiments.json'), JSON.stringify({format: 'chatsop-experiments-v1', experiments: [{id: 'exp-a', hypothesis: 'h', preregistration: 'docs/specs/DS010-experiment-preregistration.md', data_version: 'v0', status: 'proposed', results: null, conclusions: null}]}));
  const status = projectStatus({dir});
  assert.deepEqual(status.journal.map(event => event.title), ['Newer decision', 'Older data event']);
  assert.deepEqual(projectStatus({dir, area: 'data'}).journal.map(event => event.title), ['Older data event']);
  assert.equal(status.experiments[0].id, 'exp-a');
  const approval = status.gates.find(gate => gate.id === 'owner-approval');
  assert.equal(approval.open, false);
  assert.equal(approval.prohibited, true);
  assert.match(approval.evidence, /prohibits training/);
  assert.ok(status.pipeline.length > 0);
  for (const entry of status.pipeline) assert.ok(['current', 'legacy', 'mixed', 'unknown'].includes(entry.form), entry.corpus);
  assert.match(projectPage(), /Training: PROHIBITED/);

  const {call, session} = await withEnv('CHATSOP_STATUS_DIR', dir, () => serve(t));
  const page = await call('/experiments/timeline', {cookie: session});
  assert.equal(page.status, 200);
  assert.match(page.text, /Timeline &amp; live status/);
  assert.match(page.text, /\/experiments\/api\/status/);
  const api = await withEnv('CHATSOP_STATUS_DIR', dir, () => call('/experiments/api/status?area=language', {cookie: session}));
  assert.equal(api.status, 200);
  assert.deepEqual(api.body.journal.map(event => event.title), ['Newer decision']);
  assert.ok(api.body.gates.some(gate => gate.id === 'owner-approval' && gate.prohibited));
});

test('the docs header and the server layout render the same menu from one source', async t => {
  const docs = fs.readFileSync(repoPath('docs/partials/header.html'), 'utf8');
  assert.equal(docs, docsHeaderHtml(), 'docs/partials/header.html is generated by node tools/site-menu.mjs --write');
  const entries = html => [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>|<summary>([^<]+)<\/summary>/g)]
    .map(match => (match[3] ? ['menu', match[3]] : [new URL(match[1], 'http://host/docs/').pathname + new URL(match[1], 'http://host/docs/').search, match[2]]));
  const {call, session} = await serve(t);
  for (const route of ['/', '/chat', '/audit', '/eval', '/experiments', '/experiments/topics', '/admin']) {
    const page = await call(route, {cookie: session});
    assert.equal(page.status, 200, route);
    const header = /<header class="site-header">[\s\S]*?<\/header>/.exec(page.text)[0];
    assert.deepEqual(entries(header), entries(docs), route);
    assert.match(header, /action="\/logout"/);
  }
  const labels = entries(docs).map(([, text]) => text);
  assert.deepEqual(labels, ['Home', 'Chat', 'Audit', 'Eval', 'Experiments', 'Index: tasks &amp; experiments', 'Topics', 'Reports', 'Timeline &amp; live status', 'Open questions', 'Admin', 'Docs', 'Overview', 'Runtime', 'Training', 'Wiki', 'Specifications', 'Wire help', 'How the model writes', 'Question types']);
  assert.equal(SITE_MENU.length, 7);
  assert.match(renderSiteHeader({account: 'signin', next: '/eval'}), /\/login\?next=%2Feval/);
  const asset = await call('/assets/sop-code.mjs');
  assert.equal(asset.status, 200, 'the docs SOP highlighter is public');
  assert.match(asset.text, /export const render=/);
});
