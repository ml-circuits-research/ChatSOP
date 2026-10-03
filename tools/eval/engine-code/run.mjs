#!/usr/bin/env node
/**
 * Multi-engine code formalization (proposal P-7, owner authorization 2026-10-03): for each problem routed to computation, one call asks
 * the model for the solution in several engine languages at once (JS, ASP, SMT-LIB, Prolog), each program is run in its sandbox
 * (lib/formalize/engine-code), and two DIFFERENT languages that give the same answers count as a verified answer. Evaluation harness
 * only; book text stays local under state/.
 *
 *   node tools/eval/engine-code/run.mjs --run engine-fresh-50 --from js-fresh-50 [--tier tiny] [--limit 10] [--concurrency 4]
 *
 * --from: a structure-formalizer run whose ids.json and structure rows (psm:structure-tiny) give the problems and their route.
 * Writes state/engine-code/<run>/{raw.jsonl,results.jsonl,summary.md}; raw rows are resumable (one per problem and tier).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadItems} from '../books/sample.mjs';
import {routeOf} from '../../../lib/formalize/structure/route.mjs';
import {registryOf} from '../../../lib/formalize/expression-program.mjs';
import {runEngineCode} from '../../../lib/formalize/engine-code/index.mjs';
import {goldOf} from '../structure-formalizer/gold.mjs';
import {askedVerdict} from '../structure-formalizer/asked.mjs';
import {tierChat} from '../structure-formalizer/chat.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const run = arg('run', 'engine-fresh-50'), from = arg('from', 'js-fresh-50'), tier = arg('tier', 'tiny');
const OUT = path.join(ROOT, 'state/engine-code', run), FROM = path.join(ROOT, 'state/structure-formalizer', from);
const LANGS = (arg('langs', 'js,asp,smt,prolog')).split(',');

const CONTRACT = {
  js: 'JavaScript: the body of a function; the inputs are constants (const v1 = ...); end with `return` of the answer (a number, a boolean, a string, or an array when several values are asked). No I/O, no async.',
  asp: 'ASP (clingo): the inputs are facts v1(12). ... (numbers that are not integers appear as strings, so prefer integer reasoning or scale); define answer/1 (one atom per answered value). Integer division is `/` and remainder is `\\` in clingo. Use #minimize/#maximize for optimisation. No #script, no #include.',
  smt: 'SMT-LIB (Z3): the inputs are already defined constants v1, v2, ... (Int or Real); declare the result constants named exactly answer (or answer1, answer2 ... when several values are asked) with declare-const and constrain them with assert. Do not write check-sat or get-value. No include.',
  prolog: 'SWI-Prolog: the inputs are facts v1(12). ...; define answer/1 so that answer(X) gives each answered value. Only pure Prolog and arithmetic; no I/O, no shell, no assert.',
};

function prompt(item, registry) {
  const inputs = registry.map(v => `v${v.index} = ${v.value}   (${v.context})`).join('\n');
  return [
    `Problem:\n${item.question}`,
    '',
    `Inputs (the numbers of the problem, by name):\n${inputs || '(none)'}`,
    '',
    'Write a program that computes the answer FROM THESE INPUTS (never write the final number directly), once in each of these languages.',
    'The inputs v1, v2, ... are ALREADY DEFINED for you in every language: do not declare, define or assert them again.',
    ...LANGS.map(l => `- ${l}: ${CONTRACT[l]}`),
    '',
    `Reply with exactly one fenced code block per language, labelled with its name (${LANGS.map(l => '```' + l).join(', ')}), and nothing else.`,
  ].join('\n');
}

function blocks(text) {
  const out = {};
  for (const m of String(text).matchAll(/```\s*([A-Za-z-]+)\s*\n([\s\S]*?)```/g)) {
    const tag = m[1].toLowerCase(), lang = tag === 'javascript' ? 'js' : tag === 'smt2' || tag === 'smtlib' || tag === 'smt-lib' ? 'smt' : tag === 'clingo' || tag === 'lp' ? 'asp' : tag === 'pl' ? 'prolog' : tag;
    if (LANGS.includes(lang) && !out[lang]) out[lang] = m[2].trim();
  }
  return out;
}

/**
 * Structural normalization of a generated program against the inputs it was given: models often re-declare the inputs (const v1 = ...,
 * facts v1(12)., declare-const v1 + assert (= v1 12)). Those re-declarations are removed so the runner's own definitions stand
 * (a redefinition would be an error in JS and SMT and a duplicate in Prolog/ASP). Only exact input names are touched.
 */
function normalizeProgram(lang, code, names, inputs = {}) {
  const n = names.map(x => x.replace(/[^a-z0-9_]/gi, '')).join('|');
  if (!n) return code;
  // Prolog and ASP: an input used as a bare constant (X is v1 * v2) means its value; it is replaced by the number (a call v1(V)
  // keeps the fact). Structure only: exact input names, never followed by '('.
  const bare = text => text.replace(new RegExp(`\\b(${n})\\b(?!\\s*\\()`, 'g'), (m, name) => (lang === 'asp' && !Number.isInteger(inputs[name]) ? `"${inputs[name]}"` : String(inputs[name])));
  if (lang === 'js') return code.replace(new RegExp(`^\\s*(?:const|let|var)\\s+(?:${n})\\s*=\\s*[^;\\n]+;?\\s*$`, 'gm'), '');
  if (lang === 'asp' || lang === 'prolog') return bare(code.replace(new RegExp(`^\\s*(?:${n})\\(\\s*[^()]*\\)\\.\\s*$`, 'gm'), ''));
  if (lang === 'smt') return code.replace(new RegExp(`^\\s*\\(\\s*(?:declare-const|declare-fun|define-fun|define-const)\\s+(?:${n})\\b[^\\n]*$`, 'gm'), '')
    .replace(new RegExp(`^\\s*\\(\\s*assert\\s*\\(\\s*=\\s*(?:${n})\\s+[^()\\n]+\\)\\s*\\)\\s*$`, 'gm'), '');
  return code;
}

const numericValues = values => values.flat(Infinity).map(v => (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : v));
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a)) : a === b);
const agree = (a, b) => a.length > 0 && a.length === b.length && a.every(x => b.some(y => same(x, y)));

async function fetchPhase(items, problems) {
  fs.mkdirSync(OUT, {recursive: true});
  const file = path.join(OUT, 'raw.jsonl');
  const done = new Set(readJsonl(file).map(r => `${r.tier}|${r.id}`));
  const todo = problems.filter(p => !done.has(`${tier}|${p.id}`));
  let next = 0;
  const one = async ({id}) => {
    const item = items.get(id), registry = registryOf(item.question), chat = tierChat(tier, {purpose: 'job:engine-code', run, cache: null, timeoutMs: 1_800_000});
    const t0 = Date.now();
    const r = await chat([{role: 'system', content: 'You write small programs that compute the answer of a problem from its inputs. Reply with the code blocks only.'}, {role: 'user', content: prompt(item, registry)}], 3000);
    const code = r.ok ? blocks(r.text) : {};
    const runs = {};
    for (const lang of LANGS) {
      if (!code[lang]) { runs[lang] = {ok: false, code: 'code_missing'}; continue; }
      const inputs = Object.fromEntries(registry.map(v => [`v${v.index}`, v.value]));
      const x = await runEngineCode(lang, normalizeProgram(lang, code[lang], Object.keys(inputs), inputs), inputs);
      runs[lang] = x.ok ? {ok: true, values: [...new Set(numericValues(x.values).map(v => JSON.stringify(v)))].map(v => JSON.parse(v)), ms: x.ms} : {ok: false, code: x.code, message: x.message, ms: x.ms};
    }
    fs.appendFileSync(file, JSON.stringify({tier, id, ok: r.ok, reason: r.ok ? null : r.reason, code, runs, usage: chat.usage, ms: Date.now() - t0}) + '\n');
    process.stdout.write('.');
  };
  const worker = async () => { while (next < todo.length) await one(todo[next++]); };
  await Promise.all(Array.from({length: Math.min(Number(arg('concurrency', 4)), todo.length)}, worker));
  console.log(` fetched ${todo.length}`);
}

function score(items, problems) {
  const raw = readJsonl(path.join(OUT, 'raw.jsonl')).filter(r => r.tier === tier);
  const rows = [];
  for (const r of raw) {
    const item = items.get(r.id), gold = goldOf(item);
    if (!gold) continue;
    const per = {};
    for (const lang of LANGS) {
      const x = r.runs[lang];
      per[lang] = x?.ok ? askedVerdict(item, gold, x.values.map(value => ({kind: 'value', value}))).verdict : x?.code === 'code_missing' ? 'missing' : 'failed';
    }
    // Verified: the first pair of different languages whose answers agree; its answer is scored.
    let verified = null;
    for (let i = 0; i < LANGS.length && !verified; i++) for (let j = i + 1; j < LANGS.length && !verified; j++) {
      const a = r.runs[LANGS[i]], b = r.runs[LANGS[j]];
      if (a?.ok && b?.ok && agree(a.values, b.values)) verified = {pair: `${LANGS[i]}+${LANGS[j]}`, verdict: askedVerdict(item, gold, a.values.map(value => ({kind: 'value', value}))).verdict};
    }
    rows.push({id: r.id, book: item.book, per, verified, failures: Object.fromEntries(LANGS.map(l => [l, r.runs[l]?.ok ? null : r.runs[l]?.code ?? null]))});
  }
  fs.writeFileSync(path.join(OUT, 'results.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  const V = ['correct', 'partial', 'wrong', 'no_answer', 'gold_defect'];
  const cell = list => V.map(v => list.filter(x => x === v).length).join(' / ');
  const L = [`# Multi-engine code formalization: ${run} (tier ${tier}; ${rows.length} scorable routed problems from ${from})`, '',
    'Asked parts: correct / partial / wrong / no answer / gold defect; "failed" = refused or crashed in the sandbox, "missing" = no block.', '',
    '| language | asked parts | ran ok | failed | missing |', '|---|---|---|---|---|'];
  for (const lang of LANGS) {
    const vs = rows.map(r => r.per[lang]);
    L.push(`| ${lang} | ${cell(vs)} | ${vs.filter(v => V.includes(v)).length} | ${vs.filter(v => v === 'failed').length} | ${vs.filter(v => v === 'missing').length} |`);
  }
  const ver = rows.filter(r => r.verified), vc = ver.filter(r => r.verified.verdict === 'correct').length;
  const anyCorrect = rows.filter(r => LANGS.some(l => r.per[l] === 'correct')).length;
  L.push('', `Verified (two different languages agree): ${ver.length}/${rows.length}; of these correct ${vc}, partial ${ver.filter(r => r.verified.verdict === 'partial').length}, wrong ${ver.filter(r => r.verified.verdict === 'wrong').length}.`);
  L.push(`At least one language correct: ${anyCorrect}/${rows.length}.`);
  const pairs = {};
  for (const r of ver) pairs[r.verified.pair] = (pairs[r.verified.pair] ?? 0) + 1;
  L.push(`Agreeing pairs: ${Object.entries(pairs).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
  const reasons = {};
  for (const r of rows) for (const [l, c] of Object.entries(r.failures)) if (c && c !== 'code_missing') reasons[`${l}:${c}`] = (reasons[`${l}:${c}`] ?? 0) + 1;
  L.push(`Sandbox failures: ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
  fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
}

const items = new Map(loadItems(ROOT).map(i => [i.id, i]));
const ids = JSON.parse(fs.readFileSync(path.join(FROM, 'ids.json'), 'utf8')).ids;
const psm = new Map(readJsonl(path.join(FROM, 'raw.jsonl')).filter(r => r.arm === 'psm:structure-tiny').map(r => [r.id, r]));
let problems = ids.map(id => ({id, ...routeOf(psm.get(id)?.psm ?? null, items.get(id).question)})).filter(p => p.route === 'js');
if (arg('limit')) problems = problems.slice(0, Number(arg('limit')));
async function rerunPhase(items) {
  const file = path.join(OUT, 'raw.jsonl'), rows = readJsonl(file);
  for (const r of rows) {
    const registry = registryOf(items.get(r.id).question), inputs = Object.fromEntries(registry.map(v => [`v${v.index}`, v.value]));
    for (const lang of LANGS) {
      if (!r.code[lang]) continue;
      const x = await runEngineCode(lang, normalizeProgram(lang, r.code[lang], Object.keys(inputs), inputs), inputs);
      r.runs[lang] = x.ok ? {ok: true, values: [...new Set(numericValues(x.values).map(v => JSON.stringify(v)))].map(v => JSON.parse(v)), ms: x.ms} : {ok: false, code: x.code, message: x.message, ms: x.ms};
    }
  }
  fs.writeFileSync(file, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
}
if (process.argv.includes('--rerun')) await rerunPhase(items);
else if (!process.argv.includes('--score-only')) await fetchPhase(items, problems);
score(items, problems);
