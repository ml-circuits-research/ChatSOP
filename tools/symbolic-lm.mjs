#!/usr/bin/env node
/** SymbolicLM command line and chat service (lib/symbolic-lm/, DS021 "SymbolicLM", DS012 "Formalizer models").
 *
 *   node tools/symbolic-lm.mjs analyze "<message>" [--route auto|direct|translate] [--spell] [--trace]   # SOP (+ trace JSON)
 *   node tools/symbolic-lm.mjs english "<message>" [--spell]                                              # English rendering
 *   node tools/symbolic-lm.mjs english --in rows.jsonl --out out.jsonl [--field question] [--spell]       # batch: {id, message, english, untranslated, language}
 *   node tools/symbolic-lm.mjs record-fixture                                                             # re-records tests/fixtures/symbolic-lm/parses.json
 *   node tools/symbolic-lm.mjs serve [--host 127.0.0.1] [--port 18961] [--threads 4]
 *        [--rewrite-url http://127.0.0.1:PORT/v1/chat/completions] [--rewrite-when always|uncertain]      # llama.cpp-compatible endpoint
 *
 * The only input is the message. CPU only (the GPU is hidden from the Stanza worker); `--threads` or
 * CHATSOP_SYMBOLIC_LM_THREADS sets its CPU threads. The service answers GET /health, GET /v1/models and
 * POST /v1/chat/completions with the message as the last user turn; the reply content is the SOP text, and
 * `symbolic_lm` in the response carries route, language and the uncertainty signal.
 *
 * `--rewrite-url` (off by default) wires an OPTIONAL proofreading rewrite ahead of the rules (DS021 "SymbolicLM",
 * "Uncertainty and the rewrite hook"; config/formalizers.json symbolic-lm.rewrite documents the option, `mode:
 * "off"` by default): a running llama.cpp-compatible chat-completion endpoint (message-only, matching training,
 * e.g. a GGUF Q8_0 export of a fine-tuned proofreader such as train-proofreader-gemma270m-v1 served by
 * `llama-server --jinja`) is called with the English text and its greedy reply replaces it before the rules run
 * again. `--rewrite-when` selects `always` (every row) or `uncertain` (default when `--rewrite-url` is set: only
 * when SymbolicLM's own uncertainty signal fires, DS021's `rewriteWhen: "uncertain"`). Evidence for this option:
 * experiment `eval-proofreader-e2e-v1` (status/preregistrations/eval-proofreader-e2e-v1.json,
 * eval/reports/current/proofreader-e2e/): a positive, CI-excluding-0 end-to-end strict-accuracy gain on
 * formalizer-v1 and formalizer-ood-v1 EN rows, a null/futile effect on the independently-written formalizer-wild-v1
 * EN rows. No default changes: the option stays off unless a caller explicitly passes `--rewrite-url`.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../lib/jsonl-shards.mjs';
import {createSymbolicLM, SYMBOLIC_LM_VERSION} from '../lib/symbolic-lm/index.mjs';

export const MODEL_ID = 'symbolic-lm';

function argumentsOf(argv) {
  const [command, ...rest] = argv;
  const args = {command, positional: []};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) { args.positional.push(rest[i]); continue; }
    const key = rest[i].slice(2);
    if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) args[key] = true; else args[key] = rest[++i];
  }
  return args;
}

async function englishCommand(args) {
  const lm = await createSymbolicLM({threads: args.threads ? Number(args.threads) : undefined});
  try {
    if (args.in) {
      const rows = readJsonlShardedSync(args.in);
      const field = args.field ?? 'question';
      const out = [];
      for (const row of rows) {
        const message = row[field] ?? row.message;
        const english = await lm.toEnglish(message, {spell: Boolean(args.spell)});
        out.push({id: row.id, message, english: english.text, language: english.language, untranslated: english.untranslated.map(u => u.word), spelling: english.spelling.map(c => [c.from, c.to])});
        if (out.length % 50 === 0) process.stderr.write(`\r${out.length}/${rows.length}`);
      }
      fs.mkdirSync(path.dirname(path.resolve(args.out)), {recursive: true});
      fs.writeFileSync(args.out, out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
      console.error(`\n${out.length} messages → ${args.out}`);
    } else {
      const english = await lm.toEnglish(args.positional.join(' '), {spell: Boolean(args.spell)});
      console.log(english.text);
      if (english.untranslated.length) console.error('untranslated: ' + english.untranslated.map(u => u.word).join(', '));
    }
  } finally { await lm.stop(); }
}

async function analyzeCommand(args) {
  const lm = await createSymbolicLM({threads: args.threads ? Number(args.threads) : undefined});
  try {
    const result = await lm.analyze(args.positional.join(' '), {route: args.route ?? 'auto', spell: Boolean(args.spell)});
    console.log(result.sop);
    if (args.trace) console.error(JSON.stringify({route: result.route, language: result.language, uncertainty: result.uncertainty, trace: result.trace}, null, 2));
  } finally { await lm.stop(); }
}

/** The llama.cpp-compatible chat service. Requests are serialized through the one Stanza worker. */
/** Optional rewrite hook (off unless `url` is given): a message-only chat-completion call to a running
 * llama.cpp-compatible endpoint (e.g. llama-server serving a fine-tuned proofreader's GGUF export), greedy
 * (temperature 0), matching the exact call shape verified in experiment eval-proofreader-e2e-v1. */
function rewriteBackend(url) {
  if (!url) return null;
  return async englishText => {
    const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({messages: [{role: 'user', content: englishText}], temperature: 0, top_k: 1, max_tokens: 384, seed: 0})});
    if (!res.ok) throw Error(`rewrite backend ${url}: HTTP ${res.status}`);
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content ?? '').trim();
  };
}

export async function serve({host = '127.0.0.1', port = 18961, threads, rewriteUrl = null, rewriteWhen = 'uncertain'} = {}) {
  const missing = (await import('../lib/symbolic-lm/index.mjs')).SymbolicLM.missing();
  if (missing) { console.error(missing); process.exit(1); }
  const rewrite = rewriteBackend(rewriteUrl);
  if (rewrite) console.error(`SymbolicLM rewrite hook: ${rewriteUrl} (rewriteWhen ${rewriteWhen})`);
  const ready = createSymbolicLM({threads});
  ready.catch(error => { console.error('SymbolicLM failed to start: ' + error.message); process.exit(1); });
  let lm = null;
  ready.then(value => { lm = value; });
  let queue = Promise.resolve();
  const reply = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return reply(res, lm ? 200 : 503, {status: lm ? 'ok' : 'loading', model: MODEL_ID, version: SYMBOLIC_LM_VERSION, rewrite: rewrite ? {rewriteWhen} : null});
      if (req.method === 'GET' && req.url === '/v1/models') return reply(res, 200, {object: 'list', data: [{id: MODEL_ID, object: 'model', owned_by: 'chatsop'}]});
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const message = [...(body.messages ?? [])].reverse().find(m => m.role === 'user')?.content;
        if (typeof message !== 'string') return reply(res, 400, {error: {message: 'expected messages with a user turn'}});
        const model = await ready;
        const job = queue.then(() => model.analyze(message, rewrite ? {rewrite, rewriteWhen} : {}));
        queue = job.catch(() => {});
        const result = await job;
        return reply(res, 200, {id: 'symbolic-lm-' + Date.now(), object: 'chat.completion', model: MODEL_ID,
          choices: [{index: 0, message: {role: 'assistant', content: result.sop}, finish_reason: 'stop'}],
          usage: {prompt_tokens: 0, completion_tokens: 0},
          symbolic_lm: {route: result.route, language: result.language, uncertainty: result.uncertainty, english: result.trace.translation?.text ?? null},
          timings: {total_ms: result.trace.ms}});
      }
      reply(res, 404, {error: {message: 'not found'}});
    } catch (error) {
      reply(res, 500, {error: {message: error.message}});
    }
  });
  await new Promise(resolve => server.listen(Number(port), host, resolve));
  const stop = async () => { server.close(); if (lm) await lm.stop(); process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.error(`SymbolicLM listening on http://${host}:${port}`);
  return server;
}

/** Messages of the replay test (ChatSOP-authored sentences in the style of the corpora). */
const FIXTURE_MESSAGES = [
  'Cine antrenează echipa la care joacă Haruka Suzuki?',
  'Mă întreb dacă Chloé participă la atelierul de fotografie.',
  'Katalin cât timp a predat matematică?',
  'Nu cumva Traian a antrenat Rapid Bergen pe 10.06.2020?',
  'Există cineva care lucrează la Vertex Analytics și nu locuiește în Montreal?',
  'Spune-mi de când Rémi stă în Glasgow.',
  'Ion lucrează la Carpathia Energy. Lucrează și la Tisa Textile?',
  'Verify the claim that autorizația de construire requires a criminal record certificate.',
  'Who takes care of the garden?',
];

/** Records the Stanza parses and word-list lookups of FIXTURE_MESSAGES for tests/symbolic-lm.test.mjs. */
async function recordFixture() {
  const {SymbolicLM} = await import('../lib/symbolic-lm/index.mjs');
  const {StanzaWorker} = await import('../lib/ud-to-sop/stanza.mjs');
  const real = new StanzaWorker({device: 'cpu', env: {OMP_NUM_THREADS: '4'}});
  const parses = {};
  const worker = {start: () => real.start(), stop: () => real.stop(), request: async payload => { const r = await real.request(payload); parses[`${payload.language}|${payload.text}`] = r.parse; return r; }};
  const lm = new SymbolicLM({worker});
  await lm.start();
  const used = {en: new Set(), ro: new Set()};
  const base = lm.lexicons;
  lm.lexicons = {has: (l, w) => { const hit = base.has(l, w); if (hit) used[l].add(w); return hit; }, perMillion: () => 0};
  const cases = [];
  for (const message of FIXTURE_MESSAGES) {
    const english = await lm.toEnglish(message);
    const result = await lm.analyze(message);
    cases.push({message, english: english.text, route: result.route, sop: result.sop});
  }
  await lm.stop();
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/symbolic-lm/parses.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({note: 'Recorded by `node tools/symbolic-lm.mjs record-fixture`: Stanza 1.10.1 parses of ChatSOP-authored sentences and the word-list entries they touched (frequencies not recorded: the replay treats every frequency as 0).', cases, lexicons: {en: [...used.en].sort(), ro: [...used.ro].sort()}, parses}, null, 1) + '\n');
  console.log(`${cases.length} cases, ${Object.keys(parses).length} parses → ${file}`);
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command === 'english') return englishCommand(args);
  if (args.command === 'analyze') return analyzeCommand(args);
  if (args.command === 'record-fixture') return recordFixture();
  if (args.command === 'serve') {
    if (Number(args.port) === 9999) throw Error('port 9999 is reserved for the main server');
    if (args['rewrite-when'] && !['always', 'uncertain'].includes(args['rewrite-when'])) throw Error("--rewrite-when must be 'always' or 'uncertain'");
    return serve({host: args.host, port: args.port ?? 18961, threads: args.threads ? Number(args.threads) : undefined,
      rewriteUrl: args['rewrite-url'] ?? null, rewriteWhen: args['rewrite-when'] ?? 'uncertain'});
  }
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
