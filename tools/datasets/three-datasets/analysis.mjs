/** SymbolicLM analysis cache for the three datasets (owner decision 2026-09-30, DS008 "Three datasets").
 *
 * One record per distinct message text: the SOP SymbolicLM produced, whether it is valid, its unparsed spans and the
 * grammatical analysis (the UD parse per sentence, compact CoNLL-U-like). The cache is a set of JSONL files under
 * `eval/reports/current/three-datasets/analysis/` (regenerable observations, sharded by process so several CPU
 * workers can fill it). The call is the one of experiment eval-clean-english-v1: `route: 'direct'`, `language: 'auto'`,
 * no spelling correction, no rewrite. The Stanza package is the configured one (config/symbolic-lm.json; `accurate` after
 * the adoption of experiment eval-symbolic-accurate-adopt-v1): on the GPU (default when one is visible) the texts are
 * parsed in batches of 64 (`SymbolicLM.analyzeMany`), on the CPU one by one.
 * `analysis-default-v1.6/` keeps the analyses of the default package under rules v1.6 (the cache before the adoption):
 * the symbolic_english gate compares their trees with the current ones to reuse judge verdicts where the trees are equal.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';

export const ANALYSIS_DIR = path.join(ROOT, 'eval/reports/current/three-datasets/analysis');
export const DEFAULT_ANALYSIS_DIR = path.join(ROOT, 'eval/reports/current/three-datasets/analysis-default-v1.6');
export const textKey = text => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
const PART_BYTES = 30e6;

/** The stored record of one SymbolicLM result. */
export function recordOf(text, result) {
  const {parser, ...analysis} = result.analysis ?? {};
  return {
    k: textKey(text), sop: result.sop, valid: Boolean(result.valid), outcome: result.outcome, route: result.route, language: result.language,
    unparsed: (result.trace?.unparsed ?? []).map(u => u.span), uncertain: Boolean(result.uncertain), reasons: [...new Set((result.reasons ?? []).map(r => r.kind))],
    analysis: result.analysis ? analysis : null, parser: parser ?? null,
  };
}

/** Every record in the cache directory, keyed by text key. */
export function loadCache(dir = ANALYSIS_DIR) {
  const cache = new Map();
  if (!fs.existsSync(dir)) return cache;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (!line) continue;
      try { const record = JSON.parse(line); cache.set(record.k, record); } catch { /* a truncated last line of a killed worker */ }
    }
  }
  return cache;
}

/** Append-only writer of one shard; rolls over to a new part file at about 30 MB so no file nears the size limit. */
class ShardWriter {
  constructor(dir, shard) { Object.assign(this, {dir, shard, part: 0, bytes: 0}); fs.mkdirSync(dir, {recursive: true}); this.open(); }
  file() { return path.join(this.dir, `shard-${this.shard}.part-${String(this.part).padStart(3, '0')}.jsonl`); }
  open() { while (fs.existsSync(this.file()) && fs.statSync(this.file()).size >= PART_BYTES) this.part++; this.bytes = fs.existsSync(this.file()) ? fs.statSync(this.file()).size : 0; }
  write(record) {
    const line = JSON.stringify(record) + '\n';
    if (this.bytes + line.length > PART_BYTES) { this.part++; this.bytes = 0; }
    fs.appendFileSync(this.file(), line);
    this.bytes += line.length;
  }
}

/**
 * Analyse `texts` that are not cached yet, restricted to the ones whose key falls in shard `index` of `count`.
 * Results are appended to the shard's files as they arrive, so a killed run resumes where it stopped.
 */
export async function analyseTexts(texts, {shard = [0, 1], threads = 3, dir = ANALYSIS_DIR, device = process.env.CHATSOP_UD_DEVICE ?? 'auto', batch = 64, onProgress = null} = {}) {
  const {createSymbolicLM} = await import('../../../lib/symbolic-lm/index.mjs');
  const [index, count] = shard;
  const cache = loadCache(dir);
  const mine = [...new Set(texts)].filter(t => parseInt(textKey(t).slice(0, 8), 16) % count === index && !cache.has(textKey(t)));
  if (!mine.length) return {done: 0, todo: 0};
  const writer = new ShardWriter(dir, `${index}of${count}`);
  const lm = await createSymbolicLM({device, threads});
  const crash = (text, error) => ({k: textKey(text), sop: '', valid: false, outcome: 'crash', route: null, language: null, unparsed: [], uncertain: null, reasons: [], analysis: null, parser: null, error: String(error.message ?? error).slice(0, 200)});
  let done = 0;
  try {
    for (let i = 0; i < mine.length; i += batch) {
      const chunk = mine.slice(i, i + batch);
      let results;
      try { results = await lm.analyzeMany(chunk, {route: 'direct', language: 'auto'}); } catch { results = null; }
      for (let j = 0; j < chunk.length; j++) {
        let record;
        try { record = recordOf(chunk[j], results ? results[j] : await lm.analyze(chunk[j], {route: 'direct', language: 'auto'})); } catch (error) { record = crash(chunk[j], error); }
        writer.write(record);
        done++;
      }
      onProgress?.(done, mine.length);
    }
  } finally { await lm.stop(); }
  return {done, todo: mine.length};
}
