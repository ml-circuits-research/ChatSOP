import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditCorpus, checkRow, corpusFiles, defaultReportPath} from '../tools/datasets/audit/engine.mjs';
import {maskTemplate, targetSkeleton} from '../tools/datasets/audit/diversity.mjs';
import {vocabularyOf} from '../tools/datasets/audit/rows.mjs';
import {auditSourceBoundary} from '../eval/leakage.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(repository, 'tools/datasets/audit-corpus.mjs');

/** Model-language wires: a stated (or assumed) proposition and a query match block, with values as written. */
const said = (relation, subject, object, {id = 'p', polarity = 'affirmed', type = 'stated'} = {}) =>
  `@${id} ${type}\n  relation "${relation}"\n  role subject "${subject}"\n  role object "${object}"\n  polarity ${polarity}\n${type === 'stated' ? '  certainty asserted\n' : ''}`;
const asked = (relation, subject, object, extra = '') =>
  `@q query\n  where match\n    relation "${relation}"\n    role subject ${subject}\n    role object ${object}\n    polarity affirmed\n  end\n${extra}`;
const CLEAN = said('guided', 'Mira', 'Leon') + '\n' + asked('guided', '"Mira"', '"Leon"');

/** A clean, grounded two-entity row; every test plants one defect on a copy. */
function row(overrides = {}) {
  const id = overrides.id ?? 'case_1';
  return {
    id,
    semantic_case_id: id,
    split_group_id: overrides.split_group_id ?? id,
    split: 'train',
    language: 'en',
    structure_id: 'argument_order',
    question: 'Mira guided Leon through the archive. Did Mira guide Leon?',
    context: {
      entities: [{id: 'e_mira', label: 'Mira'}, {id: 'e_leon', label: 'Leon'}, {id: 'e_ana', label: 'Ana, general steward'}],
      predicates: [{id: 'guided', args: ['person', 'person'], meaning: 'guided another person'}, {id: 'praised', args: ['person', 'person'], meaning: 'praised another person'}],
    },
    quality_flags: {source_rows_copied: false},
    sop_target: CLEAN,
    ontology_sop: '@e_mira entity\n  kind person\n  label en "Mira"\n',
    expected: {status: 'supported', answers: [[]]},
    ...overrides,
  };
}
const fired = (value, options) => checkRow(row(value), options);

test('clean grounded row passes every faithfulness, label and context check', () => {
  assert.deepEqual(Object.keys(fired()), []);
});

test('entity support flags an unmentioned stated value and accepts EN/RO, diacritics, inflection and typos', () => {
  const planted = fired({sop_target: said('guided', 'Ana', 'Leon', {polarity: 'negated'}) + '\n' + asked('guided', '"Mira"', '"Leon"')});
  assert.match(planted['faithfulness.entity'][0], /Ana/);
  const romanian = fired({
    language: 'ro', question: 'Ștefan a îndrumat-o pe Anei prin arhivă. L-a îndrumat Ștefan pe Ana?',
    sop_target: said('a îndrumat', 'Stefan', 'Ana') + '\n' + asked('a îndrumat', '"Ștefan"', '"Ana"'),
  });
  assert.equal(romanian['faithfulness.entity'], undefined);
  const typo = fired({question: 'Mirra guided Leonrdo. Did Mira guide Leonardo?', sop_target: said('guided', 'Mirra', 'Leonrdo') + '\n' + asked('guided', '"Mira"', '"Leonardo"')});
  assert.equal(typo['faithfulness.entity'], undefined);
  const literal = fired({sop_target: asked('guided', '"Wren"', '?x', '  select ?x\n')});
  assert.match(literal['faithfulness.entity'][0], /"Wren"/);
});

test('polarity support flags an unstated negation and a positively asked negative relation', () => {
  const negated = said('guided', 'Mira', 'Leon', {polarity: 'negated'}) + '\n' + asked('guided', '"Mira"', '"Leon"');
  assert.ok(fired({sop_target: negated})['faithfulness.polarity']);
  assert.equal(fired({sop_target: negated, question: 'Mira did not guide Leon. Did Mira guide Leon?'})['faithfulness.polarity'], undefined);
  assert.equal(fired({sop_target: negated, language: 'ro', question: 'Mira nu l-a îndrumat pe Leon. Did Mira guide Leon?'})['faithfulness.polarity'], undefined);
  const omission = {sop_target: asked('omitted', '"Mira"', '?x', '  select ?x\n')};
  assert.ok(fired({...omission, question: 'What is in Mira\'s register?'})['faithfulness.polarity']);
  assert.equal(fired({...omission, question: 'What did Mira\'s register leave out?'})['faithfulness.polarity'], undefined);
  assert.ok(fired({question: 'Mira never guided Leon. Did Mira guide Leon?'})['faithfulness.polarity_unmarked']);
});

test('predicate support is a warning when no gloss word reaches the message', () => {
  const findings = fired({sop_target: asked('audited the statements of', '"Mira"', '"Leon"')});
  assert.match(findings['faithfulness.predicate'][0], /audited/);
  assert.equal(fired()['faithfulness.predicate'], undefined);
});

test('structure labels must be backed by the construct they claim', () => {
  assert.ok(fired({structure_id: 'gp_qqp_quantifier'})['label.construct']);
  assert.ok(fired({structure_id: 'what|comparison'})['label.construct']);
  assert.ok(fired({structure_id: 'x_temporal'})['label.construct']);
  assert.equal(fired({structure_id: 'how_many|quantifier', sop_target: asked('guided', '"Mira"', '?x', '  mode count\n  select ?x\n')})['label.construct'], undefined);
  assert.equal(fired({structure_id: 'x_temporal', sop_target: asked('guided', '"Mira"', '"Leon"', '  at "2024-05-01"\n')})['label.construct'], undefined);
  assert.ok(fired({structure_id: 'gp_negation'})['label.negation']);
});

test('context non-triviality flags a single-predicate shortlist and a leaked gold answer', () => {
  const trivial = fired({
    context: {entities: [{id: 'e_mira', label: 'Mira'}, {id: 'e_leon', label: 'Leon'}], predicates: [{id: 'guided', args: ['person', 'person'], meaning: 'guided another person'}]},
    sop_target: asked('guided', '"Mira"', '?x', '  select ?x\n'), expected: {status: 'supported', answers: [['e_leon']]},
  });
  assert.ok(trivial['context.trivial']);
  assert.ok(trivial['context.single_predicate']);
  assert.match(trivial['context.answer_leak'][0], /e_leon/);
});

test('identifier and hash-like names inside natural language are flagged', () => {
  assert.ok(fired({question: 'Did Mira guide Leon in case gp-qqp-176890?'})['diversity.case_id_in_text']);
  assert.ok(fired({question: 'Osmira11 guided Leon. Did Mira guide Leon?'})['diversity.hash_like_name']);
});

test('model-assumption wires are counted but never flagged as unfaithful', () => {
  const unsupported = {sop_target: said('guided', 'Ana', 'Leon') + '\n' + asked('guided', '"Mira"', '"Leon"')};
  assert.ok(fired(unsupported)['faithfulness.entity']);
  assert.equal(fired({sop_target: said('guided', 'Ana', 'Leon', {type: 'assumed'}) + '\n' + asked('guided', '"Mira"', '"Leon"')})['faithfulness.entity'], undefined, 'assumed is an assumption type by default');
  assert.equal(fired(unsupported, {groundedTypes: [], assumptionTypes: ['stated']})['faithfulness.entity'], undefined);
  assert.throws(() => checkRow(row(), {groundedTypes: ['stated'], assumptionTypes: ['stated']}), /cannot be both|both/);
});

test('templates and target skeletons mask names, identifiers and digits', () => {
  const first = row();
  const second = row({id: 'case_2', question: 'Radu guided Ion through the archive. Did Radu guide Ion?',
    context: {...row().context, entities: [{id: 'f_radu', label: 'Radu'}, {id: 'f_ion', label: 'Ion'}]},
    sop_target: said('guided', 'Radu', 'Ion') + '\n' + asked('guided', '"Radu"', '"Ion"')});
  const key = value => maskTemplate(value.question, value, vocabularyOf(value));
  assert.equal(key(first), key(second));
  assert.equal(targetSkeleton(first.sop_target, vocabularyOf(first)), targetSkeleton(second.sop_target, vocabularyOf(second)));
});

function corpusRoot(splits) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-corpus-audit-'));
  const files = corpusFiles(root, 'toy');
  for (const [split, rows] of Object.entries(splits)) {
    fs.mkdirSync(path.dirname(files[split]), {recursive: true});
    fs.writeFileSync(files[split], rows.map(value => JSON.stringify({...value, split})).join('\n') + '\n');
  }
  return root;
}
const NAMES = ['Mira', 'Leon', 'Radu', 'Ion', 'Elena', 'Vlad', 'Sara', 'Toma', 'Irina', 'Dan', 'Oana', 'Petru'];
const templated = (index, prefix) => row({
  id: `${prefix}_${index}`, question: `${NAMES[index]} guided ${NAMES[index + 1]} through the archive. Did ${NAMES[index]} guide ${NAMES[index + 1]}?`,
  context: {...row().context, entities: [{id: `${prefix}_a${index}`, label: NAMES[index]}, {id: `${prefix}_b${index}`, label: NAMES[index + 1]}]},
  sop_target: said('guided', NAMES[index], NAMES[index + 1]) + '\n' + asked('guided', `"${NAMES[index]}"`, `"${NAMES[index + 1]}"`),
});

test('corpus pass reports diversity, near-duplicates and template-level leakage against the sealed test', async () => {
  const long = 'The archive record for the eastern hall shows that the courier delivered the sealed parcel to the reading room on the second floor';
  const root = corpusRoot({
    train: [...Array.from({length: 8}, (_, index) => templated(index, 'tr')),
      row({id: 'near_1', question: long + '. Mira guided Leon. Did Mira guide Leon at noon?'}),
      row({id: 'near_2', question: long + '. Mira guided Leon. Did Mira guide Leon at dusk?'})],
    dev: [templated(8, 'dv')],
    test: [templated(9, 'ts'), templated(10, 'ts2')],
  });
  try {
    const report = await auditCorpus({root, corpus: 'toy', options: {failOn: 'none'}});
    assert.equal(report.invariants.total, 0);
    assert.equal(report.verdict.status, 'pass');
    assert.ok(report.diversity.development.templates.distinct <= 3);
    assert.ok(report.diversity.development.templates.top_share > 0.9);
    assert.ok(report.diversity.near_duplicates.rows >= 2);
    assert.equal(report.leakage.test_vs_development.template_overlap, 1);
    assert.equal(report.leakage.test_vs_development.target_skeleton_overlap, 1);
    assert.ok(report.leakage.test_vs_development.entity_overlap > 0);
    const check = id => report.checks.find(item => item.id === id);
    assert.equal(check('leakage.template_overlap').status, 'warning');
    assert.equal(check('diversity.top10_template_share').status, 'warning');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('semantic errors fail by default, report mode passes, invariants always fail', async () => {
  const bad = row({id: 'bad', question: 'Mira guided Leon through the archive. Did Mira guide Leon twice?', sop_target: said('guided', 'Ana', 'Leon', {polarity: 'negated'}) + '\n' + asked('guided', '"Mira"', '"Leon"')});
  const root = corpusRoot({train: [row(), bad]});
  try {
    const strict = await auditCorpus({root, corpus: 'toy'});
    assert.equal(strict.verdict.status, 'fail');
    assert.ok(strict.verdict.failed_checks.includes('faithfulness.entity'));
    assert.ok(strict.verdict.failed_checks.includes('faithfulness.polarity'));
    assert.equal(strict.faithfulness.error_rate, 0.5);
    const lenient = await auditCorpus({root, corpus: 'toy', options: {failOn: 'none'}});
    assert.equal(lenient.verdict.status, 'pass');
    const tolerant = await auditCorpus({root, corpus: 'toy', options: {failOn: 'faithfulness.entity=60%'}});
    assert.equal(tolerant.verdict.status, 'pass');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
  const duplicated = corpusRoot({train: [row(), row()]});
  try {
    const report = await auditCorpus({root: duplicated, corpus: 'toy', options: {failOn: 'none'}});
    assert.equal(report.verdict.status, 'fail');
    assert.ok(report.invariants.counts.id >= 1);
  } finally {
    fs.rmSync(duplicated, {recursive: true, force: true});
  }
});

test('CLI writes eval/reports/current/corpus-audit/<corpus>.json, never under datasets/, and supports --out and --stdout', () => {
  const root = corpusRoot({train: [row()], dev: [templated(3, 'dv')]});
  try {
    const result = spawnSync(process.execPath, [cli, '--corpus', 'toy', '--root', root], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const expected = defaultReportPath(root, 'toy');
    assert.equal(path.relative(root, expected), path.join('eval', 'reports', 'current', 'corpus-audit', 'toy.json'));
    assert.equal(JSON.parse(fs.readFileSync(expected, 'utf8')).corpus, 'toy');
    assert.equal(fs.existsSync(path.join(root, 'datasets', 'toy', 'audit')), false);
    assert.match(result.stdout, /verdict: PASS/);
    const out = path.join(root, 'elsewhere', 'toy.json');
    assert.equal(spawnSync(process.execPath, [cli, '--corpus', 'toy', '--root', root, '--out', out], {encoding: 'utf8'}).status, 0);
    assert.ok(fs.existsSync(out));
    fs.rmSync(expected);
    const piped = spawnSync(process.execPath, [cli, '--corpus', 'toy', '--root', root, '--stdout'], {encoding: 'utf8'});
    assert.equal(JSON.parse(piped.stdout).format, 'chatsop-corpus-audit-v2');
    assert.equal(fs.existsSync(expected), false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('sealed auditors stay outside the generator boundary and generators cannot import them', () => {
  const boundary = auditSourceBoundary(repository);
  assert.deepEqual(boundary.violations, []);
  assert.ok(boundary.generators.includes('tools/datasets/build-corpora.mjs'));
  assert.ok(!boundary.generators.some(file => file.startsWith('tools/datasets/audit')));
});
