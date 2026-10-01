#!/usr/bin/env node
/** Ceiling of grammar-constrained decoding (experiment eval-grammar-constrained-v1), computed without any model call.
 *
 * With greedy decoding, llama.cpp samples the unconstrained argmax whenever the grammar allows it, so a constrained
 * run can differ from a free run only on rows whose free output the grammar rejects. This tool checks existing free
 * predictions (formalizer-size-v1, CPU Q8_0, full suites) with llama.cpp's own grammar engine (test-gbnf-validator):
 * the share of rejected outputs bounds the rows the grammar can change, and so the possible accuracy gain.
 *
 *   node tools/research/grammar-ceiling.mjs --out eval/reports/history/grammar-constrained/ceiling.json [--grammar file.gbnf]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from '../../sop/parser.mjs';
import {checkModelProgram} from '../../sop/declarative.mjs';
import {GRAMMAR} from './grammar-constrained-eval.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validator = path.join(process.env.LLAMA_CPP_DIR ?? path.join(os.homedir(), 'llama-cpp-venv/llama.cpp'), 'build/bin/test-gbnf-validator');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grammar-ceiling-'));
const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const grammarFile = argument('--grammar') ?? GRAMMAR;
const batchGrammar = fs.readFileSync(path.join(root, grammarFile), 'utf8').replace('root ::= program', 'root ::= program ("~~~\\n" program)*');
fs.writeFileSync(path.join(temp, 'batch.gbnf'), batchGrammar);
const run = (grammarFile, text) => { fs.writeFileSync(path.join(temp, 'in.txt'), text); return execFileSync(validator, [grammarFile, path.join(temp, 'in.txt')], {encoding: 'utf8', maxBuffer: 1 << 28}); };
const valid = list => run(path.join(temp, 'batch.gbnf'), list.join('~~~\n')).includes('is valid');
fs.writeFileSync(path.join(temp, 'one.gbnf'), fs.readFileSync(path.join(root, grammarFile), 'utf8'));
/** The first line the grammar cannot continue, reduced to its keyword (`role location`, `during`, …). */
function rejectedAt(program) {
  const position = Number(run(path.join(temp, 'one.gbnf'), program).match(/position (\d+)/)?.[1] ?? -1);
  if (position < 0) return 'unknown';
  const line = (program.slice(0, position).split('\n').at(-1) + program.slice(position).split('\n')[0]).trim();
  const words = line.split(/\s+/);
  return words[0] === 'role' ? 'role ' + words[1] : words[0] || 'end of program';
}
/** Indices of the programs the grammar rejects (batched, bisected on failure). */
function rejected(programs) {
  const out = [];
  const visit = (lo, hi) => { if (lo >= hi || valid(programs.slice(lo, hi))) return; if (hi - lo === 1) { out.push(lo); return; } const mid = (lo + hi) >> 1; visit(lo, mid); visit(mid, hi); };
  for (let i = 0; i < programs.length; i += 500) visit(i, Math.min(programs.length, i + 500));
  return out;
}
const parses = text => { try { checkModelProgram(parse(text)); return true; } catch { return false; } };
const BASE = 'eval/reports/history/formalizer-size-v1';
const FILES = {
  'smollm2-135m': {wild: 'smollm2-135m/formalizer-wild-v1-q8_0.predictions.jsonl', ood: 'smollm2-135m/formalizer-ood-v1-q8_0.predictions.jsonl', test: 'smollm2-135m/formalizer-v1-q8_0.predictions.jsonl'},
  'smollm2-360m': {wild: 'smollm2-360m/formalizer-wild-v1-q8_0.predictions.jsonl', ood: 'smollm2-360m/formalizer-ood-v1-q8_0.predictions.jsonl', test500: 'smollm2-360m/formalizer-v1-sample500-q8_0.predictions.jsonl'},
};
const result = {format: 'chatsop-grammar-ceiling-v1', grammar: grammarFile, source: `${BASE} (CPU Q8_0 free predictions)`, cells: {}};
for (const [model, cells] of Object.entries(FILES)) for (const [cell, file] of Object.entries(cells)) {
  const rows = fs.readFileSync(path.join(root, BASE, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  // A missing final newline is not a grammar difference: a constrained run writes it before the end of turn.
  const programs = rows.map(row => { const text = String(row.sop ?? ''); return text.endsWith('\n') ? text : text + '\n'; });
  const bad = new Set(rejected(programs));
  const parseValid = rows.filter(row => parses(String(row.sop ?? ''))).length;
  const rejectedButParse = [...bad].filter(i => parses(rows[i].sop ?? '')).length;
  result.cells[`${model}/${cell}`] = {rows: rows.length, parse_valid: parseValid, grammar_rejected: bad.size, grammar_rejected_share: +(bad.size / rows.length).toFixed(4),
    rejected_but_parse_valid: rejectedButParse,
    parse_valid_rejected_at: Object.entries([...bad].filter(i => parses(rows[i].sop ?? '')).reduce((acc, i) => { const k = rejectedAt(programs[i]); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 12),
    rejected_ids_sample: [...bad].slice(0, 10).map(i => rows[i].id)};
  console.error(model, cell, JSON.stringify(result.cells[`${model}/${cell}`]));
}
const out = argument('--out');
if (out) fs.writeFileSync(path.resolve(root, out), JSON.stringify(result, null, 1) + '\n');
