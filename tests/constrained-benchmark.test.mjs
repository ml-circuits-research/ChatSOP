import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {main} from '../tools/eval/symbolic-vs-llm/run.mjs';

test('exploratory decoder variants cannot run on non-development inputs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'constrained-arm-guard-'));
  try {
    const manifest = path.join(dir, 'manifest.jsonl');
    fs.writeFileSync(manifest, JSON.stringify({id: 'unopened', family: 'f2', split: 'sealed', case_dir: 'never-opened'}) + '\n');
    for (const arm of ['B-grammar', 'B-structured']) {
      await assert.rejects(main(['--manifest', manifest, '--arms', arm]), /constrained authoring variants are dev-only/);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
