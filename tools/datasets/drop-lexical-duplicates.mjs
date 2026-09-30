#!/usr/bin/env node
/** Drop the train/dev rows that duplicate a sealed test row (DS008 "Content-word overlap").
 *
 *   node tools/datasets/drop-lexical-duplicates.mjs [--apply] [--catalog eval/reports/current/three-datasets/form-templates.json]
 *
 * The sealed test rows are never edited. A train or dev row is dropped when its normalized text equals a sealed text, or when its content-word signature (at
 * least two words) and form equal those of a sealed row: the same case, differing only by a number, a filler, a lead-in or a noise pattern. The sealed side is read
 * as hashes from the catalog of the auditor-side tool tools/eval/form-templates.mjs (this generator never reads a sealed row, AGENTS.md rule 9). Without `--apply`
 * it reports the counts per dataset, split and source. Run it after every rebuild of the three datasets, before `composed-train.mjs` and `form-variants.mjs`, and
 * check with `node tools/datasets/verify-three-datasets.mjs`; it is idempotent.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT, THREE_DATASETS} from '../../lib/dataset-paths.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {signatureOf} from './three-datasets/forms.mjs';
import {textHash, lexicalHash} from './three-datasets/variants.mjs';

export const CATALOG_PATH = 'eval/reports/current/three-datasets/form-templates.json';

/** Rows of `rows` that duplicate a sealed row by the hash sets `{texts, lexical}`. */
export function duplicates(rows, sealed) {
  const texts = new Set(sealed.texts), lexical = new Set(sealed.lexical);
  return rows.filter(row => {
    if (texts.has(textHash(row.message))) return true;
    const sig = signatureOf(row);
    return sig.words.length >= 2 && lexical.has(lexicalHash(sig));
  });
}

async function main() {
  const o = process.argv.slice(2), get = (k, d) => (o.includes(`--${k}`) ? o[o.indexOf(`--${k}`) + 1] : d);
  const catalogFile = path.resolve(ROOT, get('catalog', CATALOG_PATH));
  if (!fs.existsSync(catalogFile)) throw Error(`missing ${path.relative(ROOT, catalogFile)}; write it with node tools/eval/form-templates.mjs`);
  const {sealed} = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const report = {generated_at: new Date().toISOString(), applied: o.includes('--apply'), dropped: {}};
  for (const dataset of THREE_DATASETS) for (const split of ['train', 'dev']) {
    const file = path.join(ROOT, 'datasets', dataset, `${split}.jsonl`);
    const rows = readJsonlShardedSync(file);
    const drop = new Set(duplicates(rows, sealed).map(r => r.id));
    const bySource = {};
    for (const r of rows) if (drop.has(r.id)) bySource[r.source?.corpus ?? 'none'] = (bySource[r.source?.corpus ?? 'none'] ?? 0) + 1;
    report.dropped[`${dataset}/${split}`] = {rows: rows.length, dropped: drop.size, by_source: bySource};
    console.log(`${dataset}/${split}: ${drop.size} of ${rows.length} rows duplicate a sealed row ${JSON.stringify(bySource)}`);
    if (!o.includes('--apply') || !drop.size) continue;
    const {writeSplit, summarise, updateManifest} = await import('./three-datasets/write.mjs');
    const kept = rows.filter(r => !drop.has(r.id));
    const written = await writeSplit(dataset, split, kept);
    updateManifest(dataset, {sha256: {[written.path]: written.sha256}, bytes: {[written.path]: written.bytes}, counts: {[split]: summarise(dataset, kept)}});
  }
  fs.mkdirSync(path.join(ROOT, 'eval/reports/current/composed-eval'), {recursive: true});
  fs.writeFileSync(path.join(ROOT, 'eval/reports/current/composed-eval/drop-lexical-duplicates.json'), JSON.stringify(report, null, 1) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1); });
