import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {renderEnglish} from '../reasoning/slice/render-english.mjs';
import {Theory} from '../reasoning/slice/wire.mjs';
import {runCompletion} from '../reasoning/strategies/llm-agent/completion.mjs';
import {parseAnswer} from '../reasoning/strategies/llm-agent/packet.mjs';
import {ask} from '../reasoning/strategies/llm-agent/index.mjs';

const knowledge = `@bird predicate
  args subject:entity
  closed true
@flies predicate
  args subject:entity
@f1 fact
  holds bird "A Bird"
  valid 2026-01-01 2026-02-01
@f2 fact
  holds not flies penguin
@d1 default
  when bird ?x
  except injured ?x
  then flies ?x
  priority 1
@d2 default
  when penguin ?x
  then not flies ?x
  priority 2
  overrides $d1
@r1 rule
  when all
    bird ?x
    not injured ?x
  end
  then active ?x
@agg aggregate
  over bird ?x
  count ?x as ?n
  yields bird_count ?n
@guard integrity
  never all
    bird ?x
    injured ?x
  end
  witness ?x
  message "bird injured"
`;

async function serve(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve))};
}

test('renderer preserves explicit negative evidence, defaults, precedence, closedness, intervals, aggregate and integrity', () => {
  const text = renderEnglish(knowledge);
  assert.match(text, /The list of bird is complete/);
  assert.match(text, /explicitly not flies\(penguin\)/);
  assert.match(text, /2026-01-01 inclusive until 2026-02-01 exclusive/);
  assert.match(text, /unless injured\(\?x\)/);
  assert.match(text, /Overrides d1 when it fires/);
  assert.match(text, /Priority 2/);
  assert.match(text, /Strict logical rule: if \(bird\(\?x\) AND explicitly not injured\(\?x\)\)/);
  assert.match(text, /Aggregate over bird\(\?x\).*count \?x as \?n/);
  assert.match(text, /Integrity constraint: never \(bird\(\?x\) AND injured\(\?x\)\)/);
  assert.equal(renderEnglish(knowledge), text);
});

test('renderer accepts gold slices and refuses semantically incomplete Theory or unknown wires', () => {
  const theory = new Theory([{name: 'case', text: knowledge}]);
  assert.throws(() => renderEnglish(theory), /omits repository facts/);
  const subset = {wires: [...theory.predicates.values(), ...theory.recs.map(r => r.wire)], facts: [{id: 'f2', atom: {p: 'flies', a: ['penguin'], neg: true}, valid: {from: -Infinity, until: Infinity}}]};
  assert.match(renderEnglish(subset), /explicitly not flies\(penguin\)/);
  const duplicate = {wires: [...subset.wires, {id: 'f2', type: 'fact', fields: [{key: 'holds', value: 'not flies penguin', block: []}]}], facts: subset.facts};
  assert.equal(renderEnglish(duplicate).match(/\[@f2\]/g).length, 1, 'one retrieved fact appears exactly once');
  assert.throws(() => renderEnglish({...duplicate, facts: [{id: 'f2', atom: {p: 'flies', a: ['other'], neg: true}}]}), /Conflicting evidence/);
  assert.throws(() => renderEnglish({wires: [{id: 'u', type: 'action', fields: []}]}), /Unsupported evidence wire/);
  assert.throws(() => renderEnglish('@u predicate\n  strange true\n'), /Unsupported evidence field/);
});

test('completion cache does not reuse an answer across different token ceilings', async t => {
  const calls = [];
  const service = await serve(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    calls.push({url: req.url, auth: req.headers.authorization, body: JSON.parse(input)});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: '{"status":"unknown"}'}}], usage: {prompt_tokens: 17, completion_tokens: 5}}));
  });
  t.after(() => service.close());
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-completion-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const opts = {backend: 'completion', endpoint: service.endpoint, apiKey: 'local-token', model: 'local-model', fallbackModels: [], maxTokens: 23, cacheDir: directory, reasoning: 'direct'};
  const problem = {theory: {knowledge: '@bird predicate\n  args subject:entity\n'}, query: '@q query\n  where bird ?x\n'};
  const first = await ask(problem, {}, opts);
  assert.equal(first.status, 'unknown');
  const hit = await ask(problem, {}, opts);
  assert.equal(hit.llm.cached, true);
  assert.equal(calls.length, 1);
  await ask(problem, {}, {...opts, maxTokens: 24});
  assert.equal(calls.length, 2);
});

test('completion reports timeout, provider failure and malformed output without substituting omp', async t => {
  const service = await serve((req, res) => {
    if (req.url === '/slow/v1/chat/completions') return setTimeout(() => res.end('{}'), 100);
    if (req.url === '/bad/v1/chat/completions') return res.end('not json');
    if (req.url === '/empty/v1/chat/completions') return res.end('{"choices":[{"message":{"content":""}}]}');
    res.writeHead(503); res.end('offline');
  });
  t.after(() => service.close());
  const base = {model: 'local', prompt: 'hello', endpoint: service.endpoint};
  const slow = await runCompletion({...base, endpoint: service.endpoint + '/slow', timeoutMs: 20});
  assert.equal(slow.ok, false);
  assert.equal(slow.timedOut, true);
  assert.match(slow.error, /wall timeout/);
  const unavailable = await runCompletion(base);
  assert.match(unavailable.error, /HTTP 503/);
  assert.match((await runCompletion({...base, endpoint: service.endpoint + '/bad'})).error, /malformed completion JSON/);
  assert.match((await runCompletion({...base, endpoint: service.endpoint + '/empty'})).error, /missing assistant text/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-failure-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const failed = await ask({source: 'A.', query: ''}, {}, {backend: 'completion', endpoint: service.endpoint, model: 'local', cacheDir: directory, presentation: 'nl', reasoning: 'direct'});
  assert.equal(failed.reason, 'provider');
  assert.equal(failed.route.backend, 'completion:local');
});

test('constraint packets retain possible/impossible and counterexample evidence', () => {
  assert.deepEqual(parseAnswer('{\"status\":\"possible\",\"witness\":{\"x\":2},\"counterexample\":{\"x\":3}}').packet.counterexample, {x: 3});
  assert.equal(parseAnswer('{\"status\":\"impossible\"}').packet.status, 'impossible');
  assert.equal(parseAnswer('{\"status\":\"possible\",\"counterexample\":{\"x\":{}}}').ok, false);
});
