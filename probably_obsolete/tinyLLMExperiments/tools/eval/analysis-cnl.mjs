#!/usr/bin/env node
/**
 * Evaluation of the interpretation CNL (DS021 "Interpretation CNL", experiment eval-analysis-cnl-v1).
 *   node tools/eval/analysis-cnl.mjs [--symbolic 300] [--neuro 200] [--seed 7] [--threads 4] [--out eval/reports/current/analysis-cnl]
 * Samples sealed test rows (eval/suites/<dataset>/test.jsonl) stratified by family, realizes the CNL from each row's stored
 * analysis (lib/languages-util/analysis-cnl.mjs), parses every CNL text with SymbolicLM on the CPU (accurate and default Stanza
 * packages; parses cached in <out>/parses.jsonl), and writes rows.jsonl and summary.json: round-trip pass rate, share of rows with
 * `not represented` spans, CNL length against the message, and the share of CNL texts whose trees are certified (identical
 * accurate and default trees). No GPU, no training.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {treesCertified} from '../../lib/symbolic-lm/rewrite-gate.mjs';
import {compareAnalyses, defaultSynonyms} from '../../lib/languages-util/analysis-compare.mjs';
import {compareSentence} from '../../lib/symbolic-lm/uncertainty.mjs';
import {extractStructures, realize, roundTrip, ANALYSIS_CNL_VERSION} from '../../lib/languages-util/analysis-cnl.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const OUT = path.resolve(ROOT, args.out ?? 'eval/reports/current/analysis-cnl');
const key = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

/** Seeded stratified sample by family: proportional allocation, largest remainder, deterministic shuffle inside each family. */
export function stratified(rows, n, seed, familyOf = r => r.source?.family ?? 'none') {
  let state = seed >>> 0 || 1;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const groups = new Map();
  for (const r of rows) { const f = familyOf(r); if (!groups.has(f)) groups.set(f, []); groups.get(f).push(r); }
  const quotas = [...groups].map(([f, list]) => ({f, list, exact: n * list.length / rows.length})).sort((a, b) => a.f.localeCompare(b.f));
  quotas.forEach(q => { q.take = Math.floor(q.exact); });
  let left = n - quotas.reduce((s, q) => s + q.take, 0);
  for (const q of [...quotas].sort((a, b) => (b.exact - b.take) - (a.exact - a.take) || a.f.localeCompare(b.f))) { if (left <= 0) break; q.take++; left--; }
  const out = [];
  for (const q of quotas) {
    const list = [...q.list].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    out.push(...list.slice(0, q.take));
  }
  return out;
}

const loadRows = name => fs.readFileSync(path.join(ROOT, 'eval/suites', name, 'test.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.analysis?.sentences?.length);

/** Parse texts with both Stanza packages (CPU), cached by text. Returns Map text -> {accurate, default} (compact analyses). */
export async function parseBoth(texts, {threads = 4, cacheFile = path.join(OUT, 'parses.jsonl')} = {}) {
  fs.mkdirSync(path.dirname(cacheFile), {recursive: true});
  const cache = new Map();
  if (fs.existsSync(cacheFile)) for (const line of fs.readFileSync(cacheFile, 'utf8').split('\n')) { if (!line) continue; try { const r = JSON.parse(line); cache.set(r.k, r); } catch { /* truncated */ } }
  const todo = [...new Set(texts)].filter(t => t && !cache.has(key(t)));
  if (todo.length) {
    const lms = {};
    for (const pkg of ['accurate', 'default']) lms[pkg] = await createSymbolicLM({device: 'cpu', threads, package: pkg});
    try {
      for (let i = 0; i < todo.length; i += 32) {
        const chunk = todo.slice(i, i + 32);
        const res = {};
        for (const pkg of ['accurate', 'default']) res[pkg] = await lms[pkg].analyzeMany(chunk, {route: 'direct', language: 'en'});
        chunk.forEach((t, j) => {
          const rec = {k: key(t), accurate: res.accurate[j].analysis, default: res.default[j].analysis};
          cache.set(rec.k, rec);
          fs.appendFileSync(cacheFile, JSON.stringify(rec) + '\n');
        });
        console.error(`parsed ${Math.min(i + 32, todo.length)}/${todo.length}`);
      }
    } finally { for (const lm of Object.values(lms)) await lm.stop(); }
  }
  return new Map(texts.map(t => [t, cache.get(key(t))]));
}

/** Evaluate rows: realize, parse the CNL, round-trip, certify. Returns per-row records. */
export async function evaluateRows(rows, opts = {}) {
  const items = rows.map(r => {
    const structures = extractStructures(r.analysis, {message: r.message});
    const {cnl, sentences} = realize(structures);
    return {row: r, structures, cnl, sentences};
  });
  const parses = await parseBoth(items.map(i => i.cnl).filter(Boolean), opts);
  return items.map(({row, structures, cnl, sentences}) => {
    const rec = {id: row.id, dataset: row.dataset, family: row.source?.family, message: row.message, cnl, sentences: sentences.length, atoms: structures.atoms.length,
      notRepresented: structures.notRepresented, framing: structures.framing, notes: structures.notes.map(n => n.type),
      sourceCertified: row.analysis_verified === 'analysis_gate' || row.analysis_verdict?.state === 'pass'};
    if (!cnl) { rec.empty = true; return rec; }
    const p = parses.get(cnl);
    const back = extractStructures(p.accurate);
    const rt = roundTrip(structures, back);
    Object.assign(rec, {roundTrip: rt.pass, rtReasons: rt.reasons, onlySource: rt.onlySource.slice(0, 3), onlyCnl: rt.onlyCnl.slice(0, 3), cnlNotRepresented: back.notRepresented,
      certified: treesCertified(p.accurate.sentences, p.default.sentences),
      sentencesIdentical: p.accurate.sentences.filter((a, i) => p.default.sentences[i] && compareSentence(p.default.sentences[i].tokens, a.tokens) === 'identical').length, sentencesTotal: p.accurate.sentences.length});
    try { const c = compareAnalyses(row.analysis, p.accurate, {synonyms: defaultSynonyms(), textA: row.message, textB: cnl}); rec.compare = c.verdict; rec.compareReasons = (c.reasons ?? []).slice(0, 3); } catch (error) { rec.compare = 'error'; }
    return rec;
  });
}

export function summarize(records) {
  const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
  const part = list => {
    const withCnl = list.filter(r => !r.empty);
    const words = s => s.split(/\s+/).filter(Boolean).length;
    const avg = f => (list.length ? +(list.reduce((s, r) => s + f(r), 0) / list.length).toFixed(1) : null);
    return {
      rows: list.length, empty_cnl: list.length - withCnl.length,
      round_trip_pass: withCnl.filter(r => r.roundTrip).length, round_trip_pass_pct: pct(withCnl.filter(r => r.roundTrip).length, withCnl.length),
      with_not_represented: list.filter(r => r.notRepresented.length).length, with_not_represented_pct: pct(list.filter(r => r.notRepresented.length).length, list.length),
      fully_verified: withCnl.filter(r => r.roundTrip && !r.notRepresented.length).length, fully_verified_pct: pct(withCnl.filter(r => r.roundTrip && !r.notRepresented.length).length, list.length),
      avg_chars_message: avg(r => r.message.length), avg_chars_cnl: avg(r => r.cnl.length), avg_words_message: avg(r => words(r.message)), avg_words_cnl: avg(r => words(r.cnl)),
      ratio_words: (() => { const m = list.reduce((s, r) => s + words(r.message), 0), c = list.reduce((s, r) => s + words(r.cnl), 0); return +(c / m).toFixed(3); })(),
      cnl_certified: withCnl.filter(r => r.certified).length, cnl_certified_pct: pct(withCnl.filter(r => r.certified).length, withCnl.length),
      sentences_identical_pct: pct(withCnl.reduce((s, r) => s + r.sentencesIdentical, 0), withCnl.reduce((s, r) => s + r.sentencesTotal, 0)),
      compare_equivalent: withCnl.filter(r => r.compare === 'equivalent').length, compare_different: withCnl.filter(r => r.compare === 'different').length, compare_uncertain: withCnl.filter(r => r.compare === 'uncertain').length,
      round_trip_and_certified: withCnl.filter(r => r.certified && r.roundTrip).length,
      avg_not_represented_spans: avg(r => r.notRepresented.length),
    };
  };
  const by = {};
  for (const d of [...new Set(records.map(r => r.dataset))]) by[d] = part(records.filter(r => r.dataset === d));
  const sub = {};
  for (const d of Object.keys(by)) for (const c of [true, false]) { const l = records.filter(r => r.dataset === d && r.sourceCertified === c); if (l.length) sub[`${d}/source_${c ? 'certified' : 'uncertified'}`] = part(l); }
  return {version: ANALYSIS_CNL_VERSION, by_dataset: by, by_source_certification: sub};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = Number(args.seed ?? 7);
  const sym = stratified(loadRows('symbolic_english'), Number(args.symbolic ?? 300), seed);
  const neu = stratified(loadRows('neuro_english'), Number(args.neuro ?? 200), seed + 1);
  const records = await evaluateRows([...sym, ...neu], {threads: Number(args.threads ?? 4)});
  fs.mkdirSync(OUT, {recursive: true});
  fs.writeFileSync(path.join(OUT, 'rows.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  const summary = summarize(records);
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
}
