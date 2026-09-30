#!/usr/bin/env node
/** Sealed-overlap audit of the corpus `proofing` (dataset_proofing): report-only.
 *
 *   node tools/datasets/audit/proofing-overlap.mjs [--out eval/reports/current/proofing/overlap.json]
 *
 * A sealed auditor (eval/leakage.mjs SEALED_AUDITORS): it reads the sealed formalizer suites to measure how the
 * proofing inputs and targets overlap them, and writes a report; nothing that builds or selects data imports it.
 * Measures, for proofing train, dev and the sealed proofing test against the formalizer-v1 test, formalizer-ood-v1 and
 * formalizer-wild-v1 messages: exact matches after normalization (case, diacritics, punctuation, spacing), and the
 * share of rows sharing a word 8-gram with any sealed message (templated synthetic text shares frames by design, so
 * this is reported, not failed). Also exact input overlap between the proofing splits. Exit 1 on an exact match.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SEALED = {'formalizer-v1': 'eval/suites/formalizer-v1', 'formalizer-ood-v1': 'eval/suites/formalizer-ood-v1', 'formalizer-wild-v1': 'eval/suites/formalizer-wild-v1'};
const norm = s => String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const grams = (s, n = 8) => { const t = norm(s).split(' ').filter(Boolean); const out = []; for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n).join(' ')); return out; };

function main() {
  const args = process.argv.slice(2);
  const outFile = path.join(ROOT, args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'eval/reports/current/proofing/overlap.json');
  const splits = {train: 'datasets_archive/proofing/train.jsonl', dev: 'datasets_archive/proofing/dev.jsonl', hard_cases: 'datasets_archive/proofing/hard_cases.jsonl', test: 'eval/suites/proofing/test.jsonl'};
  const proofing = Object.fromEntries(Object.entries(splits).filter(([, f]) => jsonlExists(path.join(ROOT, f))).map(([k, f]) => [k, readJsonlShardedSync(path.join(ROOT, f))]));
  const report = {generated_at: new Date().toISOString(), method: 'normalized exact match and shared word 8-grams; report-only except exact matches', sealed: {}, between_splits: {}};
  let exact = 0;
  for (const [name, dir] of Object.entries(SEALED)) {
    const rows = readJsonlShardedSync(path.join(ROOT, dir, 'test.jsonl'));
    const messages = new Set(rows.map(r => norm(r.question ?? r.message ?? '')));
    const g8 = new Set(rows.flatMap(r => grams(r.question ?? r.message ?? '')));
    report.sealed[name] = {rows: rows.length};
    for (const [split, prows] of Object.entries(proofing)) {
      const texts = prows.flatMap(r => [r.input, r.target].filter(Boolean));
      const hits = texts.filter(t => messages.has(norm(t)));
      exact += hits.length;
      report.sealed[name][split] = {texts: texts.length, exact_matches: hits.length, examples: hits.slice(0, 5), rows_sharing_an_8gram: prows.filter(r => [r.input, r.target].filter(Boolean).some(t => grams(t).some(x => g8.has(x)))).length, rows: prows.length};
    }
  }
  const keys = Object.fromEntries(Object.entries(proofing).map(([k, rows]) => [k, new Set(rows.map(r => norm(r.input)))]));
  const names = Object.keys(keys);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) report.between_splits[names[i] + '|' + names[j]] = [...keys[names[i]]].filter(k => keys[names[j]].has(k)).length;
  const groups = Object.fromEntries(Object.entries(proofing).map(([k, rows]) => [k, new Set(rows.map(r => r.split_group_id))]));
  report.shared_split_groups = {train_test: [...groups.train ?? []].filter(g => groups.test?.has(g)).length, dev_test: [...groups.dev ?? []].filter(g => groups.test?.has(g)).length, train_dev: [...groups.train ?? []].filter(g => groups.dev?.has(g)).length};
  report.exact_matches_total = exact;
  fs.mkdirSync(path.dirname(outFile), {recursive: true});
  fs.writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report, null, 1));
  if (exact) process.exitCode = 1;
}
main();
