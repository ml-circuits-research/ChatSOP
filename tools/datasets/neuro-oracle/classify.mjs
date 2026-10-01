/** Candidate verdicts of the neuro oracle: SymbolicLM on every candidate (recorded parses, current rules), the strict
 * gold comparison, and the tree-agreement half of the gate. The judge half (DeepSeek conditions a and c, meaning check)
 * is merged by `merge.mjs` from the verdict files the omp task folders write.
 */
import path from 'node:path';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';
import {archived} from '../../../lib/dataset-paths.mjs';
import {replayLm} from '../../symbolic-regression.mjs';
import {strictScores} from '../three-datasets/score.mjs';
import {compareSentence} from '../../../lib/symbolic-lm/uncertainty.mjs';
import {ROOT, ParseStore} from './common.mjs';

const read = relative => readJsonlShardedSync(path.join(ROOT, relative));

/** Legacy corpus files that hold the source rows (with their verification worlds) of train/dev neuro rows. The sealed suites are listed by tools/eval/neuro-oracle-test.mjs. */
export const TRAIN_DEV_GOLD_FILES = () => {
  const files = {
    'formalizer-v1': [archived('formalizer-v1/train.jsonl'), archived('formalizer-v1/dev.jsonl')],
    'proofing-diverse-dev': [archived('proofing-diverse-dev/diverse-dev.jsonl')],
  };
  // the legacy OOD and wild suites, re-split into train/dev/test by tools/eval/legacy-resplit.mjs: their train and dev parts live in datasets_archive
  for (const corpus of ['formalizer-ood-v1', 'formalizer-wild-v1']) { const list = ['train', 'dev'].map(split => archived(`${corpus}/${split}.jsonl`)).filter(f => jsonlExists(path.join(ROOT, f))); if (list.length) files[corpus] = list; }
  return files;
};

/** Legacy source row (with its verification world) of every neuro row that has a gold SOP: Map(row id -> record). `files`: {corpus: [relative file]}. */
export function goldSources(rows, files = TRAIN_DEV_GOLD_FILES()) {
  const wanted = new Map();
  for (const row of rows) if (row.gold_sop) wanted.set(`${row.source.corpus}::${row.source.id}`, row);
  const byKey = new Map();
  for (const [corpus, list] of Object.entries(files)) {
    const need = new Set([...wanted.keys()].filter(k => k.startsWith(corpus + '::')).map(k => k.slice(corpus.length + 2)));
    if (!need.size) continue;
    for (const file of list) for (const source of read(file)) if (need.has(source.id)) byKey.set(`${corpus}::${source.id}`, {corpus, wild: corpus === 'formalizer-wild-v1', row: source});
  }
  const out = new Map(), missing = [];
  for (const [key, row] of wanted) { const rec = byKey.get(key); if (rec) out.set(row.id, rec); else missing.push(row.id); }
  return {sources: out, missing};
}

/** SymbolicLM (the current rules over the recorded accurate parses) on every candidate: Map(cid -> result). */
export async function analyseCandidates(list) {
  const lm = replayLm(new ParseStore('accurate').record(), {full: true});
  const out = new Map();
  try {
    for (const c of list) {
      try {
        const r = await lm.analyze(c.text, {route: 'direct', language: 'auto'});
        out.set(c.cid, {sop: r.sop, valid: Boolean(r.valid), outcome: r.outcome, unparsed: (r.trace?.unparsed ?? []).map(u => u.span), uncertain: Boolean(r.uncertain), reasons: [...new Set((r.reasons ?? []).map(x => x.kind))], sentences: (r.analysis?.sentences ?? []).map(s => ({text: s.text, tokens: s.tokens}))});
      } catch (error) { out.set(c.cid, {sop: '', valid: false, outcome: 'crash', unparsed: [], uncertain: false, reasons: [], sentences: [], error: String(error.message ?? error).slice(0, 160)}); }
    }
  } finally { await lm.stop(); }
  return out;
}

/** Strict and frame-normalized gold match of the candidates whose SOP is valid: Map(cid -> {ok, frame_ok, syntax}). */
export async function goldMatches(list, results, rowsById, sources, {wildScore = null} = {}) {
  const records = [];
  for (const c of list) {
    const row = rowsById.get(c.id), source = sources.get(c.id), r = results.get(c.cid);
    if (!row?.gold_sop || !source || !r?.valid) continue;
    records.push({corpus: source.corpus, sourceId: c.cid, wild: source.wild, row: source.row, message: c.text});
  }
  const scores = await strictScores(records, rec => results.get(rec.sourceId).sop, {wildScore});
  return new Map(records.map(rec => [rec.sourceId, scores.get(`${rec.corpus}::${rec.sourceId}`)]));
}

/** Default-package tree of a text as compact sentences, from the recorded default parses; null when missing. */
export function defaultTrees(text, store, maskMessage) {
  const parse = store.get(`en|${maskMessage(text)}`) ?? store.get(`auto|${maskMessage(text)}`);
  return parse ? (parse.sentences ?? []).map(s => ({text: s.text, tokens: s.words.map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel])})) : null;
}

/** Tree agreement of the accurate and default parses of a candidate: {identical, sentences: [class...]}. */
export function treeAgreement(accurate, defaults) {
  if (!defaults || defaults.length !== accurate.length) return {identical: false, sentences: accurate.map(() => 'core_diff')};
  const classes = accurate.map((s, i) => compareSentence(defaults[i].tokens, s.tokens));
  return {identical: classes.every(c => c === 'identical'), sentences: classes};
}
