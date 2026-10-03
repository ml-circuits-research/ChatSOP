#!/usr/bin/env node
/**
 * The formalization-machine experiment, phase 1 (experiments/proposal/formalization-machine-phase1.md; preregistration
 * status/preregistrations/eval-formalization-machine-v1.json): does a small library of goal types and METHODs, with a few primitive
 * interpreters, cover the owner's book problems by composition alone, with the model only filling frames and choosing methods?
 * Offline research harness: it calls the proxy tier `good` (frame-filler) and `medium` (judge) with purpose `job:method-library`, the
 * proxy's response cache on; it never changes the product path.
 *
 *   node tools/eval/method-library/run.mjs split                      the 300-problem sample, split by section family into dev/held-out
 *   node tools/eval/method-library/run.mjs run --set dev --from 0 --to 30 --run-id dev1 [--solution] [--concurrency 6]
 *   node tools/eval/method-library/run.mjs proposals --run-id dev1    the new methods proposed in a dev run, with their use and outcome
 *   node tools/eval/method-library/run.mjs adopt --file specs.json --stage dev1     render reviewed methods into the grown layer file
 *   node tools/eval/method-library/run.mjs report --dev dev-final --held held [--held-sol held-sol]
 *
 * Book text stays in the gitignored datasets_sources/ and state/ (DS011): results, prompts and answers are written to
 * state/method-library/<run-id>/; the repository receives ids, counts and the library (generic methods, no book text).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadLibrary, renderLibrary, checkMethod, methodSop, goalTypeSop, LAYER} from './library.mjs';
import {runTree, readTree} from './machine.mjs';
import {goldOf, executedAnswers, deterministicVerdict, judgeQuestion, JUDGE_SYSTEM, classify, causeOf} from './score.mjs';
import {extractNumbers} from '../../../lib/formalize/registry.mjs';
import {engines} from './primitives.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ITEMS = path.join(ROOT, 'datasets_sources/books/eval/items.jsonl');
export const STATE = path.join(ROOT, 'state/method-library');
const PROXY = process.env.LLMAPIPROVIDER_URL ?? 'http://127.0.0.1:18080';
const JOB = 'method-library';
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const sha = t => createHash('sha256').update(String(t)).digest('hex');
const args = Object.fromEntries(process.argv.slice(3).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));

// ---------------------------------------------------------------- sample and split

/** Ids excluded from the sample: the formalization regression set, the items seen by other runs, and the problems read while designing. */
function excluded() {
  const out = new Set(readJsonl(path.join(ROOT, 'datasets_sources/books/eval/seen.jsonl')).map(r => r.id ?? r));
  for (const c of readJsonl(path.join(ROOT, 'eval/formalization-regression/cases.jsonl'))) if (String(c.id).startsWith('books/')) out.add(String(c.id).slice(6));
  for (const id of readJsonl(path.join(STATE, 'design-read.jsonl')).map(r => r.id)) out.add(id);
  return out;
}

/**
 * 300 problems stratified by book (43 per book, 42 for the last), split by section family: a book's family key is the coarser of its two
 * groupings (first tag or section; e.g. the decomposition book's ten problem shapes, the logic book's 100 sections), the families of a
 * book are ranked by a seeded hash and alternate between dev and held-out, so no held-out family is seen while building; within a side
 * the problems are taken round robin over its families (one per family per round, random order inside a family).
 */
export function split({seed = 'ml-split-1', perBook = 43} = {}) {
  const items = readJsonl(ITEMS), skip = excluded();
  const rank = s => sha(`${seed}\0${s}`);
  const books = [...new Set(items.map(i => i.book))].sort();
  const dev = [], held = [];
  books.forEach((book, bi) => {
    const want = bi === books.length - 1 ? perBook - 1 : perBook;
    const all = items.filter(x => x.book === book);
    const key = new Set(all.map(i => i.tags?.[0])).size <= new Set(all.map(i => i.section)).size ? (i => i.tags?.[0] ?? i.section) : (i => i.section);
    const fams = new Map();
    for (const i of all.filter(x => x.question && x.answer && !skip.has(x.id))) { const f = key(i); if (!fams.has(f)) fams.set(f, []); fams.get(f).push(i); }
    for (const list of fams.values()) list.sort((a, b) => rank(a.id).localeCompare(rank(b.id)));
    const order = [...fams.keys()].sort((a, b) => rank(`${book}\0${a}`).localeCompare(rank(`${book}\0${b}`)));
    const sides = [order.filter((_, k) => k % 2 === 0), order.filter((_, k) => k % 2 === 1)];
    const take = (fs_, n) => { const out = []; for (let round = 0; out.length < n && round < 1000; round++) for (const f of fs_) { if (out.length >= n) break; const it = fams.get(f)[round]; if (it) out.push({id: it.id, book, family: f}); } return out; };
    const nd = Math.ceil(want / 2), nh = want - nd;
    dev.push(...take(sides[0], nd)); held.push(...take(sides[1], nh));
  });
  // Dev order: round robin over books, so each development stage is stratified.
  const byBook = b => dev.filter(x => x.book === b);
  const rr = []; for (let k = 0; rr.length < dev.length; k++) for (const b of books) if (byBook(b)[k]) rr.push(byBook(b)[k]);
  const devFam = new Set(rr.map(x => `${x.book}\0${x.family}`));
  if (held.some(x => devFam.has(`${x.book}\0${x.family}`))) throw new Error('a held-out family is also a dev family');
  return {seed, dev: rr, held};
}

// ---------------------------------------------------------------- model calls

let cost = {calls: 0, cache_hits: 0, failed: 0, in: 0, out: 0, reasoning: 0, usd: 0};
/** One call of a proxy tier (cached by the proxy), tagged for the job; {ok, text, usd, cached}. */
/** The request settings of a tier: the local `tiny` answers without thinking (DS: step-by-step questions on the 4B), the rest reason. */
export const TIER_OPTIONS = Object.freeze({tiny: {maxTokens: 3000, extraBody: {chat_template_kwargs: {enable_thinking: false}}}});
export async function chat(tier, messages, {run, maxTokens = 32000, effort = 'medium', retries = 2} = {}) {
  const t = TIER_OPTIONS[tier];
  const body = t ? {model: tier, messages, temperature: 0, max_tokens: t.maxTokens, ...t.extraBody} : {model: tier, messages, temperature: 0, max_tokens: maxTokens, reasoning: {effort}};
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${PROXY}/v1/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json', 'x-llmapiprovider-purpose': `job:${JOB}`, 'x-llmapiprovider-run': run, 'x-client-name': `job-${JOB}`, 'x-llmapiprovider-no-fallback': '1'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(900_000)});
      const text = await res.text();
      let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      if (res.status === 402 || res.status === 403) throw new Error(`refused: ${text.slice(0, 200)}`);
      if (!res.ok || !j?.choices?.[0]) { if (attempt === retries) { cost.failed++; return {ok: false, error: `${res.status} ${text.slice(0, 200)}`}; } await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
      const cached = res.headers.get('x-llmapiprovider-cache') === 'hit';
      const choice = j.choices[0];
      if (cached) cost.cache_hits++; else { cost.calls++; cost.in += j.usage?.prompt_tokens ?? 0; cost.out += j.usage?.completion_tokens ?? 0; cost.reasoning += j.usage?.completion_tokens_details?.reasoning_tokens ?? 0; cost.usd += Number(j.usage?.cost ?? 0); }
      return {ok: true, text: String(choice.message?.content ?? ''), finish: choice.finish_reason, cached, usd: Number(j.usage?.cost ?? 0)};
    } catch (error) {
      if (String(error.message).startsWith('refused')) throw error;
      if (attempt === retries) { cost.failed++; return {ok: false, error: error.message}; }
    }
  }
  return {ok: false, error: 'unreachable'};
}

// ---------------------------------------------------------------- the frame-filling question (a research prompt, eval-side)

const SYSTEM = 'You are the frame-filler of a formalization machine. You reply with one JSON object only.';
const FORMATS = `Slot values:
- "vK": a number of the problem from the registry below (a percentage vK already means its fraction: 15% is 0.15);
- "nK": the output of another node (a sub-goal);
- {"const": x, "why": "..."}: a number that is NOT in the problem but is a fixed definition or a stated word-number (60 minutes in an hour, 2 for "twice", 12 for "a dozen"); never an answer or an intermediate result you computed;
- names copied from the problem (options, things, people, hypotheses);
- atom: 'relation "Thing"' or 'relation "Thing" "Other"' ('not relation "Thing"' for a stated negative; ?x variables in rules and questions); relation names are short lowercase words you choose and use consistently;
- rule: {"if": [atoms], "unless": [atoms], "then": atom} (unless = the exception of a default);
- question: {"atom": "..."};
- clue: {"kind": "<a clue kind of the method>", "a": "Thing", "b": "Other", "c": "Third", "k": a position number or a value name};
- conditions (integer methods): words only, like "?x plus ?y equal 12", "?a at_least 3", "2 times ?x below ?y", or {"any": ["...", "..."]}; variables are declared in "variables" with integer bounds.`;
const STATUSES = `When a goal cannot be formalized with the library, give it a "status" and a short "reason" instead of a node:
MISSING_METHOD (no method or composition of methods fits), MISSING_CONCEPT (it relies on a definition or knowledge the problem does not state), MISSING_INFORMATION (a needed value or fact is not given), AMBIGUOUS (two readings give different answers), UNSUPPORTED_PRIMITIVE (it needs a kind of computation no primitive does), CONTRADICTORY (the stated data contradict each other).`;
const NEW_METHODS = `DEVELOPMENT MODE. The worked solution below shows the intended reasoning. If no method or composition of existing methods fits a goal, propose a NEW method (and, only if needed, a new goal type) and use it in your tree as if it existed; the machine will execute it. A new method must be general: no domain words in its id, slots or text, reusable for many other problems; prefer composing existing methods. Format:
"new_methods": [{"id": "lowercase_name", "achieves": ["<goal type>"], "solver": "<primitive>", "text": "when it applies", "slots": [{"name": "...", "kind": "number|numbers|yesno|yesnos|menu|thing|things|atoms|rules|question|clues|tasks|pairs|table|variables|conditions|text|node", "many": true, "optional": true, "text": "...", "choices": [{"value": "...", "op": "..."}], "subgoal": "<goal type>"}], "formula": "<calculate only>", "clues": {"<kind>": "<template>"}, "fixed": {}}]
"new_goal_types": [{"id": "...", "answer": "...", "operation": "...", "text": "..."}]
A calculate formula uses only slot names and + - * / % ( ) < <= > >= == != && || ! ?: and sum() prod() max() min() count() mean() over list slots, pick(list, i), ceil() floor() round() abs() round2(); a menu slot's name in the formula is replaced by its op. A clue template (constraints) uses ?A ?B ?C (the things of the clue), K (its k), N (the number of positions) and words (below, above, equal, not_equal, at_least, at_most, plus, minus, times), & for and, | for or. Other primitives take the frame fields shown by the existing methods of the same solver.
If the problem needs knowledge or a computation that no primitive can do, use a status instead of a method that would only restate the answer.`;

export function question(item, lib, {solution = false, propose = solution} = {}) {
  const reg = extractNumbers(item.question, {max: 40});
  const numbers = reg.map(v => `v${v.index} = ${v.span}${v.percent ? ` (= ${v.value / 100})` : ''}   [${v.context}]`).join('\n') || '(none)';
  return [`The machine answers a problem by executing METHODs of a fixed library. You only choose methods and fill their slots; you never compute, never state an answer, never write a formula.
1. List the goals: one per item the question asks. Give each a goal type of the library.
2. For each goal build nodes: a node applies one METHOD and fills its slots. Composition is normal: a slot may take the output of another node. The goal's "node" is the node whose output answers it.
3. ${STATUSES}`,
  FORMATS,
  `Reply with ONE JSON object:\n{"goals": [{"id": "g1", "asks": "<the asked item in a few words, no answer>", "type": "<goal type>", "node": "nK"} | {"id": "g2", "asks": "...", "status": "...", "reason": "..."}], "nodes": [{"id": "n1", "method": "<method>", "slots": {...}}]${propose ? ', "new_methods": [], "new_goal_types": []' : ''}}`,
  ...(propose ? [NEW_METHODS] : []),
  `LIBRARY\n${renderLibrary(lib)}`,
  `PROBLEM\n${item.question}`,
  `NUMBERS OF THE PROBLEM (registry)\n${numbers}`,
  ...(solution ? [`WORKED SOLUTION (for the intended decomposition only; never copy its results into consts)\n${item.solution ?? item.answer}`] : [])].join('\n\n');
}

/** The candidate library extension of a dev answer: its proposed methods and goal types, checked; {methods: Map, goalTypes: Map, problems}. */
function extraOf(tree, lib) {
  const goalTypes = new Map(), methods = new Map(), problems = [];
  for (const t of Array.isArray(tree?.new_goal_types) ? tree.new_goal_types : []) if (t?.id && !lib.goalTypes.has(t.id)) goalTypes.set(t.id, {id: t.id, text: t.text ?? '', answer: t.answer ?? '', operation: t.operation ?? ''});
  for (const m of Array.isArray(tree?.new_methods) ? tree.new_methods : []) {
    const p = checkMethod(m, lib, {newGoalTypes: [...goalTypes.values()]});
    if (p.length) { problems.push(`${m?.id}: ${p.join('; ')}`); continue; }
    methods.set(m.id, {id: m.id, achieves: [].concat(m.achieves), solver: m.solver, text: m.text ?? '', seq: null, added: 'proposed', formula: m.formula ?? null, clues: m.clues ?? {}, fixed: m.fixed ?? {},
      slots: (m.slots ?? []).map(s => ({name: s.name, kind: s.kind, text: s.text ?? '', many: Boolean(s.many), optional: Boolean(s.optional), choices: (s.choices ?? []).map(c => ({value: String(c.value), op: String(c.op ?? c.value)})), subgoal: s.subgoal ?? null}))});
  }
  return {methods, goalTypes, problems};
}

const repairNote = (r, extra) => {
  const lines = [];
  for (const g of r.goals) if (['FILL_ERROR', 'ENGINE_ERROR', 'MISSING_METHOD', 'UNSUPPORTED_PRIMITIVE'].includes(g.state) && !g.declared) lines.push(`${g.id}: ${g.state}: ${g.reason}`);
  for (const p of extra?.problems ?? []) lines.push(`proposed method rejected: ${p}`);
  return lines;
};

/** One problem: ask, run the tree, one repair round on machine errors, score. */
export async function solveOne(item, lib, {run, solution, propose = solution, tier = 'good', prompt = null, score = true}) {
  const registry = extractNumbers(item.question, {max: 40});
  const messages = [{role: 'system', content: SYSTEM}, {role: 'user', content: prompt ?? question(item, lib, {solution, propose})}];
  const attempts = [];
  let tree = null, result = null, extra = null;
  for (let round = 0; round < 2; round++) {
    let a = await chat(tier, messages, {run});
    // A thinking loop that spends the whole budget leaves no answer: the same question once more with low reasoning effort (an answer
    // is never truncated; the request is a different one, recorded as such).
    if (a.ok && a.finish === 'length' && !readTree(a.text)) { attempts.push({round, ok: a.ok, cached: a.cached, usd: a.usd, finish: a.finish, error: 'thinking budget spent', answer: a.text}); a = await chat(tier, messages, {run, effort: 'low'}); }
    attempts.push({round, ok: a.ok, cached: a.cached, usd: a.usd, finish: a.finish, error: a.error, answer: a.text});
    if (!a.ok) break;
    const t = readTree(a.text);
    // A repair answer that is not readable keeps the first tree (the repair round may only improve).
    if (!t && tree) break;
    tree = t;
    extra = propose ? extraOf(tree, lib) : null;
    result = tree ? await runTree(tree, {lib, registry, extra}) : {goals: [], nodes: {}, consts: [], usedMethods: [], attempted: [], flags: []};
    const notes = tree ? repairNote(result, extra) : ['the answer is not one JSON object'];
    // Unknown methods in held-out are final (the library is frozen); a declared status is final; fill and engine errors get one repair.
    const fixable = notes.filter(l => !/MISSING_METHOD: no method/.test(l) || propose);
    if (!fixable.length || round === 1) break;
    messages.push({role: 'assistant', content: a.text}, {role: 'user', content: `The machine could not execute part of your tree:\n${fixable.join('\n')}\nCorrect the tree (same JSON format). Use only library methods${propose ? ' or your proposed ones' : ''}; if a goal cannot be formalized, give it a status.`});
  }
  const gold = goldOf(item);
  const answers = result ? executedAnswers(result) : [];
  let verdict = answers.length ? deterministicVerdict(gold, answers) : null, judged = null;
  if (answers.length && !verdict && score) {
    const j = await chat('medium', [{role: 'system', content: JUDGE_SYSTEM}, {role: 'user', content: judgeQuestion(item, answers)}], {run, maxTokens: 8000, effort: 'low'});
    const v = j.ok ? readTree(j.text) : null;
    verdict = ['match', 'partial', 'mismatch'].includes(v?.verdict) ? v.verdict : 'mismatch';
    judged = {verdict, reason: v?.reason ?? j.error ?? 'unreadable judge answer'};
  }
  const c = result ? classify(result, {verdict}) : {outcome: 'PARTIALLY_FORMALIZED', blocked_by: 'no_tree'};
  return {id: item.id, book: item.book, family: item.tags?.[0] ?? item.section, outcome: c.outcome, blocked_by: c.blocked_by, verdict, judged,
    goals: result?.goals.map(g => ({id: g.id, type: g.type, state: g.state, reason: g.reason ?? null, kind: g.result?.kind ?? null, value: g.result?.value ?? null, method: g.result?.method ?? null})) ?? [],
    used_methods: result?.usedMethods ?? [], attempted_methods: result?.attempted ?? [], nodes: result ? Object.keys(result.nodes).length : 0, consts: result?.consts ?? [], flags: result?.flags ?? [],
    proposed: extra ? [...extra.methods.values()].map(m => m.id) : [], proposals: tree?.new_methods ?? [], new_goal_types: tree?.new_goal_types ?? [], proposal_problems: extra?.problems ?? [],
    node_report: result?.nodes ?? {}, rounds: attempts.length, usd: attempts.reduce((s, a) => s + (a.usd || 0), 0), tree, attempts: attempts.map(a => ({round: a.round, ok: a.ok, cached: a.cached, finish: a.finish, error: a.error ?? null, answer: a.answer}))};
}

export async function pool(list, n, fn) {
  const out = new Array(list.length); let next = 0;
  await Promise.all(Array.from({length: Math.min(n, list.length)}, async () => { while (next < list.length) { const k = next++; out[k] = await fn(list[k], k); } }));
  return out;
}

export async function register(run, usd) {
  try { await fetch(`${PROXY}/jobs/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({job: JOB, run, purpose: `job:${JOB}`, budget: {usd}})}); } catch { /* the proxy logs untagged use */ }
}

async function cmdRun() {
  const sp = JSON.parse(fs.readFileSync(path.join(STATE, 'split.json'), 'utf8'));
  const set = args.set === 'held' ? sp.held : sp.dev;
  const ids = set.slice(Number(args.from ?? 0), Number(args.to ?? set.length)).map(x => x.id);
  const items = new Map(readJsonl(ITEMS).map(i => [i.id, i]));
  const runId = String(args['run-id']);
  const dir = path.join(STATE, runId);
  fs.mkdirSync(dir, {recursive: true});
  const lib = loadLibrary(args.layer ? path.resolve(args.layer) : LAYER);
  await register(`ml-${runId}`, Number(args.budget ?? 10));
  const solution = Boolean(args.solution), propose = solution && !args['no-propose'];
  const t0 = Date.now();
  const rows = await pool(ids, Number(args.concurrency ?? 6), async (id, k) => {
    const r = await solveOne(items.get(id), lib, {run: `ml-${runId}`, solution, propose});
    process.stderr.write(`${k + 1}/${ids.length} ${id} ${r.outcome}${r.blocked_by ? `/${r.blocked_by}` : ''} ${r.used_methods.join(',')}\n`);
    return r;
  });
  fs.writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const counts = {}; for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const meta = {run: runId, set: args.set ?? 'dev', from: Number(args.from ?? 0), to: Number(args.to ?? set.length), solution, propose, library: {methods: lib.methods.size, goalTypes: lib.goalTypes.size, primitives: lib.primitives.size}, counts, cost, seconds: Math.round((Date.now() - t0) / 1000)};
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
  (await engines()).dispose();
}

function cmdProposals() {
  const rows = readJsonl(path.join(STATE, String(args['run-id']), 'results.jsonl'));
  const by = new Map();
  for (const r of rows) for (const m of r.proposals ?? []) {
    const k = m.id; if (!by.has(k)) by.set(k, {spec: m, problems: []});
    by.get(k).problems.push({id: r.id, outcome: r.outcome, used: r.used_methods.includes(k)});
  }
  for (const [k, v] of by) console.log(JSON.stringify({id: k, n: v.problems.length, solved: v.problems.filter(p => p.outcome === 'SOLVED' && p.used).length, problems: v.problems.map(p => `${p.id}:${p.outcome}${p.used ? '' : '(unused)'}`), spec: v.spec}));
  const gts = rows.flatMap(r => (r.new_goal_types ?? []).map(t => ({...t, from: r.id})));
  for (const t of gts) console.log(JSON.stringify({goal_type: t}));
}

/** Writes reviewed method specs (and goal types) into the grown layer file, numbered after the current library. */
function cmdAdopt() {
  const specs = JSON.parse(fs.readFileSync(path.resolve(String(args.file)), 'utf8'));
  const lib = loadLibrary();
  const file = path.join(LAYER, '0040-methods-grown.sop');
  let seq = Math.max(0, ...[...lib.methods.values()].map(m => m.seq ?? 0));
  const out = [`\n# ===== stage ${args.stage}: methods adopted after review (generalized, duplicates merged)`];
  for (const t of specs.goal_types ?? []) { if (lib.goalTypes.has(t.id)) throw new Error(`goal type ${t.id} exists`); out.push(goalTypeSop(t)); lib.goalTypes.set(t.id, t); }
  for (const m of specs.methods ?? []) {
    const p = checkMethod(m, lib);
    if (p.length) throw new Error(`${m.id}: ${p.join('; ')}`);
    out.push(methodSop(m, {seq: ++seq, stage: String(args.stage)}));
    lib.methods.set(m.id, m);
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# Methods and goal types added while growing the library on the development set, in order (fp_method_seq), with the stage\n# that added them (fp_method_added). Each was proposed by the frame-filler from a dev problem and its worked solution, then reviewed:\n# generalized (no domain words), merged with duplicates, kept only when reusable.\n');
  fs.appendFileSync(file, out.join('\n\n') + '\n');
  const after = loadLibrary();
  console.log(`library: ${after.methods.size} methods, ${after.goalTypes.size} goal types, ${after.primitives.size} primitives`);
}

// ---------------------------------------------------------------- audit: did the frame-filler invent reasoning?

const AUDIT_SYSTEM = 'You audit a translation of a problem into frames for a symbolic machine. Reply with one JSON object only.';
const auditQuestion = (item, tree) => [`Problem:\n${item.question}`,
  `Frames written by the frame-filler (methods with their slots; vK are the numbers of the problem in order, nK the outputs of other frames):\n${JSON.stringify(tree.nodes ?? [], null, 1).slice(0, 12000)}`,
  'The frame-filler was allowed to copy names and numbers from the problem, choose methods, write the facts and rules the problem states (also its definitions and stated general rules) as atoms, read a stated fact into a predicate (\"the box is greasy\" as greasy \"box\"), and add fixed definitions (60 minutes in an hour, 2 for \"twice\"). It was NOT allowed to add a fact, rule, table entry or constant that the problem does not state or define (outside knowledge, a guess, an assumption), nor to write the conclusion the question asks for, or an intermediate result that should have been derived, directly into a frame.',
  'Reply {"verdict": "faithful" | "background" | "answer_encoded", "items": ["<each offending element, quoted short>"]}: background = some element brings knowledge or an assumption the problem does not state (but not the asked conclusion); answer_encoded = some element states the asked conclusion or a derived result; faithful = neither.'].join('\n\n');
const needsAudit = r => r.outcome === 'SOLVED' && (r.consts.length || /"(facts|rules|table|clues|conditions|tasks|after)"/.test(JSON.stringify(r.tree?.nodes ?? [])));

async function cmdAudit() {
  const runId = String(args['run-id']), dir = path.join(STATE, runId);
  const rows = readJsonl(path.join(dir, 'results.jsonl'));
  const items = new Map(readJsonl(ITEMS).map(i => [i.id, i]));
  await register(`ml-audit-${runId}`, 3);
  const out = await pool(rows.filter(needsAudit), 8, async r => {
    const a = await chat('medium', [{role: 'system', content: AUDIT_SYSTEM}, {role: 'user', content: auditQuestion(items.get(r.id), r.tree)}], {run: `ml-audit-${runId}`, maxTokens: 8000, effort: 'low'});
    const v = a.ok ? readTree(a.text) : null;
    return {id: r.id, verdict: ['faithful', 'background', 'answer_encoded'].includes(v?.verdict) ? v.verdict : 'unreadable', items: v?.items ?? []};
  });
  fs.writeFileSync(path.join(dir, 'audit.jsonl'), out.map(x => JSON.stringify(x)).join('\n') + '\n');
  const c = {}; for (const x of out) c[x.verdict] = (c[x.verdict] ?? 0) + 1;
  console.log(JSON.stringify({run: runId, solved: rows.filter(r => r.outcome === 'SOLVED').length, audited: out.length, verdicts: c, cost}, null, 2));
}

// ---------------------------------------------------------------- report

const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : 0;
function tally(rows) { const c = {}; for (const r of rows) c[r.outcome] = (c[r.outcome] ?? 0) + 1; return c; }
function causes(rows) { const c = {}; for (const r of rows.filter(x => x.outcome !== 'SOLVED')) { const k = causeOf(r); c[k] = (c[k] ?? 0) + 1; } return c; }
/** A paired bootstrap-free Wilson interval for a share (single proportion). */
function wilson(k, n, z = 1.96) { if (!n) return [0, 0]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.round(1000 * (c - h) / d) / 10, Math.round(1000 * (c + h) / d) / 10]; }

function cmdReport() {
  const lib = loadLibrary();
  const dev = readJsonl(path.join(STATE, String(args.dev), 'results.jsonl'));
  const held = args.held ? readJsonl(path.join(STATE, String(args.held), 'results.jsonl')) : [];
  const heldSol = args['held-sol'] ? readJsonl(path.join(STATE, String(args['held-sol']), 'results.jsonl')) : [];
  const methods = [...lib.methods.values()].sort((a, b) => a.seq - b.seq);
  // Coverage curve on dev: methods in order of entry (seed methods by their first use in dev order, then the stages in adoption order).
  const firstUse = new Map();
  dev.forEach((r, i) => r.used_methods.forEach(m => { if (!firstUse.has(m)) firstUse.set(m, i); }));
  const seed = methods.filter(m => m.added === 'seed').sort((a, b) => (firstUse.get(a.id) ?? 1e9) - (firstUse.get(b.id) ?? 1e9) || a.seq - b.seq);
  const order = [...seed, ...methods.filter(m => m.added !== 'seed')].map(m => m.id);
  const solved = dev.filter(r => r.outcome === 'SOLVED');
  const curve = order.map((m, k) => { const have = new Set(order.slice(0, k + 1)); return {k: k + 1, method: m, stage: lib.methods.get(m).added, covered: solved.filter(r => r.used_methods.every(u => have.has(u))).length}; });
  const lastTen = curve.length > 10 ? curve.at(-1).covered - curve.at(-11).covered : null;
  const use = new Map(order.map(m => [m, 0]));
  for (const r of [...dev, ...held].filter(x => x.outcome === 'SOLVED')) for (const m of r.used_methods) use.set(m, (use.get(m) ?? 0) + 1);
  const uses = [...use.values()].sort((a, b) => a - b);
  const median = uses.length ? (uses.length % 2 ? uses[(uses.length - 1) / 2] : (uses[uses.length / 2 - 1] + uses[uses.length / 2]) / 2) : 0;
  const hs = held.filter(r => r.outcome === 'SOLVED').length, hw = held.filter(r => r.outcome === 'WRONG').length;
  const hc = causes(held), hfail = held.length - hs;
  const out = {library: {methods: lib.methods.size, goalTypes: lib.goalTypes.size, primitives: lib.primitives.size, byStage: Object.fromEntries([...new Set(methods.map(m => m.added))].map(s => [s, methods.filter(m => m.added === s).length]))},
    dev: {n: dev.length, outcomes: tally(dev), causes: causes(dev)}, curve, last_ten_gain: lastTen, last_ten_gain_pct: lastTen === null ? null : pct(lastTen, dev.length),
    reuse: Object.fromEntries([...use].sort((a, b) => b[1] - a[1])), median_use: median,
    held: {n: held.length, outcomes: tally(held), causes: hc, solved_pct: pct(hs, held.length), solved_ci: wilson(hs, held.length), wrong_pct: pct(hw, held.length), missing_method_share_of_failures: pct(hc.MISSING_METHOD ?? 0, hfail),
      by_book: Object.fromEntries([...new Set(held.map(r => r.book))].map(b => [b, tally(held.filter(r => r.book === b))]))},
    held_with_solution: heldSol.length ? {n: heldSol.length, outcomes: tally(heldSol), causes: causes(heldSol), solved_pct: pct(heldSol.filter(r => r.outcome === 'SOLVED').length, heldSol.length)} : null,
    nodes: {dev_median: med(dev.filter(r => r.outcome === 'SOLVED').map(r => r.nodes)), held_median: med(held.filter(r => r.outcome === 'SOLVED').map(r => r.nodes))},
    consts: {dev: dev.reduce((s, r) => s + r.consts.length, 0), held: held.reduce((s, r) => s + r.consts.length, 0)}, flags: [...dev, ...held].flatMap(r => r.flags.map(f => `${r.id}:${f.flag}`))};
  const file = path.join(STATE, `report-${args.dev}-${args.held ?? 'none'}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

const cmd = import.meta.url === `file://${path.resolve(process.argv[1] ?? '')}` ? process.argv[2] : null;
if (cmd === 'split') {
  const sp = split();
  fs.mkdirSync(STATE, {recursive: true});
  fs.writeFileSync(path.join(STATE, 'split.json'), JSON.stringify(sp, null, 2));
  const per = xs => Object.fromEntries([...new Set(xs.map(x => x.book))].map(b => [b, xs.filter(x => x.book === b).length]));
  console.log(JSON.stringify({dev: sp.dev.length, held: sp.held.length, devPerBook: per(sp.dev), heldPerBook: per(sp.held), hash: sha(JSON.stringify(sp)).slice(0, 16)}, null, 2));
} else if (cmd === 'run') await cmdRun();
else if (cmd === 'proposals') cmdProposals();
else if (cmd === 'adopt') cmdAdopt();
else if (cmd === 'report') cmdReport();
else if (cmd === 'audit') await cmdAudit();
else if (cmd) { console.error(`unknown command ${cmd}`); process.exit(2); }
