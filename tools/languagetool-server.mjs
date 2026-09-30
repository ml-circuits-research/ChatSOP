#!/usr/bin/env node
/** Starts the local LanguageTool HTTP server that the `languagetool` backend of textToCleanEnglish calls
 * (lib/text-to-clean-english/backends/languagetool.mjs, DS012 "textToCleanEnglish", dependencies.md). It is an
 * operator step: `npm start` and `npm test` never spawn it, and an unreachable server degrades to "no change".
 *
 *   node tools/languagetool-server.mjs [--port 18123] [--host 127.0.0.1] [--dir models/languagetool/LanguageTool-5.9] [--java /usr/bin/java]
 *   node tools/languagetool-server.mjs --check [--port 18123]        # exit 0 when the server answers /v2/check
 *
 * Install once (no root, nothing system-wide; models/ is gitignored, so the 231 MB archive is never committed):
 *   curl -L -o models/languagetool/LanguageTool-5.9.zip https://languagetool.org/download/archive/LanguageTool-5.9.zip
 *   unzip -q models/languagetool/LanguageTool-5.9.zip -d models/languagetool/
 * LanguageTool 5.9 runs under the host's Java 8 through its plain `HTTPServer` class (the jar's own Main-Class is the
 * HTTPS server and demands --config); 6.x needs Java 17. The server runs in the foreground; stop it with Ctrl+C or
 * by killing the process you started.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => item.startsWith('--') ? [...pairs, [item.slice(2), all[index + 1]?.startsWith('--') || all[index + 1] === undefined ? true : all[index + 1]]] : pairs, []));
const port = Number(args.port ?? 18123);
const host = String(args.host ?? '127.0.0.1');

if (args.check) {
  try {
    const response = await fetch(`http://${host}:${port}/v2/check`, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({language: 'en-US', text: 'This are a test.'}), signal: AbortSignal.timeout(5000)});
    const body = await response.json();
    console.log(`LanguageTool on ${host}:${port}: HTTP ${response.status}, ${body.matches?.length ?? 0} matches`);
    process.exit(response.ok ? 0 : 1);
  } catch (error) {
    console.error(`LanguageTool on ${host}:${port} is not reachable: ${error.message}`);
    process.exit(1);
  }
}

const dir = path.resolve(ROOT, String(args.dir ?? 'models/languagetool/LanguageTool-5.9'));
const jar = path.join(dir, 'languagetool-server.jar');
if (!fs.existsSync(jar)) {
  console.error(`LanguageTool is not installed: ${jar} not found. See the install steps in the header of tools/languagetool-server.mjs.`);
  process.exit(1);
}
const child = spawn(String(args.java ?? 'java'), ['-cp', jar, 'org.languagetool.server.HTTPServer', '--port', String(port)], {stdio: 'inherit'});
child.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
console.log(`LanguageTool 5.9 starting on port ${port} (java -cp languagetool-server.jar org.languagetool.server.HTTPServer)`);
