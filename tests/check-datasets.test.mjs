import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readJsonl, repoPath, tempDir} from './helpers.mjs';

// check-datasets.mjs orchestrates tools/datasets/verify-corpus.mjs over every model-language corpus and suite
// manifest. Running the real verifier executes thousands of targets, so the entry point is copied into a scratch
// project whose verify-corpus.mjs is a recording stub and whose manifests are two tiny fixtures: the test checks
// the orchestration contract of the verification part (every manifest is checked, a failure is reported by name
// and yields a non-zero exit status), not the verifier. The report-mode corpus audit (part 2) is disabled with
// --no-audit; tools/datasets/audit-corpus.mjs and verify-corpus.mjs have their own tests.
const STUB = `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CHECK_LOG, JSON.stringify(args) + '\\n');
const target = args[args.indexOf('--corpus') + 1 || args.indexOf('--suite') + 1];
if (target === process.env.CHECK_FAIL) { console.error('corrupted fixture: ' + target); process.exit(3); }
`;
const MANIFEST = JSON.stringify({format: 'chatsop-corpus-manifest-v2'});

function scratch(t) {
  const root = tempDir(t, 'check-datasets-');
  fs.copyFileSync(repoPath('check-datasets.mjs'), path.join(root, 'check-datasets.mjs'));
  // check-datasets.mjs discovers corpora through the shard-aware JSONL helpers.
  fs.mkdirSync(path.join(root, 'lib'), {recursive: true});
  fs.copyFileSync(repoPath('lib/jsonl-shards.mjs'), path.join(root, 'lib/jsonl-shards.mjs'));
  fs.mkdirSync(path.join(root, 'tools/datasets'), {recursive: true});
  fs.writeFileSync(path.join(root, 'tools/datasets/verify-corpus.mjs'), STUB);
  for (const dir of ['datasets/fixture-v1', 'eval/suites/fixture-ood-v1']) { fs.mkdirSync(path.join(root, dir), {recursive: true}); fs.writeFileSync(path.join(root, dir, 'manifest.json'), MANIFEST); }
  // A directory without a v2 manifest is not a corpus and is never checked.
  fs.mkdirSync(path.join(root, 'eval/suites/notes'), {recursive: true});
  const log = path.join(root, 'calls.jsonl');
  const run = (fail = '') => {
    fs.rmSync(log, {force: true});
    const result = spawnSync(process.execPath, [path.join(root, 'check-datasets.mjs'), '--no-audit'], {cwd: root, encoding: 'utf8', env: {...process.env, CHECK_LOG: log, CHECK_FAIL: fail}});
    return {...result, calls: fs.existsSync(log) ? readJsonl(log) : []};
  };
  return run;
}

test('every dataset check runs and passes when each validator succeeds', t => {
  const run = scratch(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n').filter(line => /^(PASS|FAIL|FLAG) /.test(line));
  assert.ok(lines.length > 0);
  assert.ok(lines.every(line => line.startsWith('PASS  ')), result.stdout);
  assert.equal(result.calls.length, lines.length, 'one validator invocation per reported check');
  assert.deepEqual(result.calls, [['--corpus', 'fixture-v1'], ['--suite', 'fixture-ood-v1']]);
  assert.doesNotMatch(result.stderr, /One or more dataset checks failed/);
});

test('a corrupted corpus fails its named check, the remaining checks still run, and the exit status is non-zero', t => {
  const run = scratch(t);
  const all = run().calls.length;
  const result = run('fixture-v1');
  assert.notEqual(result.status, 0, 'a failed validator fails the run');
  assert.match(result.stdout, /^FAIL {2}corpus fixture-v1 /m);
  assert.equal(result.stdout.match(/^FAIL /gm).length, 1);
  assert.equal(result.calls.length, all, 'checks after the failure still run');
  assert.match(result.stderr, /corrupted fixture: fixture-v1/);
  assert.match(result.stderr, /One or more dataset checks failed/);
});
