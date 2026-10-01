#!/usr/bin/env node
/**
 * Browser check of the product layer of the chat page (DS031): sessions, base memories, the coding agent.
 *
 *   node tools/ui/product-ui-shots.mjs [--port 19611] [--out eval/reports/current/product/screenshots]
 *
 * Starts its own server on a private port (never 9999) over a temporary chat data root, with a stub SymbolicLM service, a stub of
 * the omp CLI (tests/fixtures/omp/stub-omp.mjs, no model is called) and a mock formalizer, signs in through a fresh administrator
 * password, and drives headless Chromium over the DevTools protocol (no dependency, Node's built-in WebSocket) at 1280 and 390 px,
 * light and dark: the chat page with the session bar and settings, the start-session dialog, the base memory manager (fork and add
 * knowledge), an attached file going to the coding agent (route note, progress, draft circuit, accept), and a detected SymbolicLM
 * failure routed to the coding agent. Results: PNG files and run.json (overflow checks, console errors, what each step saw).
 */
import {demoLexicon} from '../../lib/knowledge-seeds.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Repository} from '../../memory/repository.mjs';
import {Lexicon} from '../../sop/lexicon.mjs';
import {createServer} from '../../server/http.mjs';
import {Auth} from '../../server/auth.mjs';
import {loadRegistry, ModelManager} from '../../server/formalizers.mjs';
import {ChatData} from '../../lib/chat-data/index.mjs';
import {BaseMemories} from '../../lib/chat-data/memories.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(args.port ?? 19611);
if (PORT === 9999) throw Error('port 9999 is the main server; use a private port');
const OUT = path.resolve(ROOT, args.out ?? 'eval/reports/current/product/screenshots');
const PASSWORD = 'product-ui-shots-pass';
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const MANUAL = `Fictitious lab safety manual (excerpt, for a screenshot).
1. Every researcher who works in the wet lab must wear goggles.
2. Maria works in the wet lab. Csaba works in the dry lab.
`;
const AUTHORED = `@works_in predicate
  args subject:entity location:entity

@researcher predicate
  args subject:entity

@wears_goggles predicate
  args subject:entity

@f_maria fact
  holds researcher maria
  source "2. Maria works in the wet lab."

@f_maria_wet fact
  holds works_in maria wet_lab
  source "2. Maria works in the wet lab."

@n_goggles norm
  oblige wears_goggles ?r
  when researcher ?r
  when works_in ?r wet_lab
  binding strict
  source "1. Every researcher who works in the wet lab must wear goggles."
`;
const FAMILY = fs.readFileSync(path.join(ROOT, 'eval/smoke-reasoning/cases/03-rules-chaining/knowledge.sop'), 'utf8');

async function startStack({port = PORT, ompBin = path.join(ROOT, 'tests/fixtures/omp/stub-omp.mjs')} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-ui-'));
  const good = path.join(dir, 'good.sop');
  fs.writeFileSync(good, AUTHORED);
  Object.assign(process.env, {STUB_OMP_MODE: 'good', STUB_OMP_GOOD: good, STUB_OMP_DELAY_MS: '2500', STUB_OMP_LOG: path.join(dir, 'omp-calls.jsonl')});
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({data: [{id: 'mock'}]})); }
    for await (const part of req) void part;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: '@q query\n  where match\n    relation "likes"\n    role subject "Ana"\n    role object "Alpha Lab"\n    polarity affirmed\n  end'}, finish_reason: 'stop'}]}));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const registryFile = path.join(dir, 'formalizers.json');
  fs.writeFileSync(registryFile, JSON.stringify({default: 'symbolic-lm', models: [{id: 'symbolic-lm', label: 'SymbolicLM (stub)', service: path.join(ROOT, 'tests/fixtures/omp/stub-symbolic-scope.mjs'), rewrite: {mode: 'off'}}]}));
  const registry = loadRegistry(registryFile, {root: dir});
  const manager = new ModelManager({registry, bin: '/bin/true', startTimeoutMs: 15000, logDir: null});
  const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/runtime.json'), 'utf8'));
  const chatData = ChatData.open({chatData: {root: path.join(dir, 'chat_data')}}, {});
  const memories = new BaseMemories({chatData, memory: runtime.memory});
  memories.importMemory({id: 'lab-demo', name: 'Family demo', strategy: 'sqlite', description: 'Three parent facts and the grandparent rules, for the screenshots.', circuits: [{name: 'family', text: FAMILY}], approvedBy: 'owner'});
  const repo = new Repository(path.join(dir, 'state'));
  repo.init('demo');
  const auth = new Auth({file: path.join(dir, 'state/auth.json')});
  const formalizer = {url: `http://127.0.0.1:${mock.address().port}/v1/chat/completions`, model: 'mock'};
  const server = createServer({config: {memory: runtime.memory, policy: {allowWrite: true}, omp: {bin: ompBin, defaultModel: 'xai-oauth/grok-4.20-0309-non-reasoning'}},
    repo, lexicon: demoLexicon(), auth, chatData, formalizers: {registry, manager}});
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {dir, close: async () => { await manager.stopAll(); server.closeAllConnections?.(); server.close(); mock.close(); fs.rmSync(dir, {recursive: true, force: true}); }};
}

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-ui-chromium-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const child = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], {stdio: 'ignore'});
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* not yet */ } await sleep(250); }
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.id && pending.has(m.id)) { const {resolve, reject} = pending.get(m.id); pending.delete(m.id); m.error ? reject(Error(m.error.message)) : resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, {resolve, reject}); ws.send(JSON.stringify({id: i, method, params})); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? 'evaluation failed'); return r.result.value; };
  const close = () => { try { ws.close(); } catch { /* closed */ } child.kill('SIGTERM'); setTimeout(() => { try { fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5}); } catch { /* temp */ } }, 500); };
  return {send, evaluate, close, errors};
}

async function signIn(base = BASE) {
  const response = await fetch(`${base}/admin/setup`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: PASSWORD})});
  if (!response.ok) throw Error('could not set the password: HTTP ' + response.status);
  return /chatsop_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')[1];
}

async function shot(browser, file, selector = null) {
  let clip;
  // The composer is sticky; in a tall capture it would cover the middle of the conversation.
  await browser.evaluate(`(()=>{const c=document.querySelector('.composer');if(c)c.style.position=${selector ? "'static'" : "''"}})()`);
  if (selector) {
    const box = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:0,y:Math.max(0,r.top+scrollY-8),width:innerWidth,height:Math.min(r.height+16,3000)}})()`);
    if (box) clip = {...box, scale: 1};
  }
  const full = clip ?? await browser.evaluate('({x:0,y:0,width:innerWidth,height:Math.min(document.documentElement.scrollHeight,2600)})');
  const {data} = await browser.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: {...full, scale: 1}});
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

/** Waits until `expression` is truthy in the page, up to `ms`. */
async function until(browser, expression, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await browser.evaluate(expression).catch(() => false)) return true; await sleep(250); }
  return false;
}

const click = (browser, selector) => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const setValue = (browser, selector, value) => browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const sendMessage = (browser, text) => browser.evaluate(`(()=>{const i=document.getElementById('input');i.value=${JSON.stringify(text)};document.getElementById('send').click();})()`);
const overflow = browser => browser.evaluate('document.documentElement.scrollWidth>innerWidth+1');

async function fresh(browser, cookie, base = BASE) {
  await browser.send('Page.navigate', {url: base + '/chat'});
  await sleep(1000);
  await browser.evaluate(`localStorage.clear();localStorage.setItem('chatsop.mode','"formalize"');localStorage.setItem('chatsop.model.formalize','"symbolic-lm"');localStorage.setItem('chatsop.cleanBeforeFormalize','false');localStorage.setItem('chatsop.emotion','false');`);
  await browser.send('Page.reload');
  await until(browser, `document.getElementById('session-info').textContent.includes('base')`, 15000);
  await until(browser, `document.getElementById('omp-model').options.length>2`, 15000);
}

async function main() {
  fs.mkdirSync(OUT, {recursive: true});
  const stack = await startStack();
  const cookie = await signIn();
  const browser = await launch();
  const report = [];
  const note = (name, extra) => { report.push({name, ...extra}); console.log(JSON.stringify({name, ...extra})); };
  try {
    await browser.send('Runtime.enable');
    await browser.send('Page.enable');
    await browser.send('Network.enable');
    await browser.send('Network.setCookie', {name: 'chatsop_session', value: cookie, url: BASE});
    for (const dark of [false, true]) {
      await browser.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: dark ? 'dark' : 'light'}]});
      for (const width of [1280, 390]) {
        const tag = `${width}${dark ? '-dark' : ''}`;
        await browser.send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 600});
        await fresh(browser, cookie);
        await browser.evaluate(`document.getElementById('settings').open=true`);
        await shot(browser, path.join(OUT, `01-chat-session-bar-${tag}.png`));
        note('chat-session-bar', {tag, overflow: await overflow(browser), session: await browser.evaluate(`document.getElementById('session-info').textContent`), models: await browser.evaluate(`document.getElementById('omp-model').options.length`), ompNote: await browser.evaluate(`document.getElementById('omp-note').textContent`)});

        await click(browser, '#session-start');
        await until(browser, `document.getElementById('start-dialog').open&&document.getElementById('start-base').options.length>1`, 8000);
        await setValue(browser, '#start-base', 'lab-demo');
        await sleep(300);
        await shot(browser, path.join(OUT, `02-start-session-dialog-${tag}.png`));
        note('start-dialog', {tag, overflow: await overflow(browser), detail: await browser.evaluate(`document.getElementById('start-detail').textContent`)});
        await click(browser, '#start-go');
        await until(browser, `!document.getElementById('start-dialog').open&&document.getElementById('session-info').textContent.includes('Family demo')`, 8000);

        await click(browser, '#mem-open');
        await until(browser, `document.getElementById('mem-dialog').open&&document.getElementById('mem-detail').textContent.includes('stored facts')`, 8000);
        await setValue(browser, '#fork-name', 'Family demo (exact copy)');
        await setValue(browser, '#fork-strategy', 'scan');
        await click(browser, '#fork-go');
        await until(browser, `document.getElementById('mem-msg').textContent.startsWith('Forked')`, 8000);
        await browser.evaluate(`document.getElementById('know-text').value='@fx fact\\n  holds parent di eve\\n  source "screenshot"\\n';document.getElementById('know-name').value='extra';document.getElementById('know-reason').value='screenshot demo'`);
        await click(browser, '#know-go');
        await until(browser, `/Added|Not added/.test(document.getElementById('mem-msg').textContent)`, 8000);
        await browser.evaluate(`document.getElementById('mem-dialog').scrollTo(0,0)`);
        await shot(browser, path.join(OUT, `03-base-memory-manager-${tag}.png`));
        note('memory-manager', {tag, overflow: await overflow(browser), message: await browser.evaluate(`document.getElementById('mem-msg').textContent`)});
        await click(browser, '#mem-close');

        // An attached file goes to the coding agent: route note, progress, the draft with its validation, accept.
        await browser.evaluate(`(()=>{PROD.files.push({name:'lab-safety-manual.txt',text:${JSON.stringify(MANUAL)}});renderChips();})()`);
        await sendMessage(browser, 'Compile the attached manual into circuits.');
        await until(browser, `document.querySelector('.agent-msg .status')&&/writing|validating|queued/.test(document.querySelector('.agent-msg .status').textContent)`, 20000);
        await shot(browser, path.join(OUT, `04-coding-agent-progress-${tag}.png`), '#log');
        const done = await until(browser, `document.querySelector('.agent-msg fieldset')`, 60000);
        await sleep(300);
        await shot(browser, path.join(OUT, `05-coding-agent-draft-${tag}.png`), '#log');
        const draft = await browser.evaluate(`(()=>{const f=document.querySelector('.agent-msg');return {status:f&&f.querySelector('.status').textContent,route:(document.querySelector('.route-note')||{}).textContent,valid:(f.querySelector('.pill')||{}).textContent}})()`);
        note('coding-agent', {tag, done, overflow: await overflow(browser), ...draft});
        await browser.evaluate(`[...document.querySelectorAll('.agent-msg .actions button')].find(b=>b.textContent.startsWith('Accept')).click()`);
        await until(browser, `document.querySelector('.agent-msg .msgline.ok')`, 8000);
        await sleep(300);
        await shot(browser, path.join(OUT, `06-draft-accepted-${tag}.png`));
        note('accepted', {tag, session: await browser.evaluate(`document.getElementById('session-info').textContent`), message: await browser.evaluate(`(document.querySelector('.agent-msg .msgline.ok')||{}).textContent`)});

        // A rule sentence: the scope note quotes the cue and the wire types and asks; "Yes" sends it to the coding agent.
        await sendMessage(browser, 'Every researcher must wear goggles.');
        await until(browser, `document.querySelector('.route-note.scope .scope-ask button')`, 30000);
        await sleep(300);
        await shot(browser, path.join(OUT, `07-scope-note-ask-${tag}.png`), '#log');
        note('scope-note', {tag, overflow: await overflow(browser), note: await browser.evaluate(`document.querySelector('.route-note.scope').textContent`)});
        await click(browser, '.route-note.scope .scope-ask button.primary');
        await until(browser, `document.querySelectorAll('.agent-msg').length>=2&&document.querySelectorAll('.agent-msg')[1].querySelector('.status').textContent.length>0`, 20000);
        await until(browser, `document.querySelectorAll('.agent-msg fieldset').length>=2`, 60000);
        await sleep(300);
        await shot(browser, path.join(OUT, `08-scope-yes-draft-${tag}.png`), '#log');
        // A detected SymbolicLM failure (the stub marks "UNSURE" sentences uncertain): the note asks; "No" sends nothing.
        await sendMessage(browser, 'The lab rules UNSURE somehow apply to everyone.');
        await until(browser, `[...document.querySelectorAll('.route-note.scope .scope-ask button')].some(b=>!b.disabled)`, 30000);
        await browser.evaluate(`[...document.querySelectorAll('.route-note.scope .scope-ask button')].filter(b=>!b.disabled).find(b=>b.textContent==='No').click()`);
        await sleep(600);
        await shot(browser, path.join(OUT, `09-failure-suggestion-declined-${tag}.png`), '#log');
        note('failure-suggestion', {tag, overflow: await overflow(browser), notes: await browser.evaluate(`[...document.querySelectorAll('.route-note.scope')].map(n=>n.textContent).slice(-1)`)});
        // Mark only: the same kind of sentence is marked and nothing is asked.
        await setValue(browser, '#scope-select', 'mark');
        await sleep(500);
        await sendMessage(browser, 'Every researcher must wear goggles.');
        await until(browser, `document.querySelectorAll('.route-note.scope').length>=3`, 30000);
        await sleep(300);
        await shot(browser, path.join(OUT, `10-scope-note-mark-only-${tag}.png`), '#log');
        note('scope-mark-only', {tag, overflow: await overflow(browser), asked: await browser.evaluate(`document.querySelectorAll('.route-note.scope')[2].querySelectorAll('.scope-ask').length`)});
        await setValue(browser, '#scope-select', 'ask');

        // A plain question stays with SymbolicLM and shows the path and why.
        await sendMessage(browser, 'Does Ana like Alpha Lab?');
        await until(browser, `document.querySelectorAll('.route-note').length>=6&&document.querySelector('#log .msg.assistant:not(.muted):not(.agent-msg):last-child')`, 30000);
        await sleep(500);
        await shot(browser, path.join(OUT, `11-symbolic-path-${tag}.png`), '#log');
        note('symbolic-path', {tag, overflow: await overflow(browser), routes: await browser.evaluate(`[...document.querySelectorAll('.route-note')].map(n=>n.textContent).slice(-1)`)});
      }
    }
    // omp unavailable: an attached file falls back to SymbolicLM and the page says so.
    const down = await startStack({port: PORT + 1, ompBin: '/nonexistent/omp'});
    try {
      const downBase = `http://127.0.0.1:${PORT + 1}`;
      const downCookie = await signIn(downBase);
      await browser.send('Network.setCookie', {name: 'chatsop_session', value: downCookie, url: downBase});
      for (const width of [1280, 390]) {
        await browser.send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 600});
        await fresh(browser, downCookie, downBase);
        await browser.evaluate(`document.getElementById('settings').open=true`);
        await browser.evaluate(`(()=>{PROD.files.push({name:'lab-safety-manual.txt',text:${JSON.stringify(MANUAL)}});renderChips();})()`);
        await sendMessage(browser, 'Compile the attached manual into circuits.');
        await until(browser, `document.querySelector('.route-note.fallback')&&document.querySelector('#log .msg.assistant:not(.muted)')`, 30000);
        await sleep(500);
        await shot(browser, path.join(OUT, `12-omp-unavailable-fallback-${width}.png`));
        note('omp-unavailable', {width, overflow: await overflow(browser), route: await browser.evaluate(`(document.querySelector('.route-note')||{}).textContent`), ompNote: await browser.evaluate(`document.getElementById('omp-note').textContent`)});
      }
    } finally { await down.close(); }
  } finally {
    fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({base: BASE, errors: browser.errors, report}, null, 1) + '\n');
    browser.close();
    await stack.close();
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
