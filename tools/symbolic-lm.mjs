#!/usr/bin/env node
/** SymbolicLM command line (lib/symbolic-lm/, DS021 "SymbolicLM"). The chat service itself is lib/symbolic-lm/serve.mjs
 * (`serve` here delegates to it).
 *
 *   node tools/symbolic-lm.mjs analyze "<message>" [--route auto|direct|translate] [--spell] [--trace]   # SOP (+ trace JSON)
 *   node tools/symbolic-lm.mjs english "<message>" [--spell]                                              # English rendering
 *   node tools/symbolic-lm.mjs english --in rows.jsonl --out out.jsonl [--field question] [--spell]       # batch: {id, message, english, untranslated, language}
 *   node tools/symbolic-lm.mjs record-fixture                                                             # re-records tests/fixtures/symbolic-lm/parses.json
 *   node tools/symbolic-lm.mjs serve [--host 127.0.0.1] [--port 18961] [--threads 4]
 *        [--rewrite-url http://127.0.0.1:PORT/v1/chat/completions] [--rewrite-when uncertain|trees|trees_or_uncertain|always]
 *        [--rewrite-accept off|certified|certified_compare]                                                # llama.cpp-compatible endpoint
 *
 * The only input is the message; CPU only (`--threads` or CHATSOP_SYMBOLIC_LM_THREADS sets the Stanza worker's threads). The service
 * protocol, its request options and the rewrite flags are documented in lib/symbolic-lm/serve.mjs and service.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../lib/jsonl-shards.mjs';
import {createSymbolicLM} from '../lib/symbolic-lm/index.mjs';
import {argumentsOf, runServe} from '../lib/symbolic-lm/serve.mjs';

async function englishCommand(args) {
  const lm = await createSymbolicLM({threads: args.threads ? Number(args.threads) : undefined});
  try {
    if (args.in) {
      const rows = readJsonlShardedSync(args.in);
      const field = args.field ?? 'question';
      const out = [];
      for (const row of rows) {
        const message = row[field] ?? row.message;
        const english = await lm.toEnglish(message, {spell: Boolean(args.spell)});
        out.push({id: row.id, message, english: english.text, language: english.language, untranslated: english.untranslated.map(u => u.word), spelling: english.spelling.map(c => [c.from, c.to])});
        if (out.length % 50 === 0) process.stderr.write(`\r${out.length}/${rows.length}`);
      }
      fs.mkdirSync(path.dirname(path.resolve(args.out)), {recursive: true});
      fs.writeFileSync(args.out, out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
      console.error(`\n${out.length} messages → ${args.out}`);
    } else {
      const english = await lm.toEnglish(args.positional.join(' '), {spell: Boolean(args.spell)});
      console.log(english.text);
      if (english.untranslated.length) console.error('untranslated: ' + english.untranslated.map(u => u.word).join(', '));
    }
  } finally { await lm.stop(); }
}

async function analyzeCommand(args) {
  const lm = await createSymbolicLM({threads: args.threads ? Number(args.threads) : undefined});
  try {
    const result = await lm.analyze(args.positional.join(' '), {route: args.route ?? 'auto', spell: Boolean(args.spell)});
    console.log(result.sop);
    if (args.trace) console.error(JSON.stringify({route: result.route, language: result.language, uncertainty: result.uncertainty, trace: result.trace}, null, 2));
  } finally { await lm.stop(); }
}

/** Messages of the replay test (ChatSOP-authored sentences in the style of the corpora). */
const FIXTURE_MESSAGES = [
  'Cine antrenează echipa la care joacă Haruka Suzuki?',
  'Mă întreb dacă Chloé participă la atelierul de fotografie.',
  'Katalin cât timp a predat matematică?',
  'Nu cumva Traian a antrenat Rapid Bergen pe 10.06.2020?',
  'Există cineva care lucrează la Vertex Analytics și nu locuiește în Montreal?',
  'Spune-mi de când Rémi stă în Glasgow.',
  'Ion lucrează la Carpathia Energy. Lucrează și la Tisa Textile?',
  'Verify the claim that autorizația de construire requires a criminal record certificate.',
  'Who takes care of the garden?',
];

/** Records the Stanza parses and word-list lookups of FIXTURE_MESSAGES for tests/symbolic-lm.test.mjs. */
async function recordFixture() {
  const {SymbolicLM} = await import('../lib/symbolic-lm/index.mjs');
  const {StanzaWorker} = await import('../lib/ud-to-sop/stanza.mjs');
  const real = new StanzaWorker({device: 'cpu', env: {OMP_NUM_THREADS: '4'}});
  const parses = {};
  const worker = {start: () => real.start(), stop: () => real.stop(), request: async payload => { const r = await real.request(payload); parses[`${payload.language}|${payload.text}`] = r.parse; return r; }};
  const lm = new SymbolicLM({worker});
  await lm.start();
  const used = {en: new Set(), ro: new Set()};
  const base = lm.lexicons;
  lm.lexicons = {has: (l, w) => { const hit = base.has(l, w); if (hit) used[l].add(w); return hit; }, perMillion: () => 0};
  const cases = [];
  for (const message of FIXTURE_MESSAGES) {
    const english = await lm.toEnglish(message);
    const result = await lm.analyze(message);
    cases.push({message, english: english.text, route: result.route, sop: result.sop});
  }
  await lm.stop();
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/symbolic-lm/parses.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({note: 'Recorded by `node tools/symbolic-lm.mjs record-fixture`: Stanza 1.10.1 parses of ChatSOP-authored sentences and the word-list entries they touched (frequencies not recorded: the replay treats every frequency as 0).', cases, lexicons: {en: [...used.en].sort(), ro: [...used.ro].sort()}, parses}, null, 1) + '\n');
  console.log(`${cases.length} cases, ${Object.keys(parses).length} parses → ${file}`);
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command === 'english') return englishCommand(args);
  if (args.command === 'analyze') return analyzeCommand(args);
  if (args.command === 'record-fixture') return recordFixture();
  if (args.command === 'serve') return runServe(args);
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
