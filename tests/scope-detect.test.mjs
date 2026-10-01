// Scope detector (lib/symbolic-lm/scope-detect.mjs, prototype of the 2026-10-01 study): which sentences need knowledge wires.
// The fixtures are real SymbolicLM analyses (compact CoNLL-U rows, captured once from Stanza), so the test needs no parser and no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectScope, detectAnalysis, WIRES, WIRE_TARGETS, LABELS, THRESHOLD, SCOPE_DETECT_VERSION} from '../lib/symbolic-lm/scope-detect.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/scope-detect-analyses.json', import.meta.url), 'utf8'));
const verdict = text => { const f = fixtures.find(x => x.text === text); assert.ok(f, `fixture for ${text}`); return detectScope({text: f.text, tokens: f.tokens}, {language: f.lang}); };
const wiresOf = text => verdict(text).wires.map(w => w.wire);

test('questions, ground facts and suppositions stay on the surface', () => {
  for (const t of ['Where does Ann work?', 'Ann works at Alpha Lab.', 'If Ann worked at Alpha Lab, who works at Alpha Lab?', 'Cine lucreaza la Alpha?']) {
    const v = verdict(t);
    assert.equal(v.label, 'surface_ok', t);
    assert.deepEqual(v.wires, [], t);
  }
  assert.ok(verdict('Where does Ann work?').features.question);
  assert.match(verdict('Where does Ann work?').reason, /question/);
});

test('universal statements, defaults and obligations are named with their cues', () => {
  const every = verdict('Every employee who works at Alpha must wear a badge.');
  assert.equal(every.label, 'needs_knowledge_authoring');
  assert.deepEqual(every.wires.map(w => w.wire), ['norm'], 'the obligation subsumes the generic subject');
  assert.ok(every.cues.some(c => c.type === 'universal_determiner' && /Every/.test(c.text)), 'the cue quotes the determiner');
  assert.ok(every.cues.some(c => c.type === 'modal_strong' && c.text === 'must'));
  const birds = wiresOf('Birds usually fly unless they are penguins.');
  assert.ok(birds.includes('default'));
  assert.ok(wiresOf('Employees must submit expense reports within fourteen days.').includes('norm'));
  assert.ok(verdict('Employees must submit expense reports within fourteen days.').cues.some(c => c.type === 'deadline'));
});

test('procedures, formulas, closed lists, validity intervals, sources and definitions each map to their wire', () => {
  assert.deepEqual(wiresOf('First open the valve, then close the lid, and if the pump fails call the supervisor.'), ['method']);
  assert.deepEqual(wiresOf('The total is the sum of the line prices.'), ['aggregate']);
  assert.deepEqual(wiresOf('These are the only members of the board: Ann, Bob and Carla.'), ['closed']);
  assert.deepEqual(wiresOf('Ann worked at Alpha Lab from 2020 until 2023.'), ['temporal']);
  assert.ok(wiresOf('According to section four of the handbook, visitors need a badge.').includes('sourced'));
  assert.deepEqual(wiresOf('A bachelor is an unmarried man.'), ['definition']);
  const states = wiresOf('No two bookings may share the same room at the same time.');
  assert.ok(states.includes('integrity'));
});

test('a hypothetical about a policy is an amendment, even as a question; other questions are muted', () => {
  const v = verdict('What would change if the late fee were ten percent?');
  assert.equal(v.label, 'needs_knowledge_authoring');
  assert.deepEqual(v.wires.map(w => w.wire), ['amendment']);
  assert.ok(v.features.question);
});

test('Romanian cues are matched without diacritics', () => {
  const cond = verdict('Daca un client plateste tarziu, trebuie sa plateasca o penalitate.');
  assert.equal(cond.label, 'needs_knowledge_authoring');
  assert.ok(cond.wires.some(w => w.wire === 'norm'));
  assert.ok(cond.wires.some(w => w.wire === 'rule'), 'a conditional with an indefinite subject is a rule');
  assert.deepEqual(wiresOf('De obicei angajatii primesc un card de acces.'), ['default']);
});

test('a bare dangling reference needs clarification; the verdict carries its evidence', () => {
  const v = verdict('Fix this.');
  assert.equal(v.label, 'needs_clarification');
  assert.equal(v.clarification[0].type, 'vague_reference');
  assert.deepEqual(v.wires, []);
});

test('verdicts are deterministic, evidence is complete and wire types map to knowledge wires', () => {
  for (const f of fixtures) {
    const a = detectScope({text: f.text, tokens: f.tokens}, {language: f.lang}), b = detectScope({text: f.text, tokens: f.tokens}, {language: f.lang});
    assert.deepEqual(a, b);
    assert.ok(LABELS.includes(a.label));
    assert.equal(a.version, SCOPE_DETECT_VERSION);
    for (const w of a.wires) {
      assert.ok(WIRES.includes(w.wire) && w.score >= THRESHOLD && w.score <= 1);
      assert.deepEqual(w.targets, WIRE_TARGETS[w.wire]);
      assert.ok(w.cues.length > 0 && w.cues.every(id => a.cues.some(c => c.id === id)), 'every wire points at cues');
    }
    assert.equal(a.label === 'needs_knowledge_authoring', a.wires.length > 0);
  }
});

test('detectAnalysis folds sentences into a message verdict', () => {
  const sentences = ['Ann works at Alpha Lab.', 'Every employee who works at Alpha must wear a badge.'].map(t => { const f = fixtures.find(x => x.text === t); return {text: f.text, tokens: f.tokens}; });
  const r = detectAnalysis({language: 'en', sentences});
  assert.equal(r.label, 'needs_knowledge_authoring');
  assert.equal(r.sentences[0].label, 'surface_ok');
  assert.equal(r.sentences[1].label, 'needs_knowledge_authoring');
  assert.ok(r.wires.every(w => w.sentence === 1));
  assert.equal(detectAnalysis({language: 'en', sentences: sentences.slice(0, 1)}).label, 'surface_ok');
  assert.equal(detectAnalysis(null).label, 'surface_ok');
});
