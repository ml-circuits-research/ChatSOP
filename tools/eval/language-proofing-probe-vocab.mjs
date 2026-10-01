#!/usr/bin/env node
/** Fresh vocabulary probe of LanguageProofingLLM production build 1 (experiment train-language-proofing-gemma270m-prod1).
 *
 *   node tools/eval/language-proofing-probe-vocab.mjs build
 *
 * Reads the LLM output of datasets_sources/language_proofing_prod1_vocab_probe (Grok, 54 items: 18 words x ro, mixed, noisy_en; sentences written AFTER the training data
 * was frozen) and writes eval/suites/bad_english/proofing-probe-vocab.jsonl: {id, prompt, target, kind: repair, language_kind, word, probe: 'fresh-vocab'}. A pair is kept when
 * its target contains the word (inflections allowed), prompt and target pass the mechanical meaning checks, and neither text occurs in a training or dev file of
 * datasets/bad_english/proofing-prod1 or in a sealed text (folded hashes). Rows are unreviewed; the word-kept metric undercounts valid paraphrases equally for every arm.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {hashText, pairProblems, countBy} from '../datasets/language-proofing/pairs.mjs';
import {TRAINED_TEN, HELD_OUT_V3} from '../datasets/language-proofing/vocab-it3.mjs';

const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const DIR = path.join(ROOT, 'datasets_sources/language_proofing_prod1_vocab_probe'), OUT = path.join(ROOT, 'eval/suites/bad_english/proofing-probe-vocab.jsonl');
const TABLE = {...TRAINED_TEN, ...HELD_OUT_V3};

export function build() {
  const seen = new Set();
  for (const f of ['train', 'dev', 'dev-backgen', 'dev-heldout', 'dev-vocab8', 'dev-vocab8-identity', 'dev-names', 'dev-typochild']) for (const r of readJsonl(path.join(ROOT, 'datasets/bad_english/proofing-prod1', `${f}.jsonl`))) { seen.add(hashText(r.prompt)); seen.add(hashText(r.target)); }
  const sealed = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/reports/current/language-proofing-prod1/data/sealed-hashes-union.json'), 'utf8')).hashes);
  const rows = [], drop = {no_word_in_target: 0, mechanical: 0, in_data_or_sealed: 0, duplicate: 0};
  const local = new Set();
  for (const line of readJsonl(path.join(DIR, 'output/verdicts.jsonl'))) {
    const [word, kind] = line.id.split(':');
    (line.answer?.pairs ?? []).forEach((p, i) => {
      const prompt = String(p.prompt ?? '').trim(), target = String(p.target ?? '').trim();
      if (!prompt || !target) return;
      if (!TABLE[word].test(target)) { drop.no_word_in_target++; return; }
      if (pairProblems(prompt, target).length) { drop.mechanical++; return; }
      if (seen.has(hashText(prompt)) || seen.has(hashText(target)) || sealed.has(hashText(prompt)) || sealed.has(hashText(target))) { drop.in_data_or_sealed++; return; }
      if (local.has(hashText(prompt)) || local.has(hashText(target))) { drop.duplicate++; return; }
      local.add(hashText(prompt)); local.add(hashText(target));
      rows.push({id: `vocab-fresh::${word}::${kind}::${i + 1}`, prompt, target, kind: 'repair', language_kind: kind, word, probe: 'fresh-vocab', target_source: 'llm:grok:fresh-probe', review_status: 'not_reviewed'});
    });
  }
  fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({file: path.relative(ROOT, OUT), rows: rows.length, dropped: drop, by_word: countBy(rows, r => r.word), by_kind: countBy(rows, r => r.language_kind)}, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { if (process.argv[2] === 'build') build(); else { console.error('usage: build'); process.exitCode = 2; } }
