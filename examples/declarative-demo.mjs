#!/usr/bin/env node
/** Runs the declarative example through the real host path: model-origin
 * declarative SOP in, host-compiled circuit out, plus a conditional answer.
 * No model endpoint is required; this exercises admission, compilation and
 * execution, not language-model quality.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Runtime} from '../sop/runtime.mjs';
import {Repository} from '../memory/repository.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {publishKnowledge} from '../sop/ingest.mjs';
import {MODEL_TYPES} from '../sop/declarative.mjs';
import {parse} from '../sop/parser.mjs';
import {assert} from '../lib/util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-declarative-demo-'));
try {
  const lexicon = Lexicon.load(new URL('../config/ontology.sop', import.meta.url));
  const repo = new Repository(root, {memory: {engine: 'sqlite', power: 10}});
  publishKnowledge(repo, 'demo', fs.readFileSync(new URL('../tests/fixtures/bootstrap.sop', import.meta.url), 'utf8'), {schema: lexicon.predicates, reviewed: true, knownAt: Date.parse('2024-01-01')});
  const session = repo.session('demo', 'local', 'demo');
  const source = fs.readFileSync(new URL('./declarative.sop', import.meta.url), 'utf8');
  const authored = parse(source);
  assert(authored.wires.every(wire => MODEL_TYPES.has(wire.type)), 'Example must stay declarative');
  const result = await new Runtime({repo, session, schema: lexicon.predicates, lexicon, now: Date.parse('2026-09-26T12:00:00Z')}).run(source, {origin: 'model', inputText: 'Is Carina a parent of Ana?', language: 'en'});
  assert(result.result.packet.status === 'supported', 'Example question must be supported by the conditional premise');
  assert(result.result.packet.hypothetical === true, 'Answer must remain hypothetical');
  assert(Object.keys(session.live.claims).length === 0, 'Conditional premises must not become repository claims');
  assert(/\@\w+ solve/.test(result.executionSop), 'Host must generate the execution circuit');
  console.log('authored:');console.log(result.authoredSop);
  console.log('host circuit:');console.log(result.executionSop);
  console.log('result:');
  console.log(JSON.stringify({status: result.result.packet.status, hypothetical: result.result.packet.hypothetical, answers: (result.result.packet.answers ?? []).map(answer => answer.binding), repositoryClaims: Object.keys(session.live.claims).length, conditionalPremises: result.contextPremises.map(premise => ({atom: `${premise.atom.p} ${premise.atom.a.join(' ')}`, origin: premise.origin, text: premise.text}))}, null, 2));
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
