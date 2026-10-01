#!/usr/bin/env node
/** Builder of datasets/bad_english/proofing-gloss: the LanguageProofingLLM post-editing variant (experiment train-language-proofing-gloss).
 * The pairs of the qualified datasets/bad_english/proofing-it3 keep their targets; the PROMPT becomes the TranslatorService gloss of the
 * original prompt (lib/translator-service/backends/gloss.mjs: spelling by LanguagesUtil, then the morphology-aware word-by-word gloss that keeps
 * the Romanian word order; two dictionary senses as "a/b"; unknown lemmas in square brackets). English input is returned unchanged by the gloss,
 * so identity pairs and keyboard mash keep prompt = target. Rows whose gloss (or target) contains one of the eight new held-out words are
 * removed from train (the gloss can introduce an English word the original prompt never contained).
 *
 *   node tools/datasets/build-language-proofing-gloss.mjs gloss --shard I/N      # gloss every prompt of the source files (CPU, Stanza), cache in $GLOSS_BUILD
 *   node tools/datasets/build-language-proofing-gloss.mjs assemble                # write datasets/bad_english/proofing-gloss from the cache
 *
 * Nothing here trains or reads a sealed file. The result is not authorized for training (manifest `training_authorized: false`).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {glossMessage, GLOSS_VERSION} from '../../lib/translator-service/index.mjs';
import {HELD_OUT_V3, matchesAny} from './language-proofing/vocab-it3.mjs';
import {pairProblems, hashText} from './language-proofing/pairs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'datasets/bad_english/proofing-it3');
const OUT = path.join(ROOT, 'datasets/bad_english/proofing-gloss');
const BUILD = path.resolve(ROOT, process.env.GLOSS_BUILD ?? 'eval/reports/current/gloss/build');
const SENSES = 2;
const SEALED = path.join(ROOT, 'eval/reports/current/language-proofing-it3/data/sealed-hashes-union.json');
// [source file, destination file]
const FILES = [['proofreader/train.jsonl', 'proofreader/train.jsonl'], ['proofreader/dev.jsonl', 'proofreader/dev.jsonl'], ['dev-heldout.jsonl', 'dev-heldout.jsonl'],
  ['dev-heldout-v3.jsonl', 'dev-heldout-v3.jsonl'], ['dev-heldout-v3-identity.jsonl', 'dev-heldout-v3-identity.jsonl'], ['dev-spacing.jsonl', 'dev-spacing.jsonl'],
  ['dev-backgen.jsonl', 'dev-backgen.jsonl'], ['mash-eval.jsonl', 'mash-eval.jsonl']];
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel = file => path.relative(ROOT, file).split(path.sep).join('/');
const cacheFile = (src, i, n) => path.join(BUILD, `${src.replace(/[\\/]/g, '__')}.${i}of${n}.jsonl`);

async function glossCommand(shard) {
  const [i, n] = shard.split('/').map(Number);
  const lm = await createSymbolicLM({threads: Number(process.env.GLOSS_THREADS ?? 3)});
  try {
    for (const [src] of FILES) {
      const rows = readJsonl(path.join(SRC, src)).filter((_, k) => k % n === i);
      const out = [];
      for (const row of rows) {
        const g = await glossMessage(lm, row.prompt, {spell: true, senses: SENSES});
        out.push({id: row.id, gloss: g.text, mode: g.mode, stats: g.stats, ms: Math.round(g.ms)});
      }
      writeJsonl(cacheFile(src, i, n), out);
      console.error(`${src} shard ${i}/${n}: ${out.length} rows`);
    }
  } finally { await lm.stop?.(); }
}

function assemble(n) {
  const sealed = new Set(JSON.parse(fs.readFileSync(SEALED, 'utf8')).hashes);
  const gloss = new Map();
  for (const [src] of FILES) { gloss.set(src, new Map()); for (let i = 0; i < n; i++) for (const g of readJsonl(cacheFile(src, i, n))) gloss.get(src).set(g.id, g); }
  const devPrompts = new Set(FILES.filter(([, dst]) => dst !== 'proofreader/train.jsonl').flatMap(([src]) => readJsonl(path.join(SRC, src)).map(r => hashText(gloss.get(src).get(r.id).gloss))));
  const summary = {dropped_sealed_text: 0, dropped_prompt_in_dev: 0, removed_new_heldout: {}, dropped_mechanical: {}, dropped_mechanical_rows: 0, unchanged: 0, glossed: 0, bracketed: 0, identity_changed_by_gloss: 0};
  const files = {};
  for (const [src, dst] of FILES) {
    const rows = readJsonl(path.join(SRC, src));
    const gl = new Map();
    for (let i = 0; i < n; i++) for (const g of readJsonl(cacheFile(src, i, n))) gl.set(g.id, g);
    const out = [];
    for (const row of rows) {
      const g = gl.get(row.id);
      if (!g) throw Error(`no gloss for ${src} ${row.id}`);
      const prompt = g.gloss;
      if (dst === 'proofreader/train.jsonl' && (sealed.has(hashText(prompt)) || sealed.has(hashText(row.target)))) { summary.dropped_sealed_text++; continue; }
      if (dst === 'proofreader/train.jsonl' && devPrompts.has(hashText(prompt))) { summary.dropped_prompt_in_dev++; continue; }
      if (dst === 'proofreader/train.jsonl' && matchesAny(HELD_OUT_V3, prompt, row.target)) {
        const word = Object.keys(HELD_OUT_V3).find(w => HELD_OUT_V3[w].test(prompt) || HELD_OUT_V3[w].test(row.target));
        summary.removed_new_heldout[word] = (summary.removed_new_heldout[word] ?? 0) + 1;
        continue;
      }
      if (dst === 'proofreader/train.jsonl') {
        // The meaning relation of the pair is the one of the qualified source pair; the gloss must not lose a name, number, quote, question mark or negation the target keeps.
        // Only problems the gloss introduces count: the source pair is qualified as it is (e.g. "doesnt" with a restored negation, "???" cut to "?").
        const kind = p => p.replace(/^lost: .*/, 'lost item');
        const had = new Set(pairProblems(row.prompt, row.target).map(kind));
        const problems = pairProblems(prompt, row.target).filter(p => !/^length ratio/.test(p) && !had.has(kind(p)));
        if (problems.length) { summary.dropped_mechanical_rows++; for (const p of new Set(problems.map(x => x.replace(/^lost: .*/, 'lost item')))) summary.dropped_mechanical[p] = (summary.dropped_mechanical[p] ?? 0) + 1; continue; }
        if (row.kind === 'identity' && prompt !== row.prompt) summary.identity_changed_by_gloss++;
      }
      if (dst === 'proofreader/train.jsonl') { if (prompt === row.prompt) summary.unchanged++; else summary.glossed++; if (/\[[^\]]+\]/.test(prompt)) summary.bracketed++; }
      out.push({...row, prompt, source_prompt: row.prompt, gloss_mode: g.mode});
    }
    writeJsonl(path.join(OUT, dst), out);
    files[dst] = {rows: out.length, source_rows: rows.length, sha256: sha(path.join(OUT, dst))};
  }
  fs.copyFileSync(path.join(SRC, 'audit.jsonl'), path.join(OUT, 'audit.jsonl'));
  const src = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const manifest = {
    format: 'chatsop-proofing-pairs-v1', dataset: 'bad_english', model: 'LanguageProofingLLM', role: 'proofreader', variant: 'gloss', iteration: 3,
    prompt_profile: 'message-only',
    prompt: 'row.prompt: the TranslatorService gloss (lib/translator-service/backends/gloss.mjs, version ' + GLOSS_VERSION + ', spelling on, two dictionary senses) of the sentence of the source pair; the gloss alone, never the original (DS021 message-only input: the message is still the only input, preprocessed by host code, nothing else enters the prompt)',
    target: 'row.target verbatim from datasets/bad_english/proofing-it3 (clean English; identity pairs and keyboard mash keep prompt = target)',
    created: new Date().toISOString(), training_authorized: false, review_status: 'not_reviewed', gloss: {version: GLOSS_VERSION, senses: SENSES, spell: true, mark: ['[', ']']},
    held_out_vocabulary: src.held_out_vocabulary, trained_vocabulary: src.trained_vocabulary,
    source: {dataset: 'bad_english/proofing-it3', manifest_sha256: sha(path.join(SRC, 'manifest.json')), train_sha256: sha(path.join(SRC, 'proofreader/train.jsonl')), dev_sha256: sha(path.join(SRC, 'proofreader/dev.jsonl')),
      sealed_hashes_sha256: src.sealed_hashes_sha256},
    files, summary,
    note: 'Built from the qualified datasets/bad_english/proofing-it3 by tools/datasets/build-language-proofing-gloss.mjs. Targets are the it3 targets (DeepSeek-written, review pending); prompts are deterministic host code output. source_prompt is kept for audit only and is never a model input.',
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'proofreader/manifest.json'), JSON.stringify({format: 'chatsop-proofreader-projection-v1', corpus: 'bad_english/proofing-gloss', prompt_profile: 'message-only', created: manifest.created, training_authorized: false, review_status: 'not_reviewed',
    files: Object.fromEntries(Object.entries(files).map(([name, f]) => [name, {rows: f.rows, sha256: f.sha256}]))}, null, 1) + '\n');
  const version = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
  fs.writeFileSync(path.join(OUT, 'VERSION'), JSON.stringify({format: 'chatsop-dataset-version-v1', corpus: 'bad_english/proofing-gloss', counter: 1, dataset: 'bad_english/proofing-gloss',
    version: `2026-10-01-${files['proofreader/train.jsonl'].sha256.slice(0, 8)}`, label: `bad_english/proofing-gloss (gloss prompts, ${files['proofreader/train.jsonl'].rows} train / ${files['proofreader/dev.jsonl'].rows} dev)`, files_sha256: version}) + '\n');
  console.log(JSON.stringify({files, summary}, null, 1));
}

const [command, ...rest] = process.argv.slice(2);
const arg = name => { const k = rest.indexOf(name); return k >= 0 ? rest[k + 1] : undefined; };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (command === 'gloss') glossCommand(arg('--shard') ?? '0/1').then(() => process.exit(0), e => { console.error(e); process.exit(1); });
  else if (command === 'assemble') assemble(Number(arg('--shards') ?? 1));
  else { console.error('usage: build-language-proofing-gloss.mjs gloss --shard I/N | assemble --shards N'); process.exit(2); }
}
