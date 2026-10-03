#!/usr/bin/env node
/**
 * A/B of the PSM and LFM backends on the same book problems (owner, 2026-10-03: before any training, test `tiny` with role prompts and
 * off-the-shelf NL-to-FOL models). Every arm calls a tier of LLMAPIProvider with the same endpoint contract; the converters and the
 * scoring are those of the zero-shot probe (./score.mjs). Offline evaluation harness; book text stays local.
 *
 *   node tools/eval/structure-formalizer/ab.mjs fetch --run ab-1 --ids-from probe-1 [--arms a,b,...]
 *   node tools/eval/structure-formalizer/ab.mjs score --run ab-1
 *
 * Arms
 *   psm:<tier>              the structure tier on the problem text (schema config/formalize/psm-schema-v1.json)
 *   lfm:<tier>[:k]          the formalizer tier on the problem's sentences, k candidates (default 1), no inventory
 *   combo:<psmTier>+<lfmTier>   the formalizer with the inventory rendered from that structure tier's extraction
 *   expr:<tier>             the compute path B (lib/formalize/expression-program.mjs) asked of that chat tier: one closed question,
 *                           static analysis (the answer must reach the problem's numbers through the dataflow), lowering to SOP,
 *                           executed by the engines; prompt variant a, no exemplars (the same question for every model)
 *   expr:<tier>:reason      the same for a cloud tier with reasoning (OpenRouter effort medium, a 32000-token budget)
 *   expr:<tier>:think       the same with thinking on (the models' recommended thinking sampling: temperature 0.6, top_p 0.95,
 *                           top_k 20); a reply cut by its budget is asked again with four times the budget, up to 32000 tokens
 * `--limit N` takes the first N problems only. `--concurrency N` keeps N problems of an arm in flight, `--parallel-arms` runs the arms side by side (seconds per problem are then
 * measured under that load and the rows carry `load`).
 * Calls are tagged job:psm-lfm-ab (or `--purpose job:<name>`) and cached by the proxy except where `--fresh` is given (then timed
 * uncached: cache record). The model A/B of 2026-10-03 (MoE vs tiny) uses `--run moe-ab --purpose job:moe-ab`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadItems} from '../books/sample.mjs';
import {extractStructure, formalizeFol} from '../../../lib/formalize/small-models.mjs';
import {sentencesOf} from '../../../lib/formalize/fol/input.mjs';
import {loadSchema, schemaRequest, inventoryText} from '../../../lib/formalize/structure/schema.mjs';
import {registryOf, expressionFormalize} from '../../../lib/formalize/expression-program.mjs';
import {executeQueries} from '../../../lib/formalize/dual-check.mjs';
import {decide} from '../../../lib/formalize/equivalence.mjs';
import {psmScore, lfmArm} from './score.mjs';
import {goldOf} from './gold.mjs';
import {engines} from './engines.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const run = arg('run', 'ab-1');
const OUT = path.join(ROOT, 'state/structure-formalizer', run);
const DEFAULT_ARMS = ['psm:structure-gliner', 'psm:structure-tiny', 'lfm:formalizer-t5:3', 'lfm:formalizer-t5-3b:3', 'lfm:formalizer-tiny', 'lfm:formalizer-llama-fol', 'combo:structure-tiny+formalizer-tiny', 'combo:structure-gliner+formalizer-tiny'];

async function fetchPhase() {
  // `--limit N`: only the first N problems (a staged or capped run of a slow candidate).
  const ids = readJsonl(path.join(ROOT, 'state/structure-formalizer', arg('ids-from', 'probe-1'), 'raw.jsonl')).map(r => r.id).slice(0, Number(arg('limit', Infinity)));
  const items = new Map(loadItems(ROOT).map(i => [i.id, i]));
  const arms = (arg('arms') ?? DEFAULT_ARMS.join(',')).split(',');
  const opts = {purpose: arg('purpose', 'job:psm-lfm-ab'), run, cache: process.argv.includes('--fresh') ? 'record' : null, timeoutMs: 1_800_000};
  const schema = loadSchema();
  fs.mkdirSync(OUT, {recursive: true});
  const file = path.join(OUT, 'raw.jsonl');
  const done = new Set(readJsonl(file).map(r => `${r.arm}|${r.id}`));
  // `--concurrency N`: N problems of an arm in flight at once; `--parallel-arms`: the arms run side by side (e.g. a cloud tier next to
  // a local one). Rows are appended as they complete; seconds per problem are then measured under that load.
  const concurrency = Math.max(1, Number(arg('concurrency', 1))), parallelArms = process.argv.includes('--parallel-arms');
  const psmCache = new Map();
  const psm = (tier, item) => {
    const k = `${tier}|${item.id}`;
    if (!psmCache.has(k)) psmCache.set(k, extractStructure({...schemaRequest(schema, item.question), model: tier}, opts));
    return psmCache.get(k);
  };
  const runArm = async arm => {
    const [kind, spec, k] = arm.split(':');
    const todo = ids.filter(id => !done.has(`${arm}|${id}`));
    let next = 0;
    const one = async id => {
      const item = items.get(id), units = sentencesOf(item.question);
      let row;
      if (kind === 'psm') { const r = await psm(spec, item); row = {psm: r.ok ? r.body : {error: r.reason}, ms: r.ms, cached: r.cached}; }
      else if (kind === 'expr') {
        const chat = tierChat(spec, {...opts, thinking: k ?? null}), t0 = Date.now();
        const e = await expressionFormalize({message: item.question, chat, exemplars: []});
        row = {expr: {status: e.status, attempts: e.attempts.map(a => ({answer: a.answer, reason: a.reason, violations: a.violations})), sop: e.lowered?.sop ?? null,
          answers: e.analysis?.program?.answers ?? null}, usage: chat.usage, ms: Date.now() - t0, cached: chat.calls > 0 && chat.hits === chat.calls};
      } else {
        const [psmTier, lfmTier] = kind === 'combo' ? spec.split('+') : [null, spec];
        const p = psmTier ? await psm(psmTier, item) : null;
        const context = p?.ok ? {inventory: inventoryText(p.body)} : undefined;
        const r = await formalizeFol({model: lfmTier, inputs: units.map(u => u.text), candidates: Number(k ?? 1), ...(context ? {context} : {})}, opts);
        row = {lfm: r.ok ? r.body.results : {error: r.reason}, ms: r.ms + (p?.ok && !p.cached ? p.ms : 0), cached: r.cached, psm: p?.ok ? p.body : null, extra: r.ok ? {dropped: r.body.dropped, unresolved: r.body.unresolved, reasks: r.body.reasks, usage: r.body.usage ?? null} : null};
      }
      fs.appendFileSync(file, JSON.stringify({arm, id, units, ...row, ...(concurrency > 1 || parallelArms ? {load: {concurrency, parallelArms}} : {})}) + '\n');
      process.stdout.write('.');
    };
    const worker = async () => { while (next < todo.length) await one(todo[next++]); };
    await Promise.all(Array.from({length: Math.min(concurrency, todo.length)}, worker));
    console.log(` ${arm}`);
  };
  if (parallelArms) await Promise.all(arms.map(runArm));
  else for (const arm of arms) await runArm(arm);
}

/** A chat client of a proxy tier for the expression path: greedy, no thinking, no fallback, tagged; counts the cache hits. */
function tierChat(tier, {purpose, run: runId, cache, timeoutMs, thinking = null}) {
  const PROXY = (process.env.LLMAPIPROVIDER_URL ?? 'http://127.0.0.1:18080/v1').replace(/\/+$/, '');
  // think: a local thinking model with its recommended sampling; reason: a cloud tier's reasoning (OpenRouter effort medium).
  const sampling = thinking === 'think' ? {temperature: 0.6, top_p: 0.95, top_k: 20, chat_template_kwargs: {enable_thinking: true}}
    : thinking === 'reason' ? {temperature: 0, reasoning: {effort: 'medium'}} : {temperature: 0, chat_template_kwargs: {enable_thinking: false}};
  const once = async (messages, maxTokens) => {
    chat.calls++;
    try {
      const r = await fetch(`${PROXY}/chat/completions`, {method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: {'content-type': 'application/json', 'x-llmapiprovider-purpose': purpose, 'x-llmapiprovider-run': runId, 'x-llmapiprovider-no-fallback': '1', ...(cache ? {'x-llmapiprovider-cache': cache} : {})},
        body: JSON.stringify({model: tier, messages, max_tokens: maxTokens, stream: false, ...sampling})});
      if (r.headers.get('x-llmapiprovider-cache') === 'hit') chat.hits++;
      const body = await r.json().catch(() => null);
      if (!r.ok || !body) return {ok: false, reason: `${r.status} ${JSON.stringify(body?.error ?? '').slice(0, 200)}`};
      const m = body.choices?.[0]?.message ?? {};
      chat.usage.output_tokens += body.usage?.completion_tokens ?? 0; chat.usage.reasoning_tokens += body.usage?.completion_tokens_details?.reasoning_tokens ?? 0; chat.usage.reasoning_chars += (m.reasoning_content ?? '').length; chat.usage.content_chars += String(m.content ?? '').length;
      return {ok: true, finish: body.choices?.[0]?.finish_reason ?? null, text: String(m.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()};
    } catch (error) { return {ok: false, reason: String(error.message ?? error)}; }
  };
  // A reply cut by its budget is never used silently: asked again with four times the budget (at most 32000 tokens), else reported.
  const chat = async (messages, maxTokens) => {
    let budget = thinking === 'reason' ? 32000 : thinking ? Math.max(maxTokens, 8000) : maxTokens;
    for (;;) {
      const r = await once(messages, budget);
      if (!r.ok || r.finish !== 'length') return r;
      if (budget >= 32000) { chat.usage.cut++; return {ok: false, reason: `budget_exhausted: cut at ${budget} tokens`}; }
      budget = Math.min(32000, budget * 4); chat.usage.budget_retries++;
    }
  };
  chat.calls = 0; chat.hits = 0; chat.usage = {output_tokens: 0, reasoning_tokens: 0, reasoning_chars: 0, content_chars: 0, budget_retries: 0, cut: 0};
  return chat;
}

/** Path B of one problem: the lowered circuit executed query by query, the asked values compared with the book answer. */
async function exprArm(r, item, gold) {
  if (r.expr?.status !== 'ok' || !r.expr.sop) return {status: r.expr?.status ?? 'error', compiled: false, verdict: 'no_answer'};
  const w = await engines(), registry = registryOf(item.question);
  const execute = async sop => {
    const p = await w.run(sop, registry.map(v => v.value));
    return {status: p.status, values: (p.answers ?? []).map(a => Object.values(a.binding ?? a)[0]).filter(v => v !== undefined)};
  };
  const qs = await executeQueries(r.expr.sop, execute);
  const got = qs.filter(q => q.values.length).map(q => q.values[0]);
  if (!got.length) return {status: 'ok', compiled: true, executed: qs.some(q => q.status !== 'error'), queries: qs, verdict: 'no_answer'};
  const g = gold.kind === 'yes_no' ? gold.values[0] : gold.values.join(', ');
  // As in the logic arm: a numeric gold is compared with the answered numbers (a yes/no check next to them is not an asked value).
  const nums = got.filter(v => typeof v === 'number'), sys = gold.kind === 'number' && nums.length ? nums : got;
  const d = await decide(sys.length > 1 ? sys.join(', ') : sys[0], g, {problem: item.question, ordered: false});
  return {status: 'ok', compiled: true, executed: true, queries: qs, got, verdict: d.verdict === 'equivalent' ? 'correct' : 'wrong'};
}

async function scorePhase() {
  const raw = readJsonl(path.join(OUT, 'raw.jsonl'));
  const items = new Map(loadItems(ROOT).map(i => [i.id, i]));
  // Names for linking FOL constants: the arm's own PSM (combo), else GLiNER's extraction of the same problem (as in the probe).
  const gliner = new Map(raw.filter(r => r.arm === 'psm:structure-gliner' && r.psm && !r.psm.error).map(r => [r.id, r.psm]));
  const byArm = new Map();
  for (const r of raw) { if (!byArm.has(r.arm)) byArm.set(r.arm, []); byArm.get(r.arm).push(r); }
  const table = [], rows = [];
  for (const [arm, list] of byArm) {
    const kind = arm.split(':')[0];
    const ms = list.filter(r => !r.cached).map(r => r.ms).sort((a, b) => a - b);
    const sec = ms.length ? (ms[Math.floor(ms.length / 2)] / 1000).toFixed(1) : 'cached';
    if (kind === 'psm') {
      const P = list.map(r => ({id: r.id, ...psmScore(r, items.get(r.id))})).filter(p => !p.error);
      const sum = f => P.reduce((s, p) => s + f(p), 0);
      table.push({arm, n: list.length, qRecall: `${sum(p => p.covered)}/${sum(p => p.numbers)}`, qPrec: `${sum(p => p.digitSpansOnRegistry)}/${sum(p => p.digitSpans)}`, goal: `${P.filter(p => p.goalFound).length}/${P.length}`, sec});
      continue;
    }
    if (kind === 'expr') {
      let compiled = 0, correct = 0, wrong = 0, accepted = 0;
      for (const r of list) {
        const item = items.get(r.id), gold = goldOf(item);
        if (!gold) continue;
        const a = await exprArm(r, item, gold);
        rows.push({arm, id: r.id, ...a});
        if (r.expr?.status === 'ok') accepted++;
        if (a.compiled) compiled++;
        if (a.verdict === 'correct') correct++;
        if (a.verdict === 'wrong') wrong++;
      }
      table.push({arm, n: list.length, expr: true, accepted, compiled, correct, wrong, sec});
      continue;
    }
    let queries = 0, compiled = 0, executed = 0, correct = 0, wrong = 0, convertedUnits = 0, units = 0;
    for (const r of list) {
      const item = items.get(r.id), registry = registryOf(item.question);
      const names = psmScore({psm: r.psm ?? gliner.get(r.id) ?? {entities: {}}}, item).names ?? new Map();
      const a = await lfmArm(r.units, r.lfm, {registry, names, gold: goldOf(item), item});
      rows.push({arm, id: r.id, ...a});
      if (a.error) continue;
      units += a.units.length; convertedUnits += a.units.filter(u => u.converted).length;
      if (a.queriesInIr) queries++;
      if (a.circuits) compiled++;
      if (a.executed) executed++;
      if (a.verdict === 'correct') correct++;
      if (a.verdict === 'wrong') wrong++;
    }
    table.push({arm, n: list.length, unitsConverted: `${convertedUnits}/${units}`, queries: `${queries}/${list.length}`, compiled, executed, correct, wrong, sec});
  }
  (await engines()).dispose();
  fs.writeFileSync(path.join(OUT, 'results.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  const L = [`# PSM/LFM A/B: ${run} (${new Set(raw.map(r => r.id)).size} book problems)`, '', '## Structure (PSM)', '',
    '| arm | quantity recall | quantity precision | goal found | s/problem (median, uncached) |', '|---|---|---|---|---|'];
  for (const t of table.filter(t => t.qRecall)) L.push(`| ${t.arm} | ${t.qRecall} | ${t.qPrec} | ${t.goal} | ${t.sec} |`);
  L.push('', '## Logic (LFM)', '', '| arm | units converted | problems with a query | compiled | executed | correct | wrong | s/problem |', '|---|---|---|---|---|---|---|---|');
  for (const t of table.filter(t => t.queries)) L.push(`| ${t.arm} | ${t.unitsConverted} | ${t.queries} | ${t.compiled}/${t.n} | ${t.executed} | ${t.correct} | ${t.wrong} | ${t.sec} |`);
  const E = table.filter(t => t.expr);
  if (E.length) {
    L.push('', '## Compute path B (expression program)', '', '| arm | program accepted | executed circuit | correct | wrong | s/problem |', '|---|---|---|---|---|---|');
    for (const t of E) L.push(`| ${t.arm} | ${t.accepted}/${t.n} | ${t.compiled} | ${t.correct} | ${t.wrong} | ${t.sec} |`);
  }
  fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
}

const cmd = process.argv[2];
if (cmd === 'fetch') await fetchPhase();
else if (cmd === 'score') await scorePhase();
else { console.error('usage: ab.mjs fetch|score --run <id> [--ids-from probe-1] [--arms ...] [--fresh]'); process.exit(2); }
