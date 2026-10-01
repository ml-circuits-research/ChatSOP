/** The analysis-layer gate of symbolic_english / neuro_english (tools/datasets/three-datasets/analysis-gate.mjs, DS008 "Three datasets"):
 * every sentence needs identical default/accurate trees and DeepSeek conditions a and c good; verdicts are keyed on sentence text plus tree;
 * a missing parse or verdict is pending, never a pass. Synthetic caches and a temporary verdict folder: no Stanza, no model call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {AnalysisGate, loadVerdictIndex, judgeUsers, verdictRecord, judgeSummary, appendItems} from '../tools/datasets/three-datasets/analysis-gate.mjs';
import {sentenceKey} from '../tools/datasets/neuro-oracle/judge.mjs';
import {textKey} from '../tools/datasets/three-datasets/analysis.mjs';
import {hasGoldMatch} from '../tools/datasets/three-datasets/rows.mjs';
import {ParseStore} from '../tools/datasets/neuro-oracle/common.mjs';
import {tempDir} from './helpers.mjs';

const EMPTY = path.join(import.meta.dirname, 'no-such-parse-dir');
/** An AnalysisGate over synthetic caches and verdicts, with no recorded parses (the real stores are large). */
const makeGate = opts => new AnalysisGate({acc: new ParseStore('accurate', EMPTY), def: new ParseStore('default', EMPTY), ...opts});

// tokens: [id, form, lemma, upos, head, deprel]
const ANA = [[1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'], [2, 'works', 'work', 'VERB', 0, 'root'], [3, '.', '.', 'PUNCT', 2, 'punct']];
const ANA_OTHER = [[1, 'Ana', 'Ana', 'PROPN', 2, 'obj'], [2, 'works', 'work', 'VERB', 0, 'root'], [3, '.', '.', 'PUNCT', 2, 'punct']]; // a different relation of word 1
const analysisOf = (...sentences) => ({sentences: sentences.map(tokens => ({text: tokens.map(t => t[1]).join(' '), tokens}))});
const cacheOf = (text, analysis) => new Map([[textKey(text), {k: textKey(text), analysis}]]);
const words = tokens => tokens.map(([id, text, lemma, upos, head, deprel]) => ({id, text, lemma, upos, head, deprel}));
const sentenceOf = tokens => ({text: tokens.map(t => t[1]).join(' '), words: words(tokens)});

/** A verdict folder `<base>/<name>/` with an input and an output file. */
function folder(t, name, entries) {
  const base = tempDir(t, 'analysis-gate-');
  const dir = path.join(base, name);
  fs.mkdirSync(path.join(dir, 'input'), {recursive: true});
  fs.mkdirSync(path.join(dir, 'output'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'input/items.jsonl'), entries.map(e => JSON.stringify({id: e.id, condition: e.condition, user: e.user ?? ''})).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'output/verdicts.jsonl'), entries.map(e => JSON.stringify({id: e.id, condition: e.condition, answer: e.answer ?? {verdict: e.verdict, note: 'x'}})).join('\n') + '\n');
  return {base, name};
}

test('a sentence with identical trees and good a and c verdicts passes; the decision names the verdicts and their folder', t => {
  const key = sentenceKey(sentenceOf(ANA));
  const {base, name} = folder(t, 'neuro_oracle_parse_judge', [{id: key, condition: 'a', verdict: 'CORRECT'}, {id: key, condition: 'c', verdict: 'MINOR'}]);
  const gate = makeGate({cache: cacheOf('Ana works.', analysisOf(ANA)), defaults: cacheOf('Ana works.', analysisOf(ANA)), verdicts: loadVerdictIndex([name], base)});
  const d = gate.decide('Ana works.');
  assert.equal(d.state, 'pass');
  assert.deepEqual(d.sentences.map(s => [s.tree, s.a, s.c, s.from]), [['identical', 'CORRECT', 'MINOR', 'neuro_oracle_parse_judge']]);
  assert.equal(d.worst_tree, 'identical');
  assert.equal(verdictRecord(d).state, 'pass');
  assert.equal(judgeSummary(d).verdict, 'good_enough');
});

test('differing trees fail without a judge call; a bad verdict names the condition; a missing verdict is pending, never a pass', t => {
  const key = sentenceKey(sentenceOf(ANA));
  const {base, name} = folder(t, 'resplit_parse_judge', [{id: key, condition: 'a', verdict: 'DEEP'}, {id: key, condition: 'c', verdict: 'CORRECT'}]);
  const verdicts = loadVerdictIndex([name], base);
  const differing = makeGate({cache: cacheOf('Ana works.', analysisOf(ANA)), defaults: cacheOf('Ana works.', analysisOf(ANA_OTHER)), verdicts});
  const d = differing.decide('Ana works.');
  assert.equal(d.state, 'fail');
  assert.equal(d.failure_kind, 'trees_differ');
  assert.equal(d.worst_tree === 'core_diff' || d.worst_tree === 'noncore_diff', true);
  assert.deepEqual(d.missing.verdicts, [], 'nothing is judged on a disagreement');
  const judged = makeGate({cache: cacheOf('Ana works.', analysisOf(ANA)), defaults: cacheOf('Ana works.', analysisOf(ANA)), verdicts});
  const j = judged.decide('Ana works.');
  assert.equal(j.state, 'fail');
  assert.equal(j.failure_kind, 'judge_a', 'only condition a rejects');
  const none = makeGate({cache: cacheOf('Ana works.', analysisOf(ANA)), defaults: cacheOf('Ana works.', analysisOf(ANA)), verdicts: loadVerdictIndex([], base)});
  const p = none.decide('Ana works.');
  assert.equal(p.state, 'pending');
  assert.deepEqual(p.missing.verdicts.map(m => m.condition), ['a', 'c']);
  const noDefault = makeGate({cache: cacheOf('Ana works.', analysisOf(ANA)), defaults: new Map(), verdicts});
  assert.equal(noDefault.decide('Ana works.').state, 'pending', 'no default-package parse recorded yet');
});

test('every sentence must pass; the first reason by priority is the failure kind; a text without analysis is no_analysis', t => {
  const other = [[1, 'Bo', 'Bo', 'PROPN', 2, 'nsubj'], [2, 'runs', 'run', 'VERB', 0, 'root'], [3, '.', '.', 'PUNCT', 2, 'punct']];
  const k1 = sentenceKey(sentenceOf(ANA)), k2 = sentenceKey(sentenceOf(other));
  const {base, name} = folder(t, 'backgen_parse_judge', [{id: k1, condition: 'a', verdict: 'CORRECT'}, {id: k1, condition: 'c', verdict: 'CORRECT'}, {id: k2, condition: 'a', verdict: 'DEEP'}, {id: k2, condition: 'c', verdict: 'DEEP'}]);
  const two = analysisOf(ANA, other);
  const gate = makeGate({cache: cacheOf('Ana works. Bo runs.', two), defaults: cacheOf('Ana works. Bo runs.', two), verdicts: loadVerdictIndex([name], base)});
  const d = gate.decide('Ana works. Bo runs.');
  assert.equal(d.state, 'fail');
  assert.equal(d.failure_kind, 'judge_ac');
  assert.deepEqual(d.reasons.map(r => r.sentence), [1], 'the first sentence passes, the second fails');
  assert.equal(gate.decide('???', {sentences: []}).state, 'no_analysis');
});

test('a verdict of a folder whose ids are not tree keys is matched on the judged message (the calibration folder)', t => {
  const s = {...sentenceOf(ANA)};
  const users = judgeUsers(s);
  const {base, name} = folder(t, 'parse_judge_deepseek', [{id: 'fv1_000001_0_0#0', condition: 'a', user: users.a, verdict: 'CORRECT'}, {id: 'fv1_000001_0_0#0', condition: 'c', user: users.c, verdict: 'CORRECT'}]);
  const gate = makeGate({cache: cacheOf('Ana works.', analysisOf(ANA)), defaults: cacheOf('Ana works.', analysisOf(ANA)), verdicts: loadVerdictIndex([name], base)});
  assert.equal(gate.decide('Ana works.').state, 'pass');
  assert.equal(gate.decide('Ana works.').sentences[0].from, 'parse_judge_deepseek');
});

test('an unusable verdict (null) counts as missing and judge items are appended once', t => {
  const key = sentenceKey(sentenceOf(ANA));
  const {base, name} = folder(t, 'resplit_parse_judge', [{id: key, condition: 'a', answer: {verdict: null, note: 'UNRESOLVED'}}, {id: key, condition: 'c', verdict: 'CORRECT'}]);
  const verdicts = loadVerdictIndex([name], base);
  assert.equal(verdicts.get(key, 'a'), undefined);
  assert.equal(verdicts.get(key, 'c').verdict, 'CORRECT');
  const dir = path.join(base, 'resplit_out');
  const item = {id: 'k', condition: 'a', user: 'SENTENCE: x'};
  assert.equal(appendItems([item, item, {...item, condition: 'c'}], dir).added, 2, 'duplicates inside one call are appended once');
  assert.equal(appendItems([item], dir).added, 0, 'an item already in the folder is not appended again');
});

test('hasGoldMatch reads sop_layer, with the retired analysis_verified name for production rows only', () => {
  assert.equal(hasGoldMatch({sop_layer: {status: 'match'}}), true);
  assert.equal(hasGoldMatch({sop_layer: {status: 'mismatch'}, analysis_verified: 'gold_sop_match'}), false, 'sop_layer wins over the retired name');
  assert.equal(hasGoldMatch({analysis_verified: 'gold_sop_match'}), true, 'a production row');
  assert.equal(hasGoldMatch({analysis_verified: 'analysis_gate'}), false);
});
