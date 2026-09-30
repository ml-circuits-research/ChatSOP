/** Stanza/spaCy agreement per analysed message (`verification.stanza_spacy_agree`).
 *
 * The cached analysis holds Stanza's compact parse; each sentence is parsed again with the spaCy worker
 * (lib/symbolic-lm/spacy.mjs, en_core_web_lg, CPU) and compared with `coreDisagreement` (root, subject, object,
 * indirect object and negation arcs), the same test SymbolicLM's uncertainty signal uses. Word offsets are rebuilt by
 * locating each token form in the sentence text; when that fails the agreement is null (not comparable).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {SpacyWorker, spacyMissing} from '../../../lib/symbolic-lm/spacy.mjs';
import {coreDisagreement, compareSentence} from '../../../lib/symbolic-lm/uncertainty.mjs';
import {loadCache as loadAnalysis, DEFAULT_ANALYSIS_DIR} from './analysis.mjs';

export const AGREE_FILE = path.join(ROOT, 'eval/reports/current/three-datasets/spacy-agree.jsonl');
/** The agreement records of the default package (before the adoption of the accurate one): valid for a text whose tree did not change. */
export const DEFAULT_AGREE_FILE = path.join(ROOT, 'eval/reports/current/three-datasets/spacy-agree-default-v1.6.jsonl');

/** Stanza-shaped sentence ({words with start relative to the sentence}) from a compact analysis sentence, or null. */
export function sentenceOf(compact) {
  const words = [];
  let cursor = 0;
  for (const [id, form, lemma, upos, head, deprel] of compact.tokens) {
    const at = compact.text.indexOf(form, cursor);
    if (at < 0) return null;
    words.push({id, text: form, lemma, upos, head, deprel, start: at});
    cursor = at + form.length;
  }
  return {text: compact.text, start: 0, words};
}

export function loadAgreement() {
  const map = new Map();
  if (!fs.existsSync(AGREE_FILE)) return map;
  for (const line of fs.readFileSync(AGREE_FILE, 'utf8').split('\n')) if (line) { const r = JSON.parse(line); map.set(r.k, r); }
  return map;
}

/** Agreement records for every cache record that has an analysis and no record yet; appends to AGREE_FILE. */
export async function computeAgreement(cache, {onProgress = null} = {}) {
  if (spacyMissing()) throw Error(spacyMissing());
  const done = loadAgreement();
  let todo = [...cache.values()].filter(r => r.analysis && !done.has(r.k));
  if (!todo.length) return {added: 0};
  // A text whose Stanza tree is identical under the default and the current package keeps its recorded agreement.
  let reused = 0;
  if (fs.existsSync(DEFAULT_AGREE_FILE)) {
    const old = new Map(fs.readFileSync(DEFAULT_AGREE_FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.k, r]));
    const defaults = loadAnalysis(DEFAULT_ANALYSIS_DIR);
    const keep = [];
    for (const record of todo) {
      const before = defaults.get(record.k)?.analysis?.sentences, now = record.analysis.sentences;
      const same = before && old.has(record.k) && before.length === now.length && now.every((s, i) => compareSentence(before[i].tokens, s.tokens) === 'identical');
      if (same) { keep.push(JSON.stringify({k: record.k, agree: old.get(record.k).agree, detail: old.get(record.k).detail})); reused++; }
    }
    if (keep.length) { fs.mkdirSync(path.dirname(AGREE_FILE), {recursive: true}); fs.appendFileSync(AGREE_FILE, keep.join('\n') + '\n'); }
    const kept = new Set(keep.map(l => JSON.parse(l).k));
    todo = todo.filter(r => !kept.has(r.k));
  }
  if (!todo.length) return {added: 0, reused};
  const worker = new SpacyWorker({threads: 4});
  fs.mkdirSync(path.dirname(AGREE_FILE), {recursive: true});
  let added = 0;
  try {
    for (const record of todo) {
      let agree = true, detail = null;
      for (const compact of record.analysis.sentences) {
        const sentence = sentenceOf(compact);
        if (!sentence) { agree = null; detail = 'token offsets not recoverable'; break; }
        const tokens = await worker.parse(compact.text);
        const difference = coreDisagreement(sentence, tokens, 0);
        if (difference) { agree = false; detail = difference; break; }
      }
      fs.appendFileSync(AGREE_FILE, JSON.stringify({k: record.k, agree, detail}) + '\n');
      if (onProgress && ++added % 200 === 0) onProgress(added, todo.length);
    }
  } finally { await worker.stop(); }
  return {added: todo.length, reused};
}
