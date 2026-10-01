#!/usr/bin/env node
/** Production regression loop: add a case seen in production to the pending queue of the right dataset (DS008 "How we learn from production").
 *
 *   node tools/datasets/add-case.mjs add --message TEXT [--clean TEXT] [--rewrite TEXT] [--sop TEXT|@file] [--reporter NAME] [--note TEXT] [--dataset auto|bad_english|symbolic_english|neuro_english] [--dry]
 *   node tools/datasets/add-case.mjs resolve [--dry] [--no-stage]
 *   node tools/datasets/add-case.mjs list [--dataset D] [--status pending|accepted|rejected|merged]
 *   node tools/datasets/add-case.mjs review --id ID --status accepted|rejected [--reviewer NAME] [--note TEXT]
 *   node tools/datasets/add-case.mjs merge --dataset D --into train|dev [--dry]
 *
 * `add` classifies the message like the builders, on the ANALYSIS layer (DS008 "Three datasets"), never by the SOP result:
 *   not clean English (Romanian, mixed, noisy)                          -> bad_english     (`--clean` is the clean target)
 *   clean English, every sentence passes the analysis gate               -> symbolic_english (identical default/accurate trees, DeepSeek judge a and c good; `--sop` is an optional gold SOP, kept in `sop_layer`)
 *   clean English, a sentence fails the gate                             -> neuro_english   (`--rewrite` is the rewrite target)
 *   clean English, a parse or judge verdict is still missing             -> the local pending queue (datasets_sources/incoming_pending); `add` records the missing
 *                                                                           default parses and appends the judge items to datasets_sources/resplit_parse_judge; after the omp judge task ran, `resolve` places the case
 *   no analysed sentence, or an `unparsed` span                          -> the SOP rules (handled -> symbolic_english, else neuro_english), as in the builders
 * and appends one row to datasets/<dataset>/incoming.jsonl with `source.corpus: production`, a timestamp and `review_status: pending`.
 * Nothing else is touched. The owner reviews incoming rows on the audit page (split `incoming`), or with `review` here. `merge` moves
 * the ACCEPTED rows of a dataset into datasets/<dataset>/train.jsonl or dev.jsonl (sealed test files are never written here: a new
 * regression case enters the sealed test only through the owner's builders), refusing a row whose text duplicates a sealed test row, a symbolic_english row whose
 * analysis gate did not pass, updates the manifest and marks the incoming row `merged`. Merged rows are then part of the regression net (tools/symbolic-regression.mjs reads train, dev and test).
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
import {placeRow} from './three-datasets/place.mjs';
import {specialKind} from './three-datasets/assemble.mjs';

/** `analysis_verified` values that admit a row to symbolic_english: the gate passed, or the SOP rules decided a row the gate cannot judge (no analysis, unparsed span). */
const VERIFIED = new Set(['analysis_gate', 'sop_rule']);
export const STATUSES = ['pending', 'accepted', 'rejected', 'merged'];
export const incomingFile = (dataset, root = ROOT) => path.join(root, 'datasets', dataset, 'incoming.jsonl');
const readQueue = (dataset, root) => (fs.existsSync(queueFile(dataset, root)) ? fs.readFileSync(queueFile(dataset, root), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const readIncoming = (dataset, root) => (fs.existsSync(incomingFile(dataset, root)) ? fs.readFileSync(incomingFile(dataset, root), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeIncoming = (dataset, rows, root) => fs.writeFileSync(incomingFile(dataset, root), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

const idOf = (message, dataset) => `production::${createHash('sha1').update(`${dataset}\n${message}`).digest('hex').slice(0, 12)}`;

/** Placement states of the analysis gate that mean "decided"; `pending` waits for a recorded parse or a judge verdict and is never guessed. */
export const PENDING = 'pending';
/** Local queue of cases whose analysis verdict is still missing (datasets_sources/ is the local, never exported cache). */
export const pendingFile = (root = ROOT) => path.join(root, 'datasets_sources/incoming_pending/incoming.jsonl');
const queueFile = (dataset, root) => (dataset === PENDING ? pendingFile(root) : incomingFile(dataset, root));

/**
 * Which dataset a message belongs to and why, on the ANALYSIS layer like the builders (DS008 "Three datasets"): not clean English -> bad_english;
 * clean English whose every sentence passes the analysis gate (identical default and accurate trees, DeepSeek judge conditions a and c good,
 * tools/datasets/three-datasets/analysis-gate.mjs) -> symbolic_english; a failing sentence -> neuro_english; a missing parse or judge verdict -> `pending`
 * (no guess; `resolve` places the case once the verdicts exist). A message with no analysed sentence or with an `unparsed` span follows the SOP rules
 * (UNPARSED_POLICY of the builders): handled without doubt -> symbolic_english, else neuro_english. The SOP result stays on the row as `sop_layer`.
 * `symbolicRun(text)` returns the SymbolicLM record (composed/lm.mjs); `gate` is an AnalysisGate (`compute(text, analysis)`); `prepare(text, analysis)` stages
 * the missing parses and judge items before the decision (optional).
 */
export async function classify(message, {symbolicRun, gate = null, prepare = null, forced = null}) {
  const partition = classifyMessage(message);
  const clean = partition.partition === 'clean_en';
  const base = {gate: {partition: partition.partition, reasons: partition.reasons}};
  if (!clean && !(forced && forced !== 'auto')) return {dataset: 'bad_english', ...base, symbolic: null, decision: null, special: null};
  if (!clean) return {dataset: forced, ...base, symbolic: null, decision: null, special: null, forced: true};
  const symbolic = await symbolicRun(message);
  const analysis = {sentences: symbolic.sentences ?? []};
  const special = specialKind({analysis, unparsed: symbolic.unparsed ?? []});
  if (analysis.sentences.length && !gate) throw Error('classify needs an AnalysisGate to decide on the analysis layer');
  if (gate && analysis.sentences.length) await prepare?.(message, analysis);
  const decision = analysis.sentences.length ? gate.compute(message, analysis) : null;
  let dataset;
  if (special) dataset = handled(symbolic) ? 'symbolic_english' : 'neuro_english';
  else dataset = decision.state === 'pass' ? 'symbolic_english' : decision.state === 'fail' ? 'neuro_english' : PENDING;
  const placed = {dataset, ...base, symbolic, decision, special};
  return forced && forced !== 'auto' ? {...placed, dataset: forced, forced: true, gate_dataset: dataset} : placed;
}

/** The incoming row for a classified case. */
export function incomingRow({message, dataset, verdict, clean = null, rewrite = null, sop = null, reporter = null, note = null, now = new Date()}) {
  const id = idOf(message, dataset), s = verdict.symbolic;
  const row = {
    id, dataset, split: 'incoming', split_group_id: id, message,
    source: {corpus: 'production', id, suite: 'production', split: 'incoming', kind: 'production_case', reported_by: reporter, family: 'production', semantic_case_id: id},
    provenance: {source: 'production', added_at: now.toISOString(), added_by: reporter ?? process.env.CHATSOP_ACTOR ?? 'unknown', classified_by: 'tools/datasets/add-case.mjs (clean-English gate, then the analysis gate)'},
    rights: {license: 'MIT (repository LICENSE); production message supplied by the operator', rights_decision: 'operator-supplied', text_copied: false, spec: 'docs/specs/DS014-source-rights.md'},
    quality_flags: {synthetic: false, human_reviewed: false, training_approved: false, llm_authored: false, production: true},
    review_status: 'pending', note,
    classification: {gate: verdict.gate, symbolic_lm: s ? {handled: handled(s), outcome: s.outcome, valid: s.valid, uncertain: s.uncertain, reasons: s.reasons, unparsed: s.unparsed} : null, forced: Boolean(verdict.forced)},
  };
  if (dataset === 'bad_english') return {...row, language_kind: verdict.gate.partition === 'clean_en' ? 'noisy_en' : verdict.gate.partition, target: clean, target_source: clean ? 'production' : null, targets: clean ? [{text: clean, source: 'production'}] : [], noise_categories: [], flags: clean ? [] : ['no_target']};
  // symbolic_english, neuro_english and the pending queue: the shared analysis-layer fields, placed like the builders place a row (place.mjs).
  const goldMatch = sop && s ? compareParagraph(s.sop, [sop]).exact : null;
  const common = {...row, analysis: s ? {columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences: s.sentences} : null, sop: s?.sop ?? null, sop_valid: s?.valid ?? false, outcome: s?.outcome ?? null, unparsed: s?.unparsed ?? [], uncertain: s?.uncertain ?? null};
  const target = rewrite ?? null, opts = {gold_sop: sop ?? null, sopMatch: goldMatch, target, targetSource: target ? 'production' : null, targets: target ? [{text: target, source: 'production'}] : []};
  const gateWants = verdict.gate_dataset ?? dataset;
  let decision = verdict.decision ?? {state: 'no_analysis', sentences: [], reasons: [], failure_kind: null, worst_tree: null};
  const bySop = Boolean(verdict.special);
  if (bySop) decision = {...decision, state: gateWants === 'symbolic_english' ? 'pass' : 'fail', reasons: [], failure_kind: verdict.special};
  // A forced dataset the gate did not choose keeps the gate's own verdict on the row: it cannot be merged as analysis-verified.
  let placed = dataset === 'neuro_english' && decision.state === 'pass' ? {...decision, state: 'fail', reasons: [{kind: 'forced'}], failure_kind: 'forced'} : decision;
  const out = placeRow(common, placed, opts);
  if (bySop) { out.analysis_verified = gateWants === 'symbolic_english' ? 'sop_rule' : 'sop_rule_failed'; out.analysis_verdict = {...out.analysis_verdict, placed_by: 'sop_rule'}; }
  if (dataset === 'symbolic_english' && out.dataset === 'neuro_english') { // forced into symbolic_english though the gate did not pass
    return {...out, dataset: 'symbolic_english', analysis_verified: out.analysis_verified, forced_against_gate: true};
  }
  return {...out, dataset};
}

/**
 * Place the cases of the pending queue whose analysis verdict now exists (the judge task ran): the stored analysis is gated again and the case moves to the
 * incoming file of its dataset (a case still waiting stays). Returns {placed: [{id, from, to, dataset}], waiting}.
 */
export async function resolvePending({root = ROOT, gate, dry = false, now = new Date()}) {
  gate.reload();
  const rows = readQueue(PENDING, root), keep = [], placed = [];
  for (const row of rows) {
    const c = row.classification.symbolic_lm;
    const symbolic = {sop: row.sop ?? '', valid: row.sop_valid, outcome: row.outcome, uncertain: c?.uncertain ?? false, reasons: c?.reasons ?? [], unparsed: row.unparsed ?? [], sentences: row.analysis?.sentences ?? []};
    const decision = gate.compute(row.message, {sentences: symbolic.sentences});
    if (decision.state === 'pending') { keep.push(row); continue; }
    const dataset = decision.state === 'pass' ? 'symbolic_english' : 'neuro_english';
    const verdict = {gate: row.classification.gate, symbolic, decision, special: null, forced: row.classification.forced};
    const next = {...incomingRow({message: row.message, dataset, verdict, clean: null, rewrite: row.target ?? null, sop: row.gold_sop ?? null, reporter: row.source.reported_by, note: row.note, now: new Date(row.provenance.added_at)}), pending_id: row.id, review_status: row.review_status, provenance: {...row.provenance, resolved_at: now.toISOString()}};
    if (readQueue(dataset, root).some(r => r.id === next.id)) continue;
    placed.push({id: row.id, to: next.id, dataset, row: next});
  }
  if (!dry && placed.length) {
    for (const {dataset, row} of placed) { fs.mkdirSync(path.dirname(queueFile(dataset, root)), {recursive: true}); fs.appendFileSync(queueFile(dataset, root), JSON.stringify(row) + '\n'); }
    fs.writeFileSync(pendingFile(root), keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''));
  }
  return {placed: placed.map(({id, to, dataset}) => ({id, to, dataset})), waiting: keep.length};
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
    if (dataset === 'symbolic_english' && !VERIFIED.has(row.analysis_verified)) { refused.push({id: row.id, why: `symbolic_english needs a passed analysis gate (analysis_verified ${[...VERIFIED].join(' or ')}), not ${row.analysis_verified ?? 'unset'}`}); continue; }
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
      const {AnalysisGate, stage} = await import('./three-datasets/analysis-gate.mjs');
      const gate = new AnalysisGate();
      // Missing default-package parses are recorded (GPU, one worker) and missing judge items are appended to the omp task folder; a dry run only counts.
      const prepare = async (text, analysis) => { const r = await stage(gate, [{text, analysis}], {record: !o.dry}); if (r.items_needed) console.log(`staged: ${r.items_needed} judge item(s) needed, ${r.items_added} added to datasets_sources/resplit_parse_judge`); };
      const verdict = await classify(o.message, {symbolicRun: lm.run, gate, prepare, forced: o.dataset ?? 'auto'});
      if (verdict.dataset !== PENDING && !THREE_DATASETS.includes(verdict.dataset)) throw Error(`unknown dataset ${verdict.dataset}`);
      const row = incomingRow({message: o.message, dataset: verdict.dataset, verdict, clean: o.clean ?? null, rewrite: o.rewrite ?? null, sop: textArg(o.sop), reporter: o.reporter ?? null, note: o.note ?? null});
      const existing = readQueue(verdict.dataset, ROOT);
      if (existing.some(r => r.id === row.id)) { console.log(`already queued: ${row.id}`); return; }
      console.log(`${row.id} -> ${verdict.dataset} (gate ${verdict.gate.partition}${verdict.decision ? `, analysis gate ${verdict.decision.state}${verdict.special ? ` (${verdict.special}: SOP rules)` : ''}` : ''}${verdict.symbolic ? `, SymbolicLM SOP ${handled(verdict.symbolic) ? 'handled' : 'not handled: ' + verdict.symbolic.outcome}` : ''})`);
      if (o.dry) { console.log(JSON.stringify(row, null, 1)); return; }
      fs.mkdirSync(path.dirname(queueFile(verdict.dataset, ROOT)), {recursive: true});
      fs.appendFileSync(queueFile(verdict.dataset, ROOT), JSON.stringify(row) + '\n');
      console.log(`appended to ${path.relative(ROOT, queueFile(verdict.dataset, ROOT))} (review_status pending${verdict.dataset === PENDING ? '; waiting for the judge task, then: add-case.mjs resolve' : ''})`);
    } finally { await lm.close(); }
  } else if (command === 'resolve') {
    const {AnalysisGate, stage} = await import('./three-datasets/analysis-gate.mjs');
    const gate = new AnalysisGate();
    const pending = readQueue(PENDING, ROOT);
    if (pending.length && !o.dry && !o['no-stage']) { const r = await stage(gate, pending.map(row => ({text: row.message, analysis: {sentences: row.analysis?.sentences ?? []}})), {record: true}); console.log(`staged: ${r.items_needed} judge item(s) still needed, ${r.items_added} added`); }
    const result = await resolvePending({gate, dry: Boolean(o.dry)});
    for (const p of result.placed) console.log(`${p.id} -> ${p.dataset} (${p.to})`);
    console.log(`${result.placed.length} placed, ${result.waiting} still waiting for the judge task`);
  } else if (command === 'list') {
    for (const dataset of o.dataset ? [o.dataset] : [...THREE_DATASETS, PENDING]) for (const r of readQueue(dataset, ROOT)) if (!o.status || r.review_status === o.status) console.log(`${r.review_status}\t${dataset}\t${r.id}\t${r.message.slice(0, 90).replace(/\n/g, ' ')}`);
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
  } else { console.error('usage: add-case.mjs add|resolve|list|review|merge ...'); process.exitCode = 2; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(process.exitCode ?? 0), error => { console.error(error.message); process.exit(1); });
