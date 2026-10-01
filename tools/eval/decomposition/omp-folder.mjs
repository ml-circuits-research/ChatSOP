/**
 * omp task folders of the decomposition work (datasets_sources/<name>/, the recipe of the severity and backgen folders): the model is
 * driven through the omp eval kernel `completion()`, fenced to its folder, resumable. `makeFolder(name, {system, items, task, answerKey})`
 * writes input/items.jsonl ({id, condition, user}), SYSTEM_<condition>.txt, scripts/judge.py (a copy of the generic driver of
 * datasets_sources/severity_apply_grok with ANSWER_KEY replaced), TASK.md and run.sh (detached launcher; the model is chosen by `omp --model`).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';

const DRIVER = path.join(ROOT, 'datasets_sources/severity_apply_grok/scripts/judge.py');

export function makeFolder(name, {system, items, answerKey, title, model, condition = 'x', extraTask = ''}) {
  const dir = path.join(ROOT, 'datasets_sources', name);
  for (const d of ['input', 'output', 'logs', 'scripts']) fs.mkdirSync(path.join(dir, d), {recursive: true});
  fs.writeFileSync(path.join(dir, 'input/items.jsonl'), items.map(r => JSON.stringify({id: r.id, condition, user: r.user})).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, `SYSTEM_${condition}.txt`), system);
  const driver = fs.readFileSync(DRIVER, 'utf8').replace('ANSWER_KEY = "severity"', `ANSWER_KEY = ${JSON.stringify(answerKey)}`).replaceAll('severity_apply_grok', name);
  fs.writeFileSync(path.join(dir, 'scripts/judge.py'), driver);
  fs.writeFileSync(path.join(dir, 'TASK.md'), `# Task: ${title}

${extraTask}
SYSTEM_${condition}.txt is your complete instruction for every item.

## Hard limits

- Work ONLY inside this folder (\`datasets_sources/${name}/\`). Read \`input/items.jsonl\`, \`SYSTEM_${condition}.txt\`, \`scripts/judge.py\`; write \`output/verdicts.jsonl\` and, if needed, helper scripts in \`scripts/\`.
- Do NOT read or search other files of the repository, especially nothing under \`eval/\`, \`datasets/\`, \`status/\`, \`lib/\` or \`tools/\`. Do not edit anything outside this folder. No training, no servers, no GPU jobs, no commits.

## Input and output

\`input/items.jsonl\`: one line per item \`{"id": "...", "condition": "${condition}", "user": "<text>"}\`. Output \`output/verdicts.jsonl\`: one line per input item, same order: \`{"id": "...", "condition": "${condition}", "answer": {...}}\`; every answer carries the field \`${answerKey}\`.

## How to work

\`scripts/judge.py\` is the driver: it calls the kernel \`completion()\` once per item, at most 16 in flight (use 8 on rate-limit errors), resumes from \`output/verdicts.jsonl\` and rewrites the file in input order. In the omp eval kernel run \`%load datasets_sources/${name}/scripts/judge.py\` and then \`state = run(concurrency=16)\`; repeat \`run()\` until \`written\` equals \`items\`. Each item is answered separately. At the end check that the file has one valid JSON line per input item and write \`REPORT.md\` (items done, counts, time, unresolved).
`);
  const model_flag = model ? `--model "${model}" ` : '';
  fs.writeFileSync(path.join(dir, 'run.sh'), `cd ${ROOT}\nomp -p ${model_flag}--auto-approve --no-title @datasets_sources/${name}/TASK.md "Do the task in TASK.md" </dev/null > datasets_sources/${name}/logs/omp-run.log 2>&1\n`);
  return {dir, items: items.length};
}

/** Verdicts of a folder: Map id -> answer object (null when unusable). */
export function loadAnswers(name, key) {
  const f = path.join(ROOT, 'datasets_sources', name, 'output/verdicts.jsonl');
  const out = new Map();
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line.trim()) continue; const r = JSON.parse(line); out.set(r.id, r.answer && r.answer[key] != null ? r.answer : null); }
  return out;
}
