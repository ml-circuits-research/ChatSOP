#!/usr/bin/env node
/** Runs a judge calibration set against a local OpenAI-compatible endpoint (llama.cpp `llama-server`).
 *
 * Experiment eval-local-judge-v1. It replays the exact item files that were judged by DeepSeek flash and Haiku:
 *   - parse judge:   datasets_sources/parse_judge_deepseek/input/items.jsonl   with SYSTEM_a.txt, SYSTEM_c.txt
 *   - meaning judge: datasets_sources/meaning_judge_calibration_v2/input/items.jsonl with SYSTEM_m1.txt, SYSTEM_m2.txt, SYSTEM_m1r.txt
 * Each item is sent on its own: the system prompt of the item's condition is the whole system message and the item's
 * `user` text the whole user message. Greedy decoding (temperature 0, fixed seed), prompt cache off. The answer is the
 * first balanced JSON object of the reply (as the DeepSeek driver did); a reply without a verdict is retried up to 3 times.
 *
 *   node tools/research/local-judge.mjs run --endpoint http://127.0.0.1:18300 --folder datasets_sources/parse_judge_deepseek \
 *        --out /path/verdicts.jsonl [--parallel 4] [--limit N] [--ids FILE] [--conditions a,c] [--thinking on|off]
 *        [--max-tokens 1536] [--label NAME] [--stride K]   # every K-th item of each condition
 *
 * Output rows: {id, condition, answer, ms, prompt_tokens, completion_tokens, tries, raw?}; resume is by (id, condition).
 * `<out>.stats.jsonl` records one line per invocation with wall seconds, items per minute and token counts. The run uses no GPU of its own; it
 * only talks to a server the caller started. Scoring: tools/research/local-judge-score.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const OPTIONS = ['endpoint', 'folder', 'out', 'parallel', 'limit', 'ids', 'conditions', 'thinking', 'max-tokens', 'label', 'stride', 'model'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !OPTIONS.includes(name)) throw Error(`Unknown option ${argv[i]}`);
    if (argv[i + 1] === undefined) throw Error(`Missing value for ${argv[i]}`);
    out[name] = argv[++i];
  }
  for (const name of ['endpoint', 'folder', 'out']) if (!out[name]) throw Error(`--${name} is required`);
  return out;
}

const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(x => x.trim()).map(JSON.parse) : []);

/** The first balanced JSON object in `text`, or null. */
export function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

const hasVerdict = a => a && typeof a === 'object' && (a.verdict !== undefined || a.preserves !== undefined);

/** One chat completion; resolves {content, prompt_tokens, completion_tokens, ms}. */
export async function complete({endpoint, system, user, thinking, maxTokens, model}) {
  const body = {model: model ?? 'local', temperature: 0, seed: 7, max_tokens: maxTokens, cache_prompt: false, stream: false,
    messages: [{role: 'system', content: system}, {role: 'user', content: user}]};
  body.chat_template_kwargs = {enable_thinking: thinking === 'on'}; // Qwen3 and Qwen3.5 templates; ignored by templates without the switch
  const t0 = Date.now();
  const res = await fetch(`${endpoint}/v1/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  if (!res.ok) throw Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return {content: json.choices?.[0]?.message?.content ?? '', prompt_tokens: json.usage?.prompt_tokens ?? 0, completion_tokens: json.usage?.completion_tokens ?? 0, ms: Date.now() - t0};
}

export async function run(args) {
  const folder = path.resolve(args.folder);
  let items = readJsonl(path.join(folder, 'input/items.jsonl'));
  if (args.conditions) { const keep = new Set(args.conditions.split(',')); items = items.filter(i => keep.has(i.condition)); }
  if (args.ids) { const keep = new Set(readJsonl(args.ids).map(r => r.id ?? r)); items = items.filter(i => keep.has(i.id)); }
  if (args.stride) { const seen = {}; items = items.filter(i => (seen[i.condition] = (seen[i.condition] ?? -1) + 1) % Number(args.stride) === 0); } // every K-th item of each condition
  if (args.limit) items = items.slice(0, Number(args.limit));
  const systems = {};
  for (const c of new Set(items.map(i => i.condition))) systems[c] = fs.readFileSync(path.join(folder, `SYSTEM_${c}.txt`), 'utf8');
  const out = path.resolve(args.out);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  const done = new Map(readJsonl(out).map(r => [`${r.id}|${r.condition}`, r]));
  const todo = items.filter(i => !done.has(`${i.id}|${i.condition}`));
  const thinking = args.thinking ?? 'off', maxTokens = Number(args['max-tokens'] ?? (thinking === 'on' ? 6144 : 1536)), parallel = Number(args.parallel ?? 4);
  const fd = fs.openSync(out, 'a');
  const t0 = Date.now();
  let next = 0, finished = 0, unresolved = 0, errors = 0;
  const worker = async () => {
    while (next < todo.length) {
      const item = todo[next++];
      let answer = null, raw = '', tries = 0, last = {prompt_tokens: 0, completion_tokens: 0, ms: 0}, totalMs = 0, totalCompletion = 0, totalPrompt = 0;
      while (tries < 3 && !hasVerdict(answer)) {
        tries++;
        try {
          last = await complete({endpoint: args.endpoint, system: systems[item.condition], user: item.user, thinking, maxTokens, model: args.model});
          raw = last.content; answer = extractJson(raw);
          totalMs += last.ms; totalCompletion += last.completion_tokens; totalPrompt += last.prompt_tokens;
        } catch (error) { errors++; raw = `error: ${error.message}`; await new Promise(r => setTimeout(r, 1000 * tries)); }
        if (tries === 1 && hasVerdict(answer)) break;
      }
      const ok = hasVerdict(answer);
      if (!ok) unresolved++;
      const row = {id: item.id, condition: item.condition, answer: ok ? answer : {verdict: null, preserves: null, note: 'UNRESOLVED'}, ms: totalMs, prompt_tokens: totalPrompt, completion_tokens: totalCompletion, tries};
      if (!ok) row.raw = raw.slice(0, 600);
      fs.writeSync(fd, JSON.stringify(row) + '\n');
      if (++finished % 50 === 0) console.log(`progress ${finished}/${todo.length} ${((Date.now() - t0) / 1000).toFixed(0)}s unresolved ${unresolved}`);
    }
  };
  await Promise.all(Array.from({length: parallel}, worker));
  fs.closeSync(fd);
  const rows = readJsonl(out);
  const seconds = (Date.now() - t0) / 1000;
  const stats = {label: args.label ?? null, endpoint: args.endpoint, thinking, parallel, max_tokens: maxTokens, items_requested: items.length, items_run_now: todo.length, items_total_in_file: rows.length,
    wall_seconds: seconds, items_per_minute: todo.length ? todo.length / (seconds / 60) : null, unresolved_now: unresolved, transport_errors: errors,
    mean_prompt_tokens: mean(rows.map(r => r.prompt_tokens)), mean_completion_tokens: mean(rows.map(r => r.completion_tokens)), total_completion_tokens: rows.reduce((s, r) => s + r.completion_tokens, 0), total_prompt_tokens: rows.reduce((s, r) => s + r.prompt_tokens, 0), finished_at: new Date().toISOString()};
  fs.appendFileSync(`${out}.stats.jsonl`, JSON.stringify(stats) + '\n'); // one line per invocation (resumed runs add lines)
  console.log(JSON.stringify(stats));
  return stats;
}
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'run') { console.error('usage: local-judge.mjs run --endpoint URL --folder DIR --out FILE [options]'); process.exit(2); }
  run(parseArgs(rest)).catch(error => { console.error(error.message); process.exit(1); });
}
