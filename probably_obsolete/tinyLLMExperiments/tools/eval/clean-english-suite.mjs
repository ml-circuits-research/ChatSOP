#!/usr/bin/env node
/** Builds the sealed clean-English suite `eval/suites/clean-english/test.jsonl` (owner decision 2026-09-30,
 * journaled): the clean_en rows of the three sealed formalization suites, classified by
 * `tools/datasets/clean-english.mjs` `classifyPartition`. It lives under tools/eval/, not tools/datasets/, because
 * it reads sealed test answers: a data generator may not (AGENTS.md rule 9, `eval/leakage.mjs`). The generator
 * `tools/datasets/build-clean-english.mjs` builds only the train/dev side and never opens a sealed file.
 *
 * Outputs (never hand-edited; rerun after a corpus or classifier change):
 *   - eval/suites/clean-english/test.jsonl + manifest.json (sealed: never used to tune anything)
 *   - eval/reports/current/clean-english/partitions/<suite>.json   id lists and counts per source suite
 *   - the `test` fields of datasets_archive/clean-english/manifest.json (splits, sha256, bytes, counts)
 *
 *   node tools/eval/clean-english-suite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, writeJsonlShardedSync, jsonlBytes, hashJsonlSharded} from '../../lib/jsonl-shards.mjs';
import {loadSpellfix} from '../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {classifyPartition} from '../datasets/clean-english.mjs';
import {SOURCES as RIGHTS_SOURCES} from '../datasets/rights.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const abs = p => path.join(ROOT, p);
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };
const TEST = 'eval/suites/clean-english/test.jsonl';
const SUITES = {
  'formalizer-v1': 'eval/suites/formalizer-v1/test.jsonl',
  'formalizer-ood-v1': 'eval/suites/formalizer-ood-v1/test.jsonl',
  'formalizer-wild-v1': 'eval/suites/formalizer-wild-v1/test.jsonl',
};

async function main() {
  console.log('loading LanguagesUtil resources (spellfix dictionaries, host dictionary)...');
  const resources = {spellfix: loadSpellfix(), dictionary: defaultDictionary()};
  const suiteClean = [];
  const suiteManifests = {};
  for (const [suite, file] of Object.entries(SUITES)) {
    const rows = readJsonlShardedSync(abs(file));
    const byPartition = {clean_en: [], noisy_en: [], ro: [], mixed: []};
    for (const row of rows) byPartition[classifyPartition(row, resources).partition].push(row);
    console.log(suite, Object.fromEntries(Object.entries(byPartition).map(([k, v]) => [k, v.length])));
    const manifest = {source: file, classifier: 'tools/datasets/clean-english.mjs classifyPartition', counts: {}};
    for (const [name, list] of Object.entries(byPartition)) manifest.counts[name] = list.length;
    for (const name of ['noisy_en', 'ro', 'mixed']) manifest[name] = byPartition[name].map(r => r.id);
    writeJson(abs(`eval/reports/current/clean-english/partitions/${suite}.json`), manifest);
    suiteManifests[suite] = manifest.counts;
    for (const row of byPartition.clean_en) suiteClean.push({...row, suite, source_id: row.id, id: `${suite}::${row.id}`});
  }
  fs.mkdirSync(abs('eval/suites/clean-english'), {recursive: true});
  writeJsonlShardedSync(abs(TEST), suiteClean);
  const hash = await hashJsonlSharded(abs(TEST));
  const bytes = jsonlBytes(abs(TEST));
  const inspiredBy = Object.keys(RIGHTS_SOURCES).map(id => ({id, name: RIGHTS_SOURCES[id].name, url: RIGHTS_SOURCES[id].url, licence: RIGHTS_SOURCES[id].licence}));
  const rights = {
    license: 'MIT (repository LICENSE); original ChatSOP authored text',
    rights_decision: 'inherited-from-formalizer-v1 (no new source text: a language-quality filter over already rights-cleared rows)',
    rights_decision_date: '2026-09-28',
    inspired_by: inspiredBy,
    text_copied: false,
    filtered_from: 'datasets_archive/formalizer-v1 (train/dev) and eval/suites/{formalizer-v1,formalizer-ood-v1,formalizer-wild-v1}/test.jsonl (test), by tools/datasets/clean-english.mjs classifyPartition',
  };
  writeJson(abs('eval/suites/clean-english/manifest.json'), {
    format: 'chatsop-suite-manifest-v1', suite: 'clean-english', sealed: true,
    owner_decision: '2026-09-30: formalization evaluation focuses on valid, clean English (status/journal.jsonl)',
    builder: 'tools/eval/clean-english-suite.mjs', classifier: 'tools/datasets/clean-english.mjs',
    source_suites: SUITES, id_format: '<suite>::<source_id>',
    sha256: {[TEST]: hash},
    bytes: {[TEST]: bytes},
    counts: {total: suiteClean.length, by_suite: suiteManifests},
    rights,
  });
  // The corpus manifest carries the test fields the generator cannot compute; patch only those.
  const corpusManifestFile = abs('datasets_archive/clean-english/manifest.json');
  if (fs.existsSync(corpusManifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(corpusManifestFile, 'utf8'));
    manifest.sha256 = {...manifest.sha256, [TEST]: hash};
    manifest.bytes = {...manifest.bytes, [TEST]: bytes};
    manifest.counts = {...manifest.counts, test: suiteClean.length, test_by_suite: suiteManifests};
    manifest.splits = {...manifest.splits, test: TEST};
    manifest.rights = {...manifest.rights, filtered_from: rights.filtered_from};
    writeJson(corpusManifestFile, manifest);
  }
  console.log('clean-english: test', suiteClean.length);
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
