#!/usr/bin/env node
/** Length distribution of the messages of the three datasets and the archive corpora (DS008 "Length and composed evaluation").
 *
 *   node tools/datasets/audit/length-analysis.mjs [--out-dir eval/reports/current/composed-eval]
 *
 * Words are whitespace-separated tokens; sentences come from lib/sentence-split.mjs (the host segmenter). Writes
 * length-analysis.json next to length-analysis.md; the Markdown report is rendered by `render()` from the JSON plus, when they
 * exist, the existing SymbolicLM accuracy by length (eval/reports/current/symbolic-layers/results.json) and the composed
 * evaluation results (symbolic-lm__K*.summary.json of the same folder).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';
import {ROOT, THREE_DATASETS} from '../../../lib/dataset-paths.mjs';
import {splitSentences} from '../../../lib/sentence-split.mjs';

const messageOf = row => row.message ?? row.question ?? row.input ?? row.prompt ?? '';
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
const BUCKETS = ['1', '2', '3', '4', '5', '6-8', '9+'];
const bucketOf = n => (n <= 5 ? String(n) : n <= 8 ? '6-8' : '9+');

/** Summary of an array of messages: counts and quantiles of words, characters and sentences. */
export function lengthStats(messages) {
  const words = [], chars = [], sentences = [];
  const buckets = Object.fromEntries(BUCKETS.map(b => [b, 0]));
  for (const m of messages) {
    words.push(String(m).split(/\s+/).filter(Boolean).length);
    chars.push(String(m).length);
    const n = splitSentences(m).length;
    sentences.push(n);
    buckets[bucketOf(n)]++;
  }
  const w = words.slice().sort((a, b) => a - b), c = chars.slice().sort((a, b) => a - b);
  const mean = a => (a.length ? Math.round(10 * a.reduce((x, y) => x + y, 0) / a.length) / 10 : null);
  const share = (a, f) => (a.length ? Math.round(1000 * a.filter(f).length / a.length) / 10 : null);
  return {
    rows: messages.length,
    words: {mean: mean(words), p50: quantile(w, 0.5), p90: quantile(w, 0.9), p99: quantile(w, 0.99), max: w[w.length - 1] ?? null},
    chars: {mean: mean(chars), p50: quantile(c, 0.5), p99: quantile(c, 0.99), max: c[c.length - 1] ?? null},
    sentences: {mean: mean(sentences), by_count: buckets, share_multi_pct: share(sentences, n => n > 1), share_4plus_pct: share(sentences, n => n >= 4)},
    share_over_30_words_pct: share(words, n => n > 30), share_over_60_words_pct: share(words, n => n > 60),
  };
}

const read = relative => { const file = path.join(ROOT, relative); return jsonlExists(file) ? readJsonlShardedSync(file) : null; };

/** Files measured: [label, group, relative path]. */
export function sources() {
  const out = [];
  for (const d of THREE_DATASETS) for (const s of ['train', 'dev']) out.push([`${d}/${s}`, 'datasets', `datasets/${d}/${s}.jsonl`]);
  for (const d of THREE_DATASETS) out.push([`${d}/test`, 'sealed suites', `eval/suites/${d}/test.jsonl`]);
  for (const d of THREE_DATASETS) out.push([`${d}/test-composed`, 'composed suites', `eval/suites/${d}/test-composed.jsonl`]);
  out.push(['formalizer-v1/train', 'archive', 'datasets_archive/formalizer-v1/train.jsonl'], ['formalizer-v1/dev', 'archive', 'datasets_archive/formalizer-v1/dev.jsonl'],
    ['clean-english/train', 'archive', 'datasets_archive/clean-english/train.jsonl'], ['clean-english/dev', 'archive', 'datasets_archive/clean-english/dev.jsonl'],
    ['proofing/train (input)', 'archive', 'datasets_archive/proofing/train.jsonl'], ['proofreader/train (prompt)', 'archive', 'datasets_archive/proofing/proofreader/train.jsonl'],
);
  return out;
}

export function analyse() {
  const table = [];
  for (const [label, group, rel] of sources()) {
    const rows = read(rel);
    if (rows) table.push({label, group, path: rel, ...lengthStats(rows.map(messageOf)), composed_rows: rows.filter(r => r.source?.corpus === 'composed').length});
  }
  return {generated_at: new Date().toISOString(), method: 'words = whitespace tokens; sentences = lib/sentence-split.mjs splitSentences', table};
}

const fmt = v => (v === null || v === undefined ? 'n/a' : String(v));
const rateRow = (label, o) => `| ${label} | ${o.n} | ${(100 * o.CORRECT.rate).toFixed(1)}% [${(100 * o.CORRECT.ci95[0]).toFixed(1)}, ${(100 * o.CORRECT.ci95[1]).toFixed(1)}] | ${(100 * o.OK.rate).toFixed(1)}% [${(100 * o.OK.ci95[0]).toFixed(1)}, ${(100 * o.OK.ci95[1]).toFixed(1)}] |`;

export function render(report, {layers = null, composed = null} = {}) {
  const L = ['# Length analysis: words and sentences per message', '', `Generated ${report.generated_at} by \`node tools/datasets/audit/length-analysis.mjs\`. ${report.method}. This is a measurement of what the datasets contain and how SymbolicLM behaves by length; it is not a claim about the models' limits.`, '',
    '## Distribution per dataset and split', '', '| corpus/split | rows | words mean / p50 / p90 / p99 / max | sentences mean | 1 | 2 | 3 | 4 | 5 | 6-8 | 9+ | multi-sentence % | over 30 words % |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const t of report.table) L.push(`| ${t.label} | ${t.rows} | ${fmt(t.words.mean)} / ${fmt(t.words.p50)} / ${fmt(t.words.p90)} / ${fmt(t.words.p99)} / ${fmt(t.words.max)} | ${fmt(t.sentences.mean)} | ${BUCKETS.map(b => t.sentences.by_count[b]).join(' | ')} | ${fmt(t.sentences.share_multi_pct)} | ${fmt(t.share_over_30_words_pct)} |`);
  L.push('');
  if (layers) {
    const l1 = layers.layer1;
    L.push('## Existing SymbolicLM results by length (symbolic-layers layer 1)', '', `Source: \`eval/reports/current/symbolic-layers/results.json\`, layer 1: ${l1.sentences.n} sentences of the clean-English test, analysis judged by a stronger model (CORRECT = fully right; OK = CORRECT, MINOR or INPUT_TYPO). These are judge verdicts on stored analyses of the earlier rules and package, not strict gold-SOP matches, and they are per sentence, so they say how accuracy varies with the sentence's own length, not with the number of sentences in a message.`, '', '| group | sentences | CORRECT [95% CI] | OK [95% CI] |', '| --- | --- | --- | --- |');
    for (const [k, v] of Object.entries(l1.by_sentence_words)) L.push(rateRow(`sentence of ${k} words`, v));
    for (const [k, v] of Object.entries(l1.by_message_length)) L.push(rateRow(`message length ${k}`, v));
    L.push('');
  }
  if (composed) L.push(composed, '');
  return L.join('\n');
}

/** Findings: coverage of long and multi-sentence inputs and SymbolicLM accuracy by sentence count, with the numbers filled from the data. */
export function findings(report, dir, layers = null) {
  const row = label => report.table.find(t => t.label === label);
  const read = file => { try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { return null; } };
  const L = ['## Findings', ''];
  const sym = ['symbolic_english/train', 'symbolic_english/dev', 'symbolic_english/test'].map(row).filter(Boolean);
  const total = sym.reduce((a, t) => a + t.rows, 0), three = sym.reduce((a, t) => a + (t.sentences.by_count['3'] + t.sentences.by_count['4'] + t.sentences.by_count['5'] + t.sentences.by_count['6-8'] + t.sentences.by_count['9+']), 0);
  const maxWords = Math.max(...sym.map(t => t.words.max));
  const composedRows = sym.reduce((a, t) => a + (t.composed_rows ?? 0), 0);
  L.push(`* **symbolic_english covers short inputs, apart from the composed paragraphs added on purpose.** ${three} of ${total} rows (${(100 * three / total).toFixed(1)}%) have three or more sentences, and ${composedRows} of the train and dev rows are composed paragraphs (\`source.corpus: composed\`, tools/datasets/composed-train.mjs); the longest row has ${maxWords} words and the 99th percentile is ${Math.max(...sym.map(t => t.words.p99))} words. The natural regression suite therefore says little by itself about long or many-sentence inputs.`);
  const neuro = ['neuro_english/train', 'neuro_english/dev', 'neuro_english/test'].map(row).filter(Boolean), bad = ['bad_english/train', 'bad_english/dev', 'bad_english/test'].map(row).filter(Boolean);
  const longShare = ts => (ts.reduce((a, t) => a + t.rows * t.share_over_30_words_pct, 0) / ts.reduce((a, t) => a + t.rows, 0)).toFixed(1);
  L.push(`* **neuro_english and bad_english do contain long messages** (${longShare(neuro)}% and ${longShare(bad)}% of their rows have more than 30 words; the long tail is the templated \`long_message\` family of formalizer-v1 and the long new cases), but only a small part of them has a verified target (see \`decomposition-coverage.json\`), and the proofreader's own training set (\`proofreader/train.jsonl\`) is short: median ${row('proofreader/train (prompt)')?.words.p50} words, 99th percentile ${row('proofreader/train (prompt)')?.words.p99}, ${row('proofreader/train (prompt)')?.sentences.share_multi_pct}% multi-sentence.`);
  if (layers) {
    const w = layers.layer1.by_sentence_words;
    L.push(`* **Existing result (judge verdicts on the earlier analyses, per sentence, not per message):** fully correct ${(100 * w['<=8'].CORRECT.rate).toFixed(1)}% for sentences of at most 8 words, ${(100 * w['9-15'].CORRECT.rate).toFixed(1)}% for 9 to 15 words and ${(100 * w['>15'].CORRECT.rate).toFixed(1)}% above 15 words (\`eval/reports/current/symbolic-layers/results.json\`). Accuracy falls with the length of the sentence; there was no measurement by the number of sentences in a message. The message-length groups of that study are the templated long messages and are not a clean length effect. The clean-English and long-message reports of the small formalizer (\`eval/reports/current/clean-english\`, \`long-messages\`, \`sentence-split\`) concern the earlier formalizer, not SymbolicLM, and are not used here.`);
  }
  for (const kind of ['K1', 'K3', 'K5']) {
    const summary = read(`symbolic-lm__${kind}.summary.json`), l = summary?.stages?.at(-1);
    if (!l) continue;
    const by = l.sop_exact.by, eff = l.composition_effect.by ?? {};
    const cell = (b) => (b ? `${b.p}% [${b.lo}, ${b.hi}]` : 'n/a');
    L.push(`* **SymbolicLM by sentence count, ${kind} (${l.cases} cases; paragraph SOP = concatenated component SOPs; the second figure restricts to cases whose components all pass alone):** ${Object.keys(by).map(k => `${k}: ${cell(by[k])}${eff[k] ? ` / ${cell(eff[k])}` : ''}`).join('; ')}.`);
  }
  L.push('', 'The composed suites (`tools/eval/composed-suites.mjs`) fill the gap: paragraphs of known-good sentences and of mixtures of handled and unhandled forms, scored by `tools/eval/composed-score.mjs` (DS008 "Length and composed evaluation suites", DS016 "Composed metrics"; summary in `summary.md`).');
  return L.join('\n');
}

const parseArgs = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  const dir = path.resolve(ROOT, o['out-dir'] ?? 'eval/reports/current/composed-eval');
  fs.mkdirSync(dir, {recursive: true});
  const report = analyse();
  const readJson = rel => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; } };
  const layers = readJson('eval/reports/current/symbolic-layers/results.json');
  const composed = findings(report, dir, layers);
  fs.writeFileSync(path.join(dir, 'length-analysis.json'), JSON.stringify(report, null, 1) + '\n');
  fs.writeFileSync(path.join(dir, 'length-analysis.md'), render(report, {layers, composed}));
  console.log(`wrote ${path.relative(ROOT, dir)}/length-analysis.{json,md}: ${report.table.length} corpus/splits`);
}
