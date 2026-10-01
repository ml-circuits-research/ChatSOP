#!/usr/bin/env node
/**
 * LLM judge of the query meaning (owner priority 2026-10-01; routing: Grok first, GLM second, a disagreement is reported
 * as excusable ambiguity). The judge sees the message and the SOP that SymbolicLM wrote and says whether the query wires
 * express the meaning of the question(s): good, partial or wrong. Items are a stratified sample per question form, each
 * judged under two conditions (`before`: the rules v2.6 output, `after`: v2.7) so the table can show the change.
 *
 *   node tools/eval/query-surface/judge.mjs prepare [--per-form 8] [--shards 3]   writes datasets_sources/query_rules_judge_{grok,glm1..}/
 *   node tools/eval/query-surface/judge.mjs collect                               reads the verdicts and writes judged.json + the table
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeFolder, loadAnswers} from '../decomposition/omp-folder.mjs';
import {FORMS} from './forms.mjs';
import {PROBES} from './probes.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/query-rules');
const GROK = 'xai-oauth/grok-4.20-0309-non-reasoning', GLM = 'zai/glm-5.3-flash';

const SYSTEM = `You judge one formalization of a user message into SOP query wires. The formalizer reads the message and writes one keyword per line.

The language (compact): "@id query" is a question; "where match ... end" blocks hold one proposition each (relation phrase, "role subject|object|recipient|location|source|destination|instrument|time|topic VALUE", polarity affirmed|negated); values are quoted strings or ?variables; "select ?x" asks for the values of a variable; "all/any/end" groups combine blocks. Query "mode" is one of: (absent) which bindings or yes/no, exists, count (how many), explain (why), every (a universal question: "where" is the restriction, "scope" what must hold for each member, optional "quantifier" and "select" for groups), why_not (what blocks a claim that does not hold: the claim is written affirmed), plan (how is the goal reached: the goal is the match), abduce (what could explain an observation: the observation is the match; a noun observation is the subject of "occur"), conform (was a procedure followed or a thing compliant), procedure (what is the procedure for a task). Other query lines: "compare ?v above|below|at_least|at_most|equal|not_equal N", "rank highest|lowest ?v", "except ?x \\"Name\\"", "order ?t1 before ?t2", "measure start|end|duration", "at|during|overlaps \\"time\\"" (overlaps: at some instant of the period), "if $s1" (the question is asked under the supposition wire s1), "fragment follow_up". "@s stated" is a statement of the message (certainty asserted|hedged|supposed), "@a assumed" is something the formalizer adds (basis implicature = presupposition of "still/again", disambiguation, closure, default, world), "unparsed" is a span it could not formalize, "unclear" means unintelligible. The formalizer does not translate and keeps the message's words; relation phrases may differ in wording (for example "have the flu shot" or "have" with the object "the flu shot") and that is NOT an error.

Judge only whether the QUERY wires express what the message asks: the right question form and mode, the right asked variable, the right entities and roles, the right polarity, nothing important dropped or invented, and statements of the message kept as stated wires. Use:
- "good": the question is captured (small wording differences are fine);
- "partial": the form is right but a role, relation, polarity, time or restriction is wrong or missing, or something material is extra;
- "wrong": it asks a different question, has the wrong form (for example a yes/no for a "how many"), is garbage, or no query where a question was asked.
If a message has several questions, all must be captured to be "good". If the message is truly ambiguous and the formalization picks a plausible reading, answer "good".

Answer with one JSON object only: {"verdict": "good" | "partial" | "wrong", "form_ok": true | false, "reason": "<one short sentence>"}.`;

const read = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

/** Stratified sample: `perForm` items per primary form from the tuning corpora, all probes of the new forms. */
function sample(perForm) {
  const before = read(path.join(OUT, 'results-before.jsonl'));
  const after = new Map(read(path.join(OUT, 'results-after.jsonl')).map(r => [r.id + '|' + r.set, r]));
  const items = new Map(read(path.join(OUT, 'items.jsonl')).map(r => [r.id + '|' + r.set, r]));
  const chosen = [];
  for (const form of FORMS) {
    // short messages only: the judge looks at the question, not at a pile of unrelated statements
    const pool = before.filter(r => r.primary === form && r.set !== 'natural' && r.emits_query && items.get(r.id + '|' + r.set).message.length <= 170);
    // deterministic spread: half the rows whose SOP changed, half unchanged, by stride over the id order
    const changed = pool.filter(r => after.get(r.id + '|' + r.set)?.sop !== r.sop), same = pool.filter(r => after.get(r.id + '|' + r.set)?.sop === r.sop);
    const take = (list, n) => { const step = Math.max(1, Math.floor(list.length / Math.max(n, 1))); return Array.from({length: Math.min(n, list.length)}, (_, i) => list[i * step]); };
    const picks = [...take(changed, Math.ceil(perForm / 2)), ...take(same, perForm - Math.min(Math.ceil(perForm / 2), changed.length))];
    for (const r of picks) { const key = r.id + '|' + r.set; chosen.push({id: key, form, message: items.get(key).message, before: r.sop, after: after.get(key).sop}); }
  }
  return chosen;
}

async function probes() {
  const {runProbes} = await import('./probe-run.mjs');
  const after = await runProbes();
  // the v2.6 output of the same parses, from the frozen rules snapshot
  const {loadFrozenRules} = await import('../../research/proofing-oracle.mjs');
  const rules = await loadFrozenRules('v2.6');
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/query-forms/parses.json'), 'utf8')).parses;
  return after.map(p => {
    const parse = fixture['en|' + rules.maskMessage(p.message)];
    let was = '';
    try { was = rules.convertParse({...parse, language: 'en'}, p.message).sop; } catch (error) { was = '(crash) ' + error.message; }
    return {id: 'probe|' + p.message, form: p.form, message: p.message, before: was, after: p.sop};
  });
}

async function prepare(o) {
  const perForm = Number(o['per-form'] ?? 8), shards = Number(o.shards ?? 3);
  const chosen = [...sample(perForm), ...(await probes())];
  fs.writeFileSync(path.join(OUT, 'judge-items.json'), JSON.stringify(chosen, null, 1) + '\n');
  const user = (c, cond) => `Message:\n${c.message}\n\nFormalization:\n${(cond === 'before' ? c.before : c.after).trim()}`;
  const all = chosen.flatMap(c => ['before', 'after'].map(cond => ({id: `${c.id}#${cond}`, user: user(c, cond)})));
  const folders = [];
  folders.push(makeFolder('query_rules_judge_grok', {system: SYSTEM, items: all, answerKey: 'verdict', title: 'judge query formalizations', model: GROK}));
  for (let s = 0; s < shards; s++) folders.push(makeFolder(`query_rules_judge_glm${s + 1}`, {system: SYSTEM, items: all.filter((_, i) => i % shards === s), answerKey: 'verdict', title: 'judge query formalizations', model: GLM}));
  console.log(JSON.stringify({items: chosen.length, judgements: all.length, folders}));
}

const verdicts = name => loadAnswers(name, 'verdict');

function collect() {
  const chosen = JSON.parse(fs.readFileSync(path.join(OUT, 'judge-items.json'), 'utf8'));
  const grok = verdicts('query_rules_judge_grok');
  const glm = new Map();
  for (let s = 1; s <= 9; s++) for (const [k, v] of verdicts(`query_rules_judge_glm${s}`)) glm.set(k, v);
  const score = {good: 1, partial: 0.5, wrong: 0};
  const rows = [];
  for (const c of chosen) for (const cond of ['before', 'after']) {
    const id = `${c.id}#${cond}`, g = grok.get(id)?.verdict ?? null, z = glm.get(id)?.verdict ?? null;
    rows.push({id: c.id, form: c.form, cond, grok: g, glm: z, agree: g && z ? g === z : null});
  }
  const table = {};
  for (const r of rows) {
    const t = (table[r.form] ??= {before: {n: 0, good: 0, both_good: 0, disagree: 0}, after: {n: 0, good: 0, both_good: 0, disagree: 0}});
    const s = t[r.cond];
    s.n++;
    if (r.grok === 'good') s.good++;
    if (r.grok === 'good' && r.glm === 'good') s.both_good++;
    if (r.agree === false) s.disagree++;
  }
  fs.writeFileSync(path.join(OUT, 'judged.json'), JSON.stringify({rows, table, scored: {grok: grok.size, glm: glm.size}}, null, 1) + '\n');
  const pct = (a, n) => (n ? `${(100 * a / n).toFixed(0)}%` : '-');
  const lines = ['| form | judged items | Grok good, before | Grok good, after | both judges good, before | both judges good, after | judge disagreements (before / after) |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const [form, t] of Object.entries(table)) lines.push(`| ${form} | ${t.after.n} | ${pct(t.before.good, t.before.n)} | ${pct(t.after.good, t.after.n)} | ${pct(t.before.both_good, t.before.n)} | ${pct(t.after.both_good, t.after.n)} | ${t.before.disagree} / ${t.after.disagree} |`);
  console.log(lines.join('\n'));
  console.log(`\nverdicts read: Grok ${grok.size}, GLM ${glm.size}; unused ${score ? '' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const o = {};
  for (let i = 3; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) o[process.argv[i].slice(2)] = process.argv[i + 1];
  (cmd === 'prepare' ? prepare(o) : cmd === 'collect' ? Promise.resolve(collect()) : Promise.reject(Error('usage: prepare|collect'))).catch(e => { console.error(e.stack); process.exitCode = 1; });
}
