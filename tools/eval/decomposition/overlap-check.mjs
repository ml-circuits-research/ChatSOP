#!/usr/bin/env node
/**
 * Sealed-overlap checker for the iteration-3 decomposition data (an evaluation-side tool: it opens the sealed suites as the auditors do; the
 * generators under tools/datasets never do). A candidate is flagged when any sentence of its tangled prompt or target equals a sealed sentence after
 * folding, or has the same content-word signature as a sealed sentence (the same case, as in tools/datasets/audit/symbolic-proofing-overlap.mjs).
 * The sealed suites include eval/suites/decomposition (the decomposition evaluation set), so training data can never repeat an evaluation case.
 *   node tools/eval/decomposition/overlap-check.mjs     reads it3/certified.jsonl, writes it3/leak-verdicts.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {sealedSentences} from '../../datasets/audit/symbolic-proofing-overlap.mjs';
import {lightWords} from '../../datasets/three-datasets/forms.mjs';
import {sentencesOf, foldWords} from '../../datasets/symbolic-proofing-v2/units.mjs';
import {WORK, readJsonl} from './io.mjs';

export function check(rows) {
  const {exact, sig, counts} = sealedSentences();
  const flagged = {}, by = {};
  for (const r of rows) {
    let why = null;
    for (const text of [r.tangled, r.target]) for (const s of sentencesOf(text)) {
      if (exact.has(foldWords(s))) why ??= 'exact_sentence';
      const words = lightWords(s);
      if (!why && words.length >= 2 && sig.has(words.join(' '))) why = 'content_words';
    }
    if (why) { flagged[r.id] = why; by[why] = (by[why] ?? 0) + 1; }
  }
  return {flagged, by_reason: by, sealed_sentences: counts};
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rows = readJsonl(path.join(WORK, 'it3/certified.jsonl'));
  const report = {generated_at: new Date().toISOString(), units: rows.length, ...check(rows)};
  report.flagged_units = Object.keys(report.flagged).length;
  fs.writeFileSync(path.join(WORK, 'it3/leak-verdicts.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify({units: rows.length, flagged_units: report.flagged_units, by_reason: report.by_reason}));
}
