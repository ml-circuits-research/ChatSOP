// Measure and chain question forms (rules v2.9, lib/ud-to-sop/measure-forms.mjs) and their runtime: superlatives, ordinals, comparative
// choices, age at death and nested descriptions, on recorded Stanza parses (tests/fixtures/query-forms/measure-parses.json); the
// `rank ... position N | top N` fields of the query wire (parser, oracle); the class compatibility of nested queries; the carried
// computation of a rule in the chat turn. Every program is also checked by the model-surface admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SymbolicLM} from '../lib/symbolic-lm/index.mjs';
import {parse} from '../sop/parser.mjs';
import {checkModelProgram} from '../sop/declarative.mjs';
import {inferVariableTypes} from '../lib/types.mjs';
import {Theory} from '../reasoning/slice/wire.mjs';
import {ruleWire, Lowering} from '../reasoning/bridge/lower.mjs';
import {repoPath} from './helpers.mjs';

const parses = JSON.parse(fs.readFileSync(repoPath('tests/fixtures/query-forms/measure-parses.json'), 'utf8')).parses;
const worker = {start: async () => ({ready: true}), stop: async () => {}, request: async ({text, language}) => {
  const hit = parses[`${language ?? 'auto'}|${text}`];
  if (!hit) throw Error(`no recorded parse for ${text}`);
  return {parse: hit, ms: 0};
}};
const lm = new SymbolicLM({worker, lexicons: {has: () => false, perMillion: () => 0}});
const compact = sop => sop.trim().split('\n').map(line => line.trim()).filter(Boolean).join(' | ');
const run = async message => { const out = await lm.analyze(message, {route: 'direct', language: 'en'}); return out; };
const block = (relation, ...roles) => `match | relation "${relation}" | ${roles.join(' | ')} | polarity affirmed | end`;

const SUPERLATIVE = (adjective, cls, scope, rank) => `@q query | select ?x | rank ${rank.replace(' ', ' ?v ')}${rank.includes(' ') ? '' : ' ?v'} | where all | ${block(adjective, 'role subject ?x', 'role object ?v')} | ${block('be a', 'role subject ?x', `role object "${cls}"`)} | ${block('be in', 'role subject ?x', `role location "${scope}"`)} | end`;

const FORMS = [
  ['What is the largest country in Europe?', SUPERLATIVE('be large', 'country', 'Europe', 'highest')],
  ['What is the most populous city in Canada?', SUPERLATIVE('be populous', 'city', 'Canada', 'highest')],
  ['What is the third largest country in Asia?', SUPERLATIVE('be large', 'country', 'Asia', 'highest position 3')],
  ['What is the least populous city in Canada?', SUPERLATIVE('be populous', 'city', 'Canada', 'lowest')],
  ['Which country has the biggest area in Africa?', SUPERLATIVE('have an area of', 'country', 'Africa', 'highest')],
  ['Which country has the smallest area in Africa?', SUPERLATIVE('have an area of', 'country', 'Africa', 'lowest')],
  ['Which is bigger, Canada or Brazil?', `@q query | select ?x | rank highest ?v | where match | relation "be big" | role subject ?x | role object ?v | polarity affirmed | end | compare any | ?x equal "Canada" | ?x equal "Brazil" | end`],
  ['Who was born first, Einstein or Newton?', `@q query | select ?x | rank lowest ?v | where match | relation "be born" | role subject ?x | role time ?v | polarity affirmed | end | compare any | ?x equal "Einstein" | ?x equal "Newton" | end`],
  ['How old was Marie Curie when she died?', `@q query | select ?age | where match | relation "die at the age of" | role subject "Marie Curie" | role object ?age | polarity affirmed | end`],
  ['At what age did Isaac Newton die?', `@q query | select ?age | where match | relation "die at the age of" | role subject "Isaac Newton" | role object ?age | polarity affirmed | end`],
  ['Where was the director of Inception born?', `@q query | select ?x | where match | relation "be the director of" | role subject ?x | role object "Inception" | polarity affirmed | end | @q2 query | select ?place | where match | relation "be born in" | role subject $q | role location ?place | polarity affirmed | end`],
  ['What is the capital of the country where Einstein was born?', `@q query | select ?place | where all | ${block('be born in', 'role subject "Einstein"', 'role location ?place')} | ${block('be a', 'role subject ?place', 'role object "country"')} | end | @q2 query | select ?x | where match | relation "be the capital of" | role object $q | role subject ?x | polarity affirmed | end`],
];

for (const [message, expected] of FORMS) {
  test(`rules v2.9: ${message}`, async () => {
    const out = await run(message);
    assert.equal(compact(out.sop), expected);
    assert.doesNotThrow(() => checkModelProgram(parse(out.sop)));
  });
}

test('rules v2.9: a question with no variable, or a name that is not a named thing, is not nested or ranked', async () => {
  // all arguments are given: one fact, the noun phrase stays one value (convention C9)
  const fact = await run("Is Lin the author of The Clockmaker's Daughter?");
  assert.doesNotMatch(fact.sop, /\$q/);
  // "the plot of land": the target of "of" is a common noun, so it is one thing
  const plot = await run('What does the plot of land by the river cost these days?');
  assert.doesNotMatch(plot.sop, /\$q/);
});

test('query wire: rank takes position N or top N, nothing else', () => {
  const ok = tail => parse(`@q query\n  select ?x\n  where p ?x ?v\n  rank highest ?v${tail}\n`);
  for (const tail of ['', ' position 2', ' top 3']) assert.equal(ok(tail).errors?.length ?? 0, 0);
  assert.throws(() => checkModelProgram(parse('@q query\n  select ?x\n  rank highest ?v position 0\n  where match\n    relation "be large"\n    role subject ?x\n    role object ?v\n    polarity affirmed\n  end\n')), /rank_form/);
  assert.throws(() => checkModelProgram(parse('@q query\n  select ?x\n  rank highest ?v middle 2\n  where match\n    relation "be large"\n    role subject ?x\n    role object ?v\n    polarity affirmed\n  end\n')), /rank_form/);
});

test('nested queries: a variable shared by the roles of a class and its superclass takes the more specific class', () => {
  const schema = {born_in: {arity: 2, args: ['entity', 'place']}, capital_of: {arity: 2, args: ['city', 'country']}};
  const atoms = [{p: 'born_in', a: ['?p', '?c']}, {p: 'capital_of', a: ['?k', '?c']}];
  assert.throws(() => inferVariableTypes(atoms, schema), /Incompatible types/);
  const related = (a, b) => (a === 'country' && b === 'place' ? 'old' : a === 'place' && b === 'country' ? 'next' : null);
  assert.equal(inferVariableTypes(atoms, schema, related)['?c'], 'country');
});

test('chat turn rules: a rule with a computation carries it as an extra when line the oracle runs', () => {
  const theory = new Theory([{name: 'c', text: '@born_on predicate\n  args subject:entity time:time\n@died_on predicate\n  args subject:entity time:time\n@lived_years predicate\n  args subject:entity object:integer\n@r_lived_years rule\n  when born_on ?p ?b\n  when died_on ?p ?d\n  when compute ?years ?d minus ?b\n  then lived_years ?p ?years\n'}]);
  const [rule] = theory.chatRules();
  assert.deepEqual(rule.extra, ['compute ?years ?d minus ?b']);
  const wire = ruleWire(new Lowering(), rule);
  assert.deepEqual(wire.fields.filter(f => f.key === 'when').map(f => f.value), ['born_on ?p ?b', 'died_on ?p ?d', 'compute ?years ?d minus ?b']);
  // a grouped or otherwise untyped condition is left to the knowledge-wire path
  const grouped = new Theory([{name: 'c', text: '@r rule\n  when all\n    a ?x\n    compare ?x above 3\n  end\n  then b ?x\n'}]);
  assert.deepEqual(grouped.chatRules(), []);
});
