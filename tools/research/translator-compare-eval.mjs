#!/usr/bin/env node
/** Experiment `eval-translator-compare-v1`: TranslatorService backend comparison for Q-PIPE-1
 * (status/preregistrations/eval-translator-compare-v1.json, questions.md).
 *
 *   node tools/research/translator-compare-eval.mjs sets
 *   node tools/research/translator-compare-eval.mjs run   --set ro|mixed --arms direct,symbolic,symbolic-hybrid,opus-mt,matrix [--stage 100|full]
 *   node tools/research/translator-compare-eval.mjs score --set ro|mixed --arms ... [--stage 100|full]
 *   node tools/research/translator-compare-eval.mjs niche --arms symbolic,opus-mt
 *
 * `sets` draws a slice of datasets_archive/formalizer-v1/train.jsonl (deterministic seeded sample; formalizer-v1 *dev* is
 * fully consumed by eval-symbolic-lm-v1 -- see eval/reports/current/symbolic-lm/sets.json, every dev row id
 * appears in some arm there -- so this experiment uses train rows never touched by that comparison; recorded as a
 * deviation in the preregistration). Predictions are made from the row's message (`question`) alone (DS021).
 * Arms: `direct` (Stanza RO + RO rules), `symbolic` (TranslatorService `symbolic` backend, keepConstraints off,
 * matching eval-symbolic-lm-v1's plain `translate` arm), `symbolic-hybrid` (same backend, keepConstraints on, the
 * SymbolicLM v1.1 default), `opus-mt` (TranslatorService `opus-mt` backend: mask -> MarianMT CPU translation ->
 * restore -> English Stanza + rules), `matrix` (mixed set only: lib/languages-util/frame.mjs detects the frame
 * language from function words; a `ro` frame is parsed directly, an `en` frame gets its Romanian content words
 * glossed in place before parsing). `apertium` is not run: no Romanian-English Apertium pair exists (recorded in
 * tools/research/translator-backends/apertium.mjs and dependencies.md).
 *
 * Scoring (eval/run.mjs `evaluate`, DS016): strict (execution_equivalent, no dictionary) and the host-normalized
 * score (execution_equivalent_tolerant, dictionary on -- the "frame-normalized" reading of Q-PIPE-1's decision
 * rule, since it already equates an English-backend output with a Romanian gold through the shared dictionary);
 * paired cluster bootstrap over semantic_case_id (10,000 resamples, seed 7) vs `direct`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {detectFrame} from '../../lib/languages-util/frame.mjs';
import {defaultDictionary, fold} from '../../sop/dictionary.mjs';
import {evaluate} from '../../eval/run.mjs';
import {translateBatch as opusMtTranslateBatch, missing as opusMtMissing} from './translator-backends/opus-mt.mjs';
import {missing as apertiumMissing} from './translator-backends/apertium.mjs';
import {pairedDelta, wilson} from './symbolic-lm-eval.mjs';
import {stages as stratifiedStages} from './ud-baseline-eval.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/translator-compare');
const TRAIN = 'datasets_archive/formalizer-v1/train.jsonl';
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function argumentsOf(argv) {
  const [command, ...rest] = argv;
  const args = {command};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const key = rest[i].slice(2);
    args[key] = rest[i + 1] === undefined || rest[i + 1].startsWith('--') ? true : rest[++i];
  }
  return args;
}

/** Deterministic seeded shuffle (mulberry32), same family as tools/research/ud-baseline-eval.mjs. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffledIds(rows, seed) {
  const ids = rows.map(r => r.id);
  const random = mulberry(seed);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids;
}

// ------------------------------------------------------------------ sets

async function setsCommand() {
  const rows = readJsonlShardedSync(path.join(ROOT, TRAIN));
  const cleanMonoRo = rows.filter(r => r.language === 'ro' && (r.noise ?? []).length === 0 && !r.code_switch);
  const mixedRows = rows.filter(r => r.code_switch && r.code_switch.kind !== 'clause_switch');
  const roIds = new Set(shuffledIds(cleanMonoRo, 20260929).slice(0, 150));
  const mixedIds = new Set(shuffledIds(mixedRows, 20260930).slice(0, 100));
  const roRows = rows.filter(r => roIds.has(r.id));
  const mixedRowsSample = rows.filter(r => mixedIds.has(r.id));
  const roStages = stratifiedStages(roRows, r => r.question_type ?? 'unspecified', [100], 42);
  const mixedStages = stratifiedStages(mixedRowsSample, r => r.question_type ?? 'unspecified', [50], 43);
  const manifestSha = sha(fs.readFileSync(path.join(ROOT, 'datasets_archive/formalizer-v1/manifest.json'), 'utf8'));
  const out = {
    format: 'chatsop-translator-compare-sets-v1',
    method: 'Deterministic seeded sample (mulberry32) of datasets_archive/formalizer-v1/train.jsonl rows never scored by eval-symbolic-lm-v1 (which used only dev.jsonl and the OOD suite, every dev row id consumed -- see eval/reports/current/symbolic-lm/sets.json); nested stratified stage prefixes by question_type (tools/research/ud-baseline-eval.mjs stages).',
    train_manifest_sha256: manifestSha,
    sets: {
      ro: {suite: TRAIN, rows: roRows.length, stages: roStages, ids: [...roIds].sort()},
      mixed: {suite: TRAIN, rows: mixedRowsSample.length, stages: mixedStages, ids: [...mixedIds].sort()},
    },
  };
  writeJson(path.join(OUT, 'sets.json'), out);
  console.log(`ro ${roRows.length} rows, mixed ${mixedRowsSample.length} rows -> ${path.join(OUT, 'sets.json')}`);
}

function setRows(setName, stage) {
  const sets = JSON.parse(fs.readFileSync(path.join(OUT, 'sets.json'), 'utf8'));
  const def = sets.sets[setName];
  if (!def) throw Error(`unknown set ${setName}`);
  const rows = readJsonlShardedSync(path.join(ROOT, def.suite));
  const ids = new Set(stage === 'full' || !def.stages[stage] ? def.ids : def.stages[stage]);
  return rows.filter(r => ids.has(r.id));
}

// ------------------------------------------------------------------ matrix-language route (mixed messages)

/** Gloss the Romanian-labelled content words of `message` into English in place (word substitution only, no
 * clause reconstruction), for the `matrix` route when the frame language is English. Unknown words are left as
 * written (never guessed), matching the symbolic backend's own rule. */
/**
 * `labels`: SymbolicLM's own per-token language identification (`lm.identify(message).tokens`, word-kind only;
 * this labels every content and function word, unlike `detectFrame`'s closed-class function-word classification,
 * which only tells us the *frame*). Every token labelled `ro` (not a name) gets a single-word gloss from the host
 * dictionary if one exists; an unknown word is left as written, never guessed, matching the symbolic backend's
 * own rule.
 */
function matrixGloss(message, dictionary, labels) {
  const frame = detectFrame(message);
  const out = [];
  let changed = 0;
  for (const token of labels) {
    if (token.label !== 'ro') continue;
    const entries = dictionary.ro.get(fold(token.text)) ?? [];
    const hit = entries.map(([index]) => dictionary.entries[index]).find(e => e.en?.length && ['noun', 'verb', 'adj', 'relation'].includes(e.pos));
    if (!hit) continue;
    out.push([token.start, token.end, hit.en[0]]);
    changed++;
  }
  let text = message;
  for (const [start, end, replacement] of out.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + replacement + text.slice(end);
  return {text, frame: frame.frame, changed};
}

// ------------------------------------------------------------------ run

async function runCommand(args) {
  const stage = args.stage ?? 'full';
  const arms = String(args.arms ?? 'direct,symbolic,symbolic-hybrid,opus-mt').split(',');
  const rows = setRows(args.set, stage);
  const dir = path.join(OUT, 'runs', args.set);
  fs.mkdirSync(dir, {recursive: true});
  const dictionary = defaultDictionary();
  const lm = await createSymbolicLM({threads: args.threads ? Number(args.threads) : undefined});
  try {
    // opus-mt: batch-translate the whole stage once (throughput, not per-row latency).
    let opusMt = null;
    if (arms.includes('opus-mt')) {
      const bad = opusMtMissing();
      if (bad) { console.error(`opus-mt unavailable: ${bad}`); }
      else {
        console.error(`opus-mt: translating ${rows.length} messages...`);
        opusMt = opusMtTranslateBatch(rows.map(r => ({id: r.id, text: r.question})), {});
        writeJson(path.join(dir, 'opus-mt.timing.json'), opusMt.timing);
      }
    }
    for (const arm of arms) {
      if (arm === 'apertium') { console.error(`apertium: ${apertiumMissing()}`); continue; }
      if (arm === 'opus-mt' && !opusMt) continue;
      const predictions = [], traces = [];
      let done = 0;
      for (const row of rows) {
        const started = performance.now();
        let result, englishText = null, restoreInfo = null;
        try {
          if (arm === 'direct') result = await lm.analyze(row.question, {route: 'direct'});
          else if (arm === 'symbolic') result = await lm.analyze(row.question, {route: 'translate', keepConstraints: false});
          else if (arm === 'symbolic-hybrid') result = await lm.analyze(row.question, {route: 'translate', keepConstraints: true});
          else if (arm === 'opus-mt') {
            const hit = opusMt.results.get(row.id);
            englishText = hit?.text ?? row.question;
            restoreInfo = hit?.restore ?? null;
            result = await lm.analyze(englishText, {route: 'direct', language: 'en'});
          } else if (arm === 'matrix') {
            const gloss = matrixGloss(row.question, dictionary, lm.identify(row.question).tokens.filter(t => t.kind === 'word'));
            englishText = gloss.frame === 'en' ? gloss.text : row.question;
            result = gloss.frame === 'en' ? await lm.analyze(englishText, {route: 'direct', language: 'en'}) : await lm.analyze(row.question, {route: 'direct'});
            restoreInfo = {frame: gloss.frame, changed: gloss.changed};
          } else throw Error(`unknown arm ${arm}`);
        } catch (error) {
          result = {sop: '', valid: false, route: arm, error: error.message};
        }
        const ms = performance.now() - started;
        predictions.push({id: row.id, sop: result.sop ?? ''});
        traces.push({id: row.id, route: result.route, valid: result.valid, uncertain: result.uncertain ?? null, english: englishText ?? result.english ?? null, untranslated: (result.trace?.translation?.untranslated ?? []).map(u => u.word), restore: restoreInfo, ms, error: result.error ?? null});
        done++;
        if (done % 25 === 0) process.stderr.write(`\r${arm}: ${done}/${rows.length}`);
      }
      process.stderr.write(`\r${arm}: ${done}/${rows.length}\n`);
      writeJsonl(path.join(dir, `${arm}.predictions.jsonl`), predictions);
      writeJsonl(path.join(dir, `${arm}.traces.jsonl`), traces);
    }
  } finally { await lm.stop(); }
}

// ------------------------------------------------------------------ score

async function scoreCommand(args) {
  const stage = args.stage ?? 'full';
  const rows = setRows(args.set, stage);
  const arms = String(args.arms ?? 'direct,symbolic,symbolic-hybrid,opus-mt').split(',');
  const dir = path.join(OUT, 'runs', args.set);
  const records = {}, traces = {};
  for (const arm of arms) {
    const predFile = path.join(dir, `${arm}.predictions.jsonl`);
    if (!fs.existsSync(predFile)) { console.error(`${arm}: no predictions, skipped`); continue; }
    const predictions = new Map(readJsonl(predFile).map(p => [p.id, p.sop]));
    traces[arm] = new Map(readJsonl(path.join(dir, `${arm}.traces.jsonl`)).map(t => [t.id, t]));
    const subset = rows.filter(r => predictions.has(r.id));
    const report = await evaluate(subset, {predictor: ({id}) => predictions.get(id), config: {}, source: 'predictions'});
    records[arm] = report.records.map(r => ({id: r.id, strict: r.execution_equivalent ? 1 : 0, tolerant: r.execution_equivalent_tolerant ? 1 : 0, syntax: r.syntax_valid ? 1 : 0, prediction: r.prediction}));
    process.stderr.write(`scored ${arm}\n`);
  }
  const scored = Object.keys(records);
  const summary = {set: args.set, stage, rows: rows.length, arms: {}, paired: {}, speed_ms: {}};
  for (const arm of scored) {
    const rs = records[arm];
    const k = key => rs.filter(r => r[key]).length;
    const tr = [...traces[arm].values()].filter(t => rows.some(r => r.id === t.id));
    const ms = tr.map(t => t.ms).filter(Number.isFinite);
    summary.arms[arm] = {
      tolerant: k('tolerant') / rs.length, tolerant_ci95: wilson(k('tolerant'), rs.length),
      strict: k('strict') / rs.length, strict_ci95: wilson(k('strict'), rs.length),
      syntax: k('syntax') / rs.length,
      empty_or_invalid: rs.filter(r => !r.syntax || !String(r.prediction ?? '').trim()).length / rs.length,
      with_untranslated: tr.filter(t => t.untranslated?.length).length / Math.max(1, tr.length),
      errored: tr.filter(t => t.error).length,
    };
    summary.speed_ms[arm] = {mean: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null, count: ms.length};
  }
  const base = 'direct';
  if (records[base]) for (const arm of scored) {
    if (arm === base) continue;
    summary.paired[`${arm} - ${base}`] = {
      tolerant: pairedDelta(rows, records[base], records[arm], r => r.tolerant),
      strict: pairedDelta(rows, records[base], records[arm], r => r.strict),
    };
  }
  writeJson(path.join(dir, `score-${stage}.json`), summary);
  console.log(JSON.stringify({
    set: summary.set, stage, rows: summary.rows,
    arms: Object.fromEntries(Object.entries(summary.arms).map(([k, v]) => [k, {strict: +(v.strict * 100).toFixed(1), tolerant: +(v.tolerant * 100).toFixed(1), invalid: +(v.empty_or_invalid * 100).toFixed(1)}])),
    paired: Object.fromEntries(Object.entries(summary.paired).map(([k, v]) => [k, {strict: [+(v.strict.delta * 100).toFixed(1), v.strict.ci95?.map(x => +(x * 100).toFixed(1))], tolerant: [+(v.tolerant.delta * 100).toFixed(1), v.tolerant.ci95?.map(x => +(x * 100).toFixed(1))]}])),
  }, null, 1));
}

// ------------------------------------------------------------------ niche-word probe (no gold; categorized by hand after review)

async function nicheCommand(args) {
  const arms = String(args.arms ?? 'symbolic,opus-mt').split(',');
  const rows = readJsonl(path.join(OUT, 'niche-probe.jsonl'));
  const lm = await createSymbolicLM({threads: args.threads ? Number(args.threads) : undefined});
  try {
    let opusMt = null;
    if (arms.includes('opus-mt')) opusMt = opusMtTranslateBatch(rows.map(r => ({id: r.id, text: r.message})), {});
    const out = [];
    for (const row of rows) {
      const entry = {id: row.id, message: row.message, niche_words: row.niche_words, category: row.category, backends: {}};
      if (arms.includes('symbolic')) {
        const english = await lm.toEnglish(row.message);
        entry.backends.symbolic = {text: english.text, untranslated: english.untranslated.map(u => u.word)};
      }
      if (arms.includes('opus-mt') && opusMt) {
        const hit = opusMt.results.get(row.id);
        entry.backends['opus-mt'] = {text: hit?.text ?? null, masked: hit?.masked, maskedTranslation: hit?.maskedTranslation, restore: hit?.restore};
      }
      out.push(entry);
    }
    writeJsonl(path.join(OUT, 'niche-probe.outputs.jsonl'), out);
    console.log(`${out.length} niche-probe messages -> ${path.join(OUT, 'niche-probe.outputs.jsonl')}`);
  } finally { await lm.stop(); }
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command === 'sets') return setsCommand();
  if (args.command === 'run') return runCommand(args);
  if (args.command === 'score') return scoreCommand(args);
  if (args.command === 'niche') return nicheCommand(args);
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
