#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateQuery, unclearKind} from '../../../lib/query-author/index.mjs';
import {chainEntry} from '../../../lib/llm-providers.mjs';
import {splitCircuits} from '../../../lib/query-author/session.mjs';
import {parse as parseRuntime} from '../../../sop/parser.mjs';
import {parse as parseKnowledge} from '../../../sop/knowledge/lexical.mjs';
import {runCompletion} from '../../../reasoning/strategies/llm-agent/completion.mjs';
import {nlPrompt, SYSTEM_PROMPT, ANSWER_MARKER, PROMPT_VERSION} from '../../../reasoning/strategies/llm-agent/prompt.mjs';
import {parseAnswer} from '../../../reasoning/strategies/llm-agent/packet.mjs';
import {verifyUsed} from '../../../reasoning/strategies/llm-agent/verify.mjs';
import {renderEnglish} from '../../../reasoning/slice/render-english.mjs';
import {cnl} from '../../../sop/cnl.mjs';
import {wireText} from '../../../sop/knowledge/index.mjs';
import {LIMITS, createWorld, execute, linkCircuit, withDefinitions, goldSlice, oracleOverSlice} from './world.mjs';
import {score, equivalent, failureLayer} from './score.mjs';
import {writeReport, stopDecision} from './report.mjs';
import {openSession, defaultRoot} from '../lib/session.mjs';
import {readExperiments} from '../../../lib/journal.mjs';
import {localStrategy} from '../../../lib/formalize/strategies.mjs';
const stepStrategies = new Map();
import {tierLadder} from '../lib/tier-parser.mjs';
/**
 * Owner decision 2026-10-02: formalization is step by step only; the one-shot author arms (B: a local model writes free SOP with repair
 * rounds; B-grammar and B-structured: its constrained decoders; B-local: the same loop on the strategy slot) are archived in
 * probably_obsolete/one-shot-formalization/. Arm C is the step-by-step strategy with its questions answered by the TinyAgent tier
 * `settings.tier` (default small; like with like with B-stepbystep on the small local model). The local arms (A, A', B-stepbystep)
 * ask the TinyAgent tier `settings.localTier` (default micro, the local Qwen3-4B-Instruct that TinyAgent starts on demand); every model
 * call goes through TinyAgent (lib/tinyagent.mjs).
 */
export const DEFAULT_LOCAL_TIER = 'micro';
export const ARCHIVED_ARMS = Object.freeze(['B', 'B-grammar', 'B-structured', 'B-local']);
const RUNTIME = JSON.parse(fs.readFileSync(new URL('../../../config/runtime.json', import.meta.url), 'utf8'));
/** A reviewed circuit replayed through the same validator as every formalizer (zero model calls): the author result shape. */
export function replayAuthor(sop, message, world) {
  const validation = validateQuery({sop, message, lexicon: world.lexicon, repo: world.repo ?? null, session: world.session ?? null});
  return {ok: validation.ok, status: validation.ok ? 'validated' : 'invalid', sop, validation, unclear: validation.ok ? unclearKind(validation.program) : null,
    usage: {input_tokens: 0, output_tokens: 0, cost_usd: 0}, runs: [{round: 0, ok: true, duration_ms: 0}], model: 'reviewed-circuit'};
}

export const VERSION = 'symbolic-vs-llm-m1-v1';
const sha = value => createHash('sha256').update(value).digest('hex');
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
  for (const directory of ['lib', 'sop', 'memory', 'reasoning', 'config/knowledge/formalizer-protocol-v1', 'tools/eval/symbolic-vs-llm']) visit(directory);
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
    if (ARCHIVED_ARMS.includes(arm)) throw new Error(`arm ${arm} (one-shot circuit authoring) is archived (owner decision 2026-10-02); use B-stepbystep or C`);
    // settings.replayCircuit (or an `authorBackend` of kind replay): a reviewed circuit through the same validator, zero model calls.
    const replay = arm !== 'C' ? null : settings.replayCircuit ?? (settings.authorBackend?.kind === 'replay' ? (await settings.authorBackend.generate({})).sop : null);
    if (replay != null) author = replayAuthor(replay, row.question, world);
    else if (arm === 'B-stepbystep' || arm === 'C') {
      // The product's step-by-step strategies: the system asks short questions and writes the circuit from the answers. B-stepbystep on
      // the local tier settings.localTier (default micro); C on the TinyAgent tier settings.tier (default small).
      // settings.stepMethod: the question protocol of LocalLLMStepByStep (A, or B, C, D and ablations of eval-stepbystep-protocol-v1).
      // settings.strategy: InternalReasoningStepByStep runs on the same arm (its own slot), with settings.reasoningControl (plan | greedy).
      const name = settings.strategy ?? 'LocalLLMStepByStep', method = settings.stepMethod ?? (arm === 'C' ? 'B' : 'A'), control = settings.reasoningControl ?? 'plan';
      const tier = arm === 'C' ? settings.tier ?? 'small' : settings.localTier ?? DEFAULT_LOCAL_TIER;
      const key = `${name}@tier:${tier}#${method}#${control}`;
      const local = {tier, ladder: arm === 'C' ? tierLadder(RUNTIME, tier) : null, maxTokens: settings.maxTokens, method, reasoningControl: control, tags: {purpose: settings.purpose ?? 'job:symbolic-vs-llm'}};
      stepStrategies.set(key, stepStrategies.get(key) ?? localStrategy(name, local, {timeoutMs: settings.wallMs}));
      author = await stepStrategies.get(key).run({message: row.question, lexicon: world.lexicon, repo: world.repo, session: world.session, derived: new Set(world.theory?.byHead?.keys?.() ?? [])});
      latency.model_ms = author.steps ? author.steps.reduce((n, s) => n + s.ms, 0) : author.runs.reduce((n, r) => n + (r.duration_ms ?? 0), 0);
    }
    if (['C', 'B-stepbystep'].includes(arm)) {
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
      // D: the subscription model (a tier, or a concrete model of a provider); A and A': the local tier. Both through TinyAgent.
      const target = arm === 'D' ? (({upstream, model}) => ({upstream, model}))(chainEntry(settings.subscriptionModel)) : {model: settings.localTier ?? DEFAULT_LOCAL_TIER};
      const reply = await runCompletion({...target, prompt, system: SYSTEM_PROMPT, timeoutMs: settings.wallMs, maxTokens: settings.maxTokens, purpose: settings.purpose ?? 'job:symbolic-vs-llm'});
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
  return {id: row.id, family: row.family, facts: row.facts, depth: row.depth, split: row.split, arm, model: arm === 'C' ? (author?.model === 'reviewed-circuit' ? 'reviewed-circuit' : `tier:${settings.tier ?? 'small'}`) : arm === 'D' ? settings.subscriptionModel : settings.model ?? `tier:${settings.localTier ?? DEFAULT_LOCAL_TIER}`,
    parse_ok: parseOk, response_empty: responseEmpty, broken_model_output: brokenModelOutput,
    outcome: verdict.outcome, reasons: verdict.why, memory_sha256: world.theory.digest, gold_answerable: !['unknown', 'incomplete'].includes(row.expected.status), verified, proof_available: Boolean(packet?.used?.length || packet?.proof),
    evidence_does_not_fit: evidence.evidence_does_not_fit, evidence_facts: evidence.facts, evidence_chars: evidence.original_chars,
    latency, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: arm === 'C' || arm === 'D' ? cost : 0,
    author: author && {status: author.status, reason: author.reason, rounds: author.rounds, sop: author.sop, context_version: author.context_version, retrieval: author.retrieval, usage: author.usage,
      ...(arm === 'B-stepbystep' ? {steps: author.steps, plan: author.report, confirmed: author.confirmed, retried: author.retried, problem: author.problem, method: author.method ?? 'A', contrast: author.contrast,
        ...(author.trace ? {trace: author.trace, explanation: author.explanation, defaults: author.defaults, avoided: author.avoided, engine_ms: author.engine_ms} : {})} : {}),
      problems: author.validation?.problems, parsed: Boolean(author.validation?.program)},
    packet, rendered, oracle_equivalent: oracleEquivalent, error,
    failure_layer: failureLayer({arm, parseOk, outcome: verdict.outcome, author, linking, packet, oracleEquivalent, rendered, error})};
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node tools/eval/symbolic-vs-llm/run.mjs --manifest eval/smoke-reasoning/bench/manifest.jsonl --arms A,B-stepbystep[,C --tier small] [--local-tier micro] --pilot 20 --out eval/reports/current/symbolic-vs-llm/pilot [--stages 100,300,600]'); return;
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
  const arms = opt(args, '--arms', 'A,B-stepbystep').split(',');
  if (arms.some(a => ARCHIVED_ARMS.includes(a))) throw new Error(`arms ${ARCHIVED_ARMS.join(', ')} (one-shot circuit authoring) are archived (owner decision 2026-10-02); use B-stepbystep or C --tier T`);
  if (arms.some(a => !['A', "A'", 'B-stepbystep', 'C', 'D'].includes(a))) throw new Error('unknown arm');
  if (rows.some(r => r.split !== 'dev') && arms.some(a => ['B-stepbystep', 'C'].includes(a))) throw new Error('the step-by-step authoring arms are dev-only until the sealed protocol is re-registered (its arms B and C were one-shot authoring, archived 2026-10-02)');
  for (const gone of ['--endpoint', '--port', '--model']) if (args.includes(gone)) throw new Error(`${gone} is gone: every model call goes through TinyAgent; name the local tier with --local-tier (default ${DEFAULT_LOCAL_TIER})`);
  const localTier = opt(args, '--local-tier', DEFAULT_LOCAL_TIER);
  const settings = {model: `tier:${localTier}`, localTier, subscriptionModel: opt(args, '--subscription-model', 'openference/Qwen3.8 27b'), tier: opt(args, '--tier', 'small'), wallMs: Number(opt(args, '--wall-ms', 180000)), maxTokens: Number(opt(args, '--max-tokens', 4096))};
  if (/^openrouter\b/.test(settings.subscriptionModel) && !args.includes('--allow-paid')) throw new Error('openrouter is paid per token; pass --allow-paid for an explicitly authorized run');
  // TinyAgent serves the tiers and reports the model that answered; the harness does not hash a model file.
  const modelManifest = {source: 'tinyagent-tier', local_tier: localTier, identity_verified: false};
  const out = path.resolve(opt(args, '--out', 'eval/reports/current/symbolic-vs-llm/pilot'));
  fs.mkdirSync(out, {recursive: true});
  const config = {version: VERSION, harness_sha256: sha(fs.readFileSync(new URL(import.meta.url), 'utf8')), world_sha256: sha(fs.readFileSync(new URL('./world.mjs', import.meta.url), 'utf8')), runtime: {node: process.version, arch: process.arch, platform: process.platform}, model_manifest: modelManifest, manifest_sha256: sha(manifestText), settings: {...settings, retrieval_limits: LIMITS, subscription_token_budget: 'post-response usage admission of the remote model'}, arms, pilot, prompt_version: PROMPT_VERSION, prompt_sha256: sha(nlPrompt({source: '', reasoning: 'direct'}) + runArm.toString()), renderer_sha256: sha(fs.readFileSync(new URL('../../../reasoning/slice/render-english.mjs', import.meta.url), 'utf8')), stages: pilot ? [pilot] : opt(args, '--stages', '100,300,600').split(',').map(Number)};
  config.runtime_sources = sourceHashes();
  config.runtime_source_sha256 = sha(JSON.stringify(config.runtime_sources));
  const configFile = path.join(out, 'run.json');
  if (fs.existsSync(configFile) && JSON.stringify(JSON.parse(fs.readFileSync(configFile, 'utf8'))) !== JSON.stringify(config)) throw new Error('run identity changed; use a fresh output directory');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  const recordFile = path.join(out, 'records.jsonl');
  const records = fs.existsSync(recordFile) ? fs.readFileSync(recordFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const done = new Set(records.map(r => `${r.id}/${r.arm}`));
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
  } finally { sharedWorld?.dispose(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await main()));
