#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {authorQuery, completionBackend, ompBackend} from '../../../lib/query-author/index.mjs';
import {constrainedBackend} from '../../../lib/query-author/backends/constrained.mjs';
import {splitCircuits} from '../../../lib/query-author/session.mjs';
import {parse as parseRuntime} from '../../../sop/parser.mjs';
import {parse as parseKnowledge} from '../../../sop/knowledge/lexical.mjs';
import {runCompletion} from '../../../reasoning/strategies/llm-agent/completion.mjs';
import {runOmp} from '../../../reasoning/strategies/llm-agent/runner.mjs';
import {nlPrompt, SYSTEM_PROMPT, ANSWER_MARKER, PROMPT_VERSION} from '../../../reasoning/strategies/llm-agent/prompt.mjs';
import {parseAnswer} from '../../../reasoning/strategies/llm-agent/packet.mjs';
import {verifyUsed} from '../../../reasoning/strategies/llm-agent/verify.mjs';
import {renderEnglish} from '../../../reasoning/slice/render-english.mjs';
import {cnl} from '../../../sop/cnl.mjs';
import {wireText} from '../../../sop/knowledge/index.mjs';
import {LIMITS, createWorld, execute, linkCircuit, withDefinitions, goldSlice, oracleOverSlice} from './world.mjs';
import {score, equivalent, failureLayer} from './score.mjs';
import {writeReport, stopDecision} from './report.mjs';
import {startServer} from '../query-model-calibration/servers.mjs';
import {MODELS} from '../query-model-calibration/models.mjs';
import {openSession, defaultRoot} from '../query-forms-probe.mjs';
import {readExperiments} from '../../../lib/journal.mjs';
import {localStrategy} from '../../../lib/formalize/strategies.mjs';
const stepStrategies = new Map();

export const VERSION = 'symbolic-vs-llm-m1-v1';
const sha = value => createHash('sha256').update(value).digest('hex');
const hashFile = async file => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const opt = (args, name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

function sourceHashes() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const hashes = {};
  const visit = relative => {
    const absolute = path.join(root, relative);
    if (fs.statSync(absolute).isFile()) {
      if (/\.(mjs|md|json)$/.test(relative)) hashes[relative] = sha(fs.readFileSync(absolute));
      return;
    }
    for (const entry of fs.readdirSync(absolute).sort()) visit(path.join(relative, entry));
  };
  // Code and author guides only: never evaluation cases, sealed suites or session data.
  for (const directory of ['lib', 'sop', 'memory', 'reasoning', 'skills/coding-agent-query', 'tools/eval/symbolic-vs-llm']) visit(directory);
  return hashes;
}

export function alignProjection(packet, authoredQuery, goldQuery) {
  const columns = q => /^\s*select\s+([^\n]+)/m.exec(q)?.[1]?.match(/\?[a-z][a-z0-9_]*/g)?.map(v => v.slice(1)) ?? [];
  const from = columns(authoredQuery), to = columns(goldQuery);
  if (from.length !== to.length || !from.length) return packet;
  const names = new Map(from.map((name, i) => [name, to[i]]));
  const rename = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [names.get(k) ?? k, v]));
  return {...packet, ...(packet.rows ? {rows: packet.rows.map(rename)} : {}), ...(packet.witness ? {witness: rename(packet.witness)} : {})};
}

/** Stable round-robin size/depth strata; every stage is a prefix of the next. */
export function stageRows(rows, count, seed = 20261001) {
  const buckets = new Map();
  for (const row of rows) {
    const key = `${row.facts}/${row.depth}/${row.variant ?? row.form ?? ''}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const groups = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => group.sort((a, b) => sha(seed + a.id).localeCompare(sha(seed + b.id))));
  const picked = [];
  for (let i = 0; picked.length < Math.min(count, rows.length); i++) for (const group of groups) if (group[i] && picked.length < count) picked.push(group[i]);
  return picked;
}

export function evidenceFor(slice, question, {maxChars = 90000, sampleFacts = 450} = {}) {
  const complete = renderEnglish(slice);
  if (complete.length <= maxChars) return {source: complete, evidence_does_not_fit: false, facts: slice.facts.length, original_chars: complete.length};
  const mentions = new Set(question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
  const rank = f => f.atom.a.some(a => mentions.has(String(a).toLowerCase())) ? 0 : mentions.has(f.atom.p) ? 1 : 2;
  const sampled = [...slice.facts].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)).slice(0, sampleFacts);
  const factIds = new Set(sampled.map(f => f.id));
  let wires = slice.wires.filter(w => w.type !== 'fact' || factIds.has(w.id));
  // Completeness declarations must not turn a capped sample into a closed world.
  wires = wires.map(w => w.type === 'predicate' ? {...w, fields: w.fields.filter(f => f.key !== 'closed')} : w);
  let source = renderEnglish({facts: sampled, wires});
  while (source.length > maxChars && sampled.length) {
    const removed = sampled.pop(); wires = wires.filter(w => w.id !== removed.id); source = renderEnglish({facts: sampled, wires});
  }
  if (source.length > maxChars) throw new Error('evidence rules alone exceed context budget');
  return {source: 'This is a partial keyed sample. The lists below are not complete; do not infer absence from missing facts.\n' + source,
    evidence_does_not_fit: true, facts: sampled.length, original_chars: complete.length};
}


// Broken-arm admission is syntax/non-delivery, not a semantic validator refusal or engine failure.
function unparsableCircuit(sop) {
  try {
    const split = splitCircuits(sop);
    parseRuntime(split.model);
    return parseKnowledge(split.definitions).errors.length > 0;
  } catch { return true; }
}

/** One arm, same question, shared wall/output-token ceiling, no circuit or answer in the author prompt. */
export async function runArm({row, arm, world, gold, slice, evidence, knowledge, query, settings, folder}) {
  const start = Date.now();
  let author = null, packet = null, linking = null, error = null, oracleEquivalent = null, verified = false, rendered;
  let tokensIn = 0, tokensOut = 0, cost = 0;
  let parseOk = null, responseEmpty = false, brokenModelOutput = false;
  const latency = {parse_ms: 0, retrieval_ms: 0, engine_ms: 0, verify_ms: 0, model_ms: 0};
  try {
    if (arm === 'B-stepbystep' || arm === 'B-local') {
      // The product's local strategies on their dedicated slots with the restored stable prefix: LocalLLMStepByStep (the strategy
      // writes the circuit from the oracle's answers) or LocalLLMDirect (arm B's author loop, same guide and repair rounds).
      // settings.stepMethod: the question protocol of LocalLLMStepByStep (A, or B, C, D and ablations of eval-stepbystep-protocol-v1).
      const name = arm === 'B-local' ? 'LocalLLMDirect' : 'LocalLLMStepByStep', method = settings.stepMethod ?? 'A', key = `${name}@${settings.endpoint}#${method}`;
      stepStrategies.set(key, stepStrategies.get(key) ?? localStrategy(name, {endpoint: settings.endpoint, alias: settings.model, maxTokens: settings.maxTokens, method}, {timeoutMs: settings.wallMs}));
      author = name === 'LocalLLMDirect'
        ? await stepStrategies.get(key).run({message: row.question, lexicon: world.lexicon, maxFixRounds: 2})
        : await stepStrategies.get(key).run({message: row.question, lexicon: world.lexicon, repo: world.repo, session: world.session, derived: new Set(world.theory.byHead?.keys?.() ?? [])});
      latency.model_ms = author.steps ? author.steps.reduce((n, s) => n + s.ms, 0) : author.runs.reduce((n, r) => n + (r.duration_ms ?? 0), 0);
    }
    if (['B', 'B-grammar', 'B-structured', 'C'].includes(arm)) {
      const deadline = start + settings.wallMs;
      let remaining = settings.maxTokens;
      const makeBackend = arm === 'B' ? completionBackend : constrainedBackend;
      const backend = arm !== 'C' ? makeBackend({endpoint: settings.endpoint, model: settings.model, timeoutMs: settings.wallMs, maxTokens: settings.maxTokens,
        ...(arm !== 'B' ? {format: arm.slice(2), lexicon: world.lexicon} : {}),
        extraBody: {chat_template_kwargs: {enable_thinking: false}}, fetchImpl: async (url, init) => {
          if (Date.now() >= deadline || remaining <= 0) throw new Error('shared question budget exhausted');
          const body = JSON.parse(init.body); body.max_tokens = remaining;
          const response = await fetch(url, {...init, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now()))});
          const copy = await response.clone().json(); remaining -= copy.usage?.completion_tokens ?? 0; return response;
        }}) : ompBackend({model: settings.subscriptionModel, timeoutMs: settings.wallMs});
      const bounded = {...backend, async generate(args) {
        if (Date.now() >= deadline || remaining <= 0) return {ok: false, reason: 'shared question budget exhausted', usage: {}, duration_ms: 0};
        // settings.authorBackend: a zero-model replay of a reviewed circuit (generality probe) through the same admission and execution.
        const response = await (arm === 'C' ? settings.authorBackend ?? ompBackend({model: settings.subscriptionModel, timeoutMs: Math.max(1, deadline - Date.now())}) : backend).generate(args);
        latency.model_ms += response.duration_ms ?? 0;
        if (arm === 'C') {
          const used = response.usage?.output_tokens ?? 0;
          const exceeded = used > remaining;
          remaining -= used;
          if (exceeded) return {...response, ok: false, reason: 'subscription output exceeded shared question token budget'};
        }
        return response;
      }};
      author = await authorQuery({message: row.question, lexicon: world.lexicon, backend: bounded, folder, maxFixRounds: 2});
    }
    if (['B', 'B-grammar', 'B-structured', 'C', 'B-stepbystep', 'B-local'].includes(arm)) {
      const deadline = start + settings.wallMs;
      latency.parse_ms = Date.now() - start; tokensIn = author.usage?.input_tokens ?? 0; tokensOut = author.usage?.output_tokens ?? 0; cost = author.usage?.cost_usd ?? 0;
      responseEmpty = author.runs?.at(-1)?.ok === true && !author.sop?.trim();
      brokenModelOutput = responseEmpty || (author.status === 'invalid' && unparsableCircuit(author.sop));
      if (author.status === 'validated' && !author.unclear) {
        const linkStart = Date.now(); linking = linkCircuit(author.sop, row.question, world.lexicon, author.validation?.program);
        latency.linking_ms = Date.now() - linkStart;
        if (!linking.query) packet = {status: 'clarify', complete: true, reason: linking.issue?.status ?? linking.plan?.issues?.[0]?.status ?? 'unresolved_circuit'};
        else {
          const effectiveWorld = withDefinitions(world, author.validation?.program, linking.context);
          const metrics = {};
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) throw new Error('shared question wall budget exhausted');
          const execStart = Date.now(); packet = execute(effectiveWorld, linking.query, {metrics, budget: {timeoutMs: remainingMs}, limits: {...LIMITS, retrievalMs: Math.min(LIMITS.retrievalMs, remainingMs)}});
          latency.retrieval_ms = Math.round(metrics.retrieval_ms ?? 0);
          latency.engine_ms = Math.max(0, Date.now() - execStart - latency.retrieval_ms);
          const verifyStart = Date.now();
          const effectiveSlice = effectiveWorld.definitionWires?.length
            ? {...slice, wires: [...slice.wires, ...effectiveWorld.definitionWires]}
            : slice;
          const rawReplay = oracleOverSlice(effectiveSlice, linking.query);
          const replay = alignProjection(rawReplay, linking.query, query);
          oracleEquivalent = equivalent(gold, replay);
          verified = packet.complete !== false && rawReplay.complete !== false && equivalent(packet, rawReplay);
          latency.verify_ms = Date.now() - verifyStart;
          packet = alignProjection(packet, linking.query, query);
          packet.route = {...packet.route, verification: {checked: verified, policy: 'benchmark-offline-gold-slice', outcome: verified ? 'agreed' : 'unverified', ms: latency.verify_ms}};
          const renderPacket = packet.witness && !packet.answers ? {...packet, answers: [{binding: packet.witness}]} : packet;
          rendered = cnl(renderPacket, 'en', {lexicon: effectiveWorld.lexicon}).text;
        }
      } else packet = {status: author.unclear ? 'unclear' : author.status, reason: author.reason, complete: true};
    } else {
      const reasoning = arm === "A'" ? 'cot' : 'direct';
      const projection = /^\s*select\s+([^\n]+)/m.exec(query)?.[1]?.match(/\?[a-z][a-z0-9_]*/g)?.map(v => v.slice(1)) ?? [];
      const schema = projection.length ? `\nFor an answer table, name its columns ${projection.join(', ')}. These are output column names, not facts.\n` : '';
      const prompt = nlPrompt({source: `${evidence.source}\n\nQuestion: ${row.question}${schema}\nInclude a used list of evidence identifiers that suffice for your answer, for example \"used\":[{\"id\":\"f1\",\"version\":1}]. Refer only to identifiers printed in the evidence.`, reasoning});
      const reply = arm === 'D' ? await runOmp({model: settings.subscriptionModel, prompt, system: SYSTEM_PROMPT, timeoutMs: settings.wallMs})
        : await runCompletion({endpoint: settings.endpoint, model: settings.model, prompt, system: SYSTEM_PROMPT, timeoutMs: settings.wallMs, maxTokens: settings.maxTokens});
      latency.model_ms = reply.ms; tokensIn = reply.usage?.prompt_tokens ?? reply.usage?.input ?? 0; tokensOut = reply.usage?.completion_tokens ?? reply.usage?.output ?? 0; cost = arm === 'D' ? reply.cost ?? 0 : 0;
      if (!reply.ok || tokensOut > settings.maxTokens) error = tokensOut > settings.maxTokens ? 'subscription output exceeded shared question token budget' : reply.error ?? 'completion failed';
      else {
        const parsed = parseAnswer(reply.text, reasoning === 'cot' ? ANSWER_MARKER : null); packet = parsed.packet;
        parseOk = parsed.ok;
        responseEmpty = !reply.text?.trim();
        brokenModelOutput = responseEmpty || parseOk === false;
        const verifyStart = Date.now();
        // Verification uses the exact gold circuit and cited support; never sends either to the model.
        verified = verifyUsed({knowledge: slice.wires.map(wireText).join('\n\n'), query}, packet).verified === true; latency.verify_ms = Date.now() - verifyStart;
        rendered = reply.text;
      }
    }
  } catch (e) { error = e.message; }
  const verdict = score(row.expected, packet, {author, error});
  latency.wall_ms = Date.now() - start;
  return {id: row.id, family: row.family, facts: row.facts, depth: row.depth, split: row.split, arm, model: ['C', 'D'].includes(arm) ? settings.subscriptionModel : settings.model,
    parse_ok: parseOk, response_empty: responseEmpty, broken_model_output: brokenModelOutput,
    outcome: verdict.outcome, reasons: verdict.why, memory_sha256: world.theory.digest, gold_answerable: !['unknown', 'incomplete'].includes(row.expected.status), verified, proof_available: Boolean(packet?.used?.length || packet?.proof),
    evidence_does_not_fit: evidence.evidence_does_not_fit, evidence_facts: evidence.facts, evidence_chars: evidence.original_chars,
    latency, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: arm === 'C' || arm === 'D' ? cost : 0,
    author: author && {status: author.status, reason: author.reason, rounds: author.rounds, sop: author.sop, context_version: author.context_version, retrieval: author.retrieval, usage: author.usage,
      ...(['B-grammar', 'B-structured'].includes(arm) ? {decoder_output: author.report} : {}),
      ...(arm === 'B-stepbystep' ? {steps: author.steps, plan: author.report, confirmed: author.confirmed, retried: author.retried, problem: author.problem, method: author.method ?? 'A', contrast: author.contrast} : {}),
      problems: author.validation?.problems, parsed: Boolean(author.validation?.program)},
    packet, rendered, oracle_equivalent: oracleEquivalent, error,
    failure_layer: failureLayer({arm, parseOk, outcome: verdict.outcome, author, linking, packet, oracleEquivalent, rendered, error})};
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node tools/eval/symbolic-vs-llm/run.mjs --manifest eval/smoke-reasoning/bench/manifest.jsonl --arms A,B --model qwen3-4b-q4 --pilot 20 --out eval/reports/current/symbolic-vs-llm/pilot [--endpoint URL] [--stages 100,300,600]'); return;
  }
  const manifestFile = path.resolve(opt(args, '--manifest', 'eval/smoke-reasoning/bench/manifest.jsonl'));
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  const rows = manifestText.split('\n').filter(Boolean).map(JSON.parse);
  const pilot = Number(opt(args, '--pilot', 0));
  if (pilot && rows.some(r => r.split !== 'dev')) throw new Error('pilot accepts development cases only');
  if (rows.some(r => r.split !== 'dev')) {
    const preregistration = JSON.parse(fs.readFileSync(new URL('../../../status/preregistrations/eval-symbolic-vs-llm-v1.json', import.meta.url), 'utf8'));
    if (!preregistration.frozen) throw new Error('sealed execution requires a frozen preregistration');
  }
  const arms = opt(args, '--arms', 'A,B').split(',');
  if (arms.some(a => !['A', "A'", 'B', 'B-grammar', 'B-structured', 'B-stepbystep', 'B-local', 'C', 'D'].includes(a))) throw new Error('unknown arm');
  if (rows.some(r => r.split !== 'dev') && arms.some(a => ['B-grammar', 'B-structured', 'B-stepbystep', 'B-local'].includes(a))) throw new Error('constrained authoring variants are dev-only; the frozen sealed protocol does not include these arms');
  const key = opt(args, '--model', 'qwen3-4b-q4');
  const settings = {model: key, endpoint: opt(args, '--endpoint', null), subscriptionModel: opt(args, '--subscription-model', 'openai-codex/gpt-6-luna'), wallMs: Number(opt(args, '--wall-ms', 180000)), maxTokens: Number(opt(args, '--max-tokens', 4096))};
  if (!/^(openai-codex|xai-oauth|zai|zai-coding-plan)\//.test(settings.subscriptionModel)) throw new Error('subscription models first; paid execution requires an explicitly authorized separate run');
  const spec = MODELS[key];
  const managed = !settings.endpoint && arms.some(a => ['A', "A'", 'B', 'B-grammar', 'B-structured', 'B-stepbystep', 'B-local'].includes(a));
  if (managed && spec?.kind !== 'local') throw new Error('local model needs explicit existing GGUF specification');
  const alternate = path.resolve('models/qwen3-4b-instruct/gguf/q4_k_m.gguf');
  const gguf = managed ? fs.existsSync(spec.gguf) ? spec.gguf : key === 'qwen3-4b-q4' && fs.existsSync(alternate) ? alternate : spec.gguf : null;
  const modelManifest = gguf ? {file: gguf, sha256: await hashFile(gguf), source: 'managed-local-gguf', identity_verified: true} : {source: 'external-endpoint-or-subscription', identity_verified: false};
  const out = path.resolve(opt(args, '--out', 'eval/reports/current/symbolic-vs-llm/pilot'));
  fs.mkdirSync(out, {recursive: true});
  const config = {version: VERSION, harness_sha256: sha(fs.readFileSync(new URL(import.meta.url), 'utf8')), world_sha256: sha(fs.readFileSync(new URL('./world.mjs', import.meta.url), 'utf8')), runtime: {node: process.version, arch: process.arch, platform: process.platform}, model_manifest: modelManifest, manifest_sha256: sha(manifestText), settings: {...settings, retrieval_limits: LIMITS, endpoint: settings.endpoint ?? 'managed-private-llama-server', subscription_token_budget: 'post-response usage admission; omp CLI has no provider token-cap flag'}, arms, pilot, prompt_version: PROMPT_VERSION, prompt_sha256: sha(nlPrompt({source: '', reasoning: 'direct'}) + runArm.toString()), renderer_sha256: sha(fs.readFileSync(new URL('../../../reasoning/slice/render-english.mjs', import.meta.url), 'utf8')), stages: pilot ? [pilot] : opt(args, '--stages', '100,300,600').split(',').map(Number)};
  config.runtime_sources = sourceHashes();
  config.runtime_source_sha256 = sha(JSON.stringify(config.runtime_sources));
  const configFile = path.join(out, 'run.json');
  if (fs.existsSync(configFile) && JSON.stringify(JSON.parse(fs.readFileSync(configFile, 'utf8'))) !== JSON.stringify(config)) throw new Error('run identity changed; use a fresh output directory');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  const recordFile = path.join(out, 'records.jsonl');
  const records = fs.existsSync(recordFile) ? fs.readFileSync(recordFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const done = new Set(records.map(r => `${r.id}/${r.arm}`));
  let server = null;
  const logFile = path.join(out, 'llama-server.log');
  if (managed) {
    server = await startServer({gguf, port: Number(opt(args, '--port', 19531)), ctx: spec.ctx, ngl: 99, logFile, alias: key}); settings.endpoint = server.endpoint;
  }
  const stop = async () => { if (server) { await server.stop(); server = null; fs.rmSync(logFile, {force: true}); } };
  const onSignal = async () => { await stop(); process.exitCode = 1; };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  let sharedWorld = null;
  try {
    for (const family of [...new Set(rows.map(r => r.family))].sort()) {
      let activeArms = [...arms];
      for (const stage of config.stages) {
        const candidates = rows.filter(r => r.family === family);
        if (candidates.length < stage) throw new Error(`${family} has ${candidates.length} instances, fewer than requested stage ${stage}`);
        for (const row of stageRows(candidates, stage)) {
          if (activeArms.every(arm => done.has(`${row.id}/${arm}`))) continue;
          const dir = path.resolve(path.dirname(manifestFile), row.case_dir); const knowledge = fs.readFileSync(path.join(dir, 'knowledge.sop'), 'utf8'); const query = fs.readFileSync(path.join(dir, 'query.sop'), 'utf8');
          row.expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
          let world;
          if (row.base_memory === 'world-v1') {
            if (row.world_root && path.resolve(row.world_root) !== path.resolve(defaultRoot(), 'base_memories', 'world-v1')) throw new Error('Requested world-v1 root differs from QF_CHAT_ROOT; no memory substitution');
            if (!sharedWorld) {
              const session = openSession({base: 'world-v1', id: `benchmark-${process.pid}-world`});
              try {
                const entry = session.store.get('qf', 'bench', 'main');
                sharedWorld = {repo: session.sessions.repository(session.id), session: entry.agent.session, lexicon: session.lexicon, theory: session.theories.get([...session.sessions.baseCircuits(session.id), ...session.sessions.circuits(session.id)]), dispose: session.close};
              } catch (error) { session.close(); throw error; }
            }
            world = sharedWorld;
          } else world = createWorld(knowledge);
          try {
            const gold = execute(world, query);
            if (score(row.expected, gold).outcome !== 'correct') throw new Error(`${row.id}: gold fails on product path: ${JSON.stringify(score(row.expected, gold))}`);
            const slice = goldSlice(world, query, gold);
            if (!equivalent(gold, oracleOverSlice(slice, query))) throw new Error(`${row.id}: gold evidence replay differs`);
            const evidence = evidenceFor(slice, row.question);
            for (const arm of activeArms) {
              if (done.has(`${row.id}/${arm}`)) continue;
              const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'symbolic-bench-author-'));
              try {
                const record = await runArm({row, arm, world, gold, slice, evidence, knowledge, query, settings, folder});
                records.push(record); done.add(`${row.id}/${arm}`); fs.appendFileSync(recordFile, JSON.stringify(record) + '\n');
                console.error(`${row.id} ${arm} ${record.outcome} ${record.latency.wall_ms}ms`);
              } finally { fs.rmSync(folder, {recursive: true, force: true}); }
            }
          } finally { if (world !== sharedWorld) world.dispose(); }
        }
        const current = records.filter(r => r.family === family);
        const decision = stopDecision(current, stage);
        fs.appendFileSync(path.join(out, 'stages.jsonl'), JSON.stringify({family, stage, pilot: Boolean(pilot), ...decision}) + '\n');
        if (decision.stop) {
          const {execFileSync} = await import('node:child_process');
          const detail = JSON.stringify({family, stage, ...decision});
          const env = {...process.env, CHATSOP_ACTOR: process.env.CHATSOP_ACTOR ?? 'omp-t5-pilot'};
          execFileSync(process.execPath, ['tools/journal.mjs', 'add', '--area', 'eval', '--state', 'progress', '--title', 'Benchmark staged stop', '--detail', detail], {env});
          execFileSync(process.execPath, ['tools/notes.mjs', 'add', '--topic', 'evaluation', '--kind', 'result', '--title', 'Benchmark staged stop', '--body', detail], {env});
          const registryFile = new URL('../../../status/experiments.json', import.meta.url);
          const registry = readExperiments({file: registryFile});
          const experiment = registry.experiments.find(e => e.id === 'eval-symbolic-vs-llm-v1');
          if (!experiment) throw new Error('benchmark experiment is not registered');
          experiment.results ??= {};
          experiment.results.stage_stops ??= [];
          experiment.results.stage_stops.push({family, stage, ...decision, report: path.relative(process.cwd(), out)});
          fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n');
          fs.appendFileSync(new URL('../../../PAS_TASK.md', import.meta.url), `\nBenchmark staged stop: ${detail}. Evidence: ${path.relative(process.cwd(), out)}/stages.jsonl.\n`);
          if (decision.reason === 'broken') { activeArms = activeArms.filter(a => !decision.dropped_arms.includes(a)); if (!activeArms.length) break; }
          else break;
        }
      }
    }
    return writeReport(out, {pilot: Boolean(pilot), provenance: config});
  } finally { sharedWorld?.dispose(); await stop(); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await main()));
