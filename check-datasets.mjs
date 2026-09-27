#!/usr/bin/env node
/** High-level dataset verification entry point. All implementation lives in tools/datasets/. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const run = (file, args) => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tools/datasets', file);
  const result = spawnSync(process.execPath, [script, ...args], {encoding: 'utf8'});
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exitCode = result.status ?? 1;
    return false;
  }
  return true;
};

const checks = [
  ['query curriculum (compiled corpus, manifests, authoring MD tree, executable oracles)', ['validate.mjs', '--manifest', 'datasets/query-v1/manifest.json', '--execute']],
  ['historical pilot corpus', ['validate.mjs', '--manifest', 'datasets/pilot-v1/manifest.json', '--execute']],
  ['sealed SQuAD source reference', ['validate.mjs', '--file', 'eval/suites/source-reference-v2.jsonl', '--execute']],
  ['authoring MD tree up to date', ['build-cases-md.mjs', '--check']],
];
let ok = true;
for (const [label, args] of checks) {
  const passed = run(...[args[0], args.slice(1)]);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
  ok &&= passed;
}
if (!ok) console.error('\nOne or more dataset checks failed. To regenerate after editing tools/datasets/curriculum/cases.mjs:\n  node tools/datasets/build-cases-md.mjs && node tools/datasets/build-curriculum.mjs');
