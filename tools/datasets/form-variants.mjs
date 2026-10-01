#!/usr/bin/env node
/** Form variants: working-data cases for the forms the evaluation has and the training side lacks (owner decision 2026-09-30; DS008 "Form variants").
 *
 *   node tools/datasets/form-variants.mjs [--catalog eval/reports/current/three-datasets/form-templates.json] [--per-template 3] [--out file] [--apply]
 *
 * Input: the template catalog written by the auditor-side tool tools/eval/form-templates.mjs (delexicalized templates of sealed symbolic_english forms with
 * fewer than five train/dev rows, and hashes of the sealed rows): this generator never reads a sealed row. Deterministic slot substitution keeps the form and
 * changes the proper names, common nouns and the main verb, with replacements drawn from the train/dev side only (given names, surnames and places of the diversity
 * generator; nouns, verbs and proper names of train/dev analyses; a verb is replaced only by a verb that train/dev rows render with the same relation shape and
 * inflection). The expected SOP is the template's gold SOP with the substituted strings. A variant is kept only when SymbolicLM analyses it as the same form,
 * converts it, produces exactly the expected SOP (modulo id renumbering), and it is neither a text duplicate nor a lexical duplicate (identical content words and
 * identical form) of a sealed row (by hash) or of a train/dev row. Rows are tagged `source.corpus: form-variant` with the form id (a hash of the form); no text or
 * id of an evaluation row is kept. Forms only `neuro_english` has cannot be varied mechanically (SymbolicLM fails on them: no expected SOP or verified rewrite);
 * their number is reported for a teacher-generation pass. Without `--apply` nothing in datasets/ is touched.
 *
 * Membership is re-derived on the analysis layer (DS008 "Three datasets"): a variant goes to symbolic_english when every sentence of it passes the analysis gate
 * (identical default/accurate trees and DeepSeek conditions a and c good), else to neuro_english; the exact SOP match stays as `sop_layer`. The first run records
 * the parses and appends the judge items to datasets_sources/resplit_parse_judge/ and refuses `--apply` while a verdict is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {stanzaModelId, SYMBOLIC_LM_VERSION} from '../../lib/symbolic-lm/index.mjs';
import {loadRows} from '../eval/composed/components.mjs';
import {rngOf} from '../eval/composed/compose.mjs';
import {compareParagraph} from '../eval/composed/sop-canon.mjs';
import {openLm, handled} from '../eval/composed/lm.mjs';
import {rulesVersion} from '../eval/composed/rules-version.mjs';
import {GIVEN_NAMES, SURNAMES, PLACES} from './diversity/names.mjs';
import {mainForm, fullForm, analysisWords} from './three-datasets/forms.mjs';
import {lexiconsOf, lexicalize, sha16} from './three-datasets/variants.mjs';
import {normalText} from './three-datasets/inputs.mjs';
import {AnalysisGate} from './three-datasets/analysis-gate.mjs';
import {decideAdditions, placeRow} from './three-datasets/place.mjs';

export const CATALOG_PATH = 'eval/reports/current/three-datasets/form-templates.json';
export const NAMES = {given: GIVEN_NAMES.filter(g => g.gender !== 'x').map(g => g.name), surnames: Object.values(SURNAMES).flat(), places: Object.values(PLACES).flatMap(v => (Array.isArray(v) ? v : String(v).split(';')))};
const formId = form => `form-${sha16(form).slice(0, 10)}`;
export {formId};

export const trainDevSplit = gid => (parseInt(sha16(gid).slice(0, 4), 16) % 10 === 0 ? 'dev' : 'train');

/**
 * Variants of the templates of `catalog` (see the header). `splitOf(gid)` names the split of a variant (`train` or `dev` for working data, `test-variants` for the
 * test-side twin tools/eval/test-variants.mjs); `idPrefix` tags the ids.
 */
export async function build({catalog, lm, perTemplate = 3, seed = 'form-variants-v1', root = ROOT, splitOf = trainDevSplit, idPrefix = 'fv'}) {
  const pool = loadRows('symbolic_english', ['train', 'dev'], root);
  const lex = lexiconsOf(pool);
  const poolTexts = new Set(pool.map(r => normalText(r.message)));
  const sealedTexts = new Set(catalog.sealed.texts), sealedLexical = new Set(catalog.sealed.lexical);
  const lmInfo = {version: SYMBOLIC_LM_VERSION, rules: rulesVersion(root), stanza: stanzaModelId()};
  const rows = [], stats = {forms: catalog.forms.length, forms_without_gold_template: catalog.forms_without_gold_template, attempts: 0, rejected: {}, kept: 0, forms_with_a_variant: 0, neuro_sparse: catalog.neuro_sparse};
  const reject = why => { stats.rejected[why] = (stats.rejected[why] ?? 0) + 1; };
  for (const {form, templates, coverage_before} of catalog.forms) {
    const id = formId(form);
    let n = 0;
    for (const [ti, template] of templates.entries()) for (let k = 0; k < perTemplate * 3; k++) {
      if (n >= templates.length * perTemplate) break;
      const rng = rngOf(`${seed}:${id}:${ti}:${k}`);
      const v = lexicalize(template, lex, NAMES, rng);
      stats.attempts++;
      if (!v) { reject('no_candidate_for_a_slot'); continue; }
      const norm = normalText(v.text);
      if (sealedTexts.has(sha16(norm)) || poolTexts.has(norm)) { reject('duplicate_text'); continue; }
      if (rows.some(r => normalText(r.message) === norm)) { reject('duplicate_variant'); continue; }
      const rec = await lm.run(v.text);
      if (!handled(rec) || rec.sentences.length !== 1) { reject('symbolic_lm_does_not_handle'); continue; }
      if (mainForm({sentences: rec.sentences}) !== form) { reject('form_changed'); continue; }
      if (!compareParagraph(rec.sop, [v.sop]).exact) { reject('sop_differs_from_mapped_gold'); continue; }
      const words = analysisWords({sentences: rec.sentences});
      if (sealedLexical.has(sha16(`${fullForm({sentences: rec.sentences})}#${words.join(' ')}`))) { reject('lexical_duplicate_of_a_sealed_row'); continue; }
      const gid = `${idPrefix}-${id}-${String(n + 1).padStart(3, '0')}`;
      const split = splitOf(gid);
      rows.push({
        id: `${idPrefix === 'fv' ? 'form-variant' : 'test-variant'}::${gid}`, dataset: 'symbolic_english', split, split_group_id: gid, message: v.text,
        source: {corpus: 'form-variant', id: gid, suite: 'form-variant', split, form_id: id, form, semantic_case_id: gid, family: 'form_variant', question_type: null},
        rights: {license: 'MIT (repository LICENSE); original ChatSOP authored text', rights_decision: 'owner-released-inspired-by', inspired_by: [], text_copied: false, inherited_from: 'slot substitution of delexicalized form templates; no text of an evaluation row is kept', spec: 'docs/specs/DS014-source-rights.md'},
        quality_flags: {synthetic: true, human_reviewed: false, training_approved: false, llm_authored: false, form_variant: true}, review_status: 'not_reviewed',
        analysis: {columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences: rec.sentences}, sop: rec.sop, sop_valid: true, outcome: rec.outcome, unparsed: [], uncertain: false,
        gold_sop: v.sop, analysis_verified: 'gold_sop_match', verification: {sop_gold_match: true, judge: null, stanza_spacy_agree: null, stanza_default_accurate: 'not_measured', form_variant: true, substitutions: v.changes},
        symbolic_lm: lmInfo, form_variant: {form_id: id, form, train_dev_coverage_before: coverage_before},
      });
      n++; stats.kept++;
    }
    if (n) stats.forms_with_a_variant++;
  }
  return {rows, stats};
}

/** A variant row of `build` in its dataset by the analysis gate (place.mjs). */
export function placeVariant(row, decision) {
  const {dataset: _dataset, gold_sop, analysis_verified: _av, verification, ...base} = row;
  const {sop_gold_match, judge: _j, stanza_spacy_agree: _s, stanza_default_accurate: _d, ...extra} = verification;
  return placeRow(base, decision, {gold_sop, sopMatch: sop_gold_match, verification: extra, failureExtra: {form_variant: true}});
}

const parseArgs = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

/** Replace the form-variant rows of datasets/{symbolic_english,neuro_english}/{train,dev}.jsonl and refresh the manifests. */
export async function apply(rows) {
  const {writeSplit, summarise, updateManifest} = await import('./three-datasets/write.mjs');
  for (const dataset of ['symbolic_english', 'neuro_english']) for (const split of ['train', 'dev']) {
    const kept = readJsonlShardedSync(path.join(ROOT, 'datasets', dataset, `${split}.jsonl`)).filter(r => r.source?.corpus !== 'form-variant');
    const added = rows.filter(r => r.dataset === dataset && r.split === split);
    const all = [...kept, ...added];
    const written = await writeSplit(dataset, split, all);
    updateManifest(dataset, {sha256: {[written.path]: written.sha256}, bytes: {[written.path]: written.bytes}, counts: {[split]: summarise(dataset, all)}});
    console.log(`${written.path}: ${kept.length} kept + ${added.length} form variants`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  const catalogFile = path.resolve(ROOT, o.catalog ?? CATALOG_PATH);
  if (!fs.existsSync(catalogFile)) { console.error(`missing ${path.relative(ROOT, catalogFile)}; write it with node tools/eval/form-templates.mjs`); process.exit(1); }
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const lm = await openLm();
  try {
    const built = await build({catalog, lm, perTemplate: Number(o['per-template'] ?? 3)});
    const {stats} = built;
    console.log(JSON.stringify(stats));
    const gate = new AnalysisGate();
    const {decisions, summary} = await decideAdditions(gate, built.rows, {record: !o.dry, log: m => process.stderr.write(m + '\n')});
    const pending = built.rows.filter(r => decisions.get(r.message).state === 'pending').length;
    const rows = built.rows.map(r => placeVariant(r, decisions.get(r.message)));
    const placed = rows.reduce((a, r) => { a[r.dataset] = (a[r.dataset] ?? 0) + 1; return a; }, {});
    console.log(JSON.stringify({gate: summary, placed, pending}));
    if (o.out) fs.writeFileSync(path.resolve(ROOT, o.out), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    if (o.apply && pending) { console.error(`${pending} variants have no analysis verdict yet: run the judge task on datasets_sources/resplit_parse_judge/ and run again; nothing applied`); process.exitCode = 2; }
    else if (o.apply) await apply(rows);
    fs.mkdirSync(path.join(ROOT, 'eval/reports/current/composed-eval'), {recursive: true});
    fs.writeFileSync(path.join(ROOT, 'eval/reports/current/composed-eval/form-variants-report.json'), JSON.stringify({generated_at: new Date().toISOString(), applied: Boolean(o.apply) && !pending, pending, placed, gate: summary, catalog: path.relative(ROOT, catalogFile), stats, by_split: rows.reduce((a, r) => { a[r.split] = (a[r.split] ?? 0) + 1; return a; }, {})}, null, 1) + '\n');
  } finally { await lm.close(); }
  process.exit(0);
}
