#!/usr/bin/env node
/**
 * Start one managed local model server with the optimised flags of lib/local-llm (DS022 "Formalization strategies: the local
 * runtime") and keep it running until Ctrl-C, so the chat server (configured with the same `queryParser.local.endpoint`) or an
 * evaluation can use a loaded model. Without this tool the chat server starts and stops the same server itself.
 *
 *   node tools/local-llm/serve.mjs --gguf ~/models/qwen3.8-27b/Qwen3.8-27B-UD-Q4_K_M.gguf --port 19601 --alias qwen3.8-27b --slots direct,steps
 */
import {LocalLLMServer, serverArgs} from '../../lib/local-llm/index.mjs';
import {prewarmStrategies} from '../../lib/formalize/strategies.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
if (args.includes('--help') || !opt('--gguf')) {
  console.log('node tools/local-llm/serve.mjs --gguf FILE [--port 19601] [--alias local] [--slots direct,steps] [--ctx-per-slot 8192] [--no-prewarm]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const server = new LocalLLMServer({gguf: opt('--gguf'), port: Number(opt('--port', 19601)), alias: opt('--alias', 'local'), slots: opt('--slots', 'direct,steps').split(','), ctxPerSlot: Number(opt('--ctx-per-slot', 8192))});
console.log('llama-server', serverArgs(server).join(' '));
await server.ensure();
if (!args.includes('--no-prewarm')) console.log('prewarm', JSON.stringify(await prewarmStrategies(server)));
console.log(`ready ${server.endpoint} (pid ${server.child?.pid}); Ctrl-C stops it`);
const stop = async () => { await server.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
