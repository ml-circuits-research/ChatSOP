import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, canonical, parseAtom } from '../sop/parser.mjs';
import { Runtime } from '../sop/runtime.mjs';
import { Lexicon } from '../sop/lexicon.mjs';
import { publishKnowledge } from '../sop/ingest.mjs';
import { Repository } from '../memory/repository.mjs';
import { Agent } from '../server/agent.mjs';
import { complete, formalPrompt } from '../server/llm.mjs';
import { stable, digest } from '../lib/util.mjs';
import { atomKey } from '../lib/types.mjs';
import { interval, serialInterval } from '../lib/time.mjs';
import { executionSignature } from './signature.mjs';
import { epistemicResult, fraction, distribution } from './contracts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = text => createHash('sha256').update(text).digest('hex');
const readRows = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); } catch { throw Error(`${file}:${index + 1}: invalid JSON`); }
});
const packetOf = execution => execution.result?.packet ?? execution.result;

function expectedAnswers(packet) {
  return (packet.answers ?? []).map(answer => {
    const fields = packet.query?.select ?? Object.keys(answer.binding);
    return fields.map(field => answer.binding[field]);
  }).sort((a, b) => stable(a).localeCompare(stable(b)));
}

function observedResult(execution) {
  const packet = packetOf(execution);
  return {
    status: packet.status,
    answers: expectedAnswers(packet),
    outputs: Object.fromEntries(Object.entries(execution.outputs ?? {}).map(([name, output]) => [name, output.status === 'bound' ? output.value : { status: output.status }])),
    packet,
  };
}

function checkConversationalTarget(row, program) {
  const allowed = row.input_mode === undefined ? ['cnl', 'clarify', 'assert', 'solve'] : ['cnl', 'clarify', 'assert'];
  assert(allowed.includes(program.wires.at(-1)?.type), 'Conversational SOP must end in a checked result operation');
}

function checkReference(row, execution, session) {
  const packet = packetOf(execution);
  if (row.expected?.status) assert.equal(packet.status, row.expected.status, 'Gold status disagrees with independent reference');
  if (row.expected?.answers) {
    const wanted = [...row.expected.answers].sort((a, b) => stable(a).localeCompare(stable(b)));
    assert.equal(stable(expectedAnswers(packet)), stable(wanted), 'Gold answers disagree with independent reference');
  }
  if (row.expected?.outputs) {
    for (const [name, value] of Object.entries(row.expected.outputs)) {
      assert.deepEqual(execution.values[name], value, `Gold output ${name} disagrees with independent reference`);
    }
  }
  for (const [name, value] of Object.entries(row.expected?.packet ?? {})) {
    assert.deepEqual(packet[name], value, `Gold packet field ${name} disagrees with independent reference`);
  }
  if (row.expected?.session_claims) {
    const expected = row.expected.session_claims.map(claim => ({
      tupleHash: digest(atomKey(parseAtom(claim.holds))), valid: serialInterval(interval(claim.valid)),
      source: claim.source, quote: claim.quote, retention: claim.retention,
    })).map(stable).sort();
    const actual = Object.values(session.live.claims).map(({ tupleHash, valid, source, quote, retention }) =>
      stable({ tupleHash, valid, source, quote, retention })).sort();
    assert.deepEqual(actual, expected, 'Gold session claims disagree with independent reference');
  }
}

function metrics(records) {
  const referenceValid = records.filter(record => record.reference_valid);
  return {
    rows: records.length,
    syntax: fraction(records.filter(record => record.syntax_valid).length, records.length),
    runtime: fraction(records.filter(record => record.runtime_valid).length, records.length),
    canonical_match: fraction(records.filter(record => record.canonical_match).length, referenceValid.length),
    execution_equivalence: fraction(records.filter(record => record.execution_equivalent).length, referenceValid.length),
    unknown: fraction(records.filter(record => record.gold_status === 'unknown' && record.predicted_status === 'unknown' && record.execution_equivalent).length, records.filter(record => record.gold_status === 'unknown').length),
    unsupported_or_invalid_reference: records.filter(record => !record.reference_valid).length,
    latency_ms: Object.fromEntries(['model', 'setup', 'gold', 'prediction', 'total'].map(stage => [stage, distribution(records.map(record => record.timing_ms[stage]).filter(Number.isFinite))])),
  };
}

function groupedMetrics(records, field) {
  const groups = new Map();
  for (const record of records) {
    const key = record[field] ?? 'unspecified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return Object.fromEntries([...groups].map(([name, values]) => [name, metrics(values)]));
}

function pairedMetrics(rows, records) {
  const byCase = new Map();
  for (const record of records) {
    if (!byCase.has(record.semantic_case_id)) byCase.set(record.semantic_case_id, []);
    byCase.get(record.semantic_case_id).push(record);
  }
  const invariant = [...byCase.values()].filter(group => group.length > 1);
  const pairs = new Map();
  for (const row of rows) if (row.negative_of) pairs.set([row.semantic_case_id, row.negative_of].sort().join('\0'), [row.semantic_case_id, row.negative_of]);
  let pairCorrect = 0;
  for (const [left, right] of pairs.values()) {
    const a = byCase.get(left), b = byCase.get(right);
    if (a?.length && b?.length && [...a, ...b].every(record => record.execution_equivalent)) pairCorrect++;
  }
  return {
    paraphrase_invariance: fraction(invariant.filter(group => group.every(record => record.runtime_valid) && new Set(group.map(record => record.prediction_signature)).size === 1).length, invariant.length),
    hard_negative_pair_correctness: fraction(pairCorrect, pairs.size),
  };
}

/** The predictor receives only the model-facing prompt and ID, never gold SOP or answers. */
export async function evaluate(rows, { predictor, config = {}, source = 'predictions', modelManifest = null } = {}) {
  assert(Array.isArray(rows) && rows.length > 0, 'Evaluation requires a nonempty suite');
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'Duplicate evaluation IDs');
  assert.equal(typeof predictor, 'function', 'An explicit predictor is required; gold is never a fallback');
  for (const row of rows) {
    assert(typeof row.id === 'string' && typeof (row.sop_target ?? row.target) === 'string', 'Each row needs an ID and reference SOP');
    assert(typeof row.setup_sop === 'string' && row.context, `Missing setup/context: ${row.id}`);
  }
  const ontology = path.resolve(root, config.ontology ?? 'config/ontology.sop');
  const lexicon = Lexicon.load(ontology);
  const lexicons = new Map();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-evaluation-'));
  const records = [];
  let requestsSucceeded = 0;
  const rss = [process.memoryUsage().rss];
  try {
    for (const [index, row] of rows.entries()) {
      const began = performance.now();
      const record = {
        id: row.id, semantic_case_id: row.semantic_case_id ?? row.id,
        language: row.language, family: row.structure_id ?? row.case,
        reference_valid: false, syntax_valid: false, runtime_valid: false,
        canonical_match: false, execution_equivalent: false, timing_ms: {},
      };
      const target = row.sop_target ?? row.target;
      let stage = 'reference', repo, goldSession, predSession, gold;
      const now = Date.parse(row.context.now ?? '2026-09-26T12:00:00Z');
      try {
        assert(Number.isFinite(now), 'Invalid fixed evaluation timestamp');
        const targetProgram = parse(target);
        checkConversationalTarget(row, targetProgram);
        const targetCanonical = canonical(targetProgram);
        let caseLexicon = lexicon;
        if (row.ontology_sop !== undefined) {
          assert.equal(typeof row.ontology_sop, 'string', 'Host ontology must be SOP text');
          record.ontology_sha256 = sha256(row.ontology_sop);
          if (!lexicons.has(record.ontology_sha256)) lexicons.set(record.ontology_sha256, new Lexicon(row.ontology_sop));
          caseLexicon = lexicons.get(record.ontology_sha256);
        }
        const policy = row.input_mode === undefined ? config.policy : { allowWrite: row.input_mode === 'assertions_query', ...config.policy };
        let started = performance.now();
        repo = new Repository(path.join(temp, `case-${index}`), { memory: config.memory ?? { engine: 'sqlite', power: 10 } });
        if (row.setup_sop.trim()) publishKnowledge(repo, 'world', row.setup_sop, { schema: caseLexicon.predicates, reviewed: true, knownAt: Date.parse('2024-01-01') });
        else repo.init('world');
        goldSession = repo.session('world', 'gold', 'evaluation');
        predSession = repo.session('world', 'prediction', 'evaluation');
        record.timing_ms.setup = performance.now() - started;
        const makeRuntime = session => {
          const guard = new Agent({ repo, session, lexicon: caseLexicon, config });
          return {
            guard,
            runtime: new Runtime({
              repo, session, lexicon: caseLexicon, schema: caseLexicon.predicates, now, policy,
              atomGuard: (atom, meta) => guard.validateAtom(atom, row.context, meta),
              factGuard: fact => assert.equal(fact.source, 'user', 'Conversational facts require source user'),
            }),
          };
        };
        started = performance.now();
        const goldExecutor = makeRuntime(goldSession);
        goldExecutor.guard.validateVocabulary(target, row.context);
        gold = await goldExecutor.runtime.run(target, { origin: 'model' });
        record.reference = observedResult(gold);
        record.reference_signature = executionSignature(gold, goldSession);
        checkReference(row, gold, goldSession);
        record.timing_ms.gold = performance.now() - started;
        record.reference_valid = true;
        record.gold_status = packetOf(gold).status;
        stage = 'generation';
        started = performance.now();
        const question = [...(row.context_assertions ?? []), row.question ?? row.input].join('\n');
        const prompt = row.prompt ?? formalPrompt(question, row.context);
        const predicted = await predictor({ id: row.id, prompt });
        if (source === 'endpoint') requestsSucceeded++;
        record.timing_ms.model = performance.now() - started;
        assert.equal(typeof predicted, 'string', 'Prediction must be SOP text');
        record.prediction = predicted;
        stage = 'parse';
        const predictedProgram = parse(predicted);
        const predictedCanonical = canonical(predictedProgram);
        record.syntax_valid = true;
        record.canonical_match = predictedCanonical === targetCanonical;
        stage = 'prediction';
        started = performance.now();
        checkConversationalTarget(row, predictedProgram);
        const predExecutor = makeRuntime(predSession);
        predExecutor.guard.validateVocabulary(predicted, row.context);
        const actual = await predExecutor.runtime.run(predicted, { origin: 'model' });
        record.timing_ms.prediction = performance.now() - started;
        record.observed = observedResult(actual);
        record.runtime_valid = true;
        record.predicted_status = packetOf(actual).status;
        record.epistemic = epistemicResult(packetOf(actual));
        record.route = packetOf(actual).route ?? null;
        record.prediction_signature = executionSignature(actual, predSession);
        record.execution_equivalent = record.prediction_signature === record.reference_signature;
      } catch (error) {
        record.error = { stage, message: error.message };
      }
      record.timing_ms.total = performance.now() - began;
      records.push(record);
      rss.push(process.memoryUsage().rss);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  const operationalFailures = records.filter(record => !record.reference_valid || record.error?.stage === 'generation').length;
  return {
    format: 'chatsop-evaluation-v1', source,
    profile: 'sop-agent-3', attempted: source === 'endpoint',
    requests_succeeded: requestsSucceeded, model_identity_verified: false,
    model_manifest: modelManifest,
    model_identity_note: 'A supplied manifest records provenance; it does not attest to endpoint weights.',
    evaluated_rows: records.filter(record => record.runtime_valid).length,
    operational_failures: operationalFailures,
    evaluation_valid: operationalFailures === 0,
    suite_sha256: sha256(stable(rows)), config_sha256: sha256(stable(config)),
    runtime: { node: process.version, arch: process.arch, platform: process.platform },
    memory: { sampled_peak_rss_bytes: Math.max(...rss), measurement: 'RSS sampled between cases; not a CUDA or continuous peak measurement' },
    config: { memory: config.memory ?? { engine: 'sqlite', power: 10 }, policy: config.policy ?? {} },
    metrics: { ...metrics(records), ...pairedMetrics(rows, records) },
    by_language: groupedMetrics(records, 'language'), by_family: groupedMetrics(records, 'family'),
    limitations: ['Finite-fixture equivalence is not universal semantic equivalence.', 'No human review is implied.', 'Predictions-file evaluation does not demonstrate neural inference.'],
    records,
  };
}

function argumentsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help') return { help: true };
    assert(['--file', '--predictions', '--config', '--out', '--model-manifest'].includes(flag), `Unknown option: ${flag}`);
    assert(argv[index + 1] && !argv[index + 1].startsWith('--'), `Missing value for ${flag}`);
    assert(!Object.hasOwn(result, flag.slice(2)), `Duplicate option: ${flag}`);
    result[flag.slice(2)] = argv[++index];
  }
  return result;
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.help) {
    console.log('node eval/run.mjs --file suite.jsonl --out report.json [--predictions predictions.jsonl | --config runtime.json] [--model-manifest manifest.json]');
    return;
  }
  assert(args.file && args.out, '--file and --out are required');
  assert(args.predictions || args.config, 'Provide predictions or an explicit endpoint configuration');
  const rows = readRows(args.file);
  const config = args.config ? JSON.parse(fs.readFileSync(args.config, 'utf8')) : {};
  let predictor, source;
  if (args.predictions) {
    const predictions = readRows(args.predictions);
    const byId = new Map(predictions.map(row => [row.id, row.sop ?? row.prediction]));
    assert.equal(byId.size, predictions.length, 'Duplicate prediction IDs');
    assert.equal(byId.size, rows.length, 'Prediction coverage must exactly match the suite');
    assert(rows.every(row => typeof byId.get(row.id) === 'string'), 'Missing prediction or unknown ID');
    predictor = ({ id }) => byId.get(id);
    source = 'predictions';
  } else {
    assert(config.formalizer?.url && config.formalizer?.model, 'Endpoint config requires formalizer.url and formalizer.model');
    predictor = ({ prompt }) => complete(config.formalizer, prompt);
    source = 'endpoint';
  }
  const modelManifest = args['model-manifest'] ? JSON.parse(fs.readFileSync(args['model-manifest'], 'utf8')) : null;
  const report = await evaluate(rows, { predictor, config, source, modelManifest });
  const destination = path.resolve(args.out);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: destination, evaluation_valid: report.evaluation_valid, ...report.metrics }, null, 2));
  if (!report.evaluation_valid) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
