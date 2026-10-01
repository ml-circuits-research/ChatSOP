/**
 * llm-agent: a BASELINE strategy that asks a large language model, through omp, to work through the problem (proposal sections 5, 6 and 12;
 * owner request 2026-10-01: "do we beat bigger models with our reasoning"). It is not an engine. Its answers are ADVISORY: the smoke harness
 * compares them with the oracle, but they are never ground truth, are never promoted to evidence and never feed the knowledge.
 *
 *   input         `{theory: {knowledge}, query, source?}`; presentation `sop` gives the knowledge slice and the query circuit as SOP text with the
 *                 language semantics attached; `nl` gives the natural-language source text of the case (`source.md`), the true "big model reads the text" baseline;
 *   output        one JSON object in the result-packet shape, parsed STRICTLY (packet.mjs): malformed output is `status: 'error'`, never a guess;
 *   honesty       `exact: false`, `bounded: false`, `verified: false`; a wall timeout is `budget_exhausted` reason `wall`; a paid-cost cap is `budget_exhausted` reason `cost`;
 *   verify mode   `options.verify` replays the claimed `used` support in the js-oracle (verify.mjs) and reports `verified` per row;
 *   model, cost   chosen by config (config/llm-agent.json) or `options.model`; the cost is read from the omp usage events (`usage.cost.total`) and reported
 *                 per call; answers are cached by (model, presentation, prompt version, prompt text) so reruns are free.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FEATURES} from '../../../sop/knowledge/index.mjs';
import {NotExpressibleError, ProgramError} from '../js-reference/values.mjs';
import {PROMPT_VERSION, SYSTEM_PROMPT, ANSWER_MARKER, sopPrompt, nlPrompt} from './prompt.mjs';
import {parseAnswer} from './packet.mjs';
import {runOmp, isSubscription} from './runner.mjs';
import {cacheKey, readCache, writeCache, readLedger, addPaid} from './cache.mjs';
import {verifyUsed} from './verify.mjs';

export {NotExpressibleError, ProgramError};

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(repo, 'config/llm-agent.json'), 'utf8')); } catch { /* defaults below */ }
  const cfg = {model: 'xai-oauth/grok-4.20-0309-non-reasoning', fallbackModels: ['zai/glm-5.3-flash'], presentation: 'sop', verify: false, timeoutMs: 180000, maxChars: 90000, maxPaidUsd: 5, thinking: null, cacheDir: 'state/llm-agent/cache', ...c};
  if (process.env.CHATSOP_LLM_AGENT_MODEL) cfg.model = process.env.CHATSOP_LLM_AGENT_MODEL;
  if (process.env.CHATSOP_LLM_AGENT_PRESENTATION) cfg.presentation = process.env.CHATSOP_LLM_AGENT_PRESENTATION;
  cfg.cacheDir = path.resolve(repo, cfg.cacheDir);
  return cfg;
}

export const capabilities = {
  id: 'llm-agent',
  features: [...FEATURES],
  notExpressible: [],
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
  presentations: ['sop', 'nl']
};

export async function available() {
  const {spawnSync} = await import('node:child_process');
  const r = spawnSync('omp', ['--version'], {encoding: 'utf8', timeout: 10000});
  return r.status === 0 ? {ok: true, version: (r.stdout || '').trim(), path: 'omp', model: loadConfig().model} : {ok: false, reason: 'omp is not available'};
}

const result = (packet, extra) => ({...packet, advisory: true, route: {requested: extra.requested ?? null, chosen: 'llm-agent', reason: extra.requested ? 'explicit request' : 'direct call to the strategy', fallback: null, backend: extra.backend}, llm: extra.llm});

/**
 * Answer a problem. `options`: `model`, `presentation` ('sop' | 'nl'), `reasoning` ('cot' default: work through it in text, then the JSON after ANSWER_JSON:; 'direct': the JSON alone), `verify`, `cacheDir`, `refresh` (ignore the cache), `timeoutMs`, `maxPaidUsd`,
 * `fallbackModels`, `run` (test hook replacing omp: `async ({model, prompt, system, timeoutMs}) => {ok, text, cost}`).
 * Throws NotExpressibleError when the input is larger than `limits.max_chars` or the `nl` presentation has no source text.
 */
export async function ask(problem, budgetArg = {}, options = {}) {
  const cfg = {...loadConfig(), ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))};
  const presentation = cfg.presentation;
  const reasoning = cfg.reasoning === 'direct' ? 'direct' : 'cot';
  const t0 = Date.now();
  let prompt;
  if (presentation === 'nl') {
    if (!problem.source) throw new NotExpressibleError(['source'], 'the nl presentation needs the natural-language source text of the case (source.md)');
    prompt = nlPrompt({source: problem.source, reasoning});
  } else if (presentation === 'sop') {
    prompt = sopPrompt({knowledge: problem.theory?.knowledge ?? '', query: problem.query, reasoning});
  } else throw new ProgramError(`unknown presentation "${presentation}" (sop or nl)`);
  if (prompt.length > cfg.maxChars) throw new NotExpressibleError(['input_size'], `input_too_large: the prompt has ${prompt.length} characters, the limit is ${cfg.maxChars} (a slice this large is split or refused before the call)`);
  const timeoutMs = budgetArg.wallMs ?? cfg.timeoutMs;
  const run = cfg.run ?? runOmp;
  const models = [cfg.model, ...(cfg.fallbackModels ?? [])];
  let last = null, totalCost = 0, paid = 0;
  for (const model of models) {
    const key = cacheKey({model, presentation: presentation + '+' + reasoning, prompt, version: PROMPT_VERSION});
    let entry = cfg.refresh ? null : readCache(cfg.cacheDir, key);
    const cached = Boolean(entry);
    if (!entry) {
      if (!isSubscription(model) && readLedger(cfg.cacheDir).paid_usd >= cfg.maxPaidUsd)
        return result({status: 'budget_exhausted', reason: 'cost', complete: false, notes: [`paid cost cap of ${cfg.maxPaidUsd} USD reached`]}, {requested: problem.requested, backend: 'omp:' + model, llm: {model, presentation, cost: 0, paid: false, cached: false}});
      const r = await run({model, prompt, system: SYSTEM_PROMPT, timeoutMs, thinking: cfg.thinking});
      totalCost += r.cost ?? 0;
      if (!isSubscription(model) && r.cost) { addPaid(cfg.cacheDir, r.cost); paid += r.cost; }
      if (r.timedOut) return result({status: 'budget_exhausted', reason: 'wall', complete: false, notes: [`no answer within ${timeoutMs} ms`]}, {requested: problem.requested, backend: 'omp:' + model, llm: {model, presentation, cost: totalCost, paid: paid > 0, cached: false, ms: Date.now() - t0}});
      if (!r.ok) { last = {model, error: r.error}; continue; }
      entry = {model, presentation, text: r.text, cost: r.cost ?? 0, usage: r.usage, ms: r.ms};
      writeCache(cfg.cacheDir, key, entry);
    }
    const parsed = parseAnswer(entry.text, reasoning === 'cot' ? ANSWER_MARKER : null);
    let packet = parsed.packet;
    if (parsed.ok && cfg.verify && presentation === 'sop') packet = {...packet, ...verifyUsed({knowledge: problem.theory?.knowledge ?? '', query: problem.query}, packet)};
    if (packet.verified === undefined) packet.verified = false;
    return result(packet, {requested: problem.requested, backend: 'omp:' + model, llm: {model, presentation, reasoning, cost: cached ? 0 : (entry.cost ?? 0), notional_cost: entry.cost ?? 0, paid: !isSubscription(model), cached, ms: cached ? 0 : (entry.ms ?? Date.now() - t0), original_ms: entry.ms, tokens: entry.usage ? {input: entry.usage.input, output: entry.usage.output, cacheRead: entry.usage.cacheRead} : undefined, raw: parsed.ok ? undefined : String(entry.text).slice(0, 400)}});
  }
  return result({status: 'error', reason: 'provider', complete: true, detail: last?.error ?? 'no model answered'}, {requested: problem.requested, backend: 'omp:' + (last?.model ?? cfg.model), llm: {model: last?.model ?? cfg.model, presentation, cost: totalCost, cached: false}});
}

export const llmAgent = {...capabilities, capabilities, available, ask};
export default llmAgent;
