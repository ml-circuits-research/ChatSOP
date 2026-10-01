#!/usr/bin/env node
/**
 * Browser check of the chat page (DS012 "The chat page"): three vertical tabs (Chat, Settings, Base Memory), auto-scroll, composer.
 *
 *   node tools/ui/chat-ui-shots.mjs [--port 19556] [--out eval/reports/current/chat-ui]
 *
 * Starts its own server on a private port (never 9999) over a temporary chat data root, with a stub SymbolicLM service, a stub of
 * the omp CLI (tests/fixtures/omp/stub-omp.mjs, no model is called) and a mock formalizer, signs in through a fresh administrator
 * password, and drives headless Chromium over the DevTools protocol (no dependency, Node's built-in WebSocket) at 1280 and 390 px,
 * light and dark, and checks that the newest message stays in view, the "new messages" pill, the five-line composer and the absence of horizontal
 * scroll. Results: PNG files and run.json.
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
import {loadRegistry, FormalizerManager} from '../../server/formalizers.mjs';
import {ChatData} from '../../lib/chat-data/index.mjs';
import {BaseMemories} from '../../lib/chat-data/memories.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(args.port ?? 19556);
if (PORT === 9999) throw Error('port 9999 is the main server; use a private port');
const OUT = path.resolve(ROOT, args.out ?? 'eval/reports/current/chat-ui');
const PASSWORD = 'chat-ui-shots-pass';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ui-'));
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
  const manager = new FormalizerManager({registry, bin: '/bin/true', startTimeoutMs: 15000, logDir: null});
  const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/runtime.json'), 'utf8'));
  const chatData = ChatData.open({chatData: {root: path.join(dir, 'chat_data')}}, {});
  const memories = new BaseMemories({chatData, memory: runtime.memory});
  memories.importMemory({id: 'lab-demo', name: 'Family demo', strategy: 'sqlite', description: 'Three parent facts and the grandparent rules, for the screenshots.', circuits: [{name: 'family', text: FAMILY}], approvedBy: 'owner'});
  const repo = new Repository(path.join(dir, 'state'));
  repo.init('demo');
  const auth = new Auth({file: path.join(dir, 'state/auth.json')});
  const formalizer = {url: `http://127.0.0.1:${mock.address().port}/v1/chat/completions`, model: 'mock'};
  const server = createServer({config: {promptProfile: 'formal', formalizer, memory: runtime.memory, policy: {allowWrite: true}, omp: {bin: ompBin, defaultModel: 'xai-oauth/grok-4.20-0309-non-reasoning'}},
    repo, lexicon: demoLexicon(), auth, chatData, formalizers: {registry, manager}});
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {dir, close: async () => { await manager.stopAll(); server.closeAllConnections?.(); server.close(); mock.close(); fs.rmSync(dir, {recursive: true, force: true}); }};
}

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ui-chromium-'));
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

async function fresh(browser, base = BASE) {
  await browser.send('Page.navigate', {url: base + '/chat'});
  await sleep(1000);
  await browser.evaluate(`localStorage.clear();localStorage.setItem('chatsop.mode','"formalize"');localStorage.setItem('chatsop.model.formalize','"symbolic-lm"');localStorage.setItem('chatsop.cleanBeforeFormalize','false');localStorage.setItem('chatsop.emotion','false');`);
  await browser.send('Page.reload');
  await until(browser, `document.getElementById('session-info').textContent.includes('base')`, 15000);
  await until(browser, `document.getElementById('omp-model').options.length>2`, 15000);
}
const tab = (browser, name) => browser.evaluate(`document.getElementById('tab-${name}').click()`);
const atBottom = browser => browser.evaluate(`(()=>{const l=document.getElementById('log');return l.scrollHeight-l.scrollTop-l.clientHeight<4})()`);

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
        await browser.send('Emulation.setDeviceMetricsOverride', {width, height: width > 600 ? 900 : 844, deviceScaleFactor: 1, mobile: width < 600});
        await fresh(browser);
        note('empty', {tag, overflow: await overflow(browser), tabs: await browser.evaluate(`[...document.querySelectorAll('[role=tab]')].map(t=>t.textContent+':'+t.getAttribute('aria-selected'))`)});
        await shot(browser, path.join(OUT, `chat-empty-${tag}.png`));

        // Several exchanges: the newest message is always in view.
        for (let i = 0; i < 4; i++) {
          await sendMessage(browser, 'Does Ana like Alpha Lab?');
          if (i === 0) {
            // While the message is processed the composer is blocked and names the stage; a second send is ignored.
            await browser.evaluate(`document.getElementById('send').click()`);
            await until(browser, `!document.getElementById('busy').hidden`, 3000);
            const busy = await browser.evaluate(`({input:document.getElementById('input').disabled,send:document.getElementById('send').disabled,attach:document.getElementById('attach').disabled,text:document.getElementById('busy-text').textContent})`);
            await shot(browser, path.join(OUT, `chat-busy-${tag}.png`));
            note('busy', {tag, ...busy});
          }
          await sleep(300);
          await until(browser, `!document.getElementById('send').disabled`, 30000);
          if (i === 0) note('busy-done', {tag, enabled: await browser.evaluate(`!document.getElementById('input').disabled&&document.getElementById('busy').hidden&&document.activeElement===document.getElementById('input')`), userMessages: await browser.evaluate(`document.querySelectorAll('#log .msg.user').length`)});
        }
        await sleep(500);
        note('scroll-follow', {tag, atBottom: await atBottom(browser), messages: await browser.evaluate(`document.querySelectorAll('#log .msg').length`)});

        // Scrolled up: not pulled down, the pill appears; the pill returns to the bottom.
        await browser.evaluate(`(()=>{const l=document.getElementById('log');l.scrollTop=0;l.dispatchEvent(new Event('scroll'))})()`);
        await sendMessage(browser, 'Does Ana like Alpha Lab?');
        // the send forces the view down; a late answer must not (scroll up again right away)
        await sleep(300);
        await browser.evaluate(`(()=>{const l=document.getElementById('log');l.scrollTop=0;l.dispatchEvent(new Event('scroll'))})()`);
        await until(browser, `!document.getElementById('send').disabled`, 30000);
        await sleep(600);
        const pill = await browser.evaluate(`({hidden:document.getElementById('scroll-hint').hidden,top:document.getElementById('log').scrollTop})`);
        await shot(browser, path.join(OUT, `chat-pill-${tag}.png`));
        await click(browser, '#scroll-hint');
        await sleep(300);
        note('new-messages-pill', {tag, ...pill, backAtBottom: await atBottom(browser)});

        // The composer grows to five lines.
        const lines = await browser.evaluate(`(()=>{const t=document.getElementById('input');t.value=Array(9).fill('line').join('\\n');t.dispatchEvent(new Event('input',{bubbles:true}));const h=t.offsetHeight;t.value='';t.dispatchEvent(new Event('input',{bubbles:true}));return h})()`);
        note('composer', {tag, grownHeight: lines});

        // Coding agent: attached file only, progress card, draft with Accept/Reject.
        await browser.evaluate(`(()=>{PROD.files.push({name:'lab-safety-manual.txt',text:${JSON.stringify(MANUAL)}});renderChips();})()`);
        await sendMessage(browser, 'Compile the attached manual into circuits.');
        await until(browser, `document.querySelector('.agent-msg .status')&&/writing|validating|queued/.test(document.querySelector('.agent-msg .status').textContent)`, 20000);
        await shot(browser, path.join(OUT, `chat-agent-progress-${tag}.png`));
        await until(browser, `document.querySelector('.agent-msg fieldset')`, 60000);
        await sleep(500);
        note('agent-card', {tag, atBottom: await atBottom(browser), overflow: await overflow(browser)});
        await shot(browser, path.join(OUT, `chat-agent-draft-${tag}.png`));
        await browser.evaluate(`[...document.querySelectorAll('.agent-msg .actions button')].find(b=>b.textContent.startsWith('Accept')).click()`);
        await sleep(600);

        // Scope note with Yes/No, and the collapsed "I understood" line.
        await sendMessage(browser, 'Every researcher must wear goggles.');
        await until(browser, `document.querySelector('.route-note.scope .scope-ask button')`, 30000);
        await sleep(500);
        await shot(browser, path.join(OUT, `chat-scope-note-${tag}.png`));
        note('scope-note', {tag, collapsed: await browser.evaluate(`[...document.querySelectorAll('.understood')].every(d=>!d.open)`), askVisible: await browser.evaluate(`document.querySelector('.route-note.scope .scope-ask button').offsetParent!==null`), atBottom: await atBottom(browser)});
        await browser.evaluate(`document.querySelector('.understood>summary').click()`);
        await sleep(300);
        await shot(browser, path.join(OUT, `chat-understood-open-${tag}.png`));

        await tab(browser, 'settings');
        await sleep(300);
        await shot(browser, path.join(OUT, `settings-${tag}.png`));
        note('settings', {tag, overflow: await overflow(browser), alwaysOff: await browser.evaluate(`!document.getElementById('authoring-always').checked`), models: await browser.evaluate(`document.getElementById('omp-model').options.length`)});
        await browser.evaluate(`document.getElementById('panel-settings').scrollTo(0,99999)`);
        await sleep(200);
        await shot(browser, path.join(OUT, `settings-bottom-${tag}.png`));

        await tab(browser, 'memory');
        await until(browser, `document.querySelectorAll('#mem-rows tr').length>=2`, 8000);
        await sleep(300);
        await shot(browser, path.join(OUT, `memory-${tag}.png`));
        note('memory', {tag, overflow: await overflow(browser), rows: await browser.evaluate(`document.querySelectorAll('#mem-rows tr').length`)});
        await browser.evaluate(`[...document.querySelectorAll('#mem-rows button')].find(b=>b.textContent==='View').click()`);
        await until(browser, `document.getElementById('view-dialog').open&&document.getElementById('view-body').textContent.includes('strategy')`, 8000);
        await sleep(300);
        await shot(browser, path.join(OUT, `memory-view-${tag}.png`));
        await click(browser, '#view-close');
        await browser.evaluate(`[...document.querySelectorAll('#mem-rows tr')].find(r=>r.textContent.includes('Family demo')).querySelectorAll('button')[1].click()`);
        await setValue(browser, '#fork-name', 'Copy ' + tag);
        await click(browser, '#fork-go');
        await until(browser, `document.getElementById('fork-msg').textContent.startsWith('Forked')`, 8000);
        await shot(browser, path.join(OUT, `memory-fork-${tag}.png`));
        await click(browser, '#fork-cancel');
        await browser.evaluate(`[...document.querySelectorAll('#mem-rows button')].find(b=>b.textContent==='Add knowledge').click()`);
        await browser.evaluate(`document.getElementById('know-text').value='@bad nonsense\\n'`);
        await click(browser, '#know-go');
        await until(browser, `/Added|Not added/.test(document.getElementById('know-msg').textContent)`, 8000);
        await shot(browser, path.join(OUT, `memory-add-knowledge-error-${tag}.png`));
        note('add-knowledge', {tag, message: await browser.evaluate(`document.getElementById('know-msg').textContent.slice(0,200)`)});
        await click(browser, '#know-cancel');
        // Start a session with a base: switches to the chat.
        await browser.evaluate(`[...document.querySelectorAll('#mem-rows tr')].find(r=>r.textContent.includes('Family demo')).querySelector('button.primary').click()`);
        await until(browser, `document.getElementById('panel-chat').hidden===false&&document.getElementById('session-info').textContent.includes('Family demo')`, 8000);
        await sleep(300);
        await shot(browser, path.join(OUT, `chat-new-session-${tag}.png`));
        await click(browser, '#new');
        await until(browser, `document.getElementById('start-dialog').open&&document.getElementById('start-base').options.length>1`, 8000);
        await shot(browser, path.join(OUT, `new-session-dialog-${tag}.png`));
        note('new-session', {tag, overflow: await overflow(browser), session: await browser.evaluate(`document.getElementById('session-info').textContent`)});
        await click(browser, '#start-cancel');
      }
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({base: BASE, errors: browser.errors, report}, null, 1) + '\n');
    browser.close();
    await stack.close();
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
