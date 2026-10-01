#!/usr/bin/env node
/** Rewrite candidates for neuro_english rows (owner task 2026-09-30, done by an external LLM agent).
 *
 *   node tools/datasets/neuro-english-targets.mjs validate [--dir datasets_sources/neuro_english_targets] [--file part-NNN.jsonl]
 *
 * Checks `<dir>/output/part-NNN.jsonl` lines `{id, candidates: [text, …]}` or `{id, unchanged: true, reason}` against
 * `<dir>/input/part-NNN.jsonl` mechanically: every id once, 1-3 candidates, each candidate plain English (the
 * clean-English gate's language test), names, numbers and quoted spans of the message kept, no line breaks, sane
 * length. It writes `<dir>/validation/part-NNN.json`; exit code 1 on errors. Meaning and "SymbolicLM understands it"
 * are checked afterwards by the SymbolicLM oracle, not here.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanEnglishGate} from './clean-english.mjs';
import {protectedItems, fold} from '../eval/bad-english-targets.mjs';
import {loadSpellfix} from '../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function args(argv) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { out._.push(argv[i]); continue; }
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function checkLine(input, out, resources) {
  const errors = [];
  const warnings = [];
  if (out.unchanged) { if (!out.reason) errors.push('unchanged needs a reason'); return {errors, warnings}; }
  if (!Array.isArray(out.candidates) || !out.candidates.length || out.candidates.length > 3) return {errors: ['candidates must be 1-3 strings'], warnings};
  out.candidates.forEach((text, index) => {
    const tag = `candidate ${index + 1}`;
    if (typeof text !== 'string' || !text.trim()) { errors.push(`${tag} empty`); return; }
    if (/\n/.test(text)) errors.push(`${tag} has a line break`);
    if (fold(text) === fold(input.message)) warnings.push(`${tag} equals the message`);
    const gate = cleanEnglishGate({question: text, language: 'en'}, resources);
    if (!gate.gates.all_tokens_english) errors.push(`${tag} is not all English: ${gate.reasons.join('; ')}`);
    const folded = fold(text);
    for (const item of protectedItems(input.message)) if (!folded.includes(fold(item))) warnings.push(`${tag}: not found: ${item}`);
    const ratio = text.length / Math.max(1, input.message.length);
    if (ratio < 0.4 || ratio > 3) errors.push(`${tag} length ratio ${ratio.toFixed(2)}`);
  });
  return {errors, warnings};
}

function validate(o) {
  const dir = path.resolve(ROOT, o.dir ?? 'datasets_sources/neuro_english_targets');
  const resources = {spellfix: loadSpellfix(), dictionary: defaultDictionary()};
  const files = o.file ? [o.file] : fs.readdirSync(path.join(dir, 'output')).filter(name => /^part-\d+\.jsonl$/.test(name)).sort();
  fs.mkdirSync(path.join(dir, 'validation'), {recursive: true});
  const total = {files: files.length, rows: 0, ok: 0, unchanged: 0, with_errors: 0, with_warnings: 0, missing: 0, unknown_ids: 0, candidates: 0};
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
      total.candidates += out.candidates?.length ?? 0;
      const {errors, warnings} = checkLine(input, out, resources);
      if (out.unchanged && !errors.length) total.unchanged++;
      if (errors.length) total.with_errors++;
      else if (warnings.length) total.with_warnings++;
      else if (!out.unchanged) total.ok++;
      if (errors.length || warnings.length) problems.push({id: out.id, message: input.message, candidates: out.candidates ?? null, errors, warnings});
    });
    const missing = [...inputs.keys()].filter(id => !seen.has(id));
    total.missing += missing.length;
    fs.writeFileSync(path.join(dir, 'validation', name.replace(/\.jsonl$/, '.json')), JSON.stringify({file: name, rows: lines.length, missing, problems}, null, 1) + '\n');
  }
  console.log(JSON.stringify(total, null, 1));
  if (total.with_errors || total.missing || total.unknown_ids) process.exitCode = 1;
}

const o = args(process.argv.slice(2));
if (o._[0] === 'validate') validate(o);
else { console.error('usage: neuro-english-targets.mjs validate [--dir <folder>] [--file part-NNN.jsonl]'); process.exitCode = 2; }
