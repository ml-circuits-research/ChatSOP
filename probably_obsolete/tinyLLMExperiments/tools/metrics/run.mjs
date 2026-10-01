#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluate } from '../../eval/run.mjs';
import { computeMetrics } from '../../eval/metrics.mjs';

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw Error(`${file}:${index + 1}: invalid JSON`); }
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    assert(['--file', '--predictions', '--out', '--config', '--gold-as-prediction'].includes(key), `Unknown option ${key}`);
    assert(!options.has(key), `Duplicate option ${key}`);
    if (key === '--gold-as-prediction') options.set(key, true);
    else {
      assert(argv[i + 1] && !argv[i + 1].startsWith('--'), `Missing value for ${key}`);
      options.set(key, argv[++i]);
    }
  }
  assert(options.has('--file') && options.has('--out'), '--file and --out are required');
  assert(options.has('--gold-as-prediction') !== options.has('--predictions'), 'Choose exactly one explicit prediction source');
  const rows = readJsonl(options.get('--file'));
  assert(rows.length > 0, 'Suite must have rows');
  const predictions = options.has('--predictions') ? readJsonl(options.get('--predictions')) : rows.map(row => ({ id: row.id, sop: row.sop_target }));
  const byId = new Map(predictions.map(row => [row.id, row.sop ?? row.prediction]));
  assert.equal(byId.size, predictions.length, 'Duplicate prediction IDs');
  assert.equal(byId.size, rows.length, 'Prediction coverage must exactly match suite');
  assert(rows.every(row => typeof byId.get(row.id) === 'string'), 'Missing prediction or unknown ID');
  const config = options.has('--config') ? JSON.parse(fs.readFileSync(options.get('--config'), 'utf8')) : {};
  const report = await evaluate(rows, { predictor: ({ id }) => byId.get(id), config, source: 'predictions' });
  report.run_label = options.has('--gold-as-prediction') ? 'gold-as-prediction sanity check' : 'explicit predictions (model identity unverified)';
  const metrics = computeMetrics(rows, report);
  const out = path.resolve(options.get('--out'));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'evaluation.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify({ run_label: metrics.run_label, rows: metrics.rows, valid_references: metrics.valid_references,
    executed_predictions: metrics.executed_predictions, execution_equivalence: metrics.formalizer.execution_equivalence,
    report_dir: out, evaluation_valid: report.evaluation_valid,
    neural_model_evaluated: options.has('--gold-as-prediction') ? false : 'not verified' }));
  if (!report.evaluation_valid) process.exitCode = 1;
  return metrics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
