#!/usr/bin/env node
/** Sealed-text hashes and content-word signatures for the LanguageProofingLLM iteration-2 data builder
 * (experiment train-language-proofing-gemma270m-it2). A sealed auditor like tools/eval/backgen-sealed-check.mjs: it reads the sealed
 * test files, so it lives under tools/eval/; the builder tools/datasets/build-language-proofing-v2.mjs reads only its output.
 *
 *   node tools/eval/language-proofing-v2-sealed.mjs
 *
 * Reads every eval/suites/** /test*.jsonl and proofing-test*.jsonl and writes eval/reports/current/language-proofing-it2/sealed-hashes.json:
 *   hashes      folded hashes (case, diacritics, punctuation, spacing) of every text and of every sentence of every text field,
 *   signatures  content-word signatures (tools/datasets/three-datasets/forms.mjs lightWords, at least 2 words) of the clean English
 *               side of the sealed bad_english rows (target, else message) and of the sealed proofing units.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {hashText} from '../datasets/language-proofing/pairs.mjs';
import {lightWords} from '../datasets/three-datasets/forms.mjs';

const TEXT_KEYS = new Set(['message', 'question', 'prompt', 'target', 'text', 'expected_text', 'expected', 'input', 'rewrite', 'original']);
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
// LP_SEALED_OUT redirects the output (iteration 3 writes its own copy and leaves the iteration-2 file, whose hash the earlier manifests record, untouched)
const OUT = path.resolve(ROOT, process.env.LP_SEALED_OUT ?? 'eval/reports/current/language-proofing-it2/sealed-hashes.json');

function collect(value, key, sink) {
  if (typeof value === 'string') { if (TEXT_KEYS.has(key) && value.length <= 2000) sink(value, key); return; }
  if (Array.isArray(value)) { for (const v of value) collect(v, key, sink); return; }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collect(v, k, sink);
}

function main() {
  const files = walk(path.join(ROOT, 'eval/suites')).filter(f => /(^|\/)(proofing-)?test[^/]*\.jsonl$/.test(f) && !f.includes('/world/'));
  const hashes = new Set(), signatures = new Set(), perFile = {};
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    let n = 0;
    for (const row of readJsonlShardedSync(f)) {
      n++;
      collect(row, '', (text, key) => {
        hashes.add(hashText(text));
        let sentences = [];
        try { sentences = splitSentences(text).map(u => u.text); } catch { /* not prose */ }
        for (const s of sentences) hashes.add(hashText(s));
        // clean English side: bad_english targets, proofing targets, and the messages of the clean suites
        const cleanSide = /bad_english/.test(rel) && (key === 'target' || key === 'expected_text');
        if (cleanSide) { const w = lightWords(text); if (w.length >= 2) signatures.add(w.join(' ')); for (const s of sentences) { const ws = lightWords(s); if (ws.length >= 2) signatures.add(ws.join(' ')); } }
      });
    }
    perFile[rel] = n;
  }
  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify({generated_at: new Date().toISOString(), files: perFile, hashes: [...hashes].sort(), signatures: [...signatures].sort()}) + '\n');
  console.log(JSON.stringify({out: path.relative(ROOT, OUT), files: perFile, hashes: hashes.size, signatures: signatures.size}, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
