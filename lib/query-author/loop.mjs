/**
 * The validate-and-repair loop of the query author (b), identical for every backend: ask the backend for `query.sop`, validate it
 * (validate.mjs), and while problems (or fixable advice) remain and rounds are left, send the validator's output back. The result
 * never throws for a backend failure: `status` is `validated`, `invalid` (problems remain after the last round) or `failed` (the
 * backend did not deliver: not installed, timeout, error), with a `reason`.
 */
import fs from 'node:fs';
import {buildContext} from './context.mjs';
import {validateQuery, unclearKind} from './validate.mjs';
import {nearestPredicates} from './retrieval.mjs';

const ZERO = () => ({turns: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0});

export async function authorQuery({message, lexicon, backend, folder = null, maxFixRounds = 3, mode = 'id', k = 24, indexMax = 300, validate = validateQuery, admit, onProgress = () => {}}) {
  const started = Date.now();
  const context = buildContext({message, lexicon, mode, k, indexMax, vocabulary: backend.kind === 'completion' ? null : undefined});
  if (folder) fs.mkdirSync(folder, {recursive: true});
  const history = [];
  const runs = [];
  const usage = ZERO();
  let validation = null, reason = null, best = null, report = '';
  for (let round = 0; round <= maxFixRounds; round++) {
    onProgress({phase: round === 0 ? 'writing' : 'fixing', round, max_fix_rounds: maxFixRounds});
    const out = await backend.generate({context, history, folder});
    runs.push({round, ok: out.ok, duration_ms: out.duration_ms, usage: out.usage, ...(out.reason ? {reason: out.reason} : {})});
    for (const k of Object.keys(usage)) usage[k] += out.usage?.[k] ?? 0;
    if (out.report) report = out.report;
    if (!out.ok || !out.sop?.trim()) { reason = out.reason ?? 'the backend returned nothing'; break; }
    onProgress({phase: 'validating', round});
    validation = validate({sop: out.sop, message, lexicon, mode, hints: context.hints, mentions: context.retrieval.entities, ...(admit ? {admit} : {})});
    if (validation.ok) best = {sop: out.sop, validation, round};
    const again = round < maxFixRounds && (!validation.ok || validation.advice.length);
    if (!again) break;
    history.push({sop: out.sop, problems: [...validation.problems, ...validation.advice]});
  }
  usage.cost_usd = Math.round(usage.cost_usd * 1e6) / 1e6;
  const final = best ?? null;
  const status = final ? 'validated' : reason ? 'failed' : 'invalid';
  const chosen = final ?? {sop: history.at(-1)?.sop ?? '', validation};
  const unclear = final ? unclearKind(final.validation.program) : null;
  return {
    // The author's output is a set of circuits. Today only the query circuit (`query.sop`) is accepted; session definitions and labelled
    // assumptions (DS031 phase 2) join this list with their own role and are validated against the memory by the same call.
    circuits: final ? [{file: 'query.sop', role: 'query', text: final.sop}] : [],
    ...(unclear === 'relation_not_in_memory' ? {closest: nearestPredicates(message, lexicon, 8).map(id => ({id, roles: (lexicon.predicates[id].roles ?? []).map(r => r.name + ':' + r.type)}))} : {}),
    ok: Boolean(final), status, sop: chosen.sop, validation: chosen.validation ?? validation, program: chosen.validation?.program ?? null, unclear,
    rounds: runs.length, runs, usage, duration_ms: Date.now() - started, backend: backend.id, model: backend.model ?? null, report, context_version: context.version,
    mode, retrieval: context.retrieval, ...(reason ? {reason} : {}),
    unlinked: (final?.validation.advice ?? []).map(a => ({code: a.code, message: a.message})),
  };
}
