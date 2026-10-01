#!/usr/bin/env node
/** Evaluation shim: exposes the shipped textToCleanEnglish step (LanguageTool + Qwen3-1.7B, cheap gate, masking) as an OpenAI-style
 * /v1/chat/completions endpoint so that tools/eval/composed-score.mjs can call it like any rewriter (`--endpoint http://127.0.0.1:PORT`).
 * The user turn of the request is the sentence; the reply is the step's `clean` text. Started and stopped by the operator of the evaluation;
 * it calls the operator's own LanguageTool and llama-server ports and starts nothing.
 *
 *   node tools/eval/language-proofing-shipped-server.mjs --port 8634 --lt http://127.0.0.1:18133 --llm http://127.0.0.1:8633
 */
import http from 'node:http';
import {textToCleanEnglish, loadTextToCleanEnglishConfig} from '../../lib/text-to-clean-english/index.mjs';

const o = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) o[process.argv[i].slice(2)] = process.argv[i + 1];
const base = loadTextToCleanEnglishConfig();
const config = {...base, languagetool: {...base.languagetool, url: o.lt}};
http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  let text = '';
  try { text = JSON.parse(body).messages.at(-1).content; } catch { res.writeHead(400).end('bad request'); return; }
  let out = text;
  try { out = (await textToCleanEnglish(text, {config, backendOptions: {endpoint: o.llm}})).clean; } catch { /* degrades to no change, like the host */ }
  res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({choices: [{message: {role: 'assistant', content: out}, finish_reason: 'stop'}]}));
}).listen(Number(o.port ?? 8634), '127.0.0.1', () => console.error(`shipped shim on ${o.port ?? 8634}`));
