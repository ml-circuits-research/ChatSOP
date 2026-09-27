import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse, PROFILE, SPEC} from '../sop/parser.mjs';
import {validateRecord} from '../tools/datasets/schema.mjs';
import {epistemicResult, STATUS_DECISIONS} from '../eval/contracts.mjs';
import {evaluate} from '../eval/run.mjs';
import {Runtime} from '../sop/runtime.mjs';
import {CAPABILITIES} from '../reasoning/registry.mjs';
import {context, schema} from './helpers.mjs';

const run = source => new Runtime({now: Date.parse('2026-09-26')}).run(source);
const query = '@q query\n  where bird robin\n';
const fact = (id, holds) => `@${id} fact\n  holds ${holds}\n  valid timeless\n`;
const reason = '@r reason\n  query $q\n  data $data';
const packet = execution => epistemicResult(execution.result.packet ?? execution.result);
const row = () => JSON.parse(fs.readFileSync(new URL('../datasets/query-v1/dev.jsonl', import.meta.url), 'utf8').split('\n')[0]);

test('SOP profile admits whitespace atoms and refuses foreign syntax/model authority', async () => {
  assert.equal(parse('@p premise\n  holds parent mara sorin').profile, PROFILE);
  assert.deepEqual(SPEC.premise.required, ['holds']);
  assert.throws(() => parse('@p premise\n  holds parent(?x, ?y)'), /Expected|Invalid/);
  await assert.rejects(new Runtime().run(fact('f', 'bird robin'), {origin:'model'}), /Model|declarative|Forbidden|forbidden/);
});

test('semantic case requires provenance and a track-specific target', () => {
  const original = row();
  assert.equal(validateRecord(original), original);
  assert.throws(() => validateRecord({...original, source: {...original.source, sha256: undefined}}), /source provenance/);
  assert.throws(() => validateRecord({...original, evaluation_track: 'other'}), /evaluation_track/);
});

test('result projection retains contradiction, hypothesis and search completeness', async () => {
  const result = await run(fact('yes','bird robin') + fact('no','not bird robin') + '@data pack\n  items $yes $no\n' + query + reason);
  assert.equal(result.result.status, 'both');
  assert.equal(packet(result).status, 'CONFLICT');
  assert.equal(packet(result).runtime_status, 'both');
  const limited = await run('@rule rule\n  when flying ?x\n  then bird ?x\n@h hypothesis\n  holds flying robin\n@data pack\n  items $rule\n' + query + '@limit policy\n  maxNodes 1\n@r abduce\n  query $q\n  data $data\n  candidates $h\n  policy $limit');
  assert.equal(limited.result.complete, false);
  assert.equal(packet(limited).complete, false);
  assert.notEqual(packet(limited).status, 'ENTAILED');
  assert.deepEqual(epistemicResult({status:'supported', conflictedAnswers:[{binding:{}}], complete:false, hypothetical:true, epistemic:'hypothetical'}), {
    status:'CONFLICT', runtime_status:'supported', complete:false, hypothetical:true, epistemic:'hypothetical',
  });
  assert.throws(() => epistemicResult({complete:true}), /runtime status/);
});

test('executable decision rows preserve proof class and do not invent a new hard inference', async () => {
  for (const [runtimeStatus, visionStatus] of Object.entries(STATUS_DECISIONS)) {
    const projected = epistemicResult({status:runtimeStatus, complete:false});
    assert.equal(projected.status, visionStatus, runtimeStatus);
    assert.equal(projected.runtime_status, runtimeStatus);
    assert.equal(projected.complete, false);
  }
  const cases = [
    [fact('f','bird robin') + '@data pack\n  items $f\n' + query + reason, 'supported', 'ENTAILED'],
    [fact('f','not bird robin') + '@data pack\n  items $f\n' + query + reason, 'refuted', 'CONTRADICTED'],
    [query + '@r reason\n  query $q', 'unknown', 'UNKNOWN'],
    ['@c constraint\n  var ?x int 0 2\n  claim ?x == 1\n  task possible\n@r solve\n  constraint $c', 'possible', 'POSSIBLE'],
    ['@c constraint\n  var ?x int 0 2\n  require ?x == 1\n  claim ?x == 1\n  task prove\n@r solve\n  constraint $c', 'entailed', 'ENTAILED'],
    ['@rule rule\n  when flying robin\n  then bird robin\n@h hypothesis\n  holds flying robin\n@data pack\n  items $rule\n' + query + '@r abduce\n  query $q\n  data $data\n  candidates $h', 'hypotheses', 'PLAUSIBLE'],
    ['@t theory\n  dialect defeasible-default\n  body "birds fly unless excepted"\n' + query + '@r reason\n  query $q\n  data $t', 'unsupported', 'UNSUPPORTED'],
  ];
  for (const [source, status, vision] of cases) {
    const result = await run(source);
    assert.equal(result.result.status, status, source);
    assert.equal(packet(result).status, vision, source);
  }
  assert.equal(epistemicResult({status:'future_unimplemented_inference'}).status, 'UNSUPPORTED');
  assert.equal(epistemicResult({status:'constructor'}).status, 'UNSUPPORTED');
});

test('DEFAULT proposal with explicit exception and absent support is never promoted to a hard rule', async () => {
  const model = new Runtime({now:Date.parse('2026-09-26')});
  const statement = '@p premise\n  holds likes ana book\n@q query\n  where likes ana book';
  const conditional = await model.run(statement, {origin:'model', inputText:'Normally Ana likes this book.', context:{premises:[]}});
  assert.equal(conditional.result.packet.status, 'supported');
  assert.equal(packet(conditional).status, 'PLAUSIBLE');
  assert.equal(packet(conditional).hypothetical, true);
  const absent = await model.run('@q query\n  where likes ana book', {origin:'model', context:{premises:[]}});
  assert.equal(packet(absent).status, 'UNKNOWN');
  // A contrary sourced observation defeats the conditional premise; the premise is not a stored claim.
  const c = context({bootstrap:false});
  try {
    await c.run(fact('negative','not likes ana book') + '@save remember\n  input $negative');
    const exception = await new Runtime({repo:c.repo,session:c.session,schema,now:Date.parse('2026-09-26T12:00:00Z')}).run(statement, {origin:'model', inputText:'Normally Ana likes this book.', context:{premises:[]}});
    assert.equal(exception.result.packet.status, 'refuted');
    assert.equal(packet(exception).status, 'CONTRADICTED');
    assert.deepEqual(exception.result.packet.defeatedAssumptions, ['assume_0']);
    assert.equal(Object.keys(c.session.live.claims).length, 1);
  } finally { c.dispose(); }
});

test('memory and reasoning capabilities require explicit admissible input and keep repository effects separate', async () => {
  assert.equal(CAPABILITIES.reference.deduce, 'finite-function-free-Horn');
  const c = context({bootstrap:false});
  try {
    const before = c.session.revision;
    const observed = await c.run(fact('f','likes ana book') + '@save remember\n  input $f');
    assert.equal(observed.result.status, 'stored');
    assert.equal(c.session.revision, before + 1);
    const known = await c.run('@q query\n  where likes ana book\n@r solve\n  query $q');
    assert.equal(known.result.status, 'supported');
    await assert.rejects(c.run('@h hypothesis\n  holds likes ana other\n@save remember\n  input $h'), /reviewed/);
    assert.equal(c.session.revision, before + 1);
  } finally { c.dispose(); }
  const noCompiler = await run('@t theory\n  dialect arbitrary\n  body "not a Horn rule"\n' + query + '@r reason\n  query $q\n  data $t');
  assert.equal(noCompiler.result.status, 'unsupported');
  assert.equal(noCompiler.result.code, 'unsupported_theory');
});

test('experiment hash identifies fixed suite/config, not verified endpoint weights', async () => {
  const original = row();
  const options = {predictor:() => original.sop_target, config:{memory:{engine:'scan'}}, modelManifest:{profile:PROFILE}};
  const report = await evaluate([original], options);
  assert.match(report.suite_sha256, /^[a-f0-9]{64}$/);
  assert.match(report.config_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.profile, PROFILE);
  assert.equal(report.model_identity_verified, false);
  assert.deepEqual(report.model_manifest, options.modelManifest);
  await assert.rejects(evaluate([original,original], options), /Duplicate evaluation IDs/);
  const changed = await evaluate([original], {...options,config:{memory:{engine:'sqlite'}}});
  assert.notEqual(changed.config_sha256, report.config_sha256);
  assert.equal(changed.suite_sha256, report.suite_sha256);
});
