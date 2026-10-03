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
const { server, upstreams, starters } = createProxy({ config, dataDir, proxyToken });

server.listen(port, host, () => {
  const keys = Object.values(upstreams).map((u) => `${u.name}: ${u.noKey ? 'no key needed' + (u.start ? ', started on demand' : '') : 'key ' + (u.key ? 'configured' : 'MISSING')}`).join(', ');
  console.log(`LLMAPIProvider listening on http://${host}:${port} (${keys}; client token ${proxyToken ? 'required' : 'not required'}; data ${dataDir})`);
});
// On shutdown the on-demand local servers this proxy started are stopped too (an orphan would hold GPU memory and never idle-stop);
// always-on servers (startAtBoot) stay and are reused by the next start.
const onDemand = () => Object.entries(starters).filter(([n]) => !config.upstreams[n].start?.startAtBoot).map(([, st]) => st.stop());
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await Promise.all(onDemand()); server.close(() => process.exit(0)); });
