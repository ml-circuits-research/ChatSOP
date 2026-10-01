#!/usr/bin/env node
/**
 * Calibration set of the severity grader (DS016 "Graded severity"): the 702 items of the meaning-judge calibration v2 with a gold severity.
 *   node tools/eval/severity-calibration.mjs build          # eval/reports/current/severity/calibration-set.jsonl
 *   node tools/eval/severity-calibration.mjs folder <name>  # datasets_sources/<name>/ omp task folder (items for the LLM severity judge)
 * Gold severity: `eval/severity/calibration-hand.json` (hand-assigned: the 105 hard negatives and the case-by-case typed negatives), else the TYPE_MAP default of tools/eval/severity/scale.mjs; positives are S0.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {TYPE_MAP} from './severity/scale.mjs';
import {JUDGE_SYSTEM, JUDGE_PROMPT_VERSION} from './severity/judge-prompt.mjs';

export const SEV_DIR = path.join(ROOT, 'eval/reports/current/severity');
export const CAL_FILE = path.join(SEV_DIR, 'calibration-set.jsonl');
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
export const loadCalibration = () => readJsonl(CAL_FILE);

export function build() {
  const labels = readJsonl(path.join(ROOT, 'eval/reports/current/meaning-judge/v2/labels.jsonl'));
  const hand = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/severity/calibration-hand.json'), 'utf8'));
  const rows = labels.map(r => {
    let severity, basis;
    if (r.label === 'same') { severity = 'S0'; basis = 'positive'; }
    else if (hand[r.id]) { severity = hand[r.id]; basis = r.source === 'hand_written' ? 'hand_hard' : 'hand_case'; }
    else { severity = (TYPE_MAP[r.type] ?? {default: 'S4'}).default; basis = 'type_map'; }
    return {id: r.id, type: r.type, source: r.source, label: r.label, message: r.message, candidate: r.candidate, severity, basis};
  });
  fs.mkdirSync(SEV_DIR, {recursive: true});
  fs.writeFileSync(CAL_FILE, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const count = {};
  for (const r of rows) count[`${r.severity}/${r.basis}`] = (count[`${r.severity}/${r.basis}`] ?? 0) + 1;
  return {n: rows.length, count};
}

export function folder(name, rows = loadCalibration(), {system = JUDGE_SYSTEM} = {}) {
  const dir = path.join(ROOT, 'datasets_sources', name);
  for (const d of ['input', 'output', 'logs', 'scripts']) fs.mkdirSync(path.join(dir, d), {recursive: true});
  fs.writeFileSync(path.join(dir, 'input/items.jsonl'), rows.map(r => JSON.stringify({id: r.id, condition: 'sev', user: `ORIGINAL: ${r.message}\n\nREWRITE: ${r.candidate}`})).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'SYSTEM_sev.txt'), system);
  const judge = fs.readFileSync(path.join(ROOT, 'datasets_sources/meaning_judge_calibration_v2/scripts/judge.py'), 'utf8').replace('ANSWER_KEY = "preserves"', 'ANSWER_KEY = "severity"').replaceAll('meaning_judge_calibration_v2', name);
  fs.writeFileSync(path.join(dir, 'scripts/judge.py'), judge);
  fs.writeFileSync(path.join(dir, 'TASK.md'), `# Task: severity grading of rewrites (${JUDGE_PROMPT_VERSION})

Each item gives an ORIGINAL message and a REWRITE of it. You grade how much the rewrite changes the meaning, following SYSTEM_sev.txt, which is your complete instruction. Your verdicts are compared afterwards with known labels, so answer honestly and independently. Do not look for the labels; they are not in this folder.

## Hard limits

- Work ONLY inside this folder (\`datasets_sources/${name}/\`). Read \`input/items.jsonl\`, \`SYSTEM_sev.txt\`, \`scripts/judge.py\`; write \`output/verdicts.jsonl\` and, if needed, helper scripts in \`scripts/\`.
- Do NOT read or search other files of the repository, especially nothing under \`eval/\`, \`datasets/\`, \`status/\`, \`lib/\` or \`tools/\`. Do not edit anything outside this folder. No training, no servers, no GPU jobs, no commits.

## Input

\`input/items.jsonl\`: one line per judgement \`{"id": "...", "condition": "sev", "user": "<ORIGINAL and REWRITE>"}\`. Answer exactly in the JSON format of SYSTEM_sev.txt; every answer has a \`severity\` field.

## Output

\`output/verdicts.jsonl\`: one line per input item, same order: \`{"id": "...", "condition": "sev", "answer": {...}}\`. Every (id, condition) appears exactly once.

## How to work

\`scripts/judge.py\` is the driver: it calls the kernel \`completion()\` once per item, at most 16 in flight (use 8 if you see rate-limit errors), resumes from \`output/verdicts.jsonl\` and rewrites the file in input order. In the omp eval kernel run \`%load datasets_sources/${name}/scripts/judge.py\` and then \`state = run(concurrency=16)\`; repeat \`run()\` until \`written\` equals \`items\`. Judge each item separately; no extended reasoning budget beyond your default. At the end check that the file has one valid JSON line per input item and write \`REPORT.md\` (items done, severity counts, time taken, unresolved items).
`);
  return {dir, items: rows.length};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, name] = process.argv.slice(2);
  if (cmd === 'build') console.log(JSON.stringify(build()));
  else if (cmd === 'folder' && name) console.log(JSON.stringify(folder(name)));
  else { console.error('usage: build | folder <name>'); process.exit(2); }
}
