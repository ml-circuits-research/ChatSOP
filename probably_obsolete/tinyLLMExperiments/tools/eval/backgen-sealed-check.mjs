#!/usr/bin/env node
/** Sealed-overlap check of the back-generated pair source datasets/neuro_english/proofing-backgen (a sealed auditor like
 * tools/datasets/audit/proofing-overlap.mjs: it reads the sealed test files, so it lives under tools/eval/; the builder
 * tools/datasets/backgen-proofing.mjs only reads the ids this report writes).
 *
 *   node tools/eval/backgen-sealed-check.mjs
 *
 * Reads every `eval/suites/**\/test*.jsonl` (texts of message, question, prompt and target fields) and compares, after
 * folding (case, diacritics, punctuation, spacing), the prompt and the target of every pair with them. Also counts the repair
 * prompts whose content-word set (words of more than 3 letters, stop words removed, at least 4 words) equals that of a sealed
 * message (information only: templated synthetic text repeats content words by design). Writes
 * eval/reports/current/backgen/sealed-matches.json: the pair ids with an exact match (the builder drops them) and the counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, readJsonl} from '../datasets/neuro-oracle/common.mjs';
import {normalText} from '../datasets/three-datasets/inputs.mjs';

const STOP = new Set('the a an is are was were do does did can could you me tell whether if that who what where when why how of to in at on for by with and or not it he she they his her their there this know check question quick honestly please just about any idea'.split(' '));
const sig = t => { const s = normalText(t).split(' ').filter(w => w.length > 3 && !STOP.has(w)); return s.length >= 4 ? [...new Set(s)].sort().join(' ') : null; };
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(path.join(ROOT, 'eval/suites')).filter(f => /test[^/]*\.jsonl$/.test(f));
const exact = new Map(), sigs = new Set();
for (const f of files) for (const row of readJsonl(f)) for (const k of ['message', 'question', 'prompt', 'target']) {
  const t = row[k];
  if (typeof t !== 'string' || !t) continue;
  const n = normalText(t);
  if (!exact.has(n)) exact.set(n, new Set());
  exact.get(n).add(path.relative(path.join(ROOT, 'eval/suites'), f) + ':' + k);
  if (k !== 'target') { const s = sig(t); if (s) sigs.add(s); }
}
const ids = [], byFile = {}; let contentWordSets = 0;
const dir = path.join(ROOT, 'datasets/neuro_english/proofing-backgen');
for (const split of ['train', 'dev']) for (const r of readJsonl(path.join(dir, `${split}.jsonl`))) {
  let hit = false;
  for (const k of ['prompt', 'target']) { const where = exact.get(normalText(r[k])); if (where) { hit = true; for (const w of where) byFile[`${k}~${w}`] = (byFile[`${k}~${w}`] ?? 0) + 1; } }
  if (hit) ids.push(r.id);
  if (r.kind === 'repair' && sigs.has(sig(r.prompt))) contentWordSets++;
}
const report = {generated_at: new Date().toISOString(), sealed_files: files.length, sealed_texts: exact.size, pairs_with_exact_match: ids.length, repair_prompts_with_identical_content_word_set: contentWordSets, matches_by_pair_field_and_sealed_field: byFile, ids};
fs.mkdirSync(path.join(ROOT, 'eval/reports/current/backgen'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'eval/reports/current/backgen/sealed-matches.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({...report, ids: undefined, matches_by_pair_field_and_sealed_field: byFile}, null, 1));
