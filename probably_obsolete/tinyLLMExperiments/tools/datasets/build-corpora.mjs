#!/usr/bin/env node
/** Build the model-language corpora (DS022 "Corpora"): the main corpus `formalizer-v1` and the
 * out-of-distribution suite `formalizer-ood-v1`, generated through the IR (tools/datasets/diversity/) with the
 * `strings` printer.
 *
 *   datasets_archive/formalizer-v1/{train,dev}.jsonl, manifest.json, report.json
 *   eval/suites/formalizer-v1/test.jsonl (sealed, held-out resources)
 *   eval/suites/formalizer-ood-v1/test.jsonl, manifest.json (held-out domains, constructions and frames)
 *
 *   node tools/datasets/build-corpora.mjs [--rows 34000] [--ood-rows 1600] [--seed chatsop-formalizer-v1] [--dry-run]
 *
 * Every row's target is linked back to its evaluation-only verification world and executed there; a row whose
 * strings do not link or whose observed status disagrees with the family's intended status is excluded and
 * counted in the report. The build fails (exit 1) on a quota violation or a no-copy failure. No training, no
 * model, no GPU; the corpora are synthetic and unreviewed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, OOD_FAMILY_WEIGHTS, OOD_CONSTRUCTION_FAMILY_WEIGHTS, sharedWorld } from './diversity/generate.mjs';
import { isOodOnly, rowResources, OOD_ONLY_FORMS, OOD_ONLY_SHAPES, OOD_ONLY_FRAMES } from './diversity/heldout.mjs';
import crypto from 'node:crypto';
import { diversityMetrics, quotaViolations, QUOTAS } from './diversity/quotas.mjs';
import { NOISE_LEVELS } from './diversity/noise.mjs';
import { checkNoCopy } from './no-copy.mjs';
import { manifestRights } from './rights.mjs';
import { writeJsonlShardedSync, hashJsonlSharded } from '../../lib/jsonl-shards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const rows = Number(value('rows', 34000));
const oodRows = Number(value('ood-rows', 1600));
const seed = value('seed', 'chatsop-formalizer-v1');
const MAIN = 'formalizer-v1', OOD = 'formalizer-ood-v1';
const SOURCES = ['qqp', 'paws', 'proofwriter', 'ambignq', 'qa2d', 'squad'];
const inventoryPath = path.join(root, 'datasets_archive/diversity/inventory.json');
const inventory = fs.existsSync(inventoryPath) ? JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) : null;

const tally = (list, key) => list.reduce((t, row) => { const k = typeof key === 'function' ? key(row) : row[key]; t[k ?? 'none'] = (t[k ?? 'none'] ?? 0) + 1; return t; }, {});
const sorted = object => Object.fromEntries(Object.entries(object).sort((a, b) => b[1] - a[1]));
const log = message => process.stderr.write(`[build-corpora] ${message}\n`);

/** Keep rows whose strings link to the verification world and whose execution agrees with the intended status. */
function verified(generated) {
  const excluded = [];
  const kept = generated.filter(row => {
    const reason = row.verification?.link_problems?.length ? 'link_problems'
      : row.execution?.executed && !row.execution.agrees_with_intended ? 'status_disagreement'
        : row.verification?.second_query_disagreement ? 'second_query_disagreement' : null;
    if (reason) excluded.push({ id: row.id, family: row.family, variant: row.variant, reason, detail: row.verification?.link_problems ?? row.execution?.status });
    return !reason;
  });
  // A connected group is kept whole or not at all, so contrast pairs never lose their partner.
  const dropped = new Set(excluded.map(item => generated.find(row => row.id === item.id)?.split_group_id));
  return { kept: kept.filter(row => !dropped.has(row.split_group_id)), excluded };
}

/** Length distribution in approximate tokens (characters / 4): output length drives CPU latency. */
function lengths(values) {
  const sorted = values.map(chars => Math.ceil(chars / 4)).sort((a, b) => a - b);
  const at = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
  return { unit: 'tokens ~ characters / 4', mean: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: sorted.at(-1) ?? null };
}
function lengthSummary(list) {
  const bySplit = split => list.filter(row => row.split === split);
  const one = rows => ({ rows: rows.length, message: lengths(rows.map(row => row.question.length)), target: lengths(rows.map(row => (row.sop_target ?? '').length)),
    messages_over_500_chars: rows.filter(row => row.question.length > 500).length, long_message_rows: rows.filter(row => row.family === 'long_message').length });
  return { all: one(list), ...Object.fromEntries(['train', 'dev', 'test'].filter(split => bySplit(split).length).map(split => [split, one(bySplit(split))])) };
}

function summary(list) {
  return {
    lengths: lengthSummary(list),
    rows: list.length, by_split: tally(list, 'split'), by_family: sorted(tally(list, 'family')), by_question_type: sorted(tally(list, 'question_type')),
    by_language: sorted(tally(list, row => row.code_switch ? `${row.language}+switch` : row.language)), by_expected_status: sorted(tally(list, row => row.expected?.status)),
    by_noise_level: sorted(tally(list, row => row.noise_level ?? 'clean')), code_switch_kinds: sorted(tally(list.filter(row => row.code_switch), row => row.code_switch.kind)),
    noise_ops: sorted(tally(list.flatMap(row => (row.noise ?? []).map(op => ({ op: op.kind ? `typo:${op.kind}` : op.op }))), 'op')),
    assumed_basis: sorted(tally(list.flatMap(row => (row.surface_ir?.assumed ?? []).map(a => ({ basis: a.basis ?? 'unspecified' }))), 'basis')),
    unclear_kinds: sorted(tally(list.filter(row => row.surface_ir?.unclear), row => row.surface_ir.unclear.kind)),
  };
}

/** Generate one pool and keep the rows whose target links to and executes in its verification world. */
async function generateVerified({ name, pool, target, familyWeights, splits, groupPrefix, buildSeed, worldDir }) {
  const started = performance.now();
  const { rows: generated, problems } = await generate({ seed: buildSeed, rows: target, inventory, pool, familyWeights, splits, groupPrefix, worldDir, onProgress: n => log(`${name}: ${n} rows`) });
  const { kept, excluded } = verified(generated);
  return { generated, kept, excluded, problems, elapsed_ms: Math.round(performance.now() - started) };
}

/** Diversity metrics, quotas and the no-copy check of a finished row set. */
async function finish(name, pool, parts) {
  const kept = parts.flatMap(part => part.kept);
  const metrics = diversityMetrics(kept);
  const bySplit = Object.fromEntries(['train', 'dev', 'test'].filter(split => kept.some(row => row.split === split)).map(split => [split, diversityMetrics(kept.filter(row => row.split === split))]));
  // The OOD suite reuses a small set of held-out frames by design, so frame and template concentration quotas do not apply to it.
  const violations = pool === 'main' ? quotaViolations(metrics, kept, { minRows: 200 }) : quotaViolations(metrics, kept, { minRows: 200, mix: false }).filter(v => !/^language|^unclear share|^family .* (share|target skeletons)|^target skeletons|question frame|template/.test(v));
  const noCopy = await checkNoCopy(kept.map(row => ({ row, split: row.split })), { name });
  return { generated: parts.flatMap(part => part.generated), kept, excluded: parts.flatMap(part => part.excluded), problems: parts.flatMap(part => part.problems),
    metrics, bySplit, violations, noCopy, elapsed_ms: parts.reduce((sum, part) => sum + part.elapsed_ms, 0) };
}

const MAIN_WORLD = `datasets_archive/${MAIN}/world`, OOD_WORLD = `eval/suites/${OOD}/world`;
const mainPart = await generateVerified({ name: MAIN, pool: 'main', target: rows, buildSeed: seed, groupPrefix: 'fv1', worldDir: MAIN_WORLD });
// The OOD suite has two axes (DS022 "Out-of-distribution suite"): held-out domains (predicates never in
// formalizer-v1) and held-out constructions (in-distribution predicates realized only through constructions and
// frames that never occur in formalizer-v1 train/dev). Both use the `ood` resource partition (heldout.mjs).
const domainRows = Math.round(oodRows * 0.6);
const oodDomain = await generateVerified({ name: `${OOD}:domain`, pool: 'ood', target: domainRows, buildSeed: `${seed}:ood`, familyWeights: OOD_FAMILY_WEIGHTS, splits: () => 'ood', groupPrefix: 'ood1', worldDir: OOD_WORLD });
const oodConstruction = await generateVerified({ name: `${OOD}:construction`, pool: 'ood_construction', target: oodRows - domainRows, buildSeed: `${seed}:ood-construction`, familyWeights: OOD_CONSTRUCTION_FAMILY_WEIGHTS, splits: () => 'ood', groupPrefix: 'ood2', worldDir: OOD_WORLD });
for (const row of oodDomain.kept) row.ood_axis = 'domain';
for (const row of oodConstruction.kept) row.ood_axis = 'construction';

// Held-out guarantee. No formalizer-v1 row may use an OOD-only resource; an OOD row that uses a lead-in frame or a
// construction of formalizer-v1 train/dev (a fallback when no reserved option fitted), or repeats a formalizer-v1
// message, is dropped with its whole split group.
const mainOodUse = mainPart.kept.filter(row => (row.surface_design?.resources ?? []).some(isOodOnly)).map(row => row.id);
const development = mainPart.kept.filter(row => row.split !== 'test');
const seenFrames = new Set(development.flatMap(row => rowResources(row).frames));
const seenConstructions = new Set(development.flatMap(row => rowResources(row).constructions));
const fold = text => text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const mainMessages = new Set(mainPart.kept.map(row => fold(row.question)));
const overlapReason = row => {
  const { frames, constructions } = rowResources(row);
  if (frames.some(id => seenFrames.has(id))) return 'frame_in_train_dev';
  if (constructions.some(id => seenConstructions.has(id))) return 'construction_in_train_dev';
  if (mainMessages.has(fold(row.question))) return 'message_in_formalizer_v1';
  return null;
};
for (const part of [oodDomain, oodConstruction]) {
  const dropped = new Map();
  for (const row of part.kept) { const reason = overlapReason(row); if (reason && !dropped.has(row.split_group_id)) dropped.set(row.split_group_id, reason); }
  part.overlapDropped = [...dropped].map(([group, reason]) => ({ group, reason }));
  part.kept = part.kept.filter(row => !dropped.has(row.split_group_id));
}
const main = await finish(MAIN, 'main', [mainPart]);
const ood = await finish(OOD, 'ood', [oodDomain, oodConstruction]);

/** Resource overlap of a sealed suite with formalizer-v1 train/dev (0 = fully held out). */
function overlapMetrics(list) {
  const share = (predicate, applicable = () => true) => { const rows = list.filter(applicable); const hit = rows.filter(predicate).length; return { numerator: hit, denominator: rows.length, value: rows.length ? hit / rows.length : null }; };
  const res = row => rowResources(row);
  const heldForm = row => (OOD_ONLY_FORMS[row.language] ?? []).includes(row.surface_design?.form) || (OOD_ONLY_SHAPES[row.language] ?? []).includes(row.surface_design?.shape);
  return {
    frame_overlap: share(row => res(row).frames.some(id => seenFrames.has(id)), row => res(row).frames.length > 0),
    construction_overlap: share(row => res(row).constructions.some(id => seenConstructions.has(id)), row => res(row).constructions.length > 0),
    uses_ood_only_resource: share(row => (row.surface_design?.resources ?? []).some(isOodOnly)),
    held_out_form_or_shape: share(heldForm),
    ...(list.some(row => row.ood_axis) ? { by_axis: Object.fromEntries(['domain', 'construction'].map(axis => [axis, {
      frame_overlap: share(row => res(row).frames.some(id => seenFrames.has(id)), row => row.ood_axis === axis && res(row).frames.length > 0),
      construction_overlap: share(row => res(row).constructions.some(id => seenConstructions.has(id)), row => row.ood_axis === axis && res(row).constructions.length > 0),
      rows: list.filter(row => row.ood_axis === axis).length }])) } : {}),
    definition: 'Share of rows whose lead-in frames (surface_design.question_frame, .discourse) or realization constructions (construction ids in surface_design.resources) occur in any formalizer-v1 train or dev row.',
  };
}
const overlap = { [`${MAIN}:test`]: overlapMetrics(main.kept.filter(row => row.split === 'test')), [OOD]: overlapMetrics(ood.kept),
  formalizer_v1_rows_using_ood_only_resources: mainOodUse.length, ood_rows_dropped_for_overlap: [oodDomain, oodConstruction].reduce((n, part) => n + part.overlapDropped.length, 0) };
log(`overlap: ${JSON.stringify(overlap)}`);

if (args.includes('--dry-run')) {
  // Measure only: nothing is written (for trying generator changes without touching the corpora).
  console.log(JSON.stringify({ dry_run: true, [MAIN]: { kept: main.kept.length, problems: main.problems.length, problem_kinds: tally(main.problems.map(p => ({ k: p.error.replace(/[a-z0-9]+_\d+(_\d+)*/g, "#").slice(0, 90) })), "k"), violations: main.violations, no_copy: main.noCopy.pass },
    [OOD]: { kept: ood.kept.length, by_axis: tally(ood.kept, 'ood_axis'), problems: ood.problems.length, problem_examples: ood.problems.slice(0, 5), dropped: [...oodDomain.overlapDropped, ...oodConstruction.overlapDropped].reduce((t, d) => (t[d.reason] = (t[d.reason] ?? 0) + 1, t), {}), violations: ood.violations, no_copy: ood.noCopy.pass }, overlap }, null, 1));
  process.exit(0);
}
const mainDir = path.join(root, 'datasets_archive', MAIN), mainSuite = path.join(root, 'eval/suites', MAIN), oodSuite = path.join(root, 'eval/suites', OOD);
for (const dir of [mainDir, mainSuite, oodSuite]) fs.mkdirSync(dir, { recursive: true });
// Every file is written through lib/jsonl-shards.mjs: a split above 45 MB becomes `<name>.part-NNN.jsonl` parts
// (no repository file may exceed 50 MB); the manifest records the sha256 of the logical (concatenated) file.
const splitRows = {
  [`datasets_archive/${MAIN}/train.jsonl`]: main.kept.filter(row => row.split === 'train'),
  [`datasets_archive/${MAIN}/dev.jsonl`]: main.kept.filter(row => row.split === 'dev'),
  [`eval/suites/${MAIN}/test.jsonl`]: main.kept.filter(row => row.split === 'test'),
  [`eval/suites/${OOD}/test.jsonl`]: ood.kept,
};
const files = {};
// The shared verification world (predicate declarations, converse rules) is written once per corpus; rows reference it.
const worldFiles = {};
for (const dir of [MAIN_WORLD, OOD_WORLD]) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const [name, text] of Object.entries(sharedWorld().files)) { fs.writeFileSync(path.join(root, dir, name), text); worldFiles[`${dir}/${name}`] = crypto.createHash('sha256').update(text).digest('hex'); }
}
for (const [file, list] of Object.entries(splitRows)) {
  writeJsonlShardedSync(path.join(root, file), list);
  files[file] = await hashJsonlSharded(path.join(root, file));
}

const common = {
  generator: 'tools/datasets/diversity/generate.mjs', builder: 'tools/datasets/build-corpora.mjs', printer: 'strings', target_language: 'DS021 model language (stated, assumed, unclear, query, constraint)',
  model_input: 'question (the user message only); verification_context, ontology_sop, world, setup_sop, late_setup_sop, verification, surface_ir, expected and execution are evaluation-only (DS022 row fields)',
  review_status: 'not_reviewed', human_reviewed: false, training_authorized: false, synthetic: true, rights: manifestRights(SOURCES),
};
const manifest = {
  format: 'chatsop-corpus-manifest-v2', corpus: MAIN, seed, ...common,
  splits: { train: `datasets_archive/${MAIN}/train.jsonl`, dev: `datasets_archive/${MAIN}/dev.jsonl`, test: `eval/suites/${MAIN}/test.jsonl` },
  sha256: Object.fromEntries(Object.entries(files).filter(([file]) => file.includes(`/${MAIN}/`))),
  companion_suites: { ood: `eval/suites/${OOD}/test.jsonl` },
  shared_world: { dir: MAIN_WORLD, sha256: Object.fromEntries(Object.entries(worldFiles).filter(([file]) => file.startsWith(MAIN_WORLD))), note: 'rows reference predicate and rule blocks by id (row.world); lib/row-world.mjs assembles the world' },
  summary: summary(main.kept), noise_levels: NOISE_LEVELS,
};
const oodManifest = {
  format: 'chatsop-corpus-manifest-v2', corpus: OOD, seed: `${seed}:ood`, ...common,
  purpose: 'Out-of-distribution sealed suite with two axes (row.ood_axis). domain: generic families over held-out domains (food, garage, garden, music, lettings) whose predicates and relation phrases never occur in formalizer-v1; the vehicle, plant and choir entity pools are OOD-only. construction: in-distribution predicates realized only through held-out constructions (domains.mjs HELDOUT_CONSTRUCTIONS) and test-reserved ones. Both axes use only OOD-only and test-reserved lead-in frames (heldout.mjs OOD_ONLY_FRAMES); no lead-in frame or construction of an OOD row occurs in formalizer-v1 train or dev (overlap metrics below).',
  held_out: { frames: OOD_ONLY_FRAMES, forms: OOD_ONLY_FORMS, shapes: OOD_ONLY_SHAPES, constructions: [...new Set(ood.kept.flatMap(row => rowResources(row).constructions).filter(isOodOnly))].sort() },
  overlap_with_formalizer_v1_train_dev: overlap[OOD],
  splits: { test: `eval/suites/${OOD}/test.jsonl` }, sha256: { [`eval/suites/${OOD}/test.jsonl`]: files[`eval/suites/${OOD}/test.jsonl`] }, files: { 'test.jsonl': files[`eval/suites/${OOD}/test.jsonl`] },
  shared_world: { dir: OOD_WORLD, sha256: Object.fromEntries(Object.entries(worldFiles).filter(([file]) => file.startsWith(OOD_WORLD))) },
  summary: summary(ood.kept),
};
const report = (built, extra = {}) => ({
  rows_generated: built.generated.length, rows_kept: built.kept.length, excluded: { count: built.excluded.length, by_reason: tally(built.excluded, 'reason'), examples: built.excluded.slice(0, 20) },
  generation_problems: { count: built.problems.length, examples: built.problems.slice(0, 20) }, metrics: built.metrics, metrics_by_split: built.bySplit, quota_violations: built.violations,
  no_copy: { pass: built.noCopy.pass, paired: built.noCopy.paired, long_span: built.noCopy.long_span, global_4gram: built.noCopy.global_4gram, identifiers: built.noCopy.identifiers },
  elapsed_ms: built.elapsed_ms, ...extra,
});
fs.writeFileSync(path.join(mainDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// Dataset VERSION (read by training/cli.mjs): a counter that advances whenever the manifest changes, a label, and
// the manifest hash that identifies the build. Deterministic: the same build gives the same file.
{
  const manifestHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(mainDir, 'manifest.json'))).digest('hex');
  const versionPath = path.join(mainDir, 'VERSION');
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch { previous = null; }
  const counter = previous?.manifest_sha256 === manifestHash ? previous.counter : (Number.isSafeInteger(previous?.counter) ? previous.counter + 1 : 1);
  const version = { format: 'chatsop-dataset-version-v1', corpus: MAIN, counter, label: `${MAIN} build ${counter} (seed ${seed}, manifest ${manifestHash.slice(0, 12)})`, seed, manifest_sha256: manifestHash };
  fs.writeFileSync(versionPath, JSON.stringify(version, null, 2) + '\n');
}
// The sealed suite's own checksum authority (read by tools/eval/registry.mjs without opening the answers).
const sealed = { format: 'chatsop-sealed-suite-v1', corpus: MAIN, corpus_manifest: `datasets_archive/${MAIN}/manifest.json`, files: { 'test.jsonl': files[`eval/suites/${MAIN}/test.jsonl`] },
  note: 'sha256 of the logical test file; the rows and their provenance are described by the corpus manifest' };
fs.writeFileSync(path.join(mainSuite, 'manifest.json'), JSON.stringify(sealed, null, 2) + '\n');
fs.writeFileSync(path.join(oodSuite, 'manifest.json'), JSON.stringify(oodManifest, null, 2) + '\n');
fs.writeFileSync(path.join(mainDir, 'report.json'), JSON.stringify({ format: 'chatsop-corpus-build-report-v1', quotas: QUOTAS, [MAIN]: report(main), [OOD]: report(ood, { by_axis: tally(ood.kept, 'ood_axis'), overlap_dropped: { count: overlap.ood_rows_dropped_for_overlap, by_reason: tally([...oodDomain.overlapDropped, ...oodConstruction.overlapDropped], 'reason') } }), resource_overlap: overlap }, null, 2) + '\n');

const brief = built => ({ kept: built.kept.length, excluded: built.excluded.length, problems: built.problems.length, by_split: tally(built.kept, 'split'), violations: built.violations, no_copy: built.noCopy.pass,
  template_ratio: built.metrics.template_ratio, top10: built.metrics.top10_template_share, near: built.metrics.near_duplicate_share, skeletons: built.metrics.target_skeletons });
console.log(JSON.stringify({ [MAIN]: brief(main), [OOD]: brief(ood) }, null, 1));
if (main.violations.length || ood.violations.length || !main.noCopy.pass || !ood.noCopy.pass || mainOodUse.length) process.exit(1);
