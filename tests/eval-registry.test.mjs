import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSourceBoundary } from '../eval/leakage.mjs';
import { audit, index, run, requireCompleteMatrix } from '../tools/eval/registry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'eval/registry/manifest.json';

test('generation and checkpoint selection source cannot import or read sealed answers', () => {
  const current = auditSourceBoundary(root);
  assert.deepEqual(current.violations, []);
  assert.deepEqual(current.observed_splits.filter(item => item.file === 'training/cli.mjs').map(item => item.splits), [['train','dev'], ['train','dev'], ['train','dev']]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-leakage-'));
  try {
    for (const file of current.files) {
      const dest = path.join(temp, file);
      fs.mkdirSync(path.dirname(dest), { recursive:true });
      fs.writeFileSync(dest, fs.readFileSync(path.join(root, file)));
    }
    const candidate = path.join(temp, 'tools/datasets/build-pilot.mjs');
    fs.appendFileSync(candidate, "\nconst leaked = fs.readFileSync('eval/suites/pilot-v1/test.jsonl');\n");
    assert(current.files.includes('tools/datasets/build-pilot.mjs'));
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('build-pilot.mjs') && message.includes('read')));
    fs.writeFileSync(candidate, "import answers from '../../eval/suites/pilot-v1/test.jsonl';\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('forbidden sealed-answer import')));
    fs.writeFileSync(candidate, "import answers from '../../datasets/pilot-v1/test.jsonl';\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('forbidden sealed-answer import') && message.includes('datasets/pilot-v1/test.jsonl')));
    fs.writeFileSync(candidate, "const leaked = fs.readFileSync('datasets/pilot-v1/test.jsonl');\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('build-pilot.mjs') && message.includes('read')));
    fs.writeFileSync(candidate, "const sealed = path.join('eval/suites/pilot-v1', 'test.jsonl');\nfs.readFileSync(sealed);\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('sealed-answer path variable read')));
    const selector = path.join(temp, 'training/cli.mjs');
    fs.writeFileSync(selector, "const answer = fs.readFileSync('datasets/pilot-v1/test.jsonl');\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('training/cli.mjs')));
    fs.writeFileSync(selector, fs.readFileSync(path.join(root, 'training/cli.mjs'), 'utf8').replace("dataset(o,['train','dev'])", "dataset(o,['train','test'])"));
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('unsafe dataset() split list')));
    fs.writeFileSync(path.join(temp, 'training/python/train.py'), "for split in ['train','test']: pass\n");
    assert(auditSourceBoundary(temp).violations.some(message => message.includes('unsafe Python split list')));
  } finally { fs.rmSync(temp, { recursive:true, force:true }); }
});

test('preflight reports missing predictions without reading sealed answers or producing an index', async () => {
  const relative = `eval/reports/current/registry-test-${process.pid}`;
  const folder = path.join(root, relative);
  try {
    const result = audit(manifest, `${relative}/leakage.json`);
    assert.equal(result.ready, false);
    assert.equal(result.cells.length, 2);
    assert(result.problems.some(message => message.includes('Missing predictions')));
    assert.equal(result.training_selection_guard_passed, true);
    assert(result.observed_training_selection_splits.some(item => item.file === 'training/python/train.py'));
    assert(result.dataset_local_test_paths.includes('datasets/seed/formalizer/test.jsonl'));
    assert(result.cells.find(cell => cell.split === 'test').suite_sha256 === null);
    assert(fs.existsSync(path.join(folder, 'leakage.json')));
    await assert.rejects(run(manifest, relative), /Preflight blocked/);
    assert.throws(() => index(manifest, relative), /Leakage preflight is blocked/);
    assert.equal(fs.existsSync(path.join(folder, 'index.json')), false);
  } finally { fs.rmSync(folder, { recursive:true, force:true }); }
});

test('an absent or duplicate matrix cell stops final indexing', () => {
  const cells = [{ id:'dev' }, { id:'test' }];
  assert.throws(() => requireCompleteMatrix(cells, [{ id:'dev' }]), /Missing or extra matrix cell/);
  assert.throws(() => requireCompleteMatrix(cells, [{ id:'dev' }, { id:'dev' }]), /Missing or extra matrix cell/);
  assert.doesNotThrow(() => requireCompleteMatrix(cells, [{ id:'test' }, { id:'dev' }]));
});
