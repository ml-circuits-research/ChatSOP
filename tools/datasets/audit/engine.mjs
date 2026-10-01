/** The corpus audit engine: one streaming pass over train, dev and the sealed test, then a report object.
 *
 * Reading the sealed test here is an audit measurement (AGENTS.md rule 9): the report states how predictable
 * the test is from development data. Nothing in this folder may be imported by a builder, trainer or selector;
 * `eval/leakage.mjs` enforces that.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROW_CHECKS, contextShape, rowContext} from './checks.mjs';
import {CORPUS_CHECKS, auditConfig} from './options.mjs';
import {Invariants} from './invariants.mjs';
import {NearDuplicateIndex, distribution, maskTemplate, minhash, targetSkeleton} from './diversity.mjs';
import {SplitLeakage, entityHeads} from './leakage.mjs';
import {adaptRow, analyzeTarget, messageOf, questionOf, streamJsonl, targetOf, vocabularyOf} from './rows.mjs';
import {fnv1a} from './text.mjs';
import {jsonlExists} from '../../../lib/jsonl-shards.mjs';
import {pendingFindings} from './vocabulary.mjs';
import {corpusDir} from '../../../lib/dataset-paths.mjs';

export const SPLITS = ['train', 'dev', 'test'];

/** Default split files of a corpus; the sealed test lives under eval/suites (DS020). */
export function corpusFiles(root, corpus) {
  return {
    train: path.join(root, corpusDir(corpus, root), 'train.jsonl'),
    dev: path.join(root, corpusDir(corpus, root), 'dev.jsonl'),
    test: path.join(root, 'eval', 'suites', corpus, 'test.jsonl'),
  };
}

/** The `audit_profile` the corpus manifest declares (see `adaptRow`), or null for the default profile. */
function auditProfileOf(root, corpus) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, corpusDir(corpus, root), 'manifest.json'), 'utf8')).audit_profile ?? null;
  } catch {
    return null;
  }
}

export const defaultReportPath = (root, corpus) => path.join(root, 'eval', 'reports', 'current', 'corpus-audit', `${corpus}.json`);

const bump = (object, key) => {
  object[key ?? 'none'] = (object[key ?? 'none'] ?? 0) + 1;
};
const sortedTally = object => Object.fromEntries(Object.entries(object).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/** Keep the `limit` examples with the smallest stable hash, so examples are spread over the corpus and reproducible. */
class Examples {
  constructor(limit) {
    this.limit = limit;
    this.items = [];
  }
  offer(key, item) {
    if (this.limit <= 0) return;
    const rank = fnv1a(key);
    if (this.items.length >= this.limit && rank >= this.items.at(-1).rank) return;
    this.items.push({rank, item});
    this.items.sort((a, b) => a.rank - b.rank);
    if (this.items.length > this.limit) this.items.pop();
  }
  list() {
    return this.items.map(entry => entry.item);
  }
}

/**
 * Audit one corpus. `files` overrides the split paths; `rowsOut` streams per-row findings to a JSONL file.
 * Returns the report object; writing it is the caller's job.
 */
export async function auditCorpus({root, corpus, files = corpusFiles(root, corpus), options = {}, rowsOut = null}) {
  const config = options.groundedTypes instanceof Set ? options : auditConfig(options);
  const lexicon = typeof config.lexicon === 'string' ? JSON.parse(fs.readFileSync(config.lexicon, 'utf8')) : config.lexicon;
  const present = SPLITS.filter(split => files[split] && jsonlExists(files[split]));
  const profile = auditProfileOf(root, corpus);
  if (!present.length) throw Error(`${corpus}: no split files found`);

  const invariants = new Invariants();
  const checks = ROW_CHECKS.map(check => ({check, flagged: 0, eligible: 0, bySplit: {}, examples: new Examples(config.examples)}));
  const near = new NearDuplicateIndex();
  const nearFlags = [];
  const nearExamples = new Examples(config.examples);
  const leakage = new SplitLeakage();
  const templates = Object.fromEntries(SPLITS.map(split => [split, new Map()]));
  const skeletons = Object.fromEntries(SPLITS.map(split => [split, new Map()]));
  const tallies = {by_split: {}, by_language: {}, by_theme: {}, by_shape: {}, by_status: {}, target_review: {}};
  const wires = {by_type: {}, grounded: 0, assumption: 0, problem: 0, other: 0, rows_with_assumption: 0, rows_with_target: 0};
  const shape = {predicates: {}, entities: {}};
  const fileRows = {};
  const fingerprintLines = [];
  const sampleIndex = [];
  const cases = new Set();
  const faithfulness = {rows_with_error: 0, rows_with_target: 0};
  const migration = {rows: 0, wires: 0, by_type: {}};
  if (rowsOut) fs.mkdirSync(path.dirname(rowsOut), {recursive: true});
  const rowsStream = rowsOut ? fs.createWriteStream(rowsOut) : null;
  let rows = 0;

  for (const split of present) {
    fileRows[split] = 0;
    for await (const {row: stored, error} of streamJsonl(files[split])) {
      const row = stored && adaptRow(stored, profile);
      if (!row) {
        invariants.fail('json', error);
        continue;
      }
      rows++;
      fileRows[split]++;
      cases.add(row.semantic_case_id);
      const parseError = invariants.add(row, split);
      bump(tallies.by_split, split);
      bump(tallies.by_language, row.language);
      bump(tallies.by_theme, row.domain ?? row.theme ?? row.lineage?.theme ?? row.generation_trace?.theme);
      bump(tallies.by_shape, row.structure_id ?? row.form ?? row.surface_design);
      bump(tallies.by_status, row.expected?.status);
      bump(tallies.target_review, row.target_review_status ?? row.review_status);

      const target = targetOf(row);
      fingerprintLines.push(`${row.id}\t${target ?? ''}`);
      sampleIndex.push({id: String(row.id), split, language: row.language, question: row.question, shape: row.structure_id ?? row.form ?? row.surface_design ?? null, status: row.expected?.status ?? null, target});

      const message = messageOf(row);
      const vocabulary = vocabularyOf(row, lexicon);
      let analysis = null;
      if (target && !parseError) {
        try {
          analysis = analyzeTarget(target);
        } catch {
          analysis = null;
        }
      }
      const context = rowContext(row, {message, question: questionOf(row), vocabulary, analysis, config});

      if (analysis) {
        wires.rows_with_target++;
        let hasAssumption = false;
        for (const wire of analysis.wires) {
          bump(wires.by_type, wire.type);
          if (config.assumptionTypes.has(wire.type)) {
            wires.assumption++;
            hasAssumption = true;
          } else if (config.groundedTypes.has(wire.type)) wires.grounded++;
          else if (config.problemTypes.has(wire.type)) wires.problem++;
          else wires.other++;
        }
        if (hasAssumption) wires.rows_with_assumption++;
        const {predicates, entities} = contextShape(context);
        bump(shape.predicates, predicates >= 10 ? '10+' : String(predicates));
        bump(shape.entities, entities >= 10 ? '10+' : String(entities));
      }

      const rowFindings = {};
      let faithfulnessError = false;
      for (const state of checks) {
        if (state.check.target && !analysis) continue;
        state.eligible++;
        const bucket = state.bySplit[split] ??= {flagged: 0, eligible: 0};
        bucket.eligible++;
        const findings = state.check.run(context);
        if (!findings.length) continue;
        state.flagged++;
        bucket.flagged++;
        rowFindings[state.check.id] = findings;
        if (state.check.severity === 'error' && state.check.id.startsWith('faithfulness.')) faithfulnessError = true;
        state.examples.offer(`${state.check.id}\u0000${row.id}`, {id: row.id, split, message, target, findings: findings.slice(0, 3)});
      }
      if (analysis) {
        faithfulness.rows_with_target++;
        if (faithfulnessError) faithfulness.rows_with_error++;
      }
      const pending = pendingFindings(context);
      if (pending.length) {
        migration.rows++;
        migration.wires += pending.length;
        for (const finding of pending) bump(migration.by_type, finding.type);
      }

      const template = maskTemplate(message, row, vocabulary);
      const skeleton = analysis ? targetSkeleton(target, vocabulary) : null;
      templates[split].set(template, (templates[split].get(template) ?? 0) + 1);
      if (skeleton !== null) skeletons[split].set(skeleton, (skeletons[split].get(skeleton) ?? 0) + 1);

      const matches = near.add(minhash(message), {group: row.split_group_id ?? row.semantic_case_id ?? row.id, split, id: row.id});
      const index = nearFlags.length;
      nearFlags.push(0);
      const sameSplit = matches.filter(other => near.meta[other].split === split);
      if (sameSplit.length) {
        nearFlags[index] = 1;
        for (const other of sameSplit) nearFlags[other] = 1;
        const other = near.meta[sameSplit[0]];
        nearExamples.offer(String(row.id), {id: row.id, near_duplicate_of: other.id, split});
        rowFindings['diversity.near_duplicate'] = [`near-duplicate of ${other.id}`];
      }
      if (config.leakage) {
        leakage.add({split, message, template, skeleton, entityHeads: entityHeads(vocabulary), nearSplits: [...new Set(matches.map(other => near.meta[other].split))]});
      }
      if (rowsStream && Object.keys(rowFindings).length) rowsStream.write(JSON.stringify({id: row.id, split, findings: rowFindings}) + '\n');
    }
  }
  if (rowsStream) await new Promise(resolve => rowsStream.end(resolve));

  // Development rows (train + dev) drive the diversity thresholds; the test split is reported separately.
  const merge = maps => maps.reduce((out, map) => {
    for (const [key, count] of map) out.set(key, (out.get(key) ?? 0) + count);
    return out;
  }, new Map());
  const developmentRows = (fileRows.train ?? 0) + (fileRows.dev ?? 0);
  const primaryRows = developmentRows || rows;
  const primaryTemplates = developmentRows ? merge([templates.train, templates.dev]) : merge(Object.values(templates));
  const primarySkeletons = developmentRows ? merge([skeletons.train, skeletons.dev]) : merge(Object.values(skeletons));
  const skeletonRows = [...primarySkeletons.values()].reduce((sum, count) => sum + count, 0);
  const nearCount = nearFlags.reduce((sum, flag) => sum + flag, 0);
  const diversity = {
    development: {rows: primaryRows, templates: distribution(primaryTemplates, primaryRows), target_skeletons: distribution(primarySkeletons, skeletonRows)},
    by_split: Object.fromEntries(present.map(split => [split, {
      rows: fileRows[split],
      templates: distribution(templates[split], fileRows[split], 3),
      target_skeletons: distribution(skeletons[split], [...skeletons[split].values()].reduce((sum, count) => sum + count, 0), 3),
    }])),
    near_duplicates: {rows: nearCount, rate: rows ? nearCount / rows : 0, examples: nearExamples.list()},
  };
  const leak = config.leakage ? leakage.report() : {};
  const againstDevelopment = leak.test_vs_development ?? null;

  const corpusValues = {
    'diversity.top10_template_share': diversity.development.templates.top_share,
    'diversity.template_ratio': diversity.development.templates.distinct_ratio,
    'diversity.target_skeletons': skeletonRows ? diversity.development.target_skeletons.distinct : null,
    'diversity.near_duplicate': diversity.near_duplicates.rate,
    'leakage.exact_input': againstDevelopment?.exact_input_overlap ?? null,
    'leakage.template_overlap': againstDevelopment?.template_overlap ?? null,
    'leakage.near_duplicate': againstDevelopment?.near_duplicate_overlap ?? null,
    'leakage.entity_overlap': againstDevelopment?.entity_overlap ?? null,
    'leakage.target_skeleton_overlap': againstDevelopment?.target_skeleton_overlap ?? null,
    'assumption.row_ratio': wires.rows_with_target ? wires.rows_with_assumption / wires.rows_with_target : null,
  };

  const evaluate = (check, value, extra) => {
    const failing = config.failOn.has(check.id);
    const threshold = failing ? config.failOn.get(check.id) : config.thresholds[check.id];
    const direction = check.direction ?? 'max';
    const breached = value !== null && (direction === 'min' ? value < threshold : value > threshold);
    const status = value === null ? 'n/a' : !breached ? 'ok' : failing ? 'fail' : check.severity === 'info' ? 'info' : check.severity;
    return {id: check.id, scope: extra.scope, severity: check.severity, description: check.description, value, threshold, direction, status, ...extra};
  };
  const results = [
    ...checks.map(state => evaluate(state.check, state.eligible ? state.flagged / state.eligible : null, {
      scope: 'row', flagged: state.flagged, eligible: state.eligible,
      by_split: Object.fromEntries(Object.entries(state.bySplit).map(([split, bucket]) => [split, {...bucket, rate: bucket.eligible ? bucket.flagged / bucket.eligible : 0}])),
      examples: state.examples.list(),
    })),
    ...CORPUS_CHECKS.map(check => evaluate(check, corpusValues[check.id], {scope: 'corpus'})),
  ];
  const invariantReport = invariants.finish();
  const failed = results.filter(result => result.status === 'fail').map(result => result.id);

  const ordered = sampleIndex.sort((a, b) => a.id.localeCompare(b.id));
  const stride = Math.max(1, Math.floor(ordered.length / Math.max(1, config.spot)));
  const sample = [];
  for (let index = 0; index < ordered.length && sample.length < config.spot; index += stride) sample.push(ordered[index]);

  return {
    format: 'chatsop-corpus-audit-v2',
    corpus,
    rows,
    cases: cases.size,
    files: Object.fromEntries(present.map(split => [split, {file: path.relative(root, files[split]), rows: fileRows[split]}])),
    ...Object.fromEntries(Object.entries(tallies).map(([key, value]) => [key, sortedTally(value)])),
    fingerprint: crypto.createHash('sha256').update(fingerprintLines.sort().join('\n')).digest('hex'),
    connected_groups: invariantReport.connected_groups,
    config: {
      grounded_types: [...config.groundedTypes], assumption_types: [...config.assumptionTypes], problem_types: [...config.problemTypes],
      fail_on: Object.fromEntries(config.failOn), thresholds: config.thresholds,
    },
    invariants: {problems: invariantReport.problems, counts: invariantReport.counts, total: invariantReport.total},
    problems: invariantReport.problems,
    wires: {
      ...wires, by_type: sortedTally(wires.by_type),
      assumption_row_ratio: corpusValues['assumption.row_ratio'],
      assumption_wire_ratio: wires.grounded + wires.assumption ? wires.assumption / (wires.grounded + wires.assumption) : null,
    },
    faithfulness: {...faithfulness, error_rate: faithfulness.rows_with_target ? faithfulness.rows_with_error / faithfulness.rows_with_target : null},
    vocabulary_migration: {note: 'Contract findings about wire types whose migration is in flight; counted, never failed (vocabulary.contract excludes them).', ...migration, by_type: sortedTally(migration.by_type)},
    context_shape: {predicates: sortedTally(shape.predicates), entities: sortedTally(shape.entities)},
    checks: results,
    diversity,
    leakage: {note: 'Audit-only comparison of the sealed test with development splits; no training or selection code reads this.', ...leak},
    verdict: {status: invariantReport.total || failed.length ? 'fail' : 'pass', invariant_failures: invariantReport.total, failed_checks: failed},
    sample: sample.map(({id, split, language, question, shape: rowShape, status, target}) => ({id, split, language, question, shape: rowShape, status, target})),
  };
}

/** Run every row check on one row, outside a corpus pass: `{checkId: findings}` for the checks that fired. */
export function checkRow(row, options = {}) {
  const config = options.groundedTypes instanceof Set ? options : auditConfig(options);
  const target = targetOf(row);
  let analysis = null;
  if (target) {
    try {
      analysis = analyzeTarget(target);
    } catch {
      analysis = null;
    }
  }
  const lexicon = typeof config.lexicon === 'string' ? JSON.parse(fs.readFileSync(config.lexicon, 'utf8')) : config.lexicon;
  const context = rowContext(row, {message: messageOf(row), question: questionOf(row), vocabulary: vocabularyOf(row, lexicon), analysis, config});
  const out = {};
  for (const check of ROW_CHECKS) {
    if (check.target && !analysis) continue;
    const findings = check.run(context);
    if (findings.length) out[check.id] = findings;
  }
  return out;
}
