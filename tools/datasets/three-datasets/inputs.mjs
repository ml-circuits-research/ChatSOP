/** Train/dev side inputs of the three datasets: the classified records of formalizer-v1 train and dev, the
 * Haiku-diversified paraphrases (their split groups all lie in formalizer-v1 train) and the new cases. Sealed suites
 * are never opened here (AGENTS.md rule 9); `tools/eval/three-datasets-suites.mjs` supplies their records.
 */
import path from 'node:path';
import {readJsonlShardedSync} from '../../../lib/jsonl-shards.mjs';
import {ROOT, archived} from '../../../lib/dataset-paths.mjs';
import {formalizerRecord, newCaseRecord, newCaseSplits, readNewCases, writerOf} from './sources.mjs';

const read = relative => readJsonlShardedSync(path.join(ROOT, relative));

/** formalizer-v1 train and dev, plus the diversified paraphrases in the split of their group. */
export function trainDevFormalizerRecords({excludeGroups = new Set()} = {}) {
  const out = [];
  for (const split of ['train', 'dev']) for (const row of read(archived(`formalizer-v1/${split}.jsonl`))) if (!excludeGroups.has(row.split_group_id)) out.push(formalizerRecord(row, {corpus: 'formalizer-v1', split}));
  const groups = new Map(out.map(r => [r.splitGroupId, r.split]));
  for (const row of read(archived('proofing-diverse-dev/diverse-dev.jsonl'))) {
    const split = groups.get(row.split_group_id);
    if (split) out.push(formalizerRecord(row, {corpus: 'proofing-diverse-dev', split, suite: 'proofing-diverse-dev'}));
  }
  return out;
}

/** All new cases as records with their split (`test` for the owner-sealed writers), and the source hash. */
export function newCaseRecords() {
  const {rows, sealedWriters, sha256, bytes} = readNewCases();
  const writers = [...new Set(rows.map(writerOf))].sort();
  const splitOf = newCaseSplits(writers, sealedWriters);
  return {records: rows.map(nc => newCaseRecord(nc, splitOf(writerOf(nc)))), sealedWriters, sha256, bytes, writers, splitOf};
}

/** Proofing rows of the train/dev side: the corpus files and the v2 additions (the sealed proofing test is read by the eval tool). */
export function trainDevProofingRows() {
  const files = ['proofing/train.jsonl', 'proofing/dev.jsonl', 'proofing/hard_cases.jsonl', 'proofing/ro_translated.jsonl', 'proofing-diverse-dev/v2-additions-train.jsonl', 'proofing-diverse-dev/v2-additions-dev.jsonl', 'proofing-diverse-dev/v2-additions-hard.jsonl'];
  return files.flatMap(file => read(archived(file)));
}

/** Normalized text used to detect exact duplicates across splits (case, diacritics, punctuation and spacing folded). */
export const normalText = text => String(text).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
