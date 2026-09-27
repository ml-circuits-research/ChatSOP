import test from 'node:test';
import assert from 'node:assert/strict';
import { convertTheory, sourceOracle } from '../tools/datasets/converters/proofwriter.mjs';
import { scaffold } from '../tools/datasets/import-squad.mjs';

// Test-only invented theory, never presented as ProofWriter source data.
const atom = (subject, object, polarity = '+') => ({ subject, relation: 'is', object, polarity });
const theory = () => ({
  id: 'Synthetic-OWA-D2-test', depth: 2, family: 'AttNeg',
  theory_text: 'Ada is blue. Ada is not round. All blue people are bright. If someone is bright and not round then they are not quiet.',
  facts: [
    { id: 'triple1', text: 'Ada is blue.', ...atom('Ada', 'blue') },
    { id: 'triple2', text: 'Ada is not round.', ...atom('Ada', 'round', '-') }
  ],
  rules: [
    { id: 'rule1', text: 'All blue people are bright.', premises: [atom('someone', 'blue')], conclusion: atom('someone', 'bright') },
    { id: 'rule2', text: 'If someone is bright and not round then they are not quiet.', premises: [atom('someone', 'bright'), atom('someone', 'round', '~')], conclusion: atom('someone', 'quiet', '-') }
  ],
  questions: [
    { id: 'Q1', text: 'Ada is bright.', query: atom('Ada', 'bright'), answer: 'True', qdep: 1, qlen: 2, proofs: 'source proof', proof_graph: [], strategy: 'proof' },
    { id: 'Q2', text: 'Ada is quiet.', query: atom('Ada', 'quiet'), answer: 'False', qdep: 2, qlen: 3, proofs: 'source proof', proof_graph: [], strategy: 'inv-proof' },
    { id: 'Q3', text: 'Ada is not tall.', query: atom('Ada', 'tall', '-'), answer: 'Unknown', qdep: 0, qlen: -1, proofs: '', proof_graph: [], strategy: 'random' }
  ]
});
const provenance = { revision: 'pinned-sha', uri: 'source://synthetic-test', sha256: 'a'.repeat(64), license: null };

test('OWA supports proof depth, explicit negative premises, false and unknown without CWA', () => {
  const result = convertTheory(theory(), provenance);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.rows.map(row => row.expected.status), ['supported', 'refuted', 'unknown']);
  assert.match(result.rows[1].setup_sop, /when not attribute_[a-z0-9_]+ \?x\b/);
  assert.match(result.rows[1].setup_sop, /then not attribute_[a-z0-9_]+ \?x\b/);
  assert.equal(result.rows[2].source.qlen, -1);
  assert.equal(result.rows[0].source.original_question, 'Ada is bright.');
  assert.equal(result.rows[0].context_assertions.length, 0);
  assert.equal(result.rows[0].input_mode, 'query_only');
  assert.doesNotMatch(result.rows[0].sop_target, /source_knowledge|@.* rule|@.* fact/);
});

test('bad source labels and contradictory theories are rejected rather than reassigned', () => {
  const incorrect = theory(); incorrect.questions[0].answer = 'False';
  const result = convertTheory(incorrect, provenance);
  assert.equal(result.rows.length, 2);
  assert.match(result.rejected[0].reason, /^source_oracle_mismatch/);
  const conflicting = theory(); conflicting.facts.push({ id: 'triple3', text: 'Ada is not bright.', ...atom('Ada', 'bright', '-') });
  const conflict = convertTheory(conflicting, provenance);
  assert.match(conflict.rejected.find(q => q.question === 'Q1').reason, /contradictory_owa_theory/);
  assert.equal(sourceOracle(theory(), atom('Ada', 'tall')), 'unknown');
});

test('CWA and unsupported formal query shapes cannot be silently converted', () => {
  const cwa = theory(); cwa.id = 'Synthetic-CWA-D2-test';
  assert.throws(() => convertTheory(cwa, provenance), /not_owa/);
  const bad = theory(); bad.questions[0].query = atom('someone', 'bright');
  const result = convertTheory(bad, provenance);
  assert.match(result.rejected[0].reason, /unsupported_query_atom/);
  assert.equal(result.rows.length, 2);
});

test('licensed passage scaffold retains source spans without manufacturing SOP gold', () => {
  const rows = scaffold({ version: 'v2.0', data: [{ title: 'Sample', paragraphs: [{ context: 'A blue sky.', qas: [{ id: 'q1', question: 'What color?', answers: [{ text: 'blue', answer_start: 2 }], is_impossible: false }] }] }] }, { sha256: 'b'.repeat(64), limit: 1 });
  assert.equal(rows[0].context_text, 'A blue sky.');
  assert.deepEqual(rows[0].answer_spans, [{ text: 'blue', answer_start: 2 }]);
  assert.equal(rows[0].sop_target, null);
  assert.equal(rows[0].semantic_status, 'pending_independent_semantic_mapping');
});
