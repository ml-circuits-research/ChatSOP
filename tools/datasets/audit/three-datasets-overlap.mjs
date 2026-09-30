#!/usr/bin/env node
/** Sealed-overlap audit of the three datasets (bad_english, symbolic_english, neuro_english): report-only except exact matches.
 *
 *   node tools/datasets/audit/three-datasets-overlap.mjs [--out eval/reports/current/three-datasets/overlap.json]
 *
 * A sealed auditor (eval/leakage.mjs SEALED_AUDITORS). For train and dev of every dataset it measures, against the sealed
 * formalizer suites and the sealed tests of the three datasets: exact matches after normalization (case, diacritics,
 * punctuation, spacing) of the message and of every target, and the share of rows sharing a word 8-gram with a sealed
 * message (templated synthetic text shares frames by design, so this is reported, not failed). Also the split groups
 * shared between splits. Exit 1 on an exact match of a message.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATASETS = ['bad_english', 'symbolic_english', 'neuro_english'];
const SEALED = ['eval/suites/formalizer-v1', 'eval/suites/formalizer-ood-v1', 'eval/suites/formalizer-wild-v1', ...DATASETS.map(d => `eval/suites/${d}`)];
const norm = s => String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const grams = (s, n = 8) => { const t = norm(s).split(' ').filter(Boolean); const out = []; for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n).join(' ')); return out; };
const args = process.argv.slice(2);
const outFile = path.join(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'eval/reports/current/three-datasets/overlap.json');

const sealed = new Map();
for (const dir of SEALED) {
  const file = path.join(ROOT, dir, 'test.jsonl');
  if (!jsonlExists(file)) continue;
  const rows = readJsonlShardedSync(file);
  sealed.set(dir, {rows: rows.length, texts: new Set(rows.map(r => norm(r.question ?? r.message))), grams: new Set(rows.flatMap(r => grams(r.question ?? r.message)))});
}
const report = {generated_at: new Date().toISOString(), method: 'normalized exact match and shared word 8-grams; report-only except exact message matches', sealed: {}, shared_split_groups: {}};
let exact = 0;
for (const dataset of DATASETS) {
  const splits = Object.fromEntries(['train', 'dev'].filter(s => jsonlExists(path.join(ROOT, 'datasets', dataset, `${s}.jsonl`))).map(s => [s, readJsonlShardedSync(path.join(ROOT, 'datasets', dataset, `${s}.jsonl`))]));
  const test = jsonlExists(path.join(ROOT, 'eval/suites', dataset, 'test.jsonl')) ? readJsonlShardedSync(path.join(ROOT, 'eval/suites', dataset, 'test.jsonl')) : [];
  for (const [split, rows] of Object.entries(splits)) {
    report.sealed[`${dataset}/${split}`] = {rows: rows.length};
    for (const [dir, s] of sealed) {
      const hits = rows.filter(r => s.texts.has(norm(r.message)));
      exact += hits.length;
      const targetHits = rows.filter(r => (r.targets ?? []).some(t => s.texts.has(norm(t.text)))).length;
      report.sealed[`${dataset}/${split}`][dir] = {exact_message_matches: hits.length, examples: hits.slice(0, 3).map(r => r.message), exact_target_matches: targetHits, rows_sharing_an_8gram: rows.filter(r => grams(r.message).some(g => s.grams.has(g))).length};
    }
  }
  const groups = Object.fromEntries(Object.entries({...splits, test}).map(([k, rows]) => [k, new Set(rows.map(r => r.split_group_id))]));
  report.shared_split_groups[dataset] = {train_dev: [...(groups.train ?? [])].filter(g => groups.dev?.has(g)).length, train_test: [...(groups.train ?? [])].filter(g => groups.test?.has(g)).length, dev_test: [...(groups.dev ?? [])].filter(g => groups.test?.has(g)).length};
}
report.exact_message_matches_total = exact;
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({exact_message_matches_total: exact, shared_split_groups: report.shared_split_groups, report: path.relative(ROOT, outFile)}, null, 1));
if (exact) process.exitCode = 1;
