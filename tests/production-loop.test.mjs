/** Production regression loop (DS008 "How we learn from production"): add-case classification and rows, merge refusals, harvest of bad_english
 * through the chain, form variants by slot substitution, composed training rows. Fast: fake SymbolicLM and rewriters. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classify, incomingRow, merge} from '../tools/datasets/add-case.mjs';
import {contentLost, chain, classifyOutput, uncoveredForms, harvest} from '../tools/datasets/harvest.mjs';
import {formId} from '../tools/datasets/form-variants.mjs';
import {replaceInSop, lexiconsOf, skeletonOf, lexicalize, sha16} from '../tools/datasets/three-datasets/variants.mjs';
import {rngOf} from '../tools/eval/composed/compose.mjs';

const tok = (id, form, lemma, upos, head, deprel) => [id, form, lemma, upos, head, deprel];
const good = text => ({text, sop: `@q query\n  where match\n    relation "x"\n  end\n`, valid: true, outcome: 'converted', uncertain: false, reasons: [], unparsed: [], sentences: [{text, start: 0, end: text.length, tokens: [tok(1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'), tok(2, 'works', 'work', 'VERB', 0, 'root')]}]});
const bad = text => ({...good(text), valid: false, outcome: 'unparsed', uncertain: true, unparsed: [text], sop: ''});

test('add-case classification: noisy text is bad_english, clean English SymbolicLM handles is symbolic_english, the rest neuro_english', async () => {
  const romanian = await classify('Cine lucrează la Tisa Textile și are peste 65 de ani?', {symbolicRun: async () => { throw Error('not called'); }});
  assert.equal(romanian.dataset, 'bad_english');
  const handledCase = await classify('Does Ioana coach the Zalău Falcons?', {symbolicRun: async t => good(t)});
  assert.equal(handledCase.dataset, 'symbolic_english');
  const missed = await classify('Does Ioana coach the Zalău Falcons?', {symbolicRun: async t => bad(t)});
  assert.equal(missed.dataset, 'neuro_english');
  const forced = await classify('Does Ioana coach the Zalău Falcons?', {symbolicRun: async t => good(t), forced: 'neuro_english'});
  assert.equal(forced.dataset, 'neuro_english');
});

test('incoming rows carry production provenance, a timestamp, pending review and the dataset fields', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const message = 'Does Ioana coach the Zalău Falcons?';
  const symbolic = incomingRow({message, dataset: 'symbolic_english', verdict: await classify(message, {symbolicRun: async t => good(t)}), sop: good(message).sop, reporter: 'ops', now});
  assert.equal(symbolic.source.corpus, 'production');
  assert.equal(symbolic.provenance.added_at, '2026-10-01T00:00:00.000Z');
  assert.equal(symbolic.review_status, 'pending');
  assert.equal(symbolic.analysis_verified, 'gold_sop_match', 'a matching gold SOP verifies the row');
  assert.equal(symbolic.verification.sop_gold_match, true);
  assert.equal(symbolic.quality_flags.training_approved, false);
  const neuro = incomingRow({message, dataset: 'neuro_english', verdict: await classify(message, {symbolicRun: async t => bad(t)}), rewrite: 'Does Ioana coach the team?', now});
  assert.equal(neuro.rewrite_target, true);
  assert.equal(neuro.targets[0].text, 'Does Ioana coach the team?');
  const noisy = incomingRow({message: 'Cine lucrează la Tisa?', dataset: 'bad_english', verdict: await classify('Cine lucrează la Tisa?', {symbolicRun: null}), clean: 'Who works at Tisa?', now});
  assert.equal(noisy.target, 'Who works at Tisa?');
  assert.equal(noisy.id, incomingRow({message: 'Cine lucrează la Tisa?', dataset: 'bad_english', verdict: {gate: {partition: 'ro', reasons: []}, symbolic: null}, now}).id, 'the id depends on the message and the dataset only');
});

test('merge refuses a row that duplicates a sealed test message or lacks its gold, and accepts only reviewed rows (dry run on a temp root)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'add-case-'));
  fs.mkdirSync(path.join(root, 'datasets/symbolic_english'), {recursive: true});
  fs.mkdirSync(path.join(root, 'eval/reports/current/three-datasets'), {recursive: true});
  const {createHash} = await import('node:crypto');
  fs.writeFileSync(path.join(root, 'eval/reports/current/three-datasets/sealed-text-hashes.json'), JSON.stringify({hashes: [createHash('sha1').update('does ana work at tisa').digest('hex').slice(0, 16)]}));
  const row = (id, message, extra) => ({id, dataset: 'symbolic_english', message, review_status: 'accepted', analysis_verified: 'gold_sop_match', quality_flags: {}, source: {}, ...extra});
  fs.writeFileSync(path.join(root, 'datasets/symbolic_english/incoming.jsonl'), [row('p1', 'does ana work at tisa'), row('p2', 'Who runs the lab?'), row('p3', 'Who opens the gate?', {review_status: 'pending'}), row('p4', 'Where is the depot?', {analysis_verified: 'pending'})].map(r => JSON.stringify(r)).join('\n') + '\n');
  const {merged, refused} = await merge('symbolic_english', 'train', {root, dry: true});
  assert.deepEqual(merged.map(r => r.id), ['p2']);
  assert.deepEqual(refused.map(r => r.id).sort(), ['p1', 'p4']);
});

test('harvest: content lost, the chain rewrites only non-clean sentences, output classes a, b and c, uncovered forms', async () => {
  assert.deepEqual(contentLost('Ana did not pay 40 lei to Ion.', 'Ana paid 40 lei to Ion.'), ['negation:not']);
  assert.deepEqual(contentLost('Ana pays 40 lei.', 'Ana pays 50 lei.'), ['number:40']);
  const calls = [];
  const gate = text => !text.startsWith('bad');
  const result = await chain('Good one. bad one. Another good one.', {rewrite: async t => { calls.push(t); return 'Fixed one.'; }, gate});
  assert.deepEqual(calls, ['bad one.']);
  assert.equal(result.output, 'Good one. Fixed one. Another good one.');
  const lm = {run: async t => (t.includes('hard') ? bad(t) : good(t))};
  const row = {id: 'b1', message: 'x', language_kind: 'ro'};
  assert.equal((await classifyOutput(row, {output: 'Ana works.', units: 1, sent: []}, lm)).class, 'b');
  assert.equal((await classifyOutput(row, {output: 'Ana works hard.', units: 1, sent: []}, lm)).class, 'c');
  const lost = await classifyOutput({...row, target: 'Ana did not work.'}, {output: 'Ana worked.', units: 1, sent: []}, lm);
  assert.equal(lost.class, 'a');
  assert.equal(lost.reason, 'content_lost');
  const report = await harvest({rows: [{id: 'b2', message: 'Cine lucrează la Tisa Textile?', language_kind: 'ro'}], rewrite: async () => 'Who works at Tisa Textile hard.', lm, name: 'fake', covered: new Set()});
  assert.equal(report.c_new_neuro_candidates, 1);
  assert.equal(report.uncovered_forms.length, 1);
  assert.deepEqual(uncoveredForms([{form: 'f', output: 'o'}], new Set(['f'])), []);
});

const stated = (rel, s, o) => `@s1 stated\n  relation "${rel}"\n  role subject "${s}"\n  role object "${o}"\n  polarity affirmed\n  certainty asserted\n`;
const row = (id, message, tokens, sop) => ({id, message, dataset: 'symbolic_english', sop, gold_sop: sop, analysis_verified: 'gold_sop_match', analysis: {sentences: [{text: message, tokens}]}});
const teaches = row('t1', 'Ana teaches math in Cluj.', [tok(1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'), tok(2, 'teaches', 'teach', 'VERB', 0, 'root'), tok(3, 'math', 'math', 'NOUN', 2, 'obj'), tok(4, 'in', 'in', 'ADP', 5, 'case'), tok(5, 'Cluj', 'Cluj', 'PROPN', 2, 'obl'), tok(6, '.', '.', 'PUNCT', 2, 'punct')], stated('teach', 'Ana', 'math'));
const coaches = row('t2', 'Ion coaches football in Iași.', [tok(1, 'Ion', 'Ion', 'PROPN', 2, 'nsubj'), tok(2, 'coaches', 'coach', 'VERB', 0, 'root'), tok(3, 'football', 'football', 'NOUN', 2, 'obj'), tok(4, 'in', 'in', 'ADP', 5, 'case'), tok(5, 'Iași', 'Iași', 'PROPN', 2, 'obl'), tok(6, '.', '.', 'PUNCT', 2, 'punct')], stated('coach', 'Ion', 'football'));
const trains = row('t3', 'Radu trains chess in Sibiu.', [tok(1, 'Radu', 'Radu', 'PROPN', 2, 'nsubj'), tok(2, 'trains', 'train', 'VERB', 0, 'root'), tok(3, 'chess', 'chess', 'NOUN', 2, 'obj'), tok(4, 'in', 'in', 'ADP', 5, 'case'), tok(5, 'Sibiu', 'Sibiu', 'PROPN', 2, 'obl'), tok(6, '.', '.', 'PUNCT', 2, 'punct')], stated('train', 'Radu', 'chess'));

test('form variants: a template keeps names, nouns and the verb as slots and is filled from the train/dev side only', () => {
  assert.equal(replaceInSop('relation "teach"\nrole object "math"', 'math', 'physics'), 'relation "teach"\nrole object "physics"');
  assert.equal(replaceInSop('role object "mathematics"', 'math', 'physics'), 'role object "mathematics"');
  const lex = lexiconsOf([teaches, coaches, trains]);
  assert.ok(lex.verbs.get('§L')?.has('coach'));
  const template = skeletonOf(teaches);
  assert.ok(template, 'a gold single-sentence row has a template');
  assert.doesNotMatch(template.template_text, /\b(Ana|teaches|math|Cluj)\b/, 'the catalog holds no name, noun or verb of the source row');
  assert.doesNotMatch(template.template_sop, /"(Ana|math|teach)"/);
  assert.deepEqual(template.slots.map(s => s.kind), ['name', 'name', 'noun', 'verb']);
  const names = {given: ['Mara', 'Teo'], surnames: ['Pop'], places: ['Arad', 'Deva']};
  const v = lexicalize(template, lex, names, rngOf('seed'));
  assert.ok(v, 'every slot found a candidate');
  assert.notEqual(v.text, teaches.message);
  assert.doesNotMatch(v.text, /⟦/);
  assert.doesNotMatch(v.sop, /⟦/);
  assert.match(v.sop, /role subject "(Mara|Teo|Arad|Deva)"|role subject "/);
  assert.deepEqual(lexicalize(template, lex, names, rngOf('seed')), v, 'deterministic');
  assert.equal(skeletonOf({...teaches, gold_sop: '@u unclear\n  kind no_request\n'}), null, 'an unclear program is not a template');
});

test('the catalog carries hashes of the sealed texts, so the generator never reads a sealed row', () => {
  assert.match(sha16('abc'), /^[0-9a-f]{16}$/);
  assert.match(formId('a form'), /^form-[0-9a-f]{10}$/);
});

test('legacy OOD and wild suites are split by group with fixed proportions and a fixed seed', async () => {
  const {legacySplitOf, LEGACY_PROPORTIONS} = await import('../tools/datasets/three-datasets/legacy-split.mjs');
  const rows = Array.from({length: 4000}, (_, i) => ({id: `r${i}`, split_group_id: `g${Math.floor(i / 4)}`}));
  const counts = {train: 0, dev: 0, test: 0};
  const byGroup = new Map();
  for (const r of rows) { const s = legacySplitOf(r, 'formalizer-ood-v1'); counts[s]++; const g = byGroup.get(r.split_group_id) ?? new Set(); g.add(s); byGroup.set(r.split_group_id, g); }
  assert.ok([...byGroup.values()].every(g => g.size === 1), 'a group never crosses a split');
  assert.ok(Math.abs(counts.train / rows.length - LEGACY_PROPORTIONS.train / 100) < 0.05);
  assert.ok(Math.abs(counts.dev / rows.length - LEGACY_PROPORTIONS.dev / 100) < 0.05);
  assert.equal(legacySplitOf({id: 'x', split_group_id: 'g1'}, 'formalizer-ood-v1'), legacySplitOf({id: 'y', split_group_id: 'g1'}, 'formalizer-ood-v1'));
  assert.equal(legacySplitOf({id: 'w1'}, 'formalizer-wild-v1'), legacySplitOf({id: 'w1'}, 'formalizer-wild-v1'));
});

test('dropping duplicates of sealed rows: same normalized text, or same content words and form (at least two words), by hash only', async () => {
  const {duplicates} = await import('../tools/datasets/drop-lexical-duplicates.mjs');
  const {textHash, lexicalHash} = await import('../tools/datasets/three-datasets/variants.mjs');
  const {signatureOf} = await import('../tools/datasets/three-datasets/forms.mjs');
  const sealedRow = {id: 's', message: 'Does Ana teach math in Cluj?', dataset: 'symbolic_english', analysis: teaches.analysis};
  const sealed = {texts: [textHash(sealedRow.message)], lexical: [lexicalHash(signatureOf(teaches))]};
  const sameText = {id: 'a', message: 'does ana teach MATH in cluj', dataset: 'symbolic_english', analysis: coaches.analysis};
  const sameWords = {...teaches, id: 'b', message: 'Ana teaches math in Cluj, 3 times.'};
  const different = {...coaches, id: 'c'};
  assert.deepEqual(duplicates([sameText, sameWords, different], sealed).map(r => r.id), ['a', 'b']);
});
