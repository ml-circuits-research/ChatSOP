import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCurriculum, writeCurriculum } from '../tools/datasets/build-curriculum.mjs';
import { validateCorpus } from '../tools/datasets/schema.mjs';
import { executeCorpus, validateManifest } from '../tools/datasets/validate.mjs';
import { measureCoverage } from '../tools/datasets/coverage.mjs';

const row = (rows, id) => rows.find(item => item.semantic_case_id === id && item.language === 'en');

test('connected natural-language contrasts preserve role, polarity, time and quantification', () => {
  const rows = buildCurriculum();
  validateCorpus(rows);
  for (const [good, contrast, first, second] of [
    ['parent_forward','parent_reversed','supported','unknown'],
    ['works_vs_employed','employed_not_implied','supported','unknown'],
    ['time_last_day','time_end','supported','refuted'],
    ['time_asof_early','time_asof_late','unknown','supported'],
    ['finite_possible','finite_not_entailed','possible','unknown'],
    ['test_chain','test_reversed_chain','supported','unknown'],
    ['assert_positive','assert_reverse','supported','unknown'],
  ]) {
    const anchor = row(rows, good), negative = row(rows, contrast);
    assert.equal(anchor.expected.status, first, good);
    assert.equal(negative.expected.status, second, contrast);
    assert.equal(negative.negative_of, anchor.semantic_case_id);
    assert.equal(negative.split_group_id, anchor.split_group_id);
    assert.notEqual(negative.sop_target, anchor.sop_target);
  }
  assert.deepEqual(row(rows,'parent_inverse_select').expected.answers, [['maria'],['bogdan']].sort());
  assert.equal(row(rows,'conflicted_parent').expected.status,'both');
  assert.equal(row(rows,'conflict_no_explosion').expected.status,'unknown');
  assert.equal(row(rows,'finite_many').expected.packet.outputProjection['?x'].status,'ambiguous');
});


test('renamed training copies invalidate claimed composition and lexical holdouts', () => {
  const rows = buildCurriculum();
  const held = row(rows, 'join_pairs');
  const clone = { ...held, id:'contaminant', semantic_case_id:'contaminant', split_group_id:'contaminant', split:'train', sop_target:held.sop_target.replaceAll('?older','?ancestor').replaceAll('?younger','?descendant'), matrix:{...held.matrix, holdout:null} };
  const original = measureCoverage(rows).holdouts.find(item => item.case_id === 'join_pairs');
  assert.equal(original.pass, true);
  const contaminated = measureCoverage([...rows, clone]).holdouts.find(item => item.case_id === 'join_pairs');
  assert.equal(contaminated.pass, false);
  const bank = row(rows, 'ambiguous_bank');
  const lexicalClone = { ...bank, id:'lexical-copy', semantic_case_id:'lexical-copy', split_group_id:'lexical-copy', split:'train', matrix:{...bank.matrix, holdout:null} };
  assert.equal(measureCoverage([...rows, lexicalClone]).holdouts.find(item => item.case_id === 'ambiguous_bank').pass, false);
});

test('sealed development export cannot expose or mutate held-out test rows', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'query-curriculum-'));
  try {
    const out = path.join(directory,'development'), evalOut = path.join(directory,'sealed');
    assert.throws(() => writeCurriculum({ out, evalOut:path.join(out,'sealed') }), /disjoint/);
    fs.mkdirSync(evalOut);
    const alias = path.join(directory,'alias-to-sealed');
    fs.symlinkSync(evalOut,alias,'dir');
    assert.throws(() => writeCurriculum({ out:alias, evalOut }), /disjoint/);
    const { manifest } = writeCurriculum({ out, evalOut });
    assert.ok(Object.keys(manifest.files).every(name => !name.includes('test')));
    assert.equal(fs.existsSync(path.join(out,'test.jsonl')),false);
    assert.equal(validateManifest(path.join(out,'manifest.json')).summary.rows,buildCurriculum().length);
    fs.appendFileSync(path.join(evalOut,'test.jsonl'),'{}\n');
    assert.throws(() => validateManifest(path.join(out,'manifest.json')), /checksum mismatch/);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('runtime agrees with independent oracles across logical, temporal, numeric, synonyms and session writes', async () => {
  const rows = buildCurriculum();
  const ids = ['test_join_pairs','conflicted_parent','time_last_day','time_end','time_asof_early','parent_forward','negative_explicit','negative_assertion_direct','finite_unique','finite_many','assert_conflict','assert_only','resolved_romanian_lab','route_expression','route_approved_procedure'];
  const selected = ids.map(id => row(rows,id));
  const result = await executeCorpus(selected);
  assert.equal(result.executed, selected.length);
  assert.equal(result.status,'verified_against_runtime');
  assert.equal(result.qualification,'not_reviewed');
  const corrupted = { ...selected[0], expected:{...selected[0].expected,answers:[['ana','ana']]} };
  await assert.rejects(executeCorpus([corrupted]), /oracle|answers|reference error/i);
});
