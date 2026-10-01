import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse, SPEC} from '../sop/parser.mjs';
import {epistemicResult, STATUS_DECISIONS} from '../eval/contracts.mjs';
import {evaluate} from '../eval/run.mjs';
import {Runtime} from '../sop/runtime.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {CAPABILITIES} from '../reasoning/registry.mjs';
import {context, schema} from './helpers.mjs';
import {readJsonlShardedSync} from '../lib/jsonl-shards.mjs';

/** A model-language formalization row of the regenerated corpus (DS022). */
const row = () => readJsonlShardedSync(new URL('../datasets_archive/formalizer-v1/dev.jsonl', import.meta.url).pathname)[0];

const run = source => new Runtime({now: Date.parse('2026-09-26')}).run(source);
const query = '@q query\n  where bird robin\n';
const fact = (id, holds) => `@${id} fact\n  holds ${holds}\n  valid timeless\n`;
const reason = '@r reason\n  query $q\n  data $data';
const packet = execution => epistemicResult(execution.result.packet ?? execution.result);

test('SOP language admits whitespace atoms and refuses foreign syntax/model authority', async () => {
  assert.equal(parse('@f fact\n  holds parent mara sorin\n  valid timeless').wires[0].type, 'fact');
  assert.deepEqual(SPEC.fact.required, ['holds', 'valid']);
  assert.throws(() => parse('@f fact\n  holds parent(?x, ?y)\n  valid timeless'), /Expected|Invalid/);
  await assert.rejects(new Runtime().run(fact('f', 'bird robin'), {origin:'model'}), /Model|declarative|Forbidden|forbidden/);
});

test('result projection retains contradiction, hypothesis and search completeness', async () => {
  const result = await run(fact('yes','bird robin') + fact('no','not bird robin') + '@data pack\n  items $yes $no\n' + query + reason);
  assert.equal(result.result.status, 'both');
  assert.equal(packet(result).status, 'CONFLICT');
  assert.equal(packet(result).runtime_status, 'both');
  const limited = await run('@rule rule\n  when flying ?x\n  then bird ?x\n@h hypothesis\n  holds flying robin\n@data pack\n  items $rule\n' + query + '@limit policy\n  maxCandidates 1\n@r abduce\n  query $q\n  data $data\n  candidates $h\n  policy $limit');
  assert.equal(limited.result.complete, false);
  assert.equal(packet(limited).complete, false);
  assert.notEqual(packet(limited).status, 'ENTAILED');
  assert.deepEqual(epistemicResult({status:'supported', conflictedAnswers:[{binding:{}}], complete:false, hypothetical:true, guarantee:'bounded'}), {
    status:'CONFLICT', runtime_status:'supported', complete:false, hypothetical:true, guarantee:'bounded',
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
  // The user's own default ("Normally ...") is a hedged user statement: conditional, never a hard rule.
  const lexicon = new Lexicon('@likes predicate\n  role subject person\n  role object entity\n  alias en "likes"\n@ana entity\n  kind person\n  label en "Ana"\n@book entity\n  kind entity\n  label en "this book"');
  const question = '@q query\n  where match\n    relation "likes"\n    role subject "Ana"\n    role object "this book"\n    polarity affirmed\n  end';
  const statement = '@p stated\n  relation "likes"\n  role subject "Ana"\n  role object "this book"\n  polarity affirmed\n  certainty hedged\n' + question;
  const model = new Runtime({lexicon, schema:lexicon.predicates, now:Date.parse('2026-09-26')});
  const conditional = await model.run(statement, {origin:'model', inputText:'Normally Ana likes this book.', context:{statements:[]}});
  assert.equal(conditional.result.packet.status, 'supported');
  assert.equal(packet(conditional).status, 'PLAUSIBLE');
  assert.equal(packet(conditional).hypothetical, true);
  const absent = await model.run(question, {origin:'model', context:{statements:[]}});
  assert.equal(packet(absent).status, 'UNKNOWN');
  // A contrary sourced observation defeats the hedged statement; the statement is not a stored claim.
  const c = context({bootstrap:false});
  try {
    await c.run(fact('negative','not likes ana book') + '@save remember\n  input $negative');
    const exception = await new Runtime({repo:c.repo,session:c.session,lexicon,schema:lexicon.predicates,now:Date.parse('2026-09-26T12:00:00Z')}).run(statement, {origin:'model', inputText:'Normally Ana likes this book.', context:{statements:[]}});
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
  const options = {predictor:() => original.sop_target, config:{memory:{engine:'scan'}}, modelManifest:{model:'fixture'}};
  const report = await evaluate([original], options);
  assert.match(report.suite_sha256, /^[a-f0-9]{64}$/);
  assert.match(report.config_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.model_identity_verified, false);
  assert.deepEqual(report.model_manifest, options.modelManifest);
  await assert.rejects(evaluate([original,original], options), /Duplicate evaluation IDs/);
  const changed = await evaluate([original], {...options,config:{memory:{engine:'sqlite'}}});
  assert.notEqual(changed.config_sha256, report.config_sha256);
  assert.equal(changed.suite_sha256, report.suite_sha256);
});
