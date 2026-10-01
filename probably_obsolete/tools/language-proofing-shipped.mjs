#!/usr/bin/env node
/** Baseline of experiment train-language-proofing-gemma270m-it1: the currently shipped textToCleanEnglish backend
 * (lib/text-to-clean-english: cheap gate, LanguageTool for English, Qwen3-1.7B Q8_0 for Romanian and mixed text, masking of names/numbers/quotes),
 * run one sentence at a time on the rows of a split, with the operator's own LanguageTool and llama-server ports (nothing is started here).
 *
 *   node tools/eval/language-proofing-shipped.mjs --split test --sample 300 --name shipped --lt http://127.0.0.1:18133 --llm http://127.0.0.1:8633
 *
 * Writes the same {id, output, ms} rows as tools/eval/language-proofing-eval.mjs generate. A row the step leaves unchanged (gate: nothing to check) or whose
 * backend fails is output unchanged, like the host does ("degrades to no change"); failures are counted in the log line.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {textToCleanEnglish, loadTextToCleanEnglishConfig} from '../../lib/text-to-clean-english/index.mjs';
import {loadSplit, WORK} from './language-proofing-eval.mjs';

const o = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) o[process.argv[i].slice(2)] = process.argv[i + 1];
const sample = o.sample ? Number(o.sample) : null, t = `${o.split}${sample ?? ''}`;
const rows = loadSplit(o.split, sample);
const config = {...loadTextToCleanEnglishConfig(), languagetool: {...loadTextToCleanEnglishConfig().languagetool, url: o.lt}};
const out = path.join(WORK, 'outputs', `${o.name}__${t}.jsonl`);
fs.mkdirSync(path.dirname(out), {recursive: true});
const records = [];
let failures = 0, unchangedByGate = 0;
for (const r of rows) {
  const t0 = Date.now();
  let output = r.prompt, backend = 'none', error = null;
  try { const res = await textToCleanEnglish(r.prompt, {config, backendOptions: {endpoint: o.llm}}); output = res.clean; backend = res.backend; if (backend === 'none') unchangedByGate++; }
  catch (e) { failures++; error = String(e.message).slice(0, 120); }
  records.push({id: r.id, output, backend, error, ms: Date.now() - t0, truncated: false, device: 'cpu+gpu'});
  if (records.length % 50 === 0) console.error(`${records.length}/${rows.length}`);
}
fs.writeFileSync(out, records.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({rows: rows.length, failures, unchanged_by_gate: unchangedByGate, out: path.relative(ROOT, out)}));
