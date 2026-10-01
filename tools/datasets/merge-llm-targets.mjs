#!/usr/bin/env node
/** Merge the DeepSeek flash targets (datasets_sources/bad_english_targets/output) into datasets/bad_english/{train,dev}.jsonl in
 * place, without a full re-assembly (the dataset builder, `build-three-datasets.mjs assemble`, applies the same function, so a
 * rebuild keeps them). The sealed test is merged by `node tools/eval/three-datasets-suites.mjs merge-llm-targets` (rule 9).
 *
 *   node tools/datasets/merge-llm-targets.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {loadLlmTargets, applyLlmTargets} from './three-datasets/llm-targets.mjs';
import {writeSplit, summarise, updateManifest} from './three-datasets/write.mjs';

const dry = process.argv.includes('--dry');
const llm = loadLlmTargets();
const report = {generated_at: new Date().toISOString(), llm_rows: llm.size, splits: {}};
const patch = {sha256: {}, bytes: {}, counts: {}};
for (const split of ['train', 'dev']) {
  const file = path.join(ROOT, 'datasets/bad_english', `${split}.jsonl`);
  const rows = readJsonlShardedSync(file);
  const counts = applyLlmTargets(rows, llm);
  report.splits[split] = counts;
  if (dry) continue;
  const written = await writeSplit('bad_english', split, rows);
  patch.sha256[written.path] = written.sha256; patch.bytes[written.path] = written.bytes; patch.counts[split] = summarise('bad_english', rows);
}
if (!dry) {
  updateManifest('bad_english', {...patch, llm_targets: {source: 'datasets_sources/bad_english_targets', target_source: 'llm:deepseek-flash', review_status: 'pending', merged_at: new Date().toISOString()}});
  fs.mkdirSync(path.join(ROOT, 'eval/reports/current/three-datasets'), {recursive: true});
  fs.writeFileSync(path.join(ROOT, 'eval/reports/current/three-datasets/merge-llm-targets.json'), JSON.stringify(report, null, 1) + '\n');
}
console.log(JSON.stringify(report, null, 1));
