#!/usr/bin/env node
/**
 * Extra evaluation cases for the rare types (multi_question, list, relative, subordinate): groups of sealed symbolic_english TEST sentences
 * (which keeps them sealed), tangled by DeepSeek into one sentence (omp folder datasets_sources/decomp_eval_tangle). The expected
 * decomposition is the group itself, certified by construction and re-certified by the pipeline.
 *   node tools/eval/decomposition/extras.mjs folder      build the groups and the omp folder
 *   node tools/eval/decomposition/extras.mjs verify      mechanical checks of the tangled sentences -> extra-candidates.jsonl
 */
import path from 'node:path';
import {sentencePoolOf, makeGroups} from '../../datasets/decomp-it3-groups.mjs';
import {readJsonlShardedSync} from '../../../lib/jsonl-shards.mjs';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {mechanicalMeaning} from '../../../lib/symbolic-lm/rewrite-gate.mjs';
import {WORK, readJsonl, writeJsonl} from './select.mjs';
import {makeFolder, loadAnswers} from './omp-folder.mjs';
import {TANGLE_SYSTEM} from './prompts.mjs';

const PLAN = [['multi_question', 60, 'multi_question', 2], ['list_coordination', 70, 'list', 3], ['relative', 45, 'relative', 2], ['subordinate', 45, 'subordinate', 2]];
const FORBID = /\b(he|she|they|him|her|them|his|their|it)\b/i;

export function folder(round = 1) {
  const first = round === 1 ? new Set() : new Set(readJsonl(path.join(WORK, 'extra-groups.jsonl')).flatMap(g => g.rows));
  const pool = sentencePoolOf(readJsonlShardedSync(path.join(ROOT, 'eval/suites/symbolic_english/test.jsonl'))).filter(r => !first.has(r.id)), groups = [];
  const plan = round === 1 ? PLAN : [['multi_question', 25, 'multi_question', 2], ['list_coordination', 60, 'list', 3], ['relative', 60, 'relative', 2], ['subordinate', 60, 'subordinate', 2]];
  for (const [style, count, , min] of plan) groups.push(...makeGroups(pool, {style, count, seed: `ev${round}`, min, max: 4, split: 'test', reuse: 1}).map(g => ({...g, id: `ev${round}-${g.id}`})));
  writeJsonl(path.join(WORK, round === 1 ? 'extra-groups.jsonl' : 'extra-groups-r2.jsonl'), groups);
  return makeFolder(round === 1 ? 'decomp_eval_tangle' : 'decomp_eval_tangle2', {system: TANGLE_SYSTEM, answerKey: 'text', title: 'tangle short sentence groups into one sentence (decomposition evaluation, rare types)', model: 'deepseek/deepseek-flash', items: groups.map(g => ({id: g.id, user: `style: ${g.style}\n${g.sentences.join('\n')}`}))});
}

export function verify() {
  const groups = [...readJsonl(path.join(WORK, 'extra-groups.jsonl')), ...readJsonl(path.join(WORK, 'extra-groups-r2.jsonl'))], answers = new Map([...loadAnswers('decomp_eval_tangle', 'text'), ...loadAnswers('decomp_eval_tangle2', 'text')]);
  const rows = [], dropped = {};
  const drop = w => { dropped[w] = (dropped[w] ?? 0) + 1; };
  for (const g of groups) {
    const text = String(answers.get(g.id)?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) { drop('empty'); continue; }
    if (!/[.?]$/.test(text) || /[.?!;].+[.?!;]/.test(text.replace(/\b\p{Lu}\./gu, ''))) { drop('not_one_sentence'); continue; }
    const joined = g.sentences.join(' ');
    if (text === joined || text.split(/\s+/).length > 70) { drop('same_or_long'); continue; }
    const m = mechanicalMeaning(joined, text), failed = ['names', 'numbers', 'negation', 'quantifiers', 'question'].filter(k => !m[k]);
    if (failed.length) { drop(`mechanical_${failed[0]}`); continue; }
    if (FORBID.test(text) && !FORBID.test(joined)) { drop('pronoun'); continue; }
    rows.push({id: g.id, source: 'symbolic_english/test (tangled)', type: g.style === 'list_coordination' ? 'list' : g.style, types: [g.style === 'list_coordination' ? 'list' : g.style], message: text, expected: g.sentences, expected_text: joined, clauses: g.sentences.length, rows: g.rows});
  }
  writeJsonl(path.join(WORK, 'extra-candidates.jsonl'), rows);
  return {kept: rows.length, dropped};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fn = {folder, folder2: () => folder(2), verify}[process.argv[2]];
  if (!fn) { console.error('usage: folder | folder2 | verify'); process.exit(2); }
  console.log(JSON.stringify(fn()));
}
