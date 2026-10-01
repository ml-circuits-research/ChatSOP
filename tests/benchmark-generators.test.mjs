import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {benchmarkCase, BENCHMARK_FAMILIES} from '../tools/datasets/diversity/benchmark-families.mjs';
import {worldMultihop} from '../tools/datasets/diversity/benchmark-world.mjs';
import {checkLocal, scaleConfigs} from '../tools/datasets/diversity/build-benchmark.mjs';
import {overlapOf} from '../tools/datasets/audit/content-word-overlap.mjs';

const checked = (family, index) => checkLocal(benchmarkCase(family, index));
const worldAvailable = [process.env.QF_CHAT_ROOT, 'datasets_sources/query-forms/chat_data2', 'datasets_sources/query-forms/chat_data', 'chat_data'].filter(Boolean).some(root => existsSync(path.join(root, 'base_memories/world-v1/circuits')));
test('construction and oracle agree across all families and edge variants', () => {
  for (const family of BENCHMARK_FAMILIES) for (let index = 0; index < 10; index++) checked(family, index);
});
test('closed-world absence differs from missing open-world evidence', () => {
  assert.equal(checked('f3', 2).expected.status, 'supported');
  assert.equal(checked('f3', 1).expected.status, 'unknown');
  assert.equal(checked('f3', 0).expected.status, 'refuted');
  const bound = checked('f3', 3);
  assert.equal(bound.expected.bound, 'at_least');
  assert.equal(bound.expected.count, 2);
  assert.deepEqual(bound.expected.warnings, ['count_needs_closed']);
});
test('constraint construction catches impossible assignment and temporal missing day', () => {
  assert.equal(checked('f5', 4).expected.status, 'inconsistent');
  assert.equal(checked('f5', 0).expected.status, 'possible');
  assert.equal(checked('f6', 0).expected.status, 'unknown');
  assert.equal(checked('f6', 2).expected.status, 'supported');
});
test('numeric rank preserves every tied maximum, not just the first row', () => {
  const rank = checked('f2', 4);
  assert.equal(rank.expected.rows.length, 2);
  const broken = benchmarkCase('f2', 4);
  broken.expected.rows.pop();
  assert.throws(() => checkLocal(broken), /construction disagrees with oracle/);
});
test('grouped aggregate excludes the other department', () => {
  const grouped = checked('f2', 5);
  const global = [...grouped.knowledge.matchAll(/^\s+holds compensation \S+ (\d+)$/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
  assert.ok(global > grouped.expected.rows[0].total);
  const broken = benchmarkCase('f2', 5);
  broken.expected.rows[0].total = global;
  assert.throws(() => checkLocal(broken), /construction disagrees with oracle/);
});
test('construction gold cannot be silently replaced with contradictory oracle-only gold', () => {
  const c = benchmarkCase('f2', 0);
  c.expected.count++;
  assert.throws(() => checkLocal(c), /construction disagrees with oracle/);
  const gap = benchmarkCase('f6', 0);
  gap.expected.status = 'supported';
  assert.throws(() => checkLocal(gap), /construction disagrees with oracle/);
});
test('preview and dev draw disjoint generated identity names', () => {
  for (const family of BENCHMARK_FAMILIES) {
    const a = benchmarkCase(family, 2), b = benchmarkCase(family, 2, {split: 'preview'});
    assert.notEqual(a.question, b.question);
    assert.match(a.question, /dev_\d+/);
    assert.match(b.question, /preview_\d+/);
  }
});
test('author vocabulary includes named unobserved entities without leaking answer entities', () => {
  const absent = benchmarkCase('f3', 2);
  const name = absent.question.match(/\b[\p{L}\p{N}]+_dev_\d+\b/u)[0];
  assert.match(absent.knowledge, new RegExp(`@${name} entity`));
  const rank = benchmarkCase('f2', 4);
  assert.match(rank.knowledge, /@firm_[^\n]+ entity/);
  for (const answer of rank.expected.rows) assert.ok(!rank.knowledge.includes(`@${answer.p} entity`));
  const cut = benchmarkCase('f4', 0);
  const target = cut.query.match(/where reached ([^\s]+)/)[1];
  assert.ok(cut.knowledge.includes(`@${target} entity`));
});
test('F1 source consists of actual world-v1 joins at depths 2–4', {skip: !worldAvailable}, async () => {
  const dev = await worldMultihop({split: 'dev'}), preview = await worldMultihop({split: 'preview'});
  assert.ok(dev.length >= 100 && preview.length >= 100);
  assert.equal(dev[0].base_memory, 'world-v1');
  assert.equal(dev[0].facts, 357515);
  assert.deepEqual(dev.slice(0, 3).map(c => c.depth), [2, 3, 4]);
  assert.ok(!new Set(dev.slice(0, 100).map(row => row.construction.person)).has(preview[0].construction.person));
  checkLocal(dev[0]);
});
test('generated heldout forms share no substantial content-word overlap with dev', async () => {
  const worldDev = worldAvailable ? await worldMultihop({split: 'dev'}) : [], worldPreview = worldAvailable ? await worldMultihop({split: 'preview'}) : [];
  const row = c => ({id: c.id ?? c.question, message: c.question, dataset: 'benchmark', source: {family: c.family}});
  for (const family of [...(worldAvailable ? ['f1'] : []), ...BENCHMARK_FAMILIES]) {
    const cases = split => Array.from({length: 100}, (_, i) => family === 'f1' ? (split === 'dev' ? worldDev : worldPreview)[i] : benchmarkCase(family, i, {split})).map(row);
    const report = overlapOf(cases('preview'), cases('dev'));
    assert.equal(report.content_words.largely_contained_same_form, 0, family);
    assert.equal(report.lexical_duplicates.count, 0, family);
    assert.equal(report.exact_duplicates.same_dataset, 0, family);
  }
});
test('million fact scale configurations are honest unmaterialized cells', () => {
  assert.deepEqual(scaleConfigs.map(x => x.facts), [1e3, 1e4, 1e5, 1e6]);
  assert.equal(scaleConfigs[3].generated, false);
});
