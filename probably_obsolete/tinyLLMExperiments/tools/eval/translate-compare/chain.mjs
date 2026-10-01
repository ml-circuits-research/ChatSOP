#!/usr/bin/env node
/**
 * LanguageProofingLLM (prod1) over the text of another arm: the "translator, then prod1" chains and "prod1 on quoted input" of the translate-compare study.
 *   node tools/eval/translate-compare/chain.mjs --endpoint URL --from ARM|in:FILE --to ARM [--spans FILE]
 * `--from ARM` reads arms/ARM.jsonl `out`; `--from raw:NAME` reads arms/NAME.raw.jsonl (a translator's output with its quotes still in place); `--from in:FILE` reads {id, text} (for example in-jargon.jsonl). With `--spans FILE` the quote-restoration of
 * tools/eval/translate-compare/jargon.mjs is applied to the cleaned text. One sentence per model call (the chat's `sendAll`), CPU endpoint, results cached in arms/.
 */
import fs from 'node:fs';
import path from 'node:path';
import {textToCleanEnglish} from '../../../lib/text-to-clean-english/index.mjs';
import {restoreJargon} from './jargon.mjs';
import {T, readJsonl, writeJsonl, readArm, armFile, items} from './lib.mjs';

const a = process.argv.slice(2), val = k => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
const endpoint = val('--endpoint'), from = val('--from'), to = val('--to'), spansFile = val('--spans');
if (!endpoint || !from || !to) { console.error('usage: --endpoint URL --from ARM|in:FILE --to ARM [--spans FILE]'); process.exit(2); }
const src = from.startsWith('raw:') ? new Map(readJsonl(path.join(T, 'arms', `${from.slice(4)}.raw.jsonl`)).map(r => [r.id, {out: r.out, ms: r.ms}])) : from.startsWith('in:') ? new Map(readJsonl(path.join(T, from.slice(3))).map(r => [r.id, {out: r.text}])) : readArm(from);
const spans = spansFile ? new Map(readJsonl(path.join(T, spansFile)).map(r => [r.id, r.spans])) : null;
const rows = [];
for (const s of items(val('--in'))) {
  const text = src.get(s.id)?.out ?? '';
  const t0 = performance.now();
  let clean = text, error = null;
  try { if (text.trim()) clean = (await textToCleanEnglish(text, {backendOptions: {endpoint}, partial: true})).clean; } catch (e) { error = String(e.message).slice(0, 120); }
  const ms = performance.now() - t0 + (src.get(s.id)?.ms ?? 0);
  const row = {id: s.id, out: clean, input: text, ms, ms_clean: performance.now() - t0};
  if (spans) { const sp = spans.get(s.id) ?? []; const x = restoreJargon(clean, sp); Object.assign(row, {raw: clean, out: x.text, spans: sp.length, kept: x.kept, quotes: x.quotes, restored: x.restored}); }
  if (error) row.error = error;
  rows.push(row);
  if (rows.length % 100 === 0) console.log(rows.length);
}
writeJsonl(armFile(to), rows);
console.log(JSON.stringify({rows: rows.length, errors: rows.filter(r => r.error).length}));
process.exit(0);
