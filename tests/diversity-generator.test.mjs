// The diversity generator (DS022): a small build covers every family, prints model-language targets that the host
// links and executes as written, and the noise model never corrupts the words a label depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generate, DEFAULT_FAMILY_WEIGHTS, sharedWorld} from '../tools/datasets/diversity/generate.mjs';
import {addNoise, NOISE_LEVELS} from '../tools/datasets/diversity/noise.mjs';
import {rng} from '../tools/datasets/diversity/text.mjs';
import {parse} from '../sop/parser.mjs';
import {checkModelProgram} from '../sop/declarative.mjs';
import {rowWorld, blocksOf} from '../lib/row-world.mjs';

const built = generate({seed: 'unit-generator', rows: 420});

test('a small build covers every family, executes as written and links every string', async () => {
  const {rows, problems} = await built;
  assert.ok(problems.length <= 3, JSON.stringify(problems));
  const families = new Set(rows.map(row => row.family));
  for (const family of Object.keys(DEFAULT_FAMILY_WEIGHTS)) assert.ok(families.has(family), family);
  for (const row of rows) {
    checkModelProgram(parse(row.sop_target));
    assert.deepEqual(row.verification?.link_problems ?? [], [], row.id);
    if (row.execution?.executed) assert.equal(row.execution.agrees_with_intended, true, `${row.id}: ${row.execution.status} vs ${row.execution.intended}`);
    assert.ok(row.question_type, row.id);
  }
});

test('question forms print the DS021 query fields', async () => {
  const {rows} = await built;
  const target = type => rows.find(row => row.question_type === type)?.sop_target ?? '';
  assert.match(target('universal'), /mode every[\s\S]*scope (match|all)/);
  assert.match(target('when'), /select \?t[\s\S]*role time \?t/);
  assert.match(target('since_when'), /measure start/);
  assert.match(target('how_long'), /measure duration/);
  assert.match(target('how_many_times'), /mode count[\s\S]*role time \?t/);
  assert.match(target('where'), /role (location|destination) \?place/);
  assert.match(target('how'), /role instrument \?how/);
  assert.match(target('why'), /mode explain/);
  assert.match(target('ambiguous'), /kind ambiguous\n  reading "[^"]+"\n  reading "[^"]+"/);
  assert.ok(rows.some(row => /basis disambiguation/.test(row.sop_target)), 'interpretation assumptions');
});

test('rows reference the shared verification world, which assembles to the full world', async () => {
  const {rows} = await built;
  const shared = sharedWorld();
  assert.deepEqual([...blocksOf(shared.files['rules.sop']).keys()], [...shared.rules.keys()]);
  const row = rows.find(item => item.world?.rules?.length);
  const world = rowWorld(row, {shared});
  assert.match(world.ontology, /predicate/);
  assert.match(world.setup, /@conv_/);
  assert.doesNotMatch(row.ontology_sop, / predicate\n/, 'predicate declarations are not repeated in rows');
});

test('noise follows the typing-error taxonomy and never touches cue words or names', () => {
  assert.deepEqual(Object.keys(NOISE_LEVELS), ['light', 'medium', 'heavy']);
  const random = rng('noise-unit');
  const text = 'Is it true that Ana Popescu isn\'t still working at Nordwind Systems, and does nobody there have all badges?';
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const {text: out, ops} = addNoise(text, {language: 'en', random, surfaces: ['Ana Popescu', 'Nordwind Systems'], level: 'heavy'});
    for (const op of ops) seen.add(op.op);
    for (const word of ['Ana Popescu', 'Nordwind Systems', 'still', 'nobody', 'all']) assert.ok(out.toLowerCase().includes(word.toLowerCase()), `${word} survives: ${out}`);
    assert.match(out, /isn'?t/i, out);
  }
  for (const op of ['typo', 'space_split', 'space_merge', 'phonetic', 'autocorrect']) assert.ok(seen.has(op), op);
  const ro = new Set();
  for (let i = 0; i < 300; i++) for (const op of addNoise('Știi dacă Ana nu mai lucrează în Brașov și când s-a mutat?', {language: 'ro', random, surfaces: ['Ana', 'Brașov'], level: 'heavy'}).ops) ro.add(op.op);
  for (const op of ['diacritic_drop', 'diacritic_cedilla', 'diacritic_wrong']) assert.ok(ro.has(op), op);
});
