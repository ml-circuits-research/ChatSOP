#!/usr/bin/env node
/** Builder of the composed evaluation suites (owner request 2026-09-30; DS008 "Composed evaluation suites").
 *
 *   node tools/eval/composed-suites.mjs [--seed composed-v1] [--out-root eval/suites] [--check]
 *
 * Reads the sealed test rows only (eval/suites/{symbolic_english,neuro_english,bad_english}/test.jsonl) and writes new sealed files
 * next to them, deterministic for a given seed and given test files:
 *   eval/suites/symbolic_english/test-composed.jsonl   K1 all symbolic (2, 3, 5, 8 sentences), K3 identity long (single long
 *                                                       sentences and 12 to 48 sentence paragraphs), K5 reference across sentences
 *   eval/suites/neuro_english/test-composed.jsonl      K2 mixed symbolic and neuro (neuro sentences have a verified rewrite target), K6 decomposition
 *   eval/suites/bad_english/test-composed.jsonl        K4 clean sentences among bad ones that have a clean target, K6 decomposition
 * and manifest-composed.json in each folder (counts, hashes of the source test files, seed). `--check` rebuilds in memory and
 * exits 1 when a file on disk differs. Components are self-contained single sentences (see components.mjs); the training-side twin
 * (tools/datasets/composed-train.mjs) composes from train/dev rows only, so the two never share a component.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {loadSealedPools, loadSealedRows} from './composed/sealed.mjs';
import {composeK1, composeK3, composeK5, composeK6, composeMixed, COMPOSER_VERSION} from './composed/compose.mjs';
import {concatCanonical} from './composed/sop-canon.mjs';

export const SUITE_FILES = {symbolic_english: 'test-composed.jsonl', neuro_english: 'test-composed.jsonl', bad_english: 'test-composed.jsonl'};
const sha = data => createHash('sha256').update(data).digest('hex');

/** Fields the audit page reads for each dataset type, derived from the components (view only). */
export function auditFields(row, analysisOf) {
  if (row.dataset === 'symbolic_english') {
    const analyses = row.components.map(c => analysisOf.get(c.source_id)).filter(Boolean);
    const sentences = analyses.length === row.components.length ? analyses.flatMap(a => a.sentences) : null;
    return {analysis: sentences ? {columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences} : null, sop: row.expected_sop, sop_valid: Boolean(row.expected_sop), outcome: 'converted', unparsed: [], analysis_verified: 'composed_from_verified_components', verification: {analysis_verified: 'composed_from_verified_components', sop_gold_match: null, judge: null, stanza_spacy_agree: null, stanza_default_accurate: 'identical'}, symbolic_lm: null, gold_sop: null};
  }
  if (row.dataset === 'neuro_english') return {targets: [{text: row.expected_text, source: 'composed'}], target: row.expected_text, rewrite_target: true, failure_kind: 'unknown', failure: {classes: [], categories: [], composed: true}, analysis: null, sop: row.expected_sop, verification: {analysis_verified: 'composed_from_verified_components', sop_gold_match: null}, symbolic_lm: null};
  return {targets: [{text: row.expected_text, source: 'composed'}], target: row.expected_text, language_kind: 'composed', language: 'en', noise_categories: [], gate_reasons: []};
}

export function build({root = ROOT, seed = COMPOSER_VERSION} = {}) {
  const pools = loadSealedPools(root);
  const S = pools.symbolic.components;
  const analysisOf = new Map(S.map(c => [c.source_id, c.analysis]));
  const suites = {
    symbolic_english: [...composeK1(S, {seed: `${seed}:k1`}), ...composeK3(S, {seed: `${seed}:k3`}), ...composeK5(S, {seed: `${seed}:k5`})],
    neuro_english: [...composeMixed({kind: 'K2', dataset: 'neuro_english', symbolic: S, changed: pools.neuro.components, seed: `${seed}:k2`}), ...composeK6(loadSealedRows('neuro_english', root), {dataset: 'neuro_english', seed: `${seed}:k6`})],
    bad_english: [...composeMixed({kind: 'K4', dataset: 'bad_english', symbolic: S, changed: pools.bad.components, seed: `${seed}:k4`}), ...composeK6(loadSealedRows('bad_english', root), {dataset: 'bad_english', seed: `${seed}:k6`})],
  };
  const out = {};
  for (const [dataset, rows] of Object.entries(suites)) {
    const full = rows.map(r => ({...r, ...auditFields(r, analysisOf)})).sort((a, b) => a.id.localeCompare(b.id));
    const text = full.map(r => JSON.stringify(r)).join('\n') + '\n';
    const count = key => full.reduce((o, r) => { const v = typeof key === 'function' ? key(r) : r[key]; o[v] = (o[v] ?? 0) + 1; return o; }, {});
    const sourceFile = `eval/suites/${dataset}/test.jsonl`;
    const sourceHash = sha(fs.readFileSync(path.join(root, sourceFile)));
    out[dataset] = {rows: full, text, manifest: {
      format: 'chatsop-composed-manifest-v1', dataset, split: 'test-composed', sealed: true, view_only: true, composer: COMPOSER_VERSION, seed,
      path: `eval/suites/${dataset}/${SUITE_FILES[dataset]}`, rows: full.length, sha256: sha(text), bytes: Buffer.byteLength(text),
      source_test_file: sourceFile, source_test_sha256: sourceHash,
      counts: {by_kind: count('kind'), by_stratum: count(r => `${r.kind}:${r.stratum}`), by_sentences: count('n_sentences'), by_components: count('n_components'), symbolic_components_pool: S.length, neuro_components_pool: pools.neuro.components.length, bad_components_pool: pools.bad.components.length, component_rejections: {symbolic: pools.symbolic.rejected, neuro: dataset === 'neuro_english' ? pools.neuro.rejected : undefined, bad: dataset === 'bad_english' ? pools.bad.rejected : undefined}},
      purpose: {
        symbolic_english: 'Paragraphs of known-good symbolic sentences (K1), long identity paragraphs (K3) and pronoun-reference paragraphs (K5). Measures whether SymbolicLM still passes every known form when there are many, and whether a rewriter leaves clean text untouched at length.',
        neuro_english: 'K2: paragraphs mixing symbolic sentences (must stay unchanged) with neuro sentences that have a verified rewrite target (must be replaced). Evaluates SymbolicProofingLLM on longer inputs.',
        bad_english: 'K4: paragraphs mixing clean sentences (must stay unchanged) with Romanian, mixed or noisy sentences that have a clean target (must be replaced). Evaluates LanguageProofingLLM on longer inputs.',
      }[dataset],
      built_at: new Date().toISOString(),
    }};
  }
  return out;
}

const parseArgs = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(ROOT, o['out-root'] ?? 'eval/suites');
  const built = build({seed: o.seed ?? COMPOSER_VERSION});
  let differ = 0;
  for (const [dataset, {text, manifest}] of Object.entries(built)) {
    const file = path.join(outRoot, dataset, SUITE_FILES[dataset]);
    if (o.check) { if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== manifest.sha256) { differ++; console.error(`DIFFERS ${path.relative(ROOT, file)}`); } continue; }
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, text);
    fs.writeFileSync(path.join(outRoot, dataset, 'manifest-composed.json'), JSON.stringify(manifest, null, 1) + '\n');
    console.log(`${path.relative(ROOT, file)}: ${manifest.rows} rows ${JSON.stringify(manifest.counts.by_kind)} sha256 ${manifest.sha256.slice(0, 12)}`);
  }
  if (differ) process.exitCode = 1;
}
