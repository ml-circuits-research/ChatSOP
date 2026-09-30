/** SymbolicLM access of the composed evaluation: one started instance, a persistent cache of results by text.
 *
 * `run(text)` analyses a message the way production does (`route: direct`, language auto) and returns the fields the scorers
 * need; results are cached in eval/reports/current/composed-eval/cache/lm-<stanza model id hash>.jsonl so a re-run only parses
 * new texts. The cache is regenerable (a changed rules version changes the key through the recorded `rules` field).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createSymbolicLM, stanzaModelId} from '../../../lib/symbolic-lm/index.mjs';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {rulesVersion} from './rules-version.mjs';

export async function openLm({cacheDir = path.join(ROOT, 'eval/reports/current/composed-eval/cache'), useCache = true} = {}) {
  const lm = await createSymbolicLM();
  const id = `${stanzaModelId()}|${rulesVersion()}`;
  const file = path.join(cacheDir, `lm-${createHash('sha1').update(id).digest('hex').slice(0, 10)}.jsonl`);
  const cache = new Map();
  if (useCache && fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line.trim()) { const r = JSON.parse(line); cache.set(r.text, r); }
  fs.mkdirSync(cacheDir, {recursive: true});
  const fd = useCache ? fs.openSync(file, 'a') : null;
  const run = async text => {
    if (cache.has(text)) return cache.get(text);
    let record;
    try {
      const r = await lm.analyze(text, {route: 'direct', language: 'auto'});
      record = {text, sop: r.sop, valid: Boolean(r.valid), outcome: r.outcome, uncertain: Boolean(r.uncertain), reasons: r.reasons ?? [], unparsed: (r.trace?.unparsed ?? []).map(u => u.span), sentences: (r.analysis?.sentences ?? []).map(s => ({text: s.text, start: s.start, end: s.end, tokens: s.tokens}))};
    } catch (error) { record = {text, sop: '', valid: false, outcome: 'crash', uncertain: true, reasons: [], unparsed: [], sentences: [], error: String(error.message ?? error).slice(0, 200)}; }
    cache.set(text, record);
    if (fd !== null) fs.writeSync(fd, JSON.stringify(record) + '\n');
    return record;
  };
  return {lm, run, id, cacheFile: file, close: async () => { if (fd !== null) fs.closeSync(fd); await lm.stop?.(); await lm.close?.(); }};
}

/** Whether SymbolicLM handled a message without doubt: a valid converted SOP, no unparsed span, not flagged uncertain. */
export const handled = r => r.valid && r.outcome === 'converted' && !r.unparsed.length && !r.uncertain;
