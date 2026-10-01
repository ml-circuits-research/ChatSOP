#!/usr/bin/env node
/** Failure sample and error classes for one arm of the formalizer size study.
 *
 * For each suite it draws a deterministic sample of failed rows (seed 42) and assigns each one every error class
 * that a textual comparison of prediction and gold supports. The classes are heuristics, not adjudication; each
 * sampled row is kept with its message, gold and prediction so that a reader can check the labels.
 *   broken_syntax          the prediction does not parse (evaluator stage parse/prediction)
 *   truncation             the endpoint stopped at max_tokens
 *   unclear_misuse         exactly one side is an `unclear` program, or the unclear kind differs
 *   question_form          the query modes or the presence of query/constraint differ
 *   missing_statements     fewer stated/assumed wires than the gold
 *   extra_statements       more stated/assumed wires than the gold
 *   relation_phrase        a relation phrase of the gold is absent from the prediction
 *   roles                  the role names differ
 *   role_values            the role values differ (message text versus canonical English)
 *   translation            a differing value where the gold value does not occur in the message (a translated value)
 *   polarity               the polarity words differ
 *   time                   time roles or validity differ
 *   other                  none of the above (for example variables, basis or ordering)
 *
 *   node tools/research/error-analysis.mjs --model smollm2-135m [--sample 40]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {sampleRows} from './predict-endpoint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'eval/reports/history/formalizer-size-v1');
const read = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const fold = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

function shape(sop) {
  const text = String(sop ?? '');
  const wires = [...text.matchAll(/^@\S+\s+(\w+)/gm)].map(m => m[1]);
  return {
    wires, statements: wires.filter(w => w === 'stated' || w === 'assumed').length,
    unclear: /^@\S+\s+unclear/m.test(text) ? (text.match(/^\s*kind\s+(\S+)/m)?.[1] ?? 'unclear') : null,
    problem: wires.filter(w => w === 'query' || w === 'constraint').join(','),
    modes: [...text.matchAll(/^\s*mode\s+(.+)$/gm)].map(m => m[1].trim()).sort().join('|'),
    relations: [...text.matchAll(/relation\s+"([^"]*)"/g)].map(m => fold(m[1])),
    roleNames: [...text.matchAll(/role\s+(\w+)/g)].map(m => m[1]).sort().join(','),
    values: [...text.matchAll(/role\s+\w+\s+"([^"]*)"/g)].map(m => fold(m[1])),
    polarity: [...text.matchAll(/polarity\s+(\w+)/g)].map(m => m[1]).sort().join(','),
    time: [...text.matchAll(/(?:role time\s+"[^"]*"|valid\s+.+|at\s+"[^"]*")/g)].map(m => fold(m[0])).sort().join('|'),
  };
}

function classify(message, gold, prediction, record, truncated) {
  const classes = [];
  if (truncated) classes.push('truncation');
  if (record && (record.syntax_valid === false || record.parsed === false)) classes.push('broken_syntax');
  const g = shape(gold), p = shape(prediction), m = fold(message);
  if (!classes.includes('broken_syntax')) {
    if ((g.unclear === null) !== (p.unclear === null) || (g.unclear && p.unclear && g.unclear !== p.unclear)) classes.push('unclear_misuse');
    if (g.problem !== p.problem || g.modes !== p.modes) classes.push('question_form');
    if (p.statements < g.statements) classes.push('missing_statements');
    if (p.statements > g.statements) classes.push('extra_statements');
    if (g.relations.some(r => !p.relations.includes(r))) classes.push('relation_phrase');
    if (g.roleNames !== p.roleNames) classes.push('roles');
    const differing = g.values.filter(v => !p.values.includes(v));
    if (differing.length) classes.push('role_values');
    if (differing.some(v => !m.includes(v))) classes.push('translation');
    if (g.polarity !== p.polarity) classes.push('polarity');
    if (g.time !== p.time) classes.push('time');
  }
  return classes.length ? classes : ['other'];
}

function analyse(model, suite, quant, size) {
  const rows = new Map(readJsonlShardedSync(path.join(root, 'eval/suites', suite, 'test.jsonl')).map(r => [r.id, r]));
  const predictions = new Map(readJsonlShardedSync(path.join(base, model, `${suite}-${quant}.predictions.jsonl`)).map(r => [r.id, r.sop]));
  const timing = read(path.join(base, model, `${suite}-${quant}.timing.json`));
  const truncated = new Set(timing?.truncated ?? []);
  let failures;
  if (suite === 'formalizer-wild-v1') {
    // A wild row fails when no accepted gold matches (tools/eval/wild-suite.mjs per-row result when present).
    const report = read(path.join(base, model, `${suite}-${quant}.wild.json`));
    const perRow = new Map((report?.rows ?? report?.records ?? []).map(r => [r.id, r]));
    failures = [...rows.values()].filter(r => perRow.size ? !(perRow.get(r.id)?.accepted_match) : true).map(r => ({row: r, record: perRow.get(r.id) ?? null}));
  } else {
    const evaluation = read(path.join(base, model, `${suite}-${quant}`, 'evaluation.json'));
    failures = evaluation.records.filter(r => r.reference_valid && !r.execution_equivalent_tolerant).map(r => ({row: rows.get(r.id), record: r}));
  }
  const sample = sampleRows(failures, size, 42);
  const counts = {};
  const examples = sample.map(({row, record}) => {
    const gold = row.sop_target ?? row.sop_targets_accepted?.[0];
    const classes = classify(row.question, gold, predictions.get(row.id), record, truncated.has(row.id));
    for (const c of classes) counts[c] = (counts[c] ?? 0) + 1;
    return {id: row.id, language: row.code_switch ? 'mixed' : row.language, question_type: row.question_type, family: row.family, classes, message: row.question, gold, prediction: predictions.get(row.id)};
  });
  return {suite, quant, failures: failures.length, sampled: sample.length, class_counts: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])), examples};
}

const argv = process.argv.slice(2);
const model = argv[argv.indexOf('--model') + 1];
const size = argv.includes('--sample') ? Number(argv[argv.indexOf('--sample') + 1]) : 40;
if (!argv.includes('--model') || !model) { console.error('usage: error-analysis.mjs --model NAME [--sample 40]'); process.exit(2); }
const out = {format: 'chatsop-error-analysis-v1', model, method: 'deterministic sample (seed 42) of failed rows; heuristic multi-label classes from a textual comparison, not adjudicated', suites: []};
for (const suite of ['formalizer-v1', 'formalizer-ood-v1', 'formalizer-wild-v1']) {
  try { out.suites.push(analyse(model, suite, 'q8_0', size)); } catch (error) { out.suites.push({suite, error: error.message}); }
}
fs.writeFileSync(path.join(base, model, 'error-analysis.json'), JSON.stringify(out, null, 2) + '\n');
for (const s of out.suites) console.log(model, s.suite, s.error ?? `failures ${s.failures}, sampled ${s.sampled}: ${JSON.stringify(s.class_counts)}`);
