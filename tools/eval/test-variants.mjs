#!/usr/bin/env node
/** Test variants of forms that only the training side has (auditor side; owner decision 2026-09-30, DS008 "Form variants").
 *
 *   node tools/eval/test-variants.mjs [--per-template 2] [--templates-per-form 3] [--check]
 *
 * Form coverage is an invariant: every form of the training side has a test case of the same form with different words. For each form of the gold-verified
 * symbolic_english train/dev rows that no sealed test row has, this tool delexicalizes up to `--templates-per-form` train/dev rows (tools/datasets/three-datasets/variants.mjs),
 * fills the slots with other names, nouns and verbs, and keeps a variant only when SymbolicLM analyses it as the same form and produces exactly the expected SOP,
 * and it is no text duplicate and no lexical duplicate (identical content words and form) of any train, dev or sealed row. The rows are written, sealed, to
 * eval/suites/symbolic_english/test-variants.jsonl with manifest-variants.json (hashes, seed, counts); the audit page shows them as the split `test-variants` (view only).
 * neuro_english forms that only train has cannot be varied mechanically (no verified rewrite exists); their count is in the manifest. `--check` rebuilds and compares.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {loadRows} from './composed/components.mjs';
import {loadSealedRows} from './composed/sealed.mjs';
import {openLm} from './composed/lm.mjs';
import {signatureOf} from '../datasets/three-datasets/forms.mjs';
import {hasGoldMatch} from '../datasets/three-datasets/rows.mjs';
import {skeletonOf, textHash, lexicalHash} from '../datasets/three-datasets/variants.mjs';
import {build} from '../datasets/form-variants.mjs';
import {AnalysisGate, verdictRecord, judgeSummary} from '../datasets/three-datasets/analysis-gate.mjs';
import {decideAdditions} from '../datasets/three-datasets/place.mjs';

export const OUT = 'eval/suites/symbolic_english/test-variants.jsonl';

/** Catalog in the shape of the form-variants generator: forms of train/dev with no sealed row, and hashes of everything to avoid. */
export function trainSideCatalog({templatesPerForm = 3, root = ROOT} = {}) {
  const train = loadRows('symbolic_english', ['train', 'dev'], root), test = loadSealedRows('symbolic_english', root);
  const testForms = new Set(test.map(r => signatureOf(r).form).filter(Boolean));
  const byForm = new Map();
  for (const r of train) { const f = signatureOf(r).form; if (f && !testForms.has(f) && hasGoldMatch(r)) (byForm.get(f) ?? byForm.set(f, []).get(f)).push(r); }
  const forms = [];
  for (const [form, rows] of [...byForm].sort((a, b) => a[0].localeCompare(b[0]))) {
    const templates = rows.sort((a, b) => a.id.localeCompare(b.id)).map(skeletonOf).filter(Boolean).slice(0, templatesPerForm);
    if (templates.length) forms.push({form, coverage_before: 0, train_rows: rows.length, templates});
  }
  const neuroTest = new Set(loadSealedRows('neuro_english', root).map(r => signatureOf(r).form));
  const neuroOnly = new Set(loadRows('neuro_english', ['train', 'dev'], root).map(r => signatureOf(r).form).filter(f => f && !neuroTest.has(f)));
  const avoid = [...train, ...test];
  return {
    forms, forms_without_gold_template: byForm.size - forms.length, neuro_sparse: {forms: neuroOnly.size, rows: 0},
    sealed: {texts: [...new Set(avoid.map(r => textHash(r.message)))], lexical: [...new Set(avoid.filter(r => r.analysis?.sentences?.length).map(r => lexicalHash(signatureOf(r))))]},
    train_only_forms: byForm.size,
  };
}

async function main() {
  const a = process.argv.slice(2), get = (k, d) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : d);
  const catalog = trainSideCatalog({templatesPerForm: Number(get('templates-per-form', 3))});
  const lm = await openLm();
  try {
    const built = await build({catalog, lm, perTemplate: Number(get('per-template', 2)), seed: 'test-variants-v1', splitOf: () => 'test-variants', idPrefix: 'tv'});
    const {stats} = built;
    // Analysis-layer membership (DS008 "Three datasets"): a sealed variant is a symbolic_english case only when every sentence passes the analysis gate; the others are left out
    // (a view-only sealed file has no neuro side). The first run records the parses and judge items; a missing verdict stops the write.
    const gate = new AnalysisGate();
    const {decisions, summary} = await decideAdditions(gate, built.rows, {record: !a.includes('--check'), log: m => process.stderr.write(m + '\n')});
    const pending = built.rows.filter(r => decisions.get(r.message).state === 'pending').length;
    if (pending && !a.includes('--check')) { console.error(`${pending} test variants have no analysis verdict yet: run the judge task on datasets_sources/resplit_parse_judge/ and run again; nothing written`); process.exitCode = 2; return; }
    const gateRejected = built.rows.filter(r => decisions.get(r.message).state === 'fail').length;
    stats.rejected = {...stats.rejected, ...(gateRejected ? {analysis_gate_failed: gateRejected} : {})};
    const rows = built.rows.filter(r => decisions.get(r.message).state === 'pass').map(r => { const d = decisions.get(r.message); return {...r, analysis_verified: 'analysis_gate', analysis_verdict: verdictRecord(d, {}), sop_layer: {status: 'match', handled: true, failure_kind: null, failure: null}, verification: {...r.verification, judge: judgeSummary(d), stanza_default_accurate: d.worst_tree ?? 'not_measured'}}; });
    void summary;
    const sealedRows = rows.map(r => ({...r, source: {...r.source, corpus: 'test-variant', suite: 'test-variant', split: 'test-variants'}, rights: {...r.rights, inherited_from: 'slot substitution of delexicalized train/dev form templates'}, quality_flags: {...r.quality_flags, sealed_test_variant: true}})).sort((x, y) => x.id.localeCompare(y.id));
    const text = sealedRows.map(r => JSON.stringify(r)).join('\n') + '\n';
    const manifest = {format: 'chatsop-test-variants-manifest-v1', dataset: 'symbolic_english', split: 'test-variants', sealed: true, view_only: true, path: OUT, rows: sealedRows.length, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text), forms_with_a_variant: new Set(sealedRows.map(r => r.source.form_id)).size, train_only_forms: catalog.train_only_forms, forms_without_gold_template: catalog.forms_without_gold_template, neuro_forms_only_in_train: catalog.neuro_sparse.forms, rejected: stats.rejected, attempts: stats.attempts, seed: 'test-variants-v1', built_at: new Date().toISOString(),
      purpose: 'Test variants of forms that only the training side has: same form, different names, nouns and verbs; no text or lexical duplicate of a train, dev or sealed row; SymbolicLM output equals the expected SOP. Part of the evaluation policy of DS008 "Form coverage and form variants".'};
    if (a.includes('--check')) { const cur = fs.existsSync(path.join(ROOT, OUT)) ? createHash('sha256').update(fs.readFileSync(path.join(ROOT, OUT))).digest('hex') : null; if (cur !== manifest.sha256) { console.error('DIFFERS ' + OUT); process.exitCode = 1; } return; }
    fs.writeFileSync(path.join(ROOT, OUT), text);
    fs.writeFileSync(path.join(path.dirname(path.join(ROOT, OUT)), 'manifest-variants.json'), JSON.stringify(manifest, null, 1) + '\n');
    console.log(`${OUT}: ${sealedRows.length} rows over ${manifest.forms_with_a_variant} of ${catalog.train_only_forms} train-only forms (${catalog.forms_without_gold_template} without a gold template); rejected ${JSON.stringify(stats.rejected)}`);
  } finally { await lm.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(process.exitCode ?? 0), error => { console.error(error.stack); process.exit(1); });
