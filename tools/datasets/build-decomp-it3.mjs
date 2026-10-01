#!/usr/bin/env node
/**
 * Targeted training data for SymbolicProofingLLM iteration 3 (decomposition of tangled sentences): groups -> omp tangle folders -> collected pairs.
 * Reverse direction: a certified multi-sentence group (sentences of symbolic_english train/dev rows) is tangled by DeepSeek into ONE sentence; the
 * pair is (tangled -> the group's sentences, unchanged), so every target sentence is certified by construction. Partial-acceptance pairs
 * carry exactly one uncertified neuro_english sentence which the target keeps verbatim. Nothing here trains or calls a local model.
 *   node tools/datasets/build-decomp-it3.mjs groups     build the groups of every style and split and the omp folders (datasets_sources/decomp_it3_<style>)
 *   node tools/datasets/build-decomp-it3.mjs collect    mechanical checks of the tangled sentences -> eval/reports/current/decomposition/it3/candidates.jsonl
 *   (judge, certify, build: see tools/datasets/build-decomp-it3-final.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {mechanicalMeaning} from '../../lib/symbolic-lm/rewrite-gate.mjs';
import {sentencePool, neuroPool, proofingPool, makeGroups, partialGroups} from './decomp-it3-groups.mjs';
import {makeFolder, loadAnswers} from '../eval/decomposition/omp-folder.mjs';
import {TANGLE_SYSTEM} from '../eval/decomposition/prompts.mjs';
import {readJsonl, writeJsonl} from '../eval/decomposition/io.mjs';

export const WORK = path.join(ROOT, 'eval/reports/current/decomposition/it3');
// [folder suffix, styles, per split counts {train, dev}, min, max]
const PLAN = [
  ['subordinate', [['subordinate', 1500, 120], ['relative', 1400, 120]], 3, 5],
  ['list', [['list_coordination', 1800, 150], ['multi_question', 500, 40]], 2, 5],
];
const FORBID = /\b(he|she|they|him|her|them|his|their|it)\b/i;
const CONNECTIVES = /\b(because|so|then|after|before|while|although|though|since|unless|but|however|therefore|if|when|until)\b/gi;

export function groups() {
  const out = {};
  for (const split of ['train', 'dev']) {
    const pool = sentencePool(split), all = [];
    for (const [folder, styles, min, max] of PLAN) for (const [style, train, dev] of styles) {
      const count = split === 'train' ? train : dev;
      all.push(...makeGroups(pool, {style, count, seed: `it3-${split}`, min: style === 'multi_question' ? 2 : min, max, reuse: split === 'train' ? 4 : 3, split}));
    }
    all.push(...partialGroups(pool, neuroPool(split), {count: split === 'train' ? 700 : 60, seed: `it3-${split}`, split}));
    out[split] = all;
  }
  const flat = [...out.train, ...out.dev];
  writeJsonl(path.join(WORK, 'groups.jsonl'), flat);
  const folders = {};
  // subordinate-style (subordinate, relative) and list-style (list_coordination, multi_question) folders; partial groups go with their own style
  for (const [suffix, pred] of [['subordinate', g => ['subordinate', 'relative'].includes(g.style) && !g.partial], ['list', g => ['list_coordination', 'multi_question'].includes(g.style) && !g.partial], ['partial', g => g.partial]]) {
    const items = flat.filter(pred);
    folders[suffix] = makeFolder(`decomp_it3_${suffix}`, {system: TANGLE_SYSTEM, answerKey: 'text', title: 'tangle short sentence groups into one sentence (SymbolicProofingLLM iteration 3 decomposition data)', model: 'deepseek/deepseek-flash', items: items.map(g => ({id: g.id, user: `style: ${g.style}\n${g.sentences.join('\n')}`}))});
  }
  const count = {};
  for (const g of flat) { const k = `${g.split}/${g.partial ? 'partial' : g.style}`; count[k] = (count[k] ?? 0) + 1; }
  return {groups: flat.length, count, folders};
}

/** Round B: pronoun-free certified pools (symbolic_english sentences and the targets of proofing-it3), statement-only entity groups folded in three styles, and list groups. */
export function groupsB() {
  const all = [];
  for (const split of ['train', 'dev']) {
    const seen = new Set(), pool = [];
    for (const r of [...sentencePool(split), ...proofingPool(split)]) if (!seen.has(r.text.toLowerCase()) && !/\b(he|she|they|him|her|them|his|their|it|its)\b/i.test(r.text)) { seen.add(r.text.toLowerCase()); pool.push(r); }
    const statements = pool.filter(r => !r.question);
    const T = split === 'train';
    const entity = makeGroups(statements, {style: 'subordinate', count: T ? 1500 : 110, seed: `itB-${split}`, min: 3, max: 5, reuse: T ? 3 : 3, split});
    for (const g of entity) for (const style of ['subordinate', 'relative', 'participle']) all.push({...g, id: `B-${style}-${g.id.replace(/^subordinate-/, '')}`, style, variant: 'B'});
    all.push(...makeGroups(pool, {style: 'list_coordination', count: T ? 1500 : 110, seed: `itB-${split}`, min: 3, max: 5, reuse: 2, split}).map(g => ({...g, id: `B-${g.id}`, variant: 'B'})));
    all.push(...makeGroups(pool, {style: 'multi_question', count: T ? 300 : 30, seed: `itB-${split}`, min: 2, max: 3, reuse: 2, split}).map(g => ({...g, id: `B-${g.id}`, variant: 'B'})));
  }
  writeJsonl(path.join(WORK, 'groups-b.jsonl'), all);
  const n = 8, folders = [];
  for (let k = 0; k < n; k++) folders.push(makeFolder(`decomp_it3_b_s${k + 1}`, {system: TANGLE_SYSTEM, answerKey: 'text', title: `tangle short sentence groups into one sentence, round B (SymbolicProofingLLM iteration 3 decomposition data, shard ${k + 1})`, model: 'deepseek/deepseek-flash', items: all.filter((_, i) => i % n === k).map(g => ({id: g.id, user: `style: ${g.style}\n${g.sentences.join('\n')}`}))}));
  const count = {};
  for (const g of all) { const key = `${g.split}/${g.style}`; count[key] = (count[key] ?? 0) + 1; }
  return {groups: all.length, count, folders: folders.length};
}

/** Round C: more statement-only entity groups from the same pronoun-free pools (new combinations, higher reuse), folded as `subordinate` and `participle` (the styles with the best judge pass rate in rounds A and B). */
export function groupsC() {
  const prev = new Set(readJsonl(path.join(WORK, 'groups-b.jsonl')).map(g => g.rows.join('|')));
  const all = [];
  for (const split of ['train', 'dev']) {
    const seen = new Set(), pool = [];
    for (const r of [...sentencePool(split), ...proofingPool(split)]) if (!seen.has(r.text.toLowerCase()) && !/\b(he|she|they|him|her|them|his|their|it|its)\b/i.test(r.text)) { seen.add(r.text.toLowerCase()); pool.push(r); }
    const statements = pool.filter(r => !r.question);
    const groups = makeGroups(statements, {style: 'subordinate', count: split === 'train' ? 2400 : 160, seed: `itC-${split}`, min: 3, max: 5, reuse: 5, split}).filter(g => !prev.has(g.rows.join('|')));
    for (const g of groups) for (const style of ['subordinate', 'participle']) all.push({...g, id: `C-${style}-${g.id.replace(/^subordinate-/, '')}`, style, variant: 'C'});
  }
  writeJsonl(path.join(WORK, 'groups-c.jsonl'), all);
  const n = 8, folders = [];
  for (let k = 0; k < n; k++) folders.push(makeFolder(`decomp_it3_c_s${k + 1}`, {system: TANGLE_SYSTEM, answerKey: 'text', title: `tangle short sentence groups into one sentence, round C (SymbolicProofingLLM iteration 3 decomposition data, shard ${k + 1})`, model: 'deepseek/deepseek-flash', items: all.filter((_, i) => i % n === k).map(g => ({id: g.id, user: `style: ${g.style}\n${g.sentences.join('\n')}`}))}));
  const count = {};
  for (const g of all) { const key = `${g.split}/${g.style}`; count[key] = (count[key] ?? 0) + 1; }
  return {groups: all.length, count, folders: folders.length};
}

export function collect() {
  const groups = new Map([...readJsonl(path.join(WORK, 'groups.jsonl')), ...readJsonl(path.join(WORK, 'groups-b.jsonl')), ...readJsonl(path.join(WORK, 'groups-c.jsonl'))].map(g => [g.id, g]));
  const answers = new Map();
  for (const f of ['subordinate', 'list', 'partial', ...[1, 2, 3, 4, 5, 6].flatMap(k => [`subordinate_s${k}`, `sub2_s${k}`]), ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap(k => [`b_s${k}`, `c_s${k}`])]) for (const [id, a] of loadAnswers(`decomp_it3_${f}`, 'text')) answers.set(id, a);
  const rows = [], dropped = {};
  const drop = w => { dropped[w] = (dropped[w] ?? 0) + 1; };
  for (const g of groups.values()) {
    const text = String(answers.get(g.id)?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) { drop('empty_or_missing'); continue; }
    const joined = g.sentences.join(' ');
    if (!/[.?]$/.test(text) || /[.?!;].+[.?!;]/.test(text.replace(/\b\p{Lu}\./gu, ''))) { drop('not_one_sentence'); continue; }
    if (text === joined || text.split(/\s+/).length > 70 || text.split(/\s+/).length < 10) { drop('same_long_or_short'); continue; }
    const m = mechanicalMeaning(joined, text), failed = ['names', 'numbers', 'negation', 'quantifiers', 'question'].filter(k => !m[k]);
    if (failed.length) { drop(`mechanical_${failed[0]}`); continue; }
    if (FORBID.test(text) && !FORBID.test(joined)) { drop('pronoun_added'); continue; }
    const has = new Set((joined.match(CONNECTIVES) ?? []).map(x => x.toLowerCase()));
    if ((text.match(CONNECTIVES) ?? []).some(x => !has.has(x.toLowerCase()))) { drop('connective_added'); continue; }
    rows.push({...g, tangled: text, target: joined});
  }
  writeJsonl(path.join(WORK, 'candidates.jsonl'), rows);
  const count = {};
  for (const r of rows) { const k = `${r.split}/${r.partial ? 'partial' : r.style}`; count[k] = (count[k] ?? 0) + 1; }
  return {kept: rows.length, of: groups.size, dropped, count};
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const fn = {groups, 'groups-b': groupsB, 'groups-c': groupsC, collect}[process.argv[2]];
  if (!fn) { console.error('usage: groups | groups-b | groups-c | collect'); process.exit(2); }
  console.log(JSON.stringify(fn(), null, 1));
}
