import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {listen, readJson, repoPath, tempDir} from './helpers.mjs';

// eval/verbalizer.mjs is a smoke evaluation: it may flag numbers the model
// invented, but it never claims accuracy or semantic faithfulness.
const script = repoPath('eval/verbalizer.mjs');
const rows = [
  {id: 'v1', case: 'supported', prompt: 'P1', cnl: 'ANSWER 3 items by 2026', target: 'Three items.'},
  {id: 'v2', case: 'unknown', prompt: 'P2', cnl: 'UNKNOWN 7', target: 'Unknown.'},
  {id: 'v3', case: 'refuted', prompt: 'P3', cnl: 'REFUTED', target: 'No.'},
];

function evaluate(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {cwd, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', part => stdout += part);
    child.stderr.on('data', part => stderr += part);
    child.on('error', reject);
    child.on('close', status => resolve({status, stdout, stderr}));
  });
}

function fixture(t) {
  const directory = tempDir(t, 'verbalizer-eval-');
  const file = path.join(directory, 'rows.jsonl');
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return {directory, file, out: path.join(directory, 'report.json')};
}

test('dry run counts rows without attempting a model or claiming accuracy', async t => {
  const {directory, file, out} = fixture(t);
  const result = await evaluate(['--dry-run', '--file', file, '--out', out], directory);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(out), {role: 'verbalizer', rows: 3, attempted: 0, requests_succeeded: 0, evaluated_rows: 0, neuralModelTested: false, accuracy: null, requiresHumanFaithfulnessReview: true});
});

test('a live run flags invented numbers, records failed requests and still reports no accuracy', async t => {
  const replies = {P1: 'Three items (3) by 2026, plus 5 more.', P2: 'Unknown, 7.'};
  const prompts = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const prompt = JSON.parse(raw).messages[0].content;
    prompts.push(prompt);
    if (!replies[prompt]) { res.writeHead(500); res.end('model failure'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: replies[prompt]}, finish_reason: 'stop'}]}));
  });
  const base = await listen(t, server);
  const {directory, file, out} = fixture(t);
  const config = path.join(directory, 'runtime.json');
  fs.writeFileSync(config, JSON.stringify({verbalizer: {url: base + '/v1/chat/completions', model: 'mock'}}));
  const result = await evaluate(['--file', file, '--out', out, '--config', config], directory);
  assert.equal(result.status, 0, result.stderr);
  const report = readJson(out);
  assert.deepEqual(prompts, ['P1', 'P2', 'P3']);
  assert.equal(report.rows, 3);
  assert.equal(report.attempted, 3);
  assert.equal(report.requests_succeeded, 2);
  assert.equal(report.evaluated_rows, 2);
  assert.equal(report.neuralModelTested, true);
  assert.equal(report.accuracy, null);
  assert.equal(report.requiresHumanFaithfulnessReview, true);
  const byId = Object.fromEntries(report.details.map(detail => [detail.id, detail]));
  assert.deepEqual(byId.v1.newNumbers, ['5'], 'only the number absent from the CNL is flagged');
  assert.deepEqual(byId.v2.newNumbers, []);
  assert.equal(byId.v3.valid, false);
  assert.match(byId.v3.error, /Model endpoint returned 500/);
});

test('a live run without a configured verbalizer endpoint fails before any request', async t => {
  const {directory, file, out} = fixture(t);
  const config = path.join(directory, 'runtime.json');
  fs.writeFileSync(config, JSON.stringify({}));
  const result = await evaluate(['--file', file, '--out', out, '--config', config], directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Verbalizer endpoint URL and model are required/);
  assert.equal(fs.existsSync(out), false);
});
