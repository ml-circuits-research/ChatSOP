#!/usr/bin/env node
/**
 * Open-vocabulary linking (linking proposal 6.1 parts 2 and 3, 6.2): real questions in the users' words, labelled by consensus of
 * independent judges (tools/linking/judge/), against the lexicon of world-v1 with core-en layered under it. The chain measured is
 * SymbolicLM (message only) -> KnowledgeLinker (sop/declarative.mjs, the product's compile step; no engine): what the linker bound,
 * what it asked, what it got wrong. The generated-world floor of part 1 (tools/eval/linking-suite.mjs) says nothing about this.
 *
 *   node tools/eval/linking-open.mjs run [--parts 2,3] [--arms exact,scored-no-head,scored,scored@world-only] [--stage 100|300|all] [--out DIR]
 *
 * Arms: `exact` (the M1 linker: a tie is an ambiguity, no scoring, no head-verb tier, no subclass or namesake choice),
 * `scored-no-head`, `scored` (the product), and `@world-only` removes core-en from the memory (what core-en contributes).
 * Per row: relation outcome (correct / wrong / abstain), entity outcome per gold entity, and for rows whose gold says "ask" whether
 * the linker asked (justified), reported alternatives, or guessed silently. SymbolicLM's program is computed once per question
 * and cached beside the report. Sealed: labels are scaffolding, never model input.
 */
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../lib/jsonl-shards.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {compileDeclarative} from '../../sop/declarative.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {configureLinker} from '../../sop/knowledge-linker.mjs';
import {fold} from '../../sop/text-keys.mjs';
import {openVocabularyLexicon} from '../linking/judge/memory.mjs';
import {wilson} from './linking-suite.mjs';
import {loadSplit} from './linking-split.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(3).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const base = id => String(id).replace(/__converse$/, '');
/**
 * The labels of parts 2 and 3 were judged against the vocabulary of world-v1 before worldkb-agent remapped it onto the predicates of core-en
 * (tools/world-kb/MAPPING.md). The renames are one to one; a label naming a predicate the memory in use no longer declares is read through
 * this table (and only then), so the same labels score both memories. It changes no gold relation to another meaning.
 */
export const PREDICATE_RENAMES = Object.freeze({birth_year: 'born_on', death_year: 'died_on', discovered: 'finds', educated_at: 'studies_at', parent_organization: 'subsidiary_of', won: 'receives', wrote: 'writes', area_km2_of: 'area_of', description_en: 'description'});
/** `known(id)`: does the memory in use declare the predicate? Without it labels are read as written. */
const aliasFor = known => id => { const b = base(id); return known && !known(b) && PREDICATE_RENAMES[b] && known(PREDICATE_RENAMES[b]) ? PREDICATE_RENAMES[b] : b; };
const ARMS = {
  'exact': {scored: false, headVerb: false}, 'scored-no-head': {scored: true, headVerb: false}, 'scored': {scored: true, headVerb: true},
};

function sample(rows, n) {
  if (!n || n >= rows.length) return rows;
  let state = 1234567;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const list = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.slice(0, n);
}

/** Outcome of one compiled question against its gold. */
export function judgeRow(row, compiled, known = null) {
  const base = aliasFor(known);
  const linking = compiled?.linking ?? [], issues = compiled?.issues ?? [];
  const relations = linking.filter(e => e.kind === 'relation'), entities = linking.filter(e => e.kind === 'entity');
  const asked = issues.length > 0, bound = relations.length > 0;
  const g = row.gold, wanted = [g.relation, ...g.alternatives].filter(Boolean).map(base);
  let relation;
  if (g.ask || g.relation === 'ambiguous') {
    const reported = relations.some(e => (e.scored_alternatives?.length || e.alternatives?.length));
    relation = asked ? 'justified_clarify' : bound ? (reported ? 'bound_reported' : 'silent_guess') : 'no_program';
  } else if (g.relation === 'none') relation = bound ? 'wrong' : 'abstain';
  else if (relations.some(e => base(e.symbol) === base(g.relation))) relation = 'correct';
  else if (bound) relation = relations.some(e => wanted.includes(base(e.symbol))) ? 'correct' : 'wrong';
  else relation = asked ? 'abstain' : 'no_program';
  const ent = g.entities.map(goldEntity => {
    if (entities.some(e => e.symbol === goldEntity.id)) return 'correct';
    const key = fold(goldEntity.surface);
    if (entities.some(e => { const s = fold(e.surface); return s && (key.includes(s) || s.includes(key)); })) return 'wrong';
    return 'unlinked';
  });
  // Lenient reading: any predicate a judge gave for the row counts (the merged vocabulary holds near-equivalent pairs such as area_of and area_km2_of).
  const accepted = new Set(Object.values(row.judges ?? {}).map(j => base(j.relation)).filter(r => r && !['none', 'ambiguous'].includes(r)));
  const lenient = relation === 'wrong' && g.relation !== 'none' && relations.some(e => accepted.has(base(e.symbol))) ? 'correct' : relation;
  // A wrong binding to relations that have no fact at all in the memory cannot produce a wrong answer, only an empty one (reported apart).
  const ungrounded = relation === 'wrong' && relations.every(e => !(e.facts > 0));
  return {relation, lenient, ungrounded, entities: ent, asked, scores: relations.map(e => e.score ?? null)};
}

async function run() {
  const parts = (args.parts ?? '2,3').split(',').map(Number), stage = args.stage ?? 'all';
  const arms = (args.arms ?? 'exact,scored-no-head,scored,scored@world-only').split(',');
  const outDir = path.resolve(ROOT, args.out ?? 'eval/reports/current/linking');
  const rows = [];
  for (const part of parts) {
    const file = path.join(ROOT, 'eval/suites/linking-v1', `part${part}.jsonl`);
    if (jsonlExists(file)) rows.push(...sample(readJsonlShardedSync(file), stage === 'all' ? null : Number(stage)));
  }
  // eval-linking-v2: `--half dev|test|all` (default dev). The sealed test half is read only with `--half test` and measured once at the end.
  const half = args.half ?? 'dev', split = loadSplit();
  if (half !== 'all') { if (!split) throw Error('no split.json: run tools/eval/linking-split.mjs'); for (let i = rows.length - 1; i >= 0; i--) if (split.assign[rows[i].id] !== half) rows.splice(i, 1); }
  if (!rows.length) throw Error('no part 2 or 3 rows: run the judge pipeline first (tools/linking/judge/)');
  const cacheFile = path.join(outDir, 'open-programs.json');
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const todo = rows.filter(r => !cache[r.id]);
  if (todo.length) {
    const lm = await createSymbolicLM({});
    for (const r of todo) { const a = await lm.analyze(r.question, {language: r.language ?? 'auto'}); cache[r.id] = {sop: a.sop}; }
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    await lm.stop?.();
  }
  const dictionary = defaultDictionary();
  const lexicons = {full: openVocabularyLexicon(), 'world-only': openVocabularyLexicon({withCore: false})};
  const report = {suite: 'linking-v1 parts ' + parts.join('+') + ' (judge labels)', stage, half, rows: rows.length, memory: 'world-v1 + core-en', arms: {}, generated: new Date().toISOString()};
  for (const arm of arms) {
    const [name, variant] = arm.split('@'), lexicon = lexicons[variant ?? 'full'];
    configureLinker(ARMS[name]);
    const t = {relation: {correct: 0, wrong: 0, abstain: 0, no_program: 0, n: 0}, ask: {justified_clarify: 0, bound_reported: 0, silent_guess: 0, no_program: 0, n: 0},
      none: {abstain: 0, wrong: 0, n: 0}, lenient_correct: 0, wrong_ungrounded: 0, author_ambiguous: {n: 0, asked: 0, reported: 0, silent: 0}, entity: {correct: 0, wrong: 0, unlinked: 0, n: 0}, unjustified_clarify: 0, bind_rows: 0, errors: 0};
    const latencies = [], examples = [], byLanguage = {};
    for (const row of rows) {
      const started = performance.now();
      let compiled = null;
      try { compiled = compileDeclarative(cache[row.id].sop, {inputText: row.question, lexicon, schema: lexicon.predicates, dictionary, language: row.language ?? 'en', ...(process.env.LINK_NOFRAMES ? {frames: false} : {})}); } catch (error) { t.errors++; compiled = {linking: [], issues: [], error: String(error.message).slice(0, 100)}; }
      latencies.push(performance.now() - started);
      const o = judgeRow(row, compiled, id => Boolean(lexicon.predicates[id]));
      // The core is English-only (owner decision 2026-10-01): the per-language split shows what the English rows alone score.
      if (!row.gold.ask && !['none', 'ambiguous'].includes(row.gold.relation)) { const l = byLanguage[row.language ?? 'en'] ??= {n: 0, correct: 0, wrong: 0, asked: 0}; l.n++; if (o.relation === 'correct') l.correct++; if (o.relation === 'wrong') l.wrong++; if (o.asked) l.asked++; }
      if (row.gold.ask || row.gold.relation === 'ambiguous') { t.ask.n++; t.ask[o.relation]++; }
      else if (row.gold.relation === 'none') { t.none.n++; t.none[o.relation]++; }
      else {
        t.relation.n++; t.relation[o.relation]++; t.bind_rows++; if (o.ungrounded) t.wrong_ungrounded++; if (o.lenient === 'correct') t.lenient_correct++;
        if (o.asked) t.unjustified_clarify++;
        // Rows the author wrote as ambiguous but the judges found answerable: informational, not a gold ask.
        if (row.kind === 'ambiguous') { const a = t.author_ambiguous; a.n++; if (o.asked) a.asked++; else if (o.relation === 'correct' || o.relation === 'wrong') a.silent++; }
      }
      for (const e of o.entities) { t.entity.n++; t.entity[e]++; }
      if ((o.relation === 'wrong' || o.relation === 'silent_guess' || o.entities.includes('wrong')) && examples.length < 400) examples.push({id: row.id, question: row.question, gold: row.gold.relation, got: (compiled.linking ?? []).map(e => `${e.kind}:${e.surface}->${e.symbol}`), outcome: o.relation, entities: o.entities});
    }
    latencies.sort((a, b) => a - b);
    const wrong = t.relation.wrong + t.none.wrong + t.ask.silent_guess + t.entity.wrong, labelled = t.relation.n + t.none.n + t.ask.n + t.entity.n;
    report.arms[arm] = {
      relation_accuracy: wilson(t.relation.correct, t.relation.n), relation_accuracy_lenient: wilson(t.lenient_correct, t.relation.n), relation_wrong: wilson(t.relation.wrong, t.relation.n), relation_wrong_with_facts: wilson(t.relation.wrong - t.wrong_ungrounded, t.relation.n), relation_abstain: wilson(t.relation.abstain + t.relation.no_program, t.relation.n),
      entity_accuracy: wilson(t.entity.correct, t.entity.n), entity_wrong: wilson(t.entity.wrong, t.entity.n), entity_unlinked: wilson(t.entity.unlinked, t.entity.n),
      unjustified_clarification: wilson(t.unjustified_clarify, t.bind_rows), justified_clarification: wilson(t.ask.justified_clarify + t.ask.bound_reported, t.ask.n), silent_guess_on_ambiguous: wilson(t.ask.silent_guess, t.ask.n),
      abstain_on_none: wilson(t.none.abstain, t.none.n), wrong_link_rate: wilson(wrong, labelled),
      by_language: Object.fromEntries(Object.entries(byLanguage).map(([k, v]) => [k, {...v, relation_accuracy: +(v.correct / v.n).toFixed(4), wrong_rate: +(v.wrong / v.n).toFixed(4), unjustified_clarification: +(v.asked / v.n).toFixed(4)}])), latency_ms: {p50: +latencies[Math.floor(latencies.length / 2)].toFixed(1), p95: +latencies[Math.floor(latencies.length * 0.95)].toFixed(1)}, compile_errors: t.errors, counts: t, wrong_examples: examples,
    };
    console.error(arm, JSON.stringify({rel: report.arms[arm].relation_accuracy.rate, wrong: report.arms[arm].wrong_link_rate.rate, ent: report.arms[arm].entity_accuracy.rate}));
  }
  configureLinker(ARMS.scored);
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, `open${half === 'all' ? '' : '-' + half}${stage === 'all' ? '' : '-' + stage}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.arms).map(([k, v]) => [k, {relation: v.relation_accuracy.rate, wrong: v.wrong_link_rate.rate, entity: v.entity_accuracy.rate, unjustified: v.unjustified_clarification.rate}]))));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'run') await run(); else { console.error('usage: linking-open.mjs run [--parts 2,3] [--arms …] [--stage …]'); process.exit(2); }
}
