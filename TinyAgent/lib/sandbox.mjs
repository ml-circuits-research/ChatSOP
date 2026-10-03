// The sandbox of generated SkillPlugins: a small JavaScript program written on the fly by a model (`async function run(api, input)`)
// is UNTRUSTED code. It runs
//   - in a worker thread of its own with V8 resource limits (heap, young generation, code range, stack), an empty environment, no
//     stdin, captured stdout/stderr, terminated after a wall-time limit;
//   - inside that worker, in a fresh V8 context (node:vm) whose global object has only the ECMAScript built-ins: no require, import,
//     process, console, timers, fetch, Buffer or WebAssembly; code generation from strings and WebAssembly are disabled (eval and
//     Function("…") throw);
//   - with ONE capability: a message channel to an allow-listed subset of the TinyAgent API (`api.chat`, `api.listInputs`,
//     `api.readInput`, `api.writeOutput`, `api.log`), checked by the host (tiers, call count, sizes, names). Only strings and numbers
//     cross the boundary: arguments and results are JSON text parsed inside the context, the host's bridge function never throws into
//     the context and never returns an object, so no object of the worker or of the host (and so no host `Function`) is reachable.
// node:vm alone is not a security boundary; the worker bounds time and memory and holds nothing but this bootstrap. The program text is
// written to the run folder before it runs, for audit.
import { Worker } from 'node:worker_threads';

export const PLUGIN_LIMITS = Object.freeze({ timeMs: 120000, heapMb: 128, youngMb: 32, codeMb: 16, stackMb: 4, maxCodeBytes: 20000, maxResultBytes: 200000, syncMs: 2000 });

// The worker's own code (CommonJS, evaluated from this string).
const BOOTSTRAP = `
const {parentPort, workerData} = require('node:worker_threads');
const vm = require('node:vm');
const {code, inputJson, syncMs, maxResultBytes} = workerData;
const pending = new Map();
let next = 1, finished = false;
const done = (m) => { if (finished) return; finished = true; parentPort.postMessage(m); };
// The host side of the bridge: takes (op string, args JSON string), returns a call id (a number) or 0; never throws, never returns an object.
function hostCall(op, argsJson) {
  try {
    if (typeof op !== 'string' || typeof argsJson !== 'string' || argsJson.length > 4000000) return 0;
    const id = next++;
    pending.set(id, true);
    parentPort.postMessage({type: 'call', id, op: String(op), args: String(argsJson)});
    return id;
  } catch { return 0; }
}
function hostDone(ok, text) {
  try {
    if (typeof text !== 'string') return done({type: 'done', ok: false, code: 'plugin_no_result', message: 'the result is not JSON text'});
    if (text.length > maxResultBytes) return done({type: 'done', ok: false, code: 'plugin_result_limit', message: 'the result is larger than ' + maxResultBytes + ' bytes'});
    done({type: 'done', ok: ok === true, json: ok === true ? text : null, code: ok === true ? null : 'plugin_error', message: ok === true ? null : text.slice(0, 500)});
  } catch { done({type: 'done', ok: false, code: 'plugin_error', message: 'unreadable result'}); }
}
try {
  const context = vm.createContext(Object.create(null), {codeGeneration: {strings: false, wasm: false}, name: 'skillPlugin'});
  vm.runInContext('for (const k of ["WebAssembly", "SharedArrayBuffer", "Atomics", "FinalizationRegistry", "WeakRef", "console"]) delete globalThis[k];', context);
  // The bridge, defined inside the context: in-context promises, settled by the host with primitives only.
  const BRIDGE = '(function (hostCall, hostDone) {"use strict";' +
    'const pending = new Map();' +
    'const call = (op, args) => new Promise((res, rej) => { const id = hostCall(op, JSON.stringify(args === undefined ? null : args)); if (typeof id !== "number" || id <= 0) { rej(new Error("refused: " + op)); return; } pending.set(id, {res, rej}); });' +
    'const settle = (id, ok, text) => { const p = pending.get(id); if (!p) return; pending.delete(id); if (ok) { let v; try { v = JSON.parse(text); } catch (e) { p.rej(new Error("bad reply")); return; } p.res(v); } else p.rej(new Error(String(text))); };' +
    'const api = Object.freeze({chat: (o) => call("chat", o), listInputs: () => call("listInputs"), readInput: (name) => call("readInput", {name}), writeOutput: (name, text) => call("writeOutput", {name, text}), log: (message) => call("log", {message})});' +
    'const finish = (ok, v) => { let text; try { text = ok ? JSON.stringify(v === undefined ? null : v) : String(v && v.message || v); } catch (e) { ok = false; text = "the result cannot be written as JSON"; } hostDone(ok, typeof text === "string" ? text : "null"); };' +
    'return {api, settle, finish};})';
  const bridge = new vm.Script(BRIDGE, {filename: 'bridge.js'}).runInContext(context, {timeout: syncMs})(hostCall, hostDone);
  parentPort.on('message', (m) => { if (m && m.type === 'reply' && pending.has(m.id)) { pending.delete(m.id); bridge.settle(m.id, m.ok === true, String(m.text)); } });
  const PROGRAM = '(function (api, inputJson, finish) {"use strict";\\n' + code + '\\n;if (typeof run !== "function") throw new Error("the plugin must define async function run(api, input)");' +
    'let r; try { r = run(api, JSON.parse(inputJson)); } catch (e) { finish(false, e); return; }' +
    'Promise.resolve(r).then((v) => finish(true, v), (e) => finish(false, e));})';
  const start = new vm.Script(PROGRAM, {filename: 'plugin.js'}).runInContext(context, {timeout: syncMs});
  start(bridge.api, inputJson, bridge.finish);
} catch (error) {
  const message = String(error && error.message || error).slice(0, 300);
  done({type: 'done', ok: false, code: /timed out/.test(message) ? 'plugin_time_limit' : /Code generation from strings disallowed/.test(message) ? 'code_generation_refused' : /Unexpected|SyntaxError|Invalid or unexpected/.test(message) ? 'plugin_syntax' : 'plugin_error', message});
}
`;

/**
 * Runs a generated plugin. `api` is the host implementation of the allow-listed operations: `{chat(args), listInputs(), readInput(args),
 * writeOutput(args), log(args)}`, each returning a JSON-serialisable value or throwing (a refusal). Returns {ok, value, calls, ms} or
 * {ok: false, code, message, calls, ms}.
 */
export async function runPlugin(code, input = null, api = {}, limits = {}) {
  const L = { ...PLUGIN_LIMITS, ...limits }, t0 = Date.now();
  if (typeof code !== 'string' || !code.trim()) return { ok: false, code: 'plugin_empty', message: 'no program', calls: 0, ms: 0 };
  if (Buffer.byteLength(code) > L.maxCodeBytes) return { ok: false, code: 'plugin_too_long', message: `the program is longer than ${L.maxCodeBytes} bytes`, calls: 0, ms: 0 };
  const inputJson = JSON.stringify(input ?? null);
  const worker = new Worker(BOOTSTRAP, { eval: true, workerData: { code, inputJson, syncMs: L.syncMs, maxResultBytes: L.maxResultBytes },
    env: {}, argv: [], execArgv: [], stdin: false, stdout: true, stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: L.heapMb, maxYoungGenerationSizeMb: L.youngMb, codeRangeSizeMb: L.codeMb, stackSizeMb: L.stackMb } });
  worker.stdout.resume(); worker.stderr.resume();
  let calls = 0;
  const OPS = new Set(['chat', 'listInputs', 'readInput', 'writeOutput', 'log']);
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { resolve({ ok: false, code: 'plugin_time_limit', message: `the plugin ran longer than ${L.timeMs} ms` }); worker.terminate(); }, L.timeMs);
    worker.on('message', async (m) => {
      if (m?.type === 'done') { clearTimeout(timer); resolve(m); return; }
      if (m?.type !== 'call') return;
      calls += 1;
      let reply;
      try {
        if (!OPS.has(m.op) || typeof api[m.op] !== 'function') throw new Error(`operation ${m.op} is not allowed`);
        const value = await api[m.op](JSON.parse(m.args));
        reply = { type: 'reply', id: m.id, ok: true, text: JSON.stringify(value ?? null) };
      } catch (e) { reply = { type: 'reply', id: m.id, ok: false, text: String(e?.message ?? e).slice(0, 500) }; }
      try { worker.postMessage(reply); } catch { /* the worker ended */ }
    });
    worker.once('error', (error) => { clearTimeout(timer); resolve({ ok: false, code: error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'plugin_memory_limit' : 'plugin_crashed', message: String(error?.message ?? error).slice(0, 300) }); });
    worker.once('exit', (exitCode) => { clearTimeout(timer); resolve({ ok: false, code: 'plugin_crashed', message: `the sandbox exited (${exitCode}) before the plugin finished` }); });
  });
  await worker.terminate().catch(() => {});
  const ms = Date.now() - t0;
  if (!result.ok) return { ok: false, code: result.code, message: result.message, calls, ms };
  try { return { ok: true, value: JSON.parse(result.json), calls, ms }; } catch { return { ok: false, code: 'plugin_no_result', message: 'the result is not JSON', calls, ms }; }
}
