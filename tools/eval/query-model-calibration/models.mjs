/**
 * The models of the calibration (experiment eval-query-model-calibration-v1), still used by the symbolic-vs-llm harness (its local
 * model list and llama-server settings). The calibration runner itself measured one-shot circuit authoring and was archived on
 * 2026-10-02 with it (probably_obsolete/one-shot-formalization/tools/eval/query-model-calibration/).
 *   kind remote      a model behind the local proxy (`<provider>/<model>`, lib/llm-providers.mjs) through the completion backend
 *   kind local       a GGUF served by llama.cpp `llama-server` on a private port, used through the completion backend
 */
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
export const LLAMA_SERVER = process.env.LLAMA_SERVER ?? path.join(HOME, 'llama-cpp-venv/llama.cpp/build/bin/llama-server');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

const noThink = {chat_template_kwargs: {enable_thinking: false}};

export const MODELS = {
  qwen27b: {kind: 'remote', model: 'openference/Qwen3.8 27b', cost_class: 'subscription', note: 'openference plan through the local proxy, one message per round'},
  'qwen3-4b-q4': {kind: 'local', gguf: path.join(HOME, 'models/local-judge/Qwen3-4B-Instruct-2507-Q4_K_M.gguf'), name: 'Qwen3-4B-Instruct-2507 Q4_K_M', port: 19511, ctx: 32768, params_b: 4},
  'qwen3-4b-q8': {kind: 'local', gguf: path.join(HOME, 'models/local-judge/Qwen3-4B-Instruct-2507-Q8_0.gguf'), name: 'Qwen3-4B-Instruct-2507 Q8_0', port: 19512, ctx: 32768, params_b: 4},
  'qwen3-1.7b-q8': {kind: 'local', gguf: path.join(ROOT, 'models/proofing/gguf/qwen3-1.7b-q8_0.gguf'), name: 'Qwen3-1.7B Q8_0', port: 19513, ctx: 32768, params_b: 1.7, extraBody: noThink},
  nemotron: {kind: 'local', gguf: path.join(HOME, 'models/NVIDIA-Nemotron-3-Nano-Omni/nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf'), name: 'Nemotron-3-Nano-Omni Q8_0', port: 19514, ctx: 32768, params_b: 30, extraBody: noThink},
  deepseek: {kind: 'remote', model: 'openrouter/deepseek/deepseek-v4-flash', cost_class: 'paid_api', note: 'larger paid reference through the proxy (OpenRouter)'},
};

/** Models whose gguf is on the CPU run: same file, `-ngl 0`, 4 threads (the laptop thread count of cpu-speed-table.json). */
export const CPU_VARIANT = {'qwen3-4b-q4': {id: 'qwen3-4b-q4-cpu', port: 19515, threads: 4, ngl: 0}};
