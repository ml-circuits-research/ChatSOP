// The deterministic half of the PSM/LFM architecture (experiments/proposal/structure-and-formalizer-models.md): the FOL reader,
// FOL → SOP-IR clausification with its rejections, SOP-IR → SOP Lang circuits executed on the product's engines (perturbation through
// the registry included), the PSM extraction → inventory converter, and the client of the two JSON tiers (a fake fetch). The service
// itself is tested in LLMAPIProvider/local-services/small-models/server.test.mjs.
// No model is called: FOL strings and PSM extractions here are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFol, showFol, tokenize} from '../lib/formalize/fol/parse.mjs';
import {folToIr} from '../lib/formalize/fol/to-ir.mjs';
import {compileIr} from '../lib/formalize/fol/to-sop.mjs';
import {sentencesOf} from '../lib/formalize/fol/input.mjs';
import {structureToIr, linkConstants, questionRanges} from '../lib/formalize/structure/to-ir.mjs';
import {loadSchema, schemaRequest, sketchSentences} from '../lib/formalize/structure/schema.mjs';
import {registryOf} from '../lib/formalize/expression-program.mjs';
import {perturbations, perturbCircuit} from '../lib/formalize/dual-check.mjs';
import {engines} from '../tools/eval/structure-formalizer/engines.mjs';
import {extractStructure, formalizeFol} from '../lib/formalize/small-models.mjs';

const unit = (text, question = false) => { const p = parseFol(text); assert.ok(p.ok, `${text}: ${p.why}`); return {ast: p.ast, question, source: text}; };
const ir = (...specs) => folToIr(specs.map(s => (Array.isArray(s) ? unit(...s) : unit(s))));

test('FOL reader: glued keywords, precedence, free variables, one structural repair, refusals', () => {
  assert.deepEqual(tokenize('NOTPenguin(x)').map(t => t.t), ['op', 'name', 'lp', 'name', 'rp']);
  assert.equal(showFol(parseFol('FORALLxFORALLy (A(x) AND B(y) IMPLIES C(x, y))').ast), 'FORALLx (FORALLy (((A(x) AND B(y)) IMPLIES C(x, y))))');
  assert.equal(showFol(parseFol('∀x (Bird(x) ∧ ¬Penguin(x) → Flies(x))').ast), 'FORALLx (((Bird(x) AND NOT Penguin(x)) IMPLIES Flies(x)))');
  assert.equal(showFol(parseFol('A(ann) OR B(ann) AND C(ann)').ast), '(A(ann) OR (B(ann) AND C(ann)))');
  assert.equal(showFol(parseFol('A(ann) IMPLIES B(ann) IMPLIES C(ann)').ast), '(A(ann) IMPLIES (B(ann) IMPLIES C(ann)))');
  const free = parseFol('PostOffice(x, east100) IMPLIES From(x, post)');
  assert.deepEqual(free.free, ['x']);
  assert.equal(free.ast.type, 'forall');
  assert.equal(parseFol('In(cedar, northland))').repaired, true);
  assert.equal(parseFol('In(cedar, northland').ok, true);
  assert.equal(parseFol('(ManyY, x)').ok, false);
  assert.equal(parseFol('').ok, false);
  const t = parseFol('Value(total, add(price, 3))').ast;
  assert.deepEqual(t.args[1], {fn: 'add', args: [{const: 'price'}, {num: 3}]});
});

test('FOL → SOP-IR: Horn clausification, Skolem constants, constraints, and named rejections', () => {
  let r = ir('Cat(tom) AND NOTDog(tom)', 'FORALLx (Cat(x) IMPLIES (Mammal(x) AND Animal(x)))');
  assert.equal(r.facts.length, 2); assert.equal(r.facts[1].negated, true);
  assert.equal(r.rules.length, 2);
  r = ir('FORALLx (Bird(x) OR Bat(x) IMPLIES Flies(x))', 'FORALLx (A(x) IMPLIES (B(x) IMPLIES C(x)))', 'FORALLx (P(x) IFF Q(x))');
  assert.equal(r.rules.length, 5);
  assert.equal(r.rules[2].when.length, 2);
  r = ir('EXISTSx (Box(x) AND Red(x))');
  assert.deepEqual(r.facts.map(f => f.args[0].const), ['sk1', 'sk1']);
  r = ir('NOTEXISTSx (Bird(x) AND Penguin(x) AND Flies(x))');
  assert.equal(r.rules[0].then.negated, true); assert.equal(r.rules[0].when.length, 2);
  r = ir('FORALLx (Bird(x) IMPLIES (Flies(x) OR Swims(x)))', 'FORALLx EXISTSy Parent(y, x)', 'FORALLx Mortal(x)', 'FORALLx (Cat(x) IMPLIES Likes(x, y))', 'A(a) XOR B(a)');
  assert.deepEqual(r.rejected.map(x => x.why.split(' ').slice(0, 3).join(' ')), ['a conclusion with', 'an existential inside', 'a statement about', 'unsafe rule: variable', 'XOR at the']);
  r = ir(['Mammal(tom)', true], ['EXISTSx Mammal(x)', true], ['Ask(earn)', true], ['Gt(earn, 50)', true], ['FORALLx (A(x) IMPLIES B(x))', true]);
  assert.deepEqual(r.queries.map(q => q.kind), ['yesno', 'which', 'value', 'compare']);
  assert.match(r.rejected[0].why, /question of the form FORALL/);
});

test('SOP-IR → SOP Lang executes on the engines: yes/no, which, closed world, constraints, time order', async () => {
  const w = await engines();
  const runAll = async (r, names = new Map()) => { const {circuits, rejected} = compileIr(r, {names}); assert.deepEqual(rejected, []); const out = []; for (const c of circuits) out.push(c.decode(await w.run(c.sop, c.literals))); return out; };
  assert.deepEqual(await runAll(ir('Cat(tom)', 'FORALLx (Cat(x) IMPLIES Mammal(x))', ['Mammal(tom)', true], ['EXISTSx Mammal(x)', true], ['Dog(tom)', true], ['EXISTSx Dog(x)', true]), new Map([['tom', 'Tom']])),
    [true, ['Tom'], false, []]);
  assert.deepEqual(await runAll(ir('NOTEXISTSx (Bird(x) AND Penguin(x) AND Flies(x))', 'Bird(pingu)', 'Penguin(pingu)', ['Flies(pingu)', true])), [false]);
  assert.deepEqual(await runAll(ir('Before(breakfast, lunch)', 'After(dinner, lunch)', ['Before(breakfast, dinner)', true], ['Before(dinner, breakfast)', true])), [true, false]);
  assert.deepEqual(await runAll(ir('Bird(tweety)', 'Bird(pingu)', 'Penguin(pingu)', 'FORALLx (Bird(x) AND NOTPenguin(x) IMPLIES Flies(x))', ['Flies(tweety)', true], ['Flies(pingu)', true], ['EXISTSx (Bird(x) AND NOTFlies(x))', true]), new Map([['pingu', 'Pingu']])), [true, false, ['Pingu']]);
  assert.deepEqual(await runAll(ir('In(cedar, northland)', 'In(northland, republic_d)', 'FORALLx FORALLy FORALLz (In(x, y) AND In(y, z) IMPLIES In(x, z))', ['In(cedar, republic_d)', true])), [true]);
});

test('values: numbers map to the registry, so the same circuit follows perturbed numbers; compare queries', async () => {
  const w = await engines();
  const message = 'A bakery bakes 24 muffins and sells them at 3 dollars each. 5 are left unsold. How much does it earn?';
  const registry = registryOf(message);
  const r = ir('Value(muffins, 24)', 'Value(price, 3)', 'Value(unsold, 5)', 'Value(earn, mul(sub(muffins, unsold), price))', ['Ask(earn)', true], ['Gt(earn, 50)', true]);
  const {circuits} = compileIr(r, {registry});
  assert.deepEqual(circuits[0].program.map(l => `${l.name} = ${l.text}`), ['q_muffins = v1', 'q_unsold = v3', 'q_price = v2', 'q_earn = ((q_muffins - q_unsold) * q_price)', 'answer1 = q_earn']);
  assert.equal(circuits[0].decode(await w.run(circuits[0].sop, circuits[0].literals)), 57);
  assert.equal(circuits[1].decode(await w.run(circuits[1].sop, circuits[1].literals)), true);
  const [map] = perturbations(registry, {k: 1, seed: 'test'});
  const moved = perturbCircuit(circuits[0].sop, map);
  const [m, p, u] = [24, 3, 5].map(x => map.get(x));
  assert.equal(circuits[0].decode(await w.run(moved, [...map.values()].map(String))), (m - u) * p);
  const written = compileIr(ir('Value(earn, 57)', ['Ask(earn)', true]), {registry});
  assert.match(written.rejected[0].why, /computes nothing from the problem's numbers/);
  const bad = compileIr(ir('Value(earn, mul(muffins, 2))', ['Ask(earn)', true]), {registry});
  assert.match(bad.rejected[0].why, /muffins is used but never given a Value/);
});

test('PSM extraction → inventory: registry coverage, goals in the question, names, relation de-duplication, sketch', () => {
  const text = 'Ana has 12 apples and gives 5 to Ben. How many apples does Ana have left?';
  const ext = {entities: {quantity: [{text: '12 apples', start: 8, end: 17}, {text: 'some', start: 0, end: 0}], entity: [{text: 'Ana', start: 0, end: 3}, {text: 'Ben', start: 33, end: 36}], goal: [{text: 'How many apples', start: 38, end: 53}], condition: [{text: 'gives 5 to Ben', start: 22, end: 36}]},
    relations: [{type: 'has_quantity', head: {text: 'Ana'}, tail: {text: '12 apples'}}, {type: 'has_quantity', head: {text: 'Ana'}, tail: {text: '12 apples'}}]};
  const s = structureToIr(ext, text);
  assert.deepEqual(s.numbers.map(n => [n.value, Boolean(n.quantity)]), [[12, true], [5, false]]);
  assert.deepEqual(s.wordQuantities, ['some']);
  assert.equal(s.goals[0].inQuestion, true);
  assert.deepEqual([...s.names.values()], ['Ana', 'Ben']);
  assert.equal(s.relations.length, 1);
  assert.deepEqual(questionRanges('A. B?'), [[3, 5]]);
  const link = linkConstants(ir('Has(ana, apples)'), s.names);
  assert.deepEqual(link, {linked: ['ana'], unlinked: ['apples']});
  const sketch = sketchSentences(ext, text, {relations: {has_quantity: {render: '{head} has {tail}.'}}});
  assert.deepEqual(sketch.map(u => u.text), ['Ana has 12 apples and gives 5 to Ben.', 'How many apples does Ana have left?', 'Ana has 12 apples.']);
  assert.deepEqual(sentencesOf('One. Two? 3 more.').map(u => u.question), [false, true, false]);
  const req = schemaRequest(loadSchema(), text);
  assert.ok(req.entities.goal && req.relations.has_quantity.head.includes('entity'));
});

test('the client of the structure and formalizer tiers tags its calls and reports failures', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({url, headers: init.headers, body: JSON.parse(init.body)}); return new Response(JSON.stringify({object: 'fol', results: []}), {status: 200, headers: {'content-type': 'application/json'}}); };
  const r = await formalizeFol({inputs: ['x']}, {purpose: 'test:fol', run: 'r1', fetchImpl});
  assert.equal(r.ok, true);
  assert.equal(seen[0].body.model, 'formalizer'); assert.match(seen[0].url, /\/v1\/fol$/);
  assert.equal(seen[0].headers['x-llmapiprovider-purpose'], 'test:fol'); assert.equal(seen[0].headers['x-llmapiprovider-run'], 'r1');
  const e = await extractStructure({text: 'x', entities: ['quantity']}, {fetchImpl: async () => new Response('{"error":{"message":"down"}}', {status: 503})});
  assert.equal(e.ok, false); assert.match(e.reason, /503 down/);
});

test.after(async () => { (await engines()).dispose(); });
