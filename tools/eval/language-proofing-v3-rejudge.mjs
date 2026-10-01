#!/usr/bin/env node
/** Same-judge items for a paired comparison of two arms (experiment train-language-proofing-gemma270m-it3).
 * The verdicts of iteration 2 on the judged sample come from the DeepSeek judges; the new items of iteration 3 are judged by Grok (meaning) and GLM (parse), whose
 * calibrated strictness differs. A paired comparison is only fair when both arms' differing outputs are judged by the same judge, so this tool writes the items of
 * the REFERENCE arm's outputs that differ from the other arm's output into this experiment's own task folders (LP_JUDGE_DIR, LP_MEANING_DIR); verdicts of those
 * folders take precedence when the arms are scored again under a new name. Outputs that are identical in both arms keep their earlier verdict in both.
 *
 *   node tools/eval/language-proofing-v3-rejudge.mjs --ref lp-it2 --other lp-it3 [--split test --sample 600]
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {WORK, JUDGE_DIR, MEANING_DIR, loadSplit} from './language-proofing-eval.mjs';
import {AnalysisLayer} from './analysis-layer.mjs';
import {readVerdicts} from '../datasets/neuro-oracle/judge.mjs';
import {textKey} from '../datasets/neuro-oracle/common.mjs';
import {norm} from '../datasets/language-proofing/pairs.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const ref = arg('--ref'), other = arg('--other'), split = arg('--split') ?? 'test', sample = arg('--sample') ? Number(arg('--sample')) : 600;
const tag = sample ? `${split}${sample}` : split;
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const outs = name => new Map(readJsonl(path.join(WORK, 'outputs', `${name}__${tag}.jsonl`)).map(r => [r.id, r.output]));
const R = outs(ref), O = outs(other), rows = loadSplit(split, sample);
const differing = rows.filter(r => R.has(r.id) && O.has(r.id) && norm(R.get(r.id)) !== norm(O.get(r.id)));
// parse judge: every sentence of the reference outputs that this experiment's folder has not judged yet
const layer = new AnalysisLayer();
await layer.ensure(differing.map(r => R.get(r.id)));
layer.verdicts = new Map([...readVerdicts(JUDGE_DIR)]);
const items = layer.pendingItems(differing.map(r => R.get(r.id)));
const parseFile = path.join(JUDGE_DIR, 'input/items.jsonl'), haveParse = new Set(readJsonl(parseFile).map(i => `${i.id}|${i.condition}`));
const addParse = items.filter(i => !haveParse.has(`${i.id}|${i.condition}`));
if (addParse.length) fs.appendFileSync(parseFile, addParse.map(i => JSON.stringify(i)).join('\n') + '\n');
// meaning judge
const meaningFile = path.join(MEANING_DIR, 'input/items.jsonl'), haveM = new Set([...readJsonl(meaningFile).map(i => `${i.id}|${i.condition}`)]);
const addM = [];
for (const r of differing) {
  const output = R.get(r.id);
  if (!norm(output) || norm(output) === norm(r.prompt)) continue;
  const user = `ORIGINAL: ${r.prompt}\n\nREWRITE: ${output}`, id = textKey(user);
  for (const condition of ['m1', 'm2']) { const k = `${id}|${condition}`; if (!haveM.has(k)) { haveM.add(k); addM.push({id, condition, user}); } }
}
if (addM.length) fs.appendFileSync(meaningFile, addM.map(i => JSON.stringify(i)).join('\n') + '\n');
console.log(JSON.stringify({ref, other, split: tag, differing_units: differing.length, parse_items_added: addParse.length, meaning_items_added: addM.length}));
process.exit(0);
