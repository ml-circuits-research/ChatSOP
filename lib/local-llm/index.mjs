/**
 * The shared local-model facility (DS022 "Formalization strategies: the local runtime"): a process-wide registry of managed
 * llama-server instances, so LocalLLMDirect and LocalLLMStepByStep on the same GGUF share one server with one dedicated slot each.
 *
 *   const server = localServer({gguf: '~/models/qwen3.8-27b/Qwen3.8-27B-UD-Q4_K_M.gguf', port: 19601, slots: ['direct', 'steps']});
 *   await server.ensure(); await server.prewarm('steps', [{role: 'system', content: STABLE}]);
 *   const reply = await localChat({endpoint: server.endpoint, slot: server.slotOf('steps'), messages});
 */
import {LocalLLMServer} from './server.mjs';

export {LocalLLMServer, serverArgs, slotFile, DEFAULT_LLAMA_SERVER, GPU_LOCKS} from './server.mjs';
export {localChat} from './client.mjs';

const servers = new Map();

/** The shared server of a configuration (same GGUF or endpoint and port: same instance). */
export function localServer(settings = {}) {
  const key = settings.endpoint ? `endpoint:${settings.endpoint}` : `gguf:${settings.gguf}:${settings.port ?? 19601}`;
  let server = servers.get(key);
  if (!server) { server = new LocalLLMServer(settings); servers.set(key, server); }
  return server;
}

/** Stops every managed server this process started (shutdown hook of the chat server and of the evaluation runners). */
export async function stopLocalServers() {
  await Promise.all([...servers.values()].map(s => s.stop()));
  servers.clear();
}
