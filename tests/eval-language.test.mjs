/**
 * Language-agnostic scoring and the new model-language constructs in the metrics (DS016 "Equivalence tolerance",
 * "Wire F1", "Honest partial formalization"): strict scoring links without the host dictionary, tolerant scoring
 * with it; wire ids, `$id` references and link lines are keyed id-free; `unparsed` spans are counted apart and give
 * understood-part credit; invented values and honestly marked spans are the honesty metrics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from '../eval/run.mjs';
import {compareWires, tolerantCanonicalMatch, wireMetrics} from '../eval/metrics.mjs';
import {compareProgramPropositions, propositionMetrics} from '../eval/propositions.mjs';
import {referenceFreeRecord, referenceFreeMetrics} from '../eval/reference-free.mjs';
import {scoreAgainstAccepted} from '../tools/eval/wild-suite.mjs';
import {parse} from '../sop/parser.mjs';

const stated = (id, relation, roles, extra = '') => `@${id} stated\n  relation ${JSON.stringify(relation)}\n${Object.entries(roles).map(([role, value]) => `  role ${role} ${/^[?$]/.test(value) ? value : JSON.stringify(value)}`).join('\n')}\n  polarity affirmed\n  certainty asserted\n${extra}`;
const query = (id, relation, roles, {select = null} = {}) => `@${id} query\n${select ? `  select ${select}\n` : ''}  where match\n    relation ${JSON.stringify(relation)}\n${Object.entries(roles).map(([role, value]) => `    role ${role} ${/^[?$]/.test(value) ? value : JSON.stringify(value)}`).join('\n')}\n    polarity affirmed\n  end\n`;
const program = (...wires) => wires.join('\n');

// ---------------------------------------------------------------- evaluator: strict without, tolerant with the dictionary
const ONTOLOGY = `@works_at predicate
  role subject person
  role object organization
  label en "work at"
  description "works for"

@ana entity
  kind person
  label en "Ana"

@acme entity
  kind organization
  label en "Acme"
`;
const row = (id, question, language = 'en') => ({
  id, semantic_case_id: id, language, evaluation_track: 'formalization', question_type: 'yes_no', question,
  sop_target: query('q', 'work at', {subject: 'Ana', object: 'Acme'}), ontology_sop: ONTOLOGY,
  setup_sop: '@fact1 fact\n  holds works_at ana acme\n  valid timeless\n  source world', expected: {status: 'supported'},
  verification_context: {now: '2026-09-28T12:00:00Z', language, model_visible: false, entities: [{id: 'ana', label: 'Ana'}, {id: 'acme', label: 'Acme'}]}, noise: [],
});

test('execution: strict links without the dictionary; tolerant accepts English synonym relation phrases and no Romanian', async () => {
  const rows = [row('en', 'Does Ana work at Acme?'), row('ro', 'Lucrează Ana la Acme?', 'ro'),
    row('synonym', 'Is Ana on the staff of Acme?'), row('wrong', 'Does Ana hate Acme?')];
  const predictions = {
    en: query('x', 'work at', {subject: 'Ana', object: 'Acme'}),
    ro: query('q', 'lucra la', {subject: 'Ana', object: 'Acme'}),
    synonym: query('q', 'be on the staff of', {subject: 'Ana', object: 'Acme'}),
    wrong: query('q', 'hate', {subject: 'Ana', object: 'Acme'}),
  };
  const report = await evaluate(rows, {predictor: ({id}) => predictions[id]});
  const by = Object.fromEntries(report.records.map(r => [r.id, r]));
  // English-only core (2026-10-01): the product linking carries no Romanian-to-English translation, so an archived Romanian relation is not accepted tolerantly.
  assert.deepEqual(Object.values(by).map(r => [r.id, r.execution_equivalent, r.execution_equivalent_tolerant]), [
    ['en', true, true], ['ro', false, false], ['synonym', false, true], ['wrong', false, false],
  ]);
  assert.equal(report.metrics.execution_equivalence.numerator, 1);
  assert.equal(report.metrics.execution_equivalence_tolerant.numerator, 2);
});

// ---------------------------------------------------------------- propositions and wire F1: tolerant variant
test('propositions: strict identity and a tolerant variant through Dictionary.sameMeaning', () => {
  const gold = parse(program(stated('s1', 'work at', {subject: 'Maria', object: 'Acme'}), stated('s2', 'live in', {subject: 'Maria', location: 'Cluj'})));
  const predicted = parse(program(stated('a', 'lucra la', {subject: 'Maria', object: 'Acme'}), stated('b', 'locui în', {subject: 'Maria', location: 'Cluj'})));
  const c = compareProgramPropositions(gold, predicted);
  assert.deepEqual([c.matched, c.tolerant_matched], [0, 2]);
  const m = propositionMetrics([c]);
  assert.equal(m.proposition_recall.value, 0);
  assert.equal(m.proposition_recall_tolerant.value, 1);
  assert.equal(m.proposition_precision_tolerant.value, 1);
  const unrelated = compareProgramPropositions(gold, parse(stated('a', 'hate', {subject: 'Maria', object: 'Acme'})));
  assert.equal(unrelated.tolerant_matched, 0);
});

test('wire F1: ids, $id role values and link lines are keyed id-free; a link to another clause is a miss', () => {
  // "The rollback failed because the migration is not idempotent", with other ids and the wires reordered.
  const gold = program(
    stated('s1', 'fail', {subject: 'the rollback'}, '  because $s2\n'),
    stated('s2', 'be idempotent', {subject: 'the migration'}).replace('polarity affirmed', 'polarity negated'),
  );
  const renamed = program(
    stated('x9', 'be idempotent', {subject: 'the migration'}).replace('polarity affirmed', 'polarity negated'),
    stated('y', 'fail', {subject: 'the rollback'}, '  because $x9\n'),
  );
  const c = compareWires(gold, renamed);
  assert.deepEqual([c.gold, c.predicted, c.matched, c.f1], [2, 2, 2, 1]);
  const selfLinked = program(stated('s2', 'be idempotent', {subject: 'the migration'}).replace('polarity affirmed', 'polarity negated'), stated('s1', 'fail', {subject: 'the rollback'}, '  so $s2\n'));
  assert.equal(compareWires(gold, selfLinked).matched, 1, 'another keyword is another link');
  // A $q chain: "Who coaches CS Craiova? And where does he work?" in Romanian, normalized; ids differ from the gold.
  const chain = (a, b, relation1 = 'antrena', relation2 = 'lucra la') => program(
    query(a, relation1, {subject: '?p', object: 'CS Craiova'}, {select: '?p'}),
    query(b, relation2, {subject: '$' + a, object: '?c'}, {select: '?c'}),
  );
  assert.equal(compareWires(chain('q', 'q2'), chain('first', 'then')).f1, 1);
  const english = compareWires(chain('q', 'q2'), chain('a', 'b', 'train', 'work at'));
  assert.deepEqual([english.matched, english.tolerant_matched, english.tolerant_f1], [0, 2, 1]);
  assert.equal(tolerantCanonicalMatch(chain('q', 'q2'), chain('a', 'b', 'train', 'work at')), true);
  // A chain to the wrong query is a different key.
  const wrongTarget = program(query('q', 'antrena', {subject: '?p', object: 'CS Craiova'}, {select: '?p'}), query('q2', 'lucra la', {subject: '?p2', object: '?c'}, {select: '?c'}));
  assert.equal(compareWires(chain('q', 'q2'), wrongTarget).matched, 1);
});

// ---------------------------------------------------------------- unparsed: counted apart, understood-part credit, honesty
const MESSAGE = 'Maria lives in Cluj and her brother works at the thingy near the station.';
const GOLD = program(
  stated('s1', 'live in', {subject: 'Maria', location: 'Cluj'}),
  stated('s2', 'work at', {subject: "Maria's brother", object: 'the thingy near the station'}),
);
const HONEST = program(
  stated('s1', 'live in', {subject: 'Maria', location: 'Cluj'}),
  '@u1 unparsed\n  span "her brother works at the thingy near the station"\n  hint other\n',
);

test('unparsed wires are not matched but counted; understood F1 excuses gold wires inside a marked span', () => {
  const c = compareWires(GOLD, HONEST);
  assert.deepEqual([c.gold, c.predicted, c.matched, c.unparsed, c.excluded_by_unparsed], [2, 1, 1, 1, 1]);
  assert.equal(c.f1, 2 / 3);
  assert.deepEqual(c.understood, {gold: 1, gold_matched: 1, predicted: 1, matched: 1, f1: 1});
  const invented = program(stated('s1', 'live in', {subject: 'Maria', location: 'Cluj'}), stated('s2', 'work at', {subject: "Maria's brother", object: 'Bosch'}));
  const guessed = compareWires(GOLD, invented);
  assert.equal(guessed.understood.f1, 0.5, 'a guessed wire is a wrong understood wire');
  const metrics = wireMetrics([c, guessed]);
  assert.equal(metrics.unparsed_wires, 1);
  assert.deepEqual([metrics.understood.precision.value, metrics.understood.recall.value], [2 / 3, 2 / 3]);
  assert.equal(metrics.gold_wires_excluded_by_unparsed, 1);
  assert.equal(propositionMetrics([compareProgramPropositions(parse(GOLD), parse(HONEST))]).predicted_unparsed, 1);
});

test('honesty: invented stated values against honestly marked unparsed spans (reference-free)', () => {
  const honest = referenceFreeRecord(MESSAGE, HONEST);
  assert.deepEqual([honest.invented_values, honest.marked_unparsed, honest.honesty_ratio, honest.invented_value_rate], [0, 1, 1, 0]);
  const invented = referenceFreeRecord(MESSAGE, program(stated('s1', 'live in', {subject: 'Maria', location: 'Cluj'}), stated('s2', 'work at', {subject: 'Maria', object: 'Bosch'})));
  assert.deepEqual([invented.invented_values, invented.marked_unparsed, invented.honesty_ratio, invented.invented_value_rate], [1, 0, 0, 0.25]);
  const neither = referenceFreeRecord(MESSAGE, stated('s1', 'live in', {subject: 'Maria', location: 'Cluj'}));
  assert.equal(neither.honesty_ratio, null);
  const offMessage = referenceFreeRecord(MESSAGE, program(stated('s1', 'live in', {subject: 'Maria', location: 'Cluj'}), '@u1 unparsed\n  span "something never said"\n'));
  assert.deepEqual([offMessage.unparsed_spans, offMessage.marked_unparsed], [1, 0]);
  // Romanian (normalized content words in the message's language) anchors like English.
  const ro = referenceFreeRecord('Maria merge la sala de sport.', stated('s1', 'merge la', {subject: 'Maria', destination: 'sala de sport'}));
  assert.equal(ro.invented_values, 0);
  const m = referenceFreeMetrics([honest, invented, neither, offMessage]);
  assert.deepEqual([m.invented_values, m.marked_unparsed, m.unparsed_spans], [1, 1, 2]);
  assert.equal(m.honesty_ratio.value, 0.5);
  assert.deepEqual([m.invented_value_rate.numerator, m.invented_value_rate.denominator], [1, 10]);
});

// ---------------------------------------------------------------- wild suite: tolerant accepted match
test('wild suite: the tolerant accepted match compares relation phrases and values through the dictionary', () => {
  const gold = query('q', 'work at', {subject: 'Maria', object: 'Acme'});
  const ro = scoreAgainstAccepted(query('q1', 'lucra la', {subject: 'Maria', object: 'Acme'}), [gold]);
  assert.deepEqual([ro.accepted_match, ro.accepted_match_tolerant], [0, 1]);
  const synonym = scoreAgainstAccepted(query('q', 'be employed by', {subject: 'Maria', object: 'Acme'}), [gold]);
  assert.deepEqual([synonym.accepted_match, synonym.accepted_match_tolerant], [0, 1]);
  const exact = scoreAgainstAccepted(gold, [gold]);
  assert.deepEqual([exact.accepted_match, exact.accepted_match_tolerant], [1, 1]);
  const wrong = scoreAgainstAccepted(query('q', 'hate', {subject: 'Maria', object: 'Acme'}), [gold]);
  assert.equal(wrong.accepted_match_tolerant, 0);
});
