#!/usr/bin/env node
/** Runs SymbolicLM on the authored probes (live parse when not recorded) and prints / records them.
 *  node tools/eval/query-surface/probe-run.mjs [--record] [--filter form] */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SymbolicLM} from '../../../lib/symbolic-lm/index.mjs';
import {CachedWorker} from './cached-worker.mjs';
import {PROBES} from './probes.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURE = path.join(ROOT, 'tests/fixtures/query-forms/parses.json');

export async function runProbes({filter = null, messages = null} = {}) {
  const worker = new CachedWorker({own: FIXTURE, device: 'auto'});
  const lm = new SymbolicLM({worker});
  await lm.start();
  const out = [];
  try {
    for (const probe of messages ? messages.map(message => ({form: 'adhoc', message})) : PROBES.filter(p => !filter || p.form === filter)) {
      const r = await lm.analyze(probe.message, {route: 'direct', language: 'en'});
      out.push({...probe, sop: r.sop, valid: r.valid, outcome: r.outcome});
    }
  } finally { await lm.stop(); }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const filter = argv.includes('--filter') ? argv[argv.indexOf('--filter') + 1] : null;
  const adhoc = argv.includes('--say') ? argv.slice(argv.indexOf('--say') + 1) : null;
  const res = await runProbes({filter, messages: adhoc});
  const flat = s => (s ?? '').replace(/\n\s*/g, ' ').replace(/ end /g, ' ¦ ').replace(/ polarity affirmed/g, '').replace(/relation /g, 'rel ').replace(/role /g, '');
  for (const r of res) console.log(`[${r.form}${r.mode ? ' expect ' + r.mode : ''}] ${r.message}\n   ${flat(r.sop)}${r.valid ? '' : '  INVALID'}`);
}
