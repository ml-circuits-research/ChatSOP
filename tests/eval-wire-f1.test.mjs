import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWires, rowWireComparison, wireMetrics } from '../eval/metrics.mjs';

// Partial-credit wire match (DS016 "Wire F1"): order- and id-free, folded strings, renamed variables.
const gold = [
  '@s1 stated\n  relation "work at"\n  role subject "Ana"\n  role object "Orion Robotics"\n  polarity affirmed\n  certainty asserted',
  '@s2 stated\n  relation "live in"\n  role subject "Ion"\n  role location "Cluj"\n  polarity negated\n  certainty asserted',
  '@q query\n  select ?who\n  where match\n    relation "work at"\n    role subject ?who\n    role object "Orion Robotics"\n    polarity affirmed\n  end',
].join('\n\n');

test('a reordered prediction with other ids, variable names, case and diacritics matches every wire', () => {
  const predicted = [
    '@q1 query\n  select ?x\n  where match\n    relation "Work at"\n    role subject ?x\n    role object "orion robotics"\n    polarity affirmed\n  end',
    '@a stated\n  relation "live in"\n  role subject "Ion"\n  role location "Clúj"\n  polarity negated\n  certainty hedged',
    '@b stated\n  relation "work at"\n  role subject "Ana"\n  role object "Orion Robotics"\n  polarity affirmed\n  certainty asserted',
  ].join('\n\n');
  const c = compareWires(gold, predicted);
  assert.deepEqual([c.gold, c.predicted, c.matched, c.f1, c.problems_correct], [3, 3, 3, 1, true]);
});

test('a wrong polarity, an extra statement and a truncated final wire earn partial credit', () => {
  const predicted = [
    '@s1 stated\n  relation "work at"\n  role subject "Ana"\n  role object "Orion Robotics"\n  polarity affirmed\n  certainty asserted',
    '@s2 stated\n  relation "live in"\n  role subject "Ion"\n  role location "Cluj"\n  polarity affirmed\n  certainty asserted',
    '@s3 stated\n  relation "buy"\n  role subject "the user"\n  role object "groceries"\n  polarity affirmed\n  certainty asserted',
    '@q query\n  select ?who\n  where match\n    relation "work at"',
  ].join('\n\n');
  const c = compareWires(gold, predicted);
  assert.deepEqual([c.gold, c.predicted, c.matched, c.unparsable, c.problems_correct], [3, 4, 1, 1, false]);
  assert.equal(c.f1, 2 / 7);
  assert.deepEqual(c.statements, { gold: 2, predicted: 3, matched: 1 });
});

test('aggregation reports micro precision/recall, rows at F1 >= 0.9 and query-part correctness; accepted golds count', () => {
  const row = { sop_target: gold, sop_targets_accepted: [gold.replace('"Cluj"', '"Cluj-Napoca"')] };
  const accepted = rowWireComparison(row, gold.replace('"Cluj"', '"Cluj-Napoca"'));
  assert.equal(accepted.f1, 1);
  const metrics = wireMetrics([accepted, compareWires(gold, 'not SOP'), compareWires(gold, undefined)]);
  assert.deepEqual(metrics.recall, { numerator: 3, denominator: 9, value: 1 / 3 });
  assert.deepEqual(metrics.precision, { numerator: 3, denominator: 4, value: 3 / 4 });
  assert.deepEqual(metrics.rows_f1_at_least_0_9, { numerator: 1, denominator: 3, value: 1 / 3 });
  assert.deepEqual(metrics.problems_correct, { numerator: 1, denominator: 3, value: 1 / 3 });
  assert.equal(metrics.unparsable_wires, 1); // non-SOP text is one unparsable wire; a missing prediction has none
});
