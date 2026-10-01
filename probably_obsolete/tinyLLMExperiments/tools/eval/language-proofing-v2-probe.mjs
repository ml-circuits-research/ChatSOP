#!/usr/bin/env node
/** Vocabulary probe of LanguageProofingLLM iteration 2 (the iteration-1 hole: "child of" never appeared in the training targets, "copilul lui" came out as "parent").
 *
 *   node tools/eval/language-proofing-v2-probe.mjs build
 *   node tools/eval/language-proofing-v2-probe.mjs score --name NAME        # after `language-proofing-eval.mjs generate --split probe --name NAME ...`
 *
 * `build` writes eval/suites/bad_english/proofing-probe-child.jsonl: (a) every unit of the sealed proofing test whose reference or input names a child
 * (English "child", Romanian "copil"), and (b) hand-written sentences (by the agent of the iteration-2 run, unreviewed) about children, sons and daughters in
 * Romanian, mixed and badly written English. `score` reports, per source, how often the output keeps the relation (child/son/daughter word) and how often
 * it flips to "parent" although the input has no parent word.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {WORK} from './language-proofing-eval.mjs';

const FILE = path.join(ROOT, 'eval/suites/bad_english/proofing-probe-child.jsonl');
const fold = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const CHILD_IN = /\b(copil|copilul|copilului|copii|copiii|copiilor|copila|copilei|child|children|kid|kids)\b/;
const PARENT_IN = /\b(parinte|parintele|parintelui|parinti|parintii|parintilor|parent|parents)\b/;
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const HAND = [
  ['ro', 'Copilul lui Andrei lucrează la spital.', "Andrei's child works at the hospital."],
  ['ro', 'Cine este copilul Mariei?', "Who is Maria's child?"],
  ['ro', 'Copilul lui Radu nu locuiește în București.', "Radu's child does not live in Bucharest."],
  ['ro', 'Fiul lui Mihai studiază la Cluj.', "Mihai's son studies in Cluj."],
  ['ro', 'Fiica Elenei predă la liceu.', "Elena's daughter teaches at the high school."],
  ['ro', 'Este Ion copilul lui Gheorghe?', "Is Ion the child of Gheorghe?"],
  ['ro', 'Copiii Anei merg la școală pe jos.', "Ana's children walk to school."],
  ['ro', 'Sa stiu cine e copilul lui Victor?', "Can I know who Victor's child is?"],
  ['ro', 'Copilul Ioanei a câștigat concursul.', "Ioana's child won the contest."],
  ['ro', 'Nu cunosc copilul lui Dan.', "I do not know Dan's child."],
  ['ro', 'Fiul Laurei lucreaza la banca.', "Laura's son works at the bank."],
  ['ro', 'Fiica lui Petru a plecat la Viena.', "Petru's daughter has left for Vienna."],
  ['ro', 'Copilul lui Sorin este bolnav.', "Sorin's child is sick."],
  ['ro', 'Cati copii are Cristina?', 'How many children does Cristina have?'],
  ['ro', 'Este Maria copilul Alinei?', "Is Maria the child of Alina?"],
  ['ro', 'Copilul vecinului meu cântă la pian.', "My neighbour's child plays the piano."],
  ['mixed', 'Copilul lui Andrei works at the hospital.', "Andrei's child works at the hospital."],
  ['mixed', 'Who is the copil of Maria?', 'Who is the child of Maria?'],
  ['mixed', 'Fiul lui Mihai studies in Cluj.', "Mihai's son studies in Cluj."],
  ['mixed', 'Is Ion copilul lui Gheorghe?', 'Is Ion the child of Gheorghe?'],
  ['mixed', 'Fiica Elenei teaches at the high school.', "Elena's daughter teaches at the high school."],
  ['mixed', 'Does copilul lui Radu live in Bucharest?', "Does Radu's child live in Bucharest?"],
  ['mixed', 'Ana are doi children.', 'Ana has two children.'],
  ['mixed', 'The copil of Victor plays football.', "Victor's child plays football."],
  ['noisy_en', 'is ion the child of gheorghe', 'Is Ion the child of Gheorghe?'],
  ['noisy_en', 'whos the child of maria', "Who is the child of Maria?"],
  ['noisy_en', 'radus child doesnt live in bucharest', "Radu's child does not live in Bucharest."],
  ['noisy_en', 'mihais son studys in cluj', "Mihai's son studies in Cluj."],
  ['noisy_en', 'elenas daughter teachs at the high school', "Elena's daughter teaches at the high school."],
  ['noisy_en', 'the child of andrei work at the hospital', 'The child of Andrei works at the hospital.'],
  ['noisy_en', 'is maria the child of alina?', 'Is Maria the child of Alina?'],
  ['noisy_en', 'how many childs does cristina have', 'How many children does Cristina have?'],
  ['noisy_en', 'Victors child is sick', "Victor's child is sick."],
  ['noisy_en', 'the daughtr of Petru left for Vienna', 'The daughter of Petru left for Vienna.'],
  ['ro', 'Părintele lui Andrei lucrează la spital.', "Andrei's parent works at the hospital."],
  ['ro', 'Cine este părintele Mariei?', "Who is Maria's parent?"],
  ['mixed', 'Is Ion părintele lui Gheorghe?', 'Is Ion the parent of Gheorghe?'],
  ['noisy_en', 'is ion the parent of gheorghe', 'Is Ion the parent of Gheorghe?'],
];

function build() {
  const sealed = readJsonl(path.join(ROOT, 'eval/suites/bad_english/proofing-test.jsonl'));
  const units = [];
  for (const u of sealed) if (u.pair === 'repair' && (CHILD_IN.test(fold(u.prompt)) || (u.target && CHILD_IN.test(fold(u.target))))) units.push({id: u.id, prompt: u.prompt, target: u.target, kind: 'repair', language_kind: u.kind, has_ref: u.has_ref, target_source: u.target_source, probe: 'sealed-child'});
  HAND.forEach(([kind, prompt, target], i) => units.push({id: `probe-hand-${String(i + 1).padStart(2, '0')}`, prompt, target, kind: 'repair', language_kind: kind, has_ref: true, target_source: 'hand-written (language-proofing-it2-agent, unreviewed)', probe: 'hand'}));
  fs.writeFileSync(FILE, units.map(u => JSON.stringify(u)).join('\n') + '\n');
  const by = {};
  for (const u of units) by[`${u.probe}/${u.language_kind}`] = (by[`${u.probe}/${u.language_kind}`] ?? 0) + 1;
  console.log(JSON.stringify({file: path.relative(ROOT, FILE), units: units.length, by}, null, 1));
}

function score(name, tag = 'probe') {
  const units = new Map(readJsonl(FILE).map(u => [u.id, u]));
  const outs = readJsonl(path.join(WORK, 'outputs', `${name}__${tag}.jsonl`));
  const res = {};
  for (const o of outs) {
    const u = units.get(o.id), inFold = fold(u.prompt), out = fold(o.output), child = CHILD_IN.test(inFold), parentIn = PARENT_IN.test(inFold);
    const key = `${u.probe}/${u.language_kind}`, r = (res[key] ??= {n: 0, child_kept: 0, child_units: 0, parent_flip: 0, parent_units: 0, parent_kept: 0});
    r.n++;
    const kept = /\b(child|children|kid|kids|son|sons|daughter|daughters)\b/.test(out);
    if (child) { r.child_units++; if (kept) r.child_kept++; if (/\bparents?\b/.test(out) && !parentIn) r.parent_flip++; }
    if (parentIn) { r.parent_units++; if (/\bparents?\b/.test(out)) r.parent_kept++; }
  }
  const total = {n: 0, child_units: 0, child_kept: 0, parent_flip: 0, parent_units: 0, parent_kept: 0};
  for (const r of Object.values(res)) for (const k of Object.keys(total)) total[k] += r[k];
  const out = {name, tag, total, by: res};
  fs.mkdirSync(path.join(WORK, 'scores'), {recursive: true});
  fs.writeFileSync(path.join(WORK, 'scores', `probe-child__${name}.json`), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), i = rest.indexOf('--name');
  if (cmd === 'build') build(); else if (cmd === 'score') score(rest[i + 1]); else { console.error('usage: build|score --name NAME'); process.exitCode = 2; }
}
