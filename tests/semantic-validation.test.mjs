import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPilot } from '../tools/datasets/build-pilot.mjs';
import { sha256, validateRecord, validateCorpus } from '../tools/datasets/schema.mjs';
import { executeCorpus } from '../tools/datasets/validate.mjs';
import { alphaCanonical, compareCircuits } from '../tools/datasets/semantic-compare.mjs';
import { prepareReview, recordReview, decideReview } from '../skills/semantic-sop-review/review.mjs';

const sample = structure => {
  const pilot = buildPilot({ worlds: 10, seed: 41 });
  const old = pilot.find(row => row.structure_id === structure && row.language === 'en' && row.split === 'train');
  const text = old.context_assertions.join('\n') + '\n';
  return {
    ...old, input_mode: 'query_only', source: { id: old.source.id, kind: 'synthetic_curriculum', uri: `synthetic://test/${old.source.id}`, revision: old.source.revision, sha256: sha256(text), license: null, content: text },
    sop_target: old.sop_target + '\n@spoken cnl\n  result $answer\n',
    generation_trace: { method: 'author', template: null, model: null, review_status: 'unreviewed' },
  };
};

test('multiple genuine English surfaces share a target, while reused surfaces and divergent gold are rejected', () => {
  const row = sample('direct-ground');
  const equivalent = row.sop_target.replace('@q query', '@lookup query').replace('$q', '$lookup').replace('parent(', 'parent( ');
  const second = { ...row, id: row.id + '_different', question: `Please check: ${row.question}`, sop_target: equivalent };
  assert.equal(validateCorpus([row, second]).semantic_cases, 1);
  assert.throws(() => validateCorpus([row, { ...second, question: row.question }]), /duplicate semantic surface/);
  assert.throws(() => validateCorpus([row, { ...second, expected: { status: 'unknown' } }]), /inconsistent/);
  assert.throws(() => validateRecord({ ...row, source: { ...row.source, content: 'tampered' } }), /checksum/);
  assert.throws(() => validateRecord({ ...row, sop_target: row.sop_target.replace('  result $answer', '  result $missing') }), /invalid sop_target/);
});

test('structure changes need semantic adjudication; syntax-only negatives cannot qualify', () => {
  const row = sample('direct-ground');
  const renamed = row.sop_target.replace('@q query', '@lookup query').replace('$q', '$lookup');
  const negative = { ...row, id: row.id + '_negative', semantic_case_id: row.semantic_case_id + '_negative', negative_of: row.semantic_case_id, question: 'A different question', context_assertions: [...row.context_assertions, 'Please check the same claim.'], sop_target: renamed };
  assert.throws(() => validateCorpus([row, negative]), /negative does not discriminate/);
  const variant = { ...row, id: row.id + '_variant', question: 'Is the reverse relation true?', sop_target: row.sop_target.replace(/parent\(([^,]+), ([^)]+)\)/, 'parent($2, $1)') };
  assert.throws(() => validateCorpus([row, variant]), /requires semantic adjudication/);
});

test('identical query against distinct source worlds is not a duplicate semantic case', () => {
  const row = sample('direct-ground');
  const otherId = row.source.id + '_other';
  const content = row.source.content + 'Unrelated independent observation.\n';
  const second = { ...row, id: row.id + '_other', semantic_case_id: row.semantic_case_id + '_other', source: { ...row.source, id: otherId, uri: `synthetic://test/${otherId}`, content, sha256: sha256(content) }, setup_sop: row.setup_sop.replaceAll(`source ${row.source.id}`, `source ${otherId}`), question: 'Check in the independently sourced world.' };
  assert.equal(validateCorpus([row, second]).semantic_cases, 2);
});

test('production gold validation executes the guarded evaluator and keeps qualification pending', async () => {
  const report = await executeCorpus([sample('direct-ground')]);
  assert.deepEqual(report, { executed: 1, status: 'verified_against_runtime', qualification: 'not_reviewed' });
});

test('same-status contrast can differ by answer binding; numeric and structured oracles are valid', () => {
  const row = sample('direct-select');
  const other = { ...row, id: `${row.id}_negative`, semantic_case_id: `${row.semantic_case_id}_negative`, question: 'Who is a parent of the other person?', negative_of: row.semantic_case_id, sop_target: row.sop_target.replace(/parent\(\?who, [^)]+\)/, `parent(?who, ${row.context.entities[1].id})`), expected: { status: 'supported', answers: [[row.context.entities[0].id]] } };
  assert.equal(validateCorpus([row, other]).semantic_cases, 2);
  assert.equal(validateRecord({ ...row, expected: { status: 'supported', answers: [[17, { result: true }]], outputs: { duration: 35.5, rows: [{ value: 1 }] }, packet: { complete: true } } }).id, row.id);
});

test('local wire alpha-renaming never rewrites approved external definition handles', () => {
  const suffix = '@query query\n  where parent(ana, bogdan)\n@answer solve\n  query $query\n  data ~reviewed';
  const collision = `@reviewed value\n  data 1\n${suffix}`;
  const harmlessLocalRename = `@other value\n  data 1\n${suffix}`;
  const changedHandle = `@other value\n  data 1\n${suffix.replace('~reviewed', '~other')}`;
  assert.equal(alphaCanonical(collision), alphaCanonical(harmlessLocalRename));
  assert.notEqual(alphaCanonical(collision), alphaCanonical(changedHandle));
});

test('alternate wire IDs and spacing are safe but a deceptive same-status wrong binding is a counterexample', async () => {
  const row = sample('direct-select');
  const equivalent = row.sop_target.replace('@q query', '@lookup query').replace(/\$q\b/g, '$lookup').replace('@answer solve', '@computed solve').replace(/\$answer\b/g, '$computed').replace('@spoken cnl', '@display cnl').replace(/parent\(\?who, /g, 'parent(?who,');
  const good = await compareCircuits(row, equivalent);
  assert.equal(good.verdict, 'equivalent');
  assert.equal(good.canonical_match, true);
  const other = row.sop_target.replace(/parent\(\?who, [^)]+\)/, `parent(?who, ${row.context.entities[1].id})`);
  const bad = await compareCircuits(row, other);
  assert.equal(bad.probes[0].gold_status, 'supported');
  assert.equal(bad.probes[0].predicted_status, 'supported');
  assert.equal(bad.verdict, 'counterexample');
});

test('a supplied counterexample world overrides same baseline status, and a bad gold setup is not a model error', async () => {
  const row = sample('direct-ground');
  const reference = `parent(${row.context.entities[0].id}, ${row.context.entities[3].id})`;
  const candidateAtom = `parent(${row.context.entities[0].id}, ${row.context.entities[0].id})`;
  const caseRow = { ...row, sop_target: row.sop_target.replace(/parent\([^)]+\)/, reference), expected: { status: 'unknown', answers: [] } };
  const wrong = row.sop_target.replace(/parent\([^)]+\)/, candidateAtom);
  const probe = { setup_sop: `${row.setup_sop}\n@counterexample fact\n  holds ${reference}\n  valid timeless\n  source probe\n  quote "Independent probe"\n`, expected: { status: 'supported', answers: [[]] } };
  const result = await compareCircuits(caseRow, wrong, { probes: [probe] });
  assert.equal(result.verdict, 'counterexample');
  assert.equal(result.probes[0].gold_status, 'unknown');
  assert.equal(result.probes[1].gold_status, 'supported');
  const invalid = await compareCircuits(caseRow, wrong, { probes: [{ setup_sop: '@broken fact\n  holds parent(a, b)\n  valid invalid\n', expected: { status: 'unknown' } }] });
  assert.equal(invalid.verdict, 'reference_error');
});

test('review CLI is portable across working directories and never overwrites an immutable bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-cli-'));
  try {
    const row = sample('direct-ground');
    const candidate = row.sop_target.replace('@q query', '@renamed query').replace('$q', '$renamed');
    fs.writeFileSync(path.join(root, 'case.json'), JSON.stringify(row));
    fs.writeFileSync(path.join(root, 'candidate.sop'), candidate);
    const script = path.resolve('skills/semantic-sop-review/review.mjs');
    const flags = [script, 'prepare', '--project-root', root, '--row', 'case.json', '--candidate', 'candidate.sop', '--bundle', 'bundle.json'];
    const result = JSON.parse(execFileSync(process.execPath, flags, { cwd: os.tmpdir(), encoding: 'utf8' }));
    assert.equal(result.verdict, 'equivalent');
    assert.throws(() => execFileSync(process.execPath, flags, { cwd: os.tmpdir(), stdio: 'pipe' }), /EEXIST/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('finite equal-world differences stay quarantined; review hashes and a separate principal are mandatory', async () => {
  const row = sample('direct-ground');
  const candidate = row.sop_target.replace(/parent\([^)]+\)/, `parent(${row.context.entities[0].id}, ${row.context.entities[0].id})`);
  const pendingRow = { ...row, sop_target: row.sop_target.replace(/parent\([^)]+\)/, `parent(${row.context.entities[0].id}, ${row.context.entities[3].id})`), expected: { status: 'unknown', answers: [] } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-review-'));
  try {
    const bundle = path.join(root, 'bundle.json'), review = path.join(root, 'review.json'), receipt = path.join(root, 'receipt.json'), decision = path.join(root, 'decision.json'), output = path.join(root, 'final.json');
    const prepared = await prepareReview({ row: pendingRow, candidate, bundle, projectRoot: root });
    assert.equal(prepared.verdict, 'pending');
    const b = JSON.parse(fs.readFileSync(bundle, 'utf8'));
    assert.equal(b.comparison.probes[0].gold_status, 'unknown');
    // This is disposable protocol-test input, not evidence that a reviewer was called.
    const evidence = { reviewer_kind: 'llm', model: { provider: 'protocol-test-only-no-call', id: 'nonexistent-test-fixture', version: 'fixture' }, reviewer_identity: 'synthetic-test-reviewer', verdict: 'equivalent', rationale: 'Fixture tests receipt binding; this is not a real semantic review.', bundle_sha256: prepared.bundle_sha256, prompt_sha256: b.prompt_sha256, context_sha256: b.context_sha256, reference_sha256: b.reference_sha256, candidate_sha256: b.candidate_sha256 };
    fs.writeFileSync(review, JSON.stringify({ ...evidence, candidate_sha256: 'wrong' }));
    assert.throws(() => recordReview({ bundle, review, receipt }), /not bound/);
    fs.writeFileSync(review, JSON.stringify(evidence));
    const receiptHash = recordReview({ bundle, review, receipt }).receipt_sha256;
    fs.writeFileSync(decision, JSON.stringify({ principal_identity: 'synthetic-test-reviewer', verdict: 'accept', rationale: 'Claimed signoff.', bundle_sha256: prepared.bundle_sha256, receipt_sha256: receiptHash }));
    assert.throws(() => decideReview({ bundle, receipt, decision, output }), /self-certify/);
    fs.writeFileSync(decision, JSON.stringify({ principal_identity: 'separate-integrator', verdict: 'quarantine', rationale: 'No discriminating world supplied.', bundle_sha256: prepared.bundle_sha256, receipt_sha256: receiptHash }));
    assert.ok(decideReview({ bundle, receipt, decision, output }).decision_sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
