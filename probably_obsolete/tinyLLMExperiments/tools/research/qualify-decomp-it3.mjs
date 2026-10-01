#!/usr/bin/env node
/**
 * Qualification record of datasets/neuro_english/proofing-it3-decomp (decomposition top-up for SymbolicProofingLLM iteration 3), in the style of
 * tools/research/qualify-neuro-proofing.mjs: every check is recomputed from the files on disk and the record is written next to the data
 * (`qualification.json`) only when every check holds (fail closed; the blockers are printed). It is NOT a training authorization (AGENTS.md rule 3):
 * the data is "prepared, not trained".
 *   node tools/research/qualify-decomp-it3.mjs [--tokenize-url http://127.0.0.1:PORT]   (the tokenizer check uses a llama-server /tokenize of the Gemma 3 GGUF; skipped without it)
 * Checks: files_integrity, pair_grounding, certification, mechanical, meaning_votes, leakage, split_integrity, size_budget, status.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {mechanicalMeaning} from '../../lib/symbolic-lm/rewrite-gate.mjs';
import {AnalysisLayer} from '../eval/analysis-layer.mjs';
import {loadMeaningVotes} from '../datasets/build-decomp-it3-final.mjs';
import {sealedSentences} from '../datasets/audit/symbolic-proofing-overlap.mjs';
import {lightWords} from '../datasets/three-datasets/forms.mjs';
import {sentencesOf, foldWords} from '../datasets/symbolic-proofing-v2/units.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(root, 'datasets/neuro_english/proofing-it3-decomp');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const CONNECTIVES = /\b(because|so|then|after|before|while|although|though|since|unless|but|however|therefore|if|when|until)\b/gi;
const PRONOUN = /\b(he|she|they|him|her|them|his|their|it)\b/i;

export async function qualify({tokenizeUrl = null} = {}) {
  const blockers = [], checks = {};
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  const audit = new Map(readJsonl(path.join(DATA, 'audit.jsonl')).map(a => [a.id, a]));
  const rows = ['train', 'dev'].flatMap(split => readJsonl(path.join(DATA, `${split}.jsonl`)).map(r => ({...r, split})));

  // files_integrity
  const bad = [];
  for (const [name, meta] of Object.entries(manifest.files)) if (sha(path.join(DATA, name)) !== meta.sha256) bad.push(name);
  for (const split of ['train', 'dev']) if (sha(path.join(DATA, `${split}.jsonl`)) !== sha(path.join(DATA, 'proofreader', `${split}.jsonl`))) bad.push(`proofreader/${split}.jsonl differs`);
  checks.files_integrity = {ok: !bad.length, rows: rows.length, bad};

  // pair_grounding: every target sentence is a sentence of a symbolic_english row or of a target of neuro_english/proofing-it3 (or, for the single partial sentence, a neuro_english row) of the same split
  const known = {train: new Set(), dev: new Set()}, neuro = {train: new Set(), dev: new Set()};
  for (const split of ['train', 'dev']) {
    for (const r of readJsonlShardedSync(path.join(root, `datasets/symbolic_english/${split}.jsonl`))) for (const s of r.analysis?.sentences ?? []) known[split].add(norm(s.text));
    for (const r of readJsonlShardedSync(path.join(root, `datasets/neuro_english/${split}.jsonl`))) for (const s of r.analysis?.sentences ?? []) neuro[split].add(norm(s.text));
    // the second pool: the sentences of the targets of neuro_english/proofing-it3 of the same split (certified by that dataset's gate)
    for (const r of readJsonlShardedSync(path.join(root, `datasets/neuro_english/proofing-it3/${split}.jsonl`))) for (const s of sentencesOf(r.target)) known[split].add(s);
  }
  const ungrounded = [];
  for (const r of rows) {
    const a = audit.get(r.id);
    for (const s of sentencesOf(r.target)) if (!known[r.split].has(s) && !(a?.partial_acceptance && neuro[r.split].has(s))) ungrounded.push(`${r.id}: ${s.slice(0, 50)}`);
  }
  checks.pair_grounding = {ok: !ungrounded.length, ungrounded: ungrounded.slice(0, 5), count: ungrounded.length};

  // certification (recomputed from the recorded Stanza parses)
  const layer = new AnalysisLayer();
  const uncert = [];
  let partialRows = 0;
  for (const r of rows) {
    const a = audit.get(r.id), sentences = sentencesOf(r.target);
    const certified = sentences.map(s => layer.localPass(s));
    if (a?.partial_acceptance) {
      partialRows++;
      const kept = new Set(a.uncertified_kept_verbatim.map(norm));
      if (!sentences.every((s, i) => (kept.has(s) ? !certified[i] : certified[i])) || !certified.some(Boolean)) uncert.push(r.id);
    } else if (!certified.every(Boolean)) uncert.push(r.id);
  }
  checks.certification = {ok: !uncert.length, partial_rows: partialRows, failed: uncert.slice(0, 5), count: uncert.length};

  // mechanical
  const mech = [];
  for (const r of rows) {
    const m = mechanicalMeaning(r.target, r.prompt);
    const has = new Set((r.target.match(CONNECTIVES) ?? []).map(x => x.toLowerCase()));
    const problems = ['names', 'numbers', 'negation', 'quantifiers', 'question'].filter(k => !m[k]);
    if ((r.prompt.match(CONNECTIVES) ?? []).some(x => !has.has(x.toLowerCase()))) problems.push('connective_added');
    if (PRONOUN.test(r.prompt) && !PRONOUN.test(r.target)) problems.push('pronoun_added');
    if (problems.length) mech.push(`${r.id}: ${problems.join(',')}`);
  }
  checks.mechanical = {ok: !mech.length, failed: mech.slice(0, 5), count: mech.length};

  // meaning_votes: Grok's two votes m1 and m2 (orchestrator decision of 2026-10-01, deviation D1 of eval-decomposition-v1: GLM is not required)
  const mv = loadMeaningVotes();
  const votes = [];
  for (const r of rows) {
    const a = audit.get(r.id), v = mv.get(a?.origin_id);
    if (!v || v.m1 !== 'yes' || v.m2 !== 'yes' || a.meaning_votes?.grok_m1 !== 'yes' || a.meaning_votes?.grok_m2 !== 'yes') votes.push(r.id);
  }
  checks.meaning_votes = {ok: !votes.length, judge: 'Grok m1 AND m2 (xai-oauth/grok-4.20-0309-non-reasoning)', failed: votes.slice(0, 5), count: votes.length};

  // leakage (against every sealed suite, the decomposition evaluation set included)
  const {exact, sig, counts} = sealedSentences();
  const leaks = [];
  for (const r of rows) for (const text of [r.prompt, r.target]) for (const s of sentencesOf(text)) {
    const words = lightWords(s);
    if (exact.has(foldWords(s)) || (words.length >= 2 && sig.has(words.join(' ')))) { leaks.push(r.id); break; }
  }
  checks.leakage = {ok: !leaks.length, flagged: [...new Set(leaks)].slice(0, 5), count: new Set(leaks).size, sealed_files: Object.keys(counts).length, includes_decomposition_suite: Object.keys(counts).some(k => k.startsWith('decomposition/'))};

  // split_integrity
  const ids = new Map(), dup = [];
  for (const r of rows) { if (ids.has(r.id)) dup.push(r.id); ids.set(r.id, r.split); }
  const crossed = rows.filter(r => audit.get(r.id)?.pair_split !== r.split).map(r => r.id);
  const promptDup = rows.length - new Set(rows.map(r => norm(r.prompt).toLowerCase())).size;
  checks.split_integrity = {ok: !dup.length && !crossed.length && promptDup === 0, duplicate_ids: dup.length, split_mismatch: crossed.length, duplicate_prompts: promptDup};

  // size_budget (policy of proofing-it2: at most 400 prompt characters, 8 target sentences, 400 tokens in all)
  const long = rows.filter(r => r.prompt.length > 400 || sentencesOf(r.target).length > 8 || sentencesOf(r.target).length < 2).map(r => r.id);
  let tokens = null;
  if (tokenizeUrl) {
    let max = 0, over = 0;
    for (const r of rows) {
      const n = async t => (await (await fetch(`${tokenizeUrl}/tokenize`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: t})})).json()).tokens.length;
      const total = (await n(r.prompt)) + (await n(r.target));
      max = Math.max(max, total); if (total > 400) over++;
    }
    tokens = {max_total_tokens: max, over_400: over};
  }
  checks.size_budget = {ok: !long.length && (!tokens || tokens.over_400 === 0), too_long_or_short: long.slice(0, 5), count: long.length, tokens, tokenizer: tokenizeUrl ? 'Gemma 3 GGUF via llama-server /tokenize' : 'skipped (no --tokenize-url)'};

  // status
  checks.status = {ok: manifest.status === 'prepared, not trained' && manifest.training_authorized === false, status: manifest.status, training_authorized: manifest.training_authorized};

  for (const [name, c] of Object.entries(checks)) if (!c.ok) blockers.push(`${name}: ${JSON.stringify(c).slice(0, 300)}`);
  const record = {format: 'chatsop-dataset-qualification-v1', dataset: 'neuro_english/proofing-it3-decomp', status: 'prepared, not trained', qualified: blockers.length === 0, training_authorized: false,
    note: 'A qualification record is not a training authorization (AGENTS.md rule 3); no training, optimizer step or training smoke run was done.', created: new Date().toISOString(),
    manifest_sha256: sha(path.join(DATA, 'manifest.json')), train_sha256: sha(path.join(DATA, 'train.jsonl')), dev_sha256: sha(path.join(DATA, 'dev.jsonl')), checks};
  if (!blockers.length) fs.writeFileSync(path.join(DATA, 'qualification.json'), JSON.stringify(record, null, 1) + '\n');
  return {record, blockers};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const {record, blockers} = await qualify({tokenizeUrl: a.includes('--tokenize-url') ? a[a.indexOf('--tokenize-url') + 1] : null});
  console.log(JSON.stringify({qualified: record.qualified, checks: Object.fromEntries(Object.entries(record.checks).map(([k, v]) => [k, v.ok]))}, null, 1));
  if (blockers.length) { console.error(blockers.join('\n')); process.exit(1); }
}
