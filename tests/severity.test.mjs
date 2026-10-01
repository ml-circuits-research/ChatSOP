// Graded severity (DS016 "Graded severity (S0-S4, NONE)"): scale helpers, mechanical layer, analysis mapping, SOP comparer, simplifications and metrics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SEVERITIES, worst, rank, isGoodEnough} from '../lib/severity/scale.mjs';
import {mechanicalSeverity} from '../lib/severity/mechanical.mjs';
import {severityFromComparison} from '../lib/severity/analysis-map.mjs';
import {sopSeverity} from '../lib/severity/sop-compare.mjs';
import {stripLeadIns, stripTag, splitCoordinated, simplifications} from '../lib/severity/simplify.mjs';
import {wilson, summaryMetrics, confusion, distributionStats} from '../lib/severity/metrics.mjs';

test('scale order and helpers', () => {
  assert.deepEqual(SEVERITIES, ['S0', 'S1', 'S2', 'S3', 'S4', 'NONE']);
  assert.equal(worst('S1', 'S3', 'S2'), 'S3');
  assert.equal(worst('S2', 'NONE'), 'NONE');
  assert.ok(rank('S4') < rank('NONE'));
  assert.ok(isGoodEnough('S2') && !isGoodEnough('S3'));
});

test('mechanical layer: certain S4 flags and exact matches', () => {
  assert.equal(mechanicalSeverity('Did Ana go to Cluj?', 'did ana go to cluj').severity, 'S0');
  const neg = mechanicalSeverity('Ana does not work at Lidl.', 'Ana works at Lidl.');
  assert.equal(neg.severity, 'S4'); assert.ok(neg.flags.some(f => f.kind === 'negation_lost'));
  assert.equal(mechanicalSeverity('Ana lives in Cluj.', 'Ana lives in Sibiu.').severity, 'S4');
  assert.equal(mechanicalSeverity('Ana is 30 years old.', 'Ana is 31 years old.').severity, 'S4');
  assert.equal(mechanicalSeverity('Everyone got an answer.', 'Someone got an answer.').severity, 'S4');
  assert.equal(mechanicalSeverity('If Dan calls, the meeting stays.', 'Dan calls, so the meeting stays.').severity, 'S4');
  assert.equal(mechanicalSeverity('Ana says that Dan left.', 'Dan left.').severity, 'S4');
  assert.equal(mechanicalSeverity('Tomas was late because the bus broke down.', 'The bus broke down because Tomas was late.').severity, 'S4');
  assert.equal(mechanicalSeverity('The office is open.', 'The office is open. The budget was cut by 20 percent.').severity, 'S4');
  assert.equal(mechanicalSeverity('', 'x').decided, false);
  assert.equal(mechanicalSeverity('Hello there', '').severity, 'NONE');
  // a harmless rewrite is not decided as S4
  assert.equal(mechanicalSeverity('i woder if Priya works at Vertex Analytics .', 'I wonder if Priya works at Vertex Analytics.').decided, false);
  assert.equal(mechanicalSeverity('Verify the claim that Radu teaches chemistry.', 'Check whether Radu teaches chemistry.').decided, false);
});

test('analysis mapping: equivalent is S0, catastrophic checks decide S4, the rest stays in the residue', () => {
  assert.equal(severityFromComparison({verdict: 'equivalent', reasons: [], failedChecks: []}).severity, 'S0');
  const swap = severityFromComparison({verdict: 'different', failedChecks: ['roles'], reasons: ['roles: subject and object swapped for [manage: ana]']});
  assert.equal(swap.severity, 'S4'); assert.ok(swap.decided);
  const q = severityFromComparison({verdict: 'different', failedChecks: ['question'], reasons: ['question: a is wh who, b is yes/no']});
  assert.equal(q.decided, false);
  assert.equal(severityFromComparison({verdict: 'uncertain', reasons: ['tense_modality'], failedChecks: []}).decided, false);
  const lost = severityFromComparison({verdict: 'different', failedChecks: ['names'], reasons: ['names: only in a [cluj], only in b []']});
  assert.equal(lost.decided, false);
});

const wire = (id, kind, rel, roles, extra = '') => `@${id} ${kind}\n  relation "${rel}"\n${roles.map(([n, v]) => `  role ${n} "${v}"`).join('\n')}\n  polarity ${extra || 'affirmed'}\n  certainty asserted\n`;
test('SOP comparer: role order and passive voice are not differences; catastrophes are S4', () => {
  const gold = wire('s1', 'stated', 'rent', [['subject', 'Ana'], ['object', 'the van']]);
  assert.equal(sopSeverity(wire('s1', 'stated', 'rent', [['object', 'the van'], ['subject', 'Ana']]), gold, {message: 'Ana rents the van.'}).severity, 'S0');
  assert.equal(sopSeverity(wire('s1', 'stated', 'be rented by', [['subject', 'the van'], ['object', 'Ana']]), gold, {message: 'Ana rents the van.'}).severity, 'S0');
  assert.equal(sopSeverity(wire('s1', 'stated', 'rent', [['subject', 'the van'], ['object', 'Ana']]), gold, {message: 'Ana rents the van.'}).severity, 'S4');
  assert.equal(sopSeverity(wire('s1', 'stated', 'rent', [['subject', 'Ana'], ['object', 'the van']], 'negated'), gold, {message: 'Ana rents the van.'}).severity, 'S4');
  assert.equal(sopSeverity(wire('s1', 'stated', 'rent', [['subject', 'Dan'], ['object', 'the van']]), gold, {message: 'Ana rents the van.'}).severity, 'S4');
  assert.equal(sopSeverity(wire('s1', 'stated', 'rent', [['subject', 'Ana'], ['object', 'the red van']]), gold, {message: 'Ana rents the red van.'}).severity, 'S2');
  assert.equal(sopSeverity('', gold, {message: 'Ana rents the van.'}).severity, 'NONE');
  assert.equal(sopSeverity('@u unclear\n  kind no_request\n', gold, {message: 'Ana rents the van.'}).severity, 'NONE');
});

test('simplifications drop lead-ins and tags and split coordinated questions', () => {
  assert.equal(stripLeadIns('Honestly, who owns the van?'), 'Who owns the van?');
  assert.equal(stripTag('Ana lives in Iasi, right?'), 'Ana lives in Iasi?');
  assert.equal(splitCoordinated('Does Ana teach maths and does she visit Cluj?'), 'Does Ana teach maths? Does she visit Cluj?');
  assert.equal(splitCoordinated('Ana and Dan live in Cluj.'), null);
  assert.ok(simplifications('Honestly, who owns the van?', ['Honestly, who owns the van?']).some(c => c.text === 'Who owns the van?'));
});

test('metrics: Wilson, S4 recall and false-S4 rate, distribution shares', () => {
  const w = wilson(50, 100); assert.ok(w.lo < 0.5 && w.hi > 0.5);
  const pairs = [{gold: 'S4', pred: 'S4'}, {gold: 'S4', pred: 'S2'}, {gold: 'S3', pred: 'S4'}, {gold: 'S0', pred: 'S0'}];
  const m = summaryMetrics(pairs);
  assert.equal(m.s4_recall.rate, 0.5); assert.equal(m.false_s4.k, 1); assert.equal(m.s4_missed_as_good.k, 1);
  assert.equal(confusion(pairs).S4.S2, 1);
  const d = distributionStats(['S0', 'S1', 'S4', 'NONE']);
  assert.equal(d.good_enough.k, 2); assert.equal(d.catastrophic.k, 1); assert.equal(d.none.k, 1);
});
