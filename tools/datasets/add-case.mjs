#!/usr/bin/env node
/** Production regression loop: add a case seen in production to the pending queue of the right dataset (DS008 "How we learn from production").
 *
 *   node tools/datasets/add-case.mjs add --message TEXT [--clean TEXT] [--rewrite TEXT] [--sop TEXT|@file] [--reporter NAME] [--note TEXT] [--dataset auto|bad_english|symbolic_english|neuro_english] [--dry]
 *   node tools/datasets/add-case.mjs list [--dataset D] [--status pending|accepted|rejected|merged]
 *   node tools/datasets/add-case.mjs review --id ID --status accepted|rejected [--reviewer NAME] [--note TEXT]
 *   node tools/datasets/add-case.mjs merge --dataset D --into train|dev [--dry]
 *
 * `add` classifies the message with the clean-English gate and then SymbolicLM, exactly as the datasets are classified:
 *   not clean English (Romanian, mixed, noisy)                      -> bad_english     (`--clean` is the clean target)
 *   clean English that SymbolicLM handles (valid, nothing unparsed)  -> symbolic_english (regression case; `--sop` is the gold SOP)
 *   clean English that SymbolicLM does not handle                   -> neuro_english   (`--rewrite` is the rewrite target)
 * and appends one row to datasets/<dataset>/incoming.jsonl with `source.corpus: production`, a timestamp and `review_status: pending`.
 * Nothing else is touched. The owner reviews incoming rows on the audit page (split `incoming`), or with `review` here. `merge` moves
 * the ACCEPTED rows of a dataset into datasets/<dataset>/train.jsonl or dev.jsonl (sealed test files are never written here: a new
 * regression case enters the sealed test only through the owner's builders), refusing a row whose text duplicates a sealed test row, updates the manifest and marks
 * the incoming row `merged`. Merged rows are then part of the regression net (tools/symbolic-regression.mjs reads train, dev and test).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT, THREE_DATASETS} from '../../lib/dataset-paths.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {classifyMessage} from './three-datasets/sources.mjs';
import {normalText} from './three-datasets/inputs.mjs';
import {compareParagraph} from '../eval/composed/sop-canon.mjs';
import {handled} from '../eval/composed/lm.mjs';

export const STATUSES = ['pending', 'accepted', 'rejected', 'merged'];
export const incomingFile = (dataset, root = ROOT) => path.join(root, 'datasets', dataset, 'incoming.jsonl');
const readIncoming = (dataset, root) => (fs.existsSync(incomingFile(dataset, root)) ? fs.readFileSync(incomingFile(dataset, root), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeIncoming = (dataset, rows, root) => fs.writeFileSync(incomingFile(dataset, root), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

/** Which dataset a message belongs to and why. `symbolicRun(text)` returns the SymbolicLM record (see composed/lm.mjs). */
export async function classify(message, {symbolicRun, forced = null}) {
  const gate = classifyMessage(message);
  const clean = gate.partition === 'clean_en';
  const base = {gate: {partition: gate.partition, reasons: gate.reasons}};
  if (forced && forced !== 'auto') return {dataset: forced, ...base, symbolic: clean && symbolicRun ? await symbolicRun(message) : null, forced: true};
  if (!clean) return {dataset: 'bad_english', ...base, symbolic: null};
  const symbolic = await symbolicRun(message);
  return {dataset: handled(symbolic) ? 'symbolic_english' : 'neuro_english', ...base, symbolic};
}

const idOf = (message, dataset) => `production::${createHash('sha1').update(`${dataset}\n${message}`).digest('hex').slice(0, 12)}`;

/** The incoming row for a classified case. */
export function incomingRow({message, dataset, verdict, clean = null, rewrite = null, sop = null, reporter = null, note = null, now = new Date()}) {
  const id = idOf(message, dataset), s = verdict.symbolic;
  const row = {
    id, dataset, split: 'incoming', split_group_id: id, message,
    source: {corpus: 'production', id, suite: 'production', split: 'incoming', kind: 'production_case', reported_by: reporter, family: 'production', semantic_case_id: id},
    provenance: {source: 'production', added_at: now.toISOString(), added_by: reporter ?? process.env.CHATSOP_ACTOR ?? 'unknown', classified_by: 'tools/datasets/add-case.mjs (clean-English gate, then SymbolicLM)'},
    rights: {license: 'MIT (repository LICENSE); production message supplied by the operator', rights_decision: 'operator-supplied', text_copied: false, spec: 'docs/specs/DS014-source-rights.md'},
    quality_flags: {synthetic: false, human_reviewed: false, training_approved: false, llm_authored: false, production: true},
    review_status: 'pending', note,
    classification: {gate: verdict.gate, symbolic_lm: s ? {handled: handled(s), outcome: s.outcome, valid: s.valid, uncertain: s.uncertain, reasons: s.reasons, unparsed: s.unparsed} : null, forced: Boolean(verdict.forced)},
  };
  if (dataset === 'bad_english') return {...row, language_kind: verdict.gate.partition === 'clean_en' ? 'noisy_en' : verdict.gate.partition, target: clean, target_source: clean ? 'production' : null, targets: clean ? [{text: clean, source: 'production'}] : [], noise_categories: [], flags: clean ? [] : ['no_target']};
  if (dataset === 'symbolic_english') {
    const goldMatch = sop && s ? compareParagraph(s.sop, [sop]).exact : null;
    return {...row, analysis: s ? {columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences: s.sentences} : null, sop: s?.sop ?? null, sop_valid: s?.valid ?? false, outcome: s?.outcome ?? null, unparsed: s?.unparsed ?? [], gold_sop: sop ?? null,
      analysis_verified: sop && goldMatch ? 'gold_sop_match' : 'pending', verification: {sop_gold_match: goldMatch, judge: null, stanza_spacy_agree: null, stanza_default_accurate: 'not_measured'}};
  }
  return {...row, analysis: s ? {columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences: s.sentences} : null, sop: s?.sop ?? null, sop_valid: s?.valid ?? false, outcome: s?.outcome ?? null, unparsed: s?.unparsed ?? [], gold_sop: sop ?? null,
    target: rewrite, target_source: rewrite ? 'production' : null, targets: rewrite ? [{text: rewrite, source: 'production'}] : [], rewrite_target: Boolean(rewrite), failure_kind: 'unknown', failure: {classes: [], categories: [], production: true}, flags: rewrite ? [] : ['no_target'],
    verification: {sop_gold_match: sop && s ? compareParagraph(s.sop, [sop]).exact : null, judge: null, stanza_spacy_agree: null}};
}

/** Hashes of the normalized sealed texts (written by `node tools/eval/three-datasets-suites.mjs hashes`; no text), to refuse a merge that would copy an evaluation case. */
function sealedHashes(root) {
  const file = path.join(root, 'eval/reports/current/three-datasets/sealed-text-hashes.json');
  if (!fs.existsSync(file)) throw Error('missing eval/reports/current/three-datasets/sealed-text-hashes.json; run `node tools/eval/three-datasets-suites.mjs hashes` first');
  return new Set(JSON.parse(fs.readFileSync(file, 'utf8')).hashes);
}

/** Merge accepted rows into datasets/<dataset>/<split>.jsonl. Returns {merged, refused}. */
export async function merge(dataset, split, {root = ROOT, dry = false} = {}) {
  const rows = readIncoming(dataset, root);
  const sealed = sealedHashes(root);
  const merged = [], refused = [];
  for (const row of rows) {
    if (row.review_status !== 'accepted') continue;
    if (sealed.has(createHash('sha1').update(normalText(row.message)).digest('hex').slice(0, 16))) { refused.push({id: row.id, why: 'duplicates a sealed test message'}); continue; }
    if (dataset === 'symbolic_english' && row.analysis_verified !== 'gold_sop_match') { refused.push({id: row.id, why: 'symbolic_english needs a gold SOP that matches (analysis_verified gold_sop_match)'}); continue; }
    if (dataset !== 'symbolic_english' && !row.target) { refused.push({id: row.id, why: 'no target'}); continue; }
    merged.push(row);
  }
  if (dry || !merged.length) return {merged, refused};
  const {writeSplit, summarise, updateManifest} = await import('./three-datasets/write.mjs');
  const file = path.join(root, 'datasets', dataset, `${split}.jsonl`);
  const existing = readJsonlShardedSync(file);
  const ids = new Set(existing.map(r => r.id));
  const added = merged.filter(r => !ids.has(r.id)).map(r => ({...r, split, review_status: 'reviewed_production', source: {...r.source, split}, quality_flags: {...r.quality_flags, human_reviewed: true, training_approved: false}}));
  const all = [...existing, ...added];
  const written = await writeSplit(dataset, split, all);
  updateManifest(dataset, {sha256: {[written.path]: written.sha256}, bytes: {[written.path]: written.bytes}, counts: {[split]: summarise(dataset, all)}});
  const mergedIds = new Set(merged.map(r => r.id));
  writeIncoming(dataset, rows.map(r => (mergedIds.has(r.id) ? {...r, review_status: 'merged', merged_into: split, merged_at: new Date().toISOString()} : r)), root);
  return {merged: added, refused, written};
}

const parseArgs = argv => { const o = {_: []}; for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(argv[i]); } return o; };
const textArg = value => (typeof value === 'string' && value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf8') : value ?? null);

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const o = parseArgs(rest);
  if (command === 'add') {
    if (typeof o.message !== 'string' || !o.message.trim()) throw Error('--message TEXT is required');
    const {openLm} = await import('../eval/composed/lm.mjs');
    const lm = await openLm({useCache: false});
    try {
      const verdict = await classify(o.message, {symbolicRun: lm.run, forced: o.dataset ?? 'auto'});
      if (!THREE_DATASETS.includes(verdict.dataset)) throw Error(`unknown dataset ${verdict.dataset}`);
      const row = incomingRow({message: o.message, dataset: verdict.dataset, verdict, clean: o.clean ?? null, rewrite: o.rewrite ?? null, sop: textArg(o.sop), reporter: o.reporter ?? null, note: o.note ?? null});
      const existing = readIncoming(verdict.dataset, ROOT);
      if (existing.some(r => r.id === row.id)) { console.log(`already queued: ${row.id}`); return; }
      console.log(`${row.id} -> ${verdict.dataset} (gate ${verdict.gate.partition}${verdict.symbolic ? `, SymbolicLM ${handled(verdict.symbolic) ? 'handles it' : 'does not handle it: ' + verdict.symbolic.outcome}` : ''})`);
      if (o.dry) { console.log(JSON.stringify(row, null, 1)); return; }
      fs.mkdirSync(path.dirname(incomingFile(verdict.dataset)), {recursive: true});
      fs.appendFileSync(incomingFile(verdict.dataset), JSON.stringify(row) + '\n');
      console.log(`appended to ${path.relative(ROOT, incomingFile(verdict.dataset))} (review_status pending)`);
    } finally { await lm.close(); }
  } else if (command === 'list') {
    for (const dataset of o.dataset ? [o.dataset] : THREE_DATASETS) for (const r of readIncoming(dataset, ROOT)) if (!o.status || r.review_status === o.status) console.log(`${r.review_status}\t${dataset}\t${r.id}\t${r.message.slice(0, 90).replace(/\n/g, ' ')}`);
  } else if (command === 'review') {
    if (!STATUSES.includes(o.status) || o.status === 'pending' || o.status === 'merged') throw Error('--status accepted|rejected');
    let found = false;
    for (const dataset of THREE_DATASETS) {
      const rows = readIncoming(dataset, ROOT);
      if (!rows.some(r => r.id === o.id)) continue;
      found = true;
      writeIncoming(dataset, rows.map(r => (r.id === o.id ? {...r, review_status: o.status, reviewed_by: o.reviewer ?? process.env.CHATSOP_ACTOR ?? 'unknown', reviewed_at: new Date().toISOString(), review_note: o.note ?? null, quality_flags: {...r.quality_flags, human_reviewed: true}} : r)), ROOT);
    }
    if (!found) throw Error(`no incoming row ${o.id}`);
    console.log(`${o.id}: ${o.status}`);
  } else if (command === 'merge') {
    if (!THREE_DATASETS.includes(o.dataset) || !['train', 'dev'].includes(o.into)) throw Error('--dataset D --into train|dev');
    const result = await merge(o.dataset, o.into, {dry: Boolean(o.dry)});
    console.log(`${o.dry ? 'would merge' : 'merged'} ${result.merged.length} row(s) into datasets/${o.dataset}/${o.into}.jsonl; refused ${result.refused.length}`);
    for (const r of result.refused) console.log(`  refused ${r.id}: ${r.why}`);
    if (!o.dry && result.merged.length) console.log('Next: node tools/datasets/verify-three-datasets.mjs, then record the merge with node tools/journal.mjs add --area data --state done ...');
  } else { console.error('usage: add-case.mjs add|list|review|merge ...'); process.exitCode = 2; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(process.exitCode ?? 0), error => { console.error(error.message); process.exit(1); });
