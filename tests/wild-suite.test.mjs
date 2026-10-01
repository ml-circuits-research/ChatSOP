import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {auditSourceBoundary, INDEPENDENT_SUITES} from '../eval/leakage.mjs';
import {SUITE, questionType, scoreAgainstAccepted, targetProblems} from '../tools/eval/wild-suite.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const suiteFile = path.join(root, 'eval/suites', SUITE, 'test.jsonl');

test('the wild suite is learning material since 2026-09-30 (no independent suite is registered); the mechanism for an independent suite and the sealed-read guard stay', () => {
  assert.ok(!INDEPENDENT_SUITES.includes(SUITE), 'the owner decision of 2026-09-30 re-splits the legacy wild suite across train, dev and test');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wild-boundary-'));
  fs.mkdirSync(path.join(dir, 'tools/datasets'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'tools/datasets/build-clean.mjs'), 'export const x = 1;\n');
  assert.deepEqual(auditSourceBoundary(dir).violations, []);
  // A generator may name the legacy suite's archive parts, but never read an eval/suites test file.
  fs.writeFileSync(path.join(dir, 'tools/datasets/build-legacy.mjs'), `const archive = '${SUITE}';\n`);
  assert.deepEqual(auditSourceBoundary(dir).violations, [], 'naming the archive corpus is allowed');
  fs.writeFileSync(path.join(dir, 'tools/datasets/build-leaky.mjs'), `import answers from '../../eval/suites/${SUITE}/test.jsonl';\n`);
  assert.match(auditSourceBoundary(dir).violations.join('\n'), /forbidden sealed-answer import/);
  fs.rmSync(path.join(dir, 'tools/datasets/build-leaky.mjs'));
  // The mechanism for a genuinely independent suite still works when one is registered.
  fs.writeFileSync(path.join(dir, 'tools/datasets/build-naming.mjs'), "const inspiration = 'independent-fixture-v1';\n");
  fs.mkdirSync(path.join(dir, 'datasets', 'independent-fixture-v1'), {recursive: true});
  const violations = auditSourceBoundary(dir, {independentSuites: ['independent-fixture-v1']}).violations.join('\n');
  assert.match(violations, /build-naming\.mjs: generator\/training source names the independent sealed suite/);
  assert.match(violations, /must have no training or dev split/);
});

test('a prediction is credited for any accepted reading, and shape and decision are scored separately', () => {
  const yesNo = '@q query\n  where match\n    relation "be in"\n    role subject "the away match"\n    role location "Voluntari"\n    polarity affirmed\n  end';
  const select = '@q query\n  select ?place\n  where match\n    relation "be in"\n    role subject "the away match"\n    role location ?place\n    polarity affirmed\n  end';
  const renamed = select.replaceAll('?place', '?p');
  assert.equal(scoreAgainstAccepted(renamed, [yesNo, select]).accepted_match, 1);
  const otherWords = select.replace('"be in"', '"take place in"');
  const score = scoreAgainstAccepted(otherWords, [select]);
  assert.deepEqual([score.accepted_match, score.shape_match, score.decision_match], [0, 1, 1]);
  assert.equal(scoreAgainstAccepted('not sop', [select]).parsed, false);
  assert.equal(questionType(select), 'where');
  assert.equal(questionType(yesNo), 'yes_no');
});

test('model-surface problems are found in accepted targets', () => {
  assert.deepEqual(targetProblems('@u unclear\n  kind gibberish', 'asdf qwer', 'en'), []);
  assert.match(targetProblems('@s1 stated\n  relation "work at"\n  role subject "Maria"\n  polarity affirmed\n  certainty asserted', 'Is Ion here?', 'en')[0], /stated_value_not_in_message/);
});

test('the sealed wild suite validates in place', {skip: fs.existsSync(suiteFile) ? false : 'suite absent'}, () => {
  const result = spawnSync(process.execPath, [path.join(root, 'tools/eval/wild-suite.mjs'), '--check'], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /0 problems/);
});
