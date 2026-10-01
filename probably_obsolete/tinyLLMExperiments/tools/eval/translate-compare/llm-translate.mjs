#!/usr/bin/env node
/**
 * Local-LLM translation arm of the translate-compare study: a CPU llama-server (OpenAI-compatible chat endpoint), one sentence per call, greedy, plain instruction.
 *   node tools/eval/translate-compare/llm-translate.mjs --endpoint URL --arm NAME [--messages N] [--quote [--quoted-in FILE]] [--in FILE]
 * Resumable (rows already in arms/NAME.jsonl are kept); `--messages N` limits to the sentences of the first N messages (staged evaluation).
 * `--quote` reads in-jargon.jsonl (quoted jargon) and adds the instruction to keep quoted spans verbatim.
 */
import path from 'node:path';
import {T, readJsonl, writeJsonl, armFile, items, wordCount} from './lib.mjs';

const a = process.argv.slice(2), val = k => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
const endpoint = val('--endpoint'), arm = val('--arm'), n = val('--messages') ? Number(val('--messages')) : Infinity, quote = a.includes('--quote');
const SYSTEM = 'Translate the user message into English. The message is Romanian (often without diacritics, with typos, run-on sentences and English or project words mixed in), written by a software developer to an AI assistant. Keep the meaning exactly; do not answer it, do not add or drop anything, do not explain. Keep file names, code, identifiers and English words as written.'
  + (quote ? ' Text in double quotes is a project term: keep it exactly as written, inside the same double quotes.' : '') + ' Output only the English translation.';
const input = quote ? new Map(readJsonl(path.join(T, val('--quoted-in') ?? 'in-jargon.jsonl')).map(r => [r.id, r.text])) : null;
const done = new Map(readJsonl(armFile(arm)).map(r => [r.id, r]));
for (const s of items(val('--in'))) {
  if (s.mi >= n || done.has(s.id)) continue;
  const text = input ? input.get(s.id) : s.text;
  const t0 = performance.now();
  let out = '', error = null, tokens = null;
  try {
    const res = await fetch(`${endpoint}/v1/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({messages: [{role: 'system', content: SYSTEM}, {role: 'user', content: text}], temperature: 0, max_tokens: Math.min(700, wordCount(text) * 3 + 60), chat_template_kwargs: {enable_thinking: false}})});
    const j = await res.json();
    out = (j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); tokens = j.usage?.completion_tokens ?? null;
  } catch (e) { error = String(e.message).slice(0, 100); }
  done.set(s.id, {id: s.id, out, ms: performance.now() - t0, tokens, ...(error ? {error} : {})});
  writeJsonl(armFile(arm), [...done.values()]);
}
console.log(JSON.stringify({arm, rows: done.size}));
