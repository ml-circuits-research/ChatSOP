/**
 * llm-agent: an advisory BASELINE strategy that asks a model through omp (default) or an explicitly selected OpenAI-compatible
 * completion endpoint to reason about a problem. It is not an engine. Its answers are ADVISORY: the smoke harness
 * compares them with the oracle, but they are never ground truth, are never promoted to evidence and never feed the knowledge.
 *
 *   input         `{theory: {knowledge}, query, source?}`; presentation `sop` gives the knowledge slice and the query circuit as SOP text with the
 *                 language semantics attached; `nl` gives the natural-language source text of the case (`source.md`), the true "big model reads the text" baseline;
 *   output        one JSON object in the result-packet shape, parsed STRICTLY (packet.mjs): malformed output is `status: 'error'`, never a guess;
 *   honesty       `exact: false`, `bounded: false`, `verified: false`; a wall timeout is `budget_exhausted` reason `wall`; a paid-cost cap is `budget_exhausted` reason `cost`;
 *   presentation `code`: the input is one programming instruction `{task: {id, entry, instruction, examples}, repair?}` and the model writes `task.sop` and `candidate.sop` in two fenced blocks (code.mjs); the packet is `{status: 'proposed', files}` and nothing is verified here;
 *   verify mode   `options.verify` replays the claimed `used` support in the js-oracle (verify.mjs) and reports `verified` per row;
 *   model, cost   chosen by config (config/llm-agent.json) or options; omp cost comes from usage events (`usage.cost.total`), while local
 *                 completion cost is zero with token usage reported. Cache keys isolate backend and completion settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FEATURES} from '../../../sop/knowledge/index.mjs';
import {NotExpressibleError, ProgramError} from '../js-reference/values.mjs';
import {PROMPT_VERSION, SYSTEM_PROMPT, ANSWER_MARKER, sopPrompt, nlPrompt} from './prompt.mjs';
import {parseAnswer} from './packet.mjs';
import {runOmp, isSubscription} from './runner.mjs';
import {runCompletion} from './completion.mjs';
import {cacheKey, readCache, writeCache, readLedger, addPaid} from './cache.mjs';
import {verifyUsed} from './verify.mjs';
import {codePrompt, parseCodeAnswer, CODE_SYSTEM_PROMPT} from './code.mjs';

export {NotExpressibleError, ProgramError};

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(repo, 'config/llm-agent.json'), 'utf8')); } catch { /* defaults below */ }
  const cfg = {model: 'xai-oauth/grok-4.20-0309-non-reasoning', fallbackModels: ['zai/glm-5.3-flash'], backend: 'omp', endpoint: null, apiKey: null, maxTokens: 1024, presentation: 'sop', verify: false, timeoutMs: 180000, maxChars: 90000, maxPaidUsd: 5, thinking: null, cacheDir: 'state/llm-agent/cache', ...c};
  if (process.env.CHATSOP_LLM_AGENT_MODEL) cfg.model = process.env.CHATSOP_LLM_AGENT_MODEL;
  if (process.env.CHATSOP_LLM_AGENT_PRESENTATION) cfg.presentation = process.env.CHATSOP_LLM_AGENT_PRESENTATION;
  cfg.cacheDir = path.resolve(repo, cfg.cacheDir);
  return cfg;
}

export const capabilities = {
  id: 'llm-agent',
  features: FEATURES.filter(f => f !== 'code_sandbox'),
  notExpressible: ['code_sandbox'],
  delivery: 'slice',
  limits: {max_wires: Infinity, max_chars: 90000, max_arity: 6, integer_range: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]},
  guarantee: 'advisory',
  exact: false,
  bounded: false,
  verified: false,
  advisory: true,
  provides: ['explain', 'used'],
  budgetKeys: ['wall', 'cost'],
  determinism: 'seeded',
  isolation: true,
  presentations: ['sop', 'nl', 'code']
};

export async function available() {
  const cfg = loadConfig();
  if (cfg.backend === 'completion') return cfg.endpoint ? {ok: true, endpoint: cfg.endpoint, model: cfg.model} : {ok: false, reason: 'completion endpoint is not configured'};
  if (cfg.backend !== 'omp') return {ok: false, reason: `unknown llm-agent backend ${cfg.backend}`};
  const {spawnSync} = await import('node:child_process');
  const r = spawnSync('omp', ['--version'], {encoding: 'utf8', timeout: 10000});
  return r.status === 0 ? {ok: true, version: (r.stdout || '').trim(), path: 'omp', model: cfg.model} : {ok: false, reason: 'omp is not available'};
}

const result = (packet, extra) => ({...packet, advisory: true, route: {requested: extra.requested ?? null, chosen: 'llm-agent', reason: extra.requested ? 'explicit request' : 'direct call to the strategy', fallback: null, backend: extra.backend}, llm: extra.llm});

/**
 * Answer a problem. `options`: `model`, `presentation` ('sop' | 'nl' | 'code'), `reasoning` ('cot' or 'direct'), `verify`, `cacheDir`, `refresh`, `timeoutMs`, `maxPaidUsd`,
 * `backend` ('omp' default or 'completion'), `endpoint`, `apiKey`, `maxTokens`, `signal`, `fallbackModels`, `run` (test hook replacing selected runner).
 * Throws NotExpressibleError when the input is larger than `limits.max_chars` or the `nl` presentation has no source text.
 */
export async function ask(problem, budgetArg = {}, options = {}) {
  const cfg = {...loadConfig(), ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))};
  if (!['omp', 'completion'].includes(cfg.backend)) throw new ProgramError(`unknown llm-agent backend \"${cfg.backend}\" (omp or completion)`);
  const completion = cfg.backend === 'completion';
  const backendName = model => `${cfg.backend}:${model}`;
  const presentation = cfg.presentation;
  const reasoning = cfg.reasoning === 'direct' ? 'direct' : 'cot';
  const t0 = Date.now();
  let prompt;
  if (presentation === 'nl') {
    if (!problem.source) throw new NotExpressibleError(['source'], 'the nl presentation needs the natural-language source text of the case (source.md)');
    prompt = nlPrompt({source: problem.source, reasoning});
  } else if (presentation === 'code') {
    if (!problem.task?.instruction) throw new NotExpressibleError(['task'], 'the code presentation needs problem.task = {id, entry, instruction}');
    prompt = codePrompt({task: problem.task, repair: problem.repair ?? null});
  } else if (presentation === 'sop') {
    prompt = sopPrompt({knowledge: problem.theory?.knowledge ?? '', query: problem.query, reasoning});
  } else throw new ProgramError(`unknown presentation "${presentation}" (sop, nl or code)`);
  if (prompt.length > cfg.maxChars) throw new NotExpressibleError(['input_size'], `input_too_large: the prompt has ${prompt.length} characters, the limit is ${cfg.maxChars} (a slice this large is split or refused before the call)`);
  const timeoutMs = budgetArg.wallMs ?? cfg.timeoutMs;
  const run = cfg.run ?? (completion ? runCompletion : runOmp);
  // The default omp subscription fallback is not a local completion model.
  const models = [cfg.model, ...(completion && options.fallbackModels === undefined ? [] : cfg.fallbackModels ?? [])];
  let last = null, totalCost = 0, paid = 0;
  for (const model of models) {
    const key = cacheKey({model, presentation: presentation + '+' + reasoning, prompt, version: PROMPT_VERSION, settings: completion ? JSON.stringify({backend: cfg.backend, endpoint: cfg.endpoint, apiKey: cfg.apiKey, maxTokens: cfg.maxTokens, temperature: 0, enable_thinking: false, system: presentation === 'code' ? CODE_SYSTEM_PROMPT : SYSTEM_PROMPT}) : ''});
    let entry = cfg.refresh ? null : readCache(cfg.cacheDir, key);
    const cached = Boolean(entry);
    if (!entry) {
      if (!completion && !isSubscription(model) && readLedger(cfg.cacheDir).paid_usd >= cfg.maxPaidUsd)
        return result({status: 'budget_exhausted', reason: 'cost', complete: false, notes: [`paid cost cap of ${cfg.maxPaidUsd} USD reached`]}, {requested: problem.requested, backend: backendName(model), llm: {model, presentation, cost: 0, paid: false, cached: false}});
      const r = await run({model, prompt, system: presentation === 'code' ? CODE_SYSTEM_PROMPT : SYSTEM_PROMPT, timeoutMs, thinking: cfg.thinking, ...(completion ? {endpoint: cfg.endpoint, apiKey: cfg.apiKey, maxTokens: cfg.maxTokens, signal: cfg.signal} : {})});
      totalCost += r.cost ?? 0;
      if (!completion && !isSubscription(model) && r.cost) { addPaid(cfg.cacheDir, r.cost); paid += r.cost; }
      if (r.timedOut) return result({status: 'budget_exhausted', reason: 'wall', complete: false, notes: [`no answer within ${timeoutMs} ms`]}, {requested: problem.requested, backend: backendName(model), llm: {model, presentation, cost: totalCost, paid: paid > 0, cached: false, ms: r.ms ?? Date.now() - t0, usage: r.usage}});
      if (!r.ok) { last = {model, error: r.error, ms: r.ms, usage: r.usage}; continue; }
      entry = {model, presentation, text: r.text, cost: r.cost ?? 0, usage: r.usage, ms: r.ms};
      writeCache(cfg.cacheDir, key, entry);
    }
    if (presentation === 'code') {
      const code = parseCodeAnswer(entry.text);
      const llm = {model, presentation, cost: cached ? 0 : (entry.cost ?? 0), notional_cost: entry.cost ?? 0, paid: !completion && !isSubscription(model), cached, ms: cached ? 0 : (entry.ms ?? Date.now() - t0), tokens: entry.usage ? {input: entry.usage.input, output: entry.usage.output} : undefined, usage: entry.usage, raw: code.ok ? undefined : String(entry.text).slice(0, 400)};
      return result(code.ok ? {status: 'proposed', complete: true, files: code.files, verified: false} : {status: 'error', reason: 'malformed_output', complete: true, detail: code.error, verified: false}, {requested: problem.requested, backend: backendName(model), llm});
    }
    const parsed = parseAnswer(entry.text, reasoning === 'cot' ? ANSWER_MARKER : null);
    let packet = parsed.packet;
    if (parsed.ok && cfg.verify && presentation === 'sop') packet = {...packet, ...verifyUsed({knowledge: problem.theory?.knowledge ?? '', query: problem.query}, packet)};
    if (packet.verified === undefined) packet.verified = false;
    return result(packet, {requested: problem.requested, backend: backendName(model), llm: {model, presentation, reasoning, cost: cached ? 0 : (entry.cost ?? 0), notional_cost: entry.cost ?? 0, paid: !completion && !isSubscription(model), cached, ms: cached ? 0 : (entry.ms ?? Date.now() - t0), original_ms: entry.ms, usage: entry.usage, tokens: entry.usage ? {input: entry.usage.input, output: entry.usage.output, cacheRead: entry.usage.cacheRead} : undefined, raw: parsed.ok ? undefined : String(entry.text).slice(0, 400)}});
  }
  return result({status: 'error', reason: 'provider', complete: true, detail: last?.error ?? 'no model answered'}, {requested: problem.requested, backend: backendName(last?.model ?? cfg.model), llm: {model: last?.model ?? cfg.model, presentation, cost: totalCost, cached: false, ms: last?.ms ?? Date.now() - t0, usage: last?.usage}});
}

export const llmAgent = {...capabilities, capabilities, available, ask};
export default llmAgent;
