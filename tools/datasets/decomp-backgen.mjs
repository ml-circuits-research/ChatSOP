#!/usr/bin/env node
/** Decomposition top-up for SymbolicProofingLLM iteration 2: tangled single sentences -> the original short sentences.
 *
 * `groups` builds datasets_sources/decomp_backgen/input/part-NNN.jsonl: groups of 2 to 4 single-sentence symbolic_english train/dev rows that
 * share one entity (a person, place or organisation), statements first and at most one question last. DeepSeek (omp task, TASK.md in that folder)
 * folds each group into ONE tangled sentence (relative clause, apposition, coordination, participle); the pair is
 * (tangled sentence -> the group's sentences joined, unchanged). Every target sentence is an original symbolic_english sentence that SymbolicLM analyses
 * correctly, so the targets need no rewrite judgement; the pairs still go through the mechanical checks, the two-vote meaning judge and the sealed-overlap
 * auditor in tools/datasets/build-symbolic-proofing-v2.mjs (`collect-decomp`).
 *
 *   node tools/datasets/decomp-backgen.mjs groups [--train 1500] [--dev 200] [--seed decomp-backgen-v1]
 *
 * Train rows only ever group with train rows and dev rows with dev rows (the split of a pair is the split of its rows). No sealed file is read.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT, writeJsonl} from './neuro-oracle/common.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {sentencesOf, hasFiller} from './symbolic-proofing-v2/units.mjs';

export const DIR = path.join(ROOT, 'datasets_sources/decomp_backgen');
const args = process.argv.slice(3);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const hash = s => crypto.createHash('sha1').update(s).digest('hex');

/** A short single-clause sentence: capitalized, terminal punctuation, no coordination or subordination words, no filler. */
const simple = t => t.length >= 15 && t.length <= 160 && /^\p{Lu}/u.test(t) && /[.?]$/.test(t) && t.split(/\s+/).length <= 18 && !/[;:]|\b(?:and|but|or|because|while|so|although|unless|if|whether|that|who|which|whose|when|after|before|since|do you know|I wonder|I was wondering)\b/i.test(t) && !/,/.test(t) && !hasFiller(t);

const GENERIC = new Set(['time', 'year', 'people', 'person', 'thing', 'day', 'week', 'month', 'name', 'list', 'reason', 'case', 'number', 'place', 'kind', 'group', 'member', 'way', 'one']);

/** Entities of a row: maximal runs of PROPN tokens of the stored analysis (sentence-initial words included when tagged PROPN). */
function entities(row) {
  const out = new Set();
  for (const s of row.analysis?.sentences ?? []) {
    let run = [];
    const flush = () => { if (run.length) out.add(run.join(' ')); run = []; };
    for (const t of s.tokens) { if (t[3] === 'PROPN') run.push(t[1]); else flush(); if (t[3] === 'NOUN' && t[2].length >= 4 && !GENERIC.has(t[2])) out.add(t[2].toLowerCase()); }
    flush();
  }
  return [...out];
}

export function groups({train = 1500, dev = 200, seed = 'decomp-backgen-v1'} = {}) {
  const rows = [];
  for (const split of ['train', 'dev']) for (const r of readJsonlShardedSync(path.join(ROOT, `datasets/symbolic_english/${split}.jsonl`))) {
    const units = sentencesOf(r.message);
    if (units.length !== 1 || !simple(units[0])) continue;
    rows.push({id: r.id, split, text: units[0], question: /\?$/.test(units[0]), entities: entities(r)});
  }
  const out = [];
  for (const [split, quota] of [['train', train], ['dev', dev]]) {
    const pool = rows.filter(r => r.split === split), byEntity = new Map();
    for (const r of pool) for (const e of r.entities) (byEntity.get(e) ?? byEntity.set(e, []).get(e)).push(r);
    const entitiesSorted = [...byEntity.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => hash(`${seed}|${a[0]}`).localeCompare(hash(`${seed}|${b[0]}`)));
    const used = new Map(), made = [];
    for (let round = 0; made.length < quota && round < 6; round++) for (const [entity, list] of entitiesSorted) {
      if (made.length >= quota) break;
      const size = [2, 2, 3, 2, 3, 4][(round + hash(entity).charCodeAt(0)) % 6];
      const cand = list.filter(r => (used.get(r.id) ?? 0) < 3).sort((a, b) => hash(`${seed}|${round}|${a.id}`).localeCompare(hash(`${seed}|${round}|${b.id}`)));
      const chosen = [];
      for (const r of cand) { if (chosen.length < size && !chosen.some(c => c.text === r.text) && chosen.filter(c => c.question).length + (r.question ? 1 : 0) <= 1) chosen.push(r); }
      if (chosen.length < 2) continue;
      chosen.sort((a, b) => Number(a.question) - Number(b.question));
      const key = chosen.map(c => c.id).join('|');
      if (made.some(m => m.key === key)) continue;
      for (const c of chosen) used.set(c.id, (used.get(c.id) ?? 0) + 1);
      made.push({key, id: `dg${String(out.length + made.length).padStart(5, '0')}`, split, entity, rows: chosen.map(c => c.id), sentences: chosen.map(c => c.text), message: chosen.map(c => c.text).join(' ')});
    }
    out.push(...made);
  }
  fs.mkdirSync(path.join(DIR, 'input'), {recursive: true});
  fs.mkdirSync(path.join(DIR, 'output'), {recursive: true});
  fs.mkdirSync(path.join(DIR, 'logs'), {recursive: true});
  fs.mkdirSync(path.join(DIR, 'scripts'), {recursive: true});
  const PER = 150;
  for (let i = 0; i * PER < out.length; i++) writeJsonl(path.join(DIR, 'input', `part-${String(i).padStart(3, '0')}.jsonl`), out.slice(i * PER, (i + 1) * PER).map(g => ({id: g.id, sentences: g.sentences, message: g.message})));
  writeJsonl(path.join(DIR, 'groups.jsonl'), out);
  return {groups: out.length, train: out.filter(g => g.split === 'train').length, dev: out.filter(g => g.split === 'dev').length, parts: Math.ceil(out.length / PER), by_size: out.reduce((o, g) => { o[g.sentences.length] = (o[g.sentences.length] ?? 0) + 1; return o; }, {})};
}

if (process.argv[1] === new URL(import.meta.url).pathname && process.argv[2] === 'groups') console.log(JSON.stringify(groups({train: Number(opt('train', 1500)), dev: Number(opt('dev', 200)), seed: opt('seed', 'decomp-backgen-v1')}), null, 1));
