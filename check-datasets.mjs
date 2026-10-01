#!/usr/bin/env node
/** High-level dataset verification entry point. All implementation lives in tools/datasets/.
 *
 *   node check-datasets.mjs [--audit-strict] [--no-audit]
 *
 * Child processes run with the repository root as working directory, so the repo-relative artifact paths below
 * resolve the same way from any invoking directory.
 *
 * Part 1 verifies every model-language corpus and suite manifest with tools/datasets/verify-corpus.mjs (fail-closed). Part 2 runs the corpus audit
 * (`tools/datasets/audit-corpus.mjs`, procedure in `skills/corpus-audit/SKILL.md`) on every corpus with
 * train/dev splits and refreshes `eval/reports/current/corpus-audit/<corpus>.json`. The audit runs in report
 * mode (`--fail-on none`) while the known-defective corpora are regenerated: its findings, including invariant
 * violations, are printed but do not change the exit code. `--audit-strict` applies the default `--fail-on errors`
 * and lets any audit failure fail the run.
 */
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {jsonlExists} from './lib/jsonl-shards.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const flags = new Set(process.argv.slice(2));
const run = (file, args) => {
  const script = path.resolve(root, 'tools/datasets', file);
  const result = spawnSync(process.execPath, [script, ...args], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exitCode = result.status ?? 1;
    return false;
  }
  return true;
};

// Part 1: every model-language corpus (datasets/<corpus>/manifest.json, format chatsop-corpus-manifest-v2) and every
// suite with its own manifest (eval/suites/<suite>/manifest.json, for example the out-of-distribution suite) is
// verified by tools/datasets/verify-corpus.mjs: checksums, row shape, model-language targets, split groups, and
// execution of a stratified sample against the rows' verification worlds.
// The corpora live in `datasets_archive/` (legacy formalizer corpora, provenance inputs) and, since the owner decision of
// 2026-09-30, `datasets/` holds only bad_english, symbolic_english and neuro_english (manifest format
// chatsop-dataset-manifest-v3, verified by tools/datasets/verify-three-datasets.mjs instead).
// Archived corpora that are not formalizer corpora and that verify-corpus.mjs cannot check (found while restructuring datasets/,
// 2026-09-30; before that they were already failing this part): each is reported as SKIP with its reason, never silently.
const NOT_VERIFIABLE_HERE = {
  'clean-english': 'a filtered view of formalizer-v1 and the sealed suites (its sealed test holds wild rows, which have no split groups); its rows are verified in their source corpora',
  proofing: 'proofing schema (input/target rows, not question/SOP rows); verified by tools/research/qualify-proofing.mjs',
};
const manifests = (dir, flag) => fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir), {withFileTypes: true})
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, dir, entry.name, 'manifest.json')))
  .filter(entry => flag !== '--corpus' || !NOT_VERIFIABLE_HERE[entry.name])
  .filter(entry => { try { return JSON.parse(fs.readFileSync(path.join(root, dir, entry.name, 'manifest.json'), 'utf8')).format === 'chatsop-corpus-manifest-v2'; } catch { return false; } })
  .map(entry => [`${flag === '--corpus' ? 'corpus' : 'suite'} ${entry.name} (manifest, rows, targets, execution sample)`, ['verify-corpus.mjs', flag, entry.name]]) : [];
const checks = [...manifests('datasets', '--corpus'), ...manifests('datasets_archive', '--corpus'), ...manifests('eval/suites', '--suite')];
if (fs.existsSync(path.join(root, 'tools/datasets/verify-three-datasets.mjs'))) checks.push(['the three datasets (manifests, hashes, schema, splits, sealed boundary)', ['verify-three-datasets.mjs']]);
let ok = true;
for (const [name, reason] of Object.entries(NOT_VERIFIABLE_HERE)) if (fs.existsSync(path.join(root, 'datasets_archive', name, 'manifest.json'))) console.log(`SKIP  corpus ${name}: ${reason}`);
for (const [label, args] of checks) {
  const passed = run(...[args[0], args.slice(1)]);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
  ok &&= passed;
}

// Content-word overlap of the sealed tests with train/dev (DS008 "Content-word overlap"): a report here (numbers printed, file
// eval/reports/current/three-datasets/content-word-overlap.json); its fail-closed part is enforced by verify-three-datasets.mjs above.
if (fs.existsSync(path.join(root, 'tools/datasets/audit/content-word-overlap.mjs'))) {
  const result = spawnSync(process.execPath, [path.join(root, 'tools/datasets/audit/content-word-overlap.mjs')], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  console.log(`${result.status === 0 ? 'PASS' : 'FLAG'}  content-word overlap (report; lexical duplicates fail verify-three-datasets)`);
  for (const line of (result.stdout ?? '').split('\n').filter(Boolean)) console.log(`        ${line}`);
}

// Part 2: corpus audit in report mode (see the header). Corpora are discovered from their train/dev splits.
if (!flags.has('--no-audit')) {
  const corpora = ['datasets', 'datasets_archive'].filter(dir => fs.existsSync(path.join(root, dir))).flatMap(dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true})
    .filter(entry => entry.isDirectory() && ['train.jsonl', 'dev.jsonl'].some(file => jsonlExists(path.join(root, dir, entry.name, file))))
    .filter(entry => { try { return !['chatsop-dataset-manifest-v3', 'chatsop-legacy-resplit-v1'].includes(JSON.parse(fs.readFileSync(path.join(root, dir, entry.name, 'manifest.json'), 'utf8')).format); } catch { return true; } }) // the re-split parts of the legacy suites (tools/eval/legacy-resplit.mjs) are verified through the three datasets
    .map(entry => entry.name)).sort();
  for (const corpus of corpora) {
    const script = path.join(root, 'tools/datasets/audit-corpus.mjs');
    const result = spawnSync(process.execPath, [script, '--corpus', corpus, '--fail-on', flags.has('--audit-strict') ? 'errors' : 'none'], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    const summary = result.stdout ?? '';
    const invariants = /^invariants: (.*)$/m.exec(summary)?.[1] ?? 'not reported';
    const faithfulness = /^faithfulness errors: (\S+)/m.exec(summary)?.[1] ?? 'n/a';
    const over = (summary.match(/^ {2}(?:ERROR|WARNING|FAIL)\s+\S+/gm) ?? []).length;
    const passed = result.status === 0;
    const label = passed ? (over ? 'FLAG' : 'PASS') : 'FAIL';
    console.log(`${label}  corpus audit ${corpus}: invariants ${invariants}; faithfulness errors ${faithfulness}; ${over} check(s) over threshold${flags.has('--audit-strict') ? '' : ' (report mode)'}`);
    if (!passed && result.status !== 1) console.error(result.stderr || summary);
    if (!passed && flags.has('--audit-strict')) ok = false;
  }
  console.log('Corpus audit reports: eval/reports/current/corpus-audit/<corpus>.json (procedure: skills/corpus-audit/SKILL.md)');
}
if (!ok) process.exitCode = 1;
if (!ok) console.error('\nOne or more dataset checks failed. Fix the generator, never the rows, then rebuild:\n  node tools/datasets/build-corpora.mjs');
