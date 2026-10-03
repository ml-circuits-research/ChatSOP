#!/usr/bin/env node
/** Prints the traces of one path on the problems of a run (the controller's review of questions and heuristics; local, book text). */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './common.mjs';
import {loadItems} from '../formalization-regression/cases.mjs';
const [run, pathName, filter = ''] = process.argv.slice(2);
const items = loadItems();
const rows = fs.readFileSync(path.join(ROOT, 'state/six-paths', run, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
for (const r of rows) {
  const p = r.paths[pathName];
  if (!p || (filter && !(p.verdict === filter || r.id === filter))) continue;
  const it = items.get(r.id);
  console.log(`\n=== ${r.id} [${p.verdict}/${p.status}] ${p.why ?? ''}\nQ: ${it.question}\nGOLD: ${it.answer} | ${JSON.stringify(it.answer_value)}\nGOT: ${JSON.stringify(p.profile?.[0] ?? null)}  decision ${r.decision?.status} ${JSON.stringify(r.decision?.answers ?? null)}`);
  for (const t of p.trace) console.log(`--- ${t.id}${t.round ? ` (round ${t.round})` : ''}${t.stop ? ` STOP ${t.stop}` : ''}${t.read === null ? ' [unread]' : ''}\n${t.answer ?? t.reason ?? ''}`);
  if (p.program) console.log(`--- program\n${p.program}`);
  if (p.tree) console.log(`--- tree ${JSON.stringify(p.tree)}`);
}
