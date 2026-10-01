#!/usr/bin/env node
/**
 * Browser check and cache measurement of the independent capability APIs and the chat page that uses them (DSx030).
 *
 *   node tools/ui/api-ui-shots.mjs --base http://127.0.0.1:19431 [--out eval/reports/current/api-ui] [--rewrite gated]
 *
 * Drives headless Chromium over the DevTools protocol (no dependency, Node's built-in WebSocket) against a server on a private port
 * (never 9999; sign-in through the administrator password of a fresh state directory). It
 *   1. sends example messages in Formalize mode at 1280 and 390 px, accepts the proofreading proposal when there is one, records every
 *      capability call the page makes (url, start, duration, `cache`) and takes screenshots, then a dark-theme screenshot;
 *   2. measures the cache on the HTTP APIs: the chat's formalize request on a message nobody analysed before (cold) against the same kind
 *      of request after `POST /v1/understand` and `POST /v1/emotion/detect` of that message (warm), and each capability twice.
 * Results: <out>/run.json, <out>/cache-measurements.json and the PNG files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = args.base ?? 'http://127.0.0.1:19431';
if (new URL(BASE).port === '9999') throw Error('port 9999 is the main server; use a private port');
const OUT = path.resolve(ROOT, args.out ?? 'eval/reports/current/api-ui');
const PASSWORD = 'api-ui-shots-pass';
const REWRITE = args.rewrite ?? 'gated';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const SCENARIOS = [
  {name: 'thanks-and-question', message: 'Thanks a lot! Who manages the Rapid team?', note: 'a courtesy leftover classified as thanks, then a verified question'},
  {name: 'romanian', message: 'Salut! Unde lucrează Maria?', note: 'Romanian: proofread proposal, greeting classified, English interpretation'},
  {name: 'not-represented', message: 'How many people work at Vertex Analytics, not counting Csaba?', note: 'a span the CNL does not represent: highlighted, clarification suggested'},
];
// Messages for the cold-versus-warm measurement of the formalize request (same kind, never analysed before).
const MEASURE = [
  ['Who supervises the Falcon crew?', 'Who coordinates the Orion crew?'],
  ['Does Ana work at Alpha Lab?', 'Does Bob work at Beta Lab?'],
  ['Where does Maria live?', 'Where does Csaba live?'],
];

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-ui-chromium-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const child = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], {stdio: 'ignore'});
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* not yet */ } await sleep(250); }
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) { const {resolve, reject} = pending.get(m.id); pending.delete(m.id); m.error ? reject(Error(m.error.message)) : resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, {resolve, reject}); ws.send(JSON.stringify({id: i, method, params})); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? 'evaluation failed'); return r.result.value; };
  const close = () => { try { ws.close(); } catch { /* closed */ } child.kill('SIGTERM'); setTimeout(() => { try { fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5}); } catch { /* temp profile */ } }, 1500); };
  return {send, evaluate, close};
}

async function session() {
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

/** Records every same-origin fetch of the page: path, start offset, duration, and the `cache` and `status` of a JSON answer. */
const RECORDER = `(()=>{if(window.__calls)return;window.__calls=[];const t0=performance.now();const orig=window.fetch;
window.fetch=async function(input,init){const url=String(typeof input==='string'?input:input.url);const rec={path:url.replace(location.origin,''),start:Math.round(performance.now()-t0)};window.__calls.push(rec);
try{const r=await orig.apply(this,arguments);rec.http=r.status;rec.ms=Math.round(performance.now()-t0)-rec.start;r.clone().json().then(j=>{rec.cache=j&&j.cache||(j&&j.chatSop&&j.chatSop.understanding&&j.chatSop.understanding.cache)||null;rec.status=j&&j.status||null;rec.compute_ms=j&&j.timings&&j.timings.compute_ms||null;}).catch(()=>{});return r;}catch(e){rec.error=String(e);throw e;}};})()`;

async function http(cookie, method, route, body) {
  const t0 = performance.now();
  const response = await fetch(BASE + route, {method, headers: {Cookie: 'chatsop_session=' + cookie, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
  const json = await response.json().catch(() => null);
  return {status: response.status, ms: Math.round(performance.now() - t0), body: json};
}

async function measure(cookie) {
  const chat = (message, conversation) => http(cookie, 'POST', '/v1/chat/completions', {model: 'symbolic-lm', mode: 'formalize', messages: [{role: 'user', content: message}], conversation_id: conversation, understanding: {interpret: true, rewrite: REWRITE, emotion: true}});
  const rows = [];
  await http(cookie, 'POST', '/v1/cache/clear');
  // Warm the services once so that process start-up is not counted: a different message, then clear the caches again.
  await chat('Who is Zed?', 'warm-up');
  await http(cookie, 'POST', '/v1/cache/clear');
  for (const [i, [cold, warm]] of MEASURE.entries()) {
    const coldChat = await chat(cold, `m${i}c`);
    const coldAgain = await chat(cold, `m${i}c2`);
    const emotion = await http(cookie, 'POST', '/v1/emotion/detect', {message: warm});
    const understood = await http(cookie, 'POST', '/v1/understand', {message: warm, rewrite: REWRITE, emotion: true});
    const warmChat = await chat(warm, `m${i}w`);
    rows.push({cold_message: cold, cold_chat_ms: coldChat.ms, cold_chat_cache: coldChat.body?.chatSop?.understanding?.cache, cold_chat_repeat_ms: coldAgain.ms, cold_chat_repeat_cache: coldAgain.body?.chatSop?.understanding?.cache,
      warm_message: warm, emotion_ms: emotion.ms, emotion_cache: emotion.body?.cache, understand_ms: understood.ms, understand_cache: understood.body?.cache, understand_compute_ms: understood.body?.timings?.compute_ms,
      warm_chat_ms: warmChat.ms, warm_chat_cache: warmChat.body?.chatSop?.understanding?.cache, saved_ms: coldChat.ms - warmChat.ms});
  }
  const twice = [];
  for (const [route, body] of [['/v1/language/proofread', {message: 'Where does the new teacher teach.', sendAll: true}], ['/v1/symbolic/analyze', {message: 'Does Ana like Alpha Lab?'}], ['/v1/symbolic/rewrite', {message: 'Whom does Ana like?', mode: 'always'}], ['/v1/emotion/detect', {message: 'Thanks so much, this is great!'}]]) {
    const first = await http(cookie, 'POST', route, body), second = await http(cookie, 'POST', route, body);
    twice.push({route, first_ms: first.ms, first_cache: first.body?.cache, second_ms: second.ms, second_cache: second.body?.cache, status: first.body?.status});
  }
  return {rewrite: REWRITE, rows, twice, stats: (await http(cookie, 'GET', '/v1/cache/stats')).body};
}

async function main() {
  fs.mkdirSync(OUT, {recursive: true});
  const cookie = await session();
  const browser = await launch();
  const report = [];
  try {
    await browser.send('Runtime.enable');
    await browser.send('Page.enable');
    await browser.send('Network.enable');
    await browser.send('Network.setCookie', {name: 'chatsop_session', value: cookie, url: BASE});
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {source: RECORDER});
    for (const width of [1280, 390]) {
      await browser.send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 600});
      for (const scenario of SCENARIOS) {
        await browser.send('Page.navigate', {url: BASE + '/chat'});
        await sleep(1200);
        await browser.evaluate(`localStorage.clear();localStorage.setItem('chatsop.mode','"formalize"');localStorage.setItem('chatsop.model.formalize','"symbolic-lm"');localStorage.setItem('chatsop.rewrite','"${REWRITE}"');localStorage.setItem('chatsop.cleanSendAll','true');localStorage.setItem('chatsop.cleanBeforeFormalize','true');localStorage.setItem('chatsop.emotion','true');localStorage.setItem('chatsop.showUnderstood','true');localStorage.setItem('chatsop.current','"s${width}${scenario.name}"');localStorage.setItem('chatsop.conversations','["s${width}${scenario.name}"]')`);
        await browser.send('Page.reload');
        await sleep(1500);
        console.error('sending', scenario.name, width);
        await browser.evaluate(`(()=>{const i=document.getElementById('input');i.value=${JSON.stringify(scenario.message)};document.getElementById('send').click();})()`);
        const started = Date.now();
        let state = 'waiting', reviewed = false;
        while (Date.now() - started < 300000) {
          state = await browser.evaluate(`(()=>{const r=document.getElementById('clean-review');if(r&&!r.hidden)return 'review';if(document.querySelector('#log .msg.assistant:not(.muted)'))return 'answered';return 'waiting'})()`);
          if (state === 'review' && !reviewed) {
            reviewed = true;
            await shot(browser, path.join(OUT, `${scenario.name}-${width}-review.png`), '#clean-review');
            await sleep(1500); // the proposal's analysis is prefetched in the background while the user reads it
            await browser.evaluate(`document.querySelector('#clean-review .review-actions button').click()`);
            continue;
          }
          if (state === 'answered') break;
          await sleep(300);
        }
        await sleep(600);
        const summary = await browser.evaluate(`(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,emoji:[...document.querySelectorAll('#log .msg.user .emo-btn')].map(b=>b.textContent+' '+b.title),panel:(document.querySelector('#log .msg.user .understood')||{}).innerText||null,marks:document.querySelectorAll('#log .msg.user mark').length,calls:window.__calls,answer:(document.querySelector('#log .msg.assistant:last-child .txt')||{}).textContent||null}))()`);
        const emoticon = summary.emoji.length ? await browser.evaluate(`(()=>{const b=document.querySelector('#log .msg.user .emo-btn');b.click();return b.parentElement.nextSibling.textContent})()`) : null;
        await shot(browser, path.join(OUT, `${scenario.name}-${width}.png`), '#log');
        const calls = (summary.calls ?? []).filter(c => c.path.startsWith('/v1/') && !c.path.startsWith('/v1/models'));
        report.push({scenario: scenario.name, width, state, reviewed, ms: Date.now() - started, overflow: summary.overflow, emoji: summary.emoji, tooltip_after_tap: emoticon, marks: summary.marks, panel: summary.panel, answer: summary.answer, calls});
        console.log(JSON.stringify({scenario: scenario.name, width, state, reviewed, overflow: summary.overflow, ms: Date.now() - started, calls: calls.map(c => `${c.path} ${c.ms}ms ${c.cache ?? ''}`)}));
      }
    }
    await browser.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'dark'}]});
    await shot(browser, path.join(OUT, `dark-${report.at(-1)?.width ?? 390}.png`), '#log');
  } finally {
    fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({base: BASE, rewrite: REWRITE, report}, null, 1) + '\n');
    browser.close();
  }
  const measurements = await measure(cookie);
  fs.writeFileSync(path.join(OUT, 'cache-measurements.json'), JSON.stringify(measurements, null, 1) + '\n');
  console.log(JSON.stringify({measurements: measurements.rows.map(r => ({cold_chat_ms: r.cold_chat_ms, warm_chat_ms: r.warm_chat_ms, saved_ms: r.saved_ms, repeat_ms: r.cold_chat_repeat_ms})), twice: measurements.twice}));
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
