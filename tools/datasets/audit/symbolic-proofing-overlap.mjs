#!/usr/bin/env node
/** Sealed-overlap auditor of the SymbolicProofingLLM iteration-2 candidate units (a sealed auditor: eval/leakage.mjs SEALED_AUDITORS).
 *
 *   node tools/datasets/audit/symbolic-proofing-overlap.mjs [--in eval/reports/current/symbolic-proofing-it2/data/candidates.jsonl] [--min-words 2]
 *
 * It reads the sealed suites as a validator does (every `eval/suites/<dataset>` test, variant, composed and proofing-pair file) and writes one per-unit
 * verdict file (`leak-verdicts.json`, flagged ids with the reason) that the builder reads back; the builder never sees a sealed text. A unit is flagged when
 * any sentence of its prompt or target
 *   (a) equals a sealed sentence after folding (case, diacritics, punctuation, spacing), or
 *   (b) has the same content-word signature (light content words, at least --min-words) as a sealed sentence: the same CASE (names, nouns, verbs) even if a
 *       filler or a question frame differs (owner philosophy of 2026-09-30: a test may repeat a form, never duplicate a case).
 * Exit code 1 only on a broken input; the flags are the result.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {lightWords} from '../three-datasets/forms.mjs';
import {sentencesOf, foldWords} from '../symbolic-proofing-v2/units.mjs';

const FIELDS = ['message', 'target', 'prompt', 'expected_text', 'question', 'input', 'text'];
const FILES = ['test.jsonl', 'test-variants.jsonl', 'test-composed.jsonl', 'proofing-test.jsonl', 'proofing-test-clean.jsonl'];
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

export function sealedSentences() {
  const exact = new Set(), sig = new Map(), counts = {};
  const dir = path.join(ROOT, 'eval/suites');
  for (const suite of fs.readdirSync(dir)) for (const name of FILES) {
    const file = path.join(dir, suite, name);
    if (!jsonlExists(file)) continue;
    let n = 0;
    for (const row of readJsonlShardedSync(file)) for (const f of FIELDS) if (typeof row[f] === 'string') for (const s of sentencesOf(row[f])) {
      exact.add(foldWords(s));
      const words = lightWords(s);
      if (words.length >= 2) sig.set(words.join(' '), `${suite}/${name}`);
      n++;
    }
    counts[`${suite}/${name}`] = n;
  }
  return {exact, sig, counts};
}

function main() {
  const inFile = path.resolve(ROOT, opt('in', 'eval/reports/current/symbolic-proofing-it2/data/candidates.jsonl'));
  const minWords = Number(opt('min-words', 2));
  const {exact, sig, counts} = sealedSentences();
  const flagged = {}, byReason = {};
  const rows = fs.readFileSync(inFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const r of rows) {
    let why = null;
    for (const text of [r.prompt, r.target]) for (const s of sentencesOf(text)) {
      if (exact.has(foldWords(s))) why ??= 'exact_sentence';
      const words = lightWords(s);
      if (!why && words.length >= minWords && sig.has(words.join(' '))) why = 'content_words';
    }
    if (why) { flagged[r.id] = why; byReason[`${why}:${r.kind}:${r.origin}`] = (byReason[`${why}:${r.kind}:${r.origin}`] ?? 0) + 1; }
  }
  const report = {generated_at: new Date().toISOString(), units: rows.length, flagged_units: Object.keys(flagged).length, by_reason: byReason, sealed_sentences: counts, min_words: minWords, flagged};
  fs.writeFileSync(path.join(path.dirname(inFile), 'leak-verdicts.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify({units: rows.length, flagged_units: report.flagged_units, by_reason: byReason}, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
