#!/usr/bin/env node
/** Sealed side of LanguageProofingLLM (AGENTS.md rule 9; experiment train-language-proofing-gemma270m-it1).
 *
 *   node tools/eval/language-proofing-test.mjs build [--identity-ratio 0.1] [--seed 20260930]
 *
 * Reads the sealed bad_english test (eval/suites/bad_english/test.jsonl, test-composed.jsonl) and the sealed symbolic_english
 * test and writes
 *   eval/suites/bad_english/proofing-test.jsonl   sentence-level pairs {id, prompt, target, kind, ...}: repair pairs of the test rows
 *                                                 that have a target, plus identity pairs (clean English -> itself) from the sealed
 *                                                 symbolic_english test (`kind: identity`),
 *   eval/reports/current/language-proofing-it1/sealed-hashes.json   folded hashes of every sealed text (messages, targets, composed
 *                                                 components, identity messages), the only thing the train/dev side reads.
 * The train/dev builder (tools/datasets/build-language-proofing.mjs) never opens a sealed file.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {projectRow, projectUnlabelled, hashText, countBy, norm} from '../datasets/language-proofing/pairs.mjs';

export const WORK = path.join(ROOT, 'eval/reports/current/language-proofing-it1');
export const TEST_FILE = path.join(ROOT, 'eval/suites/bad_english/proofing-test.jsonl');
export const CLEAN_FILE = path.join(ROOT, 'eval/suites/bad_english/proofing-test-clean.jsonl');
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function build(o) {
  const ratio = Number(o['identity-ratio'] ?? 0.1), random = rng(Number(o.seed ?? 20260930));
  const test = readJsonlShardedSync(path.join(ROOT, 'eval/suites/bad_english/test.jsonl'));
  const composed = readJsonlShardedSync(path.join(ROOT, 'eval/suites/bad_english/test-composed.jsonl'));
  const symbolic = readJsonlShardedSync(path.join(ROOT, 'eval/suites/symbolic_english/test.jsonl'));
  // units whose sentence is also a train or dev prompt of the projection are left out (leakage guard on the evaluation side)
  const trained = new Set();
  for (const split of ['train', 'dev']) for (const r of readJsonlShardedSync(path.join(ROOT, 'datasets/bad_english/proofing', `${split}.jsonl`))) trained.add(hashText(r.prompt));
  const hashes = new Set(), summary = {rows: test.length, skipped: {}, dropped: 0, dropped_train_overlap: 0};
  for (const r of test) { hashes.add(hashText(r.message)); for (const t of r.targets ?? (r.target ? [{text: r.target}] : [])) hashes.add(hashText(t.text)); }
  for (const c of composed) { hashes.add(hashText(c.message)); hashes.add(hashText(c.expected_text)); for (const k of c.components ?? []) { hashes.add(hashText(k.text)); hashes.add(hashText(k.expected_text)); } }
  const sentenceHashes = text => { for (const u of splitSentences(text)) hashes.add(hashText(u.text)); };
  for (const r of test) { sentenceHashes(r.message); if (r.target) sentenceHashes(r.target); }
  for (const c of composed) for (const k of c.components ?? []) { sentenceHashes(k.text); sentenceHashes(k.expected_text); }
  const pairs = [], seen = new Set();
  const seenPrompt = new Set();
  for (const row of test) {
    if (!row.target) {
      // no reference yet (the sealed merge of the DeepSeek targets is an owner decision): sentence units for the reference-free metrics
      for (const p of projectUnlabelled(row)) {
        const hp = hashText(p.prompt);
        if (trained.has(hp)) { summary.dropped_train_overlap++; continue; }
        if (seenPrompt.has(hp)) continue;
        seenPrompt.add(hp);
        pairs.push({...p, pair: p.kind === 'clean' ? 'identity' : 'repair', has_ref: p.target !== null, row_id: row.id, target_source: p.kind === 'clean' ? 'identity:in-row' : 'none', review_status: 'n/a'});
      }
      summary.unlabelled_rows = (summary.unlabelled_rows ?? 0) + 1;
      continue;
    }
    const res = projectRow(row);
    if (res.skipped) summary.skipped[res.skipped] = (summary.skipped[res.skipped] ?? 0) + 1;
    summary.dropped += res.dropped.length;
    for (const p of res.pairs) {
      const key = hashText(p.prompt);
      if (trained.has(key)) { summary.dropped_train_overlap++; continue; }
      if (seenPrompt.has(key)) continue;
      seenPrompt.add(key); seen.add(hashText(p.prompt) + '|' + hashText(p.target));
      pairs.push({...p, has_ref: true, pair: p.kind === 'clean' ? 'identity' : 'repair', row_id: row.id, target_source: p.kind === 'clean' ? 'identity:in-row' : row.target_source, review_status: row.review_status});
    }
  }
  // identity pairs: single-sentence clean English of the sealed symbolic_english test
  const pool = symbolic.filter(r => splitSentences(r.message).length === 1 && r.message.length <= 300 && !seenPrompt.has(hashText(r.message)));
  const repairs = pairs.filter(p => p.pair === 'repair' && p.has_ref).length, inrowIdentity = pairs.filter(p => p.pair === 'identity').length, want = Math.max(0, Math.round(repairs * ratio / (1 - ratio)) - inrowIdentity);
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const i of order.slice(0, want)) { const r = pool[i]; hashes.add(hashText(r.message)); pairs.push({id: r.id, prompt: r.message, target: r.message, kind: 'clean', row_kind: 'clean', sentences: 1, pair: 'identity', has_ref: true, row_id: r.id, target_source: 'identity:symbolic_english', review_status: 'n/a'}); }
  pairs.sort((a, b) => a.id.localeCompare(b.id));
  // truly clean sentences (sealed symbolic_english test, single sentence): the identity check (e) of the preregistration; written separately so that the units above stay as first built
  const cleanOrder = symbolic.filter(r => splitSentences(r.message).length === 1 && r.message.length <= 300 && !seenPrompt.has(hashText(r.message)) && !trained.has(hashText(r.message))).map((_, i) => i);
  const cleanPool = symbolic.filter(r => splitSentences(r.message).length === 1 && r.message.length <= 300 && !seenPrompt.has(hashText(r.message)) && !trained.has(hashText(r.message)));
  for (let i = cleanOrder.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cleanOrder[i], cleanOrder[j]] = [cleanOrder[j], cleanOrder[i]]; }
  const cleanUnits = cleanOrder.slice(0, Number(o['clean-units'] ?? 900)).map(i => cleanPool[i]).map(r => { hashes.add(hashText(r.message)); return {id: r.id, prompt: r.message, target: r.message, kind: 'clean', row_kind: 'clean', sentences: 1, pair: 'identity', has_ref: true, row_id: r.id, target_source: 'identity:symbolic_english', review_status: 'n/a'}; }).sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(CLEAN_FILE, cleanUnits.map(p => JSON.stringify(p)).join('\n') + '\n');
  fs.writeFileSync(TEST_FILE, pairs.map(p => JSON.stringify(p)).join('\n') + '\n');
  fs.mkdirSync(WORK, {recursive: true});
  fs.writeFileSync(path.join(WORK, 'sealed-hashes.json'), JSON.stringify({generated_at: new Date().toISOString(), hashes: [...hashes].sort()}) + '\n');
  const out = {file: path.relative(ROOT, TEST_FILE), sha256: sha(TEST_FILE), pairs: pairs.length, by_pair: countBy(pairs, p => p.pair), by_kind: countBy(pairs, p => p.kind), by_row_kind: countBy(pairs, p => p.row_kind), by_target_source: countBy(pairs, p => p.target_source), with_reference: pairs.filter(p => p.has_ref).length, ...summary, sealed_hashes: hashes.size, clean_units: {file: path.relative(ROOT, CLEAN_FILE), sha256: sha(CLEAN_FILE), units: cleanUnits.length}};
  fs.writeFileSync(path.join(WORK, 'sealed-summary.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'build') build(args(rest)); else { console.error('usage: language-proofing-test.mjs build [--identity-ratio 0.1] [--seed N]'); process.exitCode = 2; }
}
