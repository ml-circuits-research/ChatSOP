#!/usr/bin/env node
/**
 * Input and output plumbing of the translate-compare study.
 *   prep-chunks                       -> in-chunks.jsonl {id: "<sentence id>@<k>", text}
 *   merge-chunks RAW ARM              -> arms/ARM.jsonl (chunks of a sentence joined with a space)
 *   prep-jargon [--listed FILE]       -> in-jargon.jsonl (quoted text) and jargon-spans.jsonl
 *   prep-spell                        -> in-spell.jsonl (LanguagesUtil symbolic spelling correction, lib/languages-util/spellfix.mjs, then nothing else)
 *   restore-jargon RAW ARM            -> arms/ARM.jsonl restored after translation (+ quote-retention fields)
 *   raw-to-arm RAW ARM                -> arms/ARM.jsonl straight from a raw MT output
 */
import fs from 'node:fs';
import path from 'node:path';
import {loadSpellfix} from '../../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../../sop/dictionary.mjs';
import {protectJargon, restoreJargon, discoverJargon} from '../../../lib/languages-util/jargon.mjs';
import {T, readJsonl, writeJsonl, sentences, armFile, chunkText} from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const val = k => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : null);
const rawPath = n => (fs.existsSync(n) ? n : path.join(T, 'arms', n));

if (cmd === 'prep-chunks') {
  const out = [];
  for (const s of sentences()) chunkText(s.text).forEach((c, k) => out.push({id: `${s.id}@${k}`, text: c}));
  writeJsonl(path.join(T, 'in-chunks.jsonl'), out);
  console.log(JSON.stringify({sentences: sentences().length, chunks: out.length}));
} else if (cmd === 'merge-chunks') {
  const raw = readJsonl(rawPath(rest[0])), by = new Map();
  for (const r of raw) { const [id, k] = r.id.split('@'); (by.get(id) ?? by.set(id, []).get(id)).push({k: Number(k), ...r}); }
  writeJsonl(armFile(rest[1]), sentences().map(s => { const cs = (by.get(s.id) ?? []).sort((a, b) => a.k - b.k); return {id: s.id, out: cs.map(c => c.out).join(' '), ms: cs.reduce((a, c) => a + c.ms, 0), chunks: cs.length}; }));
} else if (cmd === 'raw-to-arm') {
  writeJsonl(armFile(rest[1]), readJsonl(rawPath(rest[0])).map(r => ({id: r.id, out: r.out, ms: r.ms})));
} else if (cmd === 'prep-spell') {
  const spellfix = loadSpellfix();
  writeJsonl(path.join(T, 'in-spell.jsonl'), sentences().map(s => ({id: s.id, text: spellfix.fix(s.text).text})));
} else if (cmd === 'prep-jargon') {
  const spellfix = loadSpellfix(), dictionary = defaultDictionary();
  const spell = rest.includes('--spell');
  const listedFile = val('--listed');
  const listed = listedFile ? new Set(fs.readFileSync(listedFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))) : null;
  const rows = sentences(), ins = [], spans = [];
  for (const s of rows) { const p = protectJargon(spell ? spellfix.fix(s.text).text : s.text, {spellfix, dictionary, listed}); ins.push({id: s.id, text: p.text}); spans.push({id: s.id, spans: p.spans}); }
  const suffix = (spell ? '-spell' : '') + (listed ? '-listed' : '');
  writeJsonl(path.join(T, `in-jargon${suffix}.jsonl`), ins); writeJsonl(path.join(T, `jargon-spans${suffix}.jsonl`), spans);
  console.log(JSON.stringify({sentences: rows.length, with_spans: spans.filter(x => x.spans.length).length, spans: spans.reduce((a, x) => a + x.spans.length, 0)}));
} else if (cmd === 'restore-jargon') {
  const suffix = (rest.includes('--spell') ? '-spell' : '') + (val('--listed') ? '-listed' : '');
  const spans = new Map(readJsonl(path.join(T, `jargon-spans${suffix}.jsonl`)).map(r => [r.id, r.spans]));
  const raw = readJsonl(rawPath(rest[0]));
  writeJsonl(armFile(rest[1]), raw.map(r => { const sp = spans.get(r.id) ?? []; const x = restoreJargon(r.out, sp); return {id: r.id, out: x.text, raw: r.out, ms: r.ms, spans: sp.length, kept: x.kept, quotes: x.quotes, restored: x.restored}; }));
} else if (cmd === 'discover') {
  const spellfix = loadSpellfix();
  const texts = [...new Map(sentences().map(s => [s.msg, s.text])).values()];
  writeJsonl(path.join(T, 'jargon-discovered.jsonl'), discoverJargon(sentences().map(s => s.text), {spellfix}));
} else { console.error('usage: prep-chunks | merge-chunks RAW ARM | prep-jargon [--listed FILE] | restore-jargon RAW ARM | raw-to-arm RAW ARM | discover'); process.exit(2); }
