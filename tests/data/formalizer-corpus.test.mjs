// The model-language corpora (DS022): formalizer-v1 (train/dev + sealed test) and the out-of-distribution suite
// formalizer-ood-v1. Structural invariants, manifests and rights, coverage of every family and question type,
// the corpus audit, no-copy, the vocabulary contract and execution against the verification worlds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {repoPath} from '../helpers.mjs';
import {corpusSkip, loadCorpus, assertSplitInvariants} from './corpus.mjs';
import {hashJsonlSharded, readJsonlShardedSync, shardPaths, REPOSITORY_FILE_LIMIT} from '../../lib/jsonl-shards.mjs';
import {parse} from '../../sop/parser.mjs';
import {checkModelProgram} from '../../sop/declarative.mjs';
import {manifestRights} from '../../tools/datasets/rights.mjs';
import {ALL_FAMILIES} from '../../tools/datasets/diversity/families-questions.mjs';
import {PREDICATES} from '../../tools/datasets/diversity/domains.mjs';
import {resolveDatasetPath} from '../../lib/dataset-paths.mjs';

const CORPUS = 'formalizer-v1', OOD = 'formalizer-ood-v1';
const skip = corpusSkip(CORPUS);
const manifest = () => JSON.parse(fs.readFileSync(repoPath(`datasets_archive/${CORPUS}/manifest.json`), 'utf8'));
const oodRows = () => readJsonlShardedSync(repoPath(`eval/suites/${OOD}/test.jsonl`));
const node = (...args) => spawnSync(process.execPath, args, {cwd: repoPath(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
export const QUESTION_TYPES = ['yes_no', 'wh', 'count', 'universal', 'when', 'since_when', 'until_when', 'how_long', 'how_many_times', 'where', 'why', 'how', 'claim_check', 'multi', 'numeric', 'none', 'unclear', 'ambiguous'];

test('split invariants: disjoint ids, groups inside one split, sane proportions, no file above 50 MB', {skip}, () => {
  const {bySplit} = loadCorpus(CORPUS);
  assertSplitInvariants(bySplit);
  for (const file of [`datasets_archive/${CORPUS}/train.jsonl`, `datasets_archive/${CORPUS}/dev.jsonl`, `eval/suites/${CORPUS}/test.jsonl`, `eval/suites/${OOD}/test.jsonl`])
    for (const part of shardPaths(repoPath(file))) assert.ok(fs.statSync(part).size < REPOSITORY_FILE_LIMIT, part);
});

test('manifests: logical-file checksums, rights fields and no training authorization', {skip}, async () => {
  const m = manifest();
  assert.equal(m.format, 'chatsop-corpus-manifest-v2');
  for (const [file, sha] of Object.entries(m.sha256)) assert.equal(await hashJsonlSharded(repoPath(resolveDatasetPath(file))), sha, file);
  assert.deepEqual(Object.keys(m.rights).sort(), Object.keys(manifestRights(['qqp'])).sort());
  assert.equal(m.rights.text_copied, false);
  assert.equal(m.training_authorized, false);
  assert.equal(m.review_status, 'not_reviewed');
  const ood = JSON.parse(fs.readFileSync(repoPath(`eval/suites/${OOD}/manifest.json`), 'utf8'));
  assert.equal(await hashJsonlSharded(repoPath(`eval/suites/${OOD}/test.jsonl`)), ood.sha256[`eval/suites/${OOD}/test.jsonl`]);
  // The shared verification world is recorded by checksum as well.
  for (const [file, sha] of Object.entries(m.shared_world.sha256)) assert.equal((await import('node:crypto')).createHash('sha256').update(fs.readFileSync(repoPath(resolveDatasetPath(file)))).digest('hex'), sha, file);
});

test('rows: the message is the only model input and every target is model language', {skip}, () => {
  const {rows} = loadCorpus(CORPUS);
  for (const row of [...rows, ...oodRows()]) {
    assert.ok(typeof row.question === 'string' && row.question.length > 0, row.id);
    assert.equal(row.prompt, undefined, `${row.id}: no stored prompt`);
    assert.equal(row.context, undefined, `${row.id}: no field named context; the scaffolding is verification_context`);
    assert.equal(row.verification_context?.model_visible, false, `${row.id}: verification_context is evaluation-only`);
    assert.equal(row.rights?.text_copied, false, row.id);
  }
  for (const row of rows.filter((_, index) => index % 7 === 0)) checkModelProgram(parse(row.sop_target));
});

test('coverage: every family and every question type in train, dev and the sealed test', {skip}, () => {
  const {bySplit} = loadCorpus(CORPUS);
  for (const [split, rows] of Object.entries(bySplit)) {
    const families = new Set(rows.map(row => row.family)), types = new Set(rows.map(row => row.question_type));
    for (const family of [...Object.keys(ALL_FAMILIES), 'unclear']) assert.ok(families.has(family), `${split}: family ${family}`);
    for (const type of QUESTION_TYPES) assert.ok(types.has(type), `${split}: question type ${type}`);
  }
  const report = JSON.parse(fs.readFileSync(repoPath(`datasets_archive/${CORPUS}/report.json`), 'utf8'))[CORPUS];
  assert.deepEqual(report.quota_violations, []);
  assert.equal(report.no_copy.pass, true);
});

test('the out-of-distribution suite: held-out domains on the domain axis, held-out constructions on the construction axis', {skip}, () => {
  const ood = new Set(Object.keys(PREDICATES).filter(id => PREDICATES[id].ood));
  const withHeldout = new Set(Object.keys(PREDICATES).filter(id => !PREDICATES[id].ood && ['en', 'ro'].every(l => PREDICATES[id][l].some(c => c.oodOnly))));
  const base = id => id.replace(/__converse$/, '');
  // `unclear` rows execute nothing; their placeholder world is not a domain of the suite.
  for (const row of oodRows().filter(item => item.family !== 'unclear')) for (const id of row.world?.predicates ?? []) {
    if (row.ood_axis === 'construction') assert.ok(!ood.has(base(id)), `${row.id}: ${id}`);
    else assert.ok(ood.has(base(id)), `${row.id}: ${id}`);
  }
  // The construction axis asks about predicates that have held-out constructions (the families may add world-only ones).
  assert.ok(oodRows().filter(row => row.ood_axis === 'construction' && row.family !== 'unclear').every(row => (row.world?.predicates ?? []).some(id => withHeldout.has(base(id)))));
  const {rows} = loadCorpus(CORPUS);
  for (const row of rows) for (const id of row.world?.predicates ?? []) assert.ok(!ood.has(base(id)), `${row.id} uses held-out ${id}`);
});

test('corpus audit: invariants hold and no error-severity check fails', {skip}, () => {
  for (const [name, extra] of [[CORPUS, []], [OOD, []]]) {
    const result = node('tools/datasets/audit-corpus.mjs', '--corpus', name, '--out', `eval/reports/current/corpus-audit/${name}.json`, ...extra);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /invariants: ok/);
    assert.match(result.stdout, /verdict: PASS/);
  }
});

test('no-copy: no row shares a copied span with any source', {skip}, () => {
  const result = node('tools/datasets/no-copy.mjs', '--files', [`datasets_archive/${CORPUS}/dev.jsonl`, `eval/suites/${CORPUS}/test.jsonl`, `eval/suites/${OOD}/test.jsonl`].join(','), '--name', `${CORPUS}-eval`);
  assert.equal(result.status, 0, result.stdout.slice(-2000) + result.stderr.slice(-2000));
});

test('vocabulary: every corpus program uses only the language contract', {skip}, () => {
  const result = node('tools/verify-vocabulary.mjs', '--scope', 'corpora');
  assert.equal(result.status, 0, result.stdout.slice(-3000) + result.stderr.slice(-2000));
});

test('execution: a stratified sample reproduces its expectations on the verification worlds', {skip}, () => {
  for (const args of [['--corpus', CORPUS, '--sample', '300'], ['--suite', OOD, '--sample', '120']]) {
    const result = node('tools/datasets/verify-corpus.mjs', ...args);
    assert.equal(result.status, 0, result.stdout.slice(-3000));
    const report = JSON.parse(result.stdout);
    assert.ok(report.executed > 0 && report.agreeing === report.executed, JSON.stringify(report.examples));
  }
});
