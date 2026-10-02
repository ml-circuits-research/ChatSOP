// Archived with probably_obsolete/omp/llm-agent-runner.mjs (omp is off every path since 2026-10-02): the omp event parser test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents, isSubscription} from './llm-agent-runner.mjs';

test('runner: usage and cost are read from the omp json events', () => {
  const ev = [{type: 'session'}, {type: 'message_end', message: {role: 'user'}}, {type: 'message_end', message: {role: 'assistant', content: [{type: 'text', text: '{"a":1}'}], usage: {input: 10, output: 2, cost: {total: 0.5}}, stopReason: 'stop'}}].map(e => JSON.stringify(e)).join('\n');
  const r = parseEvents(ev);
  assert.equal(r.text, '{"a":1}');
  assert.equal(r.usage.cost.total, 0.5);
  assert.equal(isSubscription('xai-oauth/grok-4.20-0309-non-reasoning'), true);
  assert.equal(isSubscription('deepseek/deepseek-chat'), false);
});
