/** Stanza `default_accurate` parses of the symbolic_english messages and their comparison with the stored default
 * analysis (experiment eval-symbolic-gate-v1, status/preregistrations/eval-symbolic-gate-v1.json).
 *
 * One record per distinct message text, keyed like the SymbolicLM analysis cache: the accurate tree per sentence in the
 * compact form of the dataset (`[id, form, lemma, upos, head, deprel]`), parsed from the same masked text SymbolicLM
 * parses (`maskMessage`) with the English pipeline forced. GPU, one worker (AGENTS.md rule 2). The records are
 * regenerable observations under eval/reports/current/three-datasets/accurate/.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {maskMessage} from '../../../lib/ud-to-sop/index.mjs';
import {textKey} from './analysis.mjs';
import {compareSentence} from '../../../lib/symbolic-lm/uncertainty.mjs';

export const ACCURATE_DIR = path.join(ROOT, 'eval/reports/current/three-datasets/accurate');
export const ACCURATE_MODEL = 'stanza-1.10.1/en:default_accurate(pos,depparse=combined_electra-large,lemma=combined_charlm,ner=ontonotes-ww-multi_electra-large)';
const PART_BYTES = 30e6;

export function loadAccurate(dir = ACCURATE_DIR) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (!line) continue;
      try { const r = JSON.parse(line); map.set(r.k, r); } catch { /* truncated last line of a killed worker */ }
    }
  }
  return map;
}

/** Parse `texts` (not cached yet) with the accurate package in batches; appends to the cache as results arrive. */
export async function parseAccurate(texts, {dir = ACCURATE_DIR, batch = 64, onProgress = null} = {}) {
  const {Worker} = await import('../../research/stanza-accurate-eval.mjs');
  const cache = loadAccurate(dir);
  const todo = [...new Set(texts)].filter(t => !cache.has(textKey(t)));
  if (!todo.length) return {done: 0, todo: 0};
  fs.mkdirSync(dir, {recursive: true});
  let part = 0;
  const file = () => path.join(dir, `parses.part-${String(part).padStart(3, '0')}.jsonl`);
  while (fs.existsSync(file()) && fs.statSync(file()).size >= PART_BYTES) part++;
  class EnglishWorker extends Worker {
    async parseEnglish(masked) {
      await this.start();
      return new Promise((resolve, reject) => { this.pending.push({resolve, reject}); this.child.stdin.write(JSON.stringify({id: 0, texts: masked, languages: masked.map(() => 'en')}) + '\n'); });
    }
  }
  const worker = new EnglishWorker({variant: 'accurate'});
  let done = 0;
  try {
    for (let i = 0; i < todo.length; i += batch) {
      const chunk = todo.slice(i, i + batch);
      const {parses, device} = await worker.parseEnglish(chunk.map(maskMessage));
      if (parses.length !== chunk.length) throw Error('worker returned a different number of parses');
      let out = '';
      chunk.forEach((text, j) => {
        const sentences = parses[j].sentences.map(s => ({text: s.text, start: s.start, end: s.end, tokens: s.words.map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel])}));
        out += JSON.stringify({k: textKey(text), model: ACCURATE_MODEL, device, sentences}) + '\n';
      });
      if (fs.existsSync(file()) && fs.statSync(file()).size + out.length > PART_BYTES) part++;
      fs.appendFileSync(file(), out);
      done += chunk.length;
      onProgress?.(done, todo.length);
    }
  } finally { await worker.stop(); }
  return {done, todo: todo.length};
}

// ------------------------------------------------------------------ comparison
export {compareSentence};

const WORST = {identical: 0, noncore_diff: 1, core_diff: 2};
/** `{row, sentences: [class...]}` for a stored default analysis and an accurate record, or null when there is no accurate record. */
export function compareAnalyses(defaultAnalysis, accurate) {
  if (!accurate) return null;
  const d = defaultAnalysis?.sentences ?? [], a = accurate.sentences ?? [];
  if (d.length !== a.length) return {row: 'core_diff', sentences: d.map(() => 'core_diff')};
  const sentences = d.map((s, i) => compareSentence(s.tokens, a[i].tokens));
  return {row: sentences.reduce((w, c) => (WORST[c] > WORST[w] ? c : w), 'identical'), sentences};
}
