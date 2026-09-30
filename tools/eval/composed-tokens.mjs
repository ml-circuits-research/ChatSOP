#!/usr/bin/env node
/** Token lengths of the composed cases under the Gemma 3 270M tokenizer, and of the proofreader training set (DS008 "Composed evaluation suites").
 *
 *   node tools/eval/composed-tokens.mjs --url http://127.0.0.1:PORT [--suite-root eval/suites]
 *
 * The tokenizer is the vocabulary of the fine-tuned model's GGUF, served by a llama-server (its `/tokenize` endpoint; nothing is
 * generated). Training-style length is the length the trainer measured: BOS + the Gemma chat template around the prompt and the
 * target (reproduces `max_tokens` 547 of models/gemma/proofreader-gemma270m-v1/proofreader/tokenization.json). For every case of
 * eval/suites/<dataset>/test-composed.jsonl it writes eval/suites/<dataset>/test-composed.tokens.json (a sidecar, so the sealed rows
 * stay unchanged): prompt tokens, target tokens, training-style total and the flags beyond the training p99 and maximum. The training
 * distribution comes from datasets_archive/proofing/proofreader/train.jsonl.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../lib/jsonl-shards.mjs';
import {ROOT, archived, THREE_DATASETS} from '../../lib/dataset-paths.mjs';

const template = (prompt, target) => `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>model\n${target}<end_of_turn>\n`;
export const tokenizer = url => async (content, special = false) => {
  const res = await fetch(`${url.replace(/\/$/, '')}/tokenize`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content, add_special: special, parse_special: special})});
  if (!res.ok) throw Error(`tokenize ${res.status}`);
  return (await res.json()).tokens.length;
};
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const summary = values => { const s = values.slice().sort((a, b) => a - b); return {rows: s.length, p50: quantile(s, 0.5), p90: quantile(s, 0.9), p99: quantile(s, 0.99), max: s[s.length - 1]}; };

export async function trainingDistribution(count, root = ROOT) {
  const rows = readJsonlShardedSync(path.join(root, archived('proofing/proofreader/train.jsonl')));
  const totals = [], prompts = [];
  for (const r of rows) { totals.push(await count(template(r.prompt, r.target), true)); prompts.push(await count(r.prompt)); }
  return {source: 'datasets_archive/proofing/proofreader/train.jsonl', total: summary(totals), prompt: summary(prompts)};
}

export async function annotate(suiteRoot, count, train) {
  const out = {};
  for (const dataset of THREE_DATASETS) {
    const file = path.join(suiteRoot, dataset, 'test-composed.jsonl');
    if (!jsonlExists(file)) continue;
    const cases = {};
    for (const row of readJsonlShardedSync(file)) {
      const prompt = await count(row.message), target = await count(row.expected_text), total = await count(template(row.message, row.expected_text), true);
      cases[row.id] = {prompt, target, train_style_total: total, beyond_train_p99: total > train.total.p99, beyond_train_max_total: total > train.total.max, beyond_train_max_prompt: prompt > train.prompt.max};
    }
    const values = Object.values(cases);
    const sidecar = {format: 'chatsop-composed-tokens-v1', dataset, tokenizer: 'Gemma 3 270M vocabulary (GGUF of models/gemma/proofreader-gemma270m-v1), via llama-server /tokenize', training: train, cases,
      summary: {cases: values.length, total: summary(values.map(v => v.train_style_total)), beyond_train_p99: values.filter(v => v.beyond_train_p99).length, beyond_train_max_total: values.filter(v => v.beyond_train_max_total).length, beyond_train_max_prompt: values.filter(v => v.beyond_train_max_prompt).length}};
    fs.writeFileSync(path.join(suiteRoot, dataset, 'test-composed.tokens.json'), JSON.stringify(sidecar) + '\n');
    console.log(`${dataset}: ${JSON.stringify(sidecar.summary)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), get = k => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
  const url = get('url');
  if (!url) { console.error('usage: composed-tokens.mjs --url http://127.0.0.1:PORT [--suite-root DIR]'); process.exit(2); }
  const count = tokenizer(url);
  const train = await trainingDistribution(count);
  console.log(`training: total ${JSON.stringify(train.total)}, prompt ${JSON.stringify(train.prompt)}`);
  await annotate(path.resolve(ROOT, get('suite-root') ?? 'eval/suites'), count, train);
}
