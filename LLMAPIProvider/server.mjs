#!/usr/bin/env node
// Local LLM API proxy with monitoring and rate control. Usage: node LLMAPIProvider/server.mjs [--port N] [--config file]
import { createProxy } from './proxy.mjs';
import { loadConfig, expandHome, resolveProxyToken } from './settings.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const config = loadConfig(opt('--config'));
const port = Number(opt('--port') || process.env.LLMAPIPROVIDER_PORT || config.port || 18080);
const host = config.host || '127.0.0.1';
const dataDir = expandHome(process.env.LLMAPIPROVIDER_DATA || config.dataDir);
const proxyToken = resolveProxyToken(config);
const { server, upstreams } = createProxy({ config, dataDir, proxyToken });

server.listen(port, host, () => {
  const keys = Object.values(upstreams).map((u) => `${u.name}: key ${u.key ? 'configured' : 'MISSING'}`).join(', ');
  console.log(`LLMAPIProvider listening on http://${host}:${port} (${keys}; client token ${proxyToken ? 'required' : 'not required'}; data ${dataDir})`);
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
