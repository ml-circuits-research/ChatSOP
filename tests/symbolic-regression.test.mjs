/** Regression runner of symbolic_english (tools/symbolic-regression.mjs, DS008 "Three datasets"): the same classification
 * the full run applies, on a small fixed sample replayed from recorded Stanza parses (tests/fixtures/symbolic-english/),
 * so no Python is needed. The full run over every row needs Stanza and is a tool, not a unit test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {replayLm, runRows, compareRows} from '../tools/symbolic-regression.mjs';
import {repoPath, tempDir} from './helpers.mjs';

const FIXTURE = repoPath('tests/fixtures/symbolic-english/sample.json');
const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;
const options = {route: 'direct', language: 'en'};
const rerun = async rows => { const results = await runRows(rows, replayLm(fixture.parses), options); return {results, ...(await compareRows(rows, results, {rescoreGold: false}))}; };

test('a fixed sample replays to the stored analysis and SOP: every row is `same`', {skip: !fixture && 'no fixture'}, async () => {
  assert.ok(fixture.rows.length >= 8);
  const {counts, failing} = await rerun(fixture.rows);
  assert.equal(counts.same, fixture.rows.length);
  assert.equal(failing, false);
  for (const row of fixture.rows) {
    assert.equal(row.analysis_verified, 'gold_sop_match');
    assert.ok(row.analysis.sentences.length > 0 && row.sop_valid);
  }
});

test('a changed baseline SOP, a changed parse and a failing row are classified and fail the run when they should', {skip: !fixture && 'no fixture'}, async () => {
  const rows = structuredClone(fixture.rows);
  rows[0].sop += '  # changed\n';
  rows[1].analysis.sentences[0].tokens[0][3] = 'X';
  rows[2].unparsed = [];
  const parses = structuredClone(fixture.parses);
  const {classes, counts, failing} = await (async () => {
    const results = await runRows(rows, replayLm(parses), options);
    return {results, ...(await compareRows(rows, results, {rescoreGold: false}))};
  })();
  assert.equal(classes.get(rows[0].id), 'sop_changed');
  assert.equal(classes.get(rows[1].id), 'analysis_changed_sop_same');
  assert.equal(counts.sop_changed, 1);
  assert.equal(failing, true, 'sop_changed fails the run');
  // A row the current SymbolicLM cannot handle at all (no recorded parse: the analysis crashes) is now_failing.
  const broken = await runRows([rows[3]], replayLm({}), options);
  assert.equal((await compareRows([rows[3]], broken, {rescoreGold: false})).classes.get(rows[3].id), 'now_failing');
});

test('the CLI replays the fixture, exits 0 when nothing changed and 1 on a regression', {skip: !fixture && 'no fixture'}, t => {
  const dir = tempDir(t, 'symbolic-regression-');
  const run = file => spawnSync(process.execPath, [repoPath('tools/symbolic-regression.mjs'), '--replay', file, '--report', path.join(dir, 'report.json')], {encoding: 'utf8', cwd: repoPath('.')});
  const same = run(FIXTURE);
  assert.equal(same.status, 0, same.stderr + same.stdout);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')).counts.same, fixture.rows.length);
  // A regression: SymbolicLM can no longer analyse the first row (its recorded parse is removed, the call fails).
  const mutated = structuredClone(fixture);
  const first = Object.keys(mutated.parses).find(key => key.endsWith(mutated.rows[0].message) || key.includes(mutated.rows[0].message.slice(0, 12)));
  assert.ok(first, 'the fixture has a parse for the first row');
  delete mutated.parses[first];
  const file = path.join(dir, 'mutated.json');
  fs.writeFileSync(file, JSON.stringify(mutated));
  const changed = run(file);
  assert.equal(changed.status, 1, changed.stdout);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')).counts.now_failing, 1);
});
