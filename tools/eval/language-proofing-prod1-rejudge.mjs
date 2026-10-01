#!/usr/bin/env node
/** Same-judge meaning items for the prod1 comparison (experiment train-language-proofing-gemma270m-prod1): writes into this experiment's meaning-judge folder the items of the REFERENCE arm
 * (it3) whose output differs from the other arm's output, so both arms' differing outputs are judged by the same judge (Grok two votes); outputs identical in both arms keep one verdict.
 *   LP_WORK=... LP_MEANING_DIR=... node tools/eval/language-proofing-prod1-rejudge.mjs --ref lp-it3 --others lp-prod1-e3,lp-prod1-e1 [--split test --sample 600]
 */
import fs from 'node:fs';
import path from 'node:path';
import {WORK, MEANING_DIR, loadSplit} from './language-proofing-eval.mjs';
import {textKey} from '../datasets/neuro-oracle/common.mjs';
import {norm} from '../datasets/language-proofing/pairs.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const ref = arg('--ref'), others = String(arg('--others')).split(','), split = arg('--split') ?? 'test', sample = Number(arg('--sample') ?? 600), tag = sample ? `${split}${sample}` : split;
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const outs = name => new Map(readJsonl(path.join(WORK, 'outputs', `${name}__${tag}.jsonl`)).map(r => [r.id, r.output]));
const R = outs(ref), rows = loadSplit(split, sample), file = path.join(MEANING_DIR, 'input/items.jsonl');
const have = new Set(readJsonl(file).map(i => `${i.id}|${i.condition}`)), add = [];
for (const other of others) {
  const O = outs(other);
  for (const r of rows) {
    const output = R.get(r.id);
    if (!O.has(r.id) || norm(output) === norm(O.get(r.id)) || !norm(output) || norm(output) === norm(r.prompt)) continue;
    const user = `ORIGINAL: ${r.prompt}\n\nREWRITE: ${output}`, id = textKey(user);
    for (const condition of ['m1', 'm2']) { const k = `${id}|${condition}`; if (!have.has(k)) { have.add(k); add.push({id, condition, user}); } }
  }
}
if (add.length) fs.appendFileSync(file, add.map(i => JSON.stringify(i)).join('\n') + '\n');
console.log(JSON.stringify({ref, others, split: tag, meaning_items_added: add.length, items_total: readJsonl(file).length}));
