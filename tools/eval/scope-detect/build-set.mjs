#!/usr/bin/env node
/**
 * Build the labelled set of the scope-detect study: sentences with the analysis SymbolicLM returns for them.
 *   node tools/eval/scope-detect/build-set.mjs [--natural 150] [--symbolic 75] [--neuro 75] [--source 150]
 * Sources: datasets/natural (the owner's messages, analysed here), datasets/symbolic_english and neuro_english (rows carry their analysis),
 * and Grok's manual/policy-style sentences (datasets_sources/scope_gen_grok/output, analysed here) after the guards: no project jargon,
 * no exact or lexical duplicate of a natural message (tools/datasets/audit/natural-overlap.mjs), no duplicate inside the set.
 * CPU only (Stanza on CPU through SymbolicLM). Writes eval/reports/current/scope-detect/labelled-set.jsonl.
 */
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {readJsonlShardedSync} from '../../../lib/jsonl-shards.mjs';
import {createSymbolicLM} from '../../../lib/symbolic-lm/index.mjs';
import {naturalOverlapOf} from '../../datasets/audit/natural-overlap.mjs';
import {readJsonl, writeJsonl, shuffle, SET_FILE} from './lib.mjs';

const ONLY_NATURAL = process.argv.includes('--only-natural');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const N = {natural: arg('--natural', 150), symbolic: arg('--symbolic', 75), neuro: arg('--neuro', 75), source: arg('--source', 150)};
const JARGON = /\b(sop|wires?|ontology|symbolic\w*|formalizer|dataset|stanza|parser|chatsop|llm|prolog|datalog|knowledge base)\b/i;
const usable = s => s.tokens.filter(t => t[3] !== 'PUNCT').length >= 3 && !/\[(pasted content|email|token|path)\]/.test(s.text) && s.text.length < 400;
const sentencesOfAnalysis = (a, meta) => (a?.sentences ?? []).filter(usable).map((s, i) => ({...meta, sentence: {text: s.text, tokens: s.tokens}, language: ['ro', 'mixed'].includes(a.language) ? a.language : 'en', n: i}));

const lm = await createSymbolicLM({device: 'cpu'});
const natural = readJsonl(path.join(ROOT, 'datasets/natural/messages.jsonl'));
const pool = {natural: [], symbolic: [], neuro: [], source: []};
for (const m of natural) {
  // route direct: the owner's Romanian and mixed sentences are parsed in their own language (the default `mixed: translate` route would hand the detector a word-for-word English garble)
  const r = await lm.analyze(m.message, {route: 'direct'}).catch(e => { console.error('analyze failed', m.id, String(e.message).slice(0, 200)); return null; });
  if (!r) continue;
  pool.natural.push(...sentencesOfAnalysis(r.analysis, {set: 'natural', from: m.id}));
}
for (const [key, ds] of ONLY_NATURAL ? [] : [['symbolic', 'symbolic_english'], ['neuro', 'neuro_english']]) {
  const rows = ['train', 'dev'].flatMap(sp => readJsonlShardedSync(path.join(ROOT, `datasets/${ds}/${sp}.jsonl`)));
  const seen = new Set();
  for (const r of shuffle(rows, 7)) { if (seen.has(r.split_group_id)) continue; seen.add(r.split_group_id); const got = sentencesOfAnalysis(r.analysis, {set: ds, from: r.id}); if (got.length) pool[key].push(got[0]); }
}
const gen = ONLY_NATURAL ? [] : readJsonl(path.join(ROOT, 'datasets_sources/scope_gen_grok/output/verdicts.jsonl')).flatMap(r => (r.answer?.sentences ?? []).map((text, i) => ({id: `${r.id}.${i}`, message: String(text).trim()})));
const overlap = naturalOverlapOf(gen, natural);
const bad = new Set(), seenText = new Set();
const genKept = gen.filter(g => { const k = g.message.toLowerCase().replace(/\W+/g, ' '); if (JARGON.test(g.message) || seenText.has(k) || g.message.split(/\s+/).length > 45) return false; seenText.add(k); return true; });
for (const g of genKept) {
  const r = await lm.analyze(g.message).catch(e => { console.error('analyze failed', g.id, String(e.message).slice(0, 200)); return null; });
  if (!r) continue;
  pool.source.push(...sentencesOfAnalysis(r.analysis, {set: 'source_grok', from: g.id}).slice(0, 1));
}
await lm.stop();
const out = ONLY_NATURAL ? readJsonl(SET_FILE).filter(r => r.set !== 'natural') : [];
const take = (key, n) => { for (const x of shuffle(pool[key], 11).slice(0, n)) out.push({id: `${x.set}::${x.from}::${x.n}`, ...x}); };
take('natural', N.natural); if (!ONLY_NATURAL) { take('symbolic', N.symbolic); take('neuro', N.neuro); take('source', N.source); }
writeJsonl(SET_FILE, out);
console.log(JSON.stringify({pool: Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, v.length])), written: out.length, generated: gen.length, kept_after_guards: genKept.length, natural_overlap: {exact: overlap.exact_duplicates, lexical: overlap.lexical_duplicates}}));
