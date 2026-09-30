/** Audit views of the three current datasets (owner decision 2026-09-30, DS008 "Three datasets", DS020 "Type-specific
 * case views"): `bad_english`, `symbolic_english` and `neuro_english`. One row is one case.
 *
 * The rows are large (each carries the grammatical analysis), so the corpus is indexed lazily and cheaply: one pass over
 * each split file keeps only the facet fields, the message and the byte range of the row; a case detail re-reads its
 * row from disk. The audit server therefore holds a few tens of megabytes for a dataset instead of the parsed rows.
 *
 * Views:
 *   symbolic_english  the message, SymbolicLM's grammatical analysis per sentence (dependency table and an indented
 *                     tree), the SOP Lang, verification status, and an on-demand re-run of SymbolicLM that classifies
 *                     the row like tools/symbolic-regression.mjs;
 *   neuro_english     failure kind and blame, SymbolicLM's output against the gold, the rewrite target with a word
 *                     diff, and an on-demand SymbolicLM check of the message and the target;
 *   bad_english       kind and noise categories, the clean target with a word diff, and an on-demand check that the
 *                     target is clean English (the classifier) and parses.
 */
import fs from 'node:fs';
import path from 'node:path';
import {shardPaths} from '../lib/jsonl-shards.mjs';
import {classifyRow} from '../lib/symbolic-lm/regression.mjs';
import {diffWords} from '../lib/text-to-clean-english/index.mjs';
import {label, tally, sha256, compareChecks, CHECK_ROW_LIMIT, symbolicChecker} from './audit-shared.mjs';

const slim = ({current, ...rest}) => rest;
const listOf = (value, empty = 'none') => (Array.isArray(value) && value.length ? value.map(String) : [empty]);
const judgeLabel = judge => (judge === null || judge === undefined ? 'none' : typeof judge === 'object' ? String(judge.verdict ?? judge.status ?? judge.label ?? 'recorded') : String(judge));
const agreementLabel = value => (value === true ? 'agree' : value === false ? 'disagree' : 'not comparable');
const targetState = row => (row.rewrite_target === false ? 'not a rewrite target' : row.target ? 'has target' : 'no target');

/** Facet groups per dataset, in tree order. Every non-split, non-verdict key is a field of the indexed case. */
export const DATASET_FACETS = {
  symbolic_english: [
    {key: 'split', label: 'Split'},
    {key: 'source', label: 'Source corpus'},
    {key: 'verification', label: 'Verification status'},
    {key: 'judge', label: 'Judge verdict'},
    {key: 'agreement', label: 'Stanza-spaCy agreement'},
    {key: 'outcome', label: 'Outcome'},
    {key: 'verdict', label: 'Reviewer verdict'},
  ],
  neuro_english: [
    {key: 'split', label: 'Split'},
    {key: 'failure_kind', label: 'Failure kind'},
    {key: 'blame', label: 'Blame categories'},
    {key: 'target_state', label: 'Rewrite target'},
    {key: 'flag', label: 'Flags'},
    {key: 'target_source', label: 'Target source'},
    {key: 'source', label: 'Source corpus'},
    {key: 'verdict', label: 'Reviewer verdict'},
  ],
  bad_english: [
    {key: 'split', label: 'Split'},
    {key: 'kind', label: 'Kind'},
    {key: 'noise', label: 'Noise categories'},
    {key: 'target_state', label: 'Clean target'},
    {key: 'target_source', label: 'Target source'},
    {key: 'source', label: 'Source corpus'},
    {key: 'verdict', label: 'Reviewer verdict'},
  ],
};

/** The indexed facet fields of one row, per dataset (arrays are multi-valued facets). */
const FACET_FIELDS = {
  symbolic_english: row => ({source: label(row.source?.corpus), verification: label(row.analysis_verified), judge: judgeLabel(row.verification?.judge), agreement: agreementLabel(row.verification?.stanza_spacy_agree), outcome: label(row.outcome)}),
  neuro_english: row => ({failure_kind: label(row.failure_kind), blame: listOf(row.failure?.categories), target_state: targetState(row), flag: listOf(row.flags), target_source: label(row.target_source), source: label(row.source?.corpus)}),
  bad_english: row => ({kind: label(row.language_kind), noise: listOf(row.noise_categories), target_state: targetState(row), target_source: label(row.target_source), source: label(row.source?.corpus)}),
};

export const datasetListItem = item => ({
  kind: item.kind ?? item.failure_kind ?? null,
  verification: item.verification ?? null,
  failure_kind: item.failure_kind ?? null,
  target_state: item.target_state ?? null,
  source: item.source,
});

/** Reads `length` bytes at `offset` of `file` and parses them as one JSON row. */
function readRowAt(file, offset, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    return JSON.parse(buffer.toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

/** Calls `visit(row, offset, length)` for every JSONL line of `file`, parsing one row at a time. */
function scanFile(file, visit) {
  const buffer = fs.readFileSync(file);
  let start = 0;
  while (start < buffer.length) {
    let end = buffer.indexOf(10, start);
    if (end < 0) end = buffer.length;
    if (end > start) visit(JSON.parse(buffer.toString('utf8', start, end)), start, end - start);
    start = end + 1;
  }
}

const stampOf = file => { const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}`; };

/** Loads one dataset lazily: the case index with facets, no parsed rows kept. `corpus.files` = [{split, file}]. */
export function loadDatasetCorpus(corpus, type, {root}) {
  const fieldsOf = FACET_FIELDS[type];
  const cases = [];
  const seen = new Map();
  // Byte ranges are only valid for the file version that was indexed; `stale()` tells the router to index again
  // (another agent may rewrite a dataset file while the audit server runs).
  const stamps = new Map();
  for (const {split, file} of corpus.files) {
    for (const shard of shardPaths(file)) {
      stamps.set(shard, stampOf(shard));
      const relative = path.relative(root, shard);
      scanFile(shard, (row, offset, length) => {
        const base = String(row.id);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count ? `${base}#${count + 1}` : base;
        const message = String(row.message ?? '').replace(/\s+/g, ' ').trim();
        const entry = {split, file: relative, get row() { return readRowAt(shard, offset, length); }};
        cases.push({id, entries: [entry], splits: [split], languages: [label(row.language_kind ?? row.language ?? 'en')], request: message, haystack: (id + '\n' + message + '\n' + (row.target ?? '')).toLowerCase(), ...fieldsOf(row)});
      });
    }
  }
  // Reviewable splits first (train, dev), the sealed test last, each in id order.
  const splitRank = split => ['train', 'dev', 'test'].indexOf(split);
  cases.sort((a, b) => splitRank(a.splits[0]) - splitRank(b.splits[0]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byCase = new Map(cases.map(item => [item.id, item]));
  const facets = {};
  for (const {key} of DATASET_FACETS[type]) {
    if (key === 'verdict') continue;
    facets[key] = tally(cases.flatMap(item => (key === 'split' ? item.splits : [].concat(item[key]))));
  }
  return {
    name: corpus.name,
    type,
    entries: [],
    cases,
    byCase,
    facets,
    stale: () => [...stamps].some(([shard, stamp]) => { try { return stampOf(shard) !== stamp; } catch { return true; } }),
    summary: {
      rows: cases.length,
      cases: cases.length,
      splits: tally(cases.flatMap(item => item.splits)),
      languages: tally(cases.flatMap(item => item.languages)),
      shapes: {},
      statuses: {},
      themes: {},
      fingerprint: sha256(cases.map(item => item.id).join('\n')),
    },
  };
}

// ---- Grammatical analysis rendering ----

const COLUMNS = ['id', 'form', 'lemma', 'upos', 'head', 'deprel'];
const tokenOf = (columns, values) => Object.fromEntries((columns ?? COLUMNS).map((name, index) => [name, values[index]]));

/** Indented dependency tree of one sentence: one line per token, `deprel  form`, children in sentence order. */
export function dependencyTree(tokens) {
  const children = new Map();
  for (const token of tokens) {
    if (!children.has(token.head)) children.set(token.head, []);
    children.get(token.head).push(token);
  }
  const lines = [];
  const visited = new Set();
  const walk = (token, prefix, last, top) => {
    if (visited.has(token.id)) return;
    visited.add(token.id);
    lines.push(`${top ? '' : prefix + (last ? '└─ ' : '├─ ')}${token.deprel}  ${token.form}${token.upos ? ' (' + token.upos + ')' : ''}`);
    const kids = children.get(token.id) ?? [];
    kids.forEach((kid, index) => walk(kid, top ? '' : prefix + (last ? '   ' : '│  '), index === kids.length - 1, false));
  };
  for (const root of children.get(0) ?? []) walk(root, '', true, true);
  for (const token of tokens) if (!visited.has(token.id)) walk(token, '', true, true);
  return lines.join('\n');
}

/** One line per dependency arc: `form —deprel→ head form` (the root points to the sentence). */
export const dependencyArcs = tokens => tokens.map(token => {
  const head = tokens.find(other => other.id === token.head);
  return `${token.id} ${token.form} —${token.deprel}→ ${head ? head.id + ' ' + head.form : 'ROOT'}`;
});

/** The analysis of a row (`{columns, sentences: [{text, tokens}]}`) as readable sentences: token objects, tree, arcs. */
export function sentencesView(analysis) {
  return (analysis?.sentences ?? []).map(sentence => {
    const tokens = (sentence.tokens ?? []).map(values => tokenOf(analysis.columns, values));
    return {text: sentence.text, tokens, tree: dependencyTree(tokens), arcs: dependencyArcs(tokens)};
  });
}

// ---- Case details ----

const rowSummary = (entry, row, expected) => ({id: row.id, split: entry.split, file: entry.file, language: row.language_kind ?? row.language ?? 'en', question: row.message, message: row.message, expected});
const spansOf = (message, text) => (text && text !== message ? diffWords(message, text) : null);

function common(type, item, {corpus, verdict, history, audit}, row, expected) {
  const entry = item.entries[0];
  return {
    id: item.id,
    corpus,
    type,
    splits: item.splits,
    languages: item.languages,
    message: row.message,
    target: null,
    source: row.source ?? null,
    rights: row.rights ?? null,
    quality_flags: row.quality_flags ?? {},
    review_status: row.review_status ?? null,
    file: entry.file,
    verdict,
    history,
    audit,
    rows: [rowSummary(entry, row, expected)],
    raw: [row],
  };
}

export function datasetCaseDetail(type, item, context) {
  const row = item.entries[0].row;
  if (type === 'symbolic_english') {
    return {
      ...common(type, item, context, row, row.sop ?? null),
      verification: {analysis_verified: row.analysis_verified ?? null, sop_gold_match: row.verification?.sop_gold_match ?? null, judge: row.verification?.judge ?? null, stanza_spacy_agree: row.verification?.stanza_spacy_agree ?? null},
      symbolic_lm: row.symbolic_lm ?? null,
      sentences: sentencesView(row.analysis),
      sop: row.sop ?? '',
      sop_valid: row.sop_valid ?? null,
      outcome: row.outcome ?? null,
      unparsed: row.unparsed ?? [],
      uncertain: row.uncertain ?? false,
      gold_sop: row.gold_sop ?? null,
      reference_clean: row.reference_clean ?? null,
    };
  }
  if (type === 'neuro_english') {
    const targets = (row.targets ?? []).map(target => ({...target, spans: spansOf(row.message, target.text)}));
    return {
      ...common(type, item, context, row, row.gold_sop ?? null),
      failure_kind: row.failure_kind ?? null,
      failure: row.failure ?? null,
      rewrite_target: row.rewrite_target ?? null,
      flags: row.flags ?? [],
      verification: {analysis_verified: row.analysis_verified ?? null, sop_gold_match: row.verification?.sop_gold_match ?? null, judge: row.verification?.judge ?? null, stanza_spacy_agree: row.verification?.stanza_spacy_agree ?? null},
      symbolic_lm: row.symbolic_lm ?? null,
      sentences: sentencesView(row.analysis),
      sop: row.sop ?? '',
      sop_valid: row.sop_valid ?? null,
      outcome: row.outcome ?? null,
      unparsed: row.unparsed ?? [],
      gold_sop: row.gold_sop ?? null,
      target_text: row.target ?? null,
      target_source: row.target_source ?? null,
      targets,
      unverified_references: row.unverified_references ?? [],
    };
  }
  const targets = (row.targets ?? []).map(target => ({...target, spans: spansOf(row.message, target.text)}));
  return {
    ...common(type, item, context, row, row.target ?? null),
    kind: row.language_kind ?? null,
    noise_categories: row.noise_categories ?? [],
    noise: row.noise ?? null,
    gate_reasons: row.gate_reasons ?? [],
    target_text: row.target ?? null,
    target_source: row.target_source ?? null,
    targets,
  };
}

// ---- On-demand checks ----

const symbolicOptions = {route: 'direct', language: 'auto'};
const sameAnalysis = (row, current) => JSON.stringify((row.analysis?.sentences ?? []).map(s => [s.text, s.tokens])) === JSON.stringify((current?.analysis?.sentences ?? []).map(s => [s.text, s.tokens]));

/** Re-runs SymbolicLM on one symbolic_english row and classifies the result like tools/symbolic-regression.mjs (gold not re-scored). */
async function rerunSymbolic(item, corpus, symbolic) {
  const row = item.entries[0].row;
  const check = await symbolic.check(row.message, symbolicOptions);
  if (!check.ok) return {caseId: item.id, corpus, type: 'symbolic_english', available: false, error: check.error};
  const cls = classifyRow(row, check.current);
  return {
    caseId: item.id, corpus, type: 'symbolic_english', available: true,
    class: cls,
    same_analysis: sameAnalysis(row, check.current),
    same_sop: row.sop === check.current.sop,
    stored_sop: row.sop ?? '',
    current_sop: check.current.sop,
    outcome: check.outcome,
    ms: check.ms,
    current_sentences: sentencesView(check.current.analysis),
    note: 'Gold SOPs are not re-scored here; a changed SOP is judged by node tools/symbolic-regression.mjs.',
  };
}

/** SymbolicLM on the message and on up to three targets of a neuro_english row, against the stored output and the gold. */
async function checkNeuro(item, corpus, symbolic) {
  const row = item.entries[0].row;
  const gold = row.gold_sop ? String(row.gold_sop).trim() : null;
  const message = await symbolic.check(row.message, symbolicOptions);
  const targets = [];
  for (const target of (row.targets ?? []).slice(0, 3)) {
    const check = await symbolic.check(target.text, symbolicOptions);
    targets.push({text: target.text, source: target.source, check: slim(check), ...compareChecks(message, check), matches_gold: gold && check.ok ? check.sop.trim() === gold : null});
  }
  return {
    caseId: item.id, corpus, type: 'neuro_english', available: message.ok, error: message.ok ? null : message.error,
    message: {check: slim(message), same_as_stored: message.ok ? message.sop.trim() === String(row.sop ?? '').trim() : null, matches_gold: gold && message.ok ? message.sop.trim() === gold : null, sentences: message.ok ? sentencesView(message.current?.analysis) : []},
    targets,
  };
}

/** Whether each target of a bad_english row is clean English (the classifier of DS008) and parses cleanly; the message is classified too. */
async function checkBad(item, corpus, symbolic) {
  const row = item.entries[0].row;
  const {classifyMessage} = await import('../tools/datasets/three-datasets/sources.mjs');
  const classify = (text, language, extra = {}) => {
    const {partition, reasons} = classifyMessage(text, language, extra);
    return {partition, reasons};
  };
  const message = classify(row.message, row.language ?? 'en', {code_switch: row.noise?.code_switch ?? null});
  const targets = [];
  for (const target of (row.targets ?? []).slice(0, CHECK_ROW_LIMIT)) {
    const clean = classify(target.text, 'en');
    const parse = await symbolic.check(target.text, symbolicOptions);
    targets.push({text: target.text, source: target.source, classifier: clean, clean_english: clean.partition === 'clean_en', check: slim(parse)});
  }
  return {caseId: item.id, corpus, type: 'bad_english', available: true, message, targets};
}

export async function executeDatasetCase(type, item, {corpus, symbolic = symbolicChecker()}) {
  if (type === 'symbolic_english') return rerunSymbolic(item, corpus, symbolic);
  if (type === 'neuro_english') return checkNeuro(item, corpus, symbolic);
  return checkBad(item, corpus, symbolic);
}
