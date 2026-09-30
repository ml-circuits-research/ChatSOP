#!/usr/bin/env node
/** Applies a local LanguageTool 5.9 server's top suggestion per match to noisyEn/new_cases messages
 * (experiment text-to-clean-english-v1). English only (en-US); LanguageTool never translates.
 *   node tools/research/text-to-clean-english-languagetool.mjs --port 8125 --sample <sample.jsonl> --kind noisyEn --out <out.jsonl>
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];

async function checkText(port, text) {
  const body = new URLSearchParams({language: 'en-US', text});
  const res = await fetch(`http://localhost:${port}/v2/check`, {method: 'POST', body});
  return res.json();
}

function applyTopSuggestions(text, matches) {
  // Non-overlapping, apply from the end so offsets of earlier matches stay valid.
  const sorted = [...matches].filter(m => m.replacements?.length).sort((a, b) => b.offset - a.offset);
  let out = text;
  let applied = 0;
  let lastStart = Infinity;
  for (const m of sorted) {
    const end = m.offset + m.length;
    if (end > lastStart) continue; // skip overlapping with an already-applied match
    out = out.slice(0, m.offset) + m.replacements[0].value + out.slice(end);
    lastStart = m.offset;
    applied++;
  }
  return {text: out, applied, matches: matches.length};
}

async function main() {
  const sample = fs.readFileSync(path.join(ROOT, args.sample), 'utf8').trim().split('\n').map(JSON.parse.bind(JSON));
  const rows = sample.filter(r => r.kind === args.kind);
  const out = [];
  for (const row of rows) {
    const started = performance.now();
    let result;
    try { result = await checkText(args.port, row.text); } catch (error) { result = {matches: [], error: error.message}; }
    const ms = performance.now() - started;
    const {text: output, applied, matches} = applyTopSuggestions(row.text, result.matches ?? []);
    out.push({id: row.id, output, ms, matches, applied, device: 'cpu-http-local'});
  }
  fs.mkdirSync(path.dirname(path.join(ROOT, args.out)), {recursive: true});
  fs.writeFileSync(path.join(ROOT, args.out), out.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({rows: out.length, mean_ms: out.reduce((a, r) => a + r.ms, 0) / out.length, mean_applied: out.reduce((a, r) => a + r.applied, 0) / out.length}));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
