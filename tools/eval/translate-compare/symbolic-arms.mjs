#!/usr/bin/env node
/**
 * Symbolic arms of the translate-compare study: TranslatorService `symbolic` (lm.toEnglish) and `gloss` (glossMessage), one sentence at a time, CPU.
 *   node tools/eval/translate-compare/symbolic-arms.mjs [--spell] [--limit N] [--in FILE] [--suffix NAME]
 * Reads eval/reports/current/translate-compare/sentences.jsonl (or --in {id,text}), writes arms/symbolic<suffix>.jsonl and arms/gloss<suffix>.jsonl {id, out, ms}.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {createSymbolicLM} from '../../../lib/symbolic-lm/index.mjs';
import {glossMessage} from '../../../lib/translator-service/index.mjs';

const T = path.join(ROOT, 'eval/reports/current/translate-compare');
const args = process.argv.slice(2), has = k => args.includes(k), val = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const rows = fs.readFileSync(val('--in') ?? path.join(T, 'sentences.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).slice(0, val('--limit') ? Number(val('--limit')) : undefined);
const spell = has('--spell'), suffix = val('--suffix') ?? '';
const lm = await createSymbolicLM({device: 'cpu'});
const sym = [], gloss = [];
try {
  for (const r of rows) {
    let t = performance.now();
    try { const e = await lm.toEnglish(r.text, {spell}); sym.push({id: r.id, out: e.text, ms: performance.now() - t, untranslated: (e.untranslated ?? []).map(u => u.word ?? u)}); }
    catch (error) { sym.push({id: r.id, out: '', ms: performance.now() - t, error: String(error.message).slice(0, 200)}); }
    t = performance.now();
    try { const g = await glossMessage(lm, r.text, {spell}); gloss.push({id: r.id, out: g.text, ms: performance.now() - t}); }
    catch (error) { gloss.push({id: r.id, out: '', ms: performance.now() - t, error: String(error.message).slice(0, 200)}); }
  }
} finally { await lm.stop(); }
const w = (n, a) => fs.writeFileSync(path.join(T, `arms/${n}${suffix}.jsonl`), a.map(x => JSON.stringify(x)).join('\n') + '\n');
w('symbolic', sym); w('gloss', gloss);
console.log(JSON.stringify({rows: rows.length, symbolic_errors: sym.filter(x => x.error).length, gloss_errors: gloss.filter(x => x.error).length}));
process.exit(0);
