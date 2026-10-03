#!/usr/bin/env node
/**
 * The offline per-step formalization regression (owner, 2026-10-02): no model and no API call. A case is a book problem with the
 * problem-mode answers a tier gave (recorded from a live or fill run); the answers are replayed by question name through the CURRENT
 * protocol data and code, and every step is checked on its own:
 *   reader   each recorded answer → the structural reading (null: unreadable)
 *   protocol the questions asked now, in order, against the recorded ones (a new question has no recorded answer: protocol change)
 *   assembly the problem circuit (problemCircuit), or the early exit
 *   validator the circuit through validateQuery
 *   execute  the circuit in a chat turn over a small memory (problem circuits bring their own vocabulary), the answer against gold
 * A failure names its first diverging step. With references (the same questions answered by `small`/`good`, recorded the same way),
 * the readings are compared by meaning (numbers as multisets, kinds by value) and a counterfactual swap (the reference's answers for the
 * first k steps) finds the step whose answer causes the failure; see `attribute`.
 *   node tools/eval/formalization-regression/offline.mjs import --run RUN [--tier tiny]   recordings from a regression run's dialogs
 *   node tools/eval/formalization-regression/offline.mjs run [--tier tiny] [--ids a,b] [--fast N] [--json]
 * Recordings and expectations derive from the books, so they live in the gitignored datasets_sources/formalization-regression/ (DS011).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT, STATE, loadCases, loadItems, resolveCase} from './cases.mjs';
import {problemCircuit} from '../../../lib/query-author/step-by-step/problem.mjs';
import {protocolData} from '../../../lib/formalize/protocol-data.mjs';
import {validateQuery} from '../../../lib/query-author/validate.mjs';
import {seedLexicon} from '../../../lib/knowledge-seeds.mjs';
import {Repository} from '../../../memory/repository.mjs';
import {Agent} from '../../../server/agent.mjs';
import {responseOf, deterministic, JUDGE_SYSTEM} from '../books/score.mjs';
import {modelIdentity} from '../../../lib/formalize/replay-cache.mjs';
const JUDGE_TIER = 'small';

export const RECORDINGS = path.join(ROOT, 'datasets_sources/formalization-regression/steps');
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const sha = t => createHash('sha256').update(String(t)).digest('hex').slice(0, 12);
const PROBLEM = /^(?:problem_|dc_)/;

/** Recordings of a tier: Map id → {id, tier, run, steps: [{name, qsha, answer}]} (the last import of an id wins). */
export const loadRecordings = (tier = 'tiny') => new Map(readJsonl(path.join(RECORDINGS, `${tier}.jsonl`)).map(r => [r.id, r]));

/** Imports the problem-mode answers of a regression run's dialogs as recordings of `tier`. */
export function importRun(run, tier = 'tiny') {
  const rows = readJsonl(path.join(STATE, run, 'results.jsonl'));
  const out = [];
  for (const r of rows) {
    const steps = (r.dialog ?? []).filter(d => PROBLEM.test(d.name)).map(d => ({name: d.name, qsha: d.qsha ?? null, answer: d.answer}));
    if (!steps.length) continue;
    out.push({id: r.id, tier, run, steps, live: {outcome: r.outcome, cluster: r.cluster ?? null}});
  }
  fs.mkdirSync(RECORDINGS, {recursive: true});
  fs.appendFileSync(path.join(RECORDINGS, `${tier}.jsonl`), out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
  return out.length;
}

/** A scripted oracle that answers each question by name from `steps` (in order per name) and records what happened at each step. */
function scriptedOracle(steps) {
  const queue = new Map();
  for (const s of steps) (queue.get(s.name) ?? queue.set(s.name, []).get(s.name)).push(s);
  const trace = [];
  const answer = (name, text) => {
    const s = queue.get(name)?.shift();
    if (!s) { trace.push({step: name, kind: 'protocol', ok: false, why: `the protocol asks ${name}, which has no recorded answer (a new question)`, qsha: sha(text)}); throw Object.assign(new Error(`no recorded answer for ${name}`), {code: 'replay_miss'}); }
    return s;
  };
  return {trace, queue, async read(name, text, reader, again) {
    const first = answer(name, text);
    const stale = first.qsha && first.qsha !== sha(text);
    const r1 = reader(first.answer);
    trace.push({step: name, kind: 'reader', ok: r1 !== null, stale, reading: summary(r1), answer: first.answer.slice(0, 200)});
    if (r1 !== null) return r1;
    const second = answer(`${name}_again`, again);
    const r2 = reader(second.answer);
    trace.push({step: `${name}_again`, kind: 'reader', ok: r2 !== null, reading: summary(r2), answer: second.answer.slice(0, 200)});
    if (r2 !== null) return r2;
    throw Object.assign(new Error(`the answer to ${name} could not be read`), {code: 'unreadable'});
  }};
}

/** A compact, comparable form of a reading. */
function summary(r) {
  if (r === null || r === undefined) return null;
  if (Array.isArray(r)) return r.map(x => x?.name ? (x.value !== undefined ? `${x.name}=${x.value}` : `${x.name}:${(x.uses ?? []).join('+')}`) : x?.option ? `${x.option}=${x.value}` : x?.thing ? `${x.thing}|${x.negated ? 'not ' : ''}${x.property}` : x?.then ? 'rule' : x);
  if (r?.thing) return `${r.thing}|${r.negated ? 'not ' : ''}${r.property}`;
  return r;
}

let world = null;
/** One small memory for every execution (problem circuits bring their own vocabulary); a fresh agent per case. */
function executor() {
  if (world) return world;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-offline-'));
  const repo = new Repository(root, {memory: JSON.parse(fs.readFileSync(path.join(ROOT, 'config/runtime.json'), 'utf8')).memory});
  repo.init('base');
  const lexicon = seedLexicon('core-min');
  world = {root, repo, lexicon, n: 0, dispose: () => fs.rmSync(root, {recursive: true, force: true})};
  return world;
}

const judgeCache = (() => { let m = null; return () => (m = new Map(readJsonl(path.join(STATE, 'judge-cache.jsonl')).map(r => [r.key, r]))); })();
const judgeKey = (id, gold, response) => createHash('sha256').update(`${modelIdentity(JUDGE_TIER)}\0${JUDGE_SYSTEM}\0${id}\0${gold}\0${response}`).digest('hex').slice(0, 24);

/** Replays one case through the current protocol and code; returns the per-step trace, the outcome and the first diverging step. */
export async function replayCase(c, steps, {data = protocolData()} = {}) {
  const w = executor();
  const oracle = scriptedOracle(steps);
  let problem = null, error = null;
  try { problem = await problemCircuit(oracle, {message: c.message, lexicon: w.lexicon, data}); } catch (e) { error = e; }
  const trace = oracle.trace;
  const fail = (step, kind, why, extra = {}) => ({id: c.id, outcome: extra.outcome ?? 'failed_step', first: {step, kind, why}, trace, ...extra});
  const missing = trace.find(t => t.kind === 'protocol');
  if (missing) return fail(missing.step, 'protocol', missing.why);
  if (!problem) {
    const unread = trace.find(t => t.kind === 'reader' && !t.ok && /_again$/.test(t.step));
    if (unread) return fail(unread.step.replace(/_again$/, ''), 'reader', `the answer could not be read twice: ${JSON.stringify(unread.answer)}`);
    const kind = trace.find(t => t.step === 'problem_kind')?.reading;
    return fail('problem_kind', 'protocol', `early exit (kind ${kind ?? 'unread'}${error ? `; ${error.message}` : ''})`);
  }
  const validation = validateQuery({sop: problem.sop, message: c.message, lexicon: w.lexicon, mode: 'id', mentions: []});
  if (!validation.ok) return fail('assembly', 'validator', validation.problems.map(p => `${p.code}: ${p.message}`).join('; ').slice(0, 300), {sop: problem.sop});
  const session = w.repo.session('base', 'offline', `c${++w.n}`);
  let r;
  try { r = await new Agent({repo: w.repo, session, lexicon: w.lexicon, config: {}}).turn(c.message, {language: 'en', formalizer: {formalize: async () => problem.sop}}); }
  catch (e) { return fail('execute', 'execute', e.message.slice(0, 300), {sop: problem.sop}); }
  finally { try { w.repo.discard(session); } catch { /* gone */ } }
  const p = r.packet ?? {};
  const rec = {arm: 'steps', ok: true, text: r.text, system: {status: p.status ?? null, answers: (p.answers ?? []).slice(0, 8).map(a => a.binding ?? a)}, gold_kind: c.gold_kind, gold_value: c.gold_value};
  const resp = responseOf(rec);
  let verdict = deterministic(rec, resp);
  // A circuit's answers are exactly the asked values: a numeric gold none of them equals is a wrong answer, no judge needed.
  const numbers = (rec.system.answers ?? []).flatMap(a => Object.values(a)).filter(v => typeof v === 'number');
  if (!verdict && c.gold_kind === 'number' && typeof c.gold_value === 'number' && numbers.length && !numbers.some(v => Math.abs(v - c.gold_value) <= Math.max(1e-9, 0.005 * Math.abs(c.gold_value))))
    verdict = {outcome: 'wrong', by: 'rule', reason: `answered ${numbers.slice(0, 4).join(', ')}, gold ${c.gold_value}`};
  if (!verdict) {
    const hit = judgeCache().get(judgeKey(c.id, c.gold, resp.text ?? null));
    verdict = hit ? {outcome: {correct: 'correct', partial: 'wrong', wrong: 'wrong', unanswered: 'unknown'}[hit.verdict], by: 'judge-cache'} : {outcome: 'undecided', by: 'none'};
  }
  const out = {id: c.id, outcome: verdict.outcome, by: verdict.by, ...(verdict.outcome === 'undecided' ? {response: resp.text ?? null} : {}), trace, sop: problem.sop, report: problem.report, answer: String(r.text ?? '').split('\n')[0].slice(0, 160)};
  if (verdict.outcome !== 'correct' && verdict.outcome !== 'undecided') out.first = {step: 'execute', kind: 'answer', why: `${verdict.outcome}: ${out.answer}`};
  return out;
}

/** Runs every recorded case of `tier` (or `ids`); `fast` keeps the first N. Returns {results, counts, ms}. */
export async function runOffline({tier = 'tiny', ids = null, fast = null, refTiers = ['good', 'small']} = {}) {
  const started = Date.now();
  const items = loadItems(), cases = new Map(loadCases().map(c => [c.id, c]));
  let recs = [...loadRecordings(tier).values()].filter(r => !ids || ids.includes(r.id));
  if (fast) recs = recs.slice(0, fast);
  const data = protocolData(), results = [];
  const refRecs = new Map(refTiers.map(t => [t, loadRecordings(t)]));
  for (const rec of recs) {
    // A book problem outside the regression set (an evaluation sample) is resolved from the books directly.
    const known = cases.get(rec.id) ?? (rec.id.startsWith('books/') ? {id: rec.id, source: 'books', provenance: {problem_id: rec.id.slice(6)}} : null);
    const c = known ? resolveCase(known, {items}) : null;
    if (!c) continue;
    const res = {...await replayCase(c, rec.steps, {data}), live: rec.live};
    if (res.outcome !== 'correct') {
      const refs = {};
      for (const t of refTiers) { const r = refRecs.get(t)?.get(rec.id); if (r) refs[t] = await replayCase(c, r.steps, {data}); }
      if (Object.keys(refs).length) res.attribution = attribute(res, refs);
    }
    results.push(res);
  }
  const counts = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const firsts = {};
  for (const r of results) if (r.first) { const k = `${r.first.kind}@${r.first.step}`; firsts[k] = (firsts[k] ?? 0) + 1; }
  const causes = {};
  for (const r of results) if (r.attribution) { const k = `${r.attribution.cause}@${r.attribution.step}`; causes[k] = (causes[k] ?? 0) + 1; }
  return {results, counts, firsts, causes, ms: Date.now() - started};
}

const numbersOf = reading => (Array.isArray(reading) ? reading : []).map(x => Number(String(x).split('=').pop())).filter(Number.isFinite).sort((a, b) => a - b);
const readingAt = (res, step) => res.trace.find(t => t.kind === 'reader' && t.step.replace(/_again$/, '') === step && t.ok)?.reading ?? null;

/**
 * Attribution of a failed case against references: the same protocol questions answered by bigger tiers (`refs`: {tier: result}).
 *   d       no reference reaches gold either: the reasoner, the knowledge or a construct (or a vague question when they disagree)
 *   b       the references disagree at the first differing step: the question is vague
 *   a       the reference is right; tiny's reading differs at the first step (the kind, the given numbers, an unreadable answer, the
 *           formulas): tiny's answer is wrong
 *   c       tiny's readings agree with the reference's at every step, yet the circuit answers differently: reader, assembly or protocol code
 * Readings are compared by meaning: the kind by value, the given values as multisets of numbers (names are free), the formulas,
 * options and asked values by the outcome they lead to.
 */
export function attribute(res, refs) {
  if (res.outcome === 'correct') return null;
  const good = Object.entries(refs).filter(([, r]) => r?.outcome === 'correct');
  const steps = ['problem_kind', 'problem_values', 'problem_facts'];
  const differs = (a, b, step) => step === 'problem_values' ? JSON.stringify(numbersOf(a)) !== JSON.stringify(numbersOf(b)) : JSON.stringify(a) !== JSON.stringify(b);
  if (!good.length) {
    const all = Object.values(refs).filter(Boolean);
    const split = all.length > 1 && steps.find(st => differs(readingAt(all[0], st), readingAt(all[1], st), st));
    return split ? {cause: 'b', step: split, why: `the references disagree at ${split}`} : {cause: 'd', step: 'execute', why: `no reference tier reaches gold (${Object.entries(refs).map(([t, r]) => `${t} ${r?.outcome ?? 'none'}`).join(', ')})`};
  }
  const [tier, ref] = good[0];
  for (const st of steps) {
    const mine = readingAt(res, st), theirs = readingAt(ref, st);
    if (theirs === null) continue;
    if (mine === null) return {cause: 'a', step: st, why: `tiny's answer could not be read; ${tier} answered ${JSON.stringify(theirs).slice(0, 100)}`};
    if (differs(mine, theirs, st)) {
      const others = good.slice(1).map(([, r]) => readingAt(r, st)).filter(x => x !== null);
      return {cause: others.some(o => differs(o, theirs, st)) ? 'b' : 'a', step: st, why: `tiny read ${JSON.stringify(mine).slice(0, 100)}, ${tier} ${JSON.stringify(theirs).slice(0, 100)}`};
    }
  }
  const unread = res.trace.find(t => t.kind === 'reader' && !t.ok && /_again$/.test(t.step));
  if (unread) return {cause: 'a', step: unread.step.replace(/_again$/, ''), why: `tiny's answer could not be read twice: ${JSON.stringify(unread.answer).slice(0, 100)}`};
  if (res.first?.kind === 'protocol') return {cause: 'c', step: res.first.step, why: `protocol: ${res.first.why}`};
  if (res.first?.kind === 'validator') return {cause: 'c', step: 'assembly', why: `the circuit from readable answers is refused: ${res.first.why.slice(0, 120)}`};
  // Same kind and the same given numbers; the difference is in the formulas, options or asked values tiny wrote.
  return {cause: 'a', step: res.trace.filter(t => t.kind === 'reader' && t.ok).map(t => t.step).find(st => /formulas|options|direction|asked|rules|question/.test(st)) ?? 'problem_formulas',
    why: `same kind and numbers as ${tier}; tiny's formulas or choices lead to ${res.outcome}`};
}

/** One failure as a short report: the first diverging step and the trace up to it. */
export function explain(r) {
  const lines = [`${r.id}: ${r.outcome}${r.first ? ` — first divergence at ${r.first.step} (${r.first.kind}): ${r.first.why}` : ''}`];
  for (const t of r.trace) lines.push(`  ${t.ok ? 'ok ' : 'XX '} ${t.kind.padEnd(8)} ${t.step.padEnd(20)} ${t.stale ? '[question text changed] ' : ''}${t.ok ? JSON.stringify(t.reading)?.slice(0, 140) : t.why ?? `unreadable: ${JSON.stringify(t.answer)?.slice(0, 120)}`}`);
  if (r.answer) lines.push(`  answer: ${r.answer}`);
  if (r.attribution) lines.push(`  cause (${r.attribution.cause}) at ${r.attribution.step}: ${r.attribution.why}`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const FLOOR = path.join(STATE, 'offline-floor.json');
  if (cmd === 'judge') {
    // The only model calls of the offline tier: free-text golds the rules cannot decide are judged once per (case, gold, answer) by the
    // cached judge of the live runner; later offline runs read the cache.
    const {judge} = await import('./run.mjs');
    const out = await runOffline({tier: opt('--tier', 'tiny')});
    const items = loadItems(), cases = new Map(loadCases().map(c => [c.id, c]));
    const pending = out.results.filter(r => r.outcome === 'undecided').map(r => ({c: resolveCase(cases.get(r.id), {items}), response: r.response}));
    const j = pending.length ? await judge(pending, {purpose: 'job:formalization-improve'}) : {calls: 0, cached: 0};
    console.log(JSON.stringify({undecided: pending.length, ...j}));
    world?.dispose();
  } else if (cmd === 'floor' || cmd === 'check') {
    // floor: the cases the offline tier answers correctly now; check: none of them may be lost (exit 1), new ones are reported.
    const out = await runOffline({tier: opt('--tier', 'tiny')});
    const correct = out.results.filter(r => r.outcome === 'correct').map(r => r.id);
    if (cmd === 'floor') { fs.mkdirSync(STATE, {recursive: true}); fs.writeFileSync(FLOOR, JSON.stringify({at: new Date().toISOString(), correct}, null, 1) + '\n'); console.log(`floor: ${correct.length} of ${out.results.length} correct (${out.ms} ms)`); }
    else {
      const floor = fs.existsSync(FLOOR) ? JSON.parse(fs.readFileSync(FLOOR, 'utf8')).correct : [];
      const lost = floor.filter(id => !correct.includes(id)), gained = correct.filter(id => !floor.includes(id));
      console.log(JSON.stringify({cases: out.results.length, correct: correct.length, lost, gained: gained.length, first_divergence: out.firsts, ms: out.ms}));
      for (const id of lost) console.log(explain(out.results.find(r => r.id === id)));
      world?.dispose();
      process.exit(lost.length ? 1 : 0);
    }
    world?.dispose();
  } else if (cmd === 'import') console.log(`${importRun(opt('--run'), opt('--tier', 'tiny'))} recordings imported`);
  else if (cmd === 'run') {
    const out = await runOffline({tier: opt('--tier', 'tiny'), ids: opt('--ids') ? opt('--ids').split(',') : null, fast: opt('--fast') ? Number(opt('--fast')) : null});
    if (args.includes('--json')) console.log(JSON.stringify({counts: out.counts, firsts: out.firsts, ms: out.ms}));
    else {
      for (const r of out.results.filter(x => x.outcome !== 'correct').slice(0, Number(opt('--show', 3)))) console.log(explain(r) + '\n');
      console.log(JSON.stringify({cases: out.results.length, counts: out.counts, first_divergence: out.firsts, attribution: out.causes, ms: out.ms}));
    }
    world?.dispose();
  } else { console.error('usage: offline.mjs import --run RUN [--tier T] | run [--tier T] [--ids a,b] [--fast N] [--json] [--show N]'); process.exit(2); }
}
