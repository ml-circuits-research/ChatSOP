#!/usr/bin/env node
/** Summary of the formalizer size study (status/preregistrations/formalizer-size-v1.json) from its raw reports.
 *
 * Reads eval/reports/current/formalizer-size-v1/<model>/ as written by training/scripts/evaluate-arm.sh and the
 * run records under models/<model>/<run>/formalizer/. It reports every number with its counts, the preregistered
 * adequacy gate, and a 95% paired bootstrap interval (1,000 resamples over split_group_id, seed 42) for each
 * between-arm difference of the primary metric. It trains and predicts nothing.
 *
 *   node tools/research/summarize-size-study.mjs --models smollm2-135m,gemma [--run fv1-size-a1]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'eval/reports/current/formalizer-size-v1');
const read = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const frac = (n, d) => ({numerator: n, denominator: d, value: d ? n / d : null});
const pct = f => (f?.value == null ? 'n/a' : `${(100 * f.value).toFixed(1)}% (${f.numerator}/${f.denominator})`);

function args(argv) {
  const out = {run: 'fv1-size-a1'};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '');
    if (!['models', 'run'].includes(name) || !argv[i + 1]) throw Error(`Bad option ${argv[i]}`);
    out[name] = argv[i + 1];
  }
  if (!out.models) throw Error('--models is required');
  return out;
}

/** Per-record correctness of one suite report, keyed by row id. */
function records(model, suite, quant) {
  const evaluation = read(path.join(base, model, `${suite}-${quant}`, 'evaluation.json'));
  return evaluation ? new Map(evaluation.records.filter(r => r.evaluation_track === 'formalization' && r.reference_valid).map(r => [r.id, r])) : null;
}

function byLanguage(recs, field) {
  const out = {};
  for (const r of recs.values()) {
    const key = r.language ?? 'unspecified';
    out[key] ??= [0, 0];
    out[key][0] += r[field] ? 1 : 0;
    out[key][1] += 1;
  }
  return Object.fromEntries(Object.entries(out).map(([k, [n, d]]) => [k, frac(n, d)]));
}

function suiteSummary(model, suite, quant) {
  const metrics = read(path.join(base, model, `${suite}-${quant}`, 'metrics.json'));
  const recs = records(model, suite, quant);
  const timing = read(path.join(base, model, `${suite}-${quant}.timing.json`));
  if (!metrics || !recs) return null;
  const pick = group => group && Object.fromEntries(['parse_rate', 'canonical_ast_match', 'execution_equivalence', 'execution_equivalence_tolerant', 'abstention'].map(k => [k, group.formalizer?.[k] ?? null]));
  const slice = name => Object.fromEntries(Object.entries(metrics.slices?.[name] ?? {}).map(([k, v]) => [k, {rows: v.rows, ...pick(v)}]));
  return {
    evaluation_valid: metrics.evaluation_valid, rows: metrics.rows, valid_references: metrics.valid_references,
    formalizer: metrics.formalizer, reference_free: metrics.reference_free,
    tolerant_by_row_language: byLanguage(recs, 'execution_equivalent_tolerant'),
    parse_by_row_language: byLanguage(recs, 'syntax_valid'),
    slices: {language: slice('by_language_slice'), question_type: slice('by_question_type'), noise: slice('by_noise_slice'), hard: slice('by_hard_slice'), hard_reason: slice('by_hard_reason')},
    generation: timing && {errors: timing.errors.length, truncated: timing.truncated.length, wall_seconds: timing.wall_seconds, latency_ms: timing.latency_ms},
  };
}

function bootstrap(a, b, groups, seed = 42, resamples = 1000) {
  // Paired over split_group_id: resample groups with replacement; difference of tolerant execution equivalence (a - b).
  const ids = [...a.keys()].filter(id => b.has(id));
  const byGroup = new Map();
  for (const id of ids) {
    const g = groups.get(id) ?? id;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(id);
  }
  const list = [...byGroup.values()];
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const diff = members => {
    let n = 0, sa = 0, sb = 0;
    for (const m of members) for (const id of m) { n++; sa += a.get(id).execution_equivalent_tolerant ? 1 : 0; sb += b.get(id).execution_equivalent_tolerant ? 1 : 0; }
    return (sa - sb) / n;
  };
  const observed = diff(list), samples = [];
  for (let i = 0; i < resamples; i++) samples.push(diff(Array.from({length: list.length}, () => list[Math.floor(random() * list.length)])));
  samples.sort((x, y) => x - y);
  return {difference: observed, ci95: [samples[Math.floor(0.025 * resamples)], samples[Math.floor(0.975 * resamples)]], rows: ids.length, groups: list.length};
}

function bench(model) {
  const out = {};
  for (const q of ['q8_0', 'q4_k_m']) {
    const file = path.join(base, model, `bench-${q}.jsonl`);
    if (!fs.existsSync(file)) continue;
    out[q] = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).map(r => ({threads: r.n_threads, test: r.n_prompt ? `pp${r.n_prompt}` : `tg${r.n_gen}`, tokens_per_second: +r.avg_ts.toFixed(1), stddev: +r.stddev_ts.toFixed(1)}));
    for (const t of [4, 10]) {
      const timing = read(path.join(base, model, `latency-${q}-t${t}.timing.json`));
      if (timing) out[`${q}_latency_t${t}`] = {rows: timing.rows, latency_ms: timing.latency_ms, generation_tokens_per_second: timing.server_generation_tokens_per_second, prompt_tokens_per_second: timing.server_prompt_tokens_per_second, completion_tokens: timing.completion_tokens, errors: timing.errors.length, truncated: timing.truncated.length};
    }
  }
  const size = path.join(base, model, 'gguf-files.txt');
  if (fs.existsSync(size)) out.gguf_files = fs.readFileSync(size, 'utf8').trim().split('\n').filter(l => l.endsWith('.gguf')).map(l => l.split(/\s+/).slice(-5).join(' '));
  for (const f of ['load-before-bench.txt', 'load-after-bench.txt']) if (fs.existsSync(path.join(base, model, f))) out[f.replace('.txt', '')] = fs.readFileSync(path.join(base, model, f), 'utf8').trim();
  return out;
}

function adequacy(s) {
  const v1 = s.suites['formalizer-v1']?.q8_0, ood = s.suites['formalizer-ood-v1']?.q8_0;
  if (!v1 || !ood) return {adequate: null, reason: 'missing reports'};
  const gates = {
    parse_rate_ge_99: v1.formalizer.parse_rate.value >= 0.99,
    tolerant_en_ge_90: (v1.tolerant_by_row_language.en?.value ?? 0) >= 0.9,
    tolerant_ro_ge_90: (v1.tolerant_by_row_language.ro?.value ?? 0) >= 0.9,
    ood_tolerant_ge_70: ood.formalizer.execution_equivalence_tolerant.value >= 0.7,
  };
  return {adequate: Object.values(gates).every(Boolean), gates, language_rule: 'row language field (en or ro), code-switched rows counted in their row language'};
}

function main() {
  const o = args(process.argv.slice(2));
  const models = o.models.split(',');
  const groups = new Map();
  for (const suite of ['formalizer-v1', 'formalizer-ood-v1']) for (const row of readJsonlShardedSync(path.join(root, 'eval/suites', suite, 'test.jsonl'))) groups.set(row.id, row.split_group_id ?? row.semantic_case_id ?? row.id);
  const summary = {format: 'chatsop-size-study-summary-v1', experiment: 'formalizer-size-v1', generated_at: new Date().toISOString(), run: o.run, arms: {}, comparisons: []};
  for (const model of models) {
    const armDir = path.join(root, 'models', model, o.run, 'formalizer');
    const arm = {run_summary: read(path.join(armDir, 'summary.json')), run: read(path.join(armDir, 'run.json')), suites: {}};
    if (arm.run) arm.run = {model_id: arm.run.model_id, revision: arm.run.revision, trainable_parameters: arm.run.trainable_parameters, total_parameters: arm.run.total_parameters, precision: arm.run.precision, device: arm.run.device, torch: arm.run.torch, transformers: arm.run.transformers};
    const semantic = path.join(armDir, 'semantic');
    if (fs.existsSync(semantic)) arm.dev_selection = fs.readdirSync(semantic).filter(f => /^step-\d+\.json$/.test(f)).sort().map(f => {
      const m = read(path.join(semantic, f)).metrics;
      return {step: Number(f.slice(5, 13)), execution_equivalence: m.execution_equivalence, execution_equivalence_tolerant: m.execution_equivalence_tolerant, syntax: m.syntax};
    });
    for (const suite of ['formalizer-v1', 'formalizer-ood-v1']) arm.suites[suite] = {q8_0: suiteSummary(model, suite, 'q8_0'), q4_k_m: suiteSummary(model, suite, 'q4_k_m')};
    arm.suites['formalizer-wild-v1'] = {q8_0: {accepted: read(path.join(base, model, 'formalizer-wild-v1-q8_0.wild.json')), reference_free: read(path.join(base, model, 'formalizer-wild-v1-q8_0.reference-free.json'))?.reference_free ?? null,
      generation: read(path.join(base, model, 'formalizer-wild-v1-q8_0.timing.json'))}};
    arm.cpu = bench(model);
    arm.adequacy = adequacy(arm);
    for (const suite of ['formalizer-v1', 'formalizer-ood-v1']) {
      const a = records(model, suite, 'q8_0'), b = records(model, suite, 'q4_k_m');
      if (a && b) arm[`quantization_${suite}`] = {q8_minus_q4: bootstrap(a, b, groups)};
    }
    summary.arms[model] = arm;
  }
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) for (const suite of ['formalizer-v1', 'formalizer-ood-v1']) {
    const a = records(models[j], suite, 'q8_0'), b = records(models[i], suite, 'q8_0');
    if (a && b) summary.comparisons.push({suite, quant: 'q8_0', a: models[j], b: models[i], metric: 'execution_equivalence_tolerant (a - b)', ...bootstrap(a, b, groups)});
  }
  fs.mkdirSync(base, {recursive: true});
  fs.writeFileSync(path.join(base, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  for (const [model, arm] of Object.entries(summary.arms)) {
    const v1 = arm.suites['formalizer-v1'].q8_0, ood = arm.suites['formalizer-ood-v1'].q8_0;
    console.log(model, 'v1 tolerant', pct(v1?.formalizer.execution_equivalence_tolerant), 'en', pct(v1?.tolerant_by_row_language.en), 'ro', pct(v1?.tolerant_by_row_language.ro), 'parse', pct(v1?.formalizer.parse_rate), '| ood', pct(ood?.formalizer.execution_equivalence_tolerant), '| adequate', arm.adequacy.adequate);
  }
  for (const c of summary.comparisons) console.log(c.suite, `${c.a} - ${c.b}`, (100 * c.difference).toFixed(1), 'pp, 95% CI', c.ci95.map(x => (100 * x).toFixed(1)).join('..'));
  console.log(path.relative(root, path.join(base, 'summary.json')));
}

main();
