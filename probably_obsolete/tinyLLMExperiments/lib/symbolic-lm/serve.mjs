#!/usr/bin/env node
/** Server entry of the SymbolicLM service: `node lib/symbolic-lm/serve.mjs serve [--host 127.0.0.1] [--port 18961] [--threads 4]
 * [--rewrite-url URL] [--rewrite-when uncertain|trees|trees_or_uncertain|always] [--rewrite-accept off|certified|certified_compare]`.
 * The model registry (config/formalizers.json, `symbolic-lm.service`) starts it with `serve --host H --port P --device cpu`.
 * CPU only; `--threads` or CHATSOP_SYMBOLIC_LM_THREADS sets the Stanza worker's CPU threads. The rewrite flags are off by default
 * (the chat sends its own rewrite settings per request).
 */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {serve} from './service.mjs';
import {REWRITE_GATES, REWRITE_ACCEPTANCE} from './rewrite-gate.mjs';

/** Parses `serve --key value --flag` arguments. */
export function argumentsOf(argv) {
  const [command, ...rest] = argv;
  const args = {command, positional: []};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) { args.positional.push(rest[i]); continue; }
    const key = rest[i].slice(2);
    if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) args[key] = true; else args[key] = rest[++i];
  }
  return args;
}

/** Starts the service from parsed arguments. */
export async function runServe(args) {
  if (Number(args.port) === 9999) throw Error('port 9999 is reserved for the main server');
  if (args['rewrite-when'] && !REWRITE_GATES.includes(args['rewrite-when'])) throw Error(`--rewrite-when must be one of ${REWRITE_GATES.join(', ')}`);
  if (args['rewrite-accept'] && !REWRITE_ACCEPTANCE.includes(args['rewrite-accept'])) throw Error(`--rewrite-accept must be one of ${REWRITE_ACCEPTANCE.join(', ')}`);
  return serve({host: args.host, port: args.port ?? 18961, threads: args.threads ? Number(args.threads) : undefined,
    rewriteUrl: args['rewrite-url'] ?? null, rewriteWhen: args['rewrite-when'] ?? 'uncertain', rewriteAccept: args['rewrite-accept'] ?? 'off'});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command !== 'serve') { console.error('usage: node lib/symbolic-lm/serve.mjs serve [--host H] [--port P] [--threads N]'); process.exit(2); }
  runServe(args).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
