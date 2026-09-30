// Evaluation validity (DS016): reference-free metrics on predictions, accepted golds, evaluation-only relation
// synonyms, assumed-independence of execution equivalence, slices, the unlabeled mode, the held-out resource
// partition of the generator and the noise model's one-error-per-word rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceFreeRecord, referenceFreeMetrics, gibberishVerdict, messageAsks} from '../eval/reference-free.mjs';
import {evaluate, evaluateUnlabeled} from '../eval/run.mjs';
import {computeMetrics} from '../eval/metrics.mjs';
import {tolerantOntology} from '../eval/synonyms.mjs';
import {sliceFields} from '../eval/slices.mjs';
import {Chooser} from '../tools/datasets/diversity/quotas.mjs';
import {OOD_ONLY, OOD_ONLY_FRAMES, RESOURCE_ROLES, isOodOnly} from '../tools/datasets/diversity/heldout.mjs';
import {YES_NO} from '../tools/datasets/diversity/frames.mjs';
import {PREDICATES} from '../tools/datasets/diversity/domains.mjs';
import {addNoise} from '../tools/datasets/diversity/noise.mjs';
import {rng} from '../tools/datasets/diversity/text.mjs';
import {RO_CONSTRUCTION_EN, englishRelation} from '../tools/datasets/diversity/english.mjs';
import {Agent} from '../server/agent.mjs';
import {Lexicon} from '../sop/lexicon.mjs';

const stated = (relation, roles, {polarity = 'affirmed', id = 's1'} = {}) => `@${id} stated\n  relation ${JSON.stringify(relation)}\n${Object.entries(roles).map(([role, value]) => `  role ${role} ${JSON.stringify(value)}`).join('\n')}\n  polarity ${polarity}\n  certainty asserted\n`;
const query = (relation, roles, {polarity = 'affirmed'} = {}) => `@q query\n  where match\n    relation ${JSON.stringify(relation)}\n${Object.entries(roles).map(([role, value]) => `    role ${role} ${value.startsWith('?') ? value : JSON.stringify(value)}`).join('\n')}\n    polarity ${polarity}\n  end\n`;
const assumed = (relation, roles) => `@a1 assumed\n  relation ${JSON.stringify(relation)}\n${Object.entries(roles).map(([role, value]) => `  role ${role} ${JSON.stringify(value)}`).join('\n')}\n  polarity affirmed\n  basis default\n`;

test('reference-free: clean predictions pass every check', () => {
  const cases = [
    ['Does Ana work at Acme?', query('work at', {subject: 'Ana', object: 'Acme'})],
    ['Ana works at Acme.', stated('work at', {subject: 'Ana', object: 'Acme'})],
    ['Ana does not work at Acme. Does Ion work there?', stated('work at', {subject: 'Ana', object: 'Acme'}, {polarity: 'negated'}) + '\n' + query('work at', {subject: 'Ion', object: 'Acme'})],
    ['Ion predă chimie.', stated('teach', {subject: 'Ion', object: 'chemistry'})],
    ['asdf qwer zxcv', '@u unclear\n  kind gibberish\n'],
  ];
  const records = cases.map(([message, sop]) => referenceFreeRecord(message, sop));
  for (const [index, record] of records.entries()) assert.deepEqual(record.defects, [], `case ${index}: ${cases[index][0]}`);
  const metrics = referenceFreeMetrics(records);
  for (const key of ['parse_validity', 'compile_validity', 'contract_vocabulary', 'stated_value_anchoring', 'polarity_agreement', 'question_form_agreement', 'unclear_gibberish_agreement']) assert.equal(metrics[key].value, 1, key);
  assert.equal(metrics.id_like_tokens.value, 0);
});

test('reference-free: planted defects are detected', () => {
  const check = (message, sop) => referenceFreeRecord(message, sop);
  assert.equal(check('Does Ana work at Acme?', 'this is not SOP').parse_valid, false);
  assert.equal(check('Does Ana work at Acme?', '@f fact\n  holds works_at ana acme\n  valid timeless\n  source user\n').compile_valid, false, 'model-forbidden wire type');
  assert.equal(check('Does Ana work at Acme?', query('work at', {subject: 'Ana', object: 'Acme'}).replace('  where match', '  flavour sweet\n  where match')).contract_valid, false, 'hallucinated field');
  const unanchored = check('Ana works at Acme.', stated('work at', {subject: 'Carina', object: 'Acme'}));
  assert.equal(unanchored.stated_values_anchored, 1);
  assert.equal(unanchored.stated_values, 2);
  const negation = referenceFreeMetrics([check('Ana works at Acme.', stated('work at', {subject: 'Ana', object: 'Acme'}, {polarity: 'negated'}))]);
  assert.equal(negation.unsupported_negation.value, 1);
  const missed = referenceFreeMetrics([check('Ana does not work at Acme.', stated('work at', {subject: 'Ana', object: 'Acme'}))]);
  assert.equal(missed.missed_negation.value, 1);
  const noQuery = referenceFreeMetrics([check('Does Ana work at Acme?', stated('work at', {subject: 'Ana', object: 'Acme'}))]);
  assert.equal(noQuery.missing_query.value, 1);
  const spurious = referenceFreeMetrics([check('Ana works at Acme.', query('work at', {subject: 'Ana', object: 'Acme'}))]);
  assert.equal(spurious.spurious_query.value, 1);
  const gibberish = referenceFreeMetrics([check('asdf qwer zxcv', query('work at', {subject: 'asdf', object: 'zxcv'})), check('Does Ana work at Acme?', '@u unclear\n  kind gibberish\n')]);
  assert.equal(gibberish.gibberish_missed.value, 1);
  assert.equal(gibberish.gibberish_on_intelligible.value, 1);
  assert.equal(check('Ana works at Acme.', stated('work at', {subject: 'Ana', object: 'acme_corp_12'})).id_tokens, true);
  const withAssumed = referenceFreeMetrics([check('Is Ana certified?', assumed('be trained', {subject: 'Ana'}) + '\n' + query('be certified', {subject: 'Ana'}))]);
  assert.equal(withAssumed.rows_with_assumed.value, 1);
  assert.equal(withAssumed.assumed_wire_share.value, 1);
});

test('reference-free detectors: questions and gibberish', () => {
  assert.equal(messageAsks('I wonder who coaches the Falcons.'), true);
  assert.equal(messageAsks('Știi dacă Ana lucrează la Acme'), true);
  assert.equal(messageAsks('Ana works at Acme. Ion lives in Cluj.'), false);
  assert.equal(gibberishVerdict('qwerty asdfg zxcvb'), 'gibberish');
  assert.equal(gibberishVerdict('Hello, how are you?'), 'intelligible');
  assert.equal(gibberishVerdict('Oana teaches German, correct?'), 'intelligible');
});

// A self-contained verification world: one predicate, two entities, one fact.
const ONTOLOGY = `@works_at predicate
  role subject person
  role object organization
  label en "work at"
  alias en "work for"
  description "works for"

@be_certified predicate
  role subject person
  label en "be certified"
  description "is certified"

@ana entity
  kind person
  label en "Ana"

@acme entity
  kind organization
  label en "Acme"
`;
const row = (extra = {}) => ({
  id: 'r1', semantic_case_id: 'r1', language: 'en', evaluation_track: 'formalization', question_type: 'yes_no', question: 'Does Ana work at Acme?',
  sop_target: query('work at', {subject: 'Ana', object: 'Acme'}), ontology_sop: ONTOLOGY,
  setup_sop: '@fact1 fact\n  holds works_at ana acme\n  valid timeless\n  source world', expected: {status: 'supported'},
  verification_context: {now: '2026-09-28T12:00:00Z', language: 'en', model_visible: false, entities: [{id: 'ana', label: 'Ana'}, {id: 'acme', label: 'Acme'}]}, noise: [], ...extra,
});
const run = async (rows, predictions) => evaluate(rows, {predictor: ({id}) => predictions[id]});

test('equivalence: strict, tolerant (evaluation-only synonyms) and canonical are reported separately', async () => {
  const synonym = query('be employed at', {subject: 'Ana', object: 'Acme'});
  const wrong = query('hate', {subject: 'Ana', object: 'Acme'});
  const rows = [row(), row({id: 'r2', semantic_case_id: 'r2'}), row({id: 'r3', semantic_case_id: 'r3'})];
  const report = await run(rows, {r1: rows[0].sop_target, r2: synonym, r3: wrong});
  const [gold, tolerant, unrelated] = report.records;
  assert.deepEqual([gold.canonical_match, gold.execution_equivalent, gold.execution_equivalent_tolerant], [true, true, true]);
  assert.deepEqual([tolerant.canonical_match, tolerant.execution_equivalent, tolerant.execution_equivalent_tolerant], [false, false, true], 'a declared synonym links only in the tolerant run');
  assert.deepEqual([unrelated.execution_equivalent, unrelated.execution_equivalent_tolerant], [false, false]);
  assert.equal(report.metrics.execution_equivalence.numerator, 1);
  assert.equal(report.metrics.execution_equivalence_tolerant.numerator, 2);
  const metrics = computeMetrics(rows, report);
  assert.equal(metrics.formalizer.execution_equivalence_tolerant.numerator, 2);
  assert.ok(metrics.reference_free && metrics.slices.by_language_slice.en);
});

test('equivalence: any accepted gold counts; the primary-only metrics stay separate', async () => {
  const alternative = query('be certified', {subject: 'Ana'});
  const rows = [row({sop_targets_accepted: [alternative]})];
  const report = await run(rows, {r1: alternative});
  const [record] = report.records;
  assert.equal(record.accepted_golds, 2);
  assert.deepEqual([record.canonical_match, record.canonical_match_primary, record.execution_equivalent, record.execution_equivalent_primary], [true, false, true, false]);
});

test('equivalence: execution does not depend on assumed wires (only the canonical form does)', async () => {
  const rows = [row()];
  const report = await run(rows, {r1: assumed('be certified', {subject: 'Ana'}) + '\n' + rows[0].sop_target});
  const [record] = report.records;
  assert.equal(record.execution_equivalent, true);
  assert.equal(record.canonical_match, false);
});

test('synonyms: a phrase declared for another predicate is dropped, not added', () => {
  const {added, conflicts} = tolerantOntology(ONTOLOGY, {works_at: ['be certified', 'be employed with']});
  assert.ok(added.some(item => item.phrase === 'be employed with'));
  assert.deepEqual(conflicts.map(item => item.phrase), ['be certified']);
});

test('slices: language, noise and the hard reasons', () => {
  const long = sliceFields({question: Array.from({length: 25}, () => 'word').join(' '), language: 'ro', code_switch: {kind: 'clause_switch'}, noise_level: 'heavy', sop_target: stated('a', {subject: 'x'}) + '\n' + stated('b', {subject: 'y'}, {id: 's2'})});
  assert.equal(long.language_slice, 'mixed');
  assert.equal(long.noise_slice, 'heavy');
  assert.deepEqual(long.hard_reasons, ['long', 'multi_statement', 'code_switched', 'high_noise']);
  assert.equal(sliceFields({question: 'Is Ana here?', language: 'en', noise: []}).hard_slice, 'not_hard');
});

test('unlabeled mode: messages and predictions only', async () => {
  const report = await evaluateUnlabeled([{id: 'm1', message: 'Does Ana work at Acme?'}, {id: 'm2', message: 'asdf qwer zxcv'}], {predictor: ({id}) => id === 'm1' ? query('work at', {subject: 'Ana', object: 'Acme'}) : '@u unclear\n  kind gibberish\n'});
  assert.equal(report.format, 'chatsop-unlabeled-evaluation-v1');
  assert.equal(report.reference_free.parse_validity.value, 1);
  assert.equal(report.reference_free.unclear_gibberish_agreement.value, 1);
  assert.ok(report.slices.by_hard_slice.not_hard);
});

test('host anchoring: a translated common noun is anchored through the lexicon', () => {
  const lexicon = new Lexicon(`@chemistry entity\n  kind course\n  label en "chemistry"\n  label ro "chimie"\n\n@ion entity\n  kind person\n  label en "Ion"\n`);
  const sop = stated('teach', {subject: 'Ion', object: 'chemistry'});
  assert.doesNotThrow(() => new Agent({lexicon}).validateVocabulary(sop, 'Ion predă chimie.'));
  assert.throws(() => new Agent({lexicon}).validateVocabulary(sop, 'Ion predă istorie.'), /stated_value_not_in_message/);
});

test('held-out partition: OOD-only resources never reach formalizer-v1 splits; reservation ignores filtering', () => {
  assert.ok(OOD_ONLY_FRAMES.en.every(id => RESOURCE_ROLES.get(id) === 'ood'));
  assert.ok(Object.entries(PREDICATES).some(([id, spec]) => spec.en.some(c => c.oodOnly && isOodOnly(`${id}.${c.id}`))));
  const options = YES_NO.en;
  const chooser = new Chooser(rng('partition'));
  for (const split of ['train', 'dev', 'test']) {
    chooser.setSplit(split);
    for (let i = 0; i < 200; i++) assert.ok(!OOD_ONLY.has(chooser.pick('frame', options).id), split);
  }
  chooser.setSplit('ood');
  for (let i = 0; i < 200; i++) assert.notEqual(RESOURCE_ROLES.get(chooser.pick('frame', options).id), 'shared');
  // The same frame keeps its role in a filtered sub-list (the cause of the former frame leak).
  const test = new Set(options.filter(option => RESOURCE_ROLES.get(option.id) === 'test').map(option => option.id));
  assert.deepEqual([...chooser.reservedOf(options.slice(0, 7))].sort(), options.slice(0, 7).filter(option => test.has(option.id)).map(option => option.id).sort());
});

test('noise: at most one character or word error per word', () => {
  const random = rng('one-error');
  for (let i = 0; i < 400; i++) {
    const {ops} = addNoise('Could you check whether Ana still works at the regional hospital in Cluj this year?', {language: 'en', random, level: 'heavy'});
    const outputs = new Set();
    for (const op of ops.filter(item => item.op === 'typo')) {
      assert.ok(![...outputs].some(word => word.includes(op.from)), `stacked typo on ${op.from}`);
      outputs.add(op.to);
    }
  }
});

test('english targets: every Romanian construction has an English phrase; Romanian phrases are rejected', () => {
  for (const [id, spec] of Object.entries(PREDICATES)) for (const c of spec.ro) assert.ok(RO_CONSTRUCTION_EN[`${id}.${c.id}`], `${id}.${c.id} "${c.rel}"`);
  assert.equal(englishRelation('lucra la', 'ro'), 'work at');
  assert.throws(() => englishRelation('a zbura peste', 'ro'), /no English relation phrase/);
});

test('audit anchoring: first person and words-only constructs', async () => {
  const {anchoredValue} = await import('../tools/datasets/audit/translation.mjs');
  const {claimedConstructs} = await import('../tools/datasets/audit/checks.mjs');
  assert.equal(anchoredValue('the user', 'I work at Acme.'), true);
  assert.equal(anchoredValue('the user', 'Ana works at Acme.'), false);
  assert.equal(anchoredValue("the user's brother", 'Eu lucrez la Acme; fratele meu lucrează și el acolo?'), true);
  assert.equal(anchoredValue("the user's brother", 'I work at Acme; does my sister work there?'), false);
  assert.deepEqual(claimedConstructs('quantified:at_least'), []);
  assert.deepEqual(claimedConstructs('attribute_value:cost_compare_least'), ['comparison']);
});
