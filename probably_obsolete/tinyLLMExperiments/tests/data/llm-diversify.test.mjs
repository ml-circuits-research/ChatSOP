// LLM diversification pipeline (DS022 "LLM diversification"): the deterministic parts, without any model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {protectedOf, anchorProblems, cueProblems, targetValues, voiceProblems} from '../../tools/datasets/llm-diversify/anchors.mjs';
import {applyQuota, paraphraseRow, MAX_LLM_SHARE} from '../../tools/datasets/llm-diversify/rows.mjs';
import {stratifiedSample, EXCLUDED_FAMILIES} from '../../tools/datasets/llm-diversify/sample.mjs';
import {PARAPHRASE_SYSTEM, JUDGE_SYSTEM, paraphraseUser} from '../../tools/datasets/llm-diversify/prompts.mjs';
import {registerTargetFormat, distill} from '../../tools/datasets/llm-diversify/distill.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = `@s1 stated
  relation "work at"
  role subject "Ana Pop"
  role object "Vertex Labs"
  polarity affirmed
  certainty asserted

@q query
  where all
    match
      relation "live in"
      role subject "Ana Pop"
      role location "Cluj"
      polarity affirmed
    end
  end
`;
const row = {
  id: 'fv1_x_0_0', split: 'train', split_group_id: 'fv1_x', surface_group_id: 'fv1_x_0_0', language: 'en', family: 'attached', question: 'Ana Pop works at Vertex Labs. Does she live in Cluj?',
  sop_target: target, expected: {status: 'supported', answers: [[]]}, rights: {text_copied: false}, quality_flags: {source_rows_copied: false}, source: {kind: 'generator_composed_scenario'},
  surface_design: {question_frame: 'yn.en.1', resources: ['works_at.en.0', 'yn.en.1']},
  surface_ir: {stated: [{relation: 'work at', roles: []}], query: {props: [{relation: 'live in', roles: []}]}},
  world: {predicates: ['works_at', 'lives_in']},
  verification_context: {entities: [{label: 'Ana Pop', aliases: ['Ana']}, {label: 'Vertex Labs', aliases: []}, {label: 'Cluj', aliases: []}]},
};

test('anchors: values, relation words and numbers must survive', () => {
  assert.deepEqual(targetValues(target), ['Ana Pop', 'Vertex Labs', 'Cluj']);
  const kept = protectedOf(row);
  assert.deepEqual(kept.spans.map(s => s.text), ['Ana Pop', 'Vertex Labs', 'Cluj']);
  assert.deepEqual(kept.keyWords, ['works', 'live']);
  assert.deepEqual(anchorProblems(row, row.question), []);
  assert.deepEqual(anchorProblems(row, 'quick q: ana pop is at Vertex Labs, and does she live in Cluj?').length > 0, true, 'a lower-cased name and a dropped verb fail');
  assert.deepEqual(anchorProblems(row, 'Ana Pop worked at Vertex Labs. Is she living in Cluj?'), []);
  assert.ok(anchorProblems(row, 'Ana Pop is employed by Vertex Labs. Does she live in Cluj?').some(p => /work at/.test(p)), 'a synonym for the relation fails');
  assert.ok(anchorProblems(row, 'Ana Pop works at Vertex Labs since 2019. Does she live in Cluj?').some(p => /added/.test(p)), 'an added number fails');
  const passive = {question: 'Is a permit issued by the Town Hall?', surface_ir: {query: {props: [{relation: 'be issued by'}]}}};
  assert.ok(voiceProblems(passive, 'Does the Town Hall issue a permit?').length, 'passive to active fails');
  assert.ok(voiceProblems({question: 'Ana manages Ion.', surface_ir: {stated: [{relation: 'manage'}]}}, 'Ion is managed by Ana.').length, 'active to passive fails');
});

test('cues: question form, negation and certainty must agree; tag questions are not negations', () => {
  assert.deepEqual(cueProblems(row, 'hey, Ana Pop works at Vertex Labs - does she live in Cluj?'), []);
  assert.ok(cueProblems(row, 'Ana Pop works at Vertex Labs. She lives in Cluj.').length);
  assert.ok(cueProblems(row, 'Ana Pop works at Vertex Labs. Does she not live in Cluj?').some(p => /negation/.test(p)));
  assert.ok(cueProblems(row, 'I think Ana Pop works at Vertex Labs. Does she live in Cluj?').some(p => /hedge/.test(p)));
  assert.deepEqual(cueProblems({...row, question: 'Unde locuiește Ana, în Cluj, nu?'}, 'Unde stă Ana, în Cluj, corect?'), []);
  assert.ok(cueProblems({...row, question: 'Until when did Ana live in Cluj?'}, 'How long did Ana live in Cluj?').some(p => /wh form/.test(p)));
});

test('rows: the gold is inherited, the split group kept, provenance stamped', () => {
  const out = paraphraseRow(row, {index: 1, text: 'so Ana Pop works at Vertex Labs; does she live in Cluj?', trace: {model: 'm', judge: {same: true, reason: 'ok'}}});
  assert.equal(out.sop_target, row.sop_target);
  assert.equal(out.split_group_id, row.split_group_id);
  assert.equal(out.split, 'train');
  assert.equal(out.generation_trace.method, 'llm-paraphrase');
  assert.equal(out.rights.text_copied, false);
  assert.deepEqual(out.surface_design.resources, ['works_at.en.0'], 'frame resources are dropped, constructions kept');
});

test('quota: LLM-authored rows are at most 40% of a build, and never extend the test split', () => {
  const base = Array.from({length: 60}, (_, i) => ({id: `g${i}`, split: 'train'}));
  const llm = Array.from({length: 100}, (_, i) => ({id: `l${i}`, split: 'train'}));
  const mixed = applyQuota(base, llm);
  assert.ok(mixed.llm_share <= MAX_LLM_SHARE + 1e-9 && mixed.kept === 40);
  assert.deepEqual(applyQuota(base, llm).rows.map(r => r.id), mixed.rows.map(r => r.id), 'deterministic');
  assert.throws(() => applyQuota(base, [{id: 'x', split: 'test'}]));
});

test('sampling is deterministic, stratified and excludes surface-defined families', () => {
  const rows = [];
  for (const family of ['a', 'b', 'c', 'unclear', 'long_message']) for (let i = 0; i < 30; i++)
    rows.push({...row, id: `${family}_${i}`, family, language: i % 2 ? 'ro' : 'en', code_switch: i % 5 === 0 ? {kind: 'x'} : null});
  const one = stratifiedSample(rows, {count: 12}), two = stratifiedSample(rows, {count: 12});
  assert.deepEqual(one.map(r => r.id), two.map(r => r.id));
  assert.equal(one.length, 12);
  assert.ok(one.every(r => !EXCLUDED_FAMILIES.has(r.family)));
  assert.deepEqual(new Set(one.map(r => r.family)), new Set(['a', 'b', 'c']));
});

test('model boundary: prompts carry no target, no SOP and no sealed-suite reference', () => {
  const user = paraphraseUser({message: row.question, language: 'English', protectedSpans: ['Ana Pop'], keyWords: ['works'], n: 3});
  for (const text of [PARAPHRASE_SYSTEM, JUDGE_SYSTEM, user]) {
    assert.doesNotMatch(text, /@q|@s1|\brelation "|polarity|sop_target|wild|ood|eval\/suites/i);
    assert.ok(!text.includes(target));
  }
  for (const file of ['pipeline.mjs', 'prompts.mjs', 'anchors.mjs', 'sample.mjs', 'rows.mjs', 'diversity.mjs', 'haiku.mjs', 'distill.mjs'])
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'tools/datasets/llm-diversify', file), 'utf8'), /formalizer-wild|formalizer-ood|test\.jsonl|eval\/suites/, file);
});

test('distillation waits for a registered target format', async () => {
  await assert.rejects(() => distill({client: null, briefs: [], format: 'next', writerSystem: '', parse: () => []}), /waits for a target format/);
  assert.throws(() => registerTargetFormat('broken', {}), /lacks/);
});
