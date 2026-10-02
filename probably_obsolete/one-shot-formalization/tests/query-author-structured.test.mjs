import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {structuredRequest, compileCircuit} from '../lib/query-author/structured/compiler.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {Runtime} from '../sop/runtime.mjs';
import {Repository} from '../memory/repository.mjs';
import {publishKnowledge} from '../sop/ingest.mjs';

const candidates = {
  predicates: [
    {id: 'works_at', roles: [{name: 'subject', type: 'person'}, {name: 'object', type: 'organization'}]},
    {id: 'certified', roles: [{name: 'subject', type: 'person'}]},
    {id: 'aged', roles: [{name: 'subject', type: 'person'}, {name: 'object', type: 'integer'}]},
    {id: 'born', roles: [{name: 'subject', type: 'person'}]}
  ], entities: ['Ana', 'Ion', 'Maria', 'Acme'], numbers: [0, 1, 2, 3, 40, 84], times: ['2020', '2021']
};
const ontology = `@works_at predicate
  role subject person
  role object organization
@certified predicate
  role subject person
@aged predicate
  role subject person
  role object integer
@born predicate
  role subject person
@ana entity
  kind person
  label en "Ana"
@ion entity
  kind person
  label en "Ion"
@maria entity
  kind person
  label en "Maria"
@acme entity
  kind organization
  label en "Acme"
`;
const facts = [
  ['works_at ana acme'], ['works_at ion acme'], ['works_at maria acme'],
  ['certified ana'], ['certified ion'], ['not certified maria'],
  ['aged ana 84'], ['aged ion 40'], ['born maria', '2021-05-01 open']
].map(([holds, valid = 'timeless'], i) => `@f${i} fact\n  holds ${holds}\n  valid ${valid}\n  source world`).join('\n\n');
const v = name => ({kind: 'variable', value: name});
const e = name => ({kind: 'entity', value: name});
const n = number => ({kind: 'number', value: number});
const m = (predicate, roles, polarity = 'affirmed') => ({predicate, polarity, roles: Object.entries(roles).map(([name, value]) => ({name, value}))});
const group = (...matches) => ({op: 'all', matches, groups: []});
const age = group(m('aged', {subject: v('?x'), object: v('?v')}));
const decode = circuit => structuredRequest(candidates).decode(JSON.stringify({circuit}));
const answers = result => (result.result.packet.answers ?? []).map(a => Object.values(a.binding)[0]).sort();
async function execute(sop) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'structured-'));
  try {
    const lexicon = new Lexicon(ontology);
    const repo = new Repository(dir, {memory: {engine: 'scan'}});
    publishKnowledge(repo, 'world', facts, {schema: lexicon.predicates, reviewed: true, knownAt: Date.parse('2023-06-01')});
    return await new Runtime({repo, session: repo.session('world', 't', 'evaluation'), lexicon, schema: lexicon.predicates, now: Date.parse('2026-09-28T12:00:00Z'), policy: {}}).run(sop, {origin: 'model', language: 'en', context: {statements: []}});
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('count and joined selection execute over a real memory', async () => {
  const where = group(m('works_at', {subject: v('?x'), object: e('Acme')}), m('certified', {subject: v('?x')}));
  assert.equal((await execute(decode({kind: 'count', where, select: '?x'}))).result.packet.count, 2);
  assert.deepEqual(answers(await execute(decode({kind: 'chain', where, select: '?x'}))), ['ana', 'ion']);
});

test('bound comparison, rank and every scope preserve question semantics', async () => {
  const tests = {op: 'all', items: [{left: '?v', comparator: 'above', right: n(40)}, {left: '?v', comparator: 'at_most', right: n(84)}]};
  assert.deepEqual(answers(await execute(decode({kind: 'compare', where: age, select: '?x', tests}))), ['ana']);
  assert.deepEqual(answers(await execute(decode({kind: 'rank', where: age, select: '?x', value: '?v', direction: 'highest', cut: {kind: 'all', value: null}, options: null}))), ['ana']);
  const options = {op: 'any', items: [{left: '?x', comparator: 'equal', right: e('Ana')}, {left: '?x', comparator: 'equal', right: e('Ion')}]};
  assert.deepEqual(answers(await execute(decode({kind: 'rank', where: age, select: '?x', value: '?v', direction: 'lowest', cut: {kind: 'all', value: null}, options}))), ['ion']);
  const where = group(m('works_at', {subject: v('?x'), object: e('Acme')}));
  const scope = group(m('certified', {subject: v('?x')}));
  assert.equal((await execute(decode({kind: 'every', where, scope, select: null, quantifier: 'most', threshold: null}))).result.packet.status, 'supported');
  assert.equal((await execute(decode({kind: 'every', where, scope, select: null, quantifier: 'all', threshold: null}))).result.packet.status, 'refuted');
});

test('time-order and numeric bounded assignment execute without an answer in model output', async () => {
  const where = group(m('born', {subject: e('Maria'), time: v('?t1')}), m('born', {subject: e('Maria'), time: v('?t2')}));
  const temporal = decode({kind: 'temporal', where, select: null, time: null, period: 'none', measure: 'none', order: {left: '?t1', relation: 'same_time', right: '?t2'}});
  assert.equal((await execute(temporal)).result.packet.status, 'supported');
  const moment = group(m('born', {subject: e('Maria')}));
  const at = time => decode({kind: 'temporal', where: moment, select: null, time, period: 'during', measure: 'none', order: null});
  assert.equal((await execute(at('2021'))).result.packet.status, 'supported');
  assert.notEqual((await execute(at('2020'))).result.packet.status, 'supported');
  const expr = (first, rest = []) => ({first, rest});
  const plus = (a, b) => expr(a, [{op: 'plus', term: b}]);
  const times = (a, b, last) => expr(a, [{op: 'times', term: b}, {op: 'plus', term: last}]);
  const eq = (left, right, comparator = 'equal') => ({left, comparator, right});
  const numeric = decode({kind: 'numeric', variables: [{name: '?x', min: 0, max: 3}, {name: '?y', min: 0, max: 3}], requirements: [
    eq(plus(v('?x'), v('?y')), expr(n(3))),
    eq(times(n(2), v('?x'), v('?y')), expr(n(3))),
    eq(expr(v('?x')), expr(v('?y')), 'below')
  ], claim: null, task: 'possible', objective: null, direction: null, select: ['?x', '?y']});
  const packet = (await execute(numeric)).result.packet;
  assert.equal(packet.status, 'possible');
  assert.deepEqual(packet.witness, {x: 0, y: 3});
});

test('rejection boundaries include unknown choices, unsafe fields, missing bindings and empty candidate enums', () => {
  const lookup = {kind: 'lookup', where: age, select: '?x'};
  const bad = changes => ({...lookup, ...changes});
  assert.throws(() => decode(bad({answer: 'Ana'})), /unsafe fields/);
  assert.throws(() => decode(bad({where: group(m('unknown', {subject: v('?x')}))})), /unknown predicate/);
  assert.throws(() => decode(bad({where: group(m('aged', {recipient: v('?x')}))})), /predicate role/);
  assert.throws(() => decode(bad({where: group(m('aged', {subject: e('Unlisted')}))})), /offered value/);
  assert.throws(() => decode(bad({select: '?unlisted'})), /unknown variable/);
  assert.throws(() => decode(bad({select: '?y'})), /unbound selected variable/);
  assert.throws(() => decode(bad({where: {op: 'any', matches: [m('aged', {subject: v('?x')}), m('aged', {subject: v('?y')})], groups: []}})), /unbound selected variable/);
  assert.throws(() => decode({kind: 'rank', where: age, select: '?x', value: '?y', direction: 'highest', cut: {kind: 'all', value: null}, options: null}), /unbound ranked value/);
  assert.throws(() => decode({kind: 'numeric', variables: [{name: '?x', min: null, max: null}], requirements: [], claim: {left: {first: e('Ana'), rest: []}, comparator: 'equal', right: {first: n(3), rest: []}}, task: 'prove', objective: null, direction: null, select: []}), /numeric expression needs integers/);
  assert.throws(() => decode({kind: 'numeric', variables: [{name: '?x', min: 0, max: 3}], requirements: [], claim: {left: {first: v('?z'), rest: []}, comparator: 'equal', right: {first: n(3), rest: []}}, task: 'prove', objective: null, direction: null, select: []}), /undeclared expression variable/);
  assert.throws(() => decode({kind: 'numeric', variables: [{name: '?x', min: 0, max: 9}], requirements: [], claim: null, task: 'possible', objective: null, direction: null, select: ['?x']}), /unoffered/);
  const empty = {predicates: [], entities: [], numbers: [], times: []};
  const schema = structuredRequest(empty).extraBody.response_format.json_schema.schema;
  const visit = node => {if (node && typeof node === 'object') {if (Object.hasOwn(node, 'enum')) assert.ok(node.enum.length); for (const value of Object.values(node)) visit(value);}};
  visit(schema);
  assert.match(compileCircuit({circuit: {kind: 'unclear', reason: 'relation_not_in_memory'}}, empty), /kind relation_not_in_memory/);
});
