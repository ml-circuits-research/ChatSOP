#!/usr/bin/env node
/** Clean-English targets for bad_english rows that have none (owner task 2026-09-30, done by an external LLM agent).
 *
 *   node tools/eval/bad-english-targets.mjs export   [--dir datasets_sources/bad_english_targets] [--chunk 500]
 *   node tools/eval/bad-english-targets.mjs validate [--dir datasets_sources/bad_english_targets] [--file part-000.jsonl]
 *
 * `export` writes the rows of datasets/bad_english/{train,dev}.jsonl and eval/suites/bad_english/test.jsonl that have
 * no target as `<dir>/input/part-NNN.jsonl` lines `{id, kind, message}` (no split, no gold SOP: the translator sees
 * the message only). `validate` checks `<dir>/output/part-NNN.jsonl` lines `{id, target}` or `{id, unfixable, reason}`
 * mechanically and writes `<dir>/validation/part-NNN.json`; exit code 1 when a file has errors. The checks are the
 * rules of `<dir>/TASK.md`. The working folder is under the local source cache (never exported); accepted targets
 * reach the dataset only through the dataset builder.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {cleanEnglishGate} from '../datasets/clean-english.mjs';
import {loadSpellfix} from '../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = ['datasets/bad_english/train.jsonl', 'datasets/bad_english/dev.jsonl', 'eval/suites/bad_english/test.jsonl'];

function args(argv) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { out._.push(argv[i]); continue; }
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const pending = () => FILES.flatMap(file => readJsonlShardedSync(path.join(ROOT, file))).filter(row => !row.target)
  .map(row => ({id: row.id, kind: row.language_kind, message: row.message}));

function exportInput(o) {
  const dir = path.resolve(ROOT, o.dir ?? 'datasets_sources/bad_english_targets');
  const size = Number(o.chunk ?? 500);
  const rows = pending();
  fs.mkdirSync(path.join(dir, 'input'), {recursive: true});
  fs.mkdirSync(path.join(dir, 'output'), {recursive: true});
  let parts = 0;
  for (let i = 0; i < rows.length; i += size, parts++)
    fs.writeFileSync(path.join(dir, 'input', `part-${String(parts).padStart(3, '0')}.jsonl`), rows.slice(i, i + size).map(r => JSON.stringify(r)).join('\n') + '\n');
  const kinds = {};
  for (const row of rows) kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
  console.log(JSON.stringify({rows: rows.length, kinds, parts, dir: path.relative(ROOT, dir)}, null, 1));
}

// Names, numbers and quoted spans that must survive: capitalized tokens not at a sentence start, digits, quotes.
const QUOTED = /"[^"\n]+"|“[^”\n]+”|„[^”“\n]+[”“]/gu;
export function protectedItems(message) {
  const items = new Set();
  for (const quote of message.match(QUOTED) ?? []) items.add(quote.slice(1, -1).trim());
  const plain = message.replace(QUOTED, ' ');
  for (const number of plain.match(/\d+(?:[.,:]\d+)*/g) ?? []) items.add(number);
  const tokens = plain.split(/\s+/).filter(Boolean);
  tokens.forEach((token, index) => {
    const word = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    const sentenceStart = index === 0 || /[.!?:;—–-]$/.test(tokens[index - 1]);
    if (word.length > 1 && /^\p{Lu}/u.test(word) && !sentenceStart) items.add(word);
  });
  return [...items];
}
export const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const count = (text, re) => (text.match(re) ?? []).length;

function checkLine(input, out, resources) {
  const errors = [];
  const warnings = [];
  if (out.unfixable) { if (!out.reason) errors.push('unfixable needs a reason'); return {errors, warnings}; }
  const target = out.target;
  if (typeof target !== 'string' || !target.trim()) return {errors: ['target missing'], warnings};
  if (/\n/.test(target)) errors.push('target has a line break');
  if (input.kind !== 'noisy_en' && fold(target) === fold(input.message)) errors.push('target equals the message');
  const gate = cleanEnglishGate({question: target, language: 'en'}, resources);
  if (!gate.gates.all_tokens_english) errors.push(`target is not all English: ${gate.reasons.join('; ')}`);
  else if (!gate.clean) warnings.push(`clean-English gate: ${gate.reasons.join('; ')}`);
  const folded = fold(target);
  for (const item of protectedItems(input.message)) if (!folded.includes(fold(item))) warnings.push(`name, number or quote not found in target: ${item}`);
  if (count(target, /\?/g) !== count(input.message, /\?/g)) warnings.push('number of question marks differs');
  const ratio = target.length / Math.max(1, input.message.length);
  if (ratio < 0.4 || ratio > 2.5) errors.push(`length ratio ${ratio.toFixed(2)}`);
  return {errors, warnings};
}

function validate(o) {
  const dir = path.resolve(ROOT, o.dir ?? 'datasets_sources/bad_english_targets');
  const resources = {spellfix: loadSpellfix(), dictionary: defaultDictionary()};
  const files = o.file ? [o.file] : fs.readdirSync(path.join(dir, 'output')).filter(name => /^part-\d+\.jsonl$/.test(name)).sort();
  fs.mkdirSync(path.join(dir, 'validation'), {recursive: true});
  const total = {files: files.length, rows: 0, ok: 0, unfixable: 0, with_errors: 0, with_warnings: 0, missing: 0, unknown_ids: 0};
  for (const name of files) {
    const inputs = new Map(fs.readFileSync(path.join(dir, 'input', name), 'utf8').trim().split('\n').map(line => JSON.parse(line)).map(row => [row.id, row]));
    const seen = new Set();
    const problems = [];
    const lines = fs.readFileSync(path.join(dir, 'output', name), 'utf8').split('\n').filter(Boolean);
    lines.forEach((line, index) => {
      let out;
      try { out = JSON.parse(line); } catch { problems.push({line: index + 1, errors: ['not JSON']}); total.with_errors++; return; }
      const input = inputs.get(out.id);
      if (!input || seen.has(out.id)) { problems.push({id: out.id, errors: [input ? 'duplicate id' : 'unknown id']}); total.unknown_ids++; return; }
      seen.add(out.id);
      total.rows++;
      const {errors, warnings} = checkLine(input, out, resources);
      if (out.unfixable && !errors.length) total.unfixable++;
      if (errors.length) total.with_errors++;
      else if (warnings.length) total.with_warnings++;
      else if (!out.unfixable) total.ok++;
      if (errors.length || warnings.length) problems.push({id: out.id, message: input.message, target: out.target ?? null, errors, warnings});
    });
    const missing = [...inputs.keys()].filter(id => !seen.has(id));
    total.missing += missing.length;
    fs.writeFileSync(path.join(dir, 'validation', name.replace(/\.jsonl$/, '.json')), JSON.stringify({file: name, rows: lines.length, missing, problems}, null, 1) + '\n');
  }
  console.log(JSON.stringify(total, null, 1));
  if (total.with_errors || total.missing || total.unknown_ids) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  if (o._[0] === 'export') exportInput(o);
  else if (o._[0] === 'validate') validate(o);
  else { console.error('usage: bad-english-targets.mjs export|validate [--dir <folder>] [--chunk N] [--file part-NNN.jsonl]'); process.exitCode = 2; }
}
