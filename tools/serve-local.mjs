#!/usr/bin/env node
/** Convenience launcher for the local server: documentation site, admin page and
 * the OpenAI-compatible chat API on one port.
 *
 *   npm start                       # 0.0.0.0:9999 (all interfaces) — docs, admin, corpus audit and chat
 *   CHATSOP_PORT=9000 npm start
 *   CHATSOP_HOST=127.0.0.1 npm start # loopback only
 *
 * Open the home URL in a browser: it links to the chat, the corpus audit, the
 * admin page and the documentation. On the first run the sign-in page asks for
 * the administrator password; the chat API stays blocked until it is set.
 * `CHATSOP_API_KEY` keeps working as an environment-provided bearer token for
 * scripts and SDKs, and `CHATSOP_CONFIG` selects another runtime configuration.
 */
import os from 'node:os';
import {startServer} from '../server/http.mjs';
import {assert} from '../lib/util.mjs';

const host = process.env.CHATSOP_HOST ?? '0.0.0.0';
const port = Number(process.env.CHATSOP_PORT ?? 9999);
if (!process.env.CHATSOP_PROMPT_PROFILE) process.env.CHATSOP_PROMPT_PROFILE = 'formal';

const server = await startServer({host, port, ...(process.env.CHATSOP_CONFIG ? {configPath: process.env.CHATSOP_CONFIG} : {})});
const address = server.address();
assert(address && typeof address === 'object', 'Server did not report an address');
const shown = host === '0.0.0.0'
  ? ['127.0.0.1', ...Object.values(os.networkInterfaces()).flat().filter(entry => entry && entry.family === 'IPv4' && !entry.internal).map(entry => entry.address)]
  : [host];

console.log(`\nChatSOP server on ${host}:${address.port}`);
console.log('\nOpen the home page in a browser, sign in, then use Chat, Corpus audit, Admin and Docs:');
for (const base of shown) console.log(`  home          : http://${base}:${address.port}/`);
const [first] = shown;
console.log(`\n  chat          : http://${first}:${address.port}/chat`);
console.log(`  corpus audit  : http://${first}:${address.port}/audit`);
console.log(`  evaluation    : http://${first}:${address.port}/eval`);
console.log(`  status        : http://${first}:${address.port}/project`);
console.log(`  admin         : http://${first}:${address.port}/admin`);
console.log(`  documentation : http://${first}:${address.port}/docs/`);
console.log(`  chat API      : http://${first}:${address.port}/v1/chat/completions  (bearer token or session cookie)`);
if (shown.length > 1) console.log('  (the same paths work on every address listed above)');
if (server.auth?.configured) {
  console.log('  authentication: administrator password already set');
} else if (server.auth?.apiKey) {
  console.log('  authentication: open the home URL and choose the administrator password (CHATSOP_API_KEY is accepted meanwhile)');
} else {
  console.log('  authentication: open the home URL in a browser and choose the administrator password');
}
console.log(`  prompt profile: ${process.env.CHATSOP_PROMPT_PROFILE}`);
console.log('\nChat answers 503 until a formalizer endpoint is configured and ready; documentation, admin and audit work immediately. The home page shows the formalizer state.');
if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') console.log('Remote binding: the documentation path is unauthenticated, so expose this only on a trusted network.');
console.log('Stop with Ctrl+C.\n');
