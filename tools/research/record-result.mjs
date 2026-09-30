#!/usr/bin/env node
/** Records one partial result of the formalizer size study in status/experiments.json and the project journal.
 *
 *   node tools/research/record-result.mjs --model M --part NAME --metrics <metrics.json | wild.json | reference-free.json>
 *
 * It copies the headline numbers (with counts) into experiments[formalizer-size-v1].results.partial[M][NAME] and
 * appends one `progress` journal event. It computes nothing new and never marks the experiment done.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appendJournal, makeEvent, validateExperiment} from '../../lib/journal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const get = name => { const i = argv.indexOf(`--${name}`); if (i < 0 || !argv[i + 1]) throw Error(`--${name} is required`); return argv[i + 1]; };
const model = get('model'), part = get('part'), file = get('metrics');
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const pct = f => (f && f.denominator ? `${(100 * f.value).toFixed(1)}% (${f.numerator}/${f.denominator})` : 'n/a');

let headline, text;
if (report.formalizer) {
  const f = report.formalizer, lang = report.slices?.by_language_slice ?? {};
  headline = {rows: report.rows, valid_references: report.valid_references, parse_rate: f.parse_rate, canonical_ast_match: f.canonical_ast_match,
    execution_equivalence: f.execution_equivalence, execution_equivalence_tolerant: f.execution_equivalence_tolerant,
    tolerant_by_language: Object.fromEntries(Object.entries(lang).map(([k, v]) => [k, v.formalizer?.execution_equivalence_tolerant])),
    tolerant_by_hard_slice: Object.fromEntries(Object.entries(report.slices?.by_hard_slice ?? {}).map(([k, v]) => [k, v.formalizer?.execution_equivalence_tolerant]))};
  text = `parse ${pct(f.parse_rate)}, canonical ${pct(f.canonical_ast_match)}, strict exec ${pct(f.execution_equivalence)}, tolerant exec ${pct(f.execution_equivalence_tolerant)}; tolerant by language ${Object.entries(headline.tolerant_by_language).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`;
} else if (report.overall) {
  headline = {overall: report.overall, by_language: report.by_language};
  const o = report.overall;
  text = `wild accepted-gold: rows ${o.rows}, parsed ${(100 * o.parsed).toFixed(1)}%, accepted_match ${(100 * o.accepted_match).toFixed(1)}%, decision_match ${(100 * o.decision_match).toFixed(1)}%, shape_match ${(100 * o.shape_match).toFixed(1)}%, proposition F1 ${o.proposition_f1.toFixed(3)}; by language ${Object.entries(report.by_language).map(([k, v]) => `${k} ${(100 * v.accepted_match).toFixed(1)}% of ${v.rows}`).join(', ')}`;
} else if (report.reference_free) {
  headline = {rows: report.rows, reference_free: Object.fromEntries(Object.entries(report.reference_free).map(([k, v]) => [k, v?.value ?? v]))};
  text = `reference-free: ${Object.entries(headline.reference_free).filter(([, v]) => typeof v === 'number').slice(0, 8).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ')}`;
} else throw Error(`Unrecognized report ${file}`);

const registry = path.join(root, 'status/experiments.json');
const value = JSON.parse(fs.readFileSync(registry, 'utf8'));
const experiment = value.experiments.find(e => e.id === 'formalizer-size-v1');
experiment.results = experiment.results && typeof experiment.results === 'object' ? experiment.results : {};
experiment.results.partial ??= {};
experiment.results.partial[model] ??= {};
experiment.results.partial[model][part] = {...headline, report: path.relative(root, path.resolve(file)), recorded_at: new Date().toISOString()};
validateExperiment(experiment);
fs.writeFileSync(registry, JSON.stringify(value, null, 2) + '\n');
appendJournal(makeEvent({area: 'eval', state: 'progress', actor: process.env.CHATSOP_ACTOR || 'training-agent', title: `formalizer-size-v1 ${model}: ${part}`, detail: `${text}. Q8_0 GGUF on CPU, message-only input; partial result, not yet the full arm.`, links: [path.relative(root, path.resolve(file))]}));
console.log(`${model} ${part}: ${text}`);
