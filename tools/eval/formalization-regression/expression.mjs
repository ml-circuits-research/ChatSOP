#!/usr/bin/env node
/**
 * Dual formalization on the owner's books (owner, 2026-10-02): the expression path (lib/formalize/expression-program.mjs) next to the
 * step-by-step question tree, cross-checked by lib/formalize/dual-check.mjs, measured small first, and recorded for the offline
 * regression (no model in replay; every step has its own expectation and a failure names the first diverging step).
 *
 *   node tools/eval/formalization-regression/expression.mjs sample --n 30 [--exclude FILE] [--seed S] --out FILE
 *   node tools/eval/formalization-regression/expression.mjs run --ids FILE --run-id ID [--tree TREE_RUN] [--tier tiny] [--replay fill|replay|record]
 *   node tools/eval/formalization-regression/expression.mjs nway --ids FILE --run-id ID --tree TREE_RUN      (variant B, N-way selection)
 *   node tools/eval/formalization-regression/expression.mjs f1 --ids FILE --run-id ID --tree TREE_RUN --index-runs a,b   (B plus F1 exemplars)
 *   node tools/eval/formalization-regression/expression.mjs index --runs a,b      (the default F1 exemplar index, local)
 *   node tools/eval/formalization-regression/expression.mjs nway --plan b2 ...     (tiny+F1, tree, medium)
 *   node tools/eval/formalization-regression/expression.mjs obligations --ids FILE --run-id ID   (variant C)
 *   node tools/eval/formalization-regression/expression.mjs verify --ids FILE --run-id ID        (cross-family verifier; cost from the proxy log)
 *   node tools/eval/formalization-regression/expression.mjs replay [--tier tiny] [--json]   (dual and N-way recordings, no model)
 *
 * `run` asks the tier the one closed question (proxy purpose `formalize`, the proxy's response cache on by default, and the
 * record/replay cache of the regression), analyses and lowers the program, executes it through the product's engines (an Agent turn
 * whose formalizer returns the circuit), takes the tree's circuit of the same problem from a formalization-regression run
 * (`--tree`, results of tools/eval/formalization-regression/run.mjs --book-ids), cross-checks both, and scores both strictly against
 * the gold numbers (an asked value must equal a gold number; the stated numbers in an answer's text do not count). It writes
 * state/dual-formalization/<run-id>/{results.jsonl, summary.md} and appends the per-step recordings to the gitignored
 * datasets_sources/formalization-regression/expression/<tier>.jsonl (book-derived text, DS011). Failed or disagreeing cases are reported
 * to the formalization error inbox, from which the regression set's build step admits them.
 * Sections sampled (chain, check, batch, choose shapes; numeric or yes/no gold) are listed in STRATA; sealed suites are never read.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT, loadItems} from './cases.mjs';
import {expressionFormalize, registryOf, readProgram} from '../../../lib/formalize/expression-program.mjs';
import {crossCheck, executeQueries, selectByAgreement} from '../../../lib/formalize/dual-check.mjs';
import {exemplarOf, retrieve, EXEMPLAR_INDEX} from '../../../lib/formalize/exemplars.mjs';
import {goalsQuestion, readGoals, obligationsOf, packetFields} from '../../../lib/formalize/obligations.mjs';
import {verifyCrossFamily} from '../../../lib/formalize/verifier.mjs';
import {signatureOf, coverage} from '../../datasets/three-datasets/forms.mjs';
import {replayChat, modelIdentity} from '../../../lib/formalize/replay-cache.mjs';
import {FORMALIZE_HEADERS} from '../../../lib/formalize/strategies.mjs';
import {localChat} from '../../../lib/local-llm/client.mjs';
import {reportFormalizationError} from '../../../lib/formalization-errors.mjs';

export const STATE = path.join(ROOT, 'state/dual-formalization');
export const RECORDINGS = path.join(ROOT, 'datasets_sources/formalization-regression/expression');
const REPLAY_DIR = process.env.FR_REPLAY_DIR ? path.resolve(process.env.FR_REPLAY_DIR) : path.join(ROOT, 'datasets_sources/formalization-regression/replay');
const PROXY = process.env.LLMAPIPROVIDER_URL ?? 'http://127.0.0.1:18080/v1';
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const sha = t => createHash('sha256').update(String(t)).digest('hex').slice(0, 12);

/** The sampled sections (book, first tag, weight per 30): chain, check, batch and choose shapes with numeric or yes/no gold. */
export const STRATA = Object.freeze([
  ['commonsense', 'Units and rates', 2], ['commonsense', 'Successive percentage changes', 2], ['commonsense', 'Chained yields', 2],
  ['commonsense', 'Bottlenecks', 2], ['commonsense', 'Expected value and risk', 2], ['commonsense', 'Integer capacity threshold', 2],
  ['commonsense', 'Break-even threshold', 2], ['commonsense', 'Budget and constraints', 2],
  ['decompose', 'Two-Step Minimal Split', 4], ['decompose', 'Normalization and Capacity', 4],
  ['world', 'N4', 3], ['world', 'N5', 3]]);

/** The gold of an item for strict scoring: {kind: 'number', values} or {kind: 'yes_no', value}, or null (not scorable here). */
export function goldOf(item) {
  if (item.answer_kind === 'yes_no' && typeof item.answer_value === 'boolean') return {kind: 'yes_no', value: item.answer_value};
  const v = [].concat(item.answer_value ?? []);
  // A gold stated as a percentage also accepts its fraction (44.1% and 0.441): eval-side reading of the gold, never product code.
  if (['number', 'number_text'].includes(item.answer_kind) && v.length && v.every(x => typeof x === 'number')) return {kind: 'number', values: v, ...(/%|percent/i.test(item.answer ?? '') ? {percent: true} : {})};
  // The decomposition book states a yes/no verdict at the start of its answer text (eval-side gold, never product code).
  const m = /^The correct answer is (yes|no)\b/i.exec(item.answer ?? '');
  if (item.book === 'decompose' && m) return {kind: 'yes_no', value: m[1].toLowerCase() === 'yes'};
  return null;
}

/** The sub-problem count the decomposition book states in its solution (eval-side metadata for the latent-decomposition statistic). */
export const statedSubproblems = item => { const m = /Best decomposition \((\d+) subproblems?\)/i.exec(item.solution ?? ''); return m ? Number(m[1]) : null; };

const inStratum = (item, [book, tag]) => item.book === book && item.tags?.[0] === tag;

/** A stratified random sample of `n` scorable items (weights scaled from 30), excluding `exclude` ids. */
export function sample({n = 30, seed = 'dual-1', exclude = new Set(), items = loadItems()} = {}) {
  const rank = id => createHash('sha256').update(`${seed}\0${id}`).digest('hex');
  const out = [];
  for (const s of STRATA) {
    const want = Math.max(1, Math.round(s[2] * n / 30));
    const pool = [...items.values()].filter(i => inStratum(i, s) && goldOf(i) && !exclude.has(i.id)).sort((a, b) => rank(a.id).localeCompare(rank(b.id)));
    out.push(...pool.slice(0, want).map(i => i.id));
  }
  return out;
}

let world = null;
/** The product's engines over a small memory: `execute(sop)` → {status, values} (one Agent turn per circuit; problem circuits bring their own vocabulary). */
export async function executor() {
  if (world) return world;
  const [{Repository}, {Agent}, {seedLexicon}] = await Promise.all([import('../../../memory/repository.mjs'), import('../../../server/agent.mjs'), import('../../../lib/knowledge-seeds.mjs')]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-'));
  const repo = new Repository(root, {memory: JSON.parse(fs.readFileSync(path.join(ROOT, 'config/runtime.json'), 'utf8')).memory});
  repo.init('base');
  const lexicon = seedLexicon('core-min');
  let n = 0;
  // `numbers`: the perturbed numbers a cross-check states, listed after the message so the validator's mention check admits them.
  const execute = async (sop, message = 'problem', numbers = []) => {
    const session = repo.session('base', 'dual', `c${++n}`);
    try {
      const r = await new Agent({repo, session, lexicon, config: {}}).turn(numbers.length ? `${message}\n(${numbers.join(', ')})` : message, {language: 'en', formalizer: {formalize: async () => sop}});
      const p = r.packet ?? {};
      return {status: p.status ?? null, values: (p.answers ?? []).map(a => Object.values(a.binding ?? a)[0]).filter(v => v !== undefined), route: p.route?.chosen ?? null, used: (p.used ?? []).length};
    } catch (error) { return {status: 'error', values: [], error: error.message}; }
    finally { try { repo.discard(session); } catch { /* gone */ } }
  };
  world = {lexicon, execute, dispose: () => fs.rmSync(root, {recursive: true, force: true})};
  return world;
}

/** Strict score of asked values against the gold: correct, wrong or unanswered. */
export function score(gold, values) {
  const vs = values.filter(v => v !== null && v !== undefined);
  if (!vs.length) return 'unanswered';
  if (gold.kind === 'yes_no') return vs.some(v => typeof v === 'boolean') ? (vs.find(v => typeof v === 'boolean') === gold.value ? 'correct' : 'wrong') : 'wrong';
  const nums = vs.map(Number).filter(Number.isFinite);
  const near = (h, g) => Math.abs(h - g) <= Math.max(1e-9, 0.005 * Math.abs(g));
  return gold.values.every(g => nums.some(h => near(h, g) || gold.percent && near(h * 100, g))) ? 'correct' : 'wrong';
}

/** The tree's circuit and answers of one problem from a formalization-regression run's results. */
const treeOf = (run, id) => (run ? readJsonl(path.join(ROOT, 'state/formalization-regression', run, 'results.jsonl')) : []).filter(r => r.id === `books/${id}`).at(-1) ?? null;

/** A proxy client for `tier` with the regression's record/replay cache. */
export function tierChat(tier, mode = 'fill', {run = null, effort = null} = {}) {
  // The Qwen tiers answer without thinking; another family (medium and above) may think, within its token budget (`effort`: the
  // OpenRouter reasoning effort, low|medium|high; null leaves the provider's default).
  const extraBody = ['tiny', 'small'].includes(tier) ? {chat_template_kwargs: {enable_thinking: false}} : effort ? {reasoning: {effort}} : {};
  // A thinking tier gets 15 minutes: its thinking is never cut by the client (a reply cut by max_tokens is reported as budget_exhausted).
  const live = (messages, maxTokens) => localChat({endpoint: PROXY, model: tier, messages, maxTokens, timeoutMs: ['tiny', 'small'].includes(tier) ? 300_000 : 900_000, extraBody, headers: {...FORMALIZE_HEADERS, 'x-llmapiprovider-no-fallback': '1', ...(run ? {'x-llmapiprovider-run': run} : {})}});
  const chat = replayChat(live, {dir: REPLAY_DIR, mode, model: modelIdentity(tier), sampling: {temperature: 0, extraBody}});
  // Thinking is never cut silently: a reply that spent its whole budget thinking is asked again with four times the budget (once,
  // at most 32,000 tokens); a second cut stays a reported budget_exhausted failure.
  return async (messages, maxTokens) => {
    const r = await chat(messages, maxTokens);
    if (r.ok || !/^budget_exhausted/.test(r.reason ?? '') || maxTokens >= 32_000) return r;
    const again = await chat(messages, Math.min(32_000, maxTokens * 4));
    return {...again, escalated_budget: Math.min(32_000, maxTokens * 4), first_usage: r.usage};
  };
}

/** A chat client that counts its calls: live (asked a model) or replayed, with tokens and seconds. */
export function counted(chat) {
  const cost = {live: 0, replayed: 0, tokens: 0, ms: 0};
  const wrapped = async (messages, maxTokens) => {
    const r = await chat(messages, maxTokens);
    if (r.replayed) cost.replayed++; else { cost.live++; cost.tokens += (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0); cost.ms += r.ms ?? 0; }
    return r;
  };
  return {chat: wrapped, cost};
}

/** The accepted lines of an expression result (normalized by the reader), for the exemplar index. */
const programText = result => result?.status === 'ok' ? result.analysis.program.lines.map(l => `${l.name} = ${l.text}`).join('\n') : null;

/**
 * The leave-one-out of an evaluation (coordinator decision 2026-10-02, strict): never the problem itself, never an exemplar of the same
 * book section (first tag), never a content-word duplicate.
 */
export function sectionExclude(item) {
  const sig = signatureOf({message: item.question}).words;
  return r => r.id === item.id || (r.meta?.book === item.book && r.meta?.stratum === item.tags?.[0]) || coverage(sig, r.meta?.words ?? []) >= 0.8 || coverage(r.meta?.words ?? [], sig) >= 0.8;
}

/**
 * The candidate plans of the N-way formalization. `b`: tiny (prompt a, no exemplars), tiny (prompt b), the tree, cascade small (the
 * first run); `b2`: tiny (prompt a with F1 exemplars), the tree, medium (another model family, thinking allowed), no cascade.
 */
export const PLANS = Object.freeze({
  b: {candidates: [{name: 'tiny-a', tier: 'tiny', variant: 'a', f1: false}, {name: 'tiny-b', tier: 'tiny', variant: 'b', f1: false}, 'tree'], cascade: {name: 'small-a', tier: 'small', variant: 'a', f1: false}},
  b2: {candidates: [{name: 'tiny-a-f1', tier: 'tiny', variant: 'a', f1: true}, 'tree', {name: 'medium-a', tier: 'medium', variant: 'a', f1: false, maxTokens: 8000}], cascade: null},
});

/**
 * N-way formalization of one problem by a plan of PLANS and the selection by agreement. With `index` (plan b only), also the F1 arm:
 * tiny (prompt a) with two exemplars (leave-one-out by `sectionExclude`). `fixedExemplars` (replay) gives each candidate the exemplars
 * it was recorded with.
 */
export async function runNway(item, {tree = null, index = null, chats, plan = 'b', exemplarIndex = null, fixedExemplars = null}) {
  const w = await executor();
  const gold = goldOf(item), registry = registryOf(item.question);
  const execute = (sop, numbers = []) => w.execute(sop, item.question, numbers);
  const t0 = Date.now(), used = {};
  const exprCand = async spec => {
    const exemplars = fixedExemplars?.[spec.name] ?? (spec.f1 ? retrieve(exemplarIndex ?? [], registry, {k: 2, exclude: sectionExclude(item)}) : []);
    used[spec.name] = exemplars;
    return {name: spec.name, kind: 'expr', tier: spec.tier, result: await expressionFormalize({message: item.question, chat: chats[spec.tier].chat, lexicon: w.lexicon, registry, variant: spec.variant, exemplars, ...(spec.maxTokens ? {maxTokens: spec.maxTokens} : {})})};
  };
  const p = PLANS[plan], cands = [];
  for (const c of p.candidates) cands.push(c === 'tree' ? {name: 'tree', kind: 'tree', sop: tree?.sop ?? null} : await exprCand(c));
  let extra = null;
  const sel = await selectByAgreement(cands, {registry, execute, seed: item.id, cascade: p.cascade ? async () => (extra = await exprCand(p.cascade)) : null});
  const all = [...cands, ...(extra ? [extra] : [])];
  const outcome = c => { const pr = sel.profiles[all.indexOf(c)]; const v = pr ? pr[0].filter(q => q.values.length).map(q => q.values[0]) : []; return gold ? score(gold, v) : null; };
  const row = {id: item.id, book: item.book, stratum: item.tags?.[0], gold, plan,
    candidates: Object.fromEntries(all.map(c => [c.name, {status: c.kind === 'expr' ? c.result.status : c.sop ? 'ok' : 'none', outcome: outcome(c), program: c.kind === 'expr' ? programText(c.result) : null, ...(used[c.name]?.length ? {exemplars: used[c.name].map(x => x.id)} : {})}])),
    selection: {status: sel.status, chosen: sel.chosen, answers: sel.answers, clusters: sel.clusters, cascaded: sel.cascaded, outcome: sel.status === 'selected' && gold ? score(gold, sel.answers) : 'unresolved'},
    tree_ms: tree?.ms ?? null, seconds: Math.round((Date.now() - t0) / 100) / 10};
  if (index && plan === 'b') {
    const spec = {name: 'tiny-a-ex', tier: 'tiny', variant: 'a', f1: true};
    const f1 = await exprCand(spec), ex = used[spec.name];
    const v = f1.result.status === 'ok' ? (await executeQueries(f1.result.lowered.sop, execute)).map(q => q.values[0] ?? null) : [];
    row.f1 = {status: f1.result.status, outcome: gold ? score(gold, v) : null, exemplars: ex.map(x => x.id), shape_match: ex.filter(x => x.meta.stratum === row.stratum).length, violations: (f1.result.analysis?.violations ?? []).map(x => x.code), program: programText(f1.result)};
    all.push(f1);
  }
  // The recording: every question answered, by tier and question hash, and the exemplars each candidate saw, so the selection replays
  // with no model and no index.
  const answers = {};
  for (const c of all) if (c.kind === 'expr') for (const a of c.result.attempts) answers[`${c.tier}:${sha(a.question)}`] = a.answer;
  return {row, record: {id: item.id, kind: 'nway', plan, answers, tree_sop: tree?.sop ?? null, exemplars: used, expect: {selection: row.selection.status, chosen: row.selection.chosen, answers: row.selection.answers}}};
}

/**
 * Variant C on one problem: the asked parts (one closed question), the expression path (F1 by default, strict leave-one-out), the
 * engines' values, the obligation record; on a failed obligation one targeted re-ask to the same tier, then the record again. The answer
 * is given only when no blocking obligation fails; otherwise the problem is unresolved with its obligations listed.
 */
export async function runObligations(item, {chat, tier = 'tiny', exemplars = null}) {
  const w = await executor();
  const gold = goldOf(item), execute = (sop, numbers = []) => w.execute(sop, item.question, numbers);
  const gq = goalsQuestion(item.question);
  const gr = await chat([{role: 'system', content: 'Reply with the lines only.'}, {role: 'user', content: gq}], 200);
  const goals = gr.ok ? readGoals(gr.text) : null;
  const valuesOf = async e => (e.status === 'ok' ? (await executeQueries(e.lowered.sop, execute)).map(q => q.values[0] ?? null) : []);
  const opts = {message: item.question, chat, lexicon: w.lexicon, ...(exemplars ? {exemplars} : {exemplarExclude: sectionExclude(item)})};
  const first = await expressionFormalize(opts);
  const v1 = await valuesOf(first), r1 = obligationsOf({expr: first, values: v1, goals});
  let final = first, v = v1, r = r1, reasked = false;
  if (r1.blocking && r1.question && first.status === 'ok') {
    reasked = true;
    final = await expressionFormalize({...opts, exemplars: first.exemplars, hint: r1.question});
    v = await valuesOf(final); r = obligationsOf({expr: final, values: v, goals});
  }
  const answered = !r.blocking;
  const record = {id: item.id, kind: 'obligations', tier, goals_answer: gr.ok ? gr.text : null, exemplars: first.exemplars ?? [],
    answers: Object.fromEntries([...first.attempts, ...(reasked ? final.attempts : [])].map(a => [sha(a.question), a.answer])),
    expect: {answered, values: answered ? v : [], unresolved: r.unresolved}};
  return {row: {id: item.id, book: item.book, stratum: item.tags?.[0], gold, goals: goals?.map(g => `${g.kind}|${g.sign}`) ?? null,
    first: {status: first.status, values: v1, outcome: gold ? score(gold, v1) : null, formalized: r1.formalized, unresolved: r1.unresolved},
    reasked, question: r1.question,
    final: {status: final.status, values: v, outcome: gold ? score(gold, v) : null, formalized: r.formalized, unresolved: r.unresolved},
    answered, outcome: answered ? (gold ? score(gold, v) : null) : 'abstained', packet: packetFields(r)}, record};
}

/** Replays a variant C recording with no model: the parts and program answers from the recording; the answer and obligations compared. */
export async function replayObligations(rec, {item}) {
  const missing = [];
  const chat = async messages => {
    const q = String(messages.at(-1).content);
    if (q === goalsQuestion(item.question)) return rec.goals_answer === null ? {ok: false} : {ok: true, text: rec.goals_answer, replayed: true};
    const a = rec.answers[sha(q)];
    if (a === undefined) { missing.push(q.slice(-120)); return {ok: false, reason: 'replay_miss'}; }
    return a === null ? {ok: false} : {ok: true, text: a, replayed: true};
  };
  const {row} = await runObligations(item, {chat, tier: rec.tier, exemplars: rec.exemplars ?? []});
  if (missing.length) return {id: rec.id, ok: false, first: {step: 'expr_program', kind: 'protocol', why: `a question with no recorded answer: ${missing[0]}`}};
  const e = rec.expect, ok = row.answered === e.answered && JSON.stringify(row.answered ? row.final.values : []) === JSON.stringify(e.values) && JSON.stringify(row.final.unresolved) === JSON.stringify(e.unresolved);
  return {id: rec.id, ok, ...(ok ? {} : {first: {step: 'obligations', kind: 'obligations', why: `answered ${row.answered} ${JSON.stringify(row.final.values)} [${row.final.unresolved}] vs recorded ${e.answered} ${JSON.stringify(e.values)} [${e.unresolved}]`}})};
}

/**
 * The cross-family verifier on one problem: the parts list (tiny), tiny+F1 and medium programs, verification by agreement on the
 * numbers and perturbations plus obligations, the failing candidate re-asked on its next tier (tiny → small, medium → good).
 * `chats`: {tiny, small, medium, good} chat clients; `fixed` (replay): the exemplars recorded.
 */
export async function runVerify(item, {chats, exemplars = null, third = null}) {
  const w = await executor();
  const gold = goldOf(item), registry = registryOf(item.question), execute = (sop, numbers = []) => w.execute(sop, item.question, numbers);
  const t0 = Date.now();
  const gr = await chats.tiny([{role: 'system', content: 'Reply with the lines only.'}, {role: 'user', content: goalsQuestion(item.question)}], 200);
  const goals = gr.ok ? readGoals(gr.text) : null;
  const ex = exemplars ?? retrieve(loadExemplarIndexSafe(), registry, {k: 2, exclude: sectionExclude(item)});
  const prog = (tier, exs, maxTokens = 700) => hint => expressionFormalize({message: item.question, chat: chats[tier], lexicon: w.lexicon, registry, exemplars: exs, hint, maxTokens});
  const v = await verifyCrossFamily({registry, execute, goals, seed: item.id, third, candidates: [
    {name: 'tiny-f1', family: 'qwen', run: prog('tiny', ex), next: {name: 'small-f1', run: prog('small', ex)}},
    {name: 'medium', family: 'deepseek', run: prog('medium', [], 8000), next: {name: 'good', run: prog('good', [], 8000)}}]});
  const row = {id: item.id, book: item.book, stratum: item.tags?.[0], gold, status: v.status, stage: v.stage, parts: v.parts, agreed: v.agreed, answers: v.answers,
    outcome: v.status === 'verified' ? (gold ? score(gold, v.answers) : null) : 'unresolved', formalized: v.formalized, open: v.open, reasked: v.reasked,
    candidates: Object.fromEntries(Object.entries(v.candidates).map(([n, c]) => [n, {...c, outcome: gold && c.answers ? score(gold, c.answers) : 'unanswered'}])),
    ...(v.with_third ? {with_third: {...v.with_third, outcome: v.with_third.status === 'verified' ? (gold ? score(gold, v.with_third.answer) : null) : 'unresolved', third_outcome: gold ? score(gold, v.with_third.answers ?? []) : null}} : {}),
    packet: {formalized: v.formalized, unresolved_obligations: v.open, verification: v.status}, seconds: Math.round((Date.now() - t0) / 100) / 10};
  return {row, record: {id: item.id, kind: 'verify', goals_answer: gr.ok ? gr.text : null, exemplars: ex, expect: {status: v.status, answers: v.answers, open: v.open}}};
}
const loadExemplarIndexSafe = () => { try { return JSON.parse('[' + fs.readFileSync(EXEMPLAR_INDEX, 'utf8').trim().split('\n').join(',') + ']'); } catch { return []; } };

/** Replays a verifier recording with no model: every tier's answers by question hash; the verdict, answers and open obligations compared. */
export async function replayVerify(rec, {item}) {
  const missing = [];
  const chatOf = tier => async messages => { const q = String(messages.at(-1).content), a = rec.answers[`${tier}:${sha(q)}`]; if (a === undefined) { missing.push(`${tier}: ${q.slice(-80)}`); return {ok: false, reason: 'replay_miss'}; } return a === null ? {ok: false, reason: 'recorded failure'} : {ok: true, text: a, replayed: true}; };
  const {row} = await runVerify(item, {chats: Object.fromEntries(['tiny', 'small', 'medium', 'good'].map(t => [t, chatOf(t)])), exemplars: rec.exemplars ?? []});
  if (missing.length) return {id: rec.id, ok: false, first: {step: 'expr_program', kind: 'protocol', why: `a question with no recorded answer: ${missing[0]}`}};
  const e = rec.expect, ok = row.status === e.status && JSON.stringify(row.answers) === JSON.stringify(e.answers) && JSON.stringify(row.open) === JSON.stringify(e.open);
  return {id: rec.id, ok, ...(ok ? {} : {first: {step: 'verification', kind: 'verification', why: `${row.status} ${JSON.stringify(row.answers)} [${row.open}] vs recorded ${e.status} ${JSON.stringify(e.answers)} [${e.open}]`}})};
}

/** The verifier numbers: coverage, precision, wrong, recovery by the re-ask, cost per verified answer from the proxy log. */
export function summarizeVerify(rows, {usd = null, credits = null} = {}) {
  const n = rows.length, c = f => rows.filter(f).length, ver = rows.filter(r => r.status === 'verified');
  const reasked = rows.filter(r => r.reasked.length), correctV = c(r => r.outcome === 'correct');
  const single = name => c(r => r.candidates[name]?.outcome === 'correct');
  return {n, verified: pct(ver.length, n), verified_precision: pct(correctV, ver.length), verified_wrong: c(r => r.status === 'verified' && r.outcome !== 'correct'), unresolved: c(r => r.status === 'unresolved'),
    verified_first: c(r => r.status === 'verified' && r.stage === 'first'), verified_after_reask: c(r => r.status === 'verified' && r.stage === 'reask'),
    reasked: reasked.length, clarification_recovers: pct(c(r => r.reasked.length && r.outcome === 'correct'), reasked.length), clarification_resolves: pct(c(r => r.reasked.length && r.status === 'verified'), reasked.length),
    parts_source: rows.reduce((m, r) => (m[r.parts] = (m[r.parts] ?? 0) + 1, m), {}),
    single_correct: {tiny_f1: single('tiny-f1'), medium: single('medium')}, either_first_correct: c(r => ['tiny-f1', 'medium', 'small-f1', 'good'].some(k => r.candidates[k]?.outcome === 'correct')),
    unresolved_open: rows.filter(r => r.status === 'unresolved').reduce((m, r) => { const k = r.open.find(x => !x.startsWith('explain:'))?.split(':')[0] ?? (r.agreed ? 'none' : 'disagree'); m[k] = (m[k] ?? 0) + 1; return m; }, {}),
    by_book: rows.reduce((m, r) => { m[r.book] ??= {n: 0, verified: 0, correct: 0}; m[r.book].n++; if (r.status === 'verified') m[r.book].verified++; if (r.outcome === 'correct') m[r.book].correct++; return m; }, {}),
    seconds_per_problem: Math.round(10 * rows.reduce((p, r) => p + r.seconds, 0) / n) / 10,
    ...(usd !== null ? {usd_total: Math.round(usd * 10000) / 10000, usd_per_verified_correct: correctV ? Math.round(usd / correctV * 10000) / 10000 : null, plan_credits: credits, plan_credits_per_verified_correct: correctV ? Math.round(credits / correctV * 1000) / 1000 : null} : {})};
}

/** USD (OpenRouter) and plan credits (openference, 0.1 per call) of a run's proxy calls, from the proxy's request log by run tag. */
export function runCost(run, dir = path.join(os.homedir(), '.local/share/llmapiprovider')) {
  let usd = 0, credits = 0;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^requests-.*\.jsonl$/.test(n)) : []) for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!l.includes(run)) continue;
    try { const r = JSON.parse(l); if (r.run !== run || r.upstream === 'cache') continue; usd += r.usd ?? 0; if (r.upstream === 'openference' && r.status === 200) credits += 0.1; } catch { /* torn line */ }
  }
  return {usd, credits: Math.round(credits * 10) / 10};
}

/** The variant C numbers. */
export function summarizeObligations(rows) {
  const n = rows.length, c = f => rows.filter(f).length;
  const abst = rows.filter(r => !r.answered), failed1 = rows.filter(r => r.first.unresolved.some(u => !u.startsWith('explain:')));
  const firstNotCorrect = r => r.first.outcome !== 'correct';
  return {n, answered_correct: c(r => r.outcome === 'correct'), answered_wrong: c(r => r.outcome === 'wrong'), answered_unanswered: c(r => r.outcome === 'unanswered'), abstained: abst.length,
    first_pass: {correct: c(r => r.first.outcome === 'correct'), wrong: c(r => r.first.outcome === 'wrong')},
    abstention_precision: pct(abst.filter(firstNotCorrect).length, abst.length),
    abstention_precision_with_numbers: pct(abst.filter(r => r.first.status !== 'no_numbers' && firstNotCorrect(r)).length, abst.filter(r => r.first.status !== 'no_numbers').length),
    abstained_no_numbers: c(r => !r.answered && r.first.status === 'no_numbers'),
    reasked: c(r => r.reasked), clarification_recovers: pct(c(r => r.reasked && r.answered && r.outcome === 'correct'), c(r => r.reasked)),
    clarification_resolves: pct(c(r => r.reasked && r.answered), c(r => r.reasked)), first_pass_unresolved: failed1.length,
    recovered_of_unresolved: pct(failed1.filter(r => r.answered && r.outcome === 'correct').length, failed1.length),
    first_failed_obligation: rows.reduce((m, r) => { const u = r.first.unresolved.find(x => !x.startsWith('explain:')); if (u) { const k = u.split(':')[0]; m[k] = (m[k] ?? 0) + 1; } return m; }, {}),
    mean_formalized: Math.round(rows.reduce((p, r) => p + r.final.formalized, 0) / n),
    by_book: rows.reduce((m, r) => { m[r.book] ??= {n: 0, correct: 0, wrong: 0, abstained: 0}; m[r.book].n++; m[r.book][r.outcome === 'correct' ? 'correct' : r.outcome === 'abstained' ? 'abstained' : 'wrong']++; return m; }, {})};
}

/** Replays an N-way recording with no model: every question is answered from the recording by its hash; the selection is compared. */
export async function replayNway(rec, {item}) {
  const missing = [];
  const chatOf = tier => async messages => { const q = String(messages.at(-1).content), a = rec.answers[`${tier}:${sha(q)}`]; if (a === undefined) { missing.push(q.slice(0, 80)); return {ok: false, reason: 'replay_miss'}; } return a === null ? {ok: false, reason: 'recorded failure'} : {ok: true, text: a, replayed: true}; };
  const chats = {tiny: counted(chatOf('tiny')), small: counted(chatOf('small')), medium: counted(chatOf('medium'))};
  // Recordings made before the exemplars were recorded saw none (plan b without its F1 arm).
  const fixed = rec.exemplars && !Array.isArray(rec.exemplars) ? rec.exemplars : {};
  const {row} = await runNway(item, {tree: rec.tree_sop ? {sop: rec.tree_sop} : null, chats, plan: rec.plan ?? 'b', fixedExemplars: new Proxy(fixed, {get: (t, k) => t[k] ?? []})});
  if (missing.length) return {id: rec.id, ok: false, first: {step: 'expr_program', kind: 'protocol', why: `a question with no recorded answer: ${missing[0]}`}};
  const e = rec.expect, s = row.selection;
  const ok = s.status === e.selection && s.chosen === e.chosen && JSON.stringify(s.answers) === JSON.stringify(e.answers);
  return {id: rec.id, ok, ...(ok ? {} : {first: {step: 'selection', kind: 'selection', why: `${s.status}/${s.chosen} ${JSON.stringify(s.answers)} vs recorded ${e.selection}/${e.chosen} ${JSON.stringify(e.answers)}`}})};
}

/** The exemplar index from verified rows (agreed with an independent candidate and matched the gold) of earlier runs. */
export function buildIndex(runs, items = loadItems()) {
  const out = [], seen = new Set();
  const add = (id, text) => {
    const item = items.get(id); if (!item || !text || seen.has(`${id}\0${text}`)) return;
    const read = readProgram(text); if (!read) return;
    seen.add(`${id}\0${text}`);
    out.push(exemplarOf({id, registry: registryOf(item.question), program: read.lines.map(l => `${l.name} = ${l.text}`).join('\n'), meta: {book: item.book, stratum: item.tags?.[0], words: signatureOf({message: item.question}).words}}));
  };
  const recs = readJsonl(path.join(RECORDINGS, 'tiny.jsonl'));
  for (const run of runs) for (const r of readJsonl(path.join(STATE, run, 'results.jsonl'))) {
    if (r.verdict === 'agree' && r.expression?.outcome === 'correct') { const rec = recs.filter(x => x.id === r.id && x.run === run).at(-1); add(r.id, rec?.steps?.at(-1)?.answer); }
    if (r.selection?.status === 'selected' && r.selection.outcome === 'correct') {
      const cluster = r.selection.clusters[0] ?? [];
      for (const name of cluster) if (r.candidates[name]?.program && r.candidates[name].outcome === 'correct') add(r.id, r.candidates[name].program);
    }
  }
  return out;
}

/** One problem through both paths: the per-step record of the expression path, the cross-check and the strict scores. */
export async function runCase(item, {chat, tree = null, tier = 'tiny'}) {
  const w = await executor();
  const gold = goldOf(item);
  const execute = (sop, numbers = []) => w.execute(sop, item.question, numbers);
  const expr = await expressionFormalize({message: item.question, chat, lexicon: w.lexicon, exemplarExclude: sectionExclude(item)});
  const exprRun = expr.status === 'ok' ? await executeQueries(expr.lowered.sop, execute) : [];
  const exprValues = exprRun.map(q => q.values[0] ?? null);
  const treeSop = tree?.sop ?? null;
  const treeRun = treeSop ? await executeQueries(treeSop, execute) : [];
  const check = await crossCheck({expr, treeSop, execute, registry: expr.registry, seed: item.id});
  const g = expr.analysis?.program?.graph;
  return {id: item.id, book: item.book, stratum: item.tags?.[0], gold, tier,
    expression: {status: expr.status, attempts: expr.attempts.length, violations: (expr.analysis?.violations ?? []).map(v => v.code), warnings: (expr.analysis?.warnings ?? []).map(v => v.code),
      lines: expr.analysis?.program?.lines?.length ?? 0, intermediates: g?.intermediates ?? null, depth: g?.depth ?? null, roots: g?.roots ?? null, values: exprValues, outcome: gold ? score(gold, exprValues) : null},
    tree: {present: Boolean(treeSop), values: treeRun.map(q => q.values.slice(0, 4)), outcome: gold && treeSop ? score(gold, treeRun.flatMap(q => q.values.slice(0, 1))) : gold ? 'unanswered' : null, runner_outcome: tree?.outcome ?? null},
    verdict: check.verdict, lowering: check.lowering?.ok ?? null, divergent: check.divergent, perturbed: check.perturbed.map(p => p.agree),
    subproblems: statedSubproblems(item),
    record: {id: item.id, tier, exemplars: expr.exemplars ?? [], steps: expr.attempts.map(a => ({name: 'expr_program', qsha: sha(a.question), answer: a.answer})), tree_sop: treeSop,
      expect: {status: expr.status, violations: (expr.analysis?.violations ?? []).map(v => v.code), answers: expr.analysis?.program?.answers ?? [], values: exprValues, verdict: check.verdict}}};
}

/** Replays one recording with no model: the scripted answers in order; each step against its expectation; the first divergence named. */
export async function replayRecording(rec, {message, tree = rec.tree_sop}) {
  const w = await executor();
  const execute = (sop, numbers = []) => w.execute(sop, message, numbers);
  const queue = [...rec.steps], trace = [];
  const chat = async messages => {
    const q = String(messages.at(-1).content), s = queue.shift();
    if (!s) { trace.push({step: 'expr_program', kind: 'protocol', ok: false, why: 'the path asks once more, with no recorded answer'}); return {ok: false, reason: 'replay_miss'}; }
    const stale = s.qsha && s.qsha !== sha(q);
    if (stale) { trace.push({step: 'expr_program', kind: 'protocol', ok: false, why: 'the question text changed (new prompt or registry)'}); return {ok: false, reason: 'replay_miss'}; }
    trace.push({step: 'expr_program', kind: 'answer', ok: s.answer !== null});
    return s.answer === null ? {ok: false, reason: 'recorded failure'} : {ok: true, text: s.answer};
  };
  const expr = await expressionFormalize({message, chat, lexicon: w.lexicon, exemplars: rec.exemplars ?? []});
  const first = trace.find(t => !t.ok && t.kind === 'protocol');
  if (first) return {id: rec.id, ok: false, first: {step: first.step, kind: 'protocol', why: first.why}, trace};
  const e = rec.expect, got = (expr.analysis?.violations ?? []).map(v => v.code);
  const steps = [['analysis', expr.status === e.status && JSON.stringify(got) === JSON.stringify(e.violations), `status ${expr.status} [${got}] vs recorded ${e.status} [${e.violations}]`],
    ['answers', JSON.stringify(expr.analysis?.program?.answers ?? []) === JSON.stringify(e.answers), `answers ${expr.analysis?.program?.answers} vs ${e.answers}`]];
  let values = [];
  if (expr.status === 'ok') values = (await executeQueries(expr.lowered.sop, execute)).map(q => q.values[0] ?? null);
  steps.push(['execute', JSON.stringify(values) === JSON.stringify(e.values), `values ${JSON.stringify(values)} vs ${JSON.stringify(e.values)}`]);
  const check = await crossCheck({expr, treeSop: tree, execute, registry: expr.registry ?? registryOf(message), seed: rec.id});
  steps.push(['cross_check', check.verdict === e.verdict, `verdict ${check.verdict} vs ${e.verdict}`]);
  for (const [step, ok, why] of steps) trace.push({step, kind: step, ok, ...(ok ? {} : {why})});
  const bad = trace.find(t => !t.ok);
  return {id: rec.id, ok: !bad, ...(bad ? {first: {step: bad.step, kind: bad.kind, why: bad.why}} : {}), trace};
}

/** A paired bootstrap interval of mean(a − b) over problems (a, b: arrays of 0/1). */
export function pairedBootstrap(a, b, {n = 5000, seed = 7} = {}) {
  let x = seed >>> 0; const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  const d = a.map((v, i) => v - b[i]), m = d.length, means = [];
  for (let k = 0; k < n; k++) { let s = 0; for (let i = 0; i < m; i++) s += d[Math.floor(rnd() * m)]; means.push(s / m); }
  means.sort((p, q) => p - q);
  return {mean: Math.round(1000 * d.reduce((p, q) => p + q, 0) / m) / 1000, lo: Math.round(1000 * means[Math.floor(0.025 * n)]) / 1000, hi: Math.round(1000 * means[Math.floor(0.975 * n)]) / 1000};
}

/** The variant B (and F1) numbers of an N-way run. */
export function summarizeNway(rows, {chats = null, index = null} = {}) {
  const scored = rows.filter(r => r.gold), n = scored.length;
  const c = (f) => scored.filter(f).length;
  const names = [...new Set(scored.flatMap(r => Object.keys(r.candidates)))];
  const single = Object.fromEntries(names.map(nm => [nm, c(r => r.candidates[nm]?.outcome === 'correct')]));
  const base = names.filter(nm => nm !== 'small-a').sort((a, b) => single[b] - single[a])[0];
  const sel = scored.map(r => (r.selection.outcome === 'correct' ? 1 : 0)), best = scored.map(r => (r.candidates[base]?.outcome === 'correct' ? 1 : 0));
  const selected = scored.filter(r => r.selection.status === 'selected');
  const out = {n, selected_correct: pct(c(r => r.selection.outcome === 'correct'), n), selected_wrong: pct(c(r => r.selection.status === 'selected' && r.selection.outcome !== 'correct'), n),
    unresolved: pct(c(r => r.selection.status === 'unresolved'), n), precision_of_selected: pct(c(r => r.selection.outcome === 'correct'), selected.length),
    cascaded: pct(c(r => r.selection.cascaded), n), single_correct: Object.fromEntries(Object.entries(single).map(([k, v]) => [k, pct(v, n)])), best_single: base,
    selected_minus_best_single: pairedBootstrap(sel, best),
    unresolved_residue_wrong_best_single: pct(scored.filter(r => r.selection.status === 'unresolved' && r.candidates[base]?.outcome !== 'correct').length, c(r => r.selection.status === 'unresolved')),
    chosen: scored.reduce((m, r) => (m[r.selection.chosen ?? 'none'] = (m[r.selection.chosen ?? 'none'] ?? 0) + 1, m), {}),
    by_stratum: scored.reduce((m, r) => { const k = r.stratum; m[k] ??= [0, 0]; m[k][1]++; if (r.selection.outcome === 'correct') m[k][0]++; return m; }, {}),
    seconds_per_problem: Math.round(10 * rows.reduce((p, r) => p + r.seconds + (r.tree_ms ?? 0) / 1000, 0) / rows.length) / 10,
    ...(chats ? {calls: Object.fromEntries(Object.entries(chats).map(([k, v]) => [k, v.cost]))} : {})};
  if (index) {
    const f1 = scored.map(r => (r.f1?.outcome === 'correct' ? 1 : 0)), a = scored.map(r => (r.candidates['tiny-a']?.outcome === 'correct' ? 1 : 0));
    out.f1 = {index: index.length, correct_with_exemplars: pct(f1.reduce((p, q) => p + q, 0), n), correct_without: pct(a.reduce((p, q) => p + q, 0), n), paired_gain: pairedBootstrap(f1, a),
      rejected_with: c(r => r.f1?.status === 'rejected'), rejected_without: c(r => r.candidates['tiny-a']?.status === 'rejected'),
      shape_match: pct(scored.reduce((p, r) => p + (r.f1?.shape_match ?? 0), 0), scored.reduce((p, r) => p + (r.f1?.exemplars?.length ?? 0), 0)),
      fixed: c(r => r.f1?.outcome === 'correct' && r.candidates['tiny-a']?.outcome !== 'correct'), lost: c(r => r.f1?.outcome !== 'correct' && r.candidates['tiny-a']?.outcome === 'correct')};
  }
  return out;
}

const pct = (a, b) => b ? `${a}/${b} (${Math.round(100 * a / b)}%)` : `${a}/0`;
/** The report numbers of a run's results. */
export function summarize(rows) {
  const scored = rows.filter(r => r.gold);
  const exprC = scored.filter(r => r.expression.outcome === 'correct').length, treeC = scored.filter(r => r.tree.outcome === 'correct').length;
  const agree = scored.filter(r => r.verdict === 'agree'), disagree = scored.filter(r => r.verdict === 'disagree');
  const agreeC = agree.filter(r => r.tree.outcome === 'correct').length;
  const flagged = disagree.filter(r => r.tree.outcome !== 'correct').length;
  const treeWrongAnswered = scored.filter(r => r.tree.outcome === 'wrong');
  const verdicts = {}; for (const r of rows) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
  const status = {}; for (const r of rows) status[r.expression.status] = (status[r.expression.status] ?? 0) + 1;
  const viol = {}; for (const r of rows) for (const v of r.expression.violations) viol[v] = (viol[v] ?? 0) + 1;
  const sub = rows.filter(r => r.subproblems && r.expression.status === 'ok');
  const latent = {}; for (const r of rows.filter(x => x.expression.status === 'ok')) { const k = r.stratum; (latent[k] ??= []).push(r.expression.intermediates + 1); }
  const mean = xs => xs.length ? Math.round(10 * xs.reduce((a, b) => a + b, 0) / xs.length) / 10 : null;
  return {n: rows.length, scored: scored.length, expression_correct: pct(exprC, scored.length), tree_correct: pct(treeC, scored.length),
    either_correct: pct(scored.filter(r => r.expression.outcome === 'correct' || r.tree.outcome === 'correct').length, scored.length),
    verdicts, agreement_coverage: pct(agree.length, scored.length), precision_when_agree: pct(agreeC, agree.length),
    disagreement_flags_wrong_tree: pct(flagged, disagree.length), wrong_tree_answers_flagged: pct(treeWrongAnswered.filter(r => r.verdict === 'disagree').length, treeWrongAnswered.length),
    lowering_mismatch: rows.filter(r => r.lowering === false).length, expression_status: status, violations: viol,
    latent: {steps_per_problem_by_stratum: Object.fromEntries(Object.entries(latent).map(([k, v]) => [k, mean(v)])),
      decompose_stated_vs_program: sub.map(r => `${r.subproblems}:${r.expression.intermediates + 1}`),
      decompose_mean_stated: mean(sub.map(r => r.subproblems)), decompose_mean_program_steps: mean(sub.map(r => r.expression.intermediates + 1))}};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  if (cmd === 'sample') {
    const exclude = new Set(opt('--exclude') ? fs.readFileSync(opt('--exclude'), 'utf8').split(/\s+/).filter(Boolean) : []);
    const ids = sample({n: Number(opt('--n', 30)), seed: opt('--seed', 'dual-1'), exclude});
    fs.mkdirSync(path.dirname(path.resolve(opt('--out'))), {recursive: true});
    fs.writeFileSync(opt('--out'), ids.join('\n') + '\n');
    console.log(`${ids.length} ids → ${opt('--out')}`);
  } else if (cmd === 'run') {
    const tier = opt('--tier', 'tiny'), runId = opt('--run-id', `run-${Date.now()}`), treeRun = opt('--tree');
    const ids = fs.readFileSync(opt('--ids'), 'utf8').split(/\s+/).filter(Boolean), items = loadItems();
    const dir = path.join(STATE, runId); fs.mkdirSync(dir, {recursive: true});
    const chat = tierChat(tier, opt('--replay', 'fill'));
    const rows = [], recs = [];
    for (const id of ids) {
      const item = items.get(id); if (!item) continue;
      const r = await runCase(item, {chat, tree: treeOf(treeRun, id), tier});
      const {record, ...row} = r; rows.push(row); recs.push(record);
      console.error(`${id}: expr ${row.expression.status}/${row.expression.outcome} tree ${row.tree.outcome} → ${row.verdict}`);
      // The expression path's own failures go to the inbox (the tree's are reported by its runner): refused programs and wrong values.
      if (row.gold && (row.expression.status === 'rejected' || row.expression.outcome === 'wrong'))
        reportFormalizationError({source: 'dual-formalization', kind: row.expression.status === 'rejected' ? 'parse_failed' : 'wrong', message: item.question,
          strategy: 'ExpressionPath', tier, expected: item.answer, detail: [row.expression.status, row.verdict, ...row.expression.violations], ref: {book: item.book, id: item.id, run: runId}});
    }
    fs.writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.mkdirSync(RECORDINGS, {recursive: true});
    fs.appendFileSync(path.join(RECORDINGS, `${tier}.jsonl`), recs.map(r => JSON.stringify({...r, run: runId})).join('\n') + '\n');
    const s = summarize(rows);
    fs.writeFileSync(path.join(dir, 'summary.md'), [`# Dual formalization ${runId}`, '', `- tier ${tier}, tree run ${treeRun ?? 'none'}, ${s.n} problems (${s.scored} scorable)`,
      `- expression path correct ${s.expression_correct}; tree correct ${s.tree_correct}; either ${s.either_correct}`,
      `- verdicts ${JSON.stringify(s.verdicts)}; agreement coverage ${s.agreement_coverage}; precision when both agree ${s.precision_when_agree}`,
      `- disagreement flags a wrong tree answer ${s.disagreement_flags_wrong_tree}; wrong tree answers flagged ${s.wrong_tree_answers_flagged}; lowering mismatches ${s.lowering_mismatch}`,
      `- expression status ${JSON.stringify(s.expression_status)}; violations ${JSON.stringify(s.violations)}`,
      `- latent steps per problem by stratum ${JSON.stringify(s.latent.steps_per_problem_by_stratum)}`,
      `- decompose stated:program steps ${s.latent.decompose_stated_vs_program.join(' ')} (means ${s.latent.decompose_mean_stated} vs ${s.latent.decompose_mean_program_steps})`].join('\n') + '\n');
    console.log(JSON.stringify(s));
    world?.dispose();
  } else if (cmd === 'obligations') {
    const runId = opt('--run-id', `obl-${Date.now()}`), items = loadItems(), tier = opt('--tier', 'tiny');
    const ids = fs.readFileSync(opt('--ids'), 'utf8').split(/\s+/).filter(Boolean);
    const dir = path.join(STATE, runId); fs.mkdirSync(dir, {recursive: true});
    const chat = tierChat(tier, opt('--replay', 'fill')), rows = [], recs = [];
    for (const id of ids) {
      const item = items.get(id); if (!item) continue;
      const {row, record} = await runObligations(item, {chat, tier});
      rows.push(row); recs.push(record);
      if (row.outcome === 'wrong') reportFormalizationError({source: 'dual-formalization', kind: 'wrong', message: item.question, strategy: 'ExpressionPath+obligations', tier, expected: item.answer, detail: ['answered_wrong', ...row.final.unresolved], ref: {book: item.book, id: item.id, run: runId}});
      console.error(`${id}: first ${row.first.outcome} [${row.first.unresolved}]${row.reasked ? ` → re-ask → ${row.final.outcome} [${row.final.unresolved}]` : ''} → ${row.outcome}`);
    }
    fs.writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.mkdirSync(RECORDINGS, {recursive: true});
    fs.appendFileSync(path.join(RECORDINGS, 'obligations.jsonl'), recs.map(r => JSON.stringify({...r, run: runId})).join('\n') + '\n');
    const s = summarizeObligations(rows);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(s, null, 1) + '\n');
    console.log(JSON.stringify(s));
    world?.dispose();
  } else if (cmd === 'verify') {
    const runId = opt('--run-id', `verify-${Date.now()}`), items = loadItems();
    const ids = fs.readFileSync(opt('--ids'), 'utf8').split(/\s+/).filter(Boolean);
    const dir = path.join(STATE, runId); fs.mkdirSync(dir, {recursive: true});
    const chats = Object.fromEntries(['tiny', 'small', 'medium', 'good'].map(t => [t, tierChat(t, opt('--replay', 'fill'), {run: runId})]));
    // Rows and recordings are written as they come, and a run folder resumes (problems already in it are not run again).
    const rowsFile = path.join(dir, 'results.jsonl'), recFile = path.join(RECORDINGS, 'verify.jsonl');
    const rows = readJsonl(rowsFile), done = new Set(rows.map(r => r.id));
    fs.mkdirSync(RECORDINGS, {recursive: true});
    const answers = {};
    const recording = Object.fromEntries(Object.entries(chats).map(([t, ch]) => [t, async (m, k) => { const r = await ch(m, k); answers[`${t}:${sha(String(m.at(-1).content))}`] = r.ok ? r.text : null; return r; }]));
    for (const id of ids) {
      const item = items.get(id); if (!item || done.has(id)) continue;
      for (const k of Object.keys(answers)) delete answers[k];
      const {row, record} = await runVerify(item, {chats: recording});
      rows.push(row);
      fs.appendFileSync(rowsFile, JSON.stringify(row) + '\n');
      fs.appendFileSync(recFile, JSON.stringify({...record, answers: {...answers}, run: runId}) + '\n');
      if (row.outcome === 'wrong') reportFormalizationError({source: 'dual-formalization', kind: 'wrong', message: item.question, strategy: 'CrossFamilyVerifier', tier: 'tiny+medium', expected: item.answer, detail: ['verified_wrong', ...row.open], ref: {book: item.book, id: item.id, run: runId}});
      console.error(`${id}: ${row.status}/${row.outcome} stage ${row.stage} parts ${row.parts} ${Object.entries(row.candidates).map(([n, c]) => `${n}=${c.outcome}`).join(' ')}`);
    }
    const cost = runCost(runId);
    const s = summarizeVerify(rows, cost);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(s, null, 1) + '\n');
    console.log(JSON.stringify(s));
    world?.dispose();
  } else if (cmd === 'verify3') {
    // The verifier with the method tree as a structurally different third candidate (tools/eval/method-library/candidate.mjs): the two
    // families' answers are replayed from a verify run's recordings (no new calls for them); only the method tree is asked.
    const runId = opt('--run-id', `verify3-${Date.now()}`), from = opt('--from'), tier = opt('--method-tier', 'good'), items = loadItems();
    const {methodTreeCandidate} = await import('../method-library/candidate.mjs');
    const recs = new Map(readJsonl(path.join(RECORDINGS, 'verify.jsonl')).filter(r => r.run === from).map(r => [r.id, r]));
    const dir = path.join(STATE, runId); fs.mkdirSync(dir, {recursive: true});
    const rowsFile = path.join(dir, 'results.jsonl'), rows = readJsonl(rowsFile), done = new Set(rows.map(r => r.id));
    for (const [id, rec] of recs) {
      const item = items.get(id); if (!item || done.has(id)) continue;
      let third = null;
      try { third = await methodTreeCandidate(item, {tier, run: runId}); } catch (error) { third = {name: `method-${tier}`, sop: null, error: error.message}; }
      const chatOf = t => async messages => { const a = rec.answers[`${t}:${sha(String(messages.at(-1).content))}`]; return a == null ? {ok: false, reason: 'replay_miss'} : {ok: true, text: a, replayed: true}; };
      const {row} = await runVerify(item, {chats: Object.fromEntries(['tiny', 'small', 'medium', 'good'].map(t => [t, chatOf(t)])), exemplars: rec.exemplars ?? [], third: third?.sop ? third : null});
      row.third = {status: third?.status ?? null, has_sop: Boolean(third?.sop), composed: third?.composed ?? null, answers: third?.answers?.map?.(a => a?.value ?? a) ?? []};
      rows.push(row); fs.appendFileSync(rowsFile, JSON.stringify(row) + '\n');
      console.error(`${id}: two ${row.status}/${row.outcome} three ${row.with_third?.status ?? 'n/a'}/${row.with_third?.outcome ?? 'n/a'}`);
    }
    const c = f => rows.filter(f).length, n = rows.length;
    const ver2 = rows.filter(r => r.status === 'verified'), ver3 = rows.filter(r => (r.with_third?.status ?? r.status) === 'verified');
    const ok3 = r => (r.with_third ? r.with_third.outcome : r.outcome) === 'correct';
    const s = {n, method_sop: c(r => r.third?.has_sop), method_alone_correct: c(r => r.with_third?.third_outcome === 'correct'),
      two: {verified: pct(ver2.length, n), precision: pct(ver2.filter(r => r.outcome === 'correct').length, ver2.length)},
      three: {verified: pct(ver3.length, n), precision: pct(ver3.filter(ok3).length, ver3.length), added: ver3.length - ver2.length, added_correct: ver3.filter(r => r.status !== 'verified' && ok3(r)).length},
      usd_method: Math.round(runCost(runId).usd * 10000) / 10000};
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(s, null, 1) + '\n');
    console.log(JSON.stringify(s));
    world?.dispose();
  } else if (cmd === 'index') {
    // The product's default exemplar index (F1) from the verified rows of the named runs; local, book-derived (DS011).
    const index = buildIndex(opt('--runs', '').split(',').filter(Boolean));
    fs.mkdirSync(path.dirname(EXEMPLAR_INDEX), {recursive: true});
    fs.writeFileSync(EXEMPLAR_INDEX, index.map(r => JSON.stringify(r)).join('\n') + '\n');
    console.log(`${index.length} verified programs → ${path.relative(ROOT, EXEMPLAR_INDEX)}`);
  } else if (cmd === 'nway' || cmd === 'f1') {
    // nway: variant B on the ids; f1: the same plus the exemplar arm, the index built from `--index-runs a,b` (verified rows).
    const runId = opt('--run-id', `nway-${Date.now()}`), treeRun = opt('--tree'), items = loadItems();
    const ids = fs.readFileSync(opt('--ids'), 'utf8').split(/\s+/).filter(Boolean);
    const plan = opt('--plan', 'b');
    const index = cmd === 'f1' || plan === 'b2' ? buildIndex(opt('--index-runs', '').split(',').filter(Boolean), items) : null;
    if (index) console.error(`exemplar index: ${index.length} verified programs`);
    const dir = path.join(STATE, runId); fs.mkdirSync(dir, {recursive: true});
    const chats = Object.fromEntries(['tiny', 'small', 'medium'].map(t => [t, counted(tierChat(t, opt('--replay', 'fill'), {run: runId}))]));
    const rows = [], recs = [];
    for (const id of ids) {
      const item = items.get(id); if (!item) continue;
      const {row, record} = await runNway(item, {tree: treeOf(treeRun, id), index: cmd === 'f1' ? index : null, chats, plan, exemplarIndex: index});
      rows.push(row); recs.push(record);
      console.error(`${id}: ${Object.entries(row.candidates).map(([n, c]) => `${n}=${c.outcome}`).join(' ')} → ${row.selection.status}/${row.selection.outcome}${row.f1 ? ` f1=${row.f1.outcome}` : ''}`);
    }
    fs.writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.mkdirSync(RECORDINGS, {recursive: true});
    fs.appendFileSync(path.join(RECORDINGS, 'nway.jsonl'), recs.map(r => JSON.stringify({...r, run: runId})).join('\n') + '\n');
    const s = summarizeNway(rows, {chats, index: cmd === 'f1' ? index : null});
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(s, null, 1) + '\n');
    console.log(JSON.stringify(s));
    world?.dispose();
  } else if (cmd === 'replay') {
    const tier = opt('--tier', 'tiny'), items = loadItems();
    const recs = new Map(readJsonl(path.join(RECORDINGS, `${tier}.jsonl`)).map(r => [r.id, r]));
    const out = [];
    for (const rec of recs.values()) { const item = items.get(rec.id); if (item) out.push(await replayRecording(rec, {message: item.question})); }
    for (const rec of new Map(readJsonl(path.join(RECORDINGS, 'verify.jsonl')).map(r => [r.id, r])).values()) { const item = items.get(rec.id); if (item) out.push({...await replayVerify(rec, {item}), id: `verify:${rec.id}`}); }
    for (const rec of new Map(readJsonl(path.join(RECORDINGS, 'obligations.jsonl')).map(r => [r.id, r])).values()) { const item = items.get(rec.id); if (item) out.push({...await replayObligations(rec, {item}), id: `obligations:${rec.id}`}); }
    for (const rec of new Map(readJsonl(path.join(RECORDINGS, 'nway.jsonl')).map(r => [r.id, r])).values()) { const item = items.get(rec.id); if (item) out.push({...await replayNway(rec, {item}), id: `nway:${rec.id}`}); }
    const firsts = {}; for (const r of out) if (r.first) firsts[`${r.first.kind}@${r.first.step}`] = (firsts[`${r.first.kind}@${r.first.step}`] ?? 0) + 1;
    console.log(JSON.stringify({cases: out.length, ok: out.filter(r => r.ok).length, first_divergence: firsts}));
    if (!args.includes('--json')) for (const r of out.filter(x => !x.ok).slice(0, 5)) console.log(`${r.id}: ${r.first.kind}@${r.first.step}: ${r.first.why}`);
    world?.dispose();
    process.exit(out.every(r => r.ok) ? 0 : 1);
  } else { console.error('usage: expression.mjs sample|run|replay (see the header)'); process.exit(2); }
}
