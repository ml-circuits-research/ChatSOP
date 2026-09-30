#!/usr/bin/env node
/** Experiment eval-clean-english-v1: staged report over the predictions written by
 * tools/research/clean-english-eval.mjs (`run`). Scores every row once at the full stage (or the stage of the
 * predictions file), slices the 100/300 stages by the ids of eval/reports/current/clean-english/sets.json, and
 * writes eval/reports/current/clean-english/report.json:
 *   - clean vs full-en vs noisy_en (strict and frame-normalized), overall, per suite, per question type, per stage
 *   - independent-samples cluster-bootstrap gaps (the sets overlap: clean is a subset of full-en, so the
 *     clean-vs-full-en gap is conservative; clean vs noisy_en is a disjoint contrast)
 *   - the proofreader arms (rewrite off / gated / always-on) on the clean stage-300 rows, paired vs the off arm
 *
 *   node tools/research/clean-english-report.mjs [--arms-stage 300]
 *
 * Scoring is exactly clean-english-eval.mjs `score`: formalizer-v1/OOD rows by eval/run.mjs evaluate() (strict
 * execution equivalence), formalizer-wild-v1 rows by tools/eval/wild-suite.mjs scoreAgainstAccepted (accepted_match).
 * No LLM judge, no training.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {evaluate} from '../../eval/run.mjs';
import {wilson, pairedDelta} from './symbolic-lm-eval.mjs';
import {loadFrames, normalizeProgram} from '../../sop/frames.mjs';
import {loadSpellfix} from '../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {classifyPartition} from '../datasets/clean-english.mjs';
import {scoreAgainstAccepted} from '../eval/wild-suite.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/clean-english');
const SUITES = {'formalizer-v1': 'eval/suites/formalizer-v1/test.jsonl', 'formalizer-ood-v1': 'eval/suites/formalizer-ood-v1/test.jsonl', 'formalizer-wild-v1': 'eval/suites/formalizer-wild-v1/test.jsonl'};
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const isWild = row => row.suite === 'formalizer-wild-v1';
const frames = loadFrames();

function fullEnRows() {
  const resources = {spellfix: loadSpellfix(), dictionary: defaultDictionary()};
  const out = [];
  for (const [suite, file] of Object.entries(SUITES)) for (const row of readJsonlShardedSync(path.join(ROOT, file))) {
    const {partition} = classifyPartition(row, resources);
    if (partition === 'clean_en' || partition === 'noisy_en') out.push({...row, suite, id: `${suite}::${row.id}`, partition});
  }
  return out;
}

/** Per-row {id, strict, frame} for the rows that have a prediction. */
async function scoreRows(rows, predictions) {
  const records = new Map();
  const executed = rows.filter(r => !isWild(r) && predictions.has(r.id));
  if (executed.length) {
    const rs = await evaluate(executed, {predictor: ({id}) => predictions.get(id), config: {}, source: 'predictions'});
    const rf = await evaluate(executed, {predictor: ({id}) => normalizeProgram(predictions.get(id), frames).sop, config: {}, source: 'predictions'});
    const frameById = new Map(rf.records.map(r => [r.id, r]));
    for (const r of rs.records) records.set(r.id, {id: r.id, strict: r.execution_equivalent ? 1 : 0, frame: frameById.get(r.id).execution_equivalent ? 1 : 0});
  }
  for (const row of rows.filter(r => isWild(r) && predictions.has(r.id))) {
    const sop = predictions.get(row.id), accepted = row.sop_targets_accepted ?? [row.sop_target];
    let normalized = sop; try { normalized = normalizeProgram(sop, frames).sop; } catch { /* keep raw */ }
    records.set(row.id, {id: row.id, strict: scoreAgainstAccepted(sop, accepted).accepted_match ? 1 : 0, frame: scoreAgainstAccepted(normalized, accepted).accepted_match ? 1 : 0});
  }
  return records;
}

const pct = x => x === null || x === undefined ? null : +(x * 100).toFixed(1);
const ci = a => a ? a.map(pct) : null;
function acc(rows, records) {
  const rs = rows.map(r => records.get(r.id)).filter(Boolean);
  const k = key => rs.filter(r => r[key]).length, n = rs.length;
  return {n, strict: n ? pct(k('strict') / n) : null, strict_ci95: n ? ci(wilson(k('strict'), n)) : null, frame: n ? pct(k('frame') / n) : null, frame_ci95: n ? ci(wilson(k('frame'), n)) : null};
}
function slices(rows, records, keyOf) {
  const groups = {};
  for (const r of rows) (groups[keyOf(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(groups).sort().map(([k, list]) => [k, acc(list, records)]));
}

/** Seeded cluster bootstrap of mean(a) - mean(b) for two independent (possibly overlapping) row sets. */
function independentGap(rowsA, rowsB, records, key, B = 4000, seed = 20260930) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const clusters = rows => { const m = new Map(); for (const r of rows) { const rec = records.get(r.id); if (!rec) continue; const c = r.semantic_case_id ?? r.id; (m.get(c) ?? m.set(c, []).get(c)).push(rec[key]); } return [...m.values()]; };
  const ca = clusters(rowsA), cb = clusters(rowsB);
  const mean = cl => { let sum = 0, n = 0; for (const c of cl) for (const v of c) { sum += v; n++; } return n ? sum / n : 0; };
  const draw = cl => Array.from({length: cl.length}, () => cl[Math.floor(rnd() * cl.length)]);
  const diffs = [];
  for (let i = 0; i < B; i++) diffs.push(mean(draw(ca)) - mean(draw(cb)));
  diffs.sort((x, y) => x - y);
  return {gap_pp: pct(mean(ca) - mean(cb)), ci95_pp: [pct(diffs[Math.floor(B * 0.025)]), pct(diffs[Math.floor(B * 0.975)])], n_a: rowsA.length, n_b: rowsB.length};
}

async function main() {
  const sets = JSON.parse(fs.readFileSync(path.join(OUT, 'sets.json'), 'utf8'));
  const cleanRows = readJsonlShardedSync(path.join(ROOT, 'eval/suites/clean-english/test.jsonl'));
  const fullRows = fullEnRows();
  const noisyRows = fullRows.filter(r => r.partition === 'noisy_en');
  const report = {generated_at: new Date().toISOString(), preregistration: 'status/preregistrations/eval-clean-english-v1.json', sets: {clean: cleanRows.length, 'full-en': fullRows.length, noisy_en: noisyRows.length}, stages: {}};

  const cleanPred = new Map(readJsonl(path.join(OUT, 'runs/clean/predictions-full.jsonl')).map(p => [p.id, p.sop]));
  const fullPred = new Map(readJsonl(path.join(OUT, 'runs/full-en/predictions-full.jsonl')).map(p => [p.id, p.sop]));
  const cleanRec = await scoreRows(cleanRows, cleanPred);
  const fullRec = await scoreRows(fullRows, fullPred);
  const keep = (rows, ids) => { const set = new Set(ids); return rows.filter(r => set.has(r.id)); };

  for (const stage of ['100', '300', 'full']) {
    const cRows = stage === 'full' ? cleanRows : keep(cleanRows, sets.clean.stages[stage]);
    const fRows = stage === 'full' ? fullRows : keep(fullRows, sets['full-en'].stages[stage]);
    const nRows = fRows.filter(r => r.partition === 'noisy_en');
    const entry = {
      clean: {overall: acc(cRows, cleanRec), by_suite: slices(cRows, cleanRec, r => r.suite), by_question_type: slices(cRows, cleanRec, r => r.question_type ?? 'unspecified')},
      'full-en': {overall: acc(fRows, fullRec), by_suite: slices(fRows, fullRec, r => r.suite), by_question_type: slices(fRows, fullRec, r => r.question_type ?? 'unspecified')},
      noisy_en: {overall: acc(nRows, fullRec), by_suite: slices(nRows, fullRec, r => r.suite)},
      gap_clean_minus_full_en: {strict: independentGap(cRows, fRows, new Map([...cleanRec, ...fullRec]), 'strict'), frame: independentGap(cRows, fRows, new Map([...cleanRec, ...fullRec]), 'frame')},
      gap_clean_minus_noisy_en: {strict: independentGap(cRows, nRows, new Map([...cleanRec, ...fullRec]), 'strict'), frame: independentGap(cRows, nRows, new Map([...cleanRec, ...fullRec]), 'frame')},
    };
    // paired frame-vs-strict on the same rows (recompute cleanly: a = strict, b = frame)
    const strictRecs = cRows.map(r => ({id: r.id, v: cleanRec.get(r.id).strict})), frameRecs = cRows.map(r => ({id: r.id, v: cleanRec.get(r.id).frame}));
    const pd = pairedDelta(cRows, strictRecs, frameRecs, r => r.v);
    entry.paired_frame_minus_strict_clean = {delta_pp: pct(pd.delta), ci95_pp: ci(pd.ci95), frame_better: pd.b_better, strict_better: pd.a_better};
    report.stages[stage] = entry;
  }

  // Proofreader arms on the clean stage-300 rows and, when the runs exist, on the full clean set.
  report.proofreader_arms_clean = {model: 'models/gemma/proofreader-gemma270m-v1/proofreader/merged-best/gguf/q8_0.gguf via llama-server (CPU)'};
  for (const armStage of ['300', 'full']) {
    const arms = {};
    const rowsA = armStage === 'full' ? cleanRows : keep(cleanRows, sets.clean.stages[armStage]);
    const armPreds = {off: new Map(rowsA.map(r => [r.id, cleanPred.get(r.id)]))};
    for (const arm of ['gated', 'always']) {
      const file = path.join(OUT, `runs/clean/predictions-${armStage}-${arm}.jsonl`);
      if (fs.existsSync(file)) armPreds[arm] = new Map(readJsonl(file).map(p => [p.id, p.sop]));
    }
    const armRec = {};
    for (const [arm, preds] of Object.entries(armPreds)) armRec[arm] = await scoreRows(rowsA, preds);
    for (const [arm, rec] of Object.entries(armRec)) {
      const entry = {overall: acc(rowsA, rec), by_suite: slices(rowsA, rec, r => r.suite)};
      if (arm !== 'off') for (const key of ['strict', 'frame']) {
        const a = rowsA.map(r => ({id: r.id, v: armRec.off.get(r.id)[key]})), b = rowsA.map(r => ({id: r.id, v: rec.get(r.id)[key]}));
        const d = pairedDelta(rowsA, a, b, x => x.v);
        entry[`paired_vs_off_${key}`] = {delta_pp: pct(d.delta), ci95_pp: ci(d.ci95), helped: d.b_better, hurt: d.a_better, mcnemar_p: d.mcnemar_p};
      }
      arms[arm] = entry;
    }
    report.proofreader_arms_clean[`stage_${armStage}`] = {rows: rowsA.length, arms};
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  const s = report.stages.full;
  console.log(JSON.stringify({sets: report.sets, full: {clean: s.clean.overall, 'full-en': s['full-en'].overall, noisy: s.noisy_en.overall, gap: s.gap_clean_minus_full_en, gapNoisy: s.gap_clean_minus_noisy_en}, arms: Object.fromEntries(Object.entries(report.proofreader_arms_clean).filter(([k]) => k.startsWith('stage_')).map(([k, v]) => [k, Object.fromEntries(Object.entries(v.arms).map(([a, e]) => [a, [e.overall.strict, e.overall.frame]]))]))}, null, 1));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
