/** Shared helpers of the translate-compare study (eval/reports/current/translate-compare/, 2026-10-01): sentence list, arm files, chunking of long sentences. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';

export const T = path.join(ROOT, 'eval/reports/current/translate-compare');
export const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
export const sentences = () => readJsonl(path.join(T, 'sentences.jsonl'));
export const armFile = name => path.join(T, 'arms', `${name}.jsonl`);
export const readArm = name => new Map(readJsonl(armFile(name)).map(r => [r.id, r]));
export const wordCount = t => (String(t).match(/[\p{L}\p{N}']+/gu) ?? []).length;
export const armNames = () => fs.readdirSync(path.join(T, 'arms')).filter(n => n.endsWith('.jsonl') && !n.includes('.raw.') && !n.startsWith('probe-')).map(n => n.replace(/\.jsonl$/, ''));

/**
 * Split a long unpunctuated Romanian run-on into chunks of at most `max` words, at commas first, then at conjunctions
 * (si, dar, iar, ca sa, pentru ca, care, sau, ca) and last at the word limit. Chunks shorter than `min` words are merged forward.
 */
export function chunkText(text, max = 22, min = 5) {
  const words = String(text).trim().split(/\s+/);
  if (words.length <= max) return [String(text).trim()];
  const breakAfter = i => /[,;:]$/.test(words[i]);
  const breakBefore = i => /^(?:si|dar|iar|ca|care|sau|pentru|insa|deci|desi|daca|cind|cand|unde|deoarece|astfel)$/i.test(words[i]);
  const out = [];
  let start = 0;
  while (words.length - start > max) {
    let cut = -1;
    for (let i = start + max - 1; i >= start + min; i--) if (breakAfter(i)) { cut = i + 1; break; }
    if (cut < 0) for (let i = start + max - 1; i >= start + min; i--) if (breakBefore(i)) { cut = i; break; }
    if (cut < 0) cut = start + max;
    out.push(words.slice(start, cut).join(' '));
    start = cut;
  }
  if (start < words.length) out.push(words.slice(start).join(' '));
  return out;
}

/** The unit list: the study sentences, or the rows of `--in FILE` ({id, text}) under eval/reports/current/translate-compare/ (the jargon probe). */
export const items = file => (file ? readJsonl(path.join(T, file)) : sentences());
