/**
 * The host loop of the programming path (programming plan, milestone P0): follow an instruction, produce a small function, verify it.
 *
 *   1. propose   the coding agent (`llm-agent`, presentation `code`) writes `task.sop` (task facts and `test` wires) and `candidate.sop` (one `code` wire);
 *   2. validate  the task circuit: `sop/knowledge` validator over the host vocabulary, the task file and the candidate file (a sealed test is refused,
 *                at least one test, one `code` wire for the entry, every wire about the task symbol);
 *   3. run       the `code-sandbox` strategy runs the candidate on the visible examples (host-owned tests taken from the user's instruction) and on the
 *                tests the agent wrote; `verified` needs all of them and is `guarantee bounded`;
 *   4. repair    a failed round goes back to the agent with the host report (validation errors, failing tests, sandbox budget), at most `maxRounds`
 *                (default 3) repairs and within `maxPaidUsd`;
 *   5. packet    route `proposer` (the model wrote the program; no knowledge was used yet), status, rounds, cost, the files, the sandbox answer;
 *   6. episode   one dreaming-session record per run (`DreamStore.addEpisode`: task, family, route, rounds, cost, status; never the instruction or the code),
 *                and, for the project's own suites, the kept task text so that a later dream pass can replay it.
 * This module never reads `eval/suites/**`: the hidden tests of a suite are run by the evaluation harness after the packet is returned.
 */
import {validateProgram, parse} from '../../sop/knowledge/index.mjs';
import {llmAgent} from '../../reasoning/strategies/llm-agent/index.mjs';
import {TASK_VOCABULARY} from '../../reasoning/strategies/llm-agent/code.mjs';
import {codeSandbox} from '../../reasoning/strategies/code-sandbox/index.mjs';

export const MAX_ROUNDS = 3;
const errorsOf = problems => problems.filter(p => p.severity !== 'warning');

/** Validate the two files of an attempt against the host vocabulary. Returns `{ok, problems: string[], tests, family}`. */
export function validateTaskCircuit(files, task) {
  const problems = [];
  const r = validateProgram([{name: 'vocabulary', text: TASK_VOCABULARY, role: 'knowledge'}, {name: 'task.sop', text: files['task.sop'], role: 'knowledge'}, {name: 'candidate.sop', text: files['candidate.sop'], role: 'knowledge'}], {authoring: true});
  for (const p of errorsOf(r.problems)) problems.push(`${p.file}:${p.line ?? '?'} ${p.code}: ${p.message}`);
  const task_ = parse(files['task.sop']).wires, cand = parse(files['candidate.sop']).wires;
  const tests = task_.filter(w => w.type === 'test'), codes = cand.filter(w => w.type === 'code');
  const val = (w, k) => w.fields.find(f => f.key === k)?.value.trim();
  if (!tests.length) problems.push('task.sop: no test wire (write one test per example of the instruction)');
  for (const t of tests) if (val(t, 'of') !== task.id) problems.push(`task.sop:${t.line} test ${t.id} must have "of ${task.id}"`);
  if (task_.some(w => w.type === 'code')) problems.push('task.sop: the code wire belongs in candidate.sop');
  if (cand.some(w => w.type !== 'code')) problems.push('candidate.sop: only the code wire belongs here');
  if (codes.length !== 1) problems.push(`candidate.sop: exactly one code wire is needed, found ${codes.length}`);
  else {
    if (val(codes[0], 'of') !== task.id) problems.push(`candidate.sop: the code wire must have "of ${task.id}"`);
    if (val(codes[0], 'entry') !== task.entry) problems.push(`candidate.sop: entry must be ${task.entry}`);
  }
  const family = task_.filter(w => w.type === 'fact').map(w => (val(w, 'holds') ?? '').split(/\s+/)).find(t => t[0] === 'task_kind')?.[2] ?? null;
  return {ok: problems.length === 0, problems, tests: tests.length, family};
}

/** The tests of an attempt: the host-owned visible examples, then the agent's own `test` wires (their ids are prefixed by `agent_`). */
function testsFor(files, task) {
  const own = parse(files['task.sop']).wires.filter(w => w.type === 'test').map(w => ({id: 'agent_' + w.id, call: JSON.parse(w.fields.find(f => f.key === 'call').value), expect: JSON.parse(w.fields.find(f => f.key === 'expect').value), kind: 'example', source: 'agent'}));
  return [...(task.examples ?? []).map((e, i) => ({id: 'ex' + (i + 1) + '_given', call: e.call, expect: e.expect, kind: 'example', source: 'instruction'})), ...own];
}

const failureType = sb => sb.status === 'budget_exhausted' ? (sb.reason === 'memory' ? 'memory' : 'timeout') : sb.status === 'failed' ? (sb.failures.some(f => f.error && !f.expected) && sb.failures.every(f => f.error) ? 'runtime_error' : 'wrong_output') : sb.status === 'error' ? 'sandbox_error' : 'other';

function sandboxReport(sb, source) {
  const lines = [`The sandbox answered ${sb.status}${sb.reason ? ' (' + sb.reason + ')' : ''}; ${sb.tests.passed} of ${sb.tests.total} tests passed.`];
  for (const f of sb.failures ?? []) lines.push(`- test ${f.id.replace(/^agent_/, '')} (${source[f.id] === 'instruction' ? 'an example of the instruction: the program must satisfy it' : 'written by you: recompute its expected value by hand from the instruction; if your program is right and the test is wrong, correct or remove the test'}): ${f.call} ` + (f.error ? `raised ${f.error}` : `returned ${f.actual}, expected ${f.expected}`));
  if (sb.status === 'budget_exhausted') lines.push(`The program did not finish: ${sb.notes?.join('; ')}. It must terminate on every input with ordinary effort.`);
  return lines.join('\n');
}

/**
 * Solve one instruction. `task`: `{id, instruction, entry, examples: [{call, expect}], key?}` (`key` names the episode and the kept task; default `id`); `options`: `maxRounds`, `maxPaidUsd`, `store` (a DreamStore), `keepTask`, `propose`
 * (a hook `async ({task, repair}) => packet` replacing the llm-agent call), `budget` (code-sandbox), `model`, `refresh`, `onAttempt`.
 */
export async function solveInstruction(task, options = {}) {
  const maxRounds = options.maxRounds ?? MAX_ROUNDS, maxPaid = options.maxPaidUsd ?? 5;
  const propose = options.propose ?? (async ({task: t, repair}) => llmAgent.ask({task: t, repair}, {}, {presentation: 'code', model: options.model, maxPaidUsd: maxPaid, refresh: options.refresh, cacheDir: options.cacheDir}));
  const t0 = Date.now();
  const attempts = [];
  const cost = {paid_usd: 0, notional_usd: 0, calls: 0, models: {}};
  let repair = null, last = null, final = null, sandboxMs = 0, family = null;
  for (let round = 0; round <= maxRounds; round++) {
    if (cost.paid_usd >= maxPaid) { final = {status: 'budget_exhausted', reason: 'cost', failure_type: 'cost_cap'}; break; }
    const packet = await propose({task, repair});
    cost.calls++;
    const llm = packet.llm ?? {};
    cost.notional_usd += llm.notional_cost ?? llm.cost ?? 0;
    if (llm.paid) cost.paid_usd += llm.cost ?? 0;
    if (llm.model) cost.models[llm.model] = (cost.models[llm.model] ?? 0) + 1;
    const attempt = {round, model: llm.model ?? null, cached: Boolean(llm.cached), ms: llm.ms ?? null};
    attempts.push(attempt);
    if (packet.status === 'budget_exhausted') { attempt.outcome = 'budget_exhausted'; final = {status: 'budget_exhausted', reason: packet.reason, failure_type: packet.reason === 'cost' ? 'cost_cap' : 'provider'}; break; }
    if (packet.status === 'error' && packet.reason === 'provider') { attempt.outcome = 'provider_error'; final = {status: 'failed', failure_type: 'provider', detail: packet.detail}; break; }
    if (packet.status !== 'proposed') {
      attempt.outcome = 'malformed_output'; attempt.failure_type = 'malformed_output';
      repair = {files: {}, report: `Your reply could not be read: ${packet.detail ?? packet.reason}. Reply with the two fenced blocks task.sop and candidate.sop.`};
      final = {status: 'failed', failure_type: 'malformed_output'};
      continue;
    }
    last = packet.files;
    const check = validateTaskCircuit(packet.files, task);
    family = check.family ?? family;
    if (!check.ok) {
      attempt.outcome = 'invalid_circuit'; attempt.failure_type = 'invalid_circuit'; attempt.problems = check.problems.slice(0, 6);
      repair = {files: packet.files, report: 'The host validator refused your files:\n' + check.problems.slice(0, 8).map(p => '- ' + p).join('\n')};
      final = {status: 'failed', failure_type: 'invalid_circuit'};
      continue;
    }
    const tests = testsFor(packet.files, task);
    const sourceOf = Object.fromEntries(tests.map(t => [t.id, t.source]));
    const sb = await codeSandbox.ask({code: packet.files['candidate.sop'], tests}, options.budget ?? {});
    sandboxMs += sb.ms ?? 0;
    attempt.sandbox = {status: sb.status, reason: sb.reason, tests: sb.tests, ms: sb.ms, failures: (sb.failures ?? []).slice(0, 3).map(f => ({id: f.id, call: f.call, expected: f.expected, actual: f.actual, error: f.error, source: sourceOf[f.id]}))};
    if (sb.status === 'verified') { attempt.outcome = 'verified'; final = {status: 'verified', sandbox: sb}; break; }
    attempt.outcome = sb.status; attempt.failure_type = failureType(sb);
    repair = {files: packet.files, report: sandboxReport(sb, sourceOf)};
    final = {status: sb.status === 'budget_exhausted' ? 'budget_exhausted' : 'failed', reason: sb.reason, failure_type: failureType(sb), sandbox: sb};
  }
  const repairs = Math.max(0, attempts.length - 1);
  const solved = final?.status === 'verified';
  const packetOut = {
    status: final?.status ?? 'failed', ...(final?.reason ? {reason: final.reason} : {}), guarantee: 'bounded', exact: false, complete: solved,
    route: 'proposer', used: [], solved_on: solved ? (repairs === 0 ? 'first_try' : 'after_repair') : null, failure_type: solved ? null : (final?.failure_type ?? 'other'),
    rounds: repairs, attempts, family, cost, ms: Date.now() - t0, sandbox_ms: sandboxMs,
    files: last, ...(final?.sandbox ? {sandbox: {status: final.sandbox.status, tests: final.sandbox.tests, failures: final.sandbox.failures, trace: final.sandbox.trace?.slice(0, 40)}} : {})
  };
  if (options.store) {
    const ep = options.store.addEpisode({task: task.key ?? task.id, family: family ?? 'unknown', schema: 'code-p0', status: packetOut.status, route: 'proposer', language: 'javascript', rounds: repairs, model_calls: cost.calls, paid_usd: cost.paid_usd, ms: packetOut.ms, sandbox_ms: sandboxMs, failure_type: packetOut.failure_type, used: []});
    packetOut.episode = ep.id;
    if (options.keepTask) options.store.keepTask(task.key ?? task.id, {instruction: task.instruction, entry: task.entry, examples: task.examples, ...(last ? {candidate: last['candidate.sop'], task_sop: last['task.sop']} : {}), solved});
    options.store.save();
  }
  return packetOut;
}
