import test from 'node:test';
import assert from 'node:assert/strict';
import {extractStructures, realize, interpret, roundTrip, joinTokens} from '../lib/languages-util/analysis-cnl.mjs';

/** A compact analysis from rows "id form lemma upos head deprel" separated by `;` (one sentence). */
const analysis = (...sentences) => ({
  columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en',
  sentences: sentences.map(rows => {
    const tokens = rows.split(';').map(r => { const [id, form, lemma, upos, head, deprel] = r.trim().split(/\s+/); return [Number(id), form, lemma, upos, Number(head), deprel]; });
    return {text: tokens.map(t => t[1]).join(' '), start: 0, end: 0, tokens};
  }),
});
const cnl = (...s) => interpret(analysis(...s)).cnl;

test('statement: names are copied, the verb is inflected from the lemma', () => {
  assert.equal(cnl('1 Ana Ana PROPN 2 nsubj;2 works work VERB 0 root;3 at at ADP 4 case;4 Lidl Lidl PROPN 2 obl;5 . . PUNCT 2 punct'), 'Ana works at Lidl.');
});

test('yes/no question and polarity: do-support, "not", contraction expanded', () => {
  assert.equal(cnl('1 Does do AUX 3 aux;2 Ana Ana PROPN 3 nsubj;3 work work VERB 0 root;4 at at ADP 5 case;5 Lidl Lidl PROPN 3 obl;6 ? ? PUNCT 3 punct'), 'Does Ana work at Lidl?');
  assert.equal(cnl("1 Ana Ana PROPN 4 nsubj;2 does do AUX 4 aux;3 n't not PART 4 advmod;4 work work VERB 0 root;5 at at ADP 6 case;6 Lidl Lidl PROPN 4 obl;7 . . PUNCT 4 punct"), 'Ana does not work at Lidl.');
});

test('wh question with the questioned subject', () => {
  assert.equal(cnl('1 Who who PRON 2 nsubj;2 works work VERB 0 root;3 at at ADP 4 case;4 Lidl Lidl PROPN 2 obl;5 ? ? PUNCT 2 punct'), 'Who works at Lidl?');
});

test('voice is normalized to active when the agent is present, kept when it is not', () => {
  assert.equal(cnl('1 The the DET 2 det;2 van van NOUN 4 nsubj:pass;3 is be AUX 4 aux:pass;4 repaired repair VERB 0 root;5 by by ADP 6 case;6 Nils Nils PROPN 4 obl:agent;7 . . PUNCT 4 punct'), 'Nils repairs the van.');
  assert.equal(cnl('1 Ana Ana PROPN 3 nsubj:pass;2 was be AUX 3 aux:pass;3 hired hire VERB 0 root;4 . . PUNCT 3 punct'), 'Ana was hired.');
});

test('if-clauses use the "If A, then B" template', () => {
  assert.equal(cnl('1 If if SCONJ 3 mark;2 Ana Ana PROPN 3 nsubj;3 works work VERB 8 advcl;4 at at ADP 5 case;5 Lidl Lidl PROPN 3 obl;6 , , PUNCT 8 punct;7 Bob Bob PROPN 8 nsubj;8 sings sing VERB 0 root;9 . . PUNCT 8 punct'), 'If Ana works at Lidl, then Bob sings.');
});

test('a request wrapper is removed and the wrapped clause becomes a question', () => {
  const x = interpret(analysis('1 Is be AUX 3 cop;2 it it PRON 3 expl;3 true true ADJ 0 root;4 that that SCONJ 6 mark;5 Ana Ana PROPN 6 nsubj;6 works work VERB 3 csubj;7 at at ADP 8 case;8 Lidl Lidl PROPN 6 obl;9 ? ? PUNCT 3 punct'));
  assert.equal(x.cnl, 'Does Ana work at Lidl?');
  assert.ok(x.notes.some(n => n.type === 'wrapper'));
  assert.deepEqual(x.notRepresented, []);
});

test('unattached words are listed as not represented, never dropped silently', () => {
  const x = interpret(analysis('1 Ana Ana PROPN 2 nsubj;2 works work VERB 0 root;3 banana banana NOUN 2 dep;4 . . PUNCT 2 punct'));
  assert.equal(x.cnl, 'Ana works.');
  assert.deepEqual(x.notRepresented, ['banana']);
  assert.match(x.text, /not represented: "banana"/);
});

test('coordinated subjects are split only when that is equivalent', () => {
  const like = analysis('1 Ana Ana PROPN 4 nsubj;2 and and CCONJ 3 cc;3 Bob Bob PROPN 1 conj;4 like like VERB 0 root;5 tea tea NOUN 4 obj;6 . . PUNCT 4 punct');
  assert.equal(interpret(like).cnl, 'Ana likes tea. Bob likes tea.');
  const meet = analysis('1 Ana Ana PROPN 4 nsubj;2 and and CCONJ 3 cc;3 Bob Bob PROPN 1 conj;4 meet meet VERB 0 root;5 . . PUNCT 4 punct');
  assert.equal(interpret(meet).cnl, 'Ana and Bob meet.');
});

test('an existential question keeps its question form', () => {
  assert.equal(cnl('1 Is be AUX 4 cop;2 there there PRON 4 expl;3 a a DET 4 det;4 cat cat NOUN 0 root;5 ? ? PUNCT 4 punct'), 'Is there a cat?');
  assert.equal(cnl('1 There there PRON 4 expl;2 is be AUX 4 cop;3 a a DET 4 det;4 cat cat NOUN 0 root;5 . . PUNCT 4 punct'), 'There is a cat.');
});

test('joinTokens rebuilds spacing around punctuation', () => {
  assert.equal(joinTokens([{form: 'Ana', upos: 'PROPN'}, {form: ',', upos: 'PUNCT'}, {form: 'Bob', upos: 'PROPN'}]), 'Ana, Bob');
});

test('the round trip compares structures, modulo voice and contraction', () => {
  const active = extractStructures(analysis('1 Nils Nils PROPN 2 nsubj;2 repairs repair VERB 0 root;3 the the DET 4 det;4 van van NOUN 2 obj;5 . . PUNCT 2 punct'));
  const passive = extractStructures(analysis('1 The the DET 2 det;2 van van NOUN 4 nsubj:pass;3 is be AUX 4 aux:pass;4 repaired repair VERB 0 root;5 by by ADP 6 case;6 Nils Nils PROPN 4 obl:agent;7 . . PUNCT 4 punct'));
  assert.equal(roundTrip(passive, active).pass, true);
  const negated = extractStructures(analysis("1 Nils Nils PROPN 4 nsubj;2 does do AUX 4 aux;3 n't not PART 4 advmod;4 repair repair VERB 0 root;5 the the DET 6 det;6 van van NOUN 4 obj;7 . . PUNCT 4 punct"));
  const rt = roundTrip(active, negated);
  assert.equal(rt.pass, false);
  assert.ok(rt.onlySource.length === 1 && rt.onlyCnl.length === 1);
  assert.equal(realize(negated).cnl, 'Nils does not repair the van.');
});
