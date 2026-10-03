#!/usr/bin/env node
/**
 * Formalization machine, phase 2 stage 1 (experiments/proposal/formalization-machine-phase1.md section 8; coordinator's go of
 * 2026-10-03): the frozen method library with the local `tiny` (Qwen3-4B, no thinking) as frame-filler on 30 held-out problems, in two
 * arms, against `good`'s phase-1 trees of the same problems (run `held-r`, the cached phase-1 answers rescored with clock rendering):
 *   T  tiny writes the whole tree (the phase-1 prompt, no worked solution);
 *   S  tiny gets good's skeleton (goals, goal types, methods, node wiring; every other slot value "?") and fills the slots.
 * Measures: method-choice accuracy (T; on good's SOLVED problems: same executed method set, Jaccard), frame-filling accuracy (S: share of
 * good's executed nodes whose value tiny reproduces at the same node; T: share of good's node values found among tiny's node values),
 * outcomes against good's. Offline research harness.
 *
 *   node tools/eval/method-library/phase2.mjs --n 30 --run-id p2s1 [--concurrency 4]
 */
import fs from 'node:fs';
import path from 'node:path';
import {loadLibrary} from './library.mjs';
import {runTree} from './machine.mjs';
import {engines} from './primitives.mjs';
import {STATE, question, solveOne, pool, register} from './run.mjs';
import {extractNumbers} from '../../../lib/formalize/registry.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const ITEMS = path.join(STATE, '../../datasets_sources/books/eval/items.jsonl');

/** The first n held-out problems, round robin over books (the split's seeded order inside a book). */
export function stageIds(n) {
  const held = JSON.parse(fs.readFileSync(path.join(STATE, 'split.json'), 'utf8')).held;
  const books = [...new Set(held.map(x => x.book))].sort(), out = [];
  for (let k = 0; out.length < n; k++) for (const b of books) { const x = held.filter(h => h.book === b)[k]; if (x && out.length < n) out.push(x.id); }
  return out;
}

const NODE = /^n\d+$/;
/** good's tree with every slot value that is not node wiring replaced by "?" (a list of node references is wiring and stays). */
export function skeletonOf(tree) {
  const blank = v => typeof v === 'string' && NODE.test(v.trim()) ? v : Array.isArray(v) && v.length && v.every(x => typeof x === 'string' && NODE.test(x.trim())) ? v : '?';
  return {goals: (tree.goals ?? []).map(g => g.status ? {id: g.id, status: g.status} : {id: g.id, type: g.type, node: g.node}),
    nodes: (tree.nodes ?? []).map(n => ({id: n.id, method: n.method, slots: Object.fromEntries(Object.entries(n.slots ?? {}).map(([k, v]) => [k, blank(v)]))}))};
}

const skeletonPrompt = (item, lib, skel) => `${question(item, lib)}\n\nA planner has already chosen the goals, their types, the methods and how the nodes feed each other:\n${JSON.stringify(skel)}\nKeep every goal, node id, method and node reference exactly as given. Replace every "?" by the slot value in the formats above (from the problem and its registry). Reply with the complete JSON object.`;

const key = v => typeof v === 'number' ? `n:${Number(v.toPrecision(9))}` : JSON.stringify(v);
const valued = report => Object.entries(report ?? {}).filter(([, x]) => 'value' in x && x.value !== null && x.kind !== 'text');

async function main() {
  const n = Number(args.n ?? 30), runId = String(args['run-id'] ?? 'p2s1'), dir = path.join(STATE, runId);
  fs.mkdirSync(dir, {recursive: true});
  const ids = stageIds(n), lib = loadLibrary();
  const items = new Map(readJsonl(ITEMS).map(i => [i.id, i]));
  const good = new Map(readJsonl(path.join(STATE, String(args.reference ?? 'held-r'), 'results.jsonl')).map(r => [r.id, r]));
  await register(`ml-${runId}`, 1);
  // good's node values: its stored tree re-executed (no model).
  const goodNodes = new Map();
  for (const id of ids) { const g = good.get(id); goodNodes.set(id, g?.tree ? (await runTree(g.tree, {lib, registry: extractNumbers(items.get(id).question, {max: 40})})).nodes : {}); }
  const rows = await pool(ids, Number(args.concurrency ?? 4), async (id, k) => {
    const item = items.get(id), g = good.get(id);
    const T = await solveOne(item, lib, {run: `ml-${runId}`, solution: false, tier: 'tiny'});
    const S = g?.tree?.nodes?.length ? await solveOne(item, lib, {run: `ml-${runId}`, solution: false, tier: 'tiny', prompt: skeletonPrompt(item, lib, skeletonOf(g.tree))}) : null;
    const gv = valued(goodNodes.get(id));
    const tv = new Set(valued(T.node_report).map(([, x]) => key(x.value)));
    const sv = S?.node_report ?? {};
    const gm = new Set(g?.used_methods ?? []), tm = new Set(T.used_methods);
    const jac = gm.size || tm.size ? [...gm].filter(m => tm.has(m)).length / new Set([...gm, ...tm]).size : 1;
    const row = {id, book: item.book, good: g?.outcome ?? null, T: T.outcome, S: S?.outcome ?? null,
      T_blocked: T.blocked_by, S_blocked: S?.blocked_by ?? null,
      types_same: JSON.stringify((g?.goals ?? []).map(x => x.type).sort()) === JSON.stringify(T.goals.map(x => x.type).sort()),
      methods_same: gm.size > 0 && jac === 1, methods_jaccard: Math.round(jac * 100) / 100,
      T_values_found: gv.length ? gv.filter(([, x]) => tv.has(key(x.value))).length : null, S_nodes_same: gv.length && S ? gv.filter(([nid, x]) => sv[nid] && 'value' in sv[nid] && key(sv[nid].value) === key(x.value)).length : null, good_nodes: gv.length,
      T_tree: T.tree, S_tree: S?.tree ?? null, T_attempts: T.attempts.map(a => ({finish: a.finish, error: a.error})), S_attempts: S?.attempts.map(a => ({finish: a.finish, error: a.error})) ?? null};
    process.stderr.write(`${k + 1}/${ids.length} ${id} good=${row.good} T=${row.T} S=${row.S}\n`);
    return row;
  });
  fs.writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const tally = f => { const c = {}; for (const r of rows) { const v = f(r); if (v !== null) c[v] = (c[v] ?? 0) + 1; } return c; };
  const solvedG = rows.filter(r => r.good === 'SOLVED');
  const sum = (xs, f) => xs.reduce((s, r) => s + (f(r) ?? 0), 0);
  const summary = {run: runId, n: rows.length, outcomes: {good: tally(r => r.good), T: tally(r => r.T), S: tally(r => r.S)},
    unreadable: {T: rows.filter(r => r.T_blocked === 'no_tree').length, S: rows.filter(r => r.S_blocked === 'no_tree').length},
    method_choice_on_good_solved: {n: solvedG.length, same_set: solvedG.filter(r => r.methods_same).length, mean_jaccard: Math.round(100 * sum(solvedG, r => r.methods_jaccard) / (solvedG.length || 1)) / 100,
      goal_types_same: solvedG.filter(r => r.types_same).length},
    frame_filling: {S_nodes_reproduced: sum(rows, r => r.S_nodes_same), T_values_found: sum(rows, r => r.T_values_found), good_nodes: sum(rows, r => r.good_nodes)},
    paired: {T_vs_good: {both: rows.filter(r => r.T === 'SOLVED' && r.good === 'SOLVED').length, good_only: rows.filter(r => r.T !== 'SOLVED' && r.good === 'SOLVED').length, T_only: rows.filter(r => r.T === 'SOLVED' && r.good !== 'SOLVED').length},
      S_vs_good: {both: rows.filter(r => r.S === 'SOLVED' && r.good === 'SOLVED').length, good_only: rows.filter(r => r.S !== 'SOLVED' && r.good === 'SOLVED').length, S_only: rows.filter(r => r.S === 'SOLVED' && r.good !== 'SOLVED').length}}};
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  (await engines()).dispose();
}

if (import.meta.url === `file://${path.resolve(process.argv[1] ?? '')}`) await main();
