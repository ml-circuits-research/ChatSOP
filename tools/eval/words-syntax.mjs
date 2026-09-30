#!/usr/bin/env node
/** Mechanical conversion of model-authored SOP from operator syntax to the words-only forms (DS021, owner
 * principle of 2026-09-28: keyword lines with words, no operator symbols).
 *
 *   filter ?x != "A"            → except ?x "A"
 *   filter ?x > 80              → compare ?x above 80
 *   filter any|all … end        → compare any|all … end (inner lines in words); `filter all` of only
 *                                 `?x != "A"` lines → one `except` line each
 *   require|claim EXPR          → the same line in words; `require any|all … end` groups keep their structure
 *   operators                   → == equal, != not_equal, > above, < below, >= at_least, <= at_most,
 *                                 * times, + plus, - minus, / divided_by
 *
 * It rewrites only those lines; everything else (messages, other wires, accepted alternatives) is left as is. Used
 * to convert the sealed wild suite's golds in place without regenerating anything:
 *
 *   node tools/eval/words-syntax.mjs --suite eval/suites/formalizer-wild-v1/test.jsonl [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const COMPARATORS = [['>=', 'at_least'], ['<=', 'at_most'], ['==', 'equal'], ['!=', 'not_equal'], ['>', 'above'], ['<', 'below']];
const ARITHMETIC = {'*': 'times', '+': 'plus', '-': 'minus', '/': 'divided_by'};
const TOKEN = /"(?:\\.|[^"\\])*"|>=|<=|==|!=|[<>*+/]|-(?!\d)|\S+/g;

/** One comparison expression in words; throws on anything that is not `left COMPARATOR right`. */
export function expressionToWords(expression) {
  // Already in words (no operator symbol outside quotes): unchanged, so the conversion is idempotent.
  if (!/[<>=!*+/]|\s-\s/.test(String(expression).replace(/"(?:\\.|[^"\\])*"/g, '""'))) return String(expression).trim();
  const tokens = String(expression).trim().match(TOKEN) ?? [];
  const out = [];
  let comparators = 0;
  for (const token of tokens) {
    const comparator = COMPARATORS.find(([symbol]) => symbol === token);
    if (comparator) { out.push(comparator[1]); comparators++; continue; }
    if (ARITHMETIC[token]) { out.push(ARITHMETIC[token]); continue; }
    if (/[()]/.test(token)) throw Error(`parentheses have no words form: ${expression}`);
    out.push(token);
  }
  if (comparators !== 1) throw Error(`expected exactly one comparison in: ${expression}`);
  return out.join(' ');
}

const EXCEPT = /^(\?[A-Za-z][A-Za-z0-9_]*)\s*!=\s*("(?:\\.|[^"\\])*")$/;
/** Convert one SOP program's operator lines to words. */
export function toWords(sop) {
  const lines = String(sop).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(\s*)(filter|require|claim)\s+(.*)$/.exec(line);
    if (!m) { out.push(line); continue; }
    const [, indent, key, rest] = m;
    if (['any', 'all'].includes(rest.trim())) {
      // A group: collect to its matching `end`, converting every leaf.
      const block = [];
      let depth = 1;
      while (++i < lines.length) {
        const inner = lines[i].trim();
        if (['any', 'all'].includes(inner)) depth++;
        if (inner === 'end' && --depth === 0) break;
        block.push(lines[i]);
      }
      const leaves = block.map(item => item.trim()).filter(item => !['any', 'all', 'end'].includes(item));
      if (key === 'filter' && rest.trim() === 'all' && leaves.every(leaf => EXCEPT.test(leaf))) {
        for (const leaf of leaves) { const [, variable, value] = EXCEPT.exec(leaf); out.push(`${indent}except ${variable} ${value}`); }
        continue;
      }
      out.push(`${indent}${key === 'filter' ? 'compare' : key} ${rest.trim()}`);
      for (const item of block) {
        const trimmed = item.trim(), pad = item.slice(0, item.length - item.trimStart().length);
        out.push(['any', 'all', 'end'].includes(trimmed) ? item : pad + expressionToWords(trimmed));
      }
      out.push(`${indent}end`);
      continue;
    }
    if (key === 'filter') {
      const except = EXCEPT.exec(rest.trim());
      out.push(except ? `${indent}except ${except[1]} ${except[2]}` : `${indent}compare ${expressionToWords(rest)}`);
      continue;
    }
    out.push(`${indent}${key} ${/^[?\d"-]/.test(rest.trim()) && /[<>=!*+/]/.test(rest) ? expressionToWords(rest) : rest}`);
  }
  return out.join('\n');
}

function main(argv) {
  const suite = argv[argv.indexOf('--suite') + 1];
  if (!argv.includes('--suite') || !suite) throw Error('Usage: node tools/eval/words-syntax.mjs --suite <test.jsonl> [--check]');
  const file = path.resolve(suite);
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  let changed = 0;
  for (const row of rows) {
    for (const key of ['sop_target']) if (typeof row[key] === 'string') { const next = toWords(row[key]); if (next !== row[key]) { row[key] = next; changed++; } }
    if (Array.isArray(row.sop_targets_accepted)) row.sop_targets_accepted = row.sop_targets_accepted.map(text => { const next = toWords(text); if (next !== text) changed++; return next; });
  }
  if (argv.includes('--check')) { console.log(JSON.stringify({suite, programs_to_convert: changed})); process.exitCode = changed ? 1 : 0; return; }
  const body = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  fs.writeFileSync(file, body);
  // The suite's manifest is its checksum authority: record the converted file's sha256 and the conversion.
  const manifestFile = path.join(path.dirname(file), 'manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const hash = createHash('sha256').update(body).digest('hex');
    if (manifest.files?.['test.jsonl']) manifest.files['test.jsonl'] = hash;
    for (const key of Object.keys(manifest.sha256 ?? {})) if (key.endsWith('/test.jsonl')) manifest.sha256[key] = hash;
    manifest.conversions = [...(manifest.conversions ?? []).filter(item => item.tool !== 'tools/eval/words-syntax.mjs'),
      {tool: 'tools/eval/words-syntax.mjs', note: 'mechanical conversion of model-authored operator syntax (filter, require, claim) to the words-only forms of DS021; messages, accepted alternatives and annotations unchanged', programs_converted: changed}];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(JSON.stringify({suite, programs_converted: changed, rows: rows.length}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
