/** Composed evaluation (DS008 "Composed evaluation suites"): SOP canonicalization, alignment of a rewriter's output, deterministic
 * composition, the K5 substitution, token annotation, contract check and the scorers with a fake SymbolicLM and rewriters. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalBlocks, compareParagraph, concatCanonical, sopBlocks} from '../tools/eval/composed/sop-canon.mjs';
import {alignRewrite} from '../tools/eval/composed/align.mjs';
import {rngOf, composeK1, composeMixed, composeK5, composeK6, withSubject, soleSubject, caseRow} from '../tools/eval/composed/compose.mjs';
import {wilson, rateBy, stagesOf} from '../tools/eval/composed/stats.mjs';
import {scoreCase, summarize} from '../tools/eval/composed/score-symbolic.mjs';
import {scoreRewrite, summarizeRewrite, GATES, rewriteParagraph, splitterAgrees} from '../tools/eval/composed/score-rewrite.mjs';
import {scoreDecomposition} from '../tools/eval/composed/score-decomposition.mjs';
import {contractOfSentence, classifyRow} from '../tools/datasets/three-datasets/decomposition.mjs';
import {annotate} from '../tools/eval/composed-tokens.mjs';
import {needsContext} from '../tools/eval/composed/components.mjs';
import {commandRewriter, identityRewriter} from '../tools/eval/composed/rewriters.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const query = (rel, s, o) => `@q query\n  where match\n    relation "${rel}"\n    role subject "${s}"\n    role object "${o}"\n    polarity affirmed\n  end\n`;
const stated = (rel, s, o) => `@s1 stated\n  relation "${rel}"\n  role subject "${s}"\n  role object "${o}"\n  polarity affirmed\n  certainty asserted\n`;
const tok = (id, form, lemma, upos, head, deprel) => [id, form, lemma, upos, head, deprel];

test('canonical SOP: ids renumbered by position, references follow, statements come before queries as SymbolicLM emits them', () => {
  const a = query('work at', 'Ana', 'Tisa'), b = `${stated('teach', 'Ion', 'math')}\n@q query\n  where match\n    relation "be"\n  end\n  because $s1\n`;
  const paragraph = `@s1 stated\n  relation "teach"\n  role subject "Ion"\n  role object "math"\n  polarity affirmed\n  certainty asserted\n\n@q query\n  where match\n    relation "work at"\n    role subject "Ana"\n    role object "Tisa"\n    polarity affirmed\n  end\n\n@q2 query\n  where match\n    relation "be"\n  end\n  because $s1\n`;
  const result = compareParagraph(paragraph, [a, b]);
  assert.equal(result.exact, true);
  assert.deepEqual(result.per_component, [true, true]);
  assert.equal(sopBlocks(paragraph).length, 3);
  assert.deepEqual(concatCanonical([a, b]), canonicalBlocks(paragraph));
});

test('a paragraph that changes one component is exact false and credits the others', () => {
  const a = query('work at', 'Ana', 'Tisa'), b = query('lease', 'Ion', 'the vineyard');
  const wrong = `${query('work at', 'Ana', 'Tisa')}\n${query('lease', 'Ion', 'a vineyard')}`;
  const r = compareParagraph(wrong, [a, b]);
  assert.equal(r.exact, false);
  assert.deepEqual(r.per_component, [true, false]);
  const missing = compareParagraph(query('lease', 'Ion', 'the vineyard'), [a, b]);
  assert.deepEqual(missing.per_component, [false, true], 'block counts differ: bodies are compared without ids');
});

test('alignment: preserved, repaired, broken, not repaired, wrong rewrite, dropped, added, order', () => {
  const comps = [{text: 'A b c.', expected_text: 'A b c.', must_change: false}, {text: 'x is bad', expected_text: 'X is good.', must_change: true}, {text: 'Last one?', expected_text: 'Last one?', must_change: false}];
  const run = out => alignRewrite(comps, out);
  assert.equal(run('A b c. X is good. Last one?').exact, true);
  assert.deepEqual(run('A b c. x is bad Last one?').status, ['preserved', 'not_repaired', 'preserved']);
  assert.deepEqual(run('A b c. Last one?').status, ['preserved', 'dropped', 'preserved']);
  assert.deepEqual(run('A b c. Something else. Last one?').status, ['preserved', 'wrong_rewrite', 'preserved']);
  const broken = run('A b d. X is good. Last one? Extra sentence.');
  assert.deepEqual(broken.status, ['broken', 'repaired', 'preserved']);
  assert.equal(broken.added_units, 1);
  assert.equal(run('Last one? A b c. X is good.').order_ok, false);
});

const pool = (n, role = 'symbolic') => Array.from({length: n}, (_, i) => ({role, source_id: `s${i}`, source_dataset: 'symbolic_english', source_split: 'test', text: `Sentence ${i} about topic${i}.`, expected_text: `Sentence ${i} about topic${i}.`, expected_sop: query(`rel${i}`, `Name${i}`, `thing${i}`), expected_sop_source: 'gold', must_change: false, form: `form${i % 12}`, sentences: 1, punctuated: true}));

test('composition is deterministic, uses distinct sources and forms, and stores the components', () => {
  const S = pool(40);
  const one = composeK1(S, {counts: [2, 5], perCount: 5, seed: 'x'}), two = composeK1(S, {counts: [2, 5], perCount: 5, seed: 'x'});
  assert.deepEqual(one.map(r => r.message), two.map(r => r.message));
  assert.equal(one.length, 10);
  for (const c of one) {
    assert.equal(new Set(c.components.map(x => x.source_id)).size, c.n_components);
    assert.equal(new Set(c.components.map(x => x.form)).size, c.n_components);
    assert.equal(c.components.map(x => x.text).join(' '), c.message);
    assert.equal(c.expected_sop_complete, true);
  }
  assert.notDeepEqual(composeK1(S, {counts: [2], perCount: 5, seed: 'y'}).map(r => r.message), one.slice(0, 5).map(r => r.message));
});

test('mixed cases place the changed sentences at the recorded positions and expect the targets', () => {
  const S = pool(60), N = pool(20, 'neuro').map(c => ({...c, source_id: 'n' + c.source_id, text: 'bad ' + c.text, must_change: true, expected_sop: null}));
  const rows = composeMixed({kind: 'K2', dataset: 'neuro_english', symbolic: S, changed: N, specs: [[4, 1], [6, 3]], perSpec: 6, seed: 'm'});
  assert.equal(rows.length, 12);
  for (const r of rows) {
    r.changed_positions.forEach(p => assert.equal(r.components[p].must_change, true));
    assert.equal(r.components.filter(c => c.must_change).length, r.changed_positions.length);
    assert.equal(r.expected_text.split(' ').includes('bad'), false);
    assert.equal(r.n_changes_expected, r.changed_positions.length);
  }
  assert.deepEqual([...new Set(rows.filter(r => r.mix === '1 of 4').map(r => r.position_label))].sort(), ['first', 'last', 'middle']);
});

test('K5: a name is replaced by the matching pronoun in the text and by the antecedent in the expected SOP', () => {
  const anchor = {role: 'symbolic', source_id: 'a', text: 'Does Ioana coach the Falcons?', expected_text: 'Does Ioana coach the Falcons?', expected_sop: query('coach', 'Ioana', 'the Falcons'), form: 'f1', must_change: false,
    analysis: {sentences: [{text: 'Does Ioana coach the Falcons?', tokens: [tok(1, 'Does', 'do', 'AUX', 3, 'aux'), tok(2, 'Ioana', 'Ioana', 'PROPN', 3, 'nsubj'), tok(3, 'coach', 'coach', 'VERB', 0, 'root'), tok(4, 'the', 'the', 'DET', 5, 'det'), tok(5, 'Falcons', 'Falcons', 'PROPN', 3, 'obj'), tok(6, '?', '?', 'PUNCT', 3, 'punct')]}]}};
  assert.deepEqual(soleSubject(anchor), {name: 'Ioana', gender: 'f'});
  const carrier = {role: 'symbolic', source_id: 'b', text: 'Does Radu live in Cluj?', expected_text: 'Does Radu live in Cluj?', expected_sop: query('live in', 'Radu', 'Cluj'), form: 'f2', must_change: false,
    analysis: {sentences: [{text: 'Does Radu live in Cluj?', tokens: [tok(1, 'Does', 'do', 'AUX', 3, 'aux'), tok(2, 'Radu', 'Radu', 'PROPN', 3, 'nsubj'), tok(3, 'live', 'live', 'VERB', 0, 'root'), tok(4, 'in', 'in', 'ADP', 5, 'case'), tok(5, 'Cluj', 'Cluj', 'PROPN', 3, 'obl'), tok(6, '?', '?', 'PUNCT', 3, 'punct')]}]}};
  const named = withSubject(carrier, 'Ioana'), pron = withSubject(carrier, 'Ioana', 'she');
  assert.equal(named.text, 'Does Ioana live in Cluj?');
  assert.equal(pron.text, 'Does she live in Cluj?');
  assert.match(named.sop, /role subject "Ioana"/);
  const rows = composeK5([anchor, carrier], {counts: [2], perCount: 1, seed: 'k5'});
  assert.equal(rows.length, 1);
  const last = rows[0].components[1];
  assert.match(last.text, /\b(he|she)\b/);
  assert.equal(last.antecedent.pronoun, last.antecedent.gender === 'f' ? 'she' : 'he');
  assert.equal(last.expected_text, last.text, 'a rewriter must leave the pronoun');
  assert.match(last.expected_sop, new RegExp(`role subject "${last.antecedent.name}"`), 'the expected SOP has the name');
});

test('needsContext flags pronouns, discourse markers and ellipsis, not self-contained sentences', () => {
  assert.equal(needsContext('So where is Levente based?'), true);
  assert.equal(needsContext('Does he live in Cluj?'), true);
  assert.equal(needsContext('And in Timisoara?'), true);
  assert.equal(needsContext('Does Levente live in Cluj?'), false);
  assert.equal(needsContext('Is it true that Ananya sings in the choir?'), false);
});

test('stats: Wilson interval, rates by stratum, nested stratified stages', () => {
  const w = wilson(50, 100);
  assert.ok(w.lo < 50 && w.hi > 50 && w.p === 50);
  assert.equal(wilson(0, 0).p, null);
  const items = Array.from({length: 60}, (_, i) => ({i, s: i % 3}));
  const stages = stagesOf(items, x => x.s, [9, 30], 'seed');
  assert.deepEqual(stages.map(s => s.size), [9, 30, 60]);
  assert.equal(new Set(stages[0].items.map(x => x.s)).size, 3, 'every stratum in the first stage');
  assert.ok(stages[0].items.every(x => stages[1].items.includes(x)), 'nested');
  assert.deepEqual(Object.keys(rateBy(items, x => x.s, x => x.i % 2 === 0).by), ['0', '1', '2']);
  assert.deepEqual(rngOf('a').shuffle([1, 2, 3, 4, 5]), rngOf('a').shuffle([1, 2, 3, 4, 5]));
});

// A fake SymbolicLM: analyses "<Name> works at <Place>." sentences; several sentences are the concatenation (statements first, like the real one).
const fakeLm = (log = []) => ({run: async text => {
  log.push(text);
  const parts = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const good = parts.every(p => /^[A-Z]\w+ works at [A-Z]\w+[.?]$/.test(p));
  const sop = good ? parts.map(p => { const m = /^(\w+) works at (\w+)/.exec(p); return p.endsWith('?') ? query('work at', m[1], m[2]) : stated('work at', m[1], m[2]); }).join('\n') : '';
  return {text, sop, valid: good, outcome: good ? 'converted' : 'unparsed', uncertain: !good, reasons: [], unparsed: good ? [] : [text], sentences: parts.map(p => ({text: p, start: 0, end: p.length, tokens: [tok(1, p.split(' ')[0], p.split(' ')[0], 'PROPN', 0, 'root')]}))};
}});
const sym = (i, q = false) => ({role: 'symbolic', source_id: `s${i}`, text: `Name${i} works at Place${i}${q ? '?' : '.'}`.replace(/\d/g, d => 'abcdefghij'[d]), expected_text: '', expected_sop: '', must_change: false, form: `f${i}`});
const fixCase = () => {
  const comps = [0, 1, 2].map(i => { const c = sym(i, i === 1); c.expected_text = c.text; c.expected_sop = c.text.endsWith('?') ? query('work at', c.text.split(' ')[0], c.text.split(' ')[3].replace('?', '')) : stated('work at', c.text.split(' ')[0], c.text.split(' ')[3].replace('.', '')); return c; });
  return caseRow({kind: 'K1', dataset: 'symbolic_english', id: 'k1-fix', components: comps, seed: 't', extra: {stratum: 'n3'}});
};

test('scoreCase: SymbolicLM alone on a paragraph is compared with the stored SOPs and with the components alone', async () => {
  const row = fixCase();
  const r = await scoreCase(row, fakeLm());
  assert.equal(r.sop_exact, true);
  assert.equal(r.components_ok, 3);
  assert.equal(r.analysis_equal, true);
  const s = summarize([r]);
  assert.equal(s.sop_exact.all.k, 1);
  assert.equal(s.composition_effect.cases_with_all_components_ok_alone, 1);
});

test('rewriters in paragraph and sentence mode: the gate keeps fine sentences out of the rewriter, so they cannot change', async () => {
  const comps = [sym(0), {...sym(1), text: 'name b work at placeb.', expected_text: 'Nameb works at Placeb.', expected_sop: stated('work at', 'Nameb', 'Placeb'), must_change: true}, sym(2, true)];
  comps[0].expected_text = comps[0].text; comps[2].expected_text = comps[2].text;
  comps[0].expected_sop = stated('work at', 'Namea', 'Placea'); comps[2].expected_sop = query('work at', 'Namec', 'Placec');
  const row = caseRow({kind: 'K2', dataset: 'neuro_english', id: 'k2-fix', components: comps, seed: 't', extra: {stratum: 'n3m1'}});
  const lm = fakeLm(), calls = [];
  const good = async text => { calls.push(text); return text.replace('name b work at placeb.', 'Nameb works at Placeb.'); };
  const bad = async text => text.toUpperCase();
  const ok = await scoreRewrite(row, {mode: 'sentence', rewriter: good, gate: GATES.symbolic(lm), splitter: 'host', lm});
  assert.deepEqual(calls, ['name b work at placeb.'], 'only the sentence SymbolicLM does not handle is sent');
  assert.equal(ok.broken, 0);
  assert.equal(ok.repaired + ok.not_repaired + ok.wrong_rewrite + ok.dropped, 1);
  const whole = await scoreRewrite(row, {mode: 'paragraph', rewriter: bad, gate: null, splitter: 'host', lm});
  assert.ok(whole.broken >= 1, 'a rewriter that changes everything breaks the clean sentences');
  const s = summarizeRewrite([whole, ok]);
  assert.equal(s.cases, 2);
  assert.ok(s.clean_sentences_changed.n === 4);
  const out = await rewriteParagraph(row.message, {mode: 'sentence', rewriter: async t => t, gate: async () => false, lm});
  assert.equal(out.output, row.message);
  assert.equal((await splitterAgrees(row, 'host', lm)).ok, true);
});

test('the command rewriter pipes text through a shell command; the identity returns it unchanged', async () => {
  assert.equal(await commandRewriter('tr a-z A-Z')('abc'), 'ABC');
  assert.equal(await identityRewriter('same'), 'same');
});

test('contract check: coordinated clauses, relative clauses and elided subjects are violations; connective-linked clauses and frames are allowed', () => {
  const simple = {tokens: [tok(1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'), tok(2, 'works', 'work', 'VERB', 0, 'root'), tok(3, '.', '.', 'PUNCT', 2, 'punct')]};
  assert.equal(contractOfSentence(simple).ok, true);
  const because = {tokens: [tok(1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'), tok(2, 'left', 'leave', 'VERB', 0, 'root'), tok(3, 'because', 'because', 'SCONJ', 5, 'mark'), tok(4, 'Ion', 'Ion', 'PROPN', 5, 'nsubj'), tok(5, 'arrived', 'arrive', 'VERB', 2, 'advcl')]};
  assert.equal(contractOfSentence(because).ok, true);
  const coordinated = {tokens: [tok(1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'), tok(2, 'left', 'leave', 'VERB', 0, 'root'), tok(3, 'and', 'and', 'CCONJ', 5, 'cc'), tok(4, 'Ion', 'Ion', 'PROPN', 5, 'nsubj'), tok(5, 'stayed', 'stay', 'VERB', 2, 'conj')]};
  assert.equal(contractOfSentence(coordinated).ok, false);
  const elided = {tokens: [tok(1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'), tok(2, 'left', 'leave', 'VERB', 0, 'root'), tok(3, 'and', 'and', 'CCONJ', 4, 'cc'), tok(4, 'stayed', 'stay', 'VERB', 2, 'conj')]};
  assert.equal(contractOfSentence(elided).ok, false);
  assert.equal(contractOfSentence(elided).elided_subject, 1);
});

test('decomposition case: a multi-clause message whose target has more sentences', () => {
  const two = {analysis: {sentences: [{text: 'x', tokens: [tok(1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'), tok(2, 'left', 'leave', 'VERB', 0, 'root'), tok(3, 'and', 'and', 'CCONJ', 5, 'cc'), tok(4, 'Ion', 'Ion', 'PROPN', 5, 'nsubj'), tok(5, 'stayed', 'stay', 'VERB', 2, 'conj')]}]}, message: 'Ana left and Ion stayed', target: 'Ana left. Ion stayed.'};
  const k = classifyRow(two);
  assert.equal(k.decomposition, true);
  assert.equal(k.type, 'coordination');
  assert.equal(classifyRow({...two, target: 'Ana left and Ion stayed.'}).decomposition, false);
  assert.equal(classifyRow({message: 'Who runs the lab and when does it open?', target: 'Who runs the lab? When does the lab open?'}).type, 'multiple_questions');
});

test('K6 scoring: sentence count, contract, content preserved, with a fake SymbolicLM', async () => {
  const single = text => ({text, sop: '@q query\n', valid: true, outcome: 'converted', uncertain: false, reasons: [], unparsed: [], sentences: [{text, start: 0, end: text.length, tokens: [tok(1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'), tok(2, 'works', 'work', 'VERB', 0, 'root')]}]});
  const lm = {run: async text => single(text)};
  const component = {role: 'neuro', source_id: 'n1', text: 'Ana works at Tisa and Ion is not in Cluj', expected_text: 'Ana works at Tisa. Ion is not in Cluj.', expected_sop: null, must_change: true};
  const row = caseRow({kind: 'K6', dataset: 'neuro_english', id: 'k6-fix', components: [component], seed: 't', extra: {stratum: 'coordination', decomposition: {}}});
  const r = await scoreDecomposition(row, {rewriter: async () => 'Ana works at Tisa. Ion is not in Cluj.', lm});
  assert.equal(r.count_match, true);
  assert.equal(r.exact_target, true);
  assert.equal(r.preserved.negations.present, r.preserved.negations.total);
  const none = await scoreDecomposition(row, {rewriter: identityRewriter, lm});
  assert.equal(none.changed, false);
  assert.equal(none.count_match, false);
});

test('token annotation writes a sidecar with the training-style length and the flags beyond the training maximum', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composed-tokens-'));
  fs.mkdirSync(path.join(dir, 'symbolic_english'));
  fs.writeFileSync(path.join(dir, 'symbolic_english', 'test-composed.jsonl'), JSON.stringify({id: 'c1', message: 'one two three', expected_text: 'one two three'}) + '\n' + JSON.stringify({id: 'c2', message: 'a '.repeat(50), expected_text: 'a '.repeat(50)}) + '\n');
  const count = async (text) => text.split(/\s+/).filter(Boolean).length;
  await annotate(dir, count, {total: {p99: 10, max: 20}, prompt: {max: 8}});
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, 'symbolic_english', 'test-composed.tokens.json'), 'utf8'));
  assert.equal(sidecar.cases.c1.beyond_train_max_total, false);
  assert.equal(sidecar.cases.c2.beyond_train_max_total, true);
  assert.equal(sidecar.summary.beyond_train_max_total, 1);
});

test('length statistics: words, sentences and their buckets per message', async () => {
  const {lengthStats, render} = await import('../tools/datasets/audit/length-analysis.mjs');
  const stats = lengthStats(['One two three.', 'One. Two. Three. Four. Five. Six.', 'word '.repeat(40).trim()]);
  assert.equal(stats.rows, 3);
  assert.equal(stats.words.max, 40);
  assert.equal(stats.sentences.by_count['1'], 2);
  assert.equal(stats.sentences.by_count['6-8'], 1);
  assert.equal(stats.share_over_30_words_pct, 33.3);
  assert.match(render({generated_at: 'now', method: 'm', table: [{label: 'x/train', group: 'datasets', path: 'p', ...stats}]}), /x\/train \| 3 \|/);
});

test('decomposition coverage counts candidates, decomposition cases and unpunctuated run-ons per dataset and split', async () => {
  const {coverage} = await import('../tools/datasets/audit/decomposition-coverage.mjs');
  const row = (message, target) => ({id: message.slice(0, 6), message, target, targets: target ? [{text: target, check: {}}] : [], source: {family: 'f'}});
  const report = coverage({neuro_english: {train: [row('Who runs the lab and when does it open?', 'Who runs the lab? When does the lab open?'), row('Who runs the lab?', null), row('did the edit render and where did Luka save it', 'Did the edit render? Where did Luka save it?')]}});
  const c = report.neuro_english.train;
  assert.equal(c.rows, 3);
  assert.equal(c.decomposition_cases, 2);
  assert.ok(c.by_type_decomposition.multiple_questions >= 1);
  assert.equal(c.candidates_with_target, 2);
});

test('the composed suites build deterministically from the sealed test files and only from them (skipped without built suites)', async t => {
  const {build} = await import('../tools/eval/composed-suites.mjs');
  const {repoPath} = await import('./helpers.mjs');
  if (!['symbolic_english', 'neuro_english', 'bad_english'].every(d => fs.existsSync(repoPath(`eval/suites/${d}/test.jsonl`)))) return t.skip('sealed test files are not built');
  const a = build(), b = build();
  for (const d of Object.keys(a)) {
    assert.equal(a[d].manifest.sha256, b[d].manifest.sha256, d);
    assert.ok(a[d].rows.length > 0, d);
    for (const row of a[d].rows) {
      assert.equal(row.split, 'test-composed');
      for (const c of row.components) assert.equal(c.source_split, 'test', `${row.id}: components come from sealed test rows only`);
      assert.equal(row.components.map(c => c.text).join(row.joiner), row.message);
    }
  }
  assert.ok(a.symbolic_english.rows.some(r => r.kind === 'K1') && a.symbolic_english.rows.some(r => r.kind === 'K5') && a.neuro_english.rows.some(r => r.kind === 'K6'));
});
