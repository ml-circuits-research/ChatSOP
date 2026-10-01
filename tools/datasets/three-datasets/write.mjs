/** Writing of the three datasets and their manifests (format chatsop-dataset-manifest-v3). */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {writeJsonlShardedSync, hashJsonlSharded, jsonlBytes} from '../../../lib/jsonl-shards.mjs';

export const MANIFEST_FORMAT = 'chatsop-dataset-manifest-v3';
export const DATASET_INFO = Object.freeze({
  bad_english: {
    model: 'LanguageProofingLLM',
    purpose: 'Messages that are not clean English (Romanian, mixed Romanian/English, spelling and grammar problems, garbled text) with an acceptable clean-English target where one is known. Evaluates and later fine-tunes LanguageProofingLLM, the model behind the chat textToCleanEnglish step (translation plus spelling and grammar repair into acceptable English).',
  },
  symbolic_english: {
    model: 'SymbolicLM (regression suite); seed forms for SymbolicProofingLLM',
    purpose: 'Correct English whose SymbolicLM grammatical analysis is correct (every sentence: identical default and accurate Stanza trees and the DeepSeek parse judge, conditions a and c, good enough). Each row stores the message, SymbolicLM grammatical analysis (compact UD parse) and, for the later layer, the SOP Lang output with its gold comparison (sop_layer). A regression suite: whenever SymbolicLM, the Stanza model or the engine changes, every row must still be analysed the same or better (node tools/symbolic-regression.mjs). Also the inventory of forms SymbolicProofingLLM should rewrite into.',
  },
  neuro_english: {
    model: 'SymbolicProofingLLM',
    purpose: 'Grammatically correct English whose SymbolicLM grammatical analysis is not correct (trees differ between the Stanza packages, or the DeepSeek parse judge says not good enough on condition a or c), with a meaning-preserving rewrite that SymbolicLM does handle where one is known. Fine-tuning and evaluation material for SymbolicProofingLLM. Rows nobody can rewrite yet are kept and flagged no_target. The SOP-layer result of every row is kept as sop_layer for the later layer.',
  },
});

const rel = file => path.relative(ROOT, file).split(path.sep).join('/');

/** Write one split file (`datasets/<dataset>/<split>.jsonl`, or `base` for a sealed test). Returns {path, rows, bytes, sha256}. */
export async function writeSplit(dataset, split, rows, options = {}) {
  // AGENTS.md rule 9: a sealed test is kept only in the sealed suites folder, never beside the train and dev files of a dataset.
  if (split === 'test' && !options.base) throw Error(`writeSplit(${dataset}, ${split}): pass {base} in the sealed suites folder (AGENTS.md rule 9)`);
  const {base = path.join(ROOT, 'datasets', dataset, `${split}.jsonl`)} = options;
  if (path.relative(path.join(ROOT, 'datasets'), base).split(path.sep)[1]?.startsWith('test.')) throw Error(`refusing to write a sealed test beside the dataset files: ${path.relative(ROOT, base)}`);
  const result = writeJsonlShardedSync(base, rows);
  return {path: rel(base), rows: result.rows, bytes: jsonlBytes(base), sha256: await hashJsonlSharded(base)};
}

/** Counts of one dataset's rows for the manifest. */
export function summarise(dataset, rows) {
  const by = (key, get) => { const out = {}; for (const r of rows) { const v = get(r) ?? 'none'; out[v] = (out[v] ?? 0) + 1; } return Object.fromEntries(Object.entries(out).sort()); };
  const base = {rows: rows.length, by_source: by('s', r => r.source.corpus)};
  if (dataset === 'bad_english') return {...base, by_language_kind: by('k', r => r.language_kind), with_target: rows.filter(r => r.target).length, by_target_source: by('t', r => r.target_source)};
  if (dataset === 'symbolic_english') return {...base, by_analysis_verified: by('v', r => r.analysis_verified), by_sop_layer: by('l', r => r.sop_layer?.status)};
  return {...base, by_failure_kind: by('f', r => r.failure_kind), by_sop_layer: by('l', r => r.sop_layer?.status), by_sop_failure_kind: by('k', r => r.sop_layer?.failure_kind), with_target: rows.filter(r => r.target).length, by_target_source: by('t', r => r.target_source), rewrite_targets: rows.filter(r => r.rewrite_target).length};
}

const deepMerge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v; return a; };

/** Merge `patch` into datasets/<dataset>/manifest.json (created with the static block on first use). */
export function updateManifest(dataset, patch) {
  const file = path.join(ROOT, 'datasets', dataset, 'manifest.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
    format: MANIFEST_FORMAT, dataset, ...DATASET_INFO[dataset], review_status: 'not_reviewed', human_reviewed: false, training_authorized: false,
    owner_decision: '2026-09-30, status/journal.jsonl: three datasets with one purpose each',
    classification: `datasets/${dataset}/README.md and docs/specs/DS008-data-evaluation.md "Three datasets"`,
    splits: {train: `datasets/${dataset}/train.jsonl`, dev: `datasets/${dataset}/dev.jsonl`},
    split_policy: 'by split_group_id (source split groups; new cases by writer); rows of sealed suites only in the sealed test, exact-text overlap with a sealed row or across splits is dropped from train/dev',
    sha256: {}, bytes: {}, counts: {},
  };
  // Counts of a split are replaced, not merged: a value of an earlier build (for example a retired analysis_verified key) must not survive.
  for (const split of Object.keys(patch.counts ?? {})) { current.counts ??= {}; current.counts[split] = patch.counts[split]; }
  const {counts: replaced, ...rest} = patch;
  deepMerge(current, rest);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(current, null, 1) + '\n');
  fs.renameSync(temp, file); // atomic: a reader (the audit page) never sees a half-written manifest
  return current;
}
