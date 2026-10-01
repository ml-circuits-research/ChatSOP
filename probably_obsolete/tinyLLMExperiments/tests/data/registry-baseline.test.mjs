// The labeled gold-copy baseline matrix over the whole formalizer-v1 dev and sealed test (tools/eval/registry.mjs,
// DS008). Heavy (about 10,000 executed rows), so it runs with `npm run test:data`, not with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, index, run } from '../../tools/eval/registry.mjs';
import { readJsonl, repoUrl } from '../helpers.mjs';
import { resolveDatasetPath } from '../../lib/dataset-paths.mjs';

const root = fileURLToPath(repoUrl());
const baseline = 'eval/registry/baseline.json';
function reportFolder(t, name) {
  const parent = path.join(root, 'eval/reports/current');
  fs.mkdirSync(parent, { recursive: true });
  const folder = fs.mkdtempSync(path.join(parent, `registry-test-${name}-`));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return { folder, relative: path.relative(root, folder) };
}

test('labeled baseline records a complete dev-then-test matrix without model attribution', {timeout: 600000}, async t => {
  const { relative } = reportFolder(t, 'complete');
  {
    assert.equal(audit(baseline, `${relative}/leakage.json`).ready, true);
    const result = await run(baseline, relative);
    assert.equal(result.predictor_identity, 'deterministic-baseline-gold-copy');
    assert.deepEqual(result.cells.map(cell => cell.split), ['dev', 'test']);
    const suites = JSON.parse(fs.readFileSync(repoUrl(baseline), 'utf8')).cells.map(cell => readJsonl(repoUrl(resolveDatasetPath(cell.suite))).length);
    assert.deepEqual(result.cells.map(cell => cell.metrics.rows), suites);
    assert(result.cells.every(cell => cell.metrics.execution_equivalence.numerator === cell.metrics.rows));
    assert(result.cells.every(cell => JSON.parse(fs.readFileSync(path.join(root, cell.report), 'utf8')).model_identity_verified === false));
    assert.equal(index(baseline, relative).cells.length, 2);
  }
});
