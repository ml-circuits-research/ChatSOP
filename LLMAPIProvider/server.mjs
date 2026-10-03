#!/usr/bin/env node
// TEMPORARY shim (phase 1 of the TinyAgent migration; removed in phase 2, TODO.md): the code moved to TinyAgent/. This starts the
// TinyAgent core with this folder's config.json, data folders and prompts, exactly as the proxy did, for the agents still using it.
// New work: node TinyAgent/bin/tinyagent.mjs serve.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createProxy } from '../TinyAgent/lib/core.mjs';
import { expandHome, resolveProxyToken } from '../TinyAgent/lib/settings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const config = { ...JSON.parse(readFileSync(opt('--config') ?? `${HERE}/config.json`, 'utf8')), compat: { oldHeaders: true } };
const port = Number(opt('--port') || config.port || 18080);
const host = config.host || '127.0.0.1';
const dataDir = expandHome(config.dataDir);
const { server, upstreams, starters } = createProxy({ config, configDir: HERE, dataDir, proxyToken: resolveProxyToken(config) });
server.listen(port, host, () => console.log(`proxy (TinyAgent core, compatibility shim) on http://${host}:${port}; ${Object.values(upstreams).map((u) => `${u.name}: ${u.noKey ? 'local' : u.key ? 'key configured' : 'no key'}`).join(', ')}`));
const onDemand = () => Object.entries(starters).filter(([n]) => !config.upstreams[n].start?.startAtBoot).map(([, st]) => st.stop());
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await Promise.all(onDemand()); server.close(() => process.exit(0)); });
