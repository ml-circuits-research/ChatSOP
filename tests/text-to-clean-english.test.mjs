/** textToCleanEnglish (lib/text-to-clean-english/): the host UI step ahead of formalization (DS012, DS021
 * "textToCleanEnglish", owner decision 2026-09-30). Stub LanguagesUtil resources stand in for the git-ignored
 * vendor word lists (same pattern as tests/symbolic-lm.test.mjs), and a fake `fetch` stands in for an external
 * LanguageTool/llm server, so this suite needs no network, no Java and no Python. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {textToCleanEnglish, diffWords, loadTextToCleanEnglishConfig, TEXT_TO_CLEAN_ENGLISH_VERSION} from '../lib/text-to-clean-english/index.mjs';
import {gate, grammarTrouble} from '../lib/text-to-clean-english/gate.mjs';
import {identify} from '../lib/languages-util/index.mjs';

/** Small word lists standing in for the Hunspell sets (the real ones are git-ignored vendor data). */
function stubLexicons() {
  const en = new Set('works at lives in who does the team and is a an are of report need to check my message please'.split(' '));
  const ro = new Set('lucrează la locuiește în cine echipa și este raport de mesaj'.split(' '));
  return {has: (lang, w) => (lang === 'en' ? en : ro).has(w), perMillion: () => 0};
}

/** A stub Spellfix: `fix()` reports the changes a real corrector would flag for a fixed set of misspellings. */
function stubSpellfix(typos = {}) {
  return {
    fix(text) {
      const changes = [];
      let out = String(text);
      for (const [from, to] of Object.entries(typos)) {
        if (!out.includes(from)) continue;
        out = out.split(from).join(to);
        changes.push({from, to, kind: 'substitution'});
      }
      return {text: out, changes, language: 'en', ms: 0};
    },
  };
}

const gateResources = (typos = {}) => ({identify, lexicons: stubLexicons(), spellfix: stubSpellfix(typos)});

test('gate: clean English needs no cleaning', () => {
  const decision = gate('Who works at the team?', gateResources());
  assert.deepEqual(decision, {needed: false, language: 'en', reasons: []});
});

test('gate: non-English tokens are a reason (mixed) or (non_english)', () => {
  assert.equal(gate('Cine locuiește în echipa?', gateResources()).language, 'ro');
  assert.deepEqual(gate('Cine locuiește în echipa?', gateResources()).reasons, ['non_english']);
  const mixed = gate('Cine locuiește în the team?', gateResources());
  assert.equal(mixed.language, 'mixed');
  assert.deepEqual(mixed.reasons, ['mixed']);
});

test('gate: a spelling correction is a reason even for an all-English message', () => {
  const decision = gate('Who wrks at the team?', gateResources({wrks: 'works'}));
  assert.equal(decision.needed, true);
  assert.deepEqual(decision.reasons, ['spelling']);
});

test('grammarTrouble: a handful of cheap regexes, and gate reports "grammar"', () => {
  assert.equal(grammarTrouble('Who works works at the team?').needed, true); // doubled word
  assert.equal(grammarTrouble('Who works at the team. does she also manage it?').needed, true); // missing capital
  assert.equal(grammarTrouble('Who works  at the team?').needed, true); // double space
  assert.equal(grammarTrouble('Who works at the team?').needed, false);
  const decision = gate('Who works works at the team?', gateResources());
  assert.ok(decision.reasons.includes('grammar'));
});

test('diffWords: equal, deleted and inserted spans, adjacent same-type spans merged', () => {
  const spans = diffWords('Who wrks at the team', 'Who works at the team');
  assert.deepEqual(spans, [
    {type: 'equal', text: 'Who '},
    {type: 'delete', text: 'wrks'},
    {type: 'insert', text: 'works'},
    {type: 'equal', text: ' at the team'},
  ]);
});

test('diffWords: identical text is one equal span; empty strings produce no spans', () => {
  assert.deepEqual(diffWords('same text', 'same text'), [{type: 'equal', text: 'same text'}]);
  assert.deepEqual(diffWords('', ''), []);
});

test('textToCleanEnglish: enabled:false always passes through, without even running the gate', async () => {
  const result = await textToCleanEnglish('Cine locuiește în echipa?', {
    config: {enabled: false, backends: {english: 'llm', nonEnglish: 'llm'}},
  });
  assert.deepEqual(result, {original: 'Cine locuiește în echipa?', clean: 'Cine locuiește în echipa?', changed: false, reasons: [], spans: [], backend: 'none', confidence: 1});
});

test('textToCleanEnglish: clean English passes through unchanged, backend "none", nothing called', async () => {
  const result = await textToCleanEnglish('Who works at the team?', {
    config: {enabled: true, backends: {english: 'llm', nonEnglish: 'llm'}},
    gateResources: gateResources(),
  });
  assert.deepEqual(result, {original: 'Who works at the team?', clean: 'Who works at the team?', changed: false, reasons: [], spans: [], backend: 'none', confidence: 1});
});

test('textToCleanEnglish: backends.<class> = "none" skips cleaning for that class but still reports why', async () => {
  const result = await textToCleanEnglish('Who wrks at the team?', {
    config: {enabled: true, backends: {english: 'none', nonEnglish: 'llm'}},
    gateResources: gateResources({wrks: 'works'}),
  });
  assert.equal(result.changed, false);
  assert.equal(result.backend, 'none');
  assert.deepEqual(result.reasons, ['spelling']);
});

test('textToCleanEnglish: languagetool backend calls the configured server and reports the full shape', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push(String(url));
    return {ok: true, json: async () => ({matches: [
      {offset: 4, length: 4, replacements: [{value: 'works'}], rule: {id: 'TYPO'}, message: 'Spelling'},
    ]})};
  });
  const result = await textToCleanEnglish('Who wrks at the team?', {
    config: {enabled: true, backends: {english: 'languagetool', nonEnglish: 'llm'}, languagetool: {url: 'http://localhost:8123', language: 'en-US'}},
    gateResources: gateResources({wrks: 'works'}),
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('http://localhost:8123/v2/check'));
  assert.equal(result.backend, 'languagetool');
  assert.equal(result.changed, true);
  assert.equal(result.clean, 'Who works at the team?');
  assert.ok(result.spans.some(s => s.type === 'delete' && s.text === 'wrks'));
  assert.ok(result.spans.some(s => s.type === 'insert' && s.text === 'works'));
});

test('textToCleanEnglish: languagetool masks names before calling the server and restores them after', async (t) => {
  t.mock.method(global, 'fetch', async (url, init) => {
    const body = String(init.body);
    assert.ok(!body.includes('Ungureanu'), 'the raw name must never reach the server');
    return {ok: true, json: async () => ({matches: []})};
  });
  const result = await textToCleanEnglish('Who wrks with Ungureanu?', {
    config: {enabled: true, backends: {english: 'languagetool', nonEnglish: 'llm'}, languagetool: {url: 'http://localhost:8123'}},
    gateResources: gateResources({wrks: 'works'}),
  });
  assert.match(result.clean, /Ungureanu/);
});

test('textToCleanEnglish: llm backend sends the bare sentence (no system prompt, no masking) to backendOptions.endpoint', async (t) => {
  const requests = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    requests.push(JSON.parse(init.body));
    return {ok: true, json: async () => ({choices: [{message: {content: 'Who lives in Cluj?'}, finish_reason: 'stop'}], usage: null})};
  });
  const result = await textToCleanEnglish('Cine locuiește în Cluj?', {
    config: {enabled: true, backends: {english: 'languagetool', nonEnglish: 'llm'}},
    backendOptions: {endpoint: 'http://localhost:9000'},
    gateResources: gateResources(),
  });
  assert.equal(result.backend, 'llm');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages, [{role: 'user', content: 'Cine locuiește în Cluj?'}]);
  assert.equal(requests[0].temperature, 0);
  assert.equal(result.clean, 'Who lives in Cluj?');
});

test('textToCleanEnglish: the message is cleaned sentence by sentence and only flagged sentences reach the model', async (t) => {
  const sent = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    const text = JSON.parse(init.body).messages.at(-1).content;
    sent.push(text);
    return {ok: true, json: async () => ({choices: [{message: {content: 'Who lives in Cluj?'}, finish_reason: 'stop'}], usage: null})};
  });
  const config = {enabled: true, backends: {english: 'llm', nonEnglish: 'llm'}};
  const message = 'Who works at the team? Cine locuiește în Cluj?';
  const result = await textToCleanEnglish(message, {config, backendOptions: {endpoint: 'http://localhost:9000'}, gateResources: gateResources()});
  assert.deepEqual(sent, ['Cine locuiește în Cluj?']);
  assert.equal(result.clean, 'Who works at the team? Who lives in Cluj?');
  assert.equal(result.changed, true);
  assert.deepEqual(result.reasons, ['non_english']);
});

test('textToCleanEnglish: llm.sendAll (or options.sendAll) sends clean sentences too; default does not', async (t) => {
  const sent = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    const text = JSON.parse(init.body).messages.at(-1).content;
    sent.push(text);
    return {ok: true, json: async () => ({choices: [{message: {content: text}, finish_reason: 'stop'}], usage: null})};
  });
  const base = {enabled: true, backends: {english: 'llm', nonEnglish: 'llm'}};
  const options = {backendOptions: {endpoint: 'http://localhost:9000'}, gateResources: gateResources()};
  const def = await textToCleanEnglish('Who works at the team? Who is a boss?', {...options, config: base});
  assert.deepEqual(sent, []);
  assert.equal(def.backend, 'none');
  const all = await textToCleanEnglish('Who works at the team? Who is a boss?', {...options, config: {...base, llm: {sendAll: true}}});
  assert.deepEqual(sent, ['Who works at the team?', 'Who is a boss?']);
  assert.equal(all.backend, 'llm');
  assert.equal(all.changed, false);
  sent.length = 0;
  await textToCleanEnglish('Who works at the team?', {...options, config: base, sendAll: true});
  assert.deepEqual(sent, ['Who works at the team?']);
});

test('textToCleanEnglish: backendOptions.endpoint may be a function, called only when a sentence needs the model', async (t) => {
  t.mock.method(global, 'fetch', async () => ({ok: true, json: async () => ({choices: [{message: {content: 'Who lives in Cluj?'}, finish_reason: 'stop'}], usage: null})}));
  let started = 0;
  const endpoint = async () => { started++; return 'http://localhost:9000'; };
  const config = {enabled: true, backends: {english: 'llm', nonEnglish: 'llm'}};
  await textToCleanEnglish('Who works at the team?', {config, backendOptions: {endpoint}, gateResources: gateResources()});
  assert.equal(started, 0);
  await textToCleanEnglish('Cine locuiește în Cluj?', {config, backendOptions: {endpoint}, gateResources: gateResources()});
  assert.equal(started, 1);
  await assert.rejects(() => textToCleanEnglish('Cine locuiește în Cluj?', {config, backendOptions: {endpoint: async () => { throw Error('cannot start'); }}, gateResources: gateResources()}),
    error => error.code === 'backend_unavailable');
});

test('textToCleanEnglish: llm backend throws backend_unavailable with no endpoint configured', async () => {
  await assert.rejects(
    () => textToCleanEnglish('Cine locuiește în Cluj?', {
      config: {enabled: true, backends: {english: 'none', nonEnglish: 'llm'}},
      gateResources: gateResources(),
    }),
    error => error.code === 'backend_unavailable',
  );
});

test('textToCleanEnglish: an unreachable languagetool server throws backend_unavailable, not a raw network error', async (t) => {
  t.mock.method(global, 'fetch', async () => { throw Error('ECONNREFUSED'); });
  await assert.rejects(
    () => textToCleanEnglish('Who wrks at the team?', {
      config: {enabled: true, backends: {english: 'languagetool', nonEnglish: 'llm'}, languagetool: {url: 'http://localhost:8123'}},
      gateResources: gateResources({wrks: 'works'}),
    }),
    error => error.code === 'backend_unavailable',
  );
});

test('textToCleanEnglish: an unknown configured backend name is also reported as backend_unavailable', async () => {
  await assert.rejects(
    () => textToCleanEnglish('Who wrks at the team?', {
      config: {enabled: true, backends: {english: 'not-a-backend', nonEnglish: 'llm'}},
      gateResources: gateResources({wrks: 'works'}),
    }),
    error => error.code === 'backend_unavailable',
  );
});

test('textToCleanEnglish: a backend that returns no text is a failed backend, never an empty proposal', async (t) => {
  t.mock.method(global, 'fetch', async () => ({ok: true, json: async () => ({choices: [{message: {content: ''}, finish_reason: 'stop'}], usage: null})}));
  await assert.rejects(
    () => textToCleanEnglish('Cine locuiește în Cluj?', {
      config: {enabled: true, backends: {english: 'languagetool', nonEnglish: 'llm'}},
      backendOptions: {endpoint: 'http://localhost:9000'},
      gateResources: gateResources(),
    }),
    error => error.code === 'backend_unavailable' && /no text/.test(error.message),
  );
});

test('llm backend with a systemPrompt (generic chat models): masks names, drops a think block, switches thinking off', async (t) => {
  let request = null;
  t.mock.method(global, 'fetch', async (url, init) => {
    request = JSON.parse(init.body);
    return {ok: true, json: async () => ({choices: [{message: {content: '<think>\n\n</think>\n\nWho works in Ent1?'}, finish_reason: 'stop'}], usage: null})};
  });
  const {createLlmBackend} = await import('../lib/text-to-clean-english/backends/llm.mjs');
  const backend = createLlmBackend({url: 'http://localhost:9000', systemPrompt: 'Rewrite in English.'});
  const result = await backend.clean('cine locuiește în Cluj?', {language: 'en'});
  assert.equal(result.text, 'Who works in Cluj?');
  assert.ok(!request.messages.at(-1).content.includes('Cluj'));
  assert.equal(request.chat_template_kwargs.enable_thinking, false);
  assert.equal(request.messages[0].content, 'Rewrite in English.');
});

test('the shipped config names a registry model for the llm backend and a local LanguageTool port', () => {
  const config = loadTextToCleanEnglishConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.llm.model, 'language-proofing-llm');
  assert.equal(config.llm.sendAll, true); // owner rule: the gate cannot detect uncertainty reliably, so every sentence goes to the model
  assert.deepEqual(config.backends, {english: 'llm', nonEnglish: 'llm'});
  assert.match(config.languagetool.url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('VERSION is exported for trace/provenance fields', () => {
  assert.equal(typeof TEXT_TO_CLEAN_ENGLISH_VERSION, 'string');
});

test('llm backend name guard: a reply that loses a multi-word name is asked again with the name masked, and the masked reply is used when the placeholder survives', async (t) => {
  const sent = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    const text = JSON.parse(init.body).messages.at(-1).content;
    sent.push(text);
    const reply = text.includes('Ent1') ? 'Who works at Ent1?' : 'Who works at the Lisbon Philharmonic?';
    return {ok: true, json: async () => ({choices: [{message: {content: reply}, finish_reason: 'stop'}], usage: null})};
  });
  const config = {enabled: true, backends: {english: 'llm', nonEnglish: 'llm'}};
  const result = await textToCleanEnglish('Cine lucrează la Filarmonica din Lisbon?', {config, backendOptions: {endpoint: 'http://localhost:9000'}, gateResources: gateResources()});
  assert.deepEqual(sent, ['Cine lucrează la Filarmonica din Lisbon?', 'Cine lucrează la Ent1?']);
  assert.equal(result.clean, 'Who works at Filarmonica din Lisbon?');
  assert.equal(result.confidence, 0.8);
});

test('llm backend name guard: no retry when the name survives, and a masked reply that drops the placeholder is rejected with a lower confidence', async (t) => {
  const sent = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    const text = JSON.parse(init.body).messages.at(-1).content;
    sent.push(text);
    const reply = text.includes('Ent1') ? 'Who works there?' : 'Who works at the Lisbon Philharmonic?';
    return {ok: true, json: async () => ({choices: [{message: {content: reply}, finish_reason: 'stop'}], usage: null})};
  });
  const config = {enabled: true, backends: {english: 'llm', nonEnglish: 'llm'}};
  const options = {config, backendOptions: {endpoint: 'http://localhost:9000'}, gateResources: gateResources()};
  const rejected = await textToCleanEnglish('Cine lucrează la Filarmonica din Lisbon?', options);
  assert.equal(sent.length, 2);
  assert.equal(rejected.clean, 'Who works at the Lisbon Philharmonic?');
  assert.equal(rejected.confidence, 0.5);
  sent.length = 0;
  t.mock.method(global, 'fetch', async (url, init) => { sent.push(JSON.parse(init.body).messages.at(-1).content); return {ok: true, json: async () => ({choices: [{message: {content: 'Who lives in Cluj?'}, finish_reason: 'stop'}], usage: null})}; });
  await textToCleanEnglish('Cine locuiește în Cluj?', options);
  assert.equal(sent.length, 1);
});
