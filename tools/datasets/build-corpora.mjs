#!/usr/bin/env node
/** Build the model-language corpora (DS022 "Corpora"): the main corpus `formalizer-v1` and the
 * out-of-distribution suite `formalizer-ood-v1`, generated through the IR (tools/datasets/diversity/) with the
 * `strings` printer.
 *
 *   datasets/formalizer-v1/{train,dev}.jsonl, manifest.json, report.json
 *   eval/suites/formalizer-v1/test.jsonl (sealed, held-out resources)
 *   eval/suites/formalizer-ood-v1/test.jsonl, manifest.json (held-out domains only)
 *
 *   node tools/datasets/build-corpora.mjs [--rows 34000] [--ood-rows 1600] [--seed chatsop-formalizer-v1]
 *
 * Every row's target is linked back to its evaluation-only verification world and executed there; a row whose
 * strings do not link or whose observed status disagrees with the family's intended status is excluded and
 * counted in the report. The build fails (exit 1) on a quota violation or a no-copy failure. No training, no
 * model, no GPU; the corpora are synthetic and unreviewed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, OOD_FAMILY_WEIGHTS, sharedWorld } from './diversity/generate.mjs';
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
const inventoryPath = path.join(root, 'datasets/diversity/inventory.json');
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

function summary(list) {
  return {
    rows: list.length, by_split: tally(list, 'split'), by_family: sorted(tally(list, 'family')), by_question_type: sorted(tally(list, 'question_type')),
    by_language: sorted(tally(list, row => row.code_switch ? `${row.language}+switch` : row.language)), by_expected_status: sorted(tally(list, row => row.expected?.status)),
    by_noise_level: sorted(tally(list, row => row.noise_level ?? 'clean')), code_switch_kinds: sorted(tally(list.filter(row => row.code_switch), row => row.code_switch.kind)),
    noise_ops: sorted(tally(list.flatMap(row => (row.noise ?? []).map(op => ({ op: op.kind ? `typo:${op.kind}` : op.op }))), 'op')),
    assumed_basis: sorted(tally(list.flatMap(row => (row.surface_ir?.assumed ?? []).map(a => ({ basis: a.basis ?? 'unspecified' }))), 'basis')),
    unclear_kinds: sorted(tally(list.filter(row => row.surface_ir?.unclear), row => row.surface_ir.unclear.kind)),
  };
}

async function build({ name, pool, target, familyWeights, splits, groupPrefix, buildSeed, worldDir }) {
  const started = performance.now();
  const { rows: generated, problems } = await generate({ seed: buildSeed, rows: target, inventory, pool, familyWeights, splits, groupPrefix, worldDir, onProgress: n => log(`${name}: ${n} rows`) });
  const { kept, excluded } = verified(generated);
  const metrics = diversityMetrics(kept);
  const bySplit = Object.fromEntries(['train', 'dev', 'test'].filter(split => kept.some(row => row.split === split)).map(split => [split, diversityMetrics(kept.filter(row => row.split === split))]));
  const violations = pool === 'main' ? quotaViolations(metrics, kept, { minRows: 200 }) : quotaViolations(metrics, kept, { minRows: 200, mix: false }).filter(v => !/^language|^unclear share|^family .* (share|target skeletons)|^target skeletons/.test(v));
  const noCopy = await checkNoCopy(kept.map(row => ({ row, split: row.split })), { name });
  return { generated, kept, excluded, problems, metrics, bySplit, violations, noCopy, elapsed_ms: Math.round(performance.now() - started) };
}

const MAIN_WORLD = `datasets/${MAIN}/world`, OOD_WORLD = `eval/suites/${OOD}/world`;
const main = await build({ name: MAIN, pool: 'main', target: rows, buildSeed: seed, groupPrefix: 'fv1', worldDir: MAIN_WORLD });
const ood = await build({ name: OOD, pool: 'ood', target: oodRows, buildSeed: `${seed}:ood`, familyWeights: OOD_FAMILY_WEIGHTS, splits: () => 'test', groupPrefix: 'ood1', worldDir: OOD_WORLD });

const mainDir = path.join(root, 'datasets', MAIN), mainSuite = path.join(root, 'eval/suites', MAIN), oodSuite = path.join(root, 'eval/suites', OOD);
for (const dir of [mainDir, mainSuite, oodSuite]) fs.mkdirSync(dir, { recursive: true });
// Every file is written through lib/jsonl-shards.mjs: a split above 45 MB becomes `<name>.part-NNN.jsonl` parts
// (no repository file may exceed 50 MB); the manifest records the sha256 of the logical (concatenated) file.
const splitRows = {
  [`datasets/${MAIN}/train.jsonl`]: main.kept.filter(row => row.split === 'train'),
  [`datasets/${MAIN}/dev.jsonl`]: main.kept.filter(row => row.split === 'dev'),
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
  splits: { train: `datasets/${MAIN}/train.jsonl`, dev: `datasets/${MAIN}/dev.jsonl`, test: `eval/suites/${MAIN}/test.jsonl` },
  sha256: Object.fromEntries(Object.entries(files).filter(([file]) => file.includes(`/${MAIN}/`))),
  companion_suites: { ood: `eval/suites/${OOD}/test.jsonl` },
  shared_world: { dir: MAIN_WORLD, sha256: Object.fromEntries(Object.entries(worldFiles).filter(([file]) => file.startsWith(MAIN_WORLD))), note: 'rows reference predicate and rule blocks by id (row.world); lib/row-world.mjs assembles the world' },
  summary: summary(main.kept), noise_levels: NOISE_LEVELS,
};
const oodManifest = {
  format: 'chatsop-corpus-manifest-v2', corpus: OOD, seed: `${seed}:ood`, ...common,
  purpose: 'Out-of-distribution sealed suite: generic families over held-out domains (food, garage, garden, music, lettings) whose predicates and relation phrases never occur in formalizer-v1; the vehicle, plant and choir entity pools are OOD-only, persons, places and assets are shared.',
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
// The sealed suite's own checksum authority (read by tools/eval/registry.mjs without opening the answers).
const sealed = { format: 'chatsop-sealed-suite-v1', corpus: MAIN, corpus_manifest: `datasets/${MAIN}/manifest.json`, files: { 'test.jsonl': files[`eval/suites/${MAIN}/test.jsonl`] },
  note: 'sha256 of the logical test file; the rows and their provenance are described by the corpus manifest' };
fs.writeFileSync(path.join(mainSuite, 'manifest.json'), JSON.stringify(sealed, null, 2) + '\n');
fs.writeFileSync(path.join(oodSuite, 'manifest.json'), JSON.stringify(oodManifest, null, 2) + '\n');
fs.writeFileSync(path.join(mainDir, 'report.json'), JSON.stringify({ format: 'chatsop-corpus-build-report-v1', quotas: QUOTAS, [MAIN]: report(main), [OOD]: report(ood) }, null, 2) + '\n');

const brief = built => ({ kept: built.kept.length, excluded: built.excluded.length, problems: built.problems.length, by_split: tally(built.kept, 'split'), violations: built.violations, no_copy: built.noCopy.pass,
  template_ratio: built.metrics.template_ratio, top10: built.metrics.top10_template_share, near: built.metrics.near_duplicate_share, skeletons: built.metrics.target_skeletons });
console.log(JSON.stringify({ [MAIN]: brief(main), [OOD]: brief(ood) }, null, 1));
if (main.violations.length || ood.violations.length || !main.noCopy.pass || !ood.noCopy.pass) process.exit(1);
