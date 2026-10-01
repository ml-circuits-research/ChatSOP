#!/usr/bin/env node
/** Form-template catalog for the form variants (auditor side; DS008 "Form variants").
 *
 *   node tools/eval/form-templates.mjs [--min-coverage 5] [--templates-per-form 6] [--out eval/reports/current/three-datasets/form-templates.json]
 *
 * Reads the sealed test rows (the generator tools/datasets/form-variants.mjs may not: AGENTS.md rule 9) and writes what the generator needs and
 * nothing more: for each sealed symbolic_english form with fewer than `--min-coverage` train/dev rows, delexicalized templates of gold-verified
 * sentences (proper names, nouns that occur in a SOP value and the main verb are slots, see tools/datasets/three-datasets/variants.mjs), and sha1 prefixes of
 * the normalized text and of the lexical signature (content words plus form) of every sealed row, so the generator can refuse a duplicate without
 * reading a sealed row. It also counts the neuro_english test forms without train/dev coverage (those cannot be varied mechanically).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {loadRows} from './composed/components.mjs';
import {loadSealedRows} from './composed/sealed.mjs';
import {signatureOf} from '../datasets/three-datasets/forms.mjs';
import {hasGoldMatch} from '../datasets/three-datasets/rows.mjs';
import {skeletonOf, textHash, lexicalHash} from '../datasets/three-datasets/variants.mjs';
export {textHash, lexicalHash};

export function catalog({minCoverage = 5, templatesPerForm = 6, root = ROOT} = {}) {
  const test = loadSealedRows('symbolic_english', root), pool = loadRows('symbolic_english', ['train', 'dev'], root);
  const coverage = new Map();
  for (const r of pool) { const f = signatureOf(r).form; coverage.set(f, (coverage.get(f) ?? 0) + 1); }
  const byForm = new Map();
  for (const r of test) { if (!r.analysis?.sentences?.length) continue; const f = signatureOf(r).form; (byForm.get(f) ?? byForm.set(f, []).get(f)).push(r); }
  const forms = [];
  let withoutTemplate = 0;
  for (const [form, rows] of [...byForm].sort((a, b) => a[0].localeCompare(b[0]))) {
    if ((coverage.get(form) ?? 0) >= minCoverage) continue;
    const templates = rows.filter(hasGoldMatch).sort((a, b) => a.id.localeCompare(b.id)).map(skeletonOf).filter(Boolean).slice(0, templatesPerForm);
    if (!templates.length) { withoutTemplate++; continue; }
    forms.push({form, coverage_before: coverage.get(form) ?? 0, test_rows: rows.length, templates});
  }
  const neuroCoverage = new Map();
  for (const r of loadRows('neuro_english', ['train', 'dev'], root)) { const f = signatureOf(r).form; neuroCoverage.set(f, (neuroCoverage.get(f) ?? 0) + 1); }
  const neuroForms = new Map();
  for (const r of loadSealedRows('neuro_english', root)) { const f = signatureOf(r).form; if ((neuroCoverage.get(f) ?? 0) < minCoverage) neuroForms.set(f, (neuroForms.get(f) ?? 0) + 1); }
  const sealed = ['symbolic_english', 'neuro_english', 'bad_english'].flatMap(d => loadSealedRows(d, root));
  return {
    format: 'chatsop-form-templates-v1', generated_at: new Date().toISOString(), min_coverage: minCoverage, templates_per_form: templatesPerForm,
    note: 'Delexicalized templates of sealed symbolic_english forms (no name, noun or verb of a sealed row) and hashes of the sealed texts; produced by tools/eval/form-templates.mjs, read by tools/datasets/form-variants.mjs.',
    forms, sparse_forms: forms.length + withoutTemplate, forms_without_gold_template: withoutTemplate,
    neuro_sparse: {forms: neuroForms.size, rows: [...neuroForms.values()].reduce((a, b) => a + b, 0)},
    sealed: {texts: [...new Set(sealed.map(r => textHash(r.message)))].sort(), lexical: [...new Set(sealed.map(r => signatureOf(r)).filter(sig => sig.words.length >= 2).map(lexicalHash))].sort()},
  };
}

export const CATALOG_PATH = 'eval/reports/current/three-datasets/form-templates.json';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), get = (k, d) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : d);
  const out = catalog({minCoverage: Number(get('min-coverage', 5)), templatesPerForm: Number(get('templates-per-form', 6))});
  const file = path.resolve(ROOT, get('out', CATALOG_PATH));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(out) + '\n');
  console.log(`${path.relative(ROOT, file)}: ${out.forms.length} sparse forms with templates (${out.forms_without_gold_template} without a gold template), ${out.forms.reduce((n, f) => n + f.templates.length, 0)} templates, neuro sparse forms ${out.neuro_sparse.forms} (${out.neuro_sparse.rows} rows), ${out.sealed.texts.length} sealed text hashes`);
}
