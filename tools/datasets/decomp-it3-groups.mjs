#!/usr/bin/env node
/**
 * Groups of certified one-clause symbolic_english sentences for the decomposition work (reverse direction: a DeepSeek-written tangled
 * single sentence is the input, the group's sentences are the target). Every sentence comes from a symbolic_english row, which passed the
 * analysis gate (identical default and accurate Stanza trees AND the DeepSeek parse judge), so each target sentence is certified by construction;
 * the joined group is re-certified by the pipeline before it enters a dataset.
 *
 *   node tools/datasets/decomp-it3-groups.mjs groups --split train|dev --style subordinate|list|relative|multi_question --count N --out <file.jsonl> [--seed S] [--min 3 --max 5]
 *
 * Splits stay apart (a train group only holds train sentences); this generator reads only the train and dev splits. Group id: `<style>-<split>-NNNN`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {hasFiller, norm} from './symbolic-proofing-v2/units.mjs';
import {tangleOf} from '../eval/decomposition/tangle.mjs';
import {AnalysisLayer} from '../eval/analysis-layer.mjs';
import {sentencesOf} from './symbolic-proofing-v2/units.mjs';

const hash = s => crypto.createHash('sha1').update(s).digest('hex');
const GENERIC = new Set(['time', 'year', 'people', 'person', 'thing', 'day', 'week', 'month', 'name', 'list', 'reason', 'case', 'number', 'place', 'kind', 'group', 'member', 'way', 'one']);
const STYLES = Object.freeze(['subordinate', 'list_coordination', 'relative', 'multi_question', 'participle']);
export const PRONOUN = /\b(he|she|they|him|her|them|his|their|it|its|this|that|these|those)\b/i;

export const symbolicFile = split => path.join(ROOT, `datasets/symbolic_english/${split}.jsonl`);

/** One-clause, filler-free sentences of the rows of a split with their entities. */
export function sentencePool(split) {
  if (!['train', 'dev'].includes(split)) throw Error('generators read only the train and dev splits');
  return sentencePoolOf(readJsonlShardedSync(symbolicFile(split)));
}

/** The pool of any rows of the symbolic_english shape (the evaluation tool tools/eval/decomposition/extras.mjs supplies its own rows). */
export function sentencePoolOf(rows) {
  const pool = [], seen = new Set();
  for (const row of rows) {
    for (const [i, s] of (row.analysis?.sentences ?? []).entries()) {
      const text = norm(s.text), words = text.split(/\s+/).length;
      if (words < 4 || words > 22 || !/^\p{Lu}/u.test(text) || !/[.?]$/.test(text) || /[;:]/.test(text) || hasFiller(text) || seen.has(text.toLowerCase())) continue;
      const one = tangleOf({sentences: [s]});
      if (one.clauses !== 1 || one.questions > 1 || one.counts.conj_noun >= 2) continue;
      const entities = new Set();
      let run = [];
      const flush = () => { if (run.length) entities.add(run.join(' ')); run = []; };
      for (const t of s.tokens) { if (t[3] === 'PROPN') run.push(t[1]); else flush(); if (t[3] === 'NOUN' && t[2].length >= 4 && !GENERIC.has(t[2])) entities.add(t[2].toLowerCase()); }
      flush();
      seen.add(text.toLowerCase());
      pool.push({id: `${row.id}#${i}`, text, question: /\?$/.test(text), entities: [...entities], words});
    }
  }
  return pool;
}

/** Groups of `min..max` sentences for a style. Entity styles share an entity; list styles take any sentences (statements first, at most `maxQuestions` questions last). */
export function makeGroups(pool, {style, count, seed = 'it3', min = 3, max = 5, reuse = 3, split = 'train'}) {
  const byEntity = new Map();
  for (const r of pool) for (const e of r.entities) (byEntity.get(e) ?? byEntity.set(e, []).get(e)).push(r);
  const used = new Map(), made = [], keys = new Set();
  const take = (cands, size, maxQ) => {
    const chosen = [];
    for (const r of cands) if (chosen.length < size && (used.get(r.id) ?? 0) < reuse && !chosen.some(c => c.text === r.text) && chosen.filter(c => c.question).length + Number(r.question) <= maxQ) chosen.push(r);
    return chosen;
  };
  const push = chosen => {
    chosen.sort((a, b) => Number(a.question) - Number(b.question));
    const key = chosen.map(c => c.id).join('|');
    if (keys.has(key)) return false;
    keys.add(key);
    for (const c of chosen) used.set(c.id, (used.get(c.id) ?? 0) + 1);
    made.push({id: `${style}-${split}-${String(made.length + 1).padStart(4, '0')}`, style, split, rows: chosen.map(c => c.id), sentences: chosen.map(c => c.text)});
    return true;
  };
  const sizeAt = (round, k) => min + (hash(`${seed}|${style}|${round}|${k}`).charCodeAt(0) % (max - min + 1));
  if (style === 'multi_question') {
    const qs = pool.filter(r => r.question).sort((a, b) => hash(`${seed}|q|${a.id}`).localeCompare(hash(`${seed}|q|${b.id}`)));
    for (let round = 0; made.length < count && round < reuse * 2; round++) for (const [e, list] of [...byEntity].filter(([, l]) => l.filter(r => r.question).length >= 2).sort((a, b) => hash(`${seed}|${round}|${a[0]}`).localeCompare(hash(`${seed}|${round}|${b[0]}`)))) {
      if (made.length >= count) break;
      const chosen = take(list.filter(r => r.question).sort((a, b) => hash(`${seed}|${round}|${a.id}`).localeCompare(hash(`${seed}|${round}|${b.id}`))), 2 + (round % 2), 3);
      if (chosen.length >= 2) push(chosen);
    }
    void qs;
    return made;
  }
  const entityStyle = style !== 'list_coordination';
  if (entityStyle) {
    const sorted = [...byEntity].filter(([, l]) => l.length >= min).sort((a, b) => hash(`${seed}|${a[0]}`).localeCompare(hash(`${seed}|${b[0]}`)));
    for (let round = 0; made.length < count && round < reuse * 3; round++) for (const [e, list] of sorted) {
      if (made.length >= count) break;
      const cand = [...list].sort((a, b) => hash(`${seed}|${round}|${a.id}`).localeCompare(hash(`${seed}|${round}|${b.id}`)));
      const chosen = take(cand, sizeAt(round, e), 1);
      if (chosen.length >= min) push(chosen);
    }
  } else {
    const order = [...pool].sort((a, b) => hash(`${seed}|l|${a.id}`).localeCompare(hash(`${seed}|l|${b.id}`)));
    for (let round = 0; made.length < count && round < reuse * 3; round++) {
      const shuffled = round === 0 ? order : [...pool].sort((a, b) => hash(`${seed}|l${round}|${a.id}`).localeCompare(hash(`${seed}|l${round}|${b.id}`)));
      for (let i = 0; i < shuffled.length && made.length < count; i += 1) {
        const anchor = shuffled[i];
        if ((used.get(anchor.id) ?? 0) >= reuse) continue;
        // prefer sentences sharing an entity with the anchor, then fill with the following rows of the shuffle
        const mates = (anchor.entities.flatMap(e => byEntity.get(e) ?? [])).filter(r => r.id !== anchor.id);
        const rest = shuffled.slice(i + 1, i + 40);
        const chosen = take([anchor, ...mates.slice(0, 2), ...rest], sizeAt(round, anchor.id), 2);
        if (chosen.length >= min) push(chosen);
        i += 2;
      }
    }
  }
  return made;
}


/**
 * A second pool of certified one-clause sentences: the sentences of the TARGETS (and identity prompts) of `neuro_english/proofing-it3` of a split, each
 * re-certified here (identical default and accurate Stanza trees, recorded parses), one clause by the analysis, 4 to 22 words, filler-free and
 * pronoun-free. The targets of that dataset passed the analysis gate by construction; the sentences are certified again from the parses.
 */
export function proofingPool(split) {
  if (!['train', 'dev'].includes(split)) throw Error('generators read only the train and dev splits');
  const layer = new AnalysisLayer(), pool = [], seen = new Set();
  for (const row of readJsonlShardedSync(path.join(ROOT, `datasets/neuro_english/proofing-it3/${split}.jsonl`))) for (const text of sentencesOf(row.target)) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const words = text.split(/\s+/).length;
    if (words < 4 || words > 22 || !/^\p{Lu}/u.test(text) || !/[.?]$/.test(text) || /[;:]/.test(text) || hasFiller(text) || PRONOUN.test(text)) continue;
    const info = layer.info(text);
    if (!info || info.sentences.length !== 1 || !layer.localPass(text)) continue;
    const shape = layer.shape(text);
    if (shape.clauses !== 1) continue;
    const entities = new Set();
    let run = [];
    const flush = () => { if (run.length) entities.add(run.join(' ')); run = []; };
    for (const w of info.sentences[0].words) { if (w.upos === 'PROPN') run.push(w.text); else flush(); if (w.upos === 'NOUN' && w.lemma.length >= 4 && !GENERIC.has(w.lemma)) entities.add(w.lemma.toLowerCase()); }
    flush();
    pool.push({id: `it3:${split}:${pool.length}`, text, question: /\?$/.test(text), entities: [...entities], words});
  }
  return pool;
}

/** One-clause, filler-free sentences of the uncertified single-sentence rows of neuro_english (`trees_differ`: parsed, but the trees disagree) of a split. */
export function neuroPool(split) {
  const pool = [], seen = new Set();
  for (const row of readJsonlShardedSync(path.join(ROOT, `datasets/neuro_english/${split}.jsonl`))) {
    if (row.failure_kind !== 'trees_differ' || (row.analysis?.sentences ?? []).length !== 1) continue;
    const s = row.analysis.sentences[0], text = norm(s.text), words = text.split(/\s+/).length;
    if (words < 4 || words > 22 || !/^\p{Lu}/u.test(text) || !/[.?]$/.test(text) || /[;:]/.test(text) || hasFiller(text) || seen.has(text.toLowerCase())) continue;
    const one = tangleOf({sentences: [s]});
    if (one.clauses !== 1 || one.questions > 1 || one.counts.conj_noun >= 2) continue;
    seen.add(text.toLowerCase());
    const entities = new Set();
    let run = [];
    const flush = () => { if (run.length) entities.add(run.join(' ')); run = []; };
    for (const t of s.tokens) { if (t[3] === 'PROPN') run.push(t[1]); else flush(); }
    flush();
    pool.push({id: `${row.id}#0`, text, question: /\?$/.test(text), entities: [...entities], words, uncertified: true});
  }
  return pool;
}

/** Partial-acceptance groups: 2 to 3 certified sentences plus exactly ONE uncertified neuro_english sentence, which the target keeps verbatim. */
export function partialGroups(certifiedPool, uncertainPool, {count, seed = 'it3', split = 'train', style = 'subordinate'}) {
  const base = makeGroups(certifiedPool, {style: 'subordinate', count: count * 2, seed: `${seed}|partial`, min: 2, max: 3, reuse: 2, split});
  const byEntity = new Map();
  for (const r of uncertainPool) for (const e of r.entities) (byEntity.get(e) ?? byEntity.set(e, []).get(e)).push(r);
  const order = [...uncertainPool].sort((a, b) => hash(`${seed}|p|${a.id}`).localeCompare(hash(`${seed}|p|${b.id}`)));
  const used = new Set(), out = [];
  for (const [i, g] of base.entries()) {
    if (out.length >= count) break;
    const certified = g.rows.map((id, k) => ({id, text: g.sentences[k]}));
    const entityMates = g.sentences.flatMap(t => [...byEntity].filter(([e]) => t.includes(e)).flatMap(([, l]) => l));
    const pick = [...entityMates, ...order.slice(i * 3, i * 3 + 30)].find(r => !used.has(r.id) && !g.sentences.includes(r.text) && (!r.question || !g.sentences.some(t => /\?$/.test(t))));
    if (!pick) continue;
    used.add(pick.id);
    const items = [...certified.map(c => ({...c, certified: true, question: /\?$/.test(c.text)})), {id: pick.id, text: pick.text, certified: false, question: pick.question}];
    // statements first (the uncertified sentence sits at a hashed position among them), a question last
    const stmts = items.filter(x => !x.question).sort((a, b) => hash(`${seed}|${g.id}|${a.id}`).localeCompare(hash(`${seed}|${g.id}|${b.id}`)));
    const qs = items.filter(x => x.question);
    const ordered = [...stmts, ...qs];
    out.push({id: `partial-${split}-${String(out.length + 1).padStart(4, '0')}`, style: i % 2 ? 'list_coordination' : style, split, partial: true, rows: ordered.map(x => x.id), sentences: ordered.map(x => x.text), uncertified: ordered.map(x => !x.certified ? x.text : null).filter(Boolean)});
  }
  return out;
}

if (process.argv[1] === new URL(import.meta.url).pathname && process.argv[2] === 'groups') {
  const a = process.argv.slice(3), opt = (n, d) => (a.includes(`--${n}`) ? a[a.indexOf(`--${n}`) + 1] : d);
  const split = opt('split', 'train'), style = opt('style', 'subordinate');
  if (!['train', 'dev'].includes(split) || !STYLES.includes(style)) throw Error(`--split train|dev, --style ${STYLES.join('|')}`);
  const pool = sentencePool(split);
  const groups = makeGroups(pool, {style, count: Number(opt('count', 100)), seed: opt('seed', 'it3'), min: Number(opt('min', 3)), max: Number(opt('max', 5)), reuse: Number(opt('reuse', 3)), split});
  const out = opt('out');
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true}); fs.writeFileSync(out, groups.map(g => JSON.stringify(g)).join('\n') + '\n'); }
  console.log(JSON.stringify({split, style, pool: pool.length, groups: groups.length, sizes: groups.reduce((o, g) => { o[g.sentences.length] = (o[g.sentences.length] ?? 0) + 1; return o; }, {})}));
}
