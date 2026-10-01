#!/usr/bin/env node
/** Reusable judge of an automatic UD parse (experiment eval-parse-judge-haiku-v1).
 *
 * Input rows (JSONL): {id, message, analysis}. `analysis` is one of
 *   - a Stanza worker sentence      {words: [{id, text, lemma, upos, head, deprel, ner?}], text?}
 *   - a Stanza worker parse         {sentences: [<sentence>, ...]}  (every sentence is judged, the row takes the worst)
 *   - an array of sentences
 *   - a ready-made text rendering (string); it is passed to the judge unchanged (condition c needs words, so it falls back to a)
 * Output rows (JSONL): {id, verdict, good_enough, condition, model, sentences: [{text, verdict, note, issues, cost_usd, ms}], cost_usd, ms}
 * where verdict is CORRECT | MINOR | INPUT_TYPO | DEEP | FAIL (worst sentence) and good_enough is true for
 * CORRECT/MINOR/INPUT_TYPO (the structure is usable).
 *
 * Conditions (the rubric is the rewritten rubric v1 of eval-symbolic-layers-en-v1, frozen in parse-judge-rubric-v1.txt):
 *   a   Haiku, no thinking, rubric + READING/ARCS rendering, one JSON verdict
 *   b   as a, with extended thinking (MAX_THINKING_TOKENS, default 2048)
 *   c   no thinking, rubric conventions + sentence + compact tree, six specific checks, final CORRECT/MINOR/DEEP
 *
 *   node tools/research/parse-judge.mjs --in rows.jsonl --out verdicts.jsonl [--condition a|b|c] [--model ID] [--thinking N]
 *        [--parallel 6] [--cache DIR] [--ledger FILE] [--budget USD] [--limit N]
 *
 * Calls go through headless `claude -p` (no tools, empty settings) like tools/research/text-to-clean-english-haiku.mjs.
 * Every answer is cached by the sha256 of the model, thinking budget, system prompt and message; a run never asks twice.
 * The judge is Haiku, not an oracle: see eval/reports/current/parse-judge/summary.md for its measured reliability and
 * the hybrid that is safe for gating (agreement of two parsers, then Haiku, then the stronger model on the rest).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const HAIKU = 'claude-haiku-4-5-20251001';
export const RUBRIC = fs.readFileSync(new URL('./parse-judge-rubric-v1.txt', import.meta.url), 'utf8').trim();
export const GOOD = new Set(['CORRECT', 'MINOR', 'INPUT_TYPO']);
const RANK = {CORRECT: 0, MINOR: 1, INPUT_TYPO: 2, DEEP: 3, FAIL: 4};
const sha = text => createHash('sha256').update(text).digest('hex');

// ------------------------------------------------------------------ renderings
const CLAUSAL = new Set(['root', 'advcl', 'acl', 'acl:relcl', 'ccomp', 'xcomp', 'csubj', 'csubj:pass', 'parataxis']);
const WH = new Set(['who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how']);

/** Clause-by-clause reading of a parse, derived mechanically from the arcs (same as symbolic-layers.mjs). */
export function renderReading(sentence) {
  const words = sentence.words;
  const kids = new Map(words.map(w => [w.id, []]));
  for (const w of words) if (w.head) kids.get(w.head)?.push(w);
  const isPredWord = w => ['VERB', 'AUX'].includes(w.upos) || kids.get(w.id)?.some(k => k.deprel === 'cop');
  const isPred = w => CLAUSAL.has(w.deprel) || (w.deprel === 'conj' && (isPredWord(w) || kids.get(w.id).some(k => /^(nsubj|csubj|cop|aux)/.test(k.deprel))));
  const subtree = (w, stop) => { const out = [w]; for (const k of kids.get(w.id)) if (!stop(k)) out.push(...subtree(k, stop)); return out; };
  const span = w => subtree(w, k => isPred(k) || k.deprel === 'punct').sort((a, b) => a.id - b.id).map(x => x.text).join(' ');
  const lines = [];
  words.filter(isPred).forEach((c, i) => {
    const head = c.head ? words.find(w => w.id === c.head) : null;
    const how = c.deprel === 'root' ? 'main clause' : `${c.deprel} clause attached to "${head?.text}" (${head?.id})`;
    const ks = kids.get(c.id);
    const mark = ks.filter(k => k.deprel === 'mark').map(k => k.text);
    const cop = ks.find(k => k.deprel === 'cop');
    const aux = ks.filter(k => /^aux/.test(k.deprel)).map(k => k.text);
    const neg = ks.filter(k => k.deprel === 'advmod' && /^(not|never|n't|no)$/i.test(k.lemma === 'not' ? 'not' : k.text)).map(k => k.text);
    const prt = ks.filter(k => k.deprel === 'compound:prt').map(k => k.text);
    lines.push(`Clause ${i + 1} [${how}]${mark.length ? ' introduced by "' + mark.join(' ') + '"' : ''}: predicate "${c.text}" (${c.id}, lemma ${c.lemma}${prt.length ? ' + particle ' + prt.join(' ') : ''}, ${c.upos})${cop ? ' with copula "' + cop.text + '"' : ''}${aux.length ? ', aux: ' + aux.join(' ') : ''}${neg.length ? ', NEGATED by "' + neg.join(' ') + '"' : ''}`);
    for (const k of ks) {
      if (/^(nsubj|csubj)/.test(k.deprel)) lines.push(`   ${k.deprel === 'nsubj:pass' ? 'passive subject' : 'subject'}: "${span(k)}" (head ${k.text} ${k.id})`);
      else if (k.deprel === 'obj') lines.push(`   object: "${span(k)}" (head ${k.text} ${k.id})`);
      else if (k.deprel === 'iobj') lines.push(`   indirect object: "${span(k)}" (head ${k.text} ${k.id})`);
      else if (/^obl/.test(k.deprel)) { const cs = kids.get(k.id).filter(x => x.deprel === 'case').map(x => x.text); lines.push(`   oblique${cs.length ? ' [' + cs.join(' ') + ']' : ''} (${k.deprel}): "${span(k)}" (head ${k.text} ${k.id})`); }
      else if (k.deprel === 'expl') lines.push(`   expletive: "${k.text}"`);
      else if (k.deprel === 'advmod' && !neg.includes(k.text)) lines.push(`   adverb: "${span(k)}"`);
    }
  });
  for (const n of words.filter(w => /^nmod/.test(w.deprel))) { const h = words.find(w => w.id === n.head); const cs = kids.get(n.id).filter(x => x.deprel === 'case').map(x => x.text); lines.push(`Noun attachment (${n.deprel}): "${span(n)}"${cs.length ? ' [' + cs.join(' ') + ']' : ''} modifies "${h?.text}" (${h?.id})`); }
  for (const c of words.filter(w => w.deprel === 'conj' && !isPred(w))) { const h = words.find(w => w.id === c.head); lines.push(`Coordination: "${c.text}" (${c.id}) coordinated with "${h?.text}" (${h?.id})`); }
  for (const w of words.filter(x => WH.has(x.text.toLowerCase()))) { const h = words.find(x => x.id === w.head); lines.push(`Question/relative word "${w.text}" (${w.id}): ${w.deprel} of "${h?.text ?? 'ROOT'}"`); }
  const ents = []; let cur = null;
  for (const w of words) { const tag = w.ner ?? 'O'; if (tag === 'O') { cur = null; continue; } if (/^[BS]-/.test(tag) || !cur) { cur = {type: tag.slice(2), words: [w.text]}; ents.push(cur); } else cur.words.push(w.text); if (/^[ES]-/.test(tag)) cur = null; }
  if (ents.length) lines.push('Named entities: ' + ents.map(e => `"${e.words.join(' ')}" ${e.type}`).join('; '));
  return lines.join('\n');
}

/** READING + ARCS rendering (conditions a and b). */
export function renderFull(sentence) {
  const byId = new Map(sentence.words.map(w => [w.id, w]));
  const lines = sentence.words.map(w => `${String(w.id).padStart(2)}  ${w.text}  lemma=${w.lemma}  ${w.upos}  head=${w.head === 0 ? 'ROOT' : `${w.head}:${byId.get(w.head)?.text ?? '?'}`}  ${w.deprel}${w.ner && w.ner !== 'O' ? '  NER=' + w.ner : ''}`);
  return 'READING (derived from the arcs):\n' + renderReading(sentence) + '\n\nARCS (index form lemma UPOS head relation NER):\n' + lines.join('\n');
}

/** Compact indented dependency tree (condition c): one line per word, children in sentence order. */
export function renderTree(sentence) {
  const words = sentence.words;
  const kids = new Map(words.map(w => [w.id, []]));
  const roots = [];
  for (const w of words) (w.head && kids.has(w.head) ? kids.get(w.head) : roots).push(w);
  const out = [];
  const walk = (w, depth) => {
    const ner = w.ner && w.ner !== 'O' ? ` [${w.ner.replace(/^[BIES]-/, '')}]` : '';
    out.push(`${'  '.repeat(depth)}${w.deprel} ${w.text}/${w.id} ${w.upos}${ner}`);
    for (const k of kids.get(w.id)) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out.join('\n');
}

// ------------------------------------------------------------------ prompts
const CONVENTIONS = RUBRIC.split('\nAnswer with ONE JSON object')[0];

export const CHECK_SYSTEM = `${CONVENTIONS}

PROCEDURE. You get the sentence and a compact dependency tree (one line per word: relation, word/index, UPOS, optional entity type; indentation shows the head). Read the sentence yourself first, then check the tree against it on exactly these six points, and only then give the final label. Apply the UD v2 conventions above: a defensible convention is never an error.
1. root: is the root the right predicate (or predicate nominal/adjective under the copula convention)?
2. subject: is every subject attached to the right predicate, with the right voice (nsubj vs nsubj:pass)?
3. object: are direct/indirect objects attached to the right predicate?
4. clause_attachment: is every subordinate, relative, complement and coordinated clause attached to the right head, and is negation on the right clause?
5. pp_attachment: is every prepositional phrase attached to the head it modifies (verb vs noun; consistent with the meaning of the sentence)?
6. coordination: does every conjunction join the right conjuncts, with the right scope?
Each check is "ok", "na" (does not occur) or "wrong: <the arc and why>". Only a wrong check that changes who did what to whom, the polarity, the clause structure or the question target counts toward DEEP; a wrong label that changes none of these is MINOR.

Answer with ONE JSON object and nothing else, no Markdown:
{"root": "ok|na|wrong: ...", "subject": "...", "object": "...", "clause_attachment": "...", "pp_attachment": "...", "coordination": "...", "verdict": "CORRECT|MINOR|DEEP", "note": "<one sentence>"}
CORRECT: no wrong check and no label issue. MINOR: only harmless label differences. DEEP: at least one wrong check that changes the logical form, or no usable structure.`;

export const judgeMessage = (sentenceText, rendering) => `SENTENCE: ${sentenceText}\n\nPARSE:\n${rendering}`;
export const checkMessage = (sentenceText, tree) => `SENTENCE: ${sentenceText}\n\nTREE:\n${tree}`;

export function parseVerdict(text, condition) {
  const raw = String(text ?? '').replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1));
    if (!(j.verdict in RANK)) return null;
    if (condition === 'c') j.checks = Object.fromEntries(['root', 'subject', 'object', 'clause_attachment', 'pp_attachment', 'coordination'].map(k => [k, j[k] ?? null]));
    return j;
  } catch { return null; }
}

// ------------------------------------------------------------------ claude calls
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-judge-'));
let pauseUntil = 0;
export function callClaude({system, message, model = HAIKU, thinking = 0, timeoutMs = 240000}) {
  return new Promise(resolve => {
    const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--system-prompt', system,
      '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'];
    const child = spawn('claude', args, {cwd: scratch, env: {...process.env, MAX_THINKING_TOKENS: String(thinking)}, stdio: ['pipe', 'pipe', 'pipe']});
    child.stdin.end(message);
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('close', code => { clearTimeout(timer); resolve({code, out, err}); });
  });
}

/** One cached, budget-checked call: {ok, text, cost_usd, ms, api_ms, usage, cached}. */
export async function cachedCall({dir, system, message, model = HAIKU, thinking = 0, ledger = null}) {
  const key = sha([model, thinking, system, message].join('\u0000'));
  const file = path.join(dir, key + '.json');
  if (fs.existsSync(file)) { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (c.ok) return {...c, cached: true}; }
  fs.mkdirSync(dir, {recursive: true});
  for (let attempt = 0; attempt < 4; attempt++) {
    if (ledger?.exceeded()) return {ok: false, error: 'budget exhausted'};
    while (Date.now() < pauseUntil) await new Promise(r => setTimeout(r, 1000));
    const t = performance.now();
    const {code, out, err} = await callClaude({system, message, model, thinking});
    let data = null;
    try { data = JSON.parse(out); } catch { /* not JSON */ }
    if (data && !data.is_error && typeof data.result === 'string') {
      const record = {ok: true, model, thinking, key, text: data.result, cost_usd: data.total_cost_usd ?? 0, ms: performance.now() - t, api_ms: data.duration_api_ms ?? null, usage: data.usage ?? null, date: new Date().toISOString()};
      fs.writeFileSync(file, JSON.stringify(record) + '\n');
      ledger?.add(record.cost_usd, {model, thinking, key});
      return record;
    }
    const why = (data?.result ?? err ?? '').slice(0, 300);
    if (/rate|limit|overload|429|529/i.test(why)) pauseUntil = Date.now() + 30000 * (attempt + 1);
    if (attempt === 3) return {ok: false, error: `exit ${code}: ${why}`};
  }
  return {ok: false, error: 'unreachable'};
}

/** A JSON ledger of every paid call with a hard cap. */
export class Ledger {
  constructor(file, cap) { this.file = file; this.cap = cap; this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {cap_usd: cap, total_usd: 0, calls: 0, by_label: {}}; }
  exceeded() { return this.data.total_usd >= this.cap; }
  add(cost, meta) {
    this.data.total_usd = Number((this.data.total_usd + cost).toFixed(6)); this.data.calls++;
    const label = `${meta.model}${meta.thinking ? '+think' + meta.thinking : ''}`;
    const l = this.data.by_label[label] ??= {calls: 0, usd: 0};
    l.calls++; l.usd = Number((l.usd + cost).toFixed(6));
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1) + '\n');
  }
}

export async function pool(items, parallel, fn) {
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({length: Math.min(parallel, items.length)}, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } }));
  return results;
}

// ------------------------------------------------------------------ judging
/** The sentences of an `analysis`: [{text, sentence?, rendering?}]. */
export function sentencesOf(row) {
  const a = row.analysis;
  const wordsText = s => s.text ?? s.words.map(w => w.text).join(' ');
  if (typeof a === 'string') return [{text: row.message, rendering: a}];
  const list = Array.isArray(a) ? a : a?.sentences ? a.sentences : a?.words ? [a] : [];
  return list.filter(s => s.words?.length).map(s => ({text: wordsText(s), sentence: s}));
}

/** Judge one sentence unit under a condition; returns {verdict, note, issues, cost_usd, ms, raw}. */
export async function judgeUnit(unit, {condition = 'a', model = HAIKU, thinking = 2048, dir, ledger = null}) {
  const useCheck = condition === 'c' && unit.sentence;
  const system = useCheck ? CHECK_SYSTEM : RUBRIC;
  const message = useCheck ? checkMessage(unit.text, renderTree(unit.sentence)) : judgeMessage(unit.text, unit.rendering ?? renderFull(unit.sentence));
  const r = await cachedCall({dir, system, message, model, thinking: condition === 'b' ? thinking : 0, ledger});
  const parsed = r.ok ? parseVerdict(r.text, useCheck ? 'c' : 'a') : null;
  return {text: unit.text, verdict: parsed?.verdict ?? null, note: parsed?.note ?? null, issues: parsed?.issues ?? null, checks: parsed?.checks ?? null, unusable: !parsed, cost_usd: r.cost_usd ?? 0, ms: r.ms ?? null, api_ms: r.api_ms ?? null, cached: Boolean(r.cached), error: r.error ?? null};
}

/** Judge rows {id, message, analysis}; returns verdict rows. */
export async function judgeRows(rows, opts = {}) {
  const {parallel = 6} = opts;
  return pool(rows, parallel, async row => {
    const units = sentencesOf(row);
    const judged = [];
    for (const u of units) judged.push(await judgeUnit(u, opts));
    const usable = judged.filter(j => j.verdict);
    const worst = usable.length ? usable.reduce((a, b) => (RANK[b.verdict] > RANK[a.verdict] ? b : a)).verdict : null;
    return {id: row.id, verdict: worst, good_enough: worst ? GOOD.has(worst) : null, condition: opts.condition ?? 'a', model: opts.model ?? HAIKU, sentences: judged, cost_usd: judged.reduce((s, j) => s + j.cost_usd, 0), ms: judged.reduce((s, j) => s + (j.ms ?? 0), 0)};
  });
}

async function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  if (!args.in || !args.out) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 28).join('\n')); return; }
  let rows = fs.readFileSync(path.resolve(args.in), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  if (args.limit) rows = rows.slice(0, Number(args.limit));
  const condition = args.condition ?? 'a';
  const ledger = new Ledger(path.resolve(args.ledger ?? path.join(ROOT, 'eval/reports/current/parse-judge/ledger.json')), Number(args.budget ?? 15));
  const dir = path.resolve(args.cache ?? path.join(ROOT, 'eval/reports/current/parse-judge/cache'));
  const out = await judgeRows(rows, {condition, model: args.model ?? HAIKU, thinking: Number(args.thinking ?? 2048), parallel: Number(args.parallel ?? 6), dir, ledger});
  fs.mkdirSync(path.dirname(path.resolve(args.out)), {recursive: true});
  fs.writeFileSync(path.resolve(args.out), out.map(r => JSON.stringify(r)).join('\n') + '\n');
  const dist = out.reduce((a, r) => ({...a, [r.verdict ?? 'unusable']: (a[r.verdict ?? 'unusable'] ?? 0) + 1}), {});
  console.log(JSON.stringify({rows: out.length, verdicts: dist, cost_usd: Number(out.reduce((s, r) => s + r.cost_usd, 0).toFixed(4)), ledger_total_usd: ledger.data.total_usd}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
