#!/usr/bin/env node
/** Overlap of the three datasets with the owner's real messages of `datasets/natural` (DS008 "The natural collection").
 *
 *   node tools/datasets/audit/natural-overlap.mjs [--dataset NAME] [--out file] [--no-write] [--min-words 2]
 *
 * Owner decision 2026-10-01: the real messages are the realism evaluation set, read as a whole, and seeds for synthetic training data.
 * A synthetic row may reuse the FORM of a message with different content words (names, nouns, verbs, numbers: the evaluation policy
 * "same form, different words"), never the message itself. For every row of every split of the three datasets (train and dev, and the
 * sealed test as a validator reads it) this check fails closed on
 *   (a) an exact or normalized duplicate of a natural message (the message of the row, or its clean target),
 *   (b) a lexical duplicate: the same content-word signature (light tokenizer, at least --min-words words) as a natural message,
 *   (c) a row whose `natural_seed` (the id of the natural message it is derived from) names no natural message.
 * Rows that are largely contained (>= 0.8 of the content words of the shorter set) are counted as information. The report is
 * eval/reports/current/three-datasets/natural-overlap.json. Exit code 1 on (a), (b) or (c).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';
import {ROOT, THREE_DATASETS} from '../../../lib/dataset-paths.mjs';
import {normalText} from '../three-datasets/inputs.mjs';
import {lightWords, coverage} from '../three-datasets/forms.mjs';

export const NATURAL_FILE = 'datasets/natural/messages.jsonl';
const MAX_EXAMPLES = 12;
const splitFile = (dataset, split) => (split === 'test' ? `eval/suites/${dataset}/test.jsonl` : `datasets/${dataset}/${split}.jsonl`);
const load = (dataset, split, root) => { const file = path.join(root, splitFile(dataset, split)); return jsonlExists(file) ? readJsonlShardedSync(file) : []; };

/** `rows` are dataset rows ({id, message, target?, natural_seed?}); `natural` the natural messages ({id, message}). Pure. */
export function naturalOverlapOf(rows, natural, {minWords = 2, largely = 0.8} = {}) {
  const ids = new Set(natural.map(n => n.id));
  const byNorm = new Map(natural.map(n => [normalText(n.message), n]));
  const sig = natural.map(n => ({id: n.id, words: lightWords(n.message)}));
  const bySig = new Map();
  for (const s of sig) if (s.words.length >= minWords) bySig.set(s.words.join(' '), s);
  const index = new Map();
  for (const s of sig) if (s.words.length >= minWords) for (const w of s.words) (index.get(w) ?? index.set(w, []).get(w)).push(s);
  const out = {rows: rows.length, natural: natural.length, exact_duplicates: 0, lexical_duplicates: 0, largely_contained: 0, unknown_seed: 0, seeded_rows: 0, examples: []};
  const note = (kind, row, n, text) => { if (out.examples.length < MAX_EXAMPLES) out.examples.push({kind, row: row.id, natural: n.id, text: String(text).slice(0, 120)}); };
  for (const row of rows) {
    if (row.natural_seed !== undefined) { out.seeded_rows++; if (!ids.has(row.natural_seed)) { out.unknown_seed++; note('unknown_seed', row, {id: String(row.natural_seed)}, row.message); } }
    let exact = false, lexical = false, contained = false;
    for (const text of [row.message, row.target].filter(t => typeof t === 'string' && t.trim())) {
      const norm = normalText(text), hit = byNorm.get(norm);
      if (hit) { exact = true; note('exact', row, hit, text); continue; }
      const words = lightWords(text);
      if (words.length >= minWords) {
        const same = bySig.get(words.join(' '));
        if (same) { lexical = true; note('lexical', row, same, text); continue; }
        if (!contained) for (const s of new Set(words.flatMap(w => index.get(w) ?? []))) if (Math.min(coverage(words, s.words), coverage(s.words, words)) >= largely) { contained = true; break; }
      }
    }
    if (exact) out.exact_duplicates++; else if (lexical) out.lexical_duplicates++; else if (contained) out.largely_contained++;
  }
  return out;
}

export function run({root = ROOT, datasets = THREE_DATASETS, minWords = 2, loadRows = load} = {}) {
  const file = path.join(root, NATURAL_FILE);
  const natural = jsonlExists(file) ? readJsonlShardedSync(file) : [];
  const report = {generated_at: new Date().toISOString(), method: 'light content words (lib: three-datasets/forms.mjs lightWords) and normalized text of the row message and clean target against every natural message', natural_messages: natural.length, datasets: {}, failures: []};
  if (!natural.length) return report;
  for (const d of datasets) {
    const rows = ['train', 'dev', 'test'].flatMap(s => loadRows(d, s, root));
    const r = naturalOverlapOf(rows, natural, {minWords});
    report.datasets[d] = r;
    if (r.exact_duplicates) report.failures.push(`${d}: ${r.exact_duplicates} row(s) duplicate an owner message of datasets/natural (normalized)`);
    if (r.lexical_duplicates) report.failures.push(`${d}: ${r.lexical_duplicates} row(s) with the content words of an owner message of datasets/natural (a derived row must change names, nouns and verbs)`);
    if (r.unknown_seed) report.failures.push(`${d}: ${r.unknown_seed} row(s) with a natural_seed that names no natural message`);
  }
  return report;
}

const parseArgs = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  const report = run({datasets: o.dataset ? [o.dataset] : THREE_DATASETS, minWords: Number(o['min-words'] ?? 2)});
  const outFile = path.resolve(ROOT, o.out ?? 'eval/reports/current/three-datasets/natural-overlap.json');
  if (!o['no-write']) { fs.mkdirSync(path.dirname(outFile), {recursive: true}); fs.writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n'); }
  for (const [d, r] of Object.entries(report.datasets)) console.log(`${d}: ${r.rows} rows vs ${r.natural} natural; exact ${r.exact_duplicates}; lexical ${r.lexical_duplicates}; largely contained ${r.largely_contained}; seeded ${r.seeded_rows}`);
  for (const f of report.failures) console.error(`FAIL ${f}`);
  if (report.failures.length) process.exitCode = 1;
}
