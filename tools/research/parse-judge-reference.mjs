#!/usr/bin/env node
/** Builds the reference set of eval-parse-judge-haiku-v1: the 513 sentences whose stronger-judge (Fable) verdict exists
 * (5 adjudication batches + the 80-sentence blind calibration of eval-symbolic-layers-en-v1), each with its Stanza
 * analysis, flagged clean_en when its message is in the sealed clean-English partition (tools/datasets/clean-english.mjs).
 *   node tools/research/parse-judge-reference.mjs   -> eval/reports/current/parse-judge/reference.jsonl
 */
import fs from 'node:fs';
const D = 'eval/reports/current/symbolic-layers/';
const rl = f => fs.readFileSync(f, 'utf8').split('\n').filter(x => x.trim()).map(JSON.parse);
const clean = new Set(rl('eval/suites/clean-english/test.jsonl').map(r => r.source_id));
const ref = new Map();
for (let i = 1; i <= 5; i++) for (const r of rl(D + `calibration/adjudicate-${i}.fable.jsonl`)) ref.set(r.key, {ref: r.verdict, ref_batch: 'adjudicate-' + i, ref_note: r.note});
for (const r of rl(D + 'calibration/fable.jsonl')) ref.set(r.key, {ref: r.verdict, ref_batch: 'calibration', ref_note: r.note});
const prior = new Map(rl(D + 'judgments.jsonl').map(j => [j.key, j]));
const parses = new Map(rl(D + 'parses.jsonl').map(p => [p.id, p.parse]));
const out = [];
for (const s of rl(D + 'sentences.jsonl')) {
  if (!ref.has(s.key)) continue;
  const sent = parses.get(s.id).sentences[s.index];
  const pj = prior.get(s.key);
  out.push({id: s.key, message_id: s.id, source: s.source, qgroup: s.qgroup, length: s.length, clean_en: clean.has(s.id), message: s.text,
    analysis: {text: s.text, words: sent.words}, ...ref.get(s.key), prior_haiku: pj?.first?.verdict ?? null, prior_haiku_final: pj?.judge?.verdict ?? null});
}
fs.mkdirSync('eval/reports/current/parse-judge', {recursive: true});
fs.writeFileSync('eval/reports/current/parse-judge/reference.jsonl', out.map(r => JSON.stringify(r)).join('\n') + '\n');
const count = (rows, k) => rows.reduce((a, r) => ({...a, [r[k]]: (a[r[k]] ?? 0) + 1}), {});
console.log(out.length, 'clean', out.filter(r => r.clean_en).length, count(out.filter(r => r.clean_en), 'ref'), count(out.filter(r => r.clean_en), 'ref_batch'), count(out.filter(r => r.clean_en), 'prior_haiku'));
