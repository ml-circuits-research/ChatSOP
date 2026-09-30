#!/usr/bin/env node
/** Harvest: validate bad_english END TO END through the chain and feed the chain's failures to neuro_english (DS008 "Production regression loop").
 *
 *   node tools/datasets/harvest.mjs [--split dev|train] [--limit 50] [--seed S] (--endpoint URL [--model NAME] | --command CMD | --shipped [--llm-endpoint URL] [--lt-url URL])
 *                                    --name LLM_NAME [--append] [--out-dir DIR]
 *
 * For each bad_english row: the host splits the message into sentences, the clean-English gate keeps the clean ones, only the others go to
 * the LanguageProofingLLM (an endpoint, a command, or the shipped textToCleanEnglish chain), the host reassembles. The output is classified:
 *   (a) LanguageProofingLLM failure: a sentence that is still not clean English, or content lost (names, numbers, negations of the
 *       message or of its verified target); disagreement with a verified clean target is recorded too (`differs_from_target`, counted apart);
 *   (b) pass: clean English that SymbolicLM handles as a known form;
 *   (c) a new neuro_english candidate: clean English that SymbolicLM does not handle. With `--append` it is appended to
 *       datasets/neuro_english/incoming.jsonl (tools/datasets/add-case.mjs row shape) with its provenance: the bad_english row id, the LLM name,
 *       review_status pending, and its form signature.
 * The report lists the forms the chain produced that neither symbolic_english nor neuro_english train/dev covers: the forms to add before the next
 * fine-tuning. Numbers of a run with a model that is not the intended LanguageProofingLLM are a smoke test of the tool, never a measurement of the chain.
 * Nothing is trained; only train and dev rows are read (a generator never reads a sealed row, AGENTS.md rule 9).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {classifyMessage} from './three-datasets/sources.mjs';
import {normalText} from './three-datasets/inputs.mjs';
import {loadRows} from '../eval/composed/components.mjs';
import {rngOf} from '../eval/composed/compose.mjs';
import {handled} from '../eval/composed/lm.mjs';
import {mainForm, signatureOf} from './three-datasets/forms.mjs';
import {incomingRow, incomingFile} from './add-case.mjs';
import {cachedRewriter, endpointRewriter, commandRewriter} from '../eval/composed/rewriters.mjs';

const fold = t => String(t).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
// Names: capitalized words that do not start a sentence (a sentence-initial capital is not evidence of a name).
const names = t => [...new Set([...String(t).matchAll(/(?<![.?!]\s|^)\p{Lu}[\p{L}'’-]+/gu)].map(m => fold(m[0])))];
const numbers = t => [...new Set(String(t).match(/\d+(?:[.,:]\d+)*/g) ?? [])];
const NEG = new Set(['not', "n't", 'never', 'no', 'none', 'nobody', 'nothing', 'neither', 'nor', "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "won't", "can't", 'cannot']);
const negations = t => [...new Set((fold(t).match(/[\p{L}']+/gu) ?? []).filter(w => NEG.has(w)))];

/** What of the reference's names, numbers and (same-language) negations is missing from `output`. */
export function contentLost(reference, output, {negation = true} = {}) {
  const lost = [];
  for (const [kind, f] of [['name', names], ['number', numbers], ...(negation ? [['negation', negations]] : [])]) {
    const have = new Set(f(output));
    for (const item of f(reference)) if (!have.has(item)) lost.push(`${kind}:${item}`);
  }
  return lost;
}

/** Run one message through the chain: split, gate, rewrite the non-clean sentences, reassemble. */
export async function chain(message, {rewrite, gate = m => classifyMessage(m).partition === 'clean_en'}) {
  const units = splitSentences(message);
  let output = message;
  const sent = [];
  for (const u of units.slice().reverse()) {
    if (gate(u.text)) continue;
    const text = (await rewrite(u.text)).trim();
    sent.push({from: u.text, to: text});
    output = output.slice(0, u.start) + text + output.slice(u.end);
  }
  return {output, units: units.length, sent: sent.reverse()};
}

/** Classification of one row's chain output. */
export async function classifyOutput(row, result, lm) {
  const out = result.output;
  const notClean = splitSentences(out).filter(u => classifyMessage(u.text).partition !== 'clean_en').map(u => u.text);
  const reference = row.target ?? row.message;
  const lost = contentLost(reference, out, {negation: Boolean(row.target)});
  const differs = Boolean(row.target) && normalText(out) !== normalText(row.target);
  const base = {id: row.id, message: row.message, output: out, sent: result.sent.length, units: result.units, not_clean: notClean, content_lost: lost, differs_from_target: differs, had_target: Boolean(row.target)};
  if (notClean.length || lost.length) return {...base, class: 'a', reason: notClean.length ? 'not_clean' : 'content_lost'};
  const rec = await lm.run(out);
  const form = rec.sentences.length ? mainForm({sentences: rec.sentences}) : null;
  const sig = rec.sentences.length ? signatureOf({analysis: {sentences: rec.sentences}}) : null;
  return {...base, class: handled(rec) ? 'b' : 'c', form, form_full: sig?.full ?? null, symbolic: {outcome: rec.outcome, valid: rec.valid, uncertain: rec.uncertain, unparsed: rec.unparsed}, rec};
}

/** Forms produced by the chain that no train/dev row of symbolic_english or neuro_english has. */
export function uncoveredForms(results, covered) {
  const seen = new Map();
  for (const r of results) if (r.form && !covered.has(r.form)) { const e = seen.get(r.form) ?? {form: r.form, rows: 0, examples: []}; e.rows++; if (e.examples.length < 3) e.examples.push(r.output); seen.set(r.form, e); }
  return [...seen.values()].sort((a, b) => b.rows - a.rows);
}

export async function harvest({rows, rewrite, lm, name, append = false, covered, now = new Date()}) {
  const results = [];
  for (const row of rows) {
    const result = await chain(row.message, {rewrite});
    const c = await classifyOutput(row, result, lm);
    results.push(c);
    if (append && c.class === 'c') {
      const dataset = 'neuro_english';
      const verdict = {gate: {partition: 'clean_en', reasons: []}, symbolic: c.rec};
      const inc = incomingRow({message: c.output, dataset, verdict, note: `harvested from ${row.id}`, reporter: name, now});
      inc.provenance = {...inc.provenance, source: 'bad_english_harvest', source_row: row.id, llm: name, form: c.form, classified_by: 'tools/datasets/harvest.mjs'};
      inc.source = {...inc.source, corpus: 'production', kind: 'harvest', harvested_from: row.id};
      const file = incomingFile(dataset);
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
      if (!existing.some(e => e.id === inc.id)) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.appendFileSync(file, JSON.stringify(inc) + '\n'); c.appended = inc.id; }
    }
  }
  const count = k => results.filter(r => r.class === k).length;
  return {
    name, rows: results.length, a_failures: count('a'), a_not_clean: results.filter(r => r.reason === 'not_clean').length, a_content_lost: results.filter(r => r.reason === 'content_lost').length,
    differs_from_target: results.filter(r => r.differs_from_target).length, had_target: results.filter(r => r.had_target).length,
    b_pass: count('b'), c_new_neuro_candidates: count('c'), appended: results.filter(r => r.appended).length,
    uncovered_forms: uncoveredForms(results.filter(r => r.class === 'b' || r.class === 'c'), covered),
    results: results.map(({rec, ...rest}) => rest),
  };
}

const parseArgs = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const name = o.name ?? (o.shipped ? 'shipped textToCleanEnglish' : o.endpoint ?? o.command);
  if (!name) throw Error('--name and one of --endpoint, --command, --shipped are required');
  const split = o.split ?? 'dev';
  if (!['train', 'dev'].includes(split)) throw Error('--split must be train or dev');
  const all = loadRows('bad_english', [split]).filter(r => r.language_kind);
  const rng = rngOf(`harvest:${o.seed ?? 'v1'}:${split}`);
  const rows = rng.shuffle(all).slice(0, Number(o.limit ?? 50));
  let fn;
  if (o.shipped) {
    const {textToCleanEnglish} = await import('../../lib/text-to-clean-english/index.mjs');
    const backendOptions = {...(o['llm-endpoint'] ? {endpoint: o['llm-endpoint']} : {}), ...(o['lt-url'] ? {languagetool: {url: o['lt-url']}} : {})};
    fn = async text => (await textToCleanEnglish(text, {backendOptions})).clean;
  } else if (o.endpoint) fn = endpointRewriter(o.endpoint, {model: o.model ?? 'proofreader'});
  else fn = commandRewriter(o.command);
  const outDir = path.resolve(ROOT, o['out-dir'] ?? 'eval/reports/current/composed-eval');
  const rewrite = cachedRewriter(fn, path.join(outDir, 'cache', `harvest-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.jsonl`));
  const {openLm} = await import('../eval/composed/lm.mjs');
  const lm = await openLm({cacheDir: path.join(outDir, 'cache')});
  try {
    const covered = new Set();
    for (const d of ['symbolic_english', 'neuro_english']) for (const r of loadRows(d, ['train', 'dev'])) { const f = signatureOf(r).form; if (f) covered.add(f); }
    const report = await harvest({rows, rewrite, lm, name, append: Boolean(o.append), covered});
    const summary = {generated_at: new Date().toISOString(), split, limit: rows.length, smoke_test: !o['intended-model'], note: 'A run with a model that is not the fine-tuned LanguageProofingLLM is a smoke test of the tool only.', ...report};
    fs.mkdirSync(outDir, {recursive: true});
    fs.writeFileSync(path.join(outDir, `harvest-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`), JSON.stringify(summary, null, 1) + '\n');
    console.log(JSON.stringify({rows: summary.rows, a_failures: summary.a_failures, a_not_clean: summary.a_not_clean, a_content_lost: summary.a_content_lost, b_pass: summary.b_pass, c_new_neuro_candidates: summary.c_new_neuro_candidates, appended: summary.appended, uncovered_forms: summary.uncovered_forms.length}));
  } finally { await lm.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
