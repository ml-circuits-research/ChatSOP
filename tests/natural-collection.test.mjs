/** The natural collection (datasets/natural, DS008 "The natural collection"): scrubbing, filters, idempotent collection and the overlap guard. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {scrub, dropReason, collect, readRows} from '../tools/eval/collect-natural.mjs';
import {naturalOverlapOf} from '../tools/datasets/audit/natural-overlap.mjs';
import {tempDir, repoPath} from './helpers.mjs';

test('scrub replaces pasted blocks, e-mail, tokens and home paths and keeps the wording', () => {
  const home = process.env.HOME;
  const {text, removed} = scrub(`ce e asta?\n\n<pasted_content id="1">\nlog line\nremote: error\n</pasted_content id="1">\n scrie la ana@exemplu.ro cu ${home}/work/x.txt si sk-abcdefghijklmnopqrstuvwxyz123456 te rog`);
  assert.match(text, /^ce e asta\?/);
  assert.ok(text.includes('[pasted content]') && text.includes('[email]') && text.includes('[path]') && text.includes('[token]'));
  assert.ok(!text.includes('log line') && !text.includes('exemplu.ro') && !text.includes(home));
  assert.deepEqual([removed.pasted, removed.email, removed.path, removed.token], [1, 1, 1, 1]);
});

test('dropReason drops mostly pasted and very short messages, keeps owner prose', () => {
  const pasted = '<pasted_content id="1">' + 'x y z\n'.repeat(50) + '</pasted_content id="1">';
  const s = scrub(pasted);
  assert.equal(dropReason(pasted, s.text, s.removed), 'only_pasted');
  const short = scrub('ok'); assert.equal(dropReason('ok', short.text, short.removed), 'too_short');
  const prose = scrub('nu inteleg ce face acest script, explica-mi te rog'); assert.equal(dropReason('nu inteleg ce face acest script, explica-mi te rog', prose.text, prose.removed), null);
});

test('collect is idempotent and only keeps the human entries', t => {
  const dir = tempDir(t, 'natural-'), out = tempDir(t, 'natural-out-');
  const line = (o) => JSON.stringify({type: 'user', isSidechain: false, userType: 'external', turnOrigin: 'human', ...o});
  fs.writeFileSync(path.join(dir, 'sess1.jsonl'), [
    line({timestamp: '2026-10-01T10:00:00.000Z', message: {role: 'user', content: 'spune-mi cind pot rula scriptul acum'}}),
    line({timestamp: '2026-10-01T10:01:00.000Z', turnOrigin: 'sdk', message: {role: 'user', content: 'Say OK please now'}}),
    line({timestamp: '2026-10-01T10:02:00.000Z', isSidechain: true, message: {role: 'user', content: 'agent prompt to a subagent here'}}),
    line({timestamp: '2026-10-01T10:03:00.000Z', message: {role: 'user', content: [{type: 'tool_result', content: 'x'}]}, toolUseResult: {}}),
  ].join('\n') + '\n');
  const first = collect({transcripts: dir, out});
  assert.equal(first.rows.length, 1);
  const again = collect({transcripts: dir, out});
  assert.equal(again.stats.added, 0);
  assert.equal(readRows(path.join(out, 'messages.jsonl')).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).dataset, 'natural');
});

test('natural overlap guard: exact, normalized and lexical duplicates and unknown seeds fail; a changed-words row passes', () => {
  const natural = [{id: 'natural::1', message: 'ok, spune-mi cind pot rula scriptul de antrenare pe masina'}];
  const rows = [
    {id: 'a', message: 'OK spune-mi cind pot rula scriptul de antrenare pe masina!'},
    {id: 'b', message: 'pe masina rula scriptul antrenare, spune cind pot'},
    {id: 'c', message: 'cere-mi cand poti porni serverul de testare pe laptop', natural_seed: 'natural::1'},
    {id: 'd', message: 'cere-mi cand poti porni serverul de testare pe laptop', natural_seed: 'natural::999'},
  ];
  const r = naturalOverlapOf(rows, natural);
  assert.equal(r.exact_duplicates, 1);
  assert.equal(r.lexical_duplicates, 1);
  assert.equal(r.unknown_seed, 1);
  assert.equal(r.seeded_rows, 2);
});

test('the stored collection matches its manifest and carries no home path or e-mail', {skip: !fs.existsSync(repoPath('datasets/natural/messages.jsonl')) && 'collection not built'}, () => {
  const rows = readRows(repoPath('datasets/natural/messages.jsonl'));
  const manifest = JSON.parse(fs.readFileSync(repoPath('datasets/natural/manifest.json'), 'utf8'));
  assert.equal(manifest.rows, rows.length);
  assert.equal(new Set(rows.map(r => `${r.session}|${r.ts}`)).size, rows.length);
  for (const r of rows) { assert.ok(!/\/home\/|[\w.+-]+@[\w-]+\.\w/.test(r.message), r.id); assert.ok(r.words >= 3, r.id); }
});
