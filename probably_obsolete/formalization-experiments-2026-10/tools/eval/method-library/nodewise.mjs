#!/usr/bin/env node
/**
 * Node-by-node filling of the method library (coordinator, 2026-10-03; the method library adequate, one-shot filling by tiny not): the
 * same tree format as phase 1/2 (goals with a goal type and a node, nodes applying one METHOD of config/knowledge/formalizer-methods-v1
 * with filled slots), built by CLOSED questions, one at a time, in the InternalReasoningStepByStep pattern:
 *   goals    one line per asked item with an answer kind from a menu;
 *   type     per goal, the goal types whose answer kind matches (a numbered menu; one candidate is taken without asking);
 *   method   the methods that achieve that type ("use when" texts; a numbered menu);
 *   slots    each slot of the method by its kind: a registry number vK (or `new` to work it out first: a sub-goal through the slot's
 *            decomposition type, or `const N` for a fixed number), a list of them, a menu choice, names copied from the problem, a
 *            yes/no or a yes/no sub-goal, facts and rules as lines, the asked atom; the rarer kinds as one focused JSON value;
 *   escalation  an answer that cannot be read twice goes to the next tier (tiny -> small -> good) with the same conversation.
 * The tree is executed by the method machine (machine.mjs runTree) and scored like phase 2. Offline research harness.
 *   node tools/eval/method-library/nodewise.mjs --run-id nw1 [--n 30] [--tiers tiny,small,good] [--concurrency 4]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadLibrary} from './library.mjs';
import {runTree} from './machine.mjs';
import {engines} from './primitives.mjs';
import {STATE, chat, pool, register, TIER_OPTIONS} from './run.mjs';
import {stageIds} from './phase2.mjs';
import {goldOf, executedAnswers, deterministicVerdict, judgeQuestion, JUDGE_SYSTEM, classify} from './score.mjs';
import {extractNumbers} from '../../../lib/formalize/registry.mjs';
import {readChoice, readChoices, readYesNo} from '../../../lib/query-author/step-by-step/answers.mjs';

const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const strip = t => String(t ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*|`/g, '').trim();
const lines = t => strip(t).split('\n').map(s => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
const SYSTEM = 'You help a formalization machine. It asks short questions about one problem, one at a time. Answer exactly in the format each question asks: a number, a list, vK references, or a few short lines. Never solve the problem and never explain.';

/** The answer kinds of the goals question, mapped to the library's goal-type answers. */
const KINDS = [['number', 'a number', ['number', 'number or assignment']], ['yesno', 'yes or no (true, allowed, forced, possible)', ['yesno', 'yesno or undetermined']], ['entity', 'which named option or thing', ['entity', 'entity or set']],
  ['set', 'who or which things (several may fit)', ['entity or set']], ['order', 'an order or arrangement of things', ['order', 'assignment', 'number or assignment']], ['text', 'an explanation or a reason (why, what is forced)', ['text']]];

/** A conversation with the per-question tier ladder. */
function conversation(item, {tiers, run}) {
  const messages = [{role: 'system', content: SYSTEM}];
  const log = [];
  return {log, async read(name, text, reader, again, maxTokens = 300) {
    for (const tier of tiers) {
      // Every question is asked on its own (the problem and its registry, then the question): a growing conversation overflows the
      // small model's slot context and returns empty answers. A re-ask carries the first answer and the format reminder.
      messages.length = 1;
      const mark = messages.length;
      for (let attempt = 0; attempt < 2; attempt++) {
        messages.push({role: 'user', content: attempt ? `That could not be read. ${again}` : text});
        const a = await chat(tier, messages, {run, maxTokens: tier === 'tiny' ? Math.min(maxTokens, TIER_OPTIONS.tiny.maxTokens) : 32000, effort: 'low'});
        log.push({name, tier, attempt, ok: a.ok, answer: String(a.text ?? '').slice(0, 600), cached: a.cached ?? null});
        if (!a.ok) { messages.length = mark; break; }
        messages.push({role: 'assistant', content: a.text});
        const v = reader(a.text);
        if (v !== null && v !== undefined) return {value: v, tier};
      }
      messages.length = mark;
    }
    return {value: null, tier: null};
  }};
}

/** Builds the tree by closed questions. Returns {tree, questions, escalated}. */
export async function buildTree(item, lib, {tiers = ['tiny', 'small', 'good'], run = 'ml-nodewise', maxNodes = 10, maxDepth = 2, given = null, reference = null} = {}) {
  const reg = extractNumbers(item.question, {max: 40});
  const numbers = reg.map(v => `v${v.index} = ${v.span}${v.percent ? ` (= ${v.value / 100})` : ''}   [${v.context}]`).join('\n') || '(none)';
  const c = conversation(item, {tiers, run});
  const nodes = [], goals = [];
  const vref = t => { const m = /^\s*v(\d+)\s*$/i.exec(t); return m && Number(m[1]) >= 1 && Number(m[1]) <= reg.length ? `v${m[1]}` : null; };
  const constOf = t => { const m = /^\s*const\s+(-?\d+(?:\.\d+)?)/i.exec(t); return m ? {const: Number(m[1]), why: 'fixed number named by the model'} : null; };
  const head = `The problem:\n<<<\n${item.question}\n>>>\nIts numbers (refer to them as vK):\n${numbers}\n\n`;
  const ask = async (name, text, reader, again, tokens) => c.read(name, head + text, reader, again, tokens);

  // A node for a (sub-)goal of `type` described by `what`; returns the node id or null.
  // `fixed` (the counterfactual arms): {id, method, slots} of good's node: its method is taken, its node wiring kept, every other slot asked.
  const nodeFor = async (type, what, depth, fixed = null) => {
    if (!fixed && (nodes.length >= maxNodes || depth > maxDepth)) return null;
    const methods = fixed ? [lib.methods.get(fixed.method)].filter(Boolean) : [...lib.methods.values()].filter(m => m.achieves.includes(type));
    if (!methods.length) return null;
    const m = methods.length === 1 ? methods[0] : methods[(await ask('method', `For "${what}" (a ${type.replaceAll('_', ' ')} goal), which method applies?\n${methods.map((x, i) => `${i + 1}. ${x.text}`).join('\n')}\nReply with the number only.`,
      t => readChoice(t, methods.length), `Reply with one number from 1 to ${methods.length}.`, 8)).value - 1] ?? null;
    if (!m) return null;
    const id = fixed?.id ?? `n${nodes.length + 1}`, node = {id, method: m.id, slots: {}};
    nodes.push(node);
    const wiring = v => typeof v === 'string' && /^n\d+$/.test(v.trim()) || Array.isArray(v) && v.length && v.every(x => typeof x === 'string' && /^n\d+$/.test(x.trim()));
    for (const s of m.slots) {
      if (fixed && wiring(fixed.slots?.[s.name])) { node.slots[s.name] = fixed.slots[s.name]; continue; }
      if (fixed && fixed.slots?.[s.name] === undefined) continue;
      if (s.optional && !fixed) continue;
      // The slots this step already has: later slots reuse their names (relation names of the facts in the rules and the question).
      const filled = Object.entries(node.slots).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n');
      const label = `${filled ? `(this step so far:\n${filled}\n) ` : ''}the slot "${s.name}" of ${m.id.replaceAll('_', ' ')} (${s.text}) for "${what}"`;
      // In the skeleton arm the wiring is given: no new sub-goal nodes (their ids would collide with the given ones).
      const sub = async t2 => fixed ? null : nodeFor(s.subgoal ?? (s.kind.startsWith('yesno') ? 'check_condition' : 'find_value'), t2, depth + 1);
      if (s.kind === 'number') {
        const r = await ask(`slot:${s.name}`, `Which value is ${label}? Reply with vK for a number of the problem, \`new\` if it must be worked out first, or \`const N\` for a fixed number the problem does not write in digits (60 minutes in an hour, 2 for twice).`,
          t => vref(strip(t)) ?? constOf(strip(t)) ?? (/^\s*new\b/i.test(strip(t)) ? 'new' : null), 'Reply with vK, new, or const N.', 16);
        node.slots[s.name] = r.value === 'new' ? await sub(`${s.text} for ${what}`) : r.value;
      } else if (s.kind === 'numbers' && Array.isArray(Object.values(node.slots).find(v => Array.isArray(v) && v.every(x => typeof x === 'string' && !/^v\d+$|^n\d+$/.test(x))))) {
        // A list of numbers next to a list of named things: one value per thing.
        const things = Object.values(node.slots).find(v => Array.isArray(v) && v.every(x => typeof x === 'string' && !/^v\d+$|^n\d+$/.test(x)));
        const out = [];
        for (const thing of things) {
          const r = await ask(`slot:${s.name}`, `For ${thing}: which value is ${label}? Reply with vK for a number of the problem, \`new\` if it must be worked out first, or \`const N\` for a fixed number.`,
            t => vref(strip(t)) ?? constOf(strip(t)) ?? (/^\s*new\b/i.test(strip(t)) ? 'new' : null), 'Reply with vK, new, or const N.', 16);
          out.push(r.value === 'new' ? await sub(`${s.text} for ${thing}`) : r.value);
        }
        node.slots[s.name] = out;
      } else if (s.kind === 'numbers') {
        const r = await ask(`slot:${s.name}`, `Which values are ${label}? Reply with vK references separated by commas; write \`new\` for each value that must be worked out first.`,
          t => { const xs = strip(t).split(/[,\n]+/).map(x => x.trim()).filter(Boolean); const out = xs.map(x => vref(x) ?? constOf(x) ?? (/^new\b/i.test(x) ? 'new' : null)); return out.length && out.every(x => x !== null) ? out : null; }, 'Reply like `v1, v3, new`.', 60);
        node.slots[s.name] = r.value ? await Promise.all(r.value.map(async (x, i) => x === 'new' ? sub(`value ${i + 1} of ${s.text} for ${what}`) : x)) : null;
      } else if (s.kind === 'menu') {
        const r = await ask(`slot:${s.name}`, `Which is ${label}?\n${s.choices.map((x, i) => `${i + 1}. ${x.value.replaceAll('_', ' ')}`).join('\n')}\nReply with the number only.`, t => readChoice(t, s.choices.length), `Reply with one number from 1 to ${s.choices.length}.`, 8);
        node.slots[s.name] = r.value ? s.choices[r.value - 1].value : null;
      } else if (s.kind === 'thing' || s.kind === 'things') {
        const folded = item.question.toLowerCase();
        const r = await ask(`slot:${s.name}`, `Which ${s.kind === 'thing' ? 'name is' : 'names are'} ${label}? Copy ${s.kind === 'thing' ? 'it' : 'each'} exactly as the problem writes it, one per line.`,
          t => { const xs = lines(t).map(x => x.replace(/^["“]|["”]$/g, '')).filter(x => folded.includes(x.toLowerCase())); return xs.length ? (s.kind === 'thing' ? xs[0] : xs) : null; }, 'One name per line, copied from the problem.', 80);
        node.slots[s.name] = r.value;
      } else if (s.kind === 'yesno') {
        node.slots[s.name] = await sub(`${s.text} for ${what}`);
      } else if (s.kind === 'yesnos') {
        const r = await ask(`slot:${s.name}`, `List the separate yes/no checks of ${label}, one short line per check.`, t => { const xs = lines(t); return xs.length ? xs.slice(0, 6) : null; }, 'One check per line.', 160);
        node.slots[s.name] = r.value ? (await Promise.all(r.value.map(async x => sub(x)))).filter(Boolean) : null;
      } else if (s.kind === 'node') {
        const r = nodes.length > 1 ? await ask(`slot:${s.name}`, `Which earlier step is ${label}?\n${nodes.filter(n => n !== node).map((n, i) => `${i + 1}. ${n.method.replaceAll('_', ' ')} (${n.id})`).join('\n')}\nReply with the number only.`, t => readChoice(t, nodes.length - 1), 'Reply with one number.', 8) : {value: null};
        node.slots[s.name] = r.value ? nodes.filter(n => n !== node)[r.value - 1].id : (nodes.length > 1 ? nodes[0].id : null);
      } else if (s.kind === 'atoms') {
        const r = await ask(`slot:${s.name}`, `Write ${label}, one per line, as \`relation "Thing"\` or \`relation "Thing" "Other"\` (\`not relation "Thing"\` for a stated negative); relation names are short lowercase words with underscores, used the same way everywhere.`,
          t => { const xs = lines(t).filter(x => /^(not\s+)?[a-z][a-z0-9_]*(\s+"[^"]+"){1,2}$/.test(x)); return xs.length ? xs : null; }, 'Lines like `listed_bird "sparrow"`.', 300);
        node.slots[s.name] = r.value;
      } else if (s.kind === 'rules') {
        const r = await ask(`slot:${s.name}`, `Write ${label}, one per line, as \`if <atom> and <atom> then <atom>\` (add \`unless <atom>\` for an exception), atoms like \`relation ?x\` or \`relation ?x "Thing"\` with the same relation names as the facts. Reply none if there are none.`,
          t => { if (/^\s*none\b/i.test(strip(t))) return []; const out = []; for (const x of lines(t)) { const m = /^if\s+(.+?)\s+then\s+(.+?)(?:\s+unless\s+(.+))?$/i.exec(x); if (m) out.push({if: m[1].split(/\s+and\s+/i), then: m[2], ...(m[3] ? {unless: m[3].split(/\s+and\s+/i)} : {})}); } return out.length ? out : null; }, 'Lines like `if listed_bird ?x then lays_eggs ?x`, or none.', 300);
        node.slots[s.name] = r.value;
      } else if (s.kind === 'question') {
        const r = await ask(`slot:${s.name}`, `Write ${label} as one atom with the same relation names, like \`lays_eggs "sparrow"\` (\`relation ?x\` when it asks who).`, t => { const x = lines(t)[0]; return x && /^(not\s+)?[a-z][a-z0-9_]*(\s+("[^"]+"|\?[a-z]\w*)){1,2}$/.test(x) ? {atom: x} : null; }, 'One atom like `lays_eggs "sparrow"`.', 60);
        node.slots[s.name] = r.value;
      } else {
        const r = await ask(`slot:${s.name}`, `Give ${label} as one JSON value in the machine's format for a ${s.kind} slot. Reply with the JSON value only.`, t => { try { return JSON.parse(strip(t).replace(/^json\s*/i, '')); } catch { return null; } }, 'One JSON value only.', 400);
        node.slots[s.name] = r.value;
      }
    }
    return id;
  };

  if (given === 'skeleton' && reference?.nodes?.length) {
    for (const n of reference.nodes) await nodeFor(null, `step ${n.id} (${n.method.replaceAll('_', ' ')})`, 0, n);
    for (const g0 of reference.goals ?? []) goals.push(g0.status ? {id: g0.id, status: g0.status, reason: 'given'} : {id: g0.id, asks: g0.asks ?? g0.id, type: g0.type, node: g0.node});
    return {tree: {goals, nodes}, questions: c.log.length, escalated: c.log.filter(x => x.tier !== tiers[0] && x.attempt === 0).length, log: c.log};
  }
  if (given === 'goals' && reference?.goals?.length) {
    for (const g0 of reference.goals) {
      if (g0.status || !g0.type) { goals.push({id: g0.id, status: g0.status ?? 'MISSING_METHOD', reason: 'given'}); continue; }
      const node = await nodeFor(g0.type, g0.asks ?? g0.type.replaceAll('_', ' '), 0);
      goals.push(node ? {id: g0.id, asks: g0.asks, type: g0.type, node} : {id: g0.id, asks: g0.asks, status: 'MISSING_METHOD', reason: 'no node built'});
    }
    return {tree: {goals, nodes}, questions: c.log.length, escalated: c.log.filter(x => x.tier !== tiers[0] && x.attempt === 0).length, log: c.log};
  }
  const g = await ask('goals', `What does the question ask for? One line per asked item, as \`gK: <the asked item in a few words> | <kind number>\`, with the kinds:\n${KINDS.map(([, t], i) => `${i + 1}. ${t}`).join('\n')}`,
    t => { const out = []; for (const x of lines(t)) { const m = /^g\w*\s*[:=-]\s*(.+?)\s*\|\s*(\d+)/i.exec(x); const k = m ? readChoice(m[2], KINDS.length) : null; if (k) out.push({asks: m[1].slice(0, 80), kind: KINDS[k - 1]}); } return out.length ? out.slice(0, 4) : null; },
    'One line per asked item, like `g1: total cost | 1`.', 160);
  for (const [k, goal] of (g.value ?? []).entries()) {
    const types = [...lib.goalTypes.values()].filter(t => goal.kind[2].includes(t.answer));
    const type = types.length === 1 ? types[0] : types[(await ask('type', `For "${goal.asks}", which kind of goal is it?\n${types.map((t, i) => `${i + 1}. ${t.text}`).join('\n')}\nReply with the number only.`,
      t => readChoice(t, types.length), `Reply with one number from 1 to ${types.length}.`, 8)).value - 1] ?? null;
    if (!type) { goals.push({id: `g${k + 1}`, asks: goal.asks, status: 'MISSING_METHOD', reason: 'no goal type chosen'}); continue; }
    const node = await nodeFor(type.id, goal.asks, 0);
    goals.push(node ? {id: `g${k + 1}`, asks: goal.asks, type: type.id, node} : {id: `g${k + 1}`, asks: goal.asks, status: 'MISSING_METHOD', reason: 'no node built'});
  }
  return {tree: {goals, nodes}, questions: c.log.length, escalated: c.log.filter(x => x.tier !== tiers[0] && x.attempt === 0).length, log: c.log};
}

const key = v => typeof v === 'number' ? `n:${Number(v.toPrecision(9))}` : JSON.stringify(v);
const valued = report => Object.entries(report ?? {}).filter(([, x]) => 'value' in x && x.value !== null && x.kind !== 'text');

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
  const runId = String(args['run-id'] ?? 'nw1'), dir = path.join(STATE, runId), tiers = String(args.tiers ?? 'tiny,small,good').split(',');
  fs.mkdirSync(dir, {recursive: true});
  const ids = stageIds(Number(args.n ?? 30)), lib = loadLibrary();
  const items = new Map(readJsonl(path.join(STATE, '../../datasets_sources/books/eval/items.jsonl')).map(i => [i.id, i]));
  const good = new Map(readJsonl(path.join(STATE, 'held-r', 'results.jsonl')).map(r => [r.id, r]));
  await register(`ml-${runId}`, 1);
  const rows = await pool(ids, Number(args.concurrency ?? 4), async (id, k) => {
    const item = items.get(id), registry = extractNumbers(item.question, {max: 40});
    const b = await buildTree(item, lib, {tiers, run: `ml-${runId}`, given: args.given ?? null, reference: good.get(id)?.tree ?? null});
    const exec = await runTree(b.tree, {lib, registry});
    const answers = executedAnswers(exec), gold = goldOf(item);
    let verdict = answers.length ? deterministicVerdict(gold, answers) : null;
    if (answers.length && !verdict) {
      const j = await chat('medium', [{role: 'system', content: JUDGE_SYSTEM}, {role: 'user', content: judgeQuestion(item, answers)}], {run: `ml-${runId}`, maxTokens: 8000, effort: 'low'});
      let v = null; try { v = JSON.parse(strip(j.text).slice(strip(j.text).indexOf('{'), strip(j.text).lastIndexOf('}') + 1)); } catch { /* mismatch */ }
      verdict = ['match', 'partial', 'mismatch'].includes(v?.verdict) ? v.verdict : 'mismatch';
    }
    const cls = classify(exec, {verdict});
    const g = good.get(id);
    const gm = new Set(g?.used_methods ?? []), nm = new Set(exec.usedMethods ?? []);
    const jac = gm.size || nm.size ? [...gm].filter(m => nm.has(m)).length / new Set([...gm, ...nm]).size : 1;
    const gv = g?.tree ? valued((await runTree(g.tree, {lib, registry})).nodes) : [];
    const nv = new Set(valued(exec.nodes).map(([, x]) => key(x.value)));
    const row = {id, book: item.book, good: g?.outcome ?? null, N: cls.outcome, N_blocked: cls.blocked_by ?? null, verdict,
      types_same: JSON.stringify((g?.goals ?? []).map(x => x.type).sort()) === JSON.stringify(b.tree.goals.map(x => x.type).sort()),
      methods_same: gm.size > 0 && jac === 1, methods_jaccard: Math.round(jac * 100) / 100, values_found: gv.filter(([, x]) => nv.has(key(x.value))).length, good_nodes: gv.length,
      questions: b.questions, escalated: b.escalated, tree: b.tree, log: b.log};
    process.stderr.write(`${k + 1}/${ids.length} ${id} good=${row.good} N=${row.N} q=${b.questions} esc=${b.escalated}\n`);
    return row;
  });
  fs.writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const tally = f => { const c = {}; for (const r of rows) { const v = f(r); if (v !== null) c[v] = (c[v] ?? 0) + 1; } return c; };
  const solvedG = rows.filter(r => r.good === 'SOLVED');
  const summary = {run: runId, n: rows.length, tiers, given: args.given ?? null, outcomes: {N: tally(r => r.N), good: tally(r => r.good)},
    method_choice_on_good_solved: {n: solvedG.length, same_set: solvedG.filter(r => r.methods_same).length, mean_jaccard: Math.round(100 * solvedG.reduce((s, r) => s + r.methods_jaccard, 0) / (solvedG.length || 1)) / 100, goal_types_same: solvedG.filter(r => r.types_same).length},
    slot_values: {found: rows.reduce((s, r) => s + r.values_found, 0), good_nodes: rows.reduce((s, r) => s + r.good_nodes, 0)},
    paired: {both: rows.filter(r => r.N === 'SOLVED' && r.good === 'SOLVED').length, good_only: rows.filter(r => r.N !== 'SOLVED' && r.good === 'SOLVED').length, N_only: rows.filter(r => r.N === 'SOLVED' && r.good !== 'SOLVED').length},
    questions_mean: Math.round(10 * rows.reduce((s, r) => s + r.questions, 0) / rows.length) / 10, escalated_questions: rows.reduce((s, r) => s + r.escalated, 0)};
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  (await engines()).dispose();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
