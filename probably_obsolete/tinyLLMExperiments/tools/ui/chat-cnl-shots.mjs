#!/usr/bin/env node
/**
 * Browser check of the chat's "I understood" panel (DS009 "Understanding in the chat"): drives headless Chromium over the DevTools
 * protocol (no dependency; Node's built-in WebSocket) against a server on a private port, sends the example messages in
 * Formalize mode with the SymbolicLM model, accepts the LanguageProofingLLM proposal when there is one, and takes screenshots at
 * 1280 and 390 px into eval/reports/current/chat-cnl/.
 *
 *   node tools/ui/chat-cnl-shots.mjs --base http://127.0.0.1:19411 --token <CHATSOP_API_KEY> [--out eval/reports/current/chat-cnl]
 *       [--only name,name] [--rewrite gated]
 *
 * It never uses port 9999. A session is made with the bearer token's server through the admin password setup of a fresh state
 * directory (`POST /admin/setup`), so it needs a server started on its own state (CHATSOP_CONFIG with another `root`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = args.base ?? 'http://127.0.0.1:19411';
if (new URL(BASE).port === '9999') throw Error('port 9999 is the main server; use a private port');
const OUT = path.resolve(ROOT, args.out ?? 'eval/reports/current/chat-cnl');
const PASSWORD = 'chat-cnl-shots-pass';
const REWRITE = args.rewrite ?? 'gated';

export const SCENARIOS = [
  {name: 'clean-english', message: 'Who manages the Rapid team?', note: 'clean English: verified CNL, certified, no rewrite'},
  {name: 'tangled-rewrite', message: 'Remind me, how many people is the fire engine repaired by?', note: 'tangled English: the SymbolicProofingLLM rewrite is accepted (gated)'},
  {name: 'romanian', message: 'Unde lucrează Maria?', note: 'Romanian: LanguageProofingLLM proposal, then the English interpretation'},
  {name: 'mixed', message: 'Maria works la Lidl and nu știu unde locuiește.', note: 'mixed Romanian and English'},
  {name: 'not-represented', message: 'How many people work at Vertex Analytics, not counting Csaba?', note: 'a span the CNL does not represent, highlighted'},
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-cnl-chromium-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const child = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], {stdio: 'ignore'});
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* not yet */ }
    await sleep(250);
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); if (m.id && pending.has(m.id)) { const {resolve, reject} = pending.get(m.id); pending.delete(m.id); m.error ? reject(Error(m.error.message)) : resolve(m.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; if (process.env.CDP_DEBUG) console.error('cdp', method); pending.set(i, {resolve, reject}); ws.send(JSON.stringify({id: i, method, params})); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? 'evaluation failed'); return r.result.value; };
  const close = () => { try { ws.close(); } catch { /* closed */ } child.kill('SIGTERM'); setTimeout(() => { try { fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5}); } catch { /* temp profile, harmless */ } }, 1500); };
  return {send, evaluate, close};
}

async function session() {
  // The first run on a fresh state sets the administrator password; later runs log in.
  let response = await fetch(`${BASE}/admin/setup`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: PASSWORD})});
  if (!response.ok) response = await fetch(`${BASE}/admin/login`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: PASSWORD})});
  if (!response.ok) throw Error('could not sign in: HTTP ' + response.status);
  return /chatsop_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')[1];
}

async function shot(browser, file, selector = null) {
  let clip;
  if (selector) {
    const box = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:0,y:r.top+scrollY-8,width:innerWidth,height:r.height+16}})()`);
    if (box) clip = {...box, scale: 1};
  }
  const full = clip ?? await browser.evaluate('({x:0,y:0,width:innerWidth,height:Math.min(document.documentElement.scrollHeight,2400)})');
  const {data} = await browser.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: {...full, scale: 1}});
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

async function main() {
  const only = args.only ? args.only.split(',') : null;
  fs.mkdirSync(OUT, {recursive: true});
  const cookie = await session();
  console.error('signed in');
  const browser = await launch();
  console.error('browser up');
  const report = [];
  try {
    await browser.send('Runtime.enable');
    await browser.send('Network.enable');
    await browser.send('Network.setCookie', {name: 'chatsop_session', value: cookie, url: BASE});
    for (const width of [1280, 390]) {
      await browser.send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 600});
      for (const scenario of SCENARIOS.filter(s => !only || only.includes(s.name))) {
        await browser.send('Page.navigate', {url: BASE + '/chat'});
        await sleep(1200);
        await browser.evaluate(`localStorage.clear();localStorage.setItem('chatsop.mode','"formalize"');localStorage.setItem('chatsop.model.formalize','"symbolic-lm"');localStorage.setItem('chatsop.rewrite','"${REWRITE}"');localStorage.setItem('chatsop.cleanSendAll','true');localStorage.setItem('chatsop.current','"shot-${scenario.name}-${width}"');localStorage.setItem('chatsop.conversations','["shot-${scenario.name}-${width}"]')`);
        await browser.send('Page.reload');
        await sleep(1500);
        console.error('sending', scenario.name, width);
        await browser.evaluate(`(()=>{const i=document.getElementById('input');i.value=${JSON.stringify(scenario.message)};document.getElementById('send').click();})()`);
        const started = Date.now();
        let state = 'waiting', reviewed = false;
        while (Date.now() - started < 240000) {
          state = await browser.evaluate(`(()=>{const r=document.getElementById('clean-review');if(r&&!r.hidden)return 'review';if(document.querySelector('#log .msg.assistant .understood'))return 'answered';if(document.querySelector('#log .msg.assistant.error'))return 'error';return 'waiting'})()`);
          if (state === 'review' && !reviewed) {
            reviewed = true;
            await shot(browser, path.join(OUT, `${scenario.name}-${width}-review.png`), '#clean-review');
            await browser.evaluate(`document.querySelector('#clean-review .review-actions button').click()`);
            continue;
          }
          if (state === 'answered' || state === 'error') break;
          if (process.env.CDP_DEBUG && (Date.now() - started) % 5000 < 600) console.error(state, JSON.stringify(await browser.evaluate(`document.getElementById('log').innerText.slice(-300)+' || '+(document.getElementById('clean-review')||{}).innerText`)));
          await sleep(500);
        }
        await sleep(400);
        const summary = await browser.evaluate(`(()=>{const u=document.querySelector('#log .msg.assistant .understood');return {panel:u?u.innerText:null,overflow:document.documentElement.scrollWidth>innerWidth+1,user:[...document.querySelectorAll('#log .msg.user')].map(e=>e.innerText).join(' | ')}})()`);
        await shot(browser, path.join(OUT, `${scenario.name}-${width}.png`), '#log');
        report.push({scenario: scenario.name, width, state, reviewed, ms: Date.now() - started, overflow: summary.overflow, sent: summary.user, panel: summary.panel});
        console.log(JSON.stringify({scenario: scenario.name, width, state, reviewed, overflow: summary.overflow, ms: Date.now() - started}));
      }
    }
    // Dark theme, one scenario.
    await browser.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'dark'}]});
    await shot(browser, path.join(OUT, `dark-${report.at(-1)?.width ?? 390}.png`), '#log');
  } finally {
    fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({base: BASE, rewrite: REWRITE, report}, null, 1) + '\n');
    browser.close();
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
