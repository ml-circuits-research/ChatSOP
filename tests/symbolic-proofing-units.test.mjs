/** Sentence units and mechanical filters of the SymbolicProofingLLM iteration-2 pairs (tools/datasets/symbolic-proofing-v2/units.mjs): pure functions, no model, no parser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {alignUnits, mechanicalUnit, fillersOf, lostFillers, pronounCount, addedNames, asksQuestion} from '../tools/datasets/symbolic-proofing-v2/units.mjs';

test('alignUnits: identical sentences are anchors, one prompt sentence with several target sentences is one unit', () => {
  const r = alignUnits('Ana works at Lidl and Ion lives in Cluj and Mara sings. Does Yara need scissors?', 'Ana works at Lidl. Ion lives in Cluj. Mara sings. Does Yara need scissors?');
  assert.equal(r.anchors, 1);
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0].prompt, 'Ana works at Lidl and Ion lives in Cluj and Mara sings.');
  assert.equal(r.units[0].target, 'Ana works at Lidl. Ion lives in Cluj. Mara sings.');
  assert.equal(r.dropped, 0);
});

test('alignUnits: a gap that cannot be aligned is dropped, never guessed', () => {
  const r = alignUnits('One a. Two b. Three c.', 'Only this.');
  assert.deepEqual(r.units, []);
  assert.equal(r.dropped, 3);
  const one = alignUnits('how many people work at Delta Print', 'How many people work at Delta Print?');
  assert.equal(one.units.length, 1);
});

test('fillers: lead-ins, tags and question frames are found and a target that drops one is flagged', () => {
  assert.deepEqual(fillersOf('Quick question: does Lin study at Toma?'), {lead: 'quick question', tag: null, frame: null});
  assert.equal(fillersOf('Rémi was the boss of Vikram, right?').tag, 'right');
  assert.equal(fillersOf('Any chance Ana rents the van?').frame, 'any chance');
  assert.deepEqual(lostFillers('Also, Ana rents the van.', 'Ana rents the van.'), ['lead:also']);
  assert.deepEqual(lostFillers('Also, Ana rents the van.', 'Also, Ana rents the van.'), []);
});

test('mechanicalUnit: no pronoun replaced by a name, no added name, no lost number, no statement turned into a question', () => {
  assert.ok(pronounCount('Can you confirm that he is allergic?') === 1);
  assert.ok(mechanicalUnit('Can you confirm that he is allergic?', 'Is Kostas allergic?').reasons.includes('pronoun_dropped'));
  assert.ok(addedNames('Is it correct that she works here?', 'Is it correct that Mara Popescu works here?').length > 0);
  assert.ok(mechanicalUnit('Ana sent 60 lei to Ion.', 'Ana sent 70 lei to Ion.').reasons.includes('numbers'));
  assert.ok(mechanicalUnit('Victor does not play for the Falcons.', 'Is it the case that Victor does not play for the Falcons?').reasons.includes('statement_to_question'));
  assert.equal(asksQuestion('unless the labels arrive should we leave the trainers off display'), true);
  assert.equal(mechanicalUnit('How many people work at Delta Print', 'How many people work at Delta Print?').ok, true);
  assert.ok(mechanicalUnit('Who does Sânziana send 350 lei to?', 'Sânziana sends 350 lei to whom.').reasons.includes('question_mark'));
  assert.equal(mechanicalUnit('What is the meaning of force majeure?', 'What does force majeure mean?').ok, true);
});
