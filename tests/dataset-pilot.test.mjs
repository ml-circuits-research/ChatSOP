import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPilot, writePilot, RESERVED_STRUCTURES } from '../tools/datasets/build-pilot.mjs';
import { validateRecord, validateCorpus } from '../tools/datasets/schema.mjs';
import { executeCorpus, validateManifest } from '../tools/datasets/validate.mjs';

const corpus = () => buildPilot({ worlds: 10, seed: 41 });
test('fixed seed reproduces cases while another seed changes worlds, not split safety', () => {
  const rows = corpus();
  assert.deepEqual(rows, corpus());
  assert.notDeepEqual(rows, buildPilot({ worlds: 10, seed: 42 }));
  const summary = validateCorpus(rows, { reservedStructures: RESERVED_STRUCTURES });
  assert.equal(summary.semantic_cases, 60);
  assert.equal(rows.filter(row => row.language === 'ro').length, 10);
  assert.ok(rows.some(row => row.expected.status === 'refuted'));
  assert.ok(rows.some(row => row.expected.status === 'unknown'));
  assert.ok(rows.some(row => row.expected.status === 'clarify'));
  assert.ok(rows.some(row => row.split === 'test' && row.structure_id === 'two-hop-ground'));
});

test('semantic variants cannot change answers; negative links stay paired and discriminated', () => {
  const rows = corpus();
  const anchor = rows.find(row => row.split === 'train' && row.structure_id === 'direct-ground' && row.language === 'en');
  const variant = rows.find(row => row.semantic_case_id === anchor.semantic_case_id && row.language === 'ro');
  assert.equal(variant.sop_target, anchor.sop_target);
  assert.deepEqual(variant.expected, anchor.expected);
  const inverse = rows.find(row => row.split_group_id === anchor.split_group_id && row.structure_id === 'direct-inverse');
  assert.equal(inverse.negative_of, anchor.semantic_case_id);
  assert.equal(anchor.expected.status, 'supported');
  assert.equal(inverse.expected.status, 'unknown');
  assert.throws(() => validateCorpus(rows.map(row => row.id === inverse.id ? { ...row, negative_of: 'missing' } : row)), /negative_of/);
  assert.throws(() => validateCorpus(rows.map(row => row.id === variant.id ? { ...row, expected: { status: 'unknown', answers: [] } } : row)), /inconsistent/);
});

test('source tampering, duplicate semantic identity, and train holdout leakage fail closed', () => {
  const rows = corpus();
  assert.throws(() => validateRecord({ ...rows[0], context_assertions: ['fabricated'] }), /checksum/);
  assert.throws(() => validateCorpus([...rows, { ...rows[0], id: 'duplicate_surface' }]), /Duplicate row|duplicate semantic/);
  const heldout = rows.find(row => row.structure_id === 'two-hop-ground');
  assert.throws(() => validateCorpus(rows.map(row => row.split_group_id === heldout.split_group_id ? { ...row, split: 'train' } : row), { reservedStructures: RESERVED_STRUCTURES }), /Reserved structure/);
});

test('sealed manifest audits checksums, export correspondence and crosssplit leakage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-contract-'));
  try {
    const out = path.join(root, 'development'), evalOut = path.join(root, 'sealed');
    writePilot({ out, evalOut, worlds: 10, seed: 41 });
    const file = path.join(out, 'manifest.json');
    assert.equal(validateManifest(file).summary.semantic_cases, 60);
    fs.appendFileSync(path.join(evalOut, 'test.jsonl'), '{}\n');
    assert.throws(() => validateManifest(file), /checksum mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real runtime checks graph-derived refutations, composition, and answer tuples', async () => {
  const rows = corpus();
  const train = rows.find(row => row.split === 'train').split_group_id;
  const testWorld = rows.find(row => row.split === 'test').split_group_id;
  const selected = rows.filter(row => row.split_group_id === train || row.split_group_id === testWorld);
  assert.deepEqual(await executeCorpus(selected), { executed: selected.length, status: 'verified_against_runtime' });
  const anchor = selected.find(row => row.structure_id === 'direct-ground' && row.language === 'en');
  const corrupted = { ...anchor, expected: { status: 'refuted', answers: [] } };
  await assert.rejects(executeCorpus([corrupted]), /graph oracle status mismatch/);
});
