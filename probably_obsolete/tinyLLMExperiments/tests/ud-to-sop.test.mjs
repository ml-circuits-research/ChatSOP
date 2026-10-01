/** The UD → SOP converter of the symbolic baseline (lib/ud-to-sop/, baseline-ud-rules-v1): recorded Stanza parses
 * (tests/fixtures/ud-to-sop/parses.json) go through the rules without Python, and every output must be admitted by
 * the repository parser and model surface, copy values verbatim from the message and never invent one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {convertParse, maskMessage, admissionError} from '../lib/ud-to-sop/index.mjs';
import {readLabels} from '../lib/ud-to-sop/labels.mjs';
import {protect, restore} from '../lib/ud-to-sop/protect.mjs';
import {parse, one} from '../sop/parser.mjs';
import {propositionOf} from '../sop/propositions.mjs';
import {mentionedIn} from '../sop/linking.mjs';

const fixtures = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/ud-to-sop/parses.json', import.meta.url)), 'utf8')).parses;
const convert = key => convertParse(fixtures[key].parse, fixtures[key].message);
const wires = sop => parse(sop).wires;

test('every fixture converts to an admitted model program, deterministically', () => {
  for (const [key, {parse: p, message}] of Object.entries(fixtures)) {
    const first = convertParse(p, message), second = convertParse(p, message);
    assert.equal(first.sop, second.sop, key);
    assert.equal(admissionError(first.sop, message), null, key);
  }
});

test('statement values are verbatim spans of the message (no invented value)', () => {
  for (const [key, {message}] of Object.entries(fixtures)) {
    for (const w of wires(convert(key).sop)) if (w.type === 'stated') {
      for (const r of propositionOf(w).roles) if (typeof r.value === 'string' && !r.value.startsWith('$')) assert.ok(r.value === 'the user' || mentionedIn(r.value, message), `${key}: ${r.value}`);
    }
  }
});

test('reported speech, a because-clause and a question become linked short wires', () => {
  const program = wires(convert('because').sop);
  const [s1, s2, q] = program;
  assert.deepEqual(program.map(w => w.type), ['stated', 'stated', 'query']);
  assert.equal(one(s1, 'speaker'), '"Ion"');
  assert.equal(one(s1, 'because'), '$' + s2.id);
  assert.equal(one(s2, 'polarity'), 'negated');
  assert.equal(one(q, 'select'), '?x');
});

test('Romanian keeps normalized lemmas and a shared variable across conjoined predicates', () => {
  const sop = convert('ro_relative').sop;
  assert.match(sop, /relation "locui in"/);
  assert.match(sop, /relation "lucra la"/);
  assert.equal((sop.match(/role subject \?x/g) ?? []).length, 2);
  assert.match(sop, /role location "Cluj"/);
});

test('an alternative question is one yes/no query per option (C7)', () => {
  const program = wires(convert('alternative').sop);
  assert.deepEqual(program.map(w => w.type), ['query', 'query']);
  assert.match(convert('alternative').sop, /"Bălți"[\s\S]*"Timișoara"/);
});

test('unintelligible and greeting-only messages are unclear', () => {
  assert.match(convert('gibberish').sop, /kind gibberish/);
  assert.match(convert('small_talk').sop, /kind no_request/);
});

test('what the rules cannot place is an unparsed span near its wire, never a guess', () => {
  const program = wires(convert('unparsed').sop);
  const u = program.find(w => w.type === 'unparsed');
  assert.equal(JSON.parse(one(u, 'span')), 'quickly');
  assert.equal(one(u, 'near'), '$s1');
  assert.match(convert('nominal').sop, /"the oldest person working at Greenline Transport"/);
});

test('labelled simple-text lines map to every, compare and constraint forms (DS022)', () => {
  const every = convert('universal_labels').sop;
  assert.match(every, /mode every/);
  assert.match(every, /scope match/);
  const compare = convert('compare_labels').sop;
  assert.match(compare, /compare \?age above 45/);
  assert.match(compare, /relation "be old"/);
  assert.equal(convert('constraint_labels').sop.trim(), '@c constraint\n  var ?x int 0 28\n  require ?x at_least 11\n  claim ?x above 10\n  task prove');
  assert.deepEqual(readLabels('Maybe: Ana works here.\nIon says: Ana left.').map(l => [l.kind, l.args[0] ?? null]), [['maybe', 'Maybe'], ['says', 'Ion']]);
});

test('masking keeps every offset (same length) and blanks lead-ins and labels', () => {
  for (const text of ['Fact-check: Ana works at Acme.', 'Hello, does Ion live in Cluj, right?', 'Group: Who works at X?\nCheck all: each one is certified.']) {
    const masked = maskMessage(text);
    assert.equal(masked.length, text.length);
  }
  assert.equal(maskMessage('Fact-check: Ana works at Acme.').trim(), 'Ana works at Acme.');
});

test('names, quotes and numbers survive a rewriter through placeholders', () => {
  const text = 'Does Mr. Pop from Walker & Partners owe "the fee" of 1.140 euro to Ana?';
  const p = protect(text);
  assert.doesNotMatch(p.text, /Pop|Walker|Ana|1\.140|the fee/);
  assert.equal(restore(p.text, p.slots).text, text);
  const split = restore(p.text.replace('Ent1', 'Ent 1'), p.slots);
  assert.equal(split.text, text);
  const dropped = restore(p.text.replace(/Ent2/, 'them'), p.slots);
  assert.equal(dropped.preserved, false);
  assert.deepEqual(dropped.dropped, ['Ent2']);
});
