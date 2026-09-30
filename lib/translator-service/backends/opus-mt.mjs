/**
 * TranslatorService backend `opus-mt`: batch CPU translation through a Helsinki-NLP OPUS-MT MarianMT checkpoint
 * (training/python/translate_marian.py in `~/mt-venv`, dependencies.md "TranslatorService"). Research backend
 * only, exercised by tools/research/translator-compare-eval.mjs (experiment `eval-translator-compare-v1`); never
 * called by SymbolicLM. Names, numbers and quoted spans are masked (lib/ud-to-sop/protect.mjs) before the model
 * sees the text and restored after, so the translator cannot invent or mistranslate a name or a number — though it
 * can still mangle a placeholder token itself (recorded as a `dropped`/`duplicated` placeholder by `restore`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {protect, restore} from '../../ud-to-sop/protect.mjs';

export const OPUS_MT_VERSION = 'translator-service-opus-mt-v1';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const DEFAULTS = Object.freeze({
  pythonBin: path.join(os.homedir(), 'mt-venv/bin/python'),
  script: path.join(ROOT, 'training/python/translate_marian.py'),
  model: path.join(ROOT, 'models/opus-mt/bases/e9ca9975e3972afd80732f08ce01d3a1339f47f8'),
  threads: 4,
  batch: 16,
});

/** Is the opus-mt backend usable here (venv + model on disk)? Returns a reason string, or null when it is. */
export function missing({pythonBin = DEFAULTS.pythonBin, model = DEFAULTS.model} = {}) {
  if (!fs.existsSync(pythonBin)) return `no Python at ${pythonBin} (expected the mt-venv virtualenv)`;
  if (!fs.existsSync(path.join(model, 'model.safetensors')) && !fs.existsSync(path.join(model, 'pytorch_model.bin'))) return `no model weights under ${model}`;
  return null;
}

/**
 * Translate a batch of Romanian (or Romance-language) messages to English. `items`: `[{id, text}]`. Each message
 * is masked (names/numbers/quotes) before translation and restored after. Returns
 * `{results: Map<id, {text, masked, maskedTranslation, restore}>, timing}` where `timing` is the Python script's
 * batched-throughput report (`messages_per_second`, not a per-request latency).
 */
export function translateBatch(items, {pythonBin = DEFAULTS.pythonBin, script = DEFAULTS.script, model = DEFAULTS.model, threads = DEFAULTS.threads, batch = DEFAULTS.batch} = {}) {
  const bad = missing({pythonBin, model});
  if (bad) throw Error(`TranslatorService opus-mt backend unavailable: ${bad}`);
  const masks = new Map(items.map(({id, text}) => [id, protect(text)]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-opus-mt-'));
  const suite = path.join(tmp, 'suite.jsonl');
  const out = path.join(tmp, 'out.jsonl');
  const timingFile = path.join(tmp, 'timing.json');
  fs.writeFileSync(suite, items.map(({id}) => JSON.stringify({id, question: masks.get(id).text})).join('\n') + '\n');
  const proc = spawnSync(pythonBin, [script, '--model', model, '--suite', suite, '--out', out, '--timing', timingFile, '--device', 'cpu', '--threads', String(threads), '--batch', String(batch)], {encoding: 'utf8'});
  if (proc.status !== 0) throw Error(`translate_marian.py failed (exit ${proc.status}): ${proc.stderr?.slice(-4000)}`);
  const translated = fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const timing = JSON.parse(fs.readFileSync(timingFile, 'utf8'));
  const results = new Map();
  for (const row of translated) {
    const mask = masks.get(row.id);
    const restored = restore(row.question, mask.slots);
    results.set(row.id, {text: restored.text, masked: mask.text, maskedTranslation: row.question, restore: {kept: restored.kept, dropped: restored.dropped, duplicated: restored.duplicated, invented: restored.invented, preserved: restored.preserved}});
  }
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* best effort */ }
  return {results, timing};
}
