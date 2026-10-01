#!/usr/bin/env node
/**
 * Candidate selection of the decomposition evaluation (eval-decomposition-v1): tangled, uncertified clean-English messages of the
 * sealed neuro_english test, typed by tools/eval/decomposition/tangle.mjs from the stored analysis, stratified (oversampled before
 * the generation, verification and judging gates thin them out). Output: eval/reports/current/decomposition/candidates.jsonl.
 *   node tools/eval/decomposition/select.mjs [--seed 1]
 */
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {tangleOf, TANGLE_TYPES} from './tangle.mjs';

import {WORK, readJsonl, writeJsonl} from './io.mjs';
export {WORK, readJsonl, writeJsonl};
const rank = (seed, id) => createHash('sha1').update(`${seed}|${id}`).digest('hex');
// oversampling quota per primary type (all of a rare type, a share of the large ones)
export const QUOTA = {multi_question: 60, list: 80, run_on: 100, coordination: 110, subordinate: 110, relative: 100, completive: 140};

export function select({seed = 'decomp-1', source = 'eval/suites/neuro_english/test.jsonl', exclude = new Set(), quota = QUOTA} = {}) {
  const rows = readJsonl(path.join(ROOT, source));
  const pool = Object.fromEntries(TANGLE_TYPES.map(t => [t, []]));
  for (const r of rows) {
    if (r.analysis.sentences.length > 3 || r.message.length > 320 || r.message.length < 25) continue;
    if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\n]/u.test(r.message)) continue; // Latin script only (diacritics occur in names)
    const t = tangleOf(r.analysis);
    if (!t.tangled || !t.primary || exclude.has(r.id)) continue;
    pool[t.primary].push({id: r.id, message: r.message, source_split: r.split, split_group_id: r.split_group_id, failure_kind: r.failure_kind ?? null, analysis_verified: r.analysis_verified ?? null,
      type: t.primary, types: t.types, clauses: t.clauses, questions: t.questions, words: t.words, counts: t.counts});
  }
  const out = [];
  for (const type of TANGLE_TYPES) out.push(...pool[type].sort((a, b) => (rank(seed, a.id) < rank(seed, b.id) ? -1 : 1)).slice(0, quota[type]));
  return {rows: out, available: Object.fromEntries(TANGLE_TYPES.map(t => [t, pool[t].length]))};
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'round3') {
  // third round: the Latin-script rows that the first filter (ASCII only) left out because of diacritics in names
  const taken = new Set([...readJsonl(path.join(WORK, 'candidates.jsonl')), ...readJsonl(path.join(WORK, 'candidates-r2.jsonl'))].map(r => r.id));
  const {rows} = select({exclude: taken, quota: Object.fromEntries(TANGLE_TYPES.map(t => [t, 1000]))});
  writeJsonl(path.join(WORK, 'candidates-r3.jsonl'), rows);
  console.log(JSON.stringify({round3: rows.length, by_type: Object.fromEntries(TANGLE_TYPES.map(t => [t, rows.filter(r => r.type === t).length]))}));
} else if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'round2') {
  // second round: every tangled neuro_english test candidate not taken in the first round (the first round did not yield enough verified cases)
  const first = new Set(readJsonl(path.join(WORK, 'candidates.jsonl')).map(r => r.id));
  const {rows} = select({exclude: first, quota: Object.fromEntries(TANGLE_TYPES.map(t => [t, 1000]))});
  writeJsonl(path.join(WORK, 'candidates-r2.jsonl'), rows);
  console.log(JSON.stringify({round2: rows.length, by_type: Object.fromEntries(TANGLE_TYPES.map(t => [t, rows.filter(r => r.type === t).length]))}));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const {rows, available} = select();
  writeJsonl(path.join(WORK, 'candidates.jsonl'), rows);
  console.log(JSON.stringify({candidates: rows.length, available, taken: Object.fromEntries(TANGLE_TYPES.map(t => [t, rows.filter(r => r.type === t).length]))}));
}
