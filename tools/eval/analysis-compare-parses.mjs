/** Parse provider of the analysis-compare metric (DS016 "Analysis comparison"): the grammatical analysis of each English
 * text, from the read-only SymbolicLM analysis cache of the three datasets, then from this tool's own cache
 * (`eval/reports/current/analysis-compare/parses/`), then by parsing the rest with SymbolicLM.analyzeMany (the configured Stanza package;
 * CPU by default so the GPU worker of a training or evaluation job is never disturbed; `--device cuda` opts in).
 * Returns a Map text -> compact analysis ({columns, language, sentences}) or null when the parse crashed.
 */
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {loadCache, analyseTexts, textKey, ANALYSIS_DIR} from '../datasets/three-datasets/analysis.mjs';

export const PARSES_DIR = path.join(ROOT, 'eval/reports/current/analysis-compare/parses');

export async function parseTexts(texts, {device = process.env.CHATSOP_UD_DEVICE_COMPARE ?? 'auto', threads = 3, dir = PARSES_DIR, batch = 32, onProgress = null, sharedDirs = [ANALYSIS_DIR]} = {}) {
  const unique = [...new Set(texts.map(String))];
  const caches = [...sharedDirs.map(d => loadCache(d)), loadCache(dir)];
  const find = text => { for (const c of caches) { const r = c.get(textKey(text)); if (r && r.analysis && r.parser) return r; } return null; };
  const missing = unique.filter(t => !find(t));
  let parsed = {done: 0, todo: 0};
  if (missing.length) {
    parsed = await analyseTexts(missing, {device, threads, dir, batch, onProgress});
    caches.pop(); caches.push(loadCache(dir));
  }
  const out = new Map();
  for (const t of unique) out.set(t, find(t)?.analysis ?? null);
  out.stats = {texts: unique.length, parsed: parsed.done, cached: unique.length - missing.length, device};
  return out;
}
