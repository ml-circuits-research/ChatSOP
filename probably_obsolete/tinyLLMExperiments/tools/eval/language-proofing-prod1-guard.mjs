#!/usr/bin/env node
/** Proper-noun runtime guard measurement (experiment train-language-proofing-gemma270m-prod1): the llm backend of textToCleanEnglish (lib/text-to-clean-english/backends/llm.mjs, bare call
 * then the masked retry of protected-names.mjs) against a running llama-server with the real GGUF. Counts, per set, the units whose bare reply lost a name, how many the masked retry repaired (guard_triggered_units = bare reply lost a name),
 * and the names lost after the guard.
 *   node tools/eval/language-proofing-prod1-guard.mjs --url http://127.0.0.1:18713 --label prod1-f16 [--limit N]
 * Sets: dev-names (datasets/bad_english/proofing-prod1/dev-names.jsonl) and the sealed units of eval/suites/bad_english/proofing-test.jsonl whose input has an institution name.
 * Writes $LP_WORK/guard__<label>.json. Inference only. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {WORK} from './language-proofing-eval.mjs';
import {createLlmBackend} from '../../lib/text-to-clean-english/backends/llm.mjs';
import {instNames} from '../datasets/language-proofing/names-typos.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('--url'), label = arg('--label', 'run'), limit = Number(arg('--limit', 1e9));
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const backend = createLlmBackend({url});
const sets = {
  'dev-names': readJsonl(path.join(ROOT, 'datasets/bad_english/proofing-prod1/dev-names.jsonl')),
  'sealed-units-with-name': readJsonl(path.join(ROOT, 'eval/suites/bad_english/proofing-test.jsonl')).filter(r => ['repair', 'identity'].includes(r.pair ?? r.kind) && instNames(r.prompt).length),
};
const out = {label, url, sets: {}}, examples = [];
for (const [setName, all] of Object.entries(sets)) {
  const rows = all.slice(0, limit), s = {units: rows.length, names_total: 0, guard_triggered_units: 0, retry_used: 0, retry_rejected: 0, final_units_lost: 0, final_names_lost: 0};
  for (const r of rows) {
    const names = instNames(r.prompt), res = await backend.clean(r.prompt, {language: 'ro'});
    s.names_total += names.length;
    const finalLost = names.filter(n => !res.text.includes(n));
    s.final_names_lost += finalLost.length; if (finalLost.length) s.final_units_lost++;
    if (res.name_retry === 'used') s.retry_used++; else if (res.name_retry === 'rejected') s.retry_rejected++;
    if (res.name_retry) { s.guard_triggered_units++; if (examples.length < 12) examples.push({id: r.id, input: r.prompt, final: res.text, retry: res.name_retry, final_lost: finalLost}); }
  }
  out.sets[setName] = s;
  console.log(setName, JSON.stringify(s));
}
out.examples = examples;
fs.writeFileSync(path.join(WORK, `guard__${label}.json`), JSON.stringify(out, null, 1) + '\n');
