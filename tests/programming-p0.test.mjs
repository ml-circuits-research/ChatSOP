// Programming path, milestone P0 (experiments/proposal/programming-kb-plan.md): the `test` and `code` wires, the code-sandbox strategy and its
// containment, the `code` presentation of llm-agent, the host loop with repair and episodes, the sealed suite and the sealed-test guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {codeSandbox} from '../reasoning/strategies/code-sandbox/index.mjs';
import {llmAgent} from '../reasoning/strategies/llm-agent/index.mjs';
import {codePrompt, parseCodeAnswer} from '../reasoning/strategies/llm-agent/code.mjs';
import {DreamStore} from '../reasoning/strategies/dreaming-session/records.mjs';
import {solveInstruction, validateTaskCircuit} from '../lib/programming/solve-instruction.mjs';
import {validateProgram} from '../sop/knowledge/index.mjs';
import {auditSealedTests} from '../eval/leakage.mjs';
import {TASKS, verifyReferences} from '../tools/eval/build-code-instructions-v1.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ask = (body, tests, budget = {wallMs: 5000, perTestMs: 800}, entry = 'f') => codeSandbox.ask({code: {entry, body}, tests}, budget);
const T = [{id: 't1', call: 'f([1, 2, 2, 3])', expect: '2'}];

test('the sandbox answers verified, failed, budget_exhausted and not_computable honestly', async () => {
  const ok = await ask('export function f(xs) { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0][0]; }', T);
  assert.equal(ok.status, 'verified');
  assert.equal(ok.guarantee, 'bounded');
  assert.equal(ok.exact, false);
  assert.deepEqual(ok.trace.slice(0, 2), ['run r1', 'in_elem r1 1']);
  assert.ok(ok.trace.includes('out_elem r1 2') && ok.trace.includes('test_result r1 t1 passed'));
  const bad = await ask('function f(xs) { return xs[0]; }', T);
  assert.equal(bad.status, 'failed');
  assert.deepEqual(bad.failures.map(x => [x.id, x.expected, x.actual]), [['t1', '2', '1']]);
  const none = await codeSandbox.ask({code: {entry: 'f', body: 'function f() {}'}, tests: []});
  assert.equal(none.status, 'not_computable');
  assert.equal(none.reason, 'no_tests');
});

test('structural comparison: key order, NaN, undefined versus null, Map and Set', async () => {
  const r = await ask('function f() { return {b: [1, {y: 2, x: 1}], a: NaN, s: new Set([2, 1]), m: new Map([["k", undefined]])}; }', [
    {id: 'a', call: 'f()', expect: '({a: NaN, b: [1, {x: 1, y: 2}], m: new Map([["k", undefined]]), s: new Set([1, 2])})'},
    {id: 'b', call: '(() => null)()', expect: 'null'}]);
  assert.equal(r.status, 'verified');
  const n = await ask('function f() { return null; }', [{id: 'a', call: 'f()', expect: 'undefined'}]);
  assert.equal(n.status, 'failed');
});

test('the sandbox contains require, process, fetch, a constructor escape, imports, loops, blocking waits and memory exhaustion', async () => {
  const attempts = {
    require: 'function f() { return require("fs").readFileSync("/etc/passwd", "utf8"); }',
    process: 'function f() { process.exit(3); }',
    fetch: 'function f() { return fetch("http://127.0.0.1:1/"); }',
    escape: 'function f() { return this.constructor.constructor("return process")().pid; }',
    staticImport: 'import fs from "fs"; function f() { return 1; }',
    globalThis: 'function f() { return typeof globalThis.process + typeof globalThis.require; }'
  };
  for (const [name, body] of Object.entries(attempts)) {
    const r = await ask(body, [{id: 't1', call: 'f()', expect: '"never"'}]);
    assert.equal(r.status, 'failed', name);
    assert.ok(!JSON.stringify(r).includes('/etc/passwd') && !JSON.stringify(r).includes('root:'), name + ' read nothing');
    if (name === 'globalThis') assert.equal(r.failures[0].actual, '"undefinedundefined"');
    else assert.ok(r.failures[0].error || r.failures[0].actual, name);
  }
  for (const [what, body, reason] of [
    ['an infinite loop', 'function f() { while (true) {} }', 'wall'],
    ['a blocking wait', 'function f() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }', 'wall'],
    ['unbounded allocation', 'function f() { const k = []; while (true) k.push(new Array(1000000).fill(1)); }', 'memory']
  ]) {
    const r = await ask(body, [{id: 't1', call: 'f()', expect: '1'}]);
    assert.equal(r.status, 'budget_exhausted', what);
    assert.equal(r.reason, reason, what);
    assert.equal(r.complete, false);
  }
  // the parent process is alive and unchanged
  assert.equal(typeof process.pid, 'number');
  assert.equal((await ask('function f() { return 1; }', [{id: 't1', call: 'f()', expect: '1'}])).status, 'verified');
});

test('a program cannot change the expected value it is compared with', async () => {
  const r = await ask('Object.prototype.toString = () => "[object Map]"; JSON.stringify = () => "x"; Array.isArray = () => true; function f() { return 5; }', [{id: 't1', call: 'f()', expect: '6'}]);
  assert.equal(r.status, 'failed');
});

test('test and code wires: parser rules, sealed refusal and the model boundary', () => {
  const code = '@c1 code\n  of t1\n  language javascript\n  entry f\n  body "function f() { return 1; }"\n  produced_by llm-agent\n';
  const ok = validateProgram([{name: 'a', text: code + '@e1 test\n  of t1\n  call "f()"\n  expect "1"\n  kind example\n', role: 'knowledge'}], {authoring: true});
  assert.deepEqual(ok.problems.filter(p => p.severity !== 'warning'), []);
  const sealed = '@e1 test\n  of t1\n  call "f()"\n  expect "1"\n  kind sealed\n';
  assert.ok(validateProgram([{name: 'a', text: sealed, role: 'knowledge'}]).problems.some(p => p.code === 'sealed_test_in_knowledge'));
  assert.ok(validateProgram([{name: 'a', text: sealed, role: 'query'}]).problems.some(p => p.code === 'sealed_test_in_knowledge'));
  assert.ok(!validateProgram([{name: 'a', text: sealed, role: 'knowledge'}], {allowSealed: true}).problems.some(p => p.code === 'sealed_test_in_knowledge'));
  const codes = text => validateProgram([{name: 'a', text, role: 'knowledge'}]).problems.map(p => p.code);
  assert.ok(codes(code.replace('language javascript', 'language python')).includes('bad_enum'));
  assert.ok(codes(code.replace('entry f', 'entry g')).includes('code_entry_not_defined'));
  assert.ok(codes(code.replace(/body ".*"/, 'body function f() {}')).includes('bad_value'));
  assert.ok(codes('@e1 test\n  of t1\n  call "f()"\n  kind example\n').includes('missing_field'));
  assert.ok(codes('@e1 test\n  of t1\n  call f()\n  expect "1"\n').includes('bad_value'));
});

test('the sealed-test guard: no sealed test outside eval/suites, no suite read in the host loop or the proposer', () => {
  assert.deepEqual(auditSealedTests(root).violations, []);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-sealed-'));
  try {
    fs.mkdirSync(path.join(temp, 'config'), {recursive: true});
    fs.mkdirSync(path.join(temp, 'lib/programming'), {recursive: true});
    fs.writeFileSync(path.join(temp, 'config/k.sop'), '@e1 test\n  of t1\n  call "f()"\n  expect "1"\n  kind sealed\n');
    fs.writeFileSync(path.join(temp, 'lib/programming/loop.mjs'), "import fs from 'node:fs';\nfs.readFileSync('eval/suites/code-instructions-v1/test.jsonl');\n");
    const v = auditSealedTests(temp).violations;
    assert.ok(v.some(m => m.includes('config/k.sop')));
    assert.ok(v.some(m => m.includes('lib/programming/loop.mjs')));
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});

const taskSop = (family = 'last_element') => `@a1 fact\n  holds task_kind t1 ${family}\n  source "the instruction"\n@a2 test\n  of t1\n  call "lastElement([4, 5, 6])"\n  expect "6"\n  kind example\n`;
const candidate = body => `@a3 code\n  of t1\n  language javascript\n  entry lastElement\n  body ${JSON.stringify(body)}\n  produced_by llm-agent\n  version 1\n`;
const task = {id: 't1', key: 'unit-1', entry: 'lastElement', instruction: 'Write lastElement(xs) that returns the last element of xs.', examples: [{call: 'lastElement([1, 2])', expect: '2'}]};
const scripted = bodies => { let n = 0; const prompts = []; return {prompts, propose: async ({repair}) => { prompts.push(repair?.report ?? null); const b = bodies[Math.min(n++, bodies.length - 1)]; return b === null ? {status: 'error', reason: 'malformed_output', detail: 'no block'} : {status: 'proposed', files: {'task.sop': taskSop(), 'candidate.sop': candidate(b)}, llm: {model: 'mock', cost: 0, paid: false}}; }}; };

test('the host loop: first try, repair with the failing test, failure types, the paid cap, and an episode for every run', async () => {
  const good = 'function lastElement(xs) { return xs[xs.length - 1]; }', bad = 'function lastElement(xs) { return xs[0]; }';
  const store = new DreamStore();
  const first = await solveInstruction(task, {propose: scripted([good]).propose, store, keepTask: true});
  assert.equal(first.status, 'verified');
  assert.equal(first.solved_on, 'first_try');
  assert.equal(first.route, 'proposer');
  assert.equal(first.guarantee, 'bounded');
  assert.equal(first.family, 'last_element');
  const s2 = scripted([bad, good]);
  const repaired = await solveInstruction(task, {propose: s2.propose, store});
  assert.equal(repaired.solved_on, 'after_repair');
  assert.equal(repaired.rounds, 1);
  assert.match(s2.prompts[1], /test ex1_given \(an example of the instruction/);
  assert.match(s2.prompts[1], /returned 1, expected 2/);
  const failed = await solveInstruction(task, {propose: scripted([bad]).propose, store, maxRounds: 3});
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure_type, 'wrong_output');
  assert.equal(failed.rounds, 3);
  const loop = await solveInstruction(task, {propose: scripted(['function lastElement(xs) { while (true) {} }']).propose, store, maxRounds: 1, budget: {perTestMs: 200, wallMs: 3000}});
  assert.equal(loop.status, 'budget_exhausted');
  assert.equal(loop.failure_type, 'timeout');
  const garbled = await solveInstruction(task, {propose: scripted([null]).propose, store, maxRounds: 1});
  assert.equal(garbled.failure_type, 'malformed_output');
  const capped = await solveInstruction(task, {propose: async () => ({status: 'proposed', files: {'task.sop': taskSop(), 'candidate.sop': candidate('function lastElement(xs) { return 0; }')}, llm: {model: 'paid/x', cost: 3, paid: true}}), store, maxPaidUsd: 5, maxRounds: 3});
  assert.equal(capped.status, 'budget_exhausted');
  assert.equal(capped.failure_type, 'cost_cap');
  assert.ok(capped.cost.paid_usd >= 5);
  assert.equal(store.episodes.length, 6);
  assert.ok(store.episodes.every(e => e.route === 'proposer' && e.schema === 'code-p0' && !('instruction' in e) && !('candidate' in e)));
  assert.equal(store.tasks['unit-1'].solved, true);
});

test('the task circuit is validated: sealed tests, missing tests, wrong entry and a misplaced wire are refused', () => {
  const files = (taskText, cand) => ({'task.sop': taskText, 'candidate.sop': cand});
  const body = 'function lastElement(xs) { return xs[xs.length - 1]; }';
  assert.equal(validateTaskCircuit(files(taskSop(), candidate(body)), task).ok, true);
  assert.ok(validateTaskCircuit(files(taskSop().replace('kind example', 'kind sealed'), candidate(body)), task).problems.some(p => p.includes('sealed_test_in_knowledge')));
  assert.ok(validateTaskCircuit(files('@a1 fact\n  holds task_kind t1 x\n  source "s"\n', candidate(body)), task).problems.some(p => p.includes('no test wire')));
  assert.ok(validateTaskCircuit(files(taskSop(), candidate(body).replace('entry lastElement', 'entry other')), task).problems.some(p => p.includes('entry must be lastElement')));
  assert.ok(validateTaskCircuit(files(taskSop() + candidate(body).replace('@a3', '@a4'), candidate(body)), task).problems.some(p => p.includes('belongs in candidate.sop')));
});

test('llm-agent code presentation: the prompt carries the instruction and the visible examples, the reply is parsed strictly, a repair carries the report', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-code-'));
  try {
    const seen = [];
    const reply = '```task.sop\n' + taskSop() + '```\n\n```candidate.sop\n' + candidate('function lastElement(xs) { return xs[xs.length - 1]; }') + '```\n';
    const run = async ({prompt, system}) => { seen.push({prompt, system}); return {ok: true, text: 'thinking...\n' + reply, cost: 0}; };
    const packet = await llmAgent.ask({task}, {}, {presentation: 'code', run, cacheDir: dir, model: 'xai-oauth/test', fallbackModels: []});
    assert.equal(packet.status, 'proposed');
    assert.deepEqual(Object.keys(packet.files), ['task.sop', 'candidate.sop']);
    assert.ok(seen[0].prompt.includes('Write lastElement(xs)') && seen[0].prompt.includes('lastElement([1, 2])  ->  2'));
    assert.ok(!/hidden/i.test(codePrompt({task}).split('THE TASK')[1]), 'the task part of the prompt shows no hidden test');
    const again = await llmAgent.ask({task, repair: {files: packet.files, report: 'The sandbox answered failed'}}, {}, {presentation: 'code', run, cacheDir: dir, model: 'xai-oauth/test', fallbackModels: []});
    assert.equal(again.status, 'proposed');
    assert.ok(seen[1].prompt.includes('HOST REPORT:\nThe sandbox answered failed'));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  assert.equal(parseCodeAnswer('no blocks').ok, false);
  assert.equal(parseCodeAnswer('```task.sop\na\n```\n```task.sop\nb\n```\n').ok, false);
  assert.ok(llmAgent.presentations.includes('code'));
});

test('the suite code-instructions-v1: 20 tasks, 2 or 3 visible examples, 3 hidden tests, every reference verified, a matching manifest', async () => {
  const dir = path.join(root, 'eval/suites/code-instructions-v1');
  const text = fs.readFileSync(path.join(dir, 'test.jsonl'), 'utf8');
  const rows = text.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rows.length, 20);
  assert.equal(text, TASKS.map(x => JSON.stringify(x)).join('\n') + '\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.rows, 20);
  assert.equal(manifest.sha256, (await import('node:crypto')).createHash('sha256').update(text).digest('hex'));
  assert.equal(new Set(rows.map(r => r.entry)).size, 20);
  for (const r of rows) {
    assert.ok(r.examples.length >= 2 && r.examples.length <= 3 && r.hidden.length === 3, r.id);
    for (const h of r.hidden) assert.ok(!r.examples.some(e => e.call === h.call), `${r.id}: a hidden test repeats a visible example`);
    assert.ok(r.instruction.includes(r.entry), `${r.id}: the instruction names the function`);
  }
  assert.ok(rows.some(r => /[ăâîșț]/.test(r.instruction)), 'a few instructions are in Romanian');
  assert.deepEqual(await verifyReferences(), []);
});
