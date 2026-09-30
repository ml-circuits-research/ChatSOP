#!/usr/bin/env node
/** The symbolic formalizer baseline `baseline-ud-rules-v1`: Stanza UD parse + deterministic JavaScript rules.
 *
 *   node tools/eval/ud-baseline.mjs parse   --suite rows.jsonl --out parses.jsonl [--ids ids.json] [--device cuda|cpu] [--batch 64]
 *   node tools/eval/ud-baseline.mjs convert --parses parses.jsonl --out predictions.jsonl [--diagnostics diag.jsonl]
 *   node tools/eval/ud-baseline.mjs predict --suite rows.jsonl --out predictions.jsonl [--device cpu] [--batch 1] [--limit N]   # parse + convert, timed
 *   node tools/eval/ud-baseline.mjs serve   [--host 127.0.0.1] [--port 18960] [--device cuda|cpu]
 *
 * The input of every conversion is the row's `question` (the user's message) and nothing else (DS021). `parse`
 * caches the worker's parses of the masked messages (lib/ud-to-sop/index.mjs maskMessage keeps offsets), so the
 * rules can be changed and re-run without re-parsing; `convert` writes `{id, sop, ms, outcome, stats, valid}` rows
 * that `node eval/run.mjs --predictions` and `node tools/eval/wild-suite.mjs --score` read. `serve` answers the
 * formalizer endpoint interface of llama.cpp (`GET /health`, `POST /v1/chat/completions` with the message as the
 * last user turn; the reply's content is the SOP text), so the chat server and the evaluation harness call it like
 * a fine-tuned model (lib/formalizer-endpoint.mjs predictMessage).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {StanzaWorker} from '../../lib/ud-to-sop/stanza.mjs';
import {convertParse, maskMessage} from '../../lib/ud-to-sop/index.mjs';

const MODEL_ID = 'ud-rules';

function argumentsOf(argv) {
  const [command, ...rest] = argv;
  const args = {command};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) throw Error('Unexpected argument ' + rest[i]);
    const key = rest[i].slice(2);
    if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) args[key] = true; else args[key] = rest[++i];
  }
  return args;
}

const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true}); fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')); };
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

function suiteRows(args) {
  let rows = readJsonlShardedSync(args.suite);
  if (args.ids) { const ids = new Set(JSON.parse(fs.readFileSync(args.ids, 'utf8'))); rows = rows.filter(row => ids.has(row.id)); }
  if (args.limit) rows = rows.slice(0, Number(args.limit));
  for (const row of rows) if (typeof row.question !== 'string') throw Error(row.id + ': row has no message');
  return rows;
}

/** Parse + convert one message with a started worker: `{sop, ms, parse_ms, convert_ms, device, ...}`. */
export async function formalize(worker, message) {
  const started = performance.now();
  const {parse, ms: parseMs, device} = await worker.parse(maskMessage(message));
  const t = performance.now();
  const result = convertParse(parse, message);
  const convertMs = performance.now() - t;
  return {...result, ms: performance.now() - started, parse_ms: parseMs, convert_ms: convertMs, device};
}

async function parseCommand(args) {
  const rows = suiteRows(args);
  const worker = new StanzaWorker({device: args.device ?? 'cuda'});
  const info = await worker.start();
  const batch = Number(args.batch ?? 64);
  const out = [];
  const started = performance.now();
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const t = performance.now();
    const {parses} = await worker.parseMany(chunk.map(row => maskMessage(row.question)));
    const each = (performance.now() - t) / chunk.length;
    chunk.forEach((row, j) => out.push({id: row.id, message: row.question, parse: parses[j], parse_ms_amortized: each, device: info.device}));
    process.stderr.write(`\r${out.length}/${rows.length}`);
  }
  await worker.stop();
  writeJsonl(args.out, out);
  console.error(`\nparsed ${out.length} messages on ${info.device} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

function convertCommand(args) {
  const parses = readJsonl(args.parses);
  const predictions = [], diagnostics = [];
  for (const row of parses) {
    const t = performance.now();
    let result;
    try { result = convertParse(row.parse, row.message); } catch (error) { result = {sop: '', valid: false, error: 'converter: ' + error.message, outcome: 'crash', stats: {}, notes: [], wires: []}; }
    const ms = performance.now() - t;
    predictions.push({id: row.id, sop: result.sop, ms: row.parse_ms_amortized + ms, convert_ms: ms, device: row.device, outcome: result.outcome, valid: result.valid, stats: result.stats});
    diagnostics.push({id: row.id, message: row.message, outcome: result.outcome, valid: result.valid, error: result.error, repaired: result.repaired, notes: result.notes, unparsed: result.wires.filter(w => w.type === 'unparsed').map(({span, near, hint, why}) => ({span, near, hint, why})), language: row.parse.language});
  }
  writeJsonl(args.out, predictions);
  if (args.diagnostics) writeJsonl(args.diagnostics, diagnostics);
  const valid = predictions.filter(p => p.valid).length;
  console.error(`converted ${predictions.length}; admitted ${valid}; crashes ${predictions.filter(p => p.outcome === 'crash').length}`);
}

async function predictCommand(args) {
  const rows = suiteRows(args);
  const worker = new StanzaWorker({device: args.device ?? 'cuda'});
  const info = await worker.start();
  const out = [];
  for (const row of rows) {
    const result = await formalize(worker, row.question);
    out.push({id: row.id, sop: result.sop, ms: result.ms, parse_ms: result.parse_ms, convert_ms: result.convert_ms, device: result.device, outcome: result.outcome, valid: result.valid});
  }
  await worker.stop();
  writeJsonl(args.out, out);
  const ms = out.map(r => r.ms).sort((a, b) => a - b);
  const pct = q => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
  console.error(JSON.stringify({rows: out.length, device: info.device, p50_ms: pct(0.5), p90_ms: pct(0.9), mean_ms: ms.reduce((a, b) => a + b, 0) / ms.length}));
}

/** The llama.cpp-compatible formalizer endpoint. Requests are serialized through the one worker. */
export async function serve({host = '127.0.0.1', port = 18960, device = 'cuda'} = {}) {
  const worker = new StanzaWorker({device});
  const ready = worker.start();
  // Without the Stanza worker there is nothing to serve: exit so the process manager reports the error.
  ready.catch(error => { console.error('Stanza worker failed to start: ' + error.message); process.exit(1); });
  let queue = Promise.resolve();
  const reply = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        const state = await Promise.race([ready.then(() => 'ok'), new Promise(resolve => setTimeout(() => resolve('loading'), 50))]);
        return reply(res, state === 'ok' ? 200 : 503, {status: state, device: worker.info?.device ?? null});
      }
      if (req.method === 'GET' && req.url === '/v1/models') return reply(res, 200, {object: 'list', data: [{id: MODEL_ID, object: 'model', owned_by: 'chatsop'}]});
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const message = [...(body.messages ?? [])].reverse().find(m => m.role === 'user')?.content;
        if (typeof message !== 'string') return reply(res, 400, {error: {message: 'expected messages with a user turn'}});
        await ready;
        const job = queue.then(() => formalize(worker, message));
        queue = job.catch(() => {});
        const result = await job;
        return reply(res, 200, {id: 'ud-' + Date.now(), object: 'chat.completion', model: MODEL_ID,
          choices: [{index: 0, message: {role: 'assistant', content: result.sop}, finish_reason: 'stop'}],
          usage: {prompt_tokens: 0, completion_tokens: 0}, timings: {total_ms: result.ms, parse_ms: result.parse_ms, convert_ms: result.convert_ms, device: result.device}});
      }
      reply(res, 404, {error: {message: 'not found'}});
    } catch (error) {
      reply(res, 500, {error: {message: error.message}});
    }
  });
  await new Promise(resolve => server.listen(Number(port), host, resolve));
  const stop = async () => { server.close(); await worker.stop(); process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.error(`ud-rules formalizer listening on http://${host}:${port} (device ${device})`);
  return server;
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command === 'parse') return parseCommand(args);
  if (args.command === 'convert') return convertCommand(args);
  if (args.command === 'predict') return predictCommand(args);
  if (args.command === 'serve') { if (Number(args.port) === 9999) throw Error('port 9999 is reserved for the main server'); return serve({host: args.host, port: args.port ?? 18960, device: args.device ?? 'cuda'}); }
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
