#!/usr/bin/env node
/** Experiment eval-clean-english-v1: formalization accuracy of the live SymbolicLM rules (verified identical to
 * frozen-rules-v1.4, SHA256SUMS check recorded in the topic notes) restricted to the clean-English partition
 * (`tools/datasets/clean-english.mjs`), against the same rules on the full English rows of the three sealed suites
 * (clean_en + noisy_en), so the gap shows how much of the earlier failure was input noise rather than a "justified"
 * (clean-English) parser/rules problem.
 *
 *   node tools/research/clean-english-eval.mjs sets                                    # stratified stages, both sets
 *   node tools/research/clean-english-eval.mjs run   --set clean|full-en [--stage 100|300|full] [--rewrite off|gated|always --port N]
 *   node tools/research/clean-english-eval.mjs score --set clean|full-en [--stage 100|300|full]
 *   node tools/research/clean-english-eval.mjs blame --set clean [--stage 100|300|full]  # Layer-2-style structural blame of clean-English misses
 *
 * Preregistration: status/preregistrations/eval-clean-english-v1.json. Outputs under eval/reports/current/clean-english/.
 * Reuses eval/run.mjs `evaluate`, tools/research/ud-baseline-eval.mjs `stages`, tools/research/symbolic-lm-eval.mjs
 * `wilson`/`pairedDelta`/`codeHashes`, sop/frames.mjs frame normalization, and tools/research/symbolic-layers-diff.mjs
 * `diffCategories`/`classesOf` for blame (no LLM judge: the heuristic diff is cheap and its classes are already
 * calibrated by the eval-symbolic-layers-en-v1 manual review).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {evaluate} from '../../eval/run.mjs';
import {stages} from './ud-baseline-eval.mjs';
import {wilson, pairedDelta, codeHashes} from './symbolic-lm-eval.mjs';
import {diffCategories, classesOf} from './symbolic-layers-diff.mjs';
import {loadFrames, normalizeProgram} from '../../sop/frames.mjs';
import {loadSpellfix} from '../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {classifyPartition} from '../datasets/clean-english.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/clean-english');
const CLEAN = 'eval/suites/clean-english/test.jsonl';
const SUITES = {'formalizer-v1': 'eval/suites/formalizer-v1/test.jsonl', 'formalizer-ood-v1': 'eval/suites/formalizer-ood-v1/test.jsonl', 'formalizer-wild-v1': 'eval/suites/formalizer-wild-v1/test.jsonl'};
const writeJson = (file, v) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(v, null, 1) + '\n'); };
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

function args(argv) { const [command, ...rest] = argv, out = {command}; for (let i = 0; i < rest.length; i++) { const k = rest[i].replace(/^--/, ''); out[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } return out; }

/** Full-English rows: clean_en + noisy_en of the three sealed suites by `classifyPartition` (excludes mixed rows
 * that happen to keep `language: "en"` with a code_switch tag or langid-mixed unquoted text), un-prefixed ids. */
let languageResources = null;
function fullEnRows() {
  languageResources ??= {spellfix: loadSpellfix(), dictionary: defaultDictionary()};
  const out = [];
  for (const [suite, file] of Object.entries(SUITES)) {
    for (const row of readJsonlShardedSync(path.join(ROOT, file))) {
      const {partition} = classifyPartition(row, languageResources);
      if (partition === 'clean_en' || partition === 'noisy_en') out.push({...row, suite, source_id: row.id, id: `${suite}::${row.id}`, clean_english_partition: partition});
    }
  }
  return out;
}
function cleanRows() { return readJsonlShardedSync(path.join(ROOT, CLEAN)); }

const SETS = {clean: cleanRows, 'full-en': fullEnRows};

function setsCommand() {
  const out = {};
  for (const [name, fn] of Object.entries(SETS)) {
    const rows = fn();
    out[name] = {rows: rows.length, stages: stages(rows, r => r.question_type ?? 'unspecified', [100, 300].filter(n => n < rows.length), 20260930)};
    console.log(name, rows.length);
  }
  writeJson(path.join(OUT, 'sets.json'), out);
}

function pickStage(setName, stage) {
  const info = JSON.parse(fs.readFileSync(path.join(OUT, 'sets.json'), 'utf8'))[setName];
  const rows = SETS[setName]();
  const ids = new Set(info.stages[stage] ?? info.stages.full ?? rows.map(r => r.id));
  return rows.filter(r => ids.has(r.id));
}

function llamaRewriter(port) {
  return async text => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: text}], temperature: 0, top_k: 1, max_tokens: 384, seed: 0})});
    if (!res.ok) throw Error(`llama-server ${res.status}`);
    const data = await res.json();
    return String(data.choices[0].message.content ?? '').trim();
  };
}

async function runCommand(o) {
  const stage = o.stage ?? 'full';
  const rows = pickStage(o.set, stage);
  const lm = await createSymbolicLM({device: 'cpu'});
  const rewrite = o.rewrite && o.rewrite !== 'off' ? llamaRewriter(Number(o.port ?? 8099)) : null;
  const rewriteWhen = o.rewrite === 'always' ? 'always' : undefined;
  const predictions = [];
  const started = performance.now();
  for (const row of rows) {
    let result;
    try { result = await lm.analyze(row.question, {route: 'direct', language: 'auto', rewrite, rewriteWhen}); }
    catch (error) { result = {sop: '', valid: false, outcome: 'crash', uncertain: null}; }
    predictions.push({id: row.id, sop: result.sop, valid: result.valid, outcome: result.outcome, uncertain: result.uncertain ?? null});
    if (predictions.length % 25 === 0) process.stderr.write(`\r${o.set} ${o.rewrite ?? 'off'} ${predictions.length}/${rows.length}`);
  }
  await lm.stop();
  const tag = o.rewrite && o.rewrite !== 'off' ? `-${o.rewrite}` : '';
  writeJsonl(path.join(OUT, 'runs', o.set, `predictions-${stage}${tag}.jsonl`), predictions);
  writeJson(path.join(OUT, 'runs', o.set, `manifest-${stage}${tag}.json`), {set: o.set, stage, rewrite: o.rewrite ?? 'off', rows: rows.length, code_sha256: codeHashes(), started_at: new Date(started).toISOString(), seconds: (performance.now() - started) / 1000});
  console.error(`\n${o.set} ${o.rewrite ?? 'off'} stage ${stage}: ${rows.length} rows in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

/** Early-stopping futility/condition check at stage 100 (AGENTS.md "Early stopping of experiments"). */
function conditionCheck(records) {
  const bad = records.filter(r => !r.syntax || !String(r.prediction ?? '').trim()).length;
  return {rows: records.length, unparsable_or_empty: bad, share: bad / records.length, broken: bad / records.length > 0.2};
}

/**
 * The wild suite (formalizer-wild-v1) carries no verification world (DS016 "Independent wild suite"): its rows
 * fail `evaluate()`'s setup/verification_context assertion by design. It is scored instead against every accepted
 * gold with `tools/eval/wild-suite.mjs` `scoreAgainstAccepted` (accepted_match / accepted_match_tolerant), the
 * same metric the codebase already uses for this suite. `executed` rows (formalizer-v1, formalizer-ood-v1) keep
 * `eval/run.mjs` `evaluate()` (strict/tolerant execution equivalence against their verification world).
 */
const isWildRow = row => (row.suite ?? row.id.split('::')[0]) === 'formalizer-wild-v1';

async function scoreCommand(o) {
  const stage = o.stage ?? 'full';
  const rows = pickStage(o.set, stage);
  const tag = o.rewrite && o.rewrite !== 'off' ? `-${o.rewrite}` : '';
  const predictions = new Map(readJsonl(path.join(OUT, 'runs', o.set, `predictions-${stage}${tag}.jsonl`)).map(p => [p.id, p.sop]));
  if (rows.some(r => !predictions.has(r.id))) throw Error('missing predictions for some rows of this stage');
  const frames = loadFrames();
  const executedRows = rows.filter(r => !isWildRow(r));
  const wildRows = rows.filter(isWildRow);
  const recOf = report => report.records.map(r => ({id: r.id, strict: r.execution_equivalent ? 1 : 0, tolerant: r.execution_equivalent_tolerant ? 1 : 0, syntax: r.syntax_valid ? 1 : 0, prediction: r.prediction}));
  let recStrict = [], recFrame = [];
  if (executedRows.length) {
    const reportStrict = await evaluate(executedRows, {predictor: ({id}) => predictions.get(id), config: {}, source: 'predictions'});
    const reportFrame = await evaluate(executedRows, {predictor: ({id}) => normalizeProgram(predictions.get(id), frames).sop, config: {}, source: 'predictions'});
    recStrict = recOf(reportStrict); recFrame = recOf(reportFrame);
  }
  const { scoreAgainstAccepted } = await import('../eval/wild-suite.mjs');
  for (const row of wildRows) {
    const sop = predictions.get(row.id);
    const accepted = row.sop_targets_accepted ?? [row.sop_target];
    const s = scoreAgainstAccepted(sop, accepted);
    let normalized = sop;
    try { normalized = normalizeProgram(sop, frames).sop; } catch { /* keep raw sop; scoreAgainstAccepted treats an unparsable prediction as all-zero */ }
    const f = scoreAgainstAccepted(normalized, accepted);
    recStrict.push({id: row.id, strict: s.accepted_match, tolerant: s.accepted_match_tolerant, syntax: s.parsed ? 1 : 0, prediction: sop});
    recFrame.push({id: row.id, strict: f.accepted_match, tolerant: f.accepted_match_tolerant, syntax: f.parsed ? 1 : 0, prediction: sop});
  }
  const condition = conditionCheck(recStrict);
  const k = (rs, key) => rs.filter(r => r[key]).length;
  const acc = rs => ({n: rs.length, strict: rs.length ? k(rs, 'strict') / rs.length : null, strict_ci95: rs.length ? wilson(k(rs, 'strict'), rs.length) : null, tolerant: rs.length ? k(rs, 'tolerant') / rs.length : null, tolerant_ci95: rs.length ? wilson(k(rs, 'tolerant'), rs.length) : null});
  const bySuite = {}, types = {};
  for (const row of rows) { (bySuite[row.suite ?? 'unspecified'] ??= []).push(row); (types[row.question_type ?? 'unspecified'] ??= []).push(row); }
  const sliceAcc = (groups, records) => Object.fromEntries(Object.entries(groups).map(([key, list]) => { const ids = new Set(list.map(r => r.id)); return [key, acc(records.filter(r => ids.has(r.id)))]; }));
  const summary = {
    set: o.set, rewrite: o.rewrite ?? 'off', stage, rows: rows.length, executed_rows: executedRows.length, wild_rows: wildRows.length, condition,
    method: 'formalizer-v1/formalizer-ood-v1 rows: eval/run.mjs evaluate() strict/tolerant execution equivalence; formalizer-wild-v1 rows (no verification world): tools/eval/wild-suite.mjs scoreAgainstAccepted accepted_match/accepted_match_tolerant against every accepted gold. Both pooled below as strict/tolerant.',
    overall: {strict: acc(recStrict), frame_normalized: acc(recFrame)},
    by_suite: {strict: sliceAcc(bySuite, recStrict), frame_normalized: sliceAcc(bySuite, recFrame)},
    by_question_type: {strict: sliceAcc(types, recStrict), frame_normalized: sliceAcc(types, recFrame)},
    paired_frame_minus_strict: recStrict.length ? pairedDelta(rows, recStrict, recFrame, r => r.strict) : null,
  };
  writeJson(path.join(OUT, `score-${o.set}-${stage}${tag}.json`), summary);
  console.log(JSON.stringify({set: o.set, rewrite: o.rewrite ?? 'off', stage, rows: rows.length, condition, strict: summary.overall.strict.strict !== null ? +(summary.overall.strict.strict * 100).toFixed(2) : null, frame: summary.overall.frame_normalized.strict !== null ? +(summary.overall.frame_normalized.strict * 100).toFixed(2) : null}, null, 1));
}

/** Paired comparison between two already-scored sets/stages (e.g. clean vs full-en), on their overlap-free own rows. */
async function compareCommand(o) {
  const a = JSON.parse(fs.readFileSync(path.join(OUT, `score-${o.a}.json`), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(OUT, `score-${o.b}.json`), 'utf8'));
  console.log(JSON.stringify({a: {set: a.set, stage: a.stage, strict: a.overall.strict.strict, ci: a.overall.strict.strict_ci95}, b: {set: b.set, stage: b.stage, strict: b.overall.strict.strict, ci: b.overall.strict.strict_ci95}, gap_pp: +((b.overall.strict.strict - a.overall.strict.strict) * 100).toFixed(2)}, null, 1));
}

/** Structural blame of clean-English misses (strict), reusing eval-symbolic-layers-en-v1's diff heuristic. Handles
 * the executed suites (eval/run.mjs evaluate) and the wild suite (accepted golds); a strict miss that host frame
 * normalization (sop/frames.mjs) repairs is reported as its own pattern `frame_normalization_recoverable`. */
async function blameCommand(o) {
  const stage = o.stage ?? 'full';
  const rows = pickStage(o.set, stage);
  const predictions = new Map(readJsonl(path.join(OUT, 'runs', o.set, `predictions-${stage}.jsonl`)).map(p => [p.id, p.sop]));
  const frames = loadFrames();
  const {scoreAgainstAccepted} = await import('../eval/wild-suite.mjs');
  const executedRows = rows.filter(r => !isWildRow(r));
  const strict = new Map(), frame = new Map();
  if (executedRows.length) {
    const rs = await evaluate(executedRows, {predictor: ({id}) => predictions.get(id), config: {}, source: 'predictions'});
    const rf = await evaluate(executedRows, {predictor: ({id}) => normalizeProgram(predictions.get(id), frames).sop, config: {}, source: 'predictions'});
    for (const r of rs.records) strict.set(r.id, {ok: !!r.execution_equivalent, syntax: !!r.syntax_valid, prediction: r.prediction});
    for (const r of rf.records) frame.set(r.id, {ok: !!r.execution_equivalent});
  }
  for (const row of rows.filter(isWildRow)) {
    const sop = predictions.get(row.id), accepted = row.sop_targets_accepted ?? [row.sop_target];
    const sc = scoreAgainstAccepted(sop, accepted);
    let normalized = sop; try { normalized = normalizeProgram(sop, frames).sop; } catch { /* keep raw */ }
    strict.set(row.id, {ok: !!sc.accepted_match, syntax: !!sc.parsed, prediction: sop});
    frame.set(row.id, {ok: !!scoreAgainstAccepted(normalized, accepted).accepted_match});
  }
  const byPattern = new Map(), byClass = {}, byCategory = new Map();
  let misses = 0, correct = 0, recoverable = 0;
  for (const row of rows) {
    const r = strict.get(row.id);
    if (r.ok) { correct++; continue; }
    misses++;
    let key, classes, cats = [];
    if (frame.get(row.id)?.ok) { key = 'frame_normalization_recoverable'; classes = ['F']; recoverable++; }
    else {
      cats = !r.syntax ? [{cat: 'invalid_syntax', detail: 'prediction does not parse'}] : diffCategories(r.prediction, row.sop_target, {executed: !isWildRow(row), message: row.question});
      classes = classesOf(cats);
      key = cats.length ? cats.map(c => c.cat).sort().join('+') : 'no_structural_diff';
    }
    for (const c of classes) byClass[c] = (byClass[c] ?? 0) + 1;
    for (const cat of new Set(cats.length ? cats.map(c => c.cat) : [key])) {
      if (!byCategory.has(cat)) byCategory.set(cat, {count: 0, classes: classesOf(cat === key ? [] : [{cat}]), suites: {}, examples: []});
      const ce = byCategory.get(cat);
      ce.count++; ce.suites[row.suite] = (ce.suites[row.suite] ?? 0) + 1;
      if (ce.examples.length < 3) ce.examples.push({id: row.id, message: row.question, gold: row.sop_target, predicted: r.prediction, detail: cats.filter(c => c.cat === cat).map(c => c.detail).slice(0, 2)});
    }
    if (!byPattern.has(key)) byPattern.set(key, {count: 0, classes, suites: {}, types: {}, examples: []});
    const entry = byPattern.get(key);
    entry.count++;
    entry.suites[row.suite] = (entry.suites[row.suite] ?? 0) + 1;
    entry.types[row.question_type ?? 'unspecified'] = (entry.types[row.question_type ?? 'unspecified'] ?? 0) + 1;
    if (entry.examples.length < 3) entry.examples.push({id: row.id, message: row.question, gold: row.sop_target, predicted: r.prediction, cats});
  }
  const sorted = [...byPattern.entries()].sort((a, b) => b[1].count - a[1].count);
  const summary = {set: o.set, stage, rows: rows.length, correct, misses, frame_recoverable: recoverable, residual_misses: misses - recoverable, blame_class_counts: byClass, class_legend: {P: 'parser/input', R: 'rules', C: 'gold convention', L: 'language', E: 'evaluation equivalence', F: 'frame normalization recovers it'}, top_categories: [...byCategory.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10).map(([category, v]) => ({category, ...v})), top_patterns: sorted.slice(0, 10).map(([pattern, v]) => ({pattern, ...v})), all_pattern_counts: sorted.map(([k, v]) => [k, v.count, v.classes.join('')])};
  writeJson(path.join(OUT, `blame-${o.set}-${stage}.json`), summary);
  console.log(JSON.stringify({set: o.set, stage, rows: rows.length, correct, misses, recoverable, byClass, top10: sorted.slice(0, 10).map(([p, v]) => [p, v.count, v.classes.join('')])}, null, 1));
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.command === 'sets') return setsCommand();
  if (o.command === 'run') return runCommand(o);
  if (o.command === 'score') return scoreCommand(o);
  if (o.command === 'compare') return compareCommand(o);
  if (o.command === 'blame') return blameCommand(o);
  throw Error('unknown command ' + o.command);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
