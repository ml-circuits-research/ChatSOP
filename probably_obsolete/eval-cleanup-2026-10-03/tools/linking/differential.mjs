#!/usr/bin/env node
/**
 * Differential run of the linker over the dev rows of symbolic_english (linking proposal, M1 acceptance): every row's program runs
 * against the verification world of its source row and the observable summary (world kind, status, answers, text, execution
 * signature) is recorded; `compare` reports every row whose summary differs from a recorded run and classifies each difference against the
 * expected result of the row's source row: a regression (the recorded run agreed with the expected status and answers, the new one does
 * not), an improvement (the reverse) or neutral. It guards changes of the lexicon grammar and of the linker: a change that is meant to
 * keep linking intact must show zero regressions. Exit code 1 on any regression.
 *
 *   node tools/linking/differential.mjs record [--out FILE]       default eval/reports/current/linking/differential-after.json
 *   node tools/linking/differential.mjs compare [--before FILE] [--after FILE]
 *                                                                  default differential-before.json against a fresh run
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {worldOfDatasetRow, runAgainstWorld, legacyRows} from './rows.mjs';
import {Lexicon} from '../../sop/lexicon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'eval/reports/current/linking');
const args = Object.fromEntries(process.argv.slice(3).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));

export async function recordRows(dataset = 'symbolic_english', split = 'dev') {
  const rows = readJsonlShardedSync(path.join(ROOT, 'datasets', dataset, split + '.jsonl')), out = {}, lexicons = new Map();
  for (const row of rows) {
    const sop = row.gold_sop ?? row.sop;
    if (!sop) continue;
    const world = worldOfDatasetRow(row);
    let lexicon = lexicons.get(world.ontology);
    if (!lexicon) { lexicon = new Lexicon(world.ontology); if (lexicons.size > 200) lexicons.clear(); lexicons.set(world.ontology, lexicon); }
    const {status, answers, count, text, execution, error} = await runAgainstWorld({sop, message: row.message, world, language: world.language ?? 'en', lexicon});
    out[row.id] = {world: world.source, status, answers, ...(count !== undefined ? {count} : {}), ...(error ? {error} : {}), text, execution};
  }
  return out;
}

/** Does a recorded summary agree with the expected status (and answers, when the source row has some)? null when the source has no expectation. */
function agrees(summary, expected) {
  if (!expected?.status) return null;
  if (summary.status !== expected.status) return false;
  if (expected.answers?.length) return JSON.stringify([...summary.answers].sort()) === JSON.stringify(expected.answers.map(a => JSON.stringify(a)).sort());
  return true;
}

/** Classifies the differences of two recordings against the expected results of the source rows. */
export function classify(before, after, dataset = 'symbolic_english', split = 'dev') {
  const sourceOf = new Map(readJsonlShardedSync(path.join(ROOT, 'datasets', dataset, split + '.jsonl')).map(r => [r.id, r.source?.id]));
  const legacy = legacyRows(), out = {regressions: [], improvements: 0, neutral: 0};
  for (const d of differences(before, after)) {
    if (d.missing) { out.regressions.push({id: d.id, missing: d.missing}); continue; }
    const expected = legacy.get(sourceOf.get(d.id))?.expected, was = agrees(d.before, expected), is = agrees(d.after, expected);
    if (was && !is) out.regressions.push({id: d.id, expected, before: d.before, after: d.after});
    else if (is && !was) out.improvements++;
    else out.neutral++;
  }
  return out;
}

const strip = r => ({...r, execution: undefined});
export function differences(before, after, {execution = true} = {}) {
  const diffs = [];
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[id], b = after[id];
    if (!a || !b) { diffs.push({id, missing: !a ? 'before' : 'after'}); continue; }
    if (JSON.stringify(execution ? a : strip(a)) !== JSON.stringify(execution ? b : strip(b))) diffs.push({id, before: a, after: b});
  }
  return diffs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'record') {
    const file = path.resolve(ROOT, args.out ?? path.join(DIR, 'differential-after.json'));
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const rows = await recordRows();
    fs.writeFileSync(file, JSON.stringify({made_with: 'knowledge grammar (M1)', rows}, null, 1) + '\n');
    console.log(JSON.stringify({file, rows: Object.keys(rows).length}));
  } else if (cmd === 'compare') {
    const before = JSON.parse(fs.readFileSync(path.resolve(ROOT, args.before ?? path.join(DIR, 'differential-before.json')), 'utf8')).rows;
    const after = args.after ? JSON.parse(fs.readFileSync(path.resolve(ROOT, args.after), 'utf8')).rows : await recordRows();
    const diffs = differences(before, after), classes = classify(before, after);
    console.log(JSON.stringify({rows: Object.keys(before).length, differences: diffs.length, regressions: classes.regressions.length, improvements: classes.improvements, neutral: classes.neutral, regression_examples: classes.regressions.slice(0, 5)}, null, 1));
    process.exit(classes.regressions.length ? 1 : 0);
  } else { console.error('usage: differential.mjs record|compare'); process.exit(2); }
}
