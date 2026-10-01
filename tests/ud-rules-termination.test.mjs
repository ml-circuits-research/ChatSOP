import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {convertParse, RULES_BUDGET} from '../lib/ud-to-sop/index.mjs';
import {repairSentence} from '../lib/ud-to-sop/repair.mjs';
import {cycleWords, indexSentence} from '../lib/ud-to-sop/tree.mjs';

const recorded = JSON.parse(fs.readFileSync(new URL('./fixtures/ud-rules/jonas-brothers-parse.json', import.meta.url), 'utf8'));

// The recorded Stanza parse of the message that hung the SymbolicLM service (symbolic_lm_hang): the entity span
// "Billboard Music Awards" has "Billboard" below "many" below "Awards", so re-attaching "Awards" under "Billboard" closed a head cycle.
test('the Jonas Brothers message converts instead of looping', () => {
  const repaired = repairSentence(recorded.sentences[0]);
  assert.equal(cycleWords(repaired.words).length, 0);
  assert.equal(repaired.repairs.rejected, undefined);
  const result = convertParse(recorded, recorded.text);
  assert.equal(result.outcome, 'converted');
  assert.equal(result.valid, true);
  assert.match(result.sop, /relation "win"/);
});

test('the repairs never leave a head cycle (a repair that would is undone and listed in repairs.rejected)', () => {
  // A parse whose entity span can only be headed by a word below another span word: the repair is rejected, never applied.
  const sentence = structuredClone(recorded.sentences[0]);
  const awards = sentence.words.find(w => w.text === 'Awards');
  awards.deprel = 'dep'; // no argument relation anywhere → still must never cycle
  const repaired = repairSentence(sentence);
  assert.equal(cycleWords(repaired.words).length, 0);
});

test('a cyclic tree from any source is cut by indexSentence', () => {
  const sentence = structuredClone(recorded.sentences[0]);
  sentence.words.find(w => w.text === 'Awards').head = 3; // Awards → Billboard → many → Awards
  assert.ok(cycleWords(sentence.words).length > 0);
  const indexed = indexSentence(sentence, 0);
  assert.ok(indexed.cycleCuts > 0);
  assert.equal(cycleWords(indexed.words).length, 0);
  // and the whole conversion still ends (the cyclic parse used to hang the climb in markPhrases)
  const parse = {...recorded, sentences: [sentence]};
  assert.ok(convertParse(parse, recorded.text).sop.length > 0);
});

test('a pathological input ends with a budget outcome and an unparsed span', () => {
  const saved = RULES_BUDGET.steps;
  RULES_BUDGET.steps = 0;
  try {
    const result = convertParse(recorded, recorded.text);
    assert.equal(result.outcome, 'budget');
    assert.equal(result.valid, true);
    assert.equal(result.wires[0].type, 'unparsed');
    assert.equal(result.wires[0].span, recorded.text);
  } finally { RULES_BUDGET.steps = saved; }
});
