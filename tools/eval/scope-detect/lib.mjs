/** Shared helpers of the scope-detect study (2026-10-01): the labelled set, the judge system prompt and the judge-folder layout. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';

export const OUT = path.join(ROOT, 'eval/reports/current/scope-detect');
export const SET_FILE = path.join(OUT, 'labelled-set.jsonl');
export const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
export const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };

/** Seeded shuffle (mulberry32) so the sample is reproducible. */
export function shuffle(list, seed = 1) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export const JUDGE_SYSTEM = `You label ONE sentence that a user sent to a reasoning assistant. The sentence may be English or Romanian (Romanian often without diacritics, with typos), a software developer's chat message, a line from a manual or policy, or a textbook sentence.

The assistant can already do this without any stored knowledge: record a specific ground fact ("Ann works at Alpha"), take a supposition about specific things ("if Ann worked at Alpha"), answer a question about specific cases, check a numeric problem, and carry out a single request ("fix this bug", "write a summary").

It CANNOT represent, and a person or coding agent must first write knowledge for, content of these kinds (the "wire" types):
- rule: a general statement or law with variables ("every employee who ...", "birds fly", "if a customer pays late, then ...", "a penguin is a bird"), including thresholds that apply to every case ("orders above 100 ship free").
- default: a statement that holds usually and has exceptions ("usually", "normally", "most", "unless otherwise", "except ...").
- norm: obligation, prohibition, permission or a deadline ("must", "shall", "may not", "is allowed", "within 10 minutes", "never do X", a standing requirement such as "always keep the docs up to date").
- method: a procedure with ordered steps, choices or recovery ("first ..., then ..., if it fails ...").
- aggregate: a total, count, sum, average, percentage or formula computed from other quantities, stated as a general definition of a derived quantity ("the total is the sum of the line prices", "the fee is 5% of the amount").
- integrity: a state that must never occur or a limit on how many of something may exist ("no two bookings share a room", "at most one manager per team").
- closed: a claim that a list is complete ("these are the only ...", "no one else ...", "the complete list is ...").
- definition: a definition of a term ("X means ...", "an X is a Y that ...").
- temporal: a fact valid only during a period, or no longer valid ("from 2020 until 2023", "no longer", "effective from", "expires").
- sourced: a claim attributed to a document, section or authority, to be stored with its source ("according to section 4", "the manual states ...").
- amendment: a hypothetical about changing a rule, policy, limit or rate ("what would change if the fee were 10%?").

Choose exactly one label:
- "surface_ok": none of the above is needed. This includes questions about specific cases, ground facts, suppositions about specific things, a single plain request to the assistant, greetings, acknowledgements, and questions that merely ask what a rule says.
- "needs_knowledge_authoring": at least one wire type above is needed to represent what the sentence says. List all that apply in "wires" (a closed list: rule, default, norm, method, aggregate, integrity, closed, definition, temporal, sourced, amendment).
- "needs_clarification": the sentence cannot be acted on or represented without information it does not contain (a dangling "this" or "it" with nothing to refer to, an unfinished fragment, a genuinely ambiguous reading), and it is not already clearly one of the knowledge kinds.

Judge the sentence alone, by its meaning. A question is "surface_ok" unless it asks about a change to a rule or policy (amendment). A command to the assistant is "surface_ok" unless it states a standing requirement (norm) or an ordered procedure (method).

Answer with one JSON object and nothing else: {"label": "surface_ok|needs_knowledge_authoring|needs_clarification", "wires": [], "reason": "<at most 15 words>"}`;

/** Create an omp judge task folder datasets_sources/<name>/ for items [{id, user}] with the shared driver. */
export function judgeFolder(name, items, {system = JUDGE_SYSTEM, answerKey = 'label', model = 'xai-oauth/grok-4.20-0309-non-reasoning', task = 'Label each sentence.'} = {}) {
  const dir = path.join(ROOT, 'datasets_sources', name);
  for (const d of ['input', 'output', 'logs', 'scripts']) fs.mkdirSync(path.join(dir, d), {recursive: true});
  const driver = fs.readFileSync(path.join(ROOT, 'datasets_sources/decomp_eval_meaning_grok/scripts/judge.py'), 'utf8').replace(/ANSWER_KEY = "severity"/, `ANSWER_KEY = "${answerKey}"`);
  fs.writeFileSync(path.join(dir, 'scripts/judge.py'), driver);
  fs.writeFileSync(path.join(dir, 'SYSTEM_judge.txt'), system);
  writeJsonl(path.join(dir, 'input/items.jsonl'), items.map(i => ({id: i.id, condition: 'judge', user: i.user})));
  fs.writeFileSync(path.join(dir, 'TASK.md'), `# Task: ${task} (scope-detect-v1)

Each item of \`input/items.jsonl\` is one sentence; SYSTEM_judge.txt is your complete instruction. Answer honestly and independently; no labels exist in this folder.

## Hard limits

- Work ONLY inside this folder (\`datasets_sources/${name}/\`). Read \`input/items.jsonl\`, \`SYSTEM_judge.txt\`, \`scripts/judge.py\`; write \`output/verdicts.jsonl\`.
- Do NOT read or search other files of the repository. Do not edit anything outside this folder. No training, no servers, no GPU jobs, no commits.

## How to work

\`scripts/judge.py\` calls the kernel \`completion()\` once per item (resumable). In the omp eval kernel run \`%load datasets_sources/${name}/scripts/judge.py\` and then \`state = run(concurrency=8)\`; repeat \`run()\` until \`written\` equals \`items\`. Check that the file has one valid JSON line per item.
`);
  fs.writeFileSync(path.join(dir, 'run.sh'), `cd ${ROOT}\nomp -p --model "${model}" --auto-approve --no-title @datasets_sources/${name}/TASK.md "Do the task in TASK.md" </dev/null > datasets_sources/${name}/logs/omp-run.log 2>&1\n`);
  return dir;
}
