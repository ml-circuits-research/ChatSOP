import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {adminServer, readJsonl, repoUrl} from '../helpers.mjs';
import {corpusSkip, splitFiles} from './corpus.mjs';
import {SOP_CONTRACT, renderSopHtml, sopCodeScript} from '../../server/pages/sop-code.mjs';
import {barePrompt} from '../../server/llm.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';

// The audit loads every corpus under datasets/ and eval/suites/; these tests
// use the model-language corpus formalizer-v1 (DS022) and skip when it is absent.
const CORPUS = 'formalizer-v1';
const skip = corpusSkip(CORPUS);
const serve = t => adminServer(t, {password: 'correct horse battery'});
const splitRows = file => readJsonlShardedSync(new URL(file, repoUrl()).pathname);
const expectedRows = () => Object.values(splitFiles(CORPUS)).reduce((sum, file) => sum + splitRows(file).length, 0);
/** The first case IDs as the audit itself lists them (case IDs, not row IDs). */
const firstIds = async (call, session, count) => (await call(`/audit/api/cases?corpus=${CORPUS}&limit=${count}`, {cookie: session})).body.items.map(item => item.id);

test('the audit lives on the same server as the documentation, admin and chat', {skip}, async t => {
  const {call} = await serve(t);
  const page = await call('/audit', {cookie: null});
  assert.equal(page.status, 401, 'the audit page is not public');
  const docs = await call('/docs/index.html');
  assert.equal(docs.status, 200);
});

test('corpus summaries match the published split files', {skip}, async t => {
  const {call, session} = await serve(t);
  const page = await call('/audit', {cookie: session});
  assert.equal(page.status, 200);
  assert.match(page.text, /Corpus audit/);
  const corpora = await call('/audit/api/corpora', {cookie: session});
  assert.equal(corpora.status, 200);
  const names = corpora.body.map(entry => entry.corpus);
  assert.equal(new Set(names).size, names.length, 'each corpus is listed once');
  assert.ok(names.includes(CORPUS));
  for (const entry of corpora.body) {
    assert.ok(entry.rows > 0, entry.corpus);
    assert.equal(Object.values(entry.splits).reduce((a, b) => a + b, 0), entry.rows, entry.corpus);
    assert.match(entry.fingerprint, /^[a-f0-9]{64}$/, entry.corpus);
  }
  const proof = corpora.body.find(entry => entry.corpus === CORPUS);
  assert.equal(proof.rows, expectedRows());
  assert.ok(proof.splits.train > 0 && proof.splits.test > 0);
  assert.equal(proof.reviewed, 0);
});

test('the audit requires the administrator session', {skip}, async t => {
  const {call, base} = await serve(t);
  assert.equal((await call('/audit/api/corpora')).status, 401);
  assert.equal((await call('/audit')).status, 401);
  // A signed-out browser page load is sent to the login page instead.
  const browser = await fetch(base + '/audit', {headers: {Accept: 'text/html'}, redirect: 'manual'});
  assert.equal(browser.status, 303);
  assert.equal(browser.headers.get('location'), '/login?next=%2Faudit');
  const api = await fetch(base + '/audit/api/corpora', {headers: {Accept: 'text/html'}, redirect: 'manual'});
  assert.equal(api.status, 401, 'audit API calls are never redirected');
});

test('case listing, filtering and the detail view expose the reviewable fields', {skip}, async t => {
  const {call, session} = await serve(t);
  const get = route => call(route, {cookie: session});
  const page = await get(`/audit/api/cases?corpus=${CORPUS}&limit=5`);
  assert.equal(page.body.items.length, 5);
  assert.ok(page.body.total > 0 && page.body.total <= expectedRows(), 'every case groups at least one row');
  const romanian = await get(`/audit/api/cases?corpus=${CORPUS}&language=ro&limit=3`);
  assert.ok(romanian.body.items.length > 0);
  assert.ok(romanian.body.items.every(item => item.language === 'ro'));
  const [id] = await firstIds(call, session, 1);
  const detail = await get(`/audit/api/case?corpus=${CORPUS}&id=${id}`);
  assert.equal(detail.body.id, id);
  assert.match(detail.body.target, /@\w+ query/);
  assert.ok(detail.body.scaffold.predicates.length >= 1, 'the case carries its evaluation-only verification vocabulary');
  // Text search finds a case by a word of its own question.
  const word = detail.body.rows[0].question.match(/\p{L}{6,}/u)?.[0];
  if (word) assert.ok((await get(`/audit/api/cases?corpus=${CORPUS}&q=${encodeURIComponent(word)}&limit=5`)).body.total > 0, `text search for ${word}`);
});

test('facets count every case once per category and match the paginated totals', {skip}, async t => {
  const {call, session} = await serve(t);
  const get = route => call(route, {cookie: session});
  const facets = (await get(`/audit/api/facets?corpus=${CORPUS}`)).body;
  const all = await get(`/audit/api/cases?corpus=${CORPUS}&limit=50`);
  assert.equal(facets.cases, all.body.total);
  assert.equal(facets.rows, expectedRows());
  assert.deepEqual(facets.groups.map(group => group.key), ['split', 'family', 'language', 'question_type', 'input_mode', 'review', 'theme', 'status', 'verdict']);
  const group = key => facets.groups.find(entry => entry.key === key).values;
  // Single-valued categories partition the cases; a fresh ledger leaves every case unreviewed.
  for (const key of ['family', 'question_type', 'input_mode', 'review', 'status', 'verdict']) assert.equal(Object.values(group(key)).reduce((a, b) => a + b, 0), facets.cases, key);
  assert.equal(group('verdict').unreviewed, facets.cases);
  // A facet count is exactly the total of the list filtered by that value.
  const [family, count] = Object.entries(group('family'))[0];
  const filtered = await get(`/audit/api/cases?corpus=${CORPUS}&family=${encodeURIComponent(family)}&limit=50`);
  assert.equal(filtered.body.total, count);
  assert.equal(filtered.body.pages, Math.ceil(count / 50));
  assert.ok(filtered.body.items.every(item => item.family === family));
  const test = await get(`/audit/api/cases?corpus=${CORPUS}&split=test&limit=50`);
  assert.equal(test.body.total, group('split').test);
  // Pages are server-side: page 2 continues page 1, and `around` finds the page holding a case.
  assert.equal(all.body.page, 1);
  assert.equal(all.body.pages, Math.ceil(all.body.total / 50));
  const second = await get(`/audit/api/cases?corpus=${CORPUS}&limit=50&page=2`);
  assert.equal(second.body.offset, 50);
  assert.notEqual(second.body.items[0].id, all.body.items[0].id);
  const target = second.body.items[7].id;
  const around = await get(`/audit/api/cases?corpus=${CORPUS}&limit=50&around=${encodeURIComponent(target)}`);
  assert.equal(around.body.page, 2);
  assert.equal(around.body.index, 57);
  assert.ok(around.body.items.some(item => item.id === target));
});

test('the case detail carries the full message, audit findings, history and raw rows', {skip}, async t => {
  const {call, session} = await serve(t);
  const [id] = await firstIds(call, session, 1);
  const detail = (await call(`/audit/api/case?corpus=${CORPUS}&id=${id}`, {cookie: session})).body;
  const rows = Object.values(splitFiles(CORPUS)).flatMap(splitRows).filter(row => (row.semantic_case_id ?? row.id) === id);
  assert.deepEqual(detail.raw, rows, 'raw JSON is the unmodified rows');
  assert.equal(detail.rows[0].message.endsWith(rows[0].question), true, 'the message is never truncated');
  // The shown prompt is exactly the training prompt built by tools/research/prepare-experiment.mjs: the message.
  assert.equal(detail.rows[0].prompt, barePrompt(rows[0].question));
  assert.equal(detail.rows[0].prompt, rows[0].question);
  assert.doesNotMatch(detail.rows[0].prompt, /setup_sop|ontology_sop|"expected"/, 'verification scaffolding never enters the prompt');
  assert.ok(detail.scaffold.predicates.length >= 1);
  assert.match(detail.ontology, /predicate/, 'the shared predicate declarations are assembled for review');
  assert.deepEqual(detail.history, []);
  assert.ok(['all_rows', 'report_examples', 'none'].includes(detail.audit.coverage));
  assert.ok(Array.isArray(detail.audit.findings));
  const page = await call('/audit', {cookie: session});
  assert.match(page.text, /window\.ChatSopCode=/, 'the page ships the shared SOP renderer');
  assert.match(page.text, /What the model sees: the user message only/);
  assert.match(page.text, /Verification only: NOT shown to the model/);
  assert.doesNotMatch(page.text, /Trusted setup|Case ontology|Expected result and oracle/);
});

test('shared SOP rendering links contract types and fields and flags undocumented ones', () => {
  assert.ok(SOP_CONTRACT.query.includes('where'));
  const html = renderSopHtml('@q query\n  where parent ?x "Ana"\n  invented 1\n@z madeup\n  foo bar\n');
  assert.match(html, /<a class="sop-type" href="\/docs\/wire_typs\/query\.html" target="_blank" rel="noopener"/);
  assert.match(html, /href="\/docs\/wire_typs\/query\.html#field-where" target="_blank" rel="noopener"/);
  assert.match(html, /<span class="sop-undoc"[^>]*>invented<\/span>/);
  assert.match(html, /<span class="sop-undoc"[^>]*>madeup<\/span>/);
  assert.match(html, /<span class="sop-var">\?x<\/span>/);
  assert.match(html, /<span class="sop-str">&quot;Ana&quot;<\/span>/);
  // Condition-group closers are grammar, not fields.
  assert.doesNotMatch(renderSopHtml('@r rule\n  when all\n    a ?x\n  end\n  then b ?x\n'), /sop-undoc/);
  // The browser copy renders exactly what the server renders.
  const scope = {};
  new Function('window', sopCodeScript)(scope);
  assert.equal(scope.ChatSopCode.render('@q query\n  where p ?x\n'), renderSopHtml('@q query\n  where p ?x\n'));
});

test('executing a gold reports agreement with the stored expectation', {skip}, async t => {
  const {call, session} = await serve(t);
  const [id] = await firstIds(call, session, 1);
  const execution = await call('/audit/api/execute', {method: 'POST', cookie: session, body: {corpus: CORPUS, id}});
  assert.equal(execution.status, 200);
  assert.ok(execution.body.rows.length >= 1);
  for (const row of execution.body.rows) assert.equal(row.matches, true, `${row.id}: ${row.status} vs ${row.expectedStatus}`);
  assert.equal(execution.body.allMatch, true);
  const missing = await call('/audit/api/execute', {method: 'POST', cookie: session, body: {corpus: CORPUS, id: 'does-not-exist'}});
  assert.equal(missing.status, 400);
});

test('verdicts are appended to the temporary ledger, never to eval/reports/current/audit', {skip}, async t => {
  const repositoryLedger = repoUrl(`eval/reports/current/audit/${CORPUS}.jsonl`);
  const before = fs.existsSync(repositoryLedger) ? fs.readFileSync(repositoryLedger) : null;
  const {call, session, ledger} = await serve(t);
  const post = body => call('/audit/api/verdict', {method: 'POST', cookie: session, body});
  const [, caseId, other] = await firstIds(call, session, 3);
  const record = await post({corpus: CORPUS, caseId, verdict: 'needs_fix', note: 'target reads oddly'});
  assert.equal(record.status, 200);
  assert.match(record.body.targetSha256, /^[a-f0-9]{64}$/);
  const lines = readJsonl(path.join(ledger, `${CORPUS}.jsonl`));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].note, 'target reads oddly');
  const filtered = await call(`/audit/api/cases?corpus=${CORPUS}&reviewed=needs_fix&limit=5`, {cookie: session});
  assert.deepEqual(filtered.body.items.map(item => item.id), [caseId]);
  const detail = await call(`/audit/api/case?corpus=${CORPUS}&id=${caseId}`, {cookie: session});
  assert.equal(detail.body.verdict.verdict, 'needs_fix');
  await post({corpus: CORPUS, caseId, verdict: 'reject'});
  const summary = (await call('/audit/api/corpora', {cookie: session})).body.find(entry => entry.corpus === CORPUS);
  assert.equal(summary.reviewed, 1);
  assert.equal(summary.rejected, 1);
  const history = (await call(`/audit/api/case?corpus=${CORPUS}&id=${caseId}`, {cookie: session})).body.history;
  assert.deepEqual(history.map(entry => entry.verdict), ['needs_fix', 'reject'], 'the detail shows the whole verdict history');
  const verdicts = (await call(`/audit/api/facets?corpus=${CORPUS}`, {cookie: session})).body.groups.find(group => group.key === 'verdict').values;
  assert.equal(verdicts.reject, 1, 'verdict counts follow the ledger');
  const invalid = await post({corpus: CORPUS, caseId: other, verdict: 'maybe'});
  assert.equal(invalid.status, 400);
  const after = fs.existsSync(repositoryLedger) ? fs.readFileSync(repositoryLedger) : null;
  assert.deepEqual(after, before, 'the repository audit ledger is untouched');
});
