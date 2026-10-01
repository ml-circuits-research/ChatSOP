#!/usr/bin/env node
/** Experiment text-to-clean-english-v1: candidate backends for the pre-formalization cleaning step (inference only).
 *
 * Subcommands:
 *   node tools/research/text-to-clean-english-eval.mjs control            # build the ~20-row already-clean control sample
 *   node tools/research/text-to-clean-english-eval.mjs symbolic-all --files a.jsonl:a-out.jsonl,... [--route auto]   # parse several outputs in one worker; `auto` for the untouched original
 *   node tools/research/text-to-clean-english-eval.mjs symbolic --file <candidate-output.jsonl> --out <scored.jsonl>
 *   node tools/research/text-to-clean-english-eval.mjs exec --sample <sample.jsonl> --symbolic <symbolic.jsonl> --out <exec.jsonl>
 *   node tools/research/text-to-clean-english-eval.mjs metrics --sample <sample.jsonl> --candidate <name> --file <candidate-output.jsonl> --symbolic <symbolic.jsonl> [--exec <exec.jsonl>] --out <metrics.jsonl>
 *   node tools/research/text-to-clean-english-eval.mjs compare --dir <reportDir> --out <comparison.json>   # paired bootstrap between candidates on shared rows
 *   node tools/research/text-to-clean-english-eval.mjs summarize --dir <reportDir>
 *
 * Every candidate's SOP is produced by parsing its PRECOMPUTED cleaned text with lib/symbolic-lm (route direct,
 * language en) -- never the row's original message -- then scored by eval/run.mjs evaluate() against the row's own
 * gold sop_target (DS016 execution_equivalent / execution_equivalent_tolerant).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {identify, lexiconsFromSpellfix, loadSpellfix} from '../../lib/languages-util/index.mjs';
import {evaluate} from '../../eval/run.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEV = path.join(ROOT, 'datasets_archive/formalizer-v1/dev.jsonl');

function argumentsOf(argv) {
  const [command, ...rest] = argv;
  const args = {command};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) throw Error('Unexpected argument ' + rest[i]);
    const key = rest[i].slice(2);
    args[key] = rest[i + 1] === undefined || rest[i + 1].startsWith('--') ? true : rest[++i];
  }
  return args;
}
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const devRows = (() => { let cache; return () => (cache ??= readJsonlShardedSync(DEV)); })();

// ------------------------------------------------------------------ control sample (already-clean English rows)

function controlCommand() {
  const rows = devRows().filter(r => r.language === 'en' && !r.code_switch && !(r.noise?.length));
  const random = mulberry(20260930);
  const shuffled = [...rows];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const picked = shuffled.slice(0, 20);
  const sample = picked.map(r => ({id: r.id, kind: 'control', text: r.question, gold_sop: r.sop_target, source: 'formalizer-v1'}));
  writeJsonl(path.join(ROOT, 'eval/reports/current/text-to-clean-english/samples/control-sample.jsonl'), sample);
  writeJsonl(path.join(ROOT, 'eval/reports/current/text-to-clean-english/samples/control-input.jsonl'), picked.map(r => ({id: r.id, text: r.question})));
  console.log(JSON.stringify({picked: picked.length, seed: 20260930}));
}

// ------------------------------------------------------------------ SymbolicLM parse of candidate outputs

async function parseOneFile(lm, lexicons, file, out, {route = 'direct', language = 'en'} = {}) {
  const rows = readJsonl(path.join(ROOT, file));
  const results = [];
  let done = 0;
  for (const row of rows) {
    const text = String(row.output ?? row.text ?? '').trim();
    let sop = '', unparsedCount = 0, outcome = 'empty', language = null;
    if (text) {
      try {
        const result = await lm.analyze(text, {route, language});
        sop = result.sop ?? '';
        unparsedCount = result.trace?.unparsed?.length ?? (sop.match(/^\s*unparsed\b/gm) ?? []).length;
        outcome = result.outcome;
      } catch (error) { outcome = 'crash:' + error.message; }
      const lid = identify(text, {lexicons});
      language = lid.language;
    }
    results.push({id: row.id, sop, unparsed: unparsedCount, outcome, language});
    done++;
    if (done % 20 === 0) process.stderr.write(`\r${file} symbolic ${done}/${rows.length}`);
  }
  writeJsonl(path.join(ROOT, out), results);
  console.error(`\n${out}: ${results.length} rows`);
}

async function symbolicCommand(args) {
  const lexicons = lexiconsFromSpellfix(loadSpellfix());
  const lm = new (await import('../../lib/symbolic-lm/index.mjs')).SymbolicLM({device: 'cpu', threads: Number(args.threads ?? 8)});
  await lm.start();
  await parseOneFile(lm, lexicons, args.file, args.out);
  await lm.stop();
}

/** Parses several candidate output files in one Stanza worker session (--files a.jsonl:a-out.jsonl,b.jsonl:b-out.jsonl). */
async function symbolicAllCommand(args) {
  const lexicons = lexiconsFromSpellfix(loadSpellfix());
  const lm = new (await import('../../lib/symbolic-lm/index.mjs')).SymbolicLM({device: 'cpu', threads: Number(args.threads ?? 4)});
  await lm.start();
  for (const pair of String(args.files).split(',')) {
    const [file, out] = pair.split(':');
    // `--route auto` parses each text the way the formalization path would (its own language, route by language): the "send the original" baseline.
    await parseOneFile(lm, lexicons, file, out, args.route === 'auto' ? {route: 'auto', language: 'auto'} : {});
  }
  await lm.stop();
}

// ------------------------------------------------------------------ meaning-preservation, fluency, hallucination metrics

const NEGATION = ['not', 'no', 'never', "n't", 'nu', 'nici', 'fără', 'niciun', 'niciuna'];
const QUANTIFIER = ['all', 'every', 'some', 'any', 'none', 'toți', 'toate', 'unii', 'orice', 'niciun'];
const WH = /\b(who|what|when|where|why|how|which|whom|whose|cine|ce|când|unde|de ce|cum|care|cui|al cui)\b/i;
const NUMBERS = text => (String(text).match(/\d[\d.,:]*\d?|\d/g) ?? []).map(s => s.replace(/[.,:]/g, ''));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const hasAny = (text, list) => { const t = norm(text); return list.some(w => t.includes(norm(w))); };
const editRatio = (a, b) => { // cheap normalized levenshtein-ish ratio via longest-common-subsequence length proxy
  const s1 = norm(a).replace(/\s+/g, ' ').trim(), s2 = norm(b).replace(/\s+/g, ' ').trim();
  if (!s1 && !s2) return 0;
  const m = s1.length, n = s2.length;
  const dp = new Array(n + 1); for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) { let prev = dp[0]; dp[0] = i; for (let j = 1; j <= n; j++) { const tmp = dp[j]; dp[j] = s1[i - 1] === s2[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]); prev = tmp; } }
  return dp[n] / Math.max(1, Math.max(m, n));
};

function entityPreserved(row, cleaned) {
  const entities = row.verification_context?.entities ?? [];
  let total = 0, kept = 0;
  const cleanedNorm = norm(cleaned);
  for (const entity of entities) {
    const names = [entity.label, ...(entity.aliases ?? [])].filter(Boolean);
    const mentionedInOriginal = names.some(n => norm(row.question).includes(norm(n)));
    if (!mentionedInOriginal) continue;
    total++;
    if (names.some(n => cleanedNorm.includes(norm(n)))) kept++;
  }
  return {total, kept};
}

function metricsCommand(args) {
  const dev = new Map(devRows().map(r => [r.id, r]));
  const sample = readJsonl(path.join(ROOT, args.sample));
  const output = new Map(readJsonl(path.join(ROOT, args.file)).map(r => [r.id, r]));
  const symbolic = new Map(readJsonl(path.join(ROOT, args.symbolic)).map(r => [r.id, r]));
  // `--exec` merges the gold-SOP execution scores of the exec command; rows without a gold SOP stay null (no score, not a failure).
  const executed = args.exec ? new Map(readJsonl(path.join(ROOT, args.exec)).map(r => [r.id, r])) : new Map();
  const out = [];
  for (const s of sample) {
    const row = dev.get(s.id);
    const o = output.get(s.id);
    const sym = symbolic.get(s.id);
    if (!o) continue;
    const cleaned = String(o.output ?? '').trim();
    const original = s.text;
    const ent = row ? entityPreserved(row, cleaned) : {total: 0, kept: 0};
    const numOrig = new Set(NUMBERS(original)), numClean = new Set(NUMBERS(cleaned));
    const numbersPreserved = [...numOrig].every(n => numClean.has(n));
    const numbersHallucinated = [...numClean].filter(n => !numOrig.has(n));
    const negOrig = hasAny(original, NEGATION), negClean = hasAny(cleaned, NEGATION);
    const quantOrig = hasAny(original, QUANTIFIER), quantClean = hasAny(cleaned, QUANTIFIER);
    const qmOrig = original.includes('?'), qmClean = cleaned.includes('?');
    const whOrig = WH.test(original), whClean = WH.test(cleaned);
    out.push({
      id: s.id, kind: s.kind, candidate: args.candidate,
      empty: !cleaned,
      entities_total: ent.total, entities_kept: ent.kept,
      numbers_preserved: numbersPreserved, numbers_hallucinated: numbersHallucinated.length,
      negation_preserved: negOrig === negClean, quantifier_preserved: quantOrig === quantClean,
      question_mark_preserved: qmOrig === qmClean, wh_preserved: whOrig === whClean,
      fluent_unparsed: (sym?.unparsed ?? 1) === 0, fluent_language_en: sym?.language === 'en',
      execution_equivalent: s.gold_sop ? executed.get(s.id)?.execution_equivalent ?? false : null,
      execution_equivalent_tolerant: s.gold_sop ? executed.get(s.id)?.execution_equivalent_tolerant ?? false : null,
      edit_ratio: editRatio(original, cleaned),
      ms: o.ms ?? null, in_tokens: o.in_tokens ?? null, out_tokens: o.out_tokens ?? null, device: o.device ?? null,
      cleaned_chars: cleaned.length, original_chars: original.length,
    });
  }
  writeJsonl(path.join(ROOT, args.out), out);
  console.log(JSON.stringify({candidate: args.candidate, rows: out.length}));
}

// ------------------------------------------------------------------ eval/run.mjs execution-equivalence scoring

async function execCommand(args) {
  const dev = new Map(devRows().map(r => [r.id, r]));
  const symbolic = new Map(readJsonl(path.join(ROOT, args.symbolic)).map(r => [r.id, r]));
  const sample = readJsonl(path.join(ROOT, args.sample)).filter(s => s.source === 'formalizer-v1' && symbolic.has(s.id));
  const rows = sample.map(s => dev.get(s.id)).filter(Boolean);
  const predictor = ({id}) => symbolic.get(id)?.sop ?? '';
  const report = await evaluate(rows, {predictor, config: {}, source: 'predictions'});
  const byId = new Map(report.records.map(r => [r.id, r]));
  const out = rows.map(r => ({id: r.id, execution_equivalent: !!byId.get(r.id)?.execution_equivalent, execution_equivalent_tolerant: !!byId.get(r.id)?.execution_equivalent_tolerant}));
  writeJsonl(path.join(ROOT, args.out), out);
  console.log(JSON.stringify({rows: out.length, strict: out.filter(r => r.execution_equivalent).length, tolerant: out.filter(r => r.execution_equivalent_tolerant).length}));
}

// ------------------------------------------------------------------ Wilson CI + summarize

function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function summarizeCommand(args) {
  const dir = path.join(ROOT, args.dir);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.metrics.jsonl'));
  const all = files.flatMap(f => readJsonl(path.join(dir, f)));
  const groups = new Map();
  for (const r of all) { const key = `${r.candidate}::${r.kind}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  const summary = {};
  for (const [key, rs] of groups) {
    const n = rs.length;
    const rate = pred => { const k = rs.filter(pred).length; return {k, n, p: k / n, ci95: wilson(k, n)}; };
    // Rate over the rows that have the measure at all (gold-less probe rows carry no SymbolicLM-vs-gold score).
    const rateOver = (has, pred) => { const scored = rs.filter(has); const k = scored.filter(pred).length; return scored.length ? {k, n: scored.length, p: k / scored.length, ci95: wilson(k, scored.length)} : null; };
    summary[key] = {
      n,
      empty: rate(r => r.empty),
      entities_full: rate(r => r.entities_total === 0 || r.entities_kept === r.entities_total),
      numbers_preserved: rate(r => r.numbers_preserved),
      numbers_hallucinated: rate(r => r.numbers_hallucinated > 0),
      negation_preserved: rate(r => r.negation_preserved),
      quantifier_preserved: rate(r => r.quantifier_preserved),
      question_mark_preserved: rate(r => r.question_mark_preserved),
      wh_preserved: rate(r => r.wh_preserved),
      fluent_unparsed: rate(r => r.fluent_unparsed),
      fluent_language_en: rate(r => r.fluent_language_en),
      fluent_both: rate(r => r.fluent_unparsed && r.fluent_language_en),
      execution_equivalent: rateOver(r => r.kind !== 'noisy_en' && r.execution_equivalent !== null, r => r.execution_equivalent),
      execution_equivalent_tolerant: rateOver(r => r.kind !== 'noisy_en' && r.execution_equivalent_tolerant !== null, r => r.execution_equivalent_tolerant),
      edit_ratio_mean: rs.reduce((a, r) => a + r.edit_ratio, 0) / n,
      unchanged_share: rate(r => r.edit_ratio === 0),
      ms_mean: rs.some(r => r.ms != null) ? rs.reduce((a, r) => a + (r.ms ?? 0), 0) / rs.filter(r => r.ms != null).length : null,
    };
  }
  writeJson(path.join(dir, 'report.json'), {format: 'chatsop-report-v1', generated_at: new Date().toISOString(), summary});
  console.log(JSON.stringify(summary, null, 1));
}

// ------------------------------------------------------------------ paired bootstrap between candidates

/** Paired bootstrap of the mean per-row difference (A - B) over rows both candidates scored; 2000 resamples, fixed seed. */
function pairedBootstrap(diffs, seed = 20260930, resamples = 2000) {
  if (!diffs.length) return null;
  const random = mulberry(seed);
  const means = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(random() * diffs.length)];
    means.push(sum / diffs.length);
  }
  means.sort((a, b) => a - b);
  return {n: diffs.length, mean: diffs.reduce((a, b) => a + b, 0) / diffs.length, ci95: [means[Math.floor(0.025 * resamples)], means[Math.ceil(0.975 * resamples) - 1]]};
}

function compareCommand(args) {
  const dir = path.join(ROOT, args.dir);
  const rows = fs.readdirSync(dir).filter(f => f.endsWith('.metrics.jsonl')).flatMap(f => readJsonl(path.join(dir, f)));
  const byCandidate = new Map();
  for (const r of rows) { if (!byCandidate.has(r.candidate)) byCandidate.set(r.candidate, new Map()); byCandidate.get(r.candidate).set(r.id, r); }
  const refs = String(args.ref ?? '').split(',').filter(Boolean);
  const measures = {
    fluent_both: r => (r.fluent_unparsed && r.fluent_language_en ? 1 : 0),
    entities_full: r => (r.entities_total === 0 || r.entities_kept === r.entities_total ? 1 : 0),
    execution_equivalent_tolerant: r => (r.kind === 'noisy_en' || r.execution_equivalent_tolerant === null ? null : r.execution_equivalent_tolerant ? 1 : 0),
  };
  const out = {};
  for (const ref of refs) for (const [name, table] of byCandidate) {
    if (name === ref || !byCandidate.has(ref)) continue;
    for (const kind of ['ro', 'mixed', 'noisyEn', 'control']) {
      for (const [measure, fn] of Object.entries(measures)) {
        const diffs = [];
        for (const [id, r] of table) {
          const other = byCandidate.get(ref).get(id);
          if (!other || r.kind !== kind) continue;
          const a = fn(r), b = fn(other);
          if (a !== null && b !== null) diffs.push(a - b);
        }
        const result = pairedBootstrap(diffs);
        if (result) (out[`${name} minus ${ref}`] ??= {})[`${kind}::${measure}`] = result;
      }
    }
  }
  writeJson(path.join(ROOT, args.out), {format: 'chatsop-report-v1', generated_at: new Date().toISOString(), method: 'paired bootstrap of per-row differences, 2000 resamples, seed 20260930, rows scored by both candidates', comparisons: out});
  console.log(Object.keys(out).length + ' candidate pairs written to ' + args.out);
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command === 'control') return controlCommand();
  if (args.command === 'symbolic') return symbolicCommand(args);
  if (args.command === 'symbolic-all') return symbolicAllCommand(args);
  if (args.command === 'metrics') return metricsCommand(args);
  if (args.command === 'exec') return execCommand(args);
  if (args.command === 'summarize') return summarizeCommand(args);
  if (args.command === 'compare') return compareCommand(args);
  console.log('Unknown command. See header comment.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
