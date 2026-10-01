#!/usr/bin/env node
/** Export review of LanguageProofingLLM GGUF quantizations (experiment train-language-proofing-gemma270m-prod1, hypothesis H9; it3 reported only 92.5% HF to Q8_0 agreement).
 *
 *   node tools/research/proofing-quant-compare.mjs --run language-proofing-gemma270m-prod1 --epoch 2 --hf lp-prod1 [--quants f16,bf16,q8_0,q6_k] [--port 18711] [--threads 4]
 *
 * Steps (all CPU, no GPU, no training): the merged epoch model is copied to a scratch `gguf-src/epN` with the tokenizer.json recipe of the earlier iterations (the stock converter does not
 * know the Gemma pre-tokenizer; the patched converter of ~/proofreader-export-venv is used), converted to f16 / bf16 / q8_0, q6_k is made from f16 with llama-quantize, and each GGUF is
 * served with `llama-server -ngl 0 -t THREADS -c 4096` (a private port, never 9999) and asked for the 599 judged-sample units one after the other (greedy, the message-only prompt).
 * Output per quantization: outputs/NAME-<quant>__test600.jsonl under $LP_WORK, and `quant-compare.json` with the agreement against the HF bf16 greedy outputs (`--hf` arm,
 * outputs/<hf>__test600.jsonl), the mechanical composite (clean-English gate and content preserved) of each arm, file size and CPU speed (output tokens per second).
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {WORK, loadSplit} from '../eval/language-proofing-eval.mjs';
import {norm} from '../datasets/language-proofing/pairs.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const run = arg('--run'), epoch = arg('--epoch'), hf = arg('--hf'), port = Number(arg('--port', 18711)), threads = arg('--threads', '4'), quants = arg('--quants', 'f16,bf16,q8_0,q6_k').split(',');
const model = path.join(ROOT, 'models/gemma', run, 'proofreader'), src = path.join(model, 'gguf-src', `ep${epoch}`), outDir = path.join(model, 'gguf'), merged = path.join(model, `merged-epoch-${epoch}`);
const CONV = path.join(process.env.HOME, 'proofreader-export-venv/llama-cpp-conv/convert_hf_to_gguf.py'), PY = path.join(process.env.HOME, 'proofreader-export-venv/bin/python');
const LLAMA = path.join(process.env.HOME, 'llama-cpp-venv/llama.cpp/build/bin');
const REF_TOKENIZER = path.join(ROOT, 'models/gemma/language-proofing-gemma270m-it3/proofreader/gguf-src/ep2');
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, {encoding: 'utf8', ...opts}); if (r.status !== 0) throw Error(`${cmd} failed: ${(r.stderr || '').slice(-600)}`); return r; };

fs.mkdirSync(src, {recursive: true}); fs.mkdirSync(outDir, {recursive: true});
if (!fs.existsSync(path.join(src, 'model.safetensors'))) {
  for (const f of ['model.safetensors', 'config.json', 'generation_config.json', 'chat_template.jinja', 'recall-export.json']) if (fs.existsSync(path.join(merged, f))) fs.copyFileSync(path.join(merged, f), path.join(src, f));
  for (const f of ['tokenizer.json', 'tokenizer_config.json']) fs.copyFileSync(path.join(REF_TOKENIZER, f), path.join(src, f));
}
const file = q => path.join(outDir, `ep${epoch}-${q}.gguf`);
for (const q of quants) {
  if (fs.existsSync(file(q))) continue;
  if (q === 'q6_k') { if (!fs.existsSync(file('f16'))) sh(PY, [CONV, src, '--outtype', 'f16', '--outfile', file('f16')]); sh(path.join(LLAMA, 'llama-quantize'), [file('f16'), file(q), 'Q6_K']); }
  else sh(PY, [CONV, src, '--outtype', q, '--outfile', file(q)]);
}
const rows = loadSplit('test', 600), hfOut = new Map(readJsonl(path.join(WORK, 'outputs', `${hf}__test600.jsonl`)).map(r => [r.id, r.output]));
const results = {run, epoch, hf_arm: hf, units: rows.length, threads: Number(threads), quants: {}};
for (const q of quants) {
  const server = spawn(path.join(LLAMA, 'llama-server'), ['-m', file(q), '-ngl', '0', '-t', threads, '-c', '4096', '--port', String(port), '--host', '127.0.0.1', '--jinja'], {stdio: 'ignore'});
  try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)); }
    const records = [];
    for (const r of rows) {
      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: r.prompt}], temperature: 0, top_k: 1, seed: 0, cache_prompt: false, max_tokens: 400})});
      const data = await res.json(), choice = data.choices?.[0];
      records.push({id: r.id, output: String(choice?.message?.content ?? '').trim(), in_tokens: data.usage?.prompt_tokens ?? null, out_tokens: data.usage?.completion_tokens ?? null, truncated: choice?.finish_reason === 'length', ms: Date.now() - t0, device: 'llama.cpp'});
    }
    const name = `${hf}-${q}`;
    fs.writeFileSync(path.join(WORK, 'outputs', `${name}__test600.jsonl`), records.map(x => JSON.stringify(x)).join('\n') + '\n');
    const agree = records.filter(x => norm(x.output) === norm(hfOut.get(x.id) ?? '')).length, ms = records.map(x => x.ms).sort((a, b) => a - b), toks = records.reduce((n, x) => n + (x.out_tokens ?? 0), 0), total = records.reduce((n, x) => n + x.ms, 0);
    const first50 = rows.slice(0, 50).filter(r => norm(records.find(x => x.id === r.id).output) === norm(hfOut.get(r.id) ?? '')).length;
    results.quants[q] = {file: path.relative(ROOT, file(q)), size_mb: Math.round(fs.statSync(file(q)).size / 1e5) / 10, agreement_with_hf: {k: agree, n: records.length, pct: Math.round(1000 * agree / records.length) / 10}, agreement_first50: first50, ms_p50: ms[Math.floor(ms.length / 2)], ms_mean: Math.round(total / records.length), out_tokens_per_s: Math.round(10 * toks / (total / 1000)) / 10};
    console.log(JSON.stringify({quant: q, ...results.quants[q]}));
  } finally { server.kill('SIGTERM'); await new Promise(r => setTimeout(r, 1500)); }
}
fs.writeFileSync(path.join(WORK, 'quant-compare.json'), JSON.stringify(results, null, 1) + '\n');
