#!/usr/bin/env node
/** Sealed-suite no-copy guard for LLM-authored text (DS022 "LLM diversification", filter (d), sealed part).
 *
 *   node tools/datasets/llm-diversify/sealed-guard.mjs --in <candidates.jsonl> --out <verdicts.jsonl>
 *
 * A SEALED AUDITOR (eval/leakage.mjs SEALED_AUDITORS): it reads the sealed suites (formalizer-v1 test, the OOD
 * suite and the independent wild suite) to measure overlap and writes only a verdict per candidate: pass/fail and
 * hit counts per suite. It never writes sealed text, and no generator imports it; the paraphrase pipeline runs it
 * as a separate process and reads the verdicts. Each input line is {cid, text, source_message}.
 *
 * A candidate fails when, against any sealed suite:
 *   - it equals a sealed message after case, accent and punctuation folding;
 *   - it shares a word 8-gram with a sealed message;
 *   - it shares a distinctive word 4-gram with an OOD or wild message: one that occurs in no formalizer-v1
 *     train/dev message and not in the candidate's own source message (new text that coincides with a sealed row,
 *     for example an OOD-only frame); the formalizer-v1 test shares its vocabulary with train by design, so
 *     against it the 8-gram and exact-duplicate bars apply (a test-reserved frame is long enough to hit them);
 *   - it writes a name-like role value of an OOD or wild gold target (folded, whole words, closed-class words
 *     such as "They" excluded) that its source message does not write.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../../lib/jsonl-shards.mjs';
import {tokens, ngrams} from '../no-copy.mjs';
import {FUNCTION_WORDS} from '../diversity/text.mjs';
import {archived} from '../../../lib/dataset-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SUITES = {'v1-test': 'formalizer-v1', ood: 'formalizer-ood-v1', wild: 'formalizer-wild-v1'};
const suiteRows = name => readJsonlShardedSync(path.join(root, 'eval', 'suites', name, 'test.jsonl'));
const fold = text => tokens(text).join(' ');

/** Name-like quoted role values of a gold target (upper-case initial, at least three letters). */
function nameValues(target) {
  const out = [];
  for (const target_ of [target].flat()) for (const match of String(target_ ?? '').matchAll(/^\s*role \w+ "([^"]+)"/gm))
    if (/^\p{Lu}/u.test(match[1]) && match[1].replace(/[^\p{L}]/gu, '').length >= 3 && !/^(The|A|An)\s/.test(match[1]) && !FUNCTION_WORDS.has(match[1].toLowerCase())) out.push(fold(match[1]));
  return out;
}

export function buildGuard() {
  const trainGrams = new Set();
  for (const split of ['train', 'dev']) for (const row of readJsonlShardedSync(path.join(root, archived(`formalizer-v1/${split}.jsonl`))))
    for (const gram of ngrams(tokens(row.question), 4)) trainGrams.add(gram);
  const index = {};
  const names = new Set(), messages = new Set();
  for (const [label, name] of Object.entries(SUITES)) {
    const four = new Set(), eight = new Set();
    for (const row of suiteRows(name)) {
      const words = tokens(row.question);
      messages.add(words.join(' '));
      for (const gram of ngrams(words, 8)) eight.add(gram);
      if (label !== 'v1-test') for (const gram of ngrams(words, 4)) if (!trainGrams.has(gram)) four.add(gram);
      if (label !== 'v1-test') for (const value of nameValues([row.sop_target, ...(row.sop_targets_accepted ?? [])])) names.add(value);
    }
    index[label] = {four, eight};
  }
  return function check({text, source_message}) {
    const words = tokens(text), own = ngrams(tokens(source_message), 4);
    const hits = {};
    for (const [label, {four, eight}] of Object.entries(index)) {
      const e = [...ngrams(words, 8)].filter(gram => eight.has(gram)).length;
      const f = [...ngrams(words, 4)].filter(gram => four.has(gram) && !own.has(gram)).length;
      if (e || f) hits[label] = {shared_8grams: e, distinctive_4grams: f};
    }
    const padded = ` ${fold(text)} `, source = ` ${fold(source_message)} `;
    if (messages.has(words.join(' '))) hits.exact_duplicate = true;
    const leakedNames = [...names].filter(value => padded.includes(` ${value} `) && !source.includes(` ${value} `)).length;
    return {pass: !Object.keys(hits).length && !leakedNames, hits, sealed_names_added: leakedNames};
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args[i + 1]; };
  if (!value('in') || !value('out')) { console.error('usage: sealed-guard.mjs --in <candidates.jsonl> --out <verdicts.jsonl>'); process.exit(2); }
  const check = buildGuard();
  const lines = fs.readFileSync(value('in'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const verdicts = lines.map(line => ({cid: line.cid, ...check(line)}));
  fs.writeFileSync(value('out'), verdicts.map(v => JSON.stringify(v)).join('\n') + (verdicts.length ? '\n' : ''));
  console.log(JSON.stringify({candidates: verdicts.length, pass: verdicts.filter(v => v.pass).length}));
}
