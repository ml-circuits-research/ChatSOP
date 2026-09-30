import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, canonical, parseAtom, emitAtom } from '../sop/parser.mjs';
import { Runtime } from '../sop/runtime.mjs';
import {checkModelProgram, MODEL_TYPES} from '../sop/declarative.mjs';
import {compareProgramPropositions, propositionMetrics, withoutBasis} from './propositions.mjs';
import { Lexicon } from '../sop/lexicon.mjs';
import { publishKnowledge } from '../sop/ingest.mjs';
import { Repository } from '../memory/repository.mjs';
import { Agent } from '../server/agent.mjs';
import { complete, barePrompt } from '../server/llm.mjs';
import { stable, digest } from '../lib/util.mjs';
import { readJsonlShardedSync } from '../lib/jsonl-shards.mjs';
import { atomKey } from '../lib/types.mjs';
import { interval, serialInterval } from '../lib/time.mjs';
import { executionSignature } from './signature.mjs';
import { withInlineWorld, verificationContext } from '../lib/row-world.mjs';
import { epistemicResult, fraction, distribution } from './contracts.mjs';
import { referenceFreeRecord, referenceFreeMetrics } from './reference-free.mjs';
import { tolerantOntology } from './synonyms.mjs';
import { rowWireComparison, tolerantCanonicalMatch, wireMetrics } from './metrics.mjs';
import { sliceFields, slices } from './slices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = text => createHash('sha256').update(text).digest('hex');
// Suites and predictions may be stored as shards (lib/jsonl-shards.mjs); the logical base path reads either form.
const readRows = file => readJsonlShardedSync(file);
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
  if (row.evaluation_track === 'formalization') {
    checkModelProgram(program);
    assert(MODEL_TYPES.has(program.wires.at(-1)?.type), 'Model SOP must contain only model-language declarations');
  } else {
    assert.equal(row.evaluation_track, 'system', 'Suite row must declare formalization or system evaluation_track');
    assert(['cnl', 'clarify', 'remember', 'solve'].includes(program.wires.at(-1)?.type), 'System circuit must end in a checked result operation');
  }
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
  if (row.evaluation_track === 'formalization') {
    assert.equal(Object.values(session.live.claims).length, 0, 'Model declarations must not write repository claims');
    assert.equal(session.live.events.length, 0, 'Model declarations must not write repository events');
    // Model-language reports (DS021): lowered statements and model assumptions, compared by atom, validity and label.
    const reported = (list, extra) => (list ?? []).map(item => stable({atom:item.atom, valid:item.valid, [extra]:item[extra]})).sort();
    const goldReport = (list, extra, fallback) => list.map(item => stable({atom:emitAtom(parseAtom(item.holds)), valid:serialInterval(interval(item.valid ?? 'timeless')), [extra]:item[extra] ?? fallback})).sort();
    if (row.expected?.user_statements) assert.deepEqual(reported(packet.user_statements, 'certainty'), goldReport(row.expected.user_statements, 'certainty', 'asserted'), 'Gold user statements disagree with independent reference');
    if (row.expected?.model_assumptions) assert.deepEqual(reported(packet.model_assumptions, 'basis'), goldReport(row.expected.model_assumptions, 'basis', 'unspecified'), 'Gold model assumptions disagree with independent reference');
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
    execution_equivalence_tolerant: fraction(records.filter(record => record.execution_equivalent_tolerant).length, referenceValid.length),
    canonical_match_tolerant: fraction(records.filter(record => record.canonical_match_tolerant).length, referenceValid.length),
    canonical_match_primary: fraction(records.filter(record => record.canonical_match_primary).length, referenceValid.length),
    execution_equivalence_primary: fraction(records.filter(record => record.execution_equivalent_primary).length, referenceValid.length),
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
  assert(source !== 'endpoint' || rows.every(row => row.evaluation_track === 'formalization'), 'A formalizer endpoint cannot be evaluated on trusted system circuits');
  for (const row of rows) {
    assert(typeof row.id === 'string' && typeof (row.sop_target ?? row.target) === 'string', 'Each row needs an ID and reference SOP');
    assert(typeof row.setup_sop === 'string' && verificationContext(row), `Missing setup/verification_context: ${row.id}`);
    assert(row.sop_targets_accepted === undefined || (Array.isArray(row.sop_targets_accepted) && row.sop_targets_accepted.every(text => typeof text === 'string')), `${row.id}: sop_targets_accepted must be a list of SOP strings`);
  }
  const tolerantLexicons = new Map();
  const ontology = path.resolve(root, config.ontology ?? 'config/ontology.sop');
  const lexicon = Lexicon.load(ontology);
  const lexicons = new Map();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-evaluation-'));
  const records = [];
  let requestsSucceeded = 0;
  const rss = [process.memoryUsage().rss];
  try {
    for (const [index, stored] of rows.entries()) {
      // A generated row may reference its shared verification world (lib/row-world.mjs); evaluate the full world.
      const row = withInlineWorld(stored);
      const began = performance.now();
      const record = {
        id: row.id, semantic_case_id: row.semantic_case_id ?? row.id,
        language: row.language, family: row.structure_id ?? row.case, question_type: row.question_type ?? null, evaluation_track: row.evaluation_track,
        ...sliceFields(row),
        reference_valid: false, syntax_valid: false, runtime_valid: false,
        canonical_match: false, canonical_match_primary: false, canonical_match_tolerant: false, execution_equivalent: false, execution_equivalent_primary: false, execution_equivalent_tolerant: false, timing_ms: {},
      };
      const target = row.sop_target ?? row.target;
      const question = row.question ?? row.input;
      let stage = 'reference', repo, goldSession, predSession, gold;
      const now = Date.parse(verificationContext(row).now ?? '2026-09-26T12:00:00Z');
      try {
        assert(Number.isFinite(now), 'Invalid fixed evaluation timestamp');
        // DS021: the model input is exactly the user's message, carried whole in `question`.
        // Everything else on the row (verification_context, setup, ontology, expected) is verification scaffolding.
        assert(!(row.context_assertions ?? []).length, `${row.id}: the whole user message belongs in question; context_assertions are not model input`);
        const targetProgram = parse(target);
        checkConversationalTarget(row, targetProgram);
        const targetCanonical = canonical(withoutBasis(targetProgram));
        // Q-DATA-5: every accepted reading of an ambiguous phrasing is a gold; `sop_target` stays the primary.
        const alternatives = (row.sop_targets_accepted ?? []).map(text => { const program = parse(text); checkConversationalTarget(row, program); return { text, canonical: canonical(withoutBasis(program)) }; });
        const acceptedCanonicals = new Set([targetCanonical, ...alternatives.map(item => item.canonical)]);
        let caseLexicon = lexicon;
        if (typeof row.ontology_sop === 'string' && row.ontology_sop.trim()) {
          assert.equal(typeof row.ontology_sop, 'string', 'Host ontology must be SOP text');
          record.ontology_sha256 = sha256(row.ontology_sop);
          if (!lexicons.has(record.ontology_sha256)) lexicons.set(record.ontology_sha256, new Lexicon(row.ontology_sop));
          caseLexicon = lexicons.get(record.ontology_sha256);
        }
        // Strict scoring links exactly as the world ontology declares: the host dictionary (sop/dictionary.mjs) is off
        // for every gold and for the prediction. The tolerant rerun below turns it on (DS016 "Equivalence tolerance").
        const policy = { allowWrite: row.evaluation_track === 'system' && row.input_mode === 'assertions_query', ...config.policy, dictionary: false };
        const tolerantPolicy = { ...policy, dictionary: true };
        let started = performance.now();
        repo = new Repository(path.join(temp, `case-${index}`), { memory: config.memory ?? { engine: 'sqlite', power: 10 } });
        // `late_setup_sop` holds knowledge that became known later (2025-06-01), for knowledge-cutoff (`asof`) cases.
        if (row.setup_sop?.trim()) publishKnowledge(repo, 'world', row.setup_sop, { schema: caseLexicon?.predicates, reviewed: true, knownAt: Date.parse('2023-06-01') });
        if (row.late_setup_sop?.trim()) publishKnowledge(repo, 'world', row.late_setup_sop, { schema: caseLexicon?.predicates, reviewed: true, knownAt: Date.parse('2025-06-01') });
        if (!row.setup_sop?.trim() && !row.late_setup_sop?.trim()) repo.init('world');
        goldSession = repo.session('world', 'gold', 'evaluation');
        predSession = repo.session('world', 'prediction', 'evaluation');
        record.timing_ms.setup = performance.now() - started;
        const makeRuntime = session => {
          const guard = row.evaluation_track === 'formalization' ? new Agent({ repo, session, lexicon: caseLexicon, config }) : null;
          return {
            guard,
            runtime: new Runtime({
              repo, session, lexicon: caseLexicon, schema: caseLexicon?.predicates ?? null, now, policy,
              factGuard: fact => assert.equal(fact.source, 'user', 'Conversational facts require source user'),
            }),
          };
        };
        started = performance.now();
        const goldExecutor = makeRuntime(goldSession);
        goldExecutor.guard?.validateVocabulary(target, question);
        const modelRun = () => ({ origin:'model', inputText: question, language:row.language, context:{statements:[]} });
        gold = await goldExecutor.runtime.run(target, row.evaluation_track === 'formalization' ? modelRun() : { origin:'trusted' });
        record.reference = observedResult(gold);
        record.reference_signature = executionSignature(gold, goldSession);
        checkReference(row, gold, goldSession);
        const acceptedSignatures = new Set([record.reference_signature]);
        for (const [n, alternative] of alternatives.entries()) {
          const session = repo.session('world', `gold-accepted-${n}`, 'evaluation');
          const executor = makeRuntime(session);
          executor.guard?.validateVocabulary(alternative.text, question);
          const observed = await executor.runtime.run(alternative.text, row.evaluation_track === 'formalization' ? modelRun() : { origin:'trusted' });
          acceptedSignatures.add(executionSignature(observed, session));
        }
        record.accepted_golds = 1 + alternatives.length;
        record.timing_ms.gold = performance.now() - started;
        record.reference_valid = true;
        record.gold_status = packetOf(gold).status;
        stage = 'generation';
        started = performance.now();
        // The prompt is exactly the message (DS021 message-only prompt, as the trained model sees it); a stored row.prompt is never model input.
        const prompt = barePrompt(question);
        const predicted = await predictor({ id: row.id, prompt });
        if (source === 'endpoint') requestsSucceeded++;
        record.timing_ms.model = performance.now() - started;
        // Reference-free checks read only the message and the prediction (eval/reference-free.mjs).
        record.reference_free = referenceFreeRecord(question, predicted, { lexicon: caseLexicon });
        assert.equal(typeof predicted, 'string', 'Prediction must be SOP text');
        record.prediction = predicted;
        stage = 'parse';
        const predictedProgram = parse(predicted);
        const predictedCanonical = canonical(withoutBasis(predictedProgram));
        record.syntax_valid = true;
        record.canonical_match_primary = predictedCanonical === targetCanonical;
        record.canonical_match = acceptedCanonicals.has(predictedCanonical);
        // Tolerant canonical match: id- and order-free wires with relation phrases and values compared by the dictionary.
        record.canonical_match_tolerant = record.canonical_match || [target, ...alternatives.map(item => item.text)].some(text => tolerantCanonicalMatch(text, predicted));
        record.propositions = compareProgramPropositions(targetProgram, predictedProgram);
        stage = 'prediction';
        started = performance.now();
        checkConversationalTarget(row, predictedProgram);
        const predExecutor = makeRuntime(predSession);
        predExecutor.guard?.validateVocabulary(predicted, question);
        const actual = await predExecutor.runtime.run(predicted, row.evaluation_track === 'formalization' ? modelRun() : { origin:'trusted' });
        record.timing_ms.prediction = performance.now() - started;
        record.observed = observedResult(actual);
        record.runtime_valid = true;
        record.predicted_status = packetOf(actual).status;
        record.epistemic = epistemicResult(packetOf(actual));
        record.route = packetOf(actual).route ?? null;
        record.prediction_signature = executionSignature(actual, predSession);
        record.execution_equivalent_primary = record.prediction_signature === record.reference_signature;
        record.execution_equivalent = acceptedSignatures.has(record.prediction_signature);
        record.execution_equivalent_tolerant = record.execution_equivalent;
        if (!record.execution_equivalent && row.evaluation_track === 'formalization') {
          // Tolerant comparison: the prediction alone runs again with the host dictionary enabled (Romanian or English
          // content words and their dictionary synonyms, as production links them) and with evaluation-only relation
          // synonyms added to the world's predicate declarations (eval/synonyms.mjs); every gold keeps its strict signature.
          stage = 'tolerant';
          const worldOntology = typeof row.ontology_sop === 'string' && row.ontology_sop.trim() ? row.ontology_sop : fs.readFileSync(ontology, 'utf8');
          const tolerant = tolerantOntology(worldOntology, row.verification?.relation_synonyms);
          const key = sha256(tolerant.ontology);
          if (!tolerantLexicons.has(key)) tolerantLexicons.set(key, new Lexicon(tolerant.ontology));
          const tolerantLexicon = tolerantLexicons.get(key);
          record.synonym_conflicts = tolerant.conflicts.length;
          const session = repo.session('world', 'prediction-tolerant', 'evaluation');
          const runtime = new Runtime({ repo, session, lexicon: tolerantLexicon, schema: tolerantLexicon.predicates, now, policy: tolerantPolicy,
            factGuard: fact => assert.equal(fact.source, 'user', 'Conversational facts require source user') });
          try {
            new Agent({ repo, session, lexicon: tolerantLexicon, config }).validateVocabulary(predicted, question);
            const observed = await runtime.run(predicted, modelRun());
            record.execution_equivalent_tolerant = acceptedSignatures.has(executionSignature(observed, session));
          } catch (error) {
            record.tolerant_error = error.message;
          }
        }
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
  const rowsById = new Map(rows.map(row => [row.id, row]));
  const operationalFailures = records.filter(record => !record.reference_valid || record.error?.stage === 'generation').length;
  return {
    format: 'chatsop-evaluation-v1', source,
    attempted: source === 'endpoint',
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
    propositions: propositionMetrics(records.filter(record => record.propositions).map(record => record.propositions)),
    // Partial credit (DS016 "Wire F1"): strict, tolerant and understood-part wire matches of formalization rows.
    wire_match: wireMetrics(records.filter(record => record.reference_valid && record.evaluation_track === 'formalization')
      .map(record => rowWireComparison(rowsById.get(record.id), record.prediction))),
    // Reference-free metrics read only messages and predictions (eval/reference-free.mjs, DS016).
    reference_free: referenceFreeMetrics(records.map(record => record.reference_free)),
    // Every metric by question type, language (en/ro/mixed), noise level, family and the hard slice (eval/slices.mjs).
    slices: slices(records, group => ({ ...metrics(group), reference_free: referenceFreeMetrics(group.map(record => record.reference_free)) })),
    by_language: groupedMetrics(records, 'language'), by_family: groupedMetrics(records, 'family'), by_question_type: groupedMetrics(records, 'question_type'), by_track:groupedMetrics(records,'evaluation_track'),
    limitations: ['Finite-fixture equivalence is not universal semantic equivalence.', 'No human review is implied.', 'Predictions-file evaluation does not demonstrate neural inference.'],
    records,
  };
}

/**
 * Unlabeled evaluation (DS016 "Unlabeled mode"): messages and predictions, no gold. Only the reference-free
 * metrics and their slices are computed; nothing is executed against a world, because there is none. A message
 * row is `{id, message}` (or `question`), optionally with `language`, `code_switch`, `noise_level` for slicing.
 */
export async function evaluateUnlabeled(messages, { predictor, source = 'predictions', lexicon = null } = {}) {
  assert(Array.isArray(messages) && messages.length > 0, 'Unlabeled evaluation requires a nonempty message list');
  assert.equal(new Set(messages.map(row => row.id)).size, messages.length, 'Duplicate message IDs');
  assert.equal(typeof predictor, 'function', 'An explicit predictor is required');
  const records = [];
  for (const row of messages) {
    const message = row.message ?? row.question;
    assert(typeof row.id === 'string' && typeof message === 'string', 'Each message row needs an id and a message');
    const record = { id: row.id, question_type: row.question_type ?? 'unspecified', family: row.family ?? 'unspecified', ...sliceFields({ ...row, question: message }) };
    let predicted;
    try { predicted = await predictor({ id: row.id, prompt: barePrompt(message) }); } catch (error) { record.error = { stage: 'generation', message: error.message }; }
    record.prediction = predicted ?? null;
    record.reference_free = referenceFreeRecord(message, predicted, { lexicon });
    records.push(record);
  }
  return {
    format: 'chatsop-unlabeled-evaluation-v1', source, rows: records.length,
    messages_sha256: sha256(stable(messages)),
    operational_failures: records.filter(record => record.error).length,
    reference_free: referenceFreeMetrics(records.map(record => record.reference_free)),
    slices: slices(records, group => referenceFreeMetrics(group.map(record => record.reference_free))),
    limitations: ['No gold: correctness is not measured, only plausibility (reference-free checks).', 'Predictions-file evaluation does not demonstrate neural inference.'],
    records,
  };
}

function argumentsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help') return { help: true };
    assert(['--file', '--messages', '--predictions', '--config', '--out', '--model-manifest'].includes(flag), `Unknown option: ${flag}`);
    assert(argv[index + 1] && !argv[index + 1].startsWith('--'), `Missing value for ${flag}`);
    assert(!Object.hasOwn(result, flag.slice(2)), `Duplicate option: ${flag}`);
    result[flag.slice(2)] = argv[++index];
  }
  return result;
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.help) {
    console.log('node eval/run.mjs --file suite.jsonl --out report.json [--predictions predictions.jsonl | --config runtime.json] [--model-manifest manifest.json]\n' +
      'node eval/run.mjs --messages messages.jsonl --out report.json (--predictions predictions.jsonl | --config runtime.json)   # unlabeled: reference-free metrics only');
    return;
  }
  if (args.messages) {
    assert(!args.file && args.out, 'Use --messages without --file, with --out');
    assert(args.predictions || args.config, 'Provide predictions or an explicit endpoint configuration');
    const messages = readRows(args.messages);
    const config = args.config ? JSON.parse(fs.readFileSync(args.config, 'utf8')) : {};
    let predictor, source;
    if (args.predictions) {
      const byId = new Map(readRows(args.predictions).map(row => [row.id, row.sop ?? row.prediction]));
      assert(messages.every(row => typeof byId.get(row.id) === 'string') && byId.size === messages.length, 'Prediction coverage must exactly match the messages');
      predictor = ({ id }) => byId.get(id);
      source = 'predictions';
    } else {
      assert(config.formalizer?.url && config.formalizer?.model, 'Endpoint config requires formalizer.url and formalizer.model');
      predictor = ({ prompt }) => complete(config.formalizer, prompt);
      source = 'endpoint';
    }
    const lexicon = Lexicon.load(path.resolve(root, config.ontology ?? 'config/ontology.sop'));
    const report = await evaluateUnlabeled(messages, { predictor, source, lexicon });
    const destination = path.resolve(args.out);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: destination, rows: report.rows, ...Object.fromEntries(Object.entries(report.reference_free).filter(([, v]) => v?.value !== undefined).map(([k, v]) => [k, v.value])) }, null, 2));
    if (report.operational_failures) process.exitCode = 1;
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
