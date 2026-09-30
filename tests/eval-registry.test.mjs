import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSourceBoundary } from '../eval/leakage.mjs';
import { audit, index, run, requireCompleteMatrix } from '../tools/eval/registry.mjs';
import { readJsonl, repoUrl } from './helpers.mjs';

const root = fileURLToPath(repoUrl());
const manifest = 'eval/registry/manifest.json';
const baseline = 'eval/registry/baseline.json';

/**
 * The registry accepts only repository-relative report folders (it refuses
 * absolute paths and symlinks that escape the checkout), so each test gets a
 * unique mkdtemp folder under the git-ignored eval/reports/current/ and
 * removes it afterwards.
 */
function reportFolder(t, name) {
  const parent = path.join(root, 'eval/reports/current');
  fs.mkdirSync(parent, { recursive: true });
  const folder = fs.mkdtempSync(path.join(parent, `registry-test-${name}-`));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return { folder, relative: path.relative(root, folder) };
}

test('generation and checkpoint selection source cannot import or read sealed answers', () => {
  const current = auditSourceBoundary(root);
  assert.deepEqual(current.violations, []);
  const selection = current.observed_splits.filter(item => item.file === 'training/cli.mjs');
  assert.ok(selection.length > 0, 'training/cli.mjs dataset() callsites are observed');
  assert.ok(selection.every(item => item.splits.join(',') === 'train,dev'), 'every selection callsite reads only train and dev');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-leakage-'));
  try {
    for (const file of current.files) {
      const dest = path.join(temp, file);
      fs.mkdirSync(path.dirname(dest), { recursive:true });
      fs.writeFileSync(dest, fs.readFileSync(path.join(root, file)));
    }
    const candidate = path.join(temp, 'tools/datasets/build-corpora.mjs');
    fs.appendFileSync(candidate, "\nconst leaked = fs.readFileSync('eval/suites/formalizer-v1/test.jsonl');\n");
    assert(current.files.includes('tools/datasets/build-corpora.mjs'));
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('build-corpora.mjs') && message.includes('read')));
    fs.writeFileSync(candidate, "import answers from '../../eval/suites/formalizer-v1/test.jsonl';\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('forbidden sealed-answer import')));
    fs.writeFileSync(candidate, "import answers from '../../datasets_archive/formalizer-v1/test.jsonl';\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('forbidden sealed-answer import') && message.includes('datasets_archive/formalizer-v1/test.jsonl')));
    fs.writeFileSync(candidate, "const leaked = fs.readFileSync('datasets_archive/formalizer-v1/test.jsonl');\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('build-corpora.mjs') && message.includes('read')));
    fs.writeFileSync(candidate, "const sealed = path.join('eval/suites/formalizer-v1', 'test.jsonl');\nfs.readFileSync(sealed);\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('sealed-answer path variable read')));
    const selector = path.join(temp, 'training/cli.mjs');
    fs.writeFileSync(selector, "const answer = fs.readFileSync('datasets_archive/formalizer-v1/test.jsonl');\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('training/cli.mjs')));
    fs.writeFileSync(selector, "const safe = dataset(o,['train','dev']);\nconst unsafe = dataset(o,['train','dev','test'].slice(0,2));\nconst leaked = dataset(o,['train','t'+'est']);\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('unsafe dataset() split list')));
    fs.writeFileSync(selector, "export const noSelection = true;\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('missing dataset() callsites')));
    fs.writeFileSync(path.join(temp, 'training/python/train.py'), "for split in ['train','test']: pass\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('unsafe Python split list')));
  } finally { fs.rmSync(temp, { recursive:true, force:true }); }
});

test('preflight reports missing predictions without reading sealed answers or producing an index', async t => {
  const { folder, relative } = reportFolder(t, 'preflight');
  {
    const result = audit(manifest, `${relative}/leakage.json`);
    assert.equal(result.ready, false);
    assert.equal(result.cells.length, 2);
    assert(result.problems.some(message => message.includes('Missing predictions')));
    assert.equal(result.training_selection_guard_passed, true);
    assert(result.observed_training_selection_splits.some(item => item.file === 'training/python/train.py'));
    assert.deepEqual(result.dataset_local_test_paths, [], 'no test.jsonl is kept under datasets/ (AGENTS.md rule 9)');
    assert(result.cells.find(cell => cell.split === 'test').suite_sha256 === null);
    assert(fs.existsSync(path.join(folder, 'leakage.json')));
    await assert.rejects(run(manifest, relative), /Preflight blocked/);
    assert.throws(() => index(manifest, relative), /Leakage preflight is blocked/);
    assert.equal(fs.existsSync(path.join(folder, 'index.json')), false);
  }
});

test('a ready baseline audit still cannot index a missing matrix cell', t => {
  const { folder, relative } = reportFolder(t, 'missing');
  {
    const result = audit(baseline, `${relative}/leakage.json`);
    assert.equal(result.ready, true);
    assert.equal(result.training_selection_guard_passed, true);
    assert.equal(result.cells.length, 2);
    assert(result.cells.every(cell => cell.baseline_provenance.sha256));
    assert.throws(() => index(baseline, relative), /Missing cell baseline-formalizer-dev-formalization/);
    assert.equal(fs.existsSync(path.join(folder, 'index.json')), false);
  }
  const cells = [{ id:'dev' }, { id:'test' }];
  assert.throws(() => requireCompleteMatrix(cells, [{ id:'dev' }]), /Missing or extra matrix cell/);
  assert.doesNotThrow(() => requireCompleteMatrix(cells, [{ id:'test' }, { id:'dev' }]));
});

// The full dev-then-test baseline matrix (about 10,000 executed rows) runs with the heavy data tests: tests/data/registry-baseline.test.mjs.

