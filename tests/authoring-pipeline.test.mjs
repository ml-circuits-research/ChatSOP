import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCurriculum } from '../tools/datasets/build-curriculum.mjs';
import { caseDocument } from '../tools/datasets/build-cases-md.mjs';
import { compileCase, parseCaseMd } from '../tools/datasets/authoring/compile-case.mjs';
import { validateAuthoringRecord, validateCorpus, validateFamilyStructureIsolation } from '../tools/datasets/schema.mjs';

const rows = buildCurriculum();
const selected = rows.filter(row => row.semantic_case_id === 'parent_forward');
const original = caseDocument(selected, 'parent_forward');

function tempCase(t, content, family = 'relation_role', id = 'parent_forward') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-authoring-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, family, `${id}.md`);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, content);
  return { dir, file, out: path.join(dir, 'compiled.jsonl') };
}

test('edited Markdown rebuilds case JSONL, revalidates oracle and regenerates byte-identically', async t => {
  const edited = original.replace('Is Ana a parent of Bogdan?', 'Is Ana recorded as a parent of Bogdan?');
  const options = tempCase(t, edited);
  const result = await compileCase({ ...options, rows });
  const rebuilt = fs.readFileSync(options.out, 'utf8');
  assert.equal(result.rows, selected.length);
  assert.equal(result.oracle, 'verified_against_runtime');
  const compiled = rebuilt.trimEnd().split('\n').map(JSON.parse);
  assert.equal(compiled[0].question, 'Is Ana recorded as a parent of Bogdan?');
  assert.equal(caseDocument(compiled, result.case_id), edited);
  assert.equal((await compileCase({ ...options, rows })).jsonl, rebuilt);
  for (const row of compiled) {
    validateAuthoringRecord(row, edited);
    assert.equal(row.generation_trace.review_status, 'synthetic_unreviewed');
    assert.equal(row.authoring.review_status, 'integrator-authored-not-human-validated');
  }
});

test('unknown metadata and malformed oracle fail closed before writing', async t => {
  for (const corrupt of [original.replace('- split: train', '- split: test'), original.replace('- answers: `[[]]`', '- answers: `not-json`'), original.replace('## Expected (independent oracle', '## Expectation (independent oracle')]) {
    const options = tempCase(t, corrupt);
    await assert.rejects(compileCase({ ...options, rows }));
    assert.equal(fs.existsSync(options.out), false);
  }
});

test('parse pass cannot approve a case and oracle disagreement is rejected', async t => {
  const changed = original.replace('- status: `"supported"`', '- status: `"refuted"`');
  const options = tempCase(t, changed);
  await assert.rejects(compileCase({ ...options, rows }), /independent oracle mismatch/);
  assert.equal(fs.existsSync(options.out), false);
  const compiled = parseCaseMd(original, selected, 'parent_forward');
  compiled[0].generation_trace = { ...compiled[0].generation_trace, review_status: 'approved' };
  assert.throws(() => validateAuthoringRecord(compiled[0], original), /parse pass is not semantic review/);
});

test('attached assertions and paired contrast compile without weakening the corpus invariant', async t => {
  for (const id of ['assert_positive', 'parent_reversed']) {
    const baseline = rows.filter(row => row.semantic_case_id === id);
    const family = baseline[0].matrix.family_id;
    const edited = caseDocument(baseline, id).replace(baseline[0].question, `${baseline[0].question} Please use these records.`);
    const options = tempCase(t, edited, family, id);
    const result = await compileCase({ ...options, rows });
    assert.equal(result.oracle, 'verified_against_runtime');
    assert.equal(caseDocument(result.jsonl.trimEnd().split('\n').map(JSON.parse), id), edited);
  }
});

test('connected semantic groups stay within split; optional family/structure isolation exposes actual reuse', () => {
  assert.equal(validateCorpus(rows).rows, rows.length);
  const crossed = [{ ...selected[0], id: 'crossed_surface', language: 'ro', question: 'Este Ana părintele lui Bogdan?', split: 'test', context: { ...selected[0].context, language: 'ro' } }];
  assert.throws(() => validateCorpus([...selected, ...crossed]), /split_group_id leaks across splits|semantic case inconsistent/);
  assert.throws(() => validateFamilyStructureIsolation(rows), /Advisory family\/structure components cross splits/);
});
