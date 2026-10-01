#!/usr/bin/env node
/** Long working-data cases of the composed kinds for the training side (owner request 2026-09-30; DS008 "Composed training cases").
 *
 *   node tools/datasets/composed-train.mjs [--dry] [--out scratch.jsonl] [--seed S] [--apply]
 *
 * Builds paragraphs of self-contained sentences from TRAIN rows (train cases) and DEV rows (dev cases) only, never from the sealed
 * test, so the composed evaluation suites (tools/eval/composed-suites.mjs) and these cases never share a component:
 *   identity       symbolic_english: 2 to 8 known-good sentences; SymbolicLM must analyse the paragraph as the concatenation of its parts
 *                  (checked when the case is built: the case is dropped otherwise); the SymbolicProofingLLM target is the text itself
 *   mixed          neuro_english: symbolic sentences (unchanged) around neuro sentences that have a verified target (replaced)
 *   decomposition  neuro_english: as mixed, the changed sentences being decomposition cases (several finite clauses, target of several simple sentences)
 * bad_english gets no composed paragraphs: both proofing models work one sentence at a time (owner decision 2026-09-30).
 * Rows carry `composed: true`, their components and `source.corpus: composed`. Without `--apply` nothing in datasets/ is touched; with
 * it the rows replace the previous composed rows of datasets/<dataset>/{train,dev}.jsonl and the manifests are updated. Run it after
 * every rebuild of the three datasets (tools/datasets/build-three-datasets.mjs), so a rebuild keeps them.
 *
 * Membership is re-derived on the analysis layer like that of every clean-English row (DS008 "Three datasets"): the paragraph goes to symbolic_english when
 * every sentence of it passes the analysis gate (identical default/accurate trees, DeepSeek conditions a and c good), else to neuro_english; its SOP comparison
 * stays as `sop_layer`. The gate needs parses and judge verdicts of the paragraphs: the first run records them and appends the missing items to
 * datasets_sources/resplit_parse_judge/ and refuses to `--apply` while a verdict is missing (run the judge task, then run again).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {stanzaModelId, SYMBOLIC_LM_VERSION} from '../../lib/symbolic-lm/index.mjs';
import {loadPools, loadRows, neuroComponent} from '../eval/composed/components.mjs';
import {composeK1, composeMixed, caseRow} from '../eval/composed/compose.mjs';
import {compareParagraph} from '../eval/composed/sop-canon.mjs';
import {openLm, handled} from '../eval/composed/lm.mjs';
import {rulesVersion} from '../eval/composed/rules-version.mjs';
import {classifyRow} from './three-datasets/decomposition.mjs';
import {AnalysisGate} from './three-datasets/analysis-gate.mjs';
import {decideAdditions, placeRow} from './three-datasets/place.mjs';

export const SIZES = {train: {identity: [[2, 12], [3, 12], [4, 12], [6, 12], [8, 12]], mixed: [[2, 1, 10], [3, 1, 10], [4, 2, 10], [6, 3, 10], [8, 2, 10], [5, 1, 10]], decomposition: [[2, 1, 12], [3, 1, 12], [4, 1, 12], [4, 2, 12], [6, 2, 12]]},
  dev: {identity: [[2, 3], [4, 3], [6, 3]], mixed: [[3, 1, 3], [4, 2, 3], [6, 3, 3]], decomposition: [[2, 1, 3], [3, 1, 3], [4, 2, 3]]}};

const analysisOfParagraph = rec => ({columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences: rec.sentences});

function rowOf({dataset, split, kind, base, rec, lmInfo, exactExpected}) {
  const common = {
    id: `composed::${base.id}`, dataset, split, split_group_id: base.id, message: base.message,
    source: {corpus: 'composed', id: base.id, suite: 'composed', split, kind: base.kind, semantic_case_id: base.id, family: `composed_${kind}`, question_type: null},
    rights: base.rights, quality_flags: {...base.quality_flags, training_approved: false}, review_status: 'not_reviewed',
    composed: true, composed_kind: kind, n_components: base.n_components, components: base.components, composer: base.composer, expected_text: base.expected_text,
    analysis: analysisOfParagraph(rec), sop: rec.sop, sop_valid: rec.valid, outcome: rec.outcome, unparsed: rec.unparsed, uncertain: rec.uncertain,
    symbolic_lm: lmInfo,
  };
  if (dataset === 'symbolic_english') {
    return {...common, gold_sop: base.expected_sop, analysis_verified: 'gold_sop_match',
      verification: {sop_gold_match: true, judge: null, stanza_spacy_agree: null, stanza_default_accurate: 'not_measured', composed_from_verified_components: true}};
  }
  return {...common, target: base.expected_text, target_source: 'composed', targets: [{text: base.expected_text, source: 'composed', check: {composed_from_verified_targets: true}}], rewrite_target: true,
    failure_kind: 'unknown', failure: {classes: [], categories: [], frame_recoverable: false, proofing_layer: null, also_gold_convention: false, unparsed: rec.unparsed, composed: true}, gold_sop: base.expected_sop_complete ? base.expected_sop : null,
    analysis_verified: 'composed_from_verified_components', verification: {sop_gold_match: base.expected_sop_complete ? exactExpected : null, judge: null, stanza_spacy_agree: null, stanza_default_accurate: 'not_measured', composed_from_verified_components: true}};
}

/** Decomposition components: neuro components whose verified target splits a multi-clause message. */
function decompositionPool(splits, root) {
  const out = [];
  for (const row of loadRows('neuro_english', splits, root)) {
    if (!classifyRow(row).decomposition) continue;
    const {component} = neuroComponent(row);
    if (component) out.push({...component, decomposition: true});
  }
  return out;
}

/** All composed rows of one split (`train` or `dev`), verified with SymbolicLM. */
export async function build({split, seed = 'composed-train-v1', root = ROOT, lm}) {
  const pools = loadPools([split], root);
  const S = pools.symbolic.components, N = pools.neuro.components.filter(c => !c.decomposition), D = decompositionPool([split], root);
  const lmInfo = {version: SYMBOLIC_LM_VERSION, rules: rulesVersion(root), stanza: stanzaModelId()};
  const sizes = SIZES[split], out = [], report = {split, pools: {symbolic: S.length, neuro: N.length, decomposition: D.length}, dropped: {}};
  const drop = (kind, why) => { const key = `${kind}:${why}`; report.dropped[key] = (report.dropped[key] ?? 0) + 1; };

  const take = async (candidates, kind, dataset, limits) => {
    const left = new Map(limits);
    for (const base of candidates) {
      const key = base.stratum;
      if (!left.get(key)) continue;
      const rec = await lm.run(base.message);
      const expectedPrograms = base.components.map(c => c.expected_sop);
      const complete = base.expected_sop_complete;
      const exact = complete ? compareParagraph(rec.sop, expectedPrograms).exact : null;
      if (dataset === 'symbolic_english') { if (!exact || !handled(rec)) { drop(kind, 'paragraph_not_equal_to_components'); continue; } }
      else if (exact === true) { drop(kind, 'symbolic_lm_already_correct'); continue; }
      out.push(rowOf({dataset, split, kind, base, rec, lmInfo, exactExpected: exact}));
      left.set(key, left.get(key) - 1);
    }
    for (const [k, n] of left) if (n) report.dropped[`${kind}:short:${k}`] = n;
  };

  // Candidates are generated with margin (x3) and taken until each stratum is full.
  const ident = sizes.identity.flatMap(([n, per]) => composeK1(S, {counts: [n], perCount: per * 3, seed: `${seed}:identity`}).map(c => ({...c, stratum: `n${n}`})));
  await take(ident, 'identity', 'symbolic_english', sizes.identity.map(([n, per]) => [`n${n}`, per]));
  const mixedSpecs = sizes.mixed.map(([n, m]) => [n, m]);
  const mixedRows = sizes.mixed.flatMap(([n, m, per]) => composeMixed({kind: 'K2', dataset: 'neuro_english', symbolic: S, changed: N, specs: [[n, m]], perSpec: per * 3, seed: `${seed}:mixed`}));
  void mixedSpecs;
  await take(mixedRows, 'mixed', 'neuro_english', sizes.mixed.map(([n, m, per]) => [`n${n}m${m}`, per]));
  const decompRows = D.length ? sizes.decomposition.flatMap(([n, m, per]) => composeMixed({kind: 'K2', dataset: 'neuro_english', symbolic: S, changed: D, specs: [[n, m]], perSpec: per * 3, seed: `${seed}:decomposition`})) : [];
  await take(decompRows, 'decomposition', 'neuro_english', sizes.decomposition.map(([n, m, per]) => [`n${n}m${m}`, per]));
  // ids: keep the kind in the id so identity, mixed and decomposition rows of the same size never collide.
  const seen = new Map();
  for (const r of out) { const k = `${r.composed_kind}:${r.split_group_id}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  out.forEach(r => { const id = `composed-${split}-${r.composed_kind}-${r.split_group_id.replace(/^composed-k[0-9]-/, '')}`; r.split_group_id = id; r.id = `composed::${id}`; r.source.id = id; r.source.semantic_case_id = id; });
  report.rows = out.length;
  report.by_kind = out.reduce((o, r) => { o[r.composed_kind] = (o[r.composed_kind] ?? 0) + 1; return o; }, {});
  return {rows: out, report};
}

/** A candidate row of `build` in its dataset by the analysis gate (place.mjs). */
export function placeComposed(row, decision) {
  const {dataset: _dataset, gold_sop, analysis_verified: _av, verification, target, target_source, targets, rewrite_target: _rt, failure_kind: _fk, failure: _f, flags: _flags, ...base} = row;
  return placeRow(base, decision, {gold_sop, sopMatch: verification.sop_gold_match, target: target ?? null, targetSource: target_source ?? null, targets: targets ?? [], verification: {composed_from_verified_components: true}, failureExtra: {composed: true}});
}

const parseArgs = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

/** Replace the composed rows of datasets/<dataset>/<split>.jsonl and refresh the manifest. */
export async function apply(rows) {
  const {writeSplit, summarise, updateManifest} = await import('./three-datasets/write.mjs');
  for (const dataset of ['symbolic_english', 'neuro_english']) for (const split of ['train', 'dev']) {
    const file = path.join(ROOT, 'datasets', dataset, `${split}.jsonl`);
    const kept = readJsonlShardedSync(file).filter(r => r.source?.corpus !== 'composed');
    const added = rows.filter(r => r.dataset === dataset && r.split === split);
    const all = [...kept, ...added];
    const written = await writeSplit(dataset, split, all);
    updateManifest(dataset, {sha256: {[written.path]: written.sha256}, bytes: {[written.path]: written.bytes}, counts: {[split]: summarise(dataset, all)}});
    console.log(`${written.path}: ${kept.length} kept + ${added.length} composed`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  const lm = await openLm();
  try {
    const candidates = [], reports = [];
    for (const split of ['train', 'dev']) { const {rows, report} = await build({split, lm, seed: o.seed ?? 'composed-train-v1'}); candidates.push(...rows); reports.push(report); console.log(JSON.stringify(report)); }
    // Analysis-layer membership: record the parses and judge items the gate lacks, then place every paragraph.
    const gate = new AnalysisGate();
    const {decisions, summary} = await decideAdditions(gate, candidates, {record: !o.dry, log: m => process.stderr.write(m + '\n')});
    console.log(JSON.stringify({gate: summary}));
    const pending = candidates.filter(r => decisions.get(r.message).state === 'pending').length;
    const all = candidates.map(r => placeComposed(r, decisions.get(r.message)));
    const placed = {};
    for (const r of all) placed[`${r.composed_kind}:${r.dataset}`] = (placed[`${r.composed_kind}:${r.dataset}`] ?? 0) + 1;
    console.log(JSON.stringify({placed, pending}));
    if (o.out) fs.writeFileSync(path.resolve(ROOT, o.out), all.map(r => JSON.stringify(r)).join('\n') + '\n');
    if (o.apply && pending) { console.error(`${pending} paragraphs have no analysis verdict yet: run the judge task on datasets_sources/resplit_parse_judge/ and run again; nothing applied`); process.exitCode = 2; }
    else if (o.apply) await apply(all);
    fs.mkdirSync(path.join(ROOT, 'eval/reports/current/composed-eval'), {recursive: true});
    fs.writeFileSync(path.join(ROOT, 'eval/reports/current/composed-eval/composed-train-report.json'), JSON.stringify({generated_at: new Date().toISOString(), applied: Boolean(o.apply) && !pending, pending, placed, gate: summary, reports}, null, 1) + '\n');
  } finally { await lm.close(); }
  process.exit(process.exitCode ?? 0);
}
