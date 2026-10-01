#!/usr/bin/env node
/**
 * Do translators keep quoted jargon spans intact? (translate-compare study.) For each quoted arm: the spans the detector protected, how many survive verbatim
 * (whole-token, case-insensitive) in the translator's raw output with the quotes in place, against the same spans in the same translator's UNQUOTED output
 * (the baseline: the translator keeps them without help), by detector reason; and the share of sentences whose quote count equals the span count (restorable).
 *   node tools/eval/translate-compare/jargon-metrics.mjs [--messages 60]
 */
import fs from 'node:fs';
import path from 'node:path';
import {hasSpan} from '../../../lib/languages-util/jargon.mjs';
import {T, readJsonl, readArm, sentences} from './lib.mjs';

const lim = process.argv.includes('--messages') ? Number(process.argv[process.argv.indexOf('--messages') + 1]) : Infinity;
const ARMS = [
  ['opus-romance-jargon', 'opus-romance', 'jargon-spans.jsonl'], ['opus-romance-jargonlisted', 'opus-romance', 'jargon-spans-listed.jsonl'],
  ['opus-biblebig-jargon', 'opus-biblebig', 'jargon-spans.jsonl'], ['opus-biblebig-spell-jargon', 'opus-biblebig-spell', 'jargon-spans-spell.jsonl'],
  ['prod1-jargon', 'prod1', 'jargon-spans.jsonl'], ['opus-romance-jargon+prod1', 'opus-romance+prod1', 'jargon-spans.jsonl'],
  ['qwen3-1.7b-jargon', 'qwen3-1.7b', 'jargon-spans.jsonl'], ['qwen3-4b-jargon', 'qwen3-4b', 'jargon-spans.jsonl'],
];
const ids = new Set(sentences().filter(s => s.mi < lim).map(s => s.id));
const rows = [];
for (const [arm, base, spansFile] of ARMS) {
  if (!fs.existsSync(path.join(T, 'arms', `${arm}.jsonl`))) continue;
  const q = readArm(arm), b = readArm(base), spans = new Map(readJsonl(path.join(T, spansFile)).map(r => [r.id, r.spans]));
  const byReason = {};
  let sentencesWith = 0, total = 0, keptQ = 0, keptB = 0, restorable = 0, anyQuote = 0, n = 0;
  for (const id of ids) {
    const sp = spans.get(id) ?? [], r = q.get(id), br = b.get(id);
    if (!sp.length || !r || !br) continue;
    n++; sentencesWith++;
    const raw = r.raw ?? r.out; // restored arms keep the translator's own text in `raw`
    const quotes = [...raw.matchAll(/["“„]([^"”“„]{1,200})["”]/g)].length;
    if (quotes === sp.length) restorable++;
    if (quotes) anyQuote++;
    for (const s of sp) {
      total++;
      const kq = hasSpan(raw, s.text), kb = hasSpan(br.out, s.text);
      if (kq) keptQ++; if (kb) keptB++;
      const x = byReason[s.reason] ??= {spans: 0, quoted_kept: 0, baseline_kept: 0};
      x.spans++; if (kq) x.quoted_kept++; if (kb) x.baseline_kept++;
    }
  }
  rows.push({arm, baseline: base, sentences_with_spans: sentencesWith, spans: total, quoted_kept: keptQ, baseline_kept: keptB, quote_count_matches: restorable, any_quote: anyQuote, by_reason: byReason});
}
fs.writeFileSync(path.join(T, `jargon-metrics${Number.isFinite(lim) ? '-' + lim : ''}.json`), JSON.stringify(rows, null, 1) + '\n');
const p = (k, n) => (n ? `${(100 * k / n).toFixed(0)}%` : 'n/a');
console.log('| quoted arm | sentences with spans | spans | kept verbatim, quoted | kept verbatim, unquoted baseline | quote count matches span count |\n| --- | ---: | ---: | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.arm} | ${r.sentences_with_spans} | ${r.spans} | ${r.quoted_kept} (${p(r.quoted_kept, r.spans)}) | ${r.baseline_kept} (${p(r.baseline_kept, r.spans)}) | ${r.quote_count_matches} (${p(r.quote_count_matches, r.sentences_with_spans)}) |`);
console.log('\nby detector reason (quoted kept / unquoted kept of spans):');
for (const r of rows) console.log(r.arm, Object.entries(r.by_reason).map(([k, v]) => `${k} ${v.quoted_kept}/${v.baseline_kept} of ${v.spans}`).join('; '));
