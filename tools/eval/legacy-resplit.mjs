#!/usr/bin/env node
/** Re-split of the legacy OOD and wild suites across train, dev and test of the three datasets (auditor side; owner decision 2026-09-30, DS008 "Form coverage and form variants").
 *
 *   node tools/eval/legacy-resplit.mjs [--dry]
 *
 * The two legacy suites (eval/suites/formalizer-ood-v1, eval/suites/formalizer-wild-v1) stay where they are as archive and provenance and are no longer reported as suites.
 * Their rows are split by split group with the rule of tools/datasets/three-datasets/legacy-split.mjs (70% train, 15% dev, 15% test, fixed seed). This tool
 * writes the train and dev parts into datasets_archive/legacy-resplit/<suite>/{train,dev}.jsonl (a folder one level below the legacy corpora, so the corpus audit does not mistake it for a corpus whose test overlaps its train; the builders read them; generators never read
 * eval/suites, AGENTS.md rule 9) and a manifest with the counts and sha256; the test part is read back from the legacy files by tools/eval/three-datasets-suites.mjs
 * through `legacyTestRows()`. The re-split is deterministic, so running it twice gives the same files.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {readJsonlShardedSync, writeJsonlShardedSync, hashJsonlSharded} from '../../lib/jsonl-shards.mjs';
import {legacySplitOf, LEGACY_PROPORTIONS, LEGACY_SPLIT_SEED} from '../datasets/three-datasets/legacy-split.mjs';

export const LEGACY = Object.freeze({'formalizer-ood-v1': 'eval/suites/formalizer-ood-v1/test.jsonl', 'formalizer-wild-v1': 'eval/suites/formalizer-wild-v1/test.jsonl'});
export const WILD = Object.freeze({'formalizer-ood-v1': false, 'formalizer-wild-v1': true});

/** `{corpus: {train: rows, dev: rows, test: rows}}` of the legacy suites. */
export function legacySplit(root = ROOT) {
  const out = {};
  for (const [corpus, file] of Object.entries(LEGACY)) {
    out[corpus] = {train: [], dev: [], test: []};
    for (const row of readJsonlShardedSync(path.join(root, file))) out[corpus][legacySplitOf(row, corpus)].push(row);
  }
  return out;
}

/** The test part of a legacy suite (for the sealed-suite builder). */
export const legacyTestRows = (corpus, root = ROOT) => legacySplit(root)[corpus].test;

async function main() {
  const dry = process.argv.includes('--dry');
  const parts = legacySplit();
  for (const [corpus, split] of Object.entries(parts)) {
    const counts = Object.fromEntries(Object.entries(split).map(([k, v]) => [k, v.length]));
    console.log(`${corpus}: ${JSON.stringify(counts)}`);
    if (dry) continue;
    const dir = path.join(ROOT, 'datasets_archive', 'legacy-resplit', corpus);
    fs.mkdirSync(dir, {recursive: true});
    const manifest = {format: 'chatsop-legacy-resplit-v1', corpus, wild: WILD[corpus], note: 'Train and dev parts of a legacy suite, split by split group (DS008 "Form coverage and form variants"); the test part stays in the legacy suite file and is read by tools/eval/three-datasets-suites.mjs.', source: LEGACY[corpus], seed: LEGACY_SPLIT_SEED, proportions: LEGACY_PROPORTIONS, counts, sha256: {}, source_sha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, LEGACY[corpus]))).digest('hex')};
    for (const s of ['train', 'dev']) {
      const file = path.join(dir, `${s}.jsonl`);
      writeJsonlShardedSync(file, split[s].map(row => ({...row, split: s})));
      manifest.sha256[`datasets_archive/legacy-resplit/${corpus}/${s}.jsonl`] = await hashJsonlSharded(file);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack); process.exit(1); });
