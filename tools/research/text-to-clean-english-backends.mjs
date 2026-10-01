#!/usr/bin/env node
/** Experiment text-to-clean-english-v1, deployable candidates (inference only, CPU only, no training): runs the
 * candidates that go through repository code paths on the same sample rows the torch survey used, writing the same
 * `{id, output, ms, device}` rows that `text-to-clean-english-eval.mjs symbolic|metrics|exec` score.
 *
 *   node tools/research/text-to-clean-english-backends.mjs symbolic --sample <sample.jsonl> --out <raw.jsonl>
 *        SymbolicLM `toEnglish` with the spelling corrector (LanguagesUtil + TranslatorService `symbolic` backend)
 *   node tools/research/text-to-clean-english-backends.mjs opus-mt  --sample <sample.jsonl> --out <raw.jsonl>
 *        TranslatorService `opus-mt` (Helsinki-NLP OPUS-MT ROMANCE-en, CPU) on the Romanian and mixed rows only
 *   node tools/research/text-to-clean-english-backends.mjs backend --name llm --url <endpoint> --sample <sample.jsonl> --out <raw.jsonl> [--kinds noisyEn,control]
 *        the production backend of lib/text-to-clean-english/backends/ (masked names/numbers/quotes), per-row latency
 *   node tools/research/text-to-clean-english-backends.mjs gate --n 300 --out <gate.json>
 *        how often the cheap gate would call a backend on already-clean English (datasets_archive/clean-english/dev.jsonl)
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const abs = file => path.join(ROOT, file);
const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
const readJsonl = file => fs.readFileSync(abs(file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(abs(file)), {recursive: true}); fs.writeFileSync(abs(file), rows.map(row => JSON.stringify(row)).join('\n') + '\n'); };
const sample = () => readJsonl(args.sample);

async function symbolic() {
  const {createSymbolicLM} = await import('../../lib/symbolic-lm/index.mjs');
  const lm = await createSymbolicLM({threads: Number(args.threads ?? 4)});
  lm.resources({spelling: true});
  const out = [];
  try {
    for (const row of sample()) {
      const started = performance.now();
      const english = await lm.toEnglish(row.text, {spell: true});
      out.push({id: row.id, output: english.text, ms: performance.now() - started, device: 'cpu', language: english.language, untranslated: english.untranslated.map(item => item.word)});
    }
  } finally { await lm.stop(); }
  writeJsonl(args.out, out);
  console.log(JSON.stringify({rows: out.length, mean_ms: out.reduce((a, r) => a + r.ms, 0) / out.length}));
}

async function opusMt() {
  const {translateBatch} = await import('./translator-backends/opus-mt.mjs');
  const rows = sample().filter(row => row.kind === 'ro' || row.kind === 'mixed');
  const started = performance.now();
  const {results} = translateBatch(rows.map(row => ({id: row.id, text: row.text})), {threads: Number(args.threads ?? 4)});
  const perRow = (performance.now() - started) / rows.length;
  writeJsonl(args.out, rows.map(row => ({id: row.id, output: results.get(row.id)?.text ?? '', ms: perRow, device: 'cpu', ms_basis: 'batch wall time divided by rows (includes model load)'})));
  console.log(JSON.stringify({rows: rows.length, ms_per_row: perRow}));
}

async function backend() {
  const name = String(args.name);
  const kinds = args.kinds ? String(args.kinds).split(',') : null;
  if (name !== 'llm') throw Error(`backend ${name}: only llm remains (the LanguageTool backend was removed, hygiene H19; its survey results stay in the history reports)`);
  const impl = (await import('../../lib/text-to-clean-english/backends/llm.mjs')).createLlmBackend({url: args.url, timeoutMs: Number(args.timeout ?? 120000), maxTokens: Number(args['max-tokens'] ?? 512)});
  const out = [];
  for (const row of sample().filter(item => !kinds || kinds.includes(item.kind))) {
    const started = performance.now();
    let result;
    try { result = await impl.clean(row.text, {language: row.kind === 'ro' ? 'ro' : row.kind === 'mixed' ? 'mixed' : 'en'}); } catch (error) { result = {text: '', error: error.message}; }
    out.push({id: row.id, output: result.text ?? '', ms: performance.now() - started, device: 'cpu-http', placeholders_preserved: result.placeholders_preserved ?? null, error: result.error ?? null});
    if (out.length % 10 === 0) process.stderr.write(`\r${name} ${out.length}`);
  }
  writeJsonl(args.out, out);
  console.log(JSON.stringify({backend: name, rows: out.length, errors: out.filter(r => r.error).length, mean_ms: out.reduce((a, r) => a + r.ms, 0) / out.length}));
}

async function gateRate() {
  const {gate} = await import('../../lib/text-to-clean-english/gate.mjs');
  // `--source new_cases`: the owner's independently written identity_clean messages (local source cache, counts only are reported).
  const fromNewCases = args.source === 'new_cases';
  const rows = fromNewCases
    ? fs.readdirSync(abs('datasets_sources/new_cases/raw')).filter(name => name.endsWith('.jsonl')).flatMap(name => readJsonl('datasets_sources/new_cases/raw/' + name)).filter(row => (row.categories ?? []).includes('identity_clean')).map(row => ({question: row.message}))
    : readJsonlShardedSync(abs('datasets_archive/clean-english/dev.jsonl'));
  const step = Math.max(1, Math.floor(rows.length / Number(args.n ?? 300)));
  const picked = rows.filter((_, index) => index % step === 0).slice(0, Number(args.n ?? 300));
  const reasons = {};
  let needed = 0;
  for (const row of picked) {
    const decision = gate(row.question);
    if (decision.needed) needed++;
    for (const reason of decision.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const result = {rows: picked.length, gate_needed: needed, gate_needed_share: needed / picked.length, reasons, source: fromNewCases ? 'datasets_sources/new_cases identity_clean rows (local source cache; counts only), every ' + step + 'th' : 'datasets_archive/clean-english/dev.jsonl (clean_en rows, every ' + step + 'th)'};
  fs.mkdirSync(path.dirname(abs(args.out)), {recursive: true});
  fs.writeFileSync(abs(args.out), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}

const commands = {symbolic, 'opus-mt': opusMt, backend, gate: gateRate};
if (!commands[command]) { console.log('Unknown command. See the header comment.'); process.exit(1); }
commands[command]().catch(error => { console.error(error.stack); process.exitCode = 1; });
