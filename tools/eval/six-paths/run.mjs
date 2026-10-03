#!/usr/bin/env node
/**
 * The six-paths experiment (owner, 2026-10-03; preregistration status/preregistrations/eval-six-paths-v1.json; results
 * experiments/proposal/six-paths-results.md): six formalization paths of strongly different strategy (A method, B compute,
 * C equations, D backward, E controlled English, F analogy), each a routed question tree on tier `small` with its own deterministic
 * heuristics into SOP. A formalization is VERIFIED when two paths give the same EXECUTED result on the problem's numbers and on three
 * perturbations (compared by result, never by syntax).
 *
 *   node tools/eval/six-paths/run.mjs sample --n 20 --seed S --out FILE          stratified by book, fresh (never an id of an earlier run)
 *   node tools/eval/six-paths/run.mjs iter --ids FILE --run-id ID [--paths A,B,C,D,E,F] [--concurrency 3]
 *   node tools/eval/six-paths/run.mjs measure --ids FILE --run-id ID --first B,D       the two strongest first, the rest only on disagreement
 *   ... iter|measure --tier tiny                                                    the same paths on tier tiny (purpose job:six-paths-tiny)
 *   node tools/eval/six-paths/run.mjs batch --run-id ID [--n 100] [--tiny-concurrency 32] [--small-concurrency 16] [--small-max 50] [--small-paths B,C,A]
 *   node tools/eval/six-paths/run.mjs batch-report --run-id ID [--rescore]           the batch's reports again (rescore: new verdicts and decisions)
 *   node tools/eval/six-paths/run.mjs pool                                           backfill the analogy pool from every stored run
 *   node tools/eval/six-paths/run.mjs report --run-id ID [--rescore]                summary.md (rescore: verdicts again from the stored answers)
 *
 * Rows: state/six-paths/<run-id>/results.jsonl (book-derived traces stay in the gitignored state/). The proxy's response cache makes a
 * rerun of an unchanged question free. Verified and correct programs feed the analogy pool of path F (datasets_sources/six-paths/).
 * Sealed suites are never read: the problems are the owner's books (datasets_sources/books/eval/items.jsonl).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadItems} from '../formalization-regression/cases.mjs';
import {sectionExclude} from '../formalization-regression/expression.mjs';
import {signatureOf} from '../../datasets/three-datasets/forms.mjs';
import {shapeOf} from '../../../lib/formalize/exemplars.mjs';
import {ROOT, client, context, registryFor, conditions} from './common.mjs';
import {goldFor, verdictOf, isCorrect} from './score.mjs';
import {pathA} from './path-a.mjs';
import {pathB} from './path-b.mjs';
import {pathC} from './path-c.mjs';
import {pathD} from './path-d.mjs';
import {pathE} from './path-e.mjs';
import {pathF, POOL} from './path-f.mjs';

export const PATHS = Object.freeze({A: pathA, B: pathB, C: pathC, D: pathD, E: pathE, F: pathF});
const STATE = path.join(ROOT, 'state/six-paths');
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const args = Object.fromEntries(process.argv.slice(3).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));

// ---------------------------------------------------------------- comparison by executed result
export const norm = v => typeof v === 'number' ? Number(v.toPrecision(9)) : typeof v === 'string' ? v.trim().toLowerCase() : v;
const same = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a)) : norm(a) === norm(b);
/** Two answer lists say the same: every value of each is among the other's. */
export const sameAnswers = (a, b) => {
  if (!a?.length || !b?.length) return false;
  // A kind of value only one side gives (a name next to the numbers both compute: "Site B" with 8, 4, 6) is left out of the comparison;
  // the values of the kinds both give must agree both ways.
  const kinds = xs => new Set(xs.map(x => typeof x));
  const ka = kinds(a), kb = kinds(b), shared = [...ka].filter(k => kb.has(k));
  const x = a.filter(v => shared.includes(typeof v)), y = b.filter(v => shared.includes(typeof v));
  return x.length > 0 && y.length > 0 && x.every(p => y.some(q => same(p, q))) && y.every(p => x.some(q => same(p, q)));
};
/**
 * Two profiles ([answers per condition]: original, then perturbations) agree: the same on the original numbers, never different on a
 * perturbation both answer, and the same on at least one perturbation (unless the problem has no numbers to move).
 */
export function agree(p, q) {
  if (!p || !q || !sameAnswers(p[0], q[0])) return false;
  if (p.length === 1) return true;
  let both = 0;
  for (let i = 1; i < p.length; i++) { if (!p[i]?.length || !q[i]?.length) continue; both++; if (!sameAnswers(p[i], q[i])) return false; }
  return both > 0;
}

/** Clusters of paths that agree pairwise (largest first). */
export function clusters(profiles) {
  const names = Object.keys(profiles).filter(n => profiles[n]);
  const left = new Set(names), out = [];
  while (left.size) {
    let best = null;
    for (const i of left) { const m = [...left].filter(j => i === j || agree(profiles[i], profiles[j])).filter((j, _, all) => all.every(k => j === k || agree(profiles[j], profiles[k]))); if (!best || m.length > best.length) best = m; }
    out.push(best.sort()); for (const j of best) left.delete(j);
  }
  return out.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/** The decision "2 of N agree": the largest cluster of size >= 2, strictly larger than the next; else unresolved. */
export function decide(profiles) {
  const cl = clusters(profiles);
  // Votes are counted per STRATEGY: the same path on two tiers (B and B@tiny) is one strategy, never two agreeing paths.
  const votes = c => new Set(c.map(strategyOf)).size;
  if (cl.length && votes(cl[0]) >= need(profiles[cl[0][0]]) && (cl.length < 2 || votes(cl[0]) > votes(cl[1]))) return {status: 'verified', paths: cl[0], answers: profiles[cl[0][0]][0], clusters: cl};
  // Tied clusters, each verified on its own perturbations, that give the same answer on the problem's own numbers: the answer is
  // verified (they generalize differently, but both confirm this instance; round 4, math:2.6: A+D and B+C both said 7).
  const top = cl.filter(c => votes(c) === votes(cl[0] ?? []) && votes(c) >= need(profiles[c[0]]));
  if (top.length > 1 && top.every(c => sameAnswers(profiles[c[0]][0], profiles[top[0][0]][0]))) return {status: 'verified', paths: top.flat(), answers: profiles[top[0][0]][0], clusters: cl};
  return {status: 'unresolved', clusters: cl};
}

/** The strategy of a profile name: `B`, `B@tiny` → B. */
export const strategyOf = name => String(name).split('@')[0];

/**
 * How many agreeing paths an answer needs (batch2 finding: two paths agreed by chance on a yes/no that no perturbation moves, 5 of 7
 * wrong). A profile whose answers are only yes/no values and stay the same on every condition (no numbers, or numbers that do not
 * move it) carries about one bit: it needs three agreeing paths; any other profile needs two.
 */
export function need(profile) {
  const flat = (profile ?? []).filter(Boolean);
  const onlyBool = flat.every(a => a.every(v => typeof v === 'boolean'));
  const constant = flat.every(a => JSON.stringify(a) === JSON.stringify(flat[0]));
  return onlyBool && constant ? 3 : 2;
}

// ---------------------------------------------------------------- one path on one problem
async function runPath(name, item, registry, chat) {
  const ctx = context(chat, 10);
  const t0 = Date.now();
  let r, execMs = 0;
  try { r = await PATHS[name]({item, registry, ctx, exclude: sectionExclude(item)}); } catch (error) { r = {status: 'error', why: error.message}; }
  if (ctx.infra && r.status !== 'ok') r = {status: 'unavailable', why: 'model unavailable'};
  const profile = [];
  if (r.status === 'ok') {
    for (const values of conditions(registry, {seed: item.id})) {
      let a = null;
      const e0 = Date.now();
      try { a = await r.exec(values); } catch { a = null; }
      execMs += Date.now() - e0;
      profile.push(a);
    }
  }
  return {path: name, status: r.status, why: r.why ?? r.at ?? null, questions: ctx.questions, seconds: Math.round((Date.now() - t0) / 100) / 10, exec_seconds: Math.round(execMs / 100) / 10,
    profile: r.status === 'ok' && profile[0] ? profile : null, program: r.program ?? null, tree: r.tree ?? null, trace: ctx.trace};
}

export async function runItem(item, names, chat, {first = null} = {}) {
  const registry = registryFor(item.question);
  const out = {};
  const order = first ? [...first, ...names.filter(n => !first.includes(n))] : names;
  for (const n of order) {
    if (first && !first.includes(n)) {
      // Measurement mode: the other paths only when the first two do not agree.
      const pre = Object.fromEntries(first.map(f => [f, out[f]?.profile]));
      if (decide(pre).status === 'verified') break;
    }
    out[n] = await runPath(n, item, registry, chat);
  }
  return {id: item.id, book: item.book, section: item.tags?.[0] ?? item.section, registry: registry.length, paths: out};
}

export async function score(row, items, chat) {
  const item = items.get(row.id);
  // A path the model server never answered (after the client's retries) is an infrastructure failure: never scored, run again later.
  for (const p of Object.values(row.paths)) Object.assign(p, p.status === 'unavailable' ? {verdict: 'infra', why: 'model unavailable'} : await verdictOf(item, p.profile?.[0] ?? null, {chat}));
  const d = decide(Object.fromEntries(Object.entries(row.paths).map(([n, p]) => [n, p.profile])));
  row.decision = {...d, ...(d.status === 'verified' ? await verdictOf(item, d.answers, {chat}) : {})};
  return row;
}

// ---------------------------------------------------------------- report
const pct = (a, b) => (b ? `${Math.round(100 * a / b)}%` : '-');
export function report(rows, {runId, cost = null} = {}) {
  const names = [...new Set(rows.flatMap(r => Object.keys(r.paths)))].sort();
  const L = [`# Six paths: ${runId}`, '', `${rows.length} problems (${Object.entries(rows.reduce((a, r) => ({...a, [r.book]: (a[r.book] ?? 0) + 1}), {})).map(([b, n]) => `${b} ${n}`).join(', ')}); verdicts against the book answers (format-only mismatches counted correct, listed apart).`, '',
    '| path | ran | correct | of which format-only | wrong | gold defect | no result | questions mean / max | seconds per problem |', '|---|---|---|---|---|---|---|---|---|'];
  const stats = {};
  for (const n of names) {
    const ps = rows.map(r => r.paths[n]).filter(Boolean);
    const c = k => ps.filter(p => p.verdict === k).length;
    const q = ps.map(p => p.questions);
    stats[n] = {ran: ps.length, correct: c('correct') + c('format'), format: c('format'), wrong: c('wrong'), defect: c('gold_defect'), none: c('no_result'), infra: c('infra')};
    const scorable = ps.length - stats[n].defect - stats[n].infra;
    L.push(`| ${n} | ${ps.length} | ${stats[n].correct} (${pct(stats[n].correct, scorable)} of ${scorable} scorable) | ${c('format')} | ${c('wrong')} | ${c('gold_defect')} | ${c('no_result')} | ${(q.reduce((a, b) => a + b, 0) / (q.length || 1)).toFixed(1)} / ${Math.max(0, ...q)} | ${(ps.reduce((a, p) => a + p.seconds, 0) / (ps.length || 1)).toFixed(1)} |`);
  }
  L.push('', 'Wrong together (both answered wrong on the same problem; diagonal: wrong alone):', '', `| | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
  for (const a of names) L.push(`| ${a} | ${names.map(b => rows.filter(r => r.paths[a]?.verdict === 'wrong' && r.paths[b]?.verdict === 'wrong').length).join(' | ')} |`);
  L.push('', 'Agreeing wrongly (two paths verified together on a wrong answer):', '', `| | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
  for (const a of names) L.push(`| ${a} | ${names.map(b => (a === b ? '-' : rows.filter(r => r.paths[a]?.verdict === 'wrong' && r.paths[b]?.verdict === 'wrong' && agree(r.paths[a].profile, r.paths[b].profile)).length)).join(' | ')} |`);
  const ver = rows.filter(r => r.decision?.status === 'verified');
  const vc = ver.filter(r => isCorrect(r.decision.verdict));
  const anyCorrect = rows.filter(r => Object.values(r.paths).some(p => isCorrect(p.verdict))).length;
  const vs = ver.filter(r => ['correct', 'format', 'wrong'].includes(r.decision.verdict)), scor = rows.filter(r => !Object.values(r.paths).some(p => p.verdict === 'gold_defect'));
  L.push('', `Verified ("2 of N agree" on the numbers and 3 perturbations; 3 for a constant yes/no): ${ver.length}/${rows.length}; on scorable problems ${vs.length}/${scor.length} (${pct(vs.length, scor.length)}); precision ${vc.length}/${vs.length} (${pct(vc.length, vs.length)}, gold defects excluded); wrong verified ${ver.filter(r => r.decision.verdict === 'wrong').length}, gold defect ${ver.filter(r => r.decision.verdict === 'gold_defect').length}. At least one path correct: ${anyCorrect}/${scor.length} scorable.`);
  const pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    const ag = rows.filter(r => agree(r.paths[a]?.profile, r.paths[b]?.profile));
    if (ag.length) pairs.push(`${a}+${b} ${ag.filter(r => isCorrect(r.paths[a].verdict)).length}/${ag.length}`);
  }
  L.push(`Pairs that agree (correct/agreeing): ${pairs.join(', ') || 'none'}.`);
  const unique = names.map(n => `${n} ${rows.filter(r => isCorrect(r.paths[n]?.verdict) && Object.entries(r.paths).every(([m, p]) => m === n || !isCorrect(p.verdict))).length}`);
  L.push(`Unique correct answers (only this path correct): ${unique.join(', ')}.`);
  const fmt = rows.flatMap(r => Object.entries(r.paths).filter(([, p]) => p.verdict === 'format').map(([n, p]) => `${r.id} ${n}: ${p.why}`));
  L.push('', `Format-only mismatches (scored correct; the strict scorer would miss them): ${fmt.length}${fmt.length ? `\n${fmt.map(x => `- ${x}`).join('\n')}` : ''}`);
  const defects = rows.filter(r => Object.values(r.paths).some(p => p.verdict === 'gold_defect')).map(r => r.id);
  L.push(`Gold defects: ${defects.length}${defects.length ? ` (${defects.join(', ')})` : ''}. True errors (wrong after normalization): ${Object.values(stats).reduce((a, s) => a + s.wrong, 0)} path answers.`);
  const stops = {};
  for (const r of rows) for (const [n, p] of Object.entries(r.paths)) if (p.verdict === 'no_result') { const k = `${n}:${p.status}`; stops[k] = (stops[k] ?? 0) + 1; }
  L.push('', `No-result reasons: ${Object.entries(stops).sort().map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  if (cost) L.push('', `Model calls: ${cost.calls} (cache hits about ${cost.hits}), failures ${cost.failures}, ${Math.round(cost.ms / 1000)} s of model time.`);
  return {text: L.join('\n') + '\n', stats};
}

// ---------------------------------------------------------------- analogy pool (path F)
export function addToPool(rows, items) {
  // Redesign of F after two batches with no correct answer (the bad-path rule): the pool admits every program whose executed answer
  // matched the book's answer (gold-verified; a 2-of-N agreement was too rare on tiny to feed it), preferring a program of a verified
  // agreement. Strict leave-one-out at retrieval keeps the problem itself, its section and content-word duplicates out.
  const have = new Set(readJsonl(POOL).map(r => r.id));
  const add = [];
  for (const r of rows) {
    if (have.has(r.id)) continue;
    const ok = Object.entries(r.paths).filter(([, p]) => p.program && isCorrect(p.verdict)).map(([n, p]) => ({...p, path: n}));
    const p = ok.find(x => r.decision?.paths?.includes(x.path)) ?? ok.find(x => /\banswer\d*\s*=/.test(x.program)) ?? ok[0];
    if (!p) continue;
    const item = items.get(r.id), reg = registryFor(item.question);
    add.push({id: r.id, shape: shapeOf(reg), numbers: reg.map(v => `v${v.index} = ${v.span}`).join(', '), program: p.program, meta: {book: item.book, chapter: item.chapter, stratum: item.tags?.[0], words: signatureOf({message: item.question}).words, from: p.path, verified: r.decision?.status === 'verified'}});
    have.add(r.id);
  }
  if (add.length) { fs.mkdirSync(path.dirname(POOL), {recursive: true}); fs.appendFileSync(POOL, add.map(x => JSON.stringify(x)).join('\n') + '\n'); }
  return add.length;
}


// ---------------------------------------------------------------- batches (owner, 2026-10-03: tiny first, small on the residue)

/** A fresh sample stratified by book (round robin, seeded hash order), never an id of an earlier six-paths run, never a gold defect. */
function drawSample(items, {n, seed, exclude = []}) {
  const used = new Set(fs.existsSync(STATE) ? fs.readdirSync(STATE).flatMap(d => [...readJsonl(path.join(STATE, d, 'results.jsonl')), ...readJsonl(path.join(STATE, d, 'tiny.jsonl')), ...readJsonl(path.join(STATE, d, 'small.jsonl')), ...(fs.existsSync(path.join(STATE, d, 'ids.txt')) ? fs.readFileSync(path.join(STATE, d, 'ids.txt'), 'utf8').split('\n').filter(Boolean).map(id => ({id})) : [])].map(r => r.id)) : []);
  for (const f of exclude) for (const id of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) used.add(id);
  const rank = id => createHash('sha256').update(`${seed}\0${id}`).digest('hex');
  const byBook = new Map();
  for (const it of items.values()) { const g = goldFor(it); if (used.has(it.id) || !g || g.kind === 'defect') continue; if (!byBook.has(it.book)) byBook.set(it.book, []); byBook.get(it.book).push(it); }
  const books = [...byBook.keys()].sort(), out = [];
  for (const b of books) byBook.get(b).sort((x, y) => rank(x.id).localeCompare(rank(y.id)));
  for (let i = 0; out.length < n && books.some(x => byBook.get(x).length); i++) { const it = byBook.get(books[i % books.length]).shift(); if (it) out.push(it.id); }
  return out;
}

/** Runs `ids` on one tier with `concurrency` workers, appending rows to `file` (resumable). */
async function pass(ids, {items, tier, file, runId, concurrency, names, judge}) {
  const done = new Set(readJsonl(file).map(r => r.id));
  const {chat, cost} = client({tier, run: `six-paths-${runId}-${tier}`});
  const todo = ids.filter(id => !done.has(id) && items.has(id));
  let k = 0;
  const worker = async () => {
    while (todo.length) {
      const id = todo.shift();
      const row = await score(await runItem(items.get(id), names, chat), items, judge ?? chat);
      row.tier = tier;
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
      if (++k % 10 === 0) console.log(`${tier}: ${k}/${ids.length}`);
    }
  };
  await Promise.all(Array.from({length: concurrency}, worker));
  return cost;
}

const solvedRow = r => r.decision?.status === 'verified' && isCorrect(r.decision.verdict);
const scorableRow = r => !Object.values(r.paths).some(p => p.verdict === 'gold_defect');
const hashOrder = (seed, ids) => [...ids].sort((a, b) => createHash('sha256').update(`${seed}\0${a}`).digest('hex').localeCompare(createHash('sha256').update(`${seed}\0${b}`).digest('hex')));

/**
 * One unattended batch: `n` fresh problems stratified by book, all paths on tier tiny (high concurrency against the local server);
 * then tier small only on the residue (no 2-of-N tiny agreement verified a correct answer), on the paths strongest on tiny (at most 3)
 * and at most `--small-max` residue problems (a seeded random subset: at 15 requests per minute about one hour of small). Writes
 * state/six-paths/<run-id>/{ids.txt, tiny.jsonl, small.jsonl, summary-tiny.md, summary-small.md, compare.md, batch.md}. One process,
 * one memory load; resumable.
 */
async function batch(items) {
  const runId = String(args['run-id']);
  const dir = path.join(STATE, runId); fs.mkdirSync(dir, {recursive: true});
  const idsFile = path.join(dir, 'ids.txt');
  if (!fs.existsSync(idsFile)) fs.writeFileSync(idsFile, drawSample(items, {n: Number(args.n ?? 100), seed: String(args.seed ?? runId)}).join('\n') + '\n');
  const ids = fs.readFileSync(idsFile, 'utf8').split('\n').filter(Boolean);
  const names = String(args.paths ?? 'A,B,C,D,E,F').split(',');
  const judge = client({tier: 'small', run: `six-paths-${runId}-judge`}).chat;
  const tinyFile = path.join(dir, 'tiny.jsonl'), smallFile = path.join(dir, 'small.jsonl');
  const tinyCost = await pass(ids, {items, tier: 'tiny', file: tinyFile, runId, concurrency: Number(args['tiny-concurrency'] ?? 32), names, judge});
  const tinyRows = readJsonl(tinyFile);
  fs.writeFileSync(path.join(dir, 'summary-tiny.md'), report(tinyRows, {runId: `${runId} (tier tiny)`, cost: tinyCost}).text);
  const residueAll = tinyRows.filter(r => !solvedRow(r) && scorableRow(r)).map(r => r.id);
  const cap = Number(args['small-max'] ?? Infinity);
  const residue = residueAll.length > cap ? hashOrder(runId, residueAll).slice(0, cap) : residueAll;
  const strongest = args['small-paths'] ? String(args['small-paths']).split(',') : names.map(n => [n, tinyRows.filter(r => isCorrect(r.paths[n]?.verdict)).length]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  console.log(`tiny verified-correct ${tinyRows.filter(solvedRow).length}/${tinyRows.length}; residue ${residueAll.length}, small runs ${residue.length} on paths ${strongest.join(', ')}`);
  const smallCost = args['no-small'] ? null : await pass(residue, {items, tier: 'small', file: smallFile, runId, concurrency: Number(args['small-concurrency'] ?? 16), names: strongest, judge});
  const added = addToPool(readJsonl(smallFile), items) + addToPool(tinyRows, items);
  await batchReport(runId, items, {tinyCost, smallCost, added});
}

/** The reports of a batch from its rows; `rescore` scores and decides every row again (the judge's calls come from the cache). */
async function batchReport(runId, items, {tinyCost = null, smallCost = null, added = 0, rescore = false} = {}) {
  const dir = path.join(STATE, runId), tinyFile = path.join(dir, 'tiny.jsonl'), smallFile = path.join(dir, 'small.jsonl');
  const tinyRows = readJsonl(tinyFile), smallRows = readJsonl(smallFile);
  if (rescore) {
    const judge = client({tier: 'small', run: `six-paths-${runId}-judge`}).chat;
    for (const r of [...tinyRows, ...smallRows]) await score(r, items, judge);
    fs.writeFileSync(tinyFile, tinyRows.map(r => JSON.stringify(r)).join('\n') + '\n');
    if (smallRows.length) fs.writeFileSync(smallFile, smallRows.map(r => JSON.stringify(r)).join('\n') + '\n');
  }
  const residue = tinyRows.filter(r => !solvedRow(r) && scorableRow(r)).map(r => r.id);
  fs.writeFileSync(path.join(dir, 'summary-tiny.md'), report(tinyRows, {runId: `${runId} (tier tiny)`, cost: tinyCost}).text);
  fs.writeFileSync(path.join(dir, 'summary-small.md'), report(smallRows, {runId: `${runId} (tier small, tiny residue)`, cost: smallCost}).text);
  const {compare} = await import('./compare.mjs');
  const T = new Map(tinyRows.map(r => [r.id, r])), S = new Map(smallRows.map(r => [r.id, r]));
  fs.writeFileSync(path.join(dir, 'compare.md'), compare(S, T, {a: 'small', b: 'tiny'}));
  const sc = tinyRows.filter(scorableRow).length;
  const verified = rows => rows.filter(r => r.decision?.status === 'verified' && ['correct', 'format', 'wrong'].includes(r.decision.verdict));
  const tinyVer = verified(tinyRows), smallVer = verified(smallRows);
  const tinyOk = tinyVer.filter(r => isCorrect(r.decision.verdict)).length, smallOk = smallVer.filter(r => isCorrect(r.decision.verdict)).length;
  const pct = (a, b) => (b ? `${Math.round(100 * a / b)}%` : '-');
  const text = [`# Six paths batch ${runId}`, '', `${tinyRows.length} problems, ${sc} scorable. tiny: verified ${tinyVer.length}, correct ${tinyOk} (precision ${pct(tinyOk, tinyVer.length)}).`,
    `Residue (no tiny-verified correct answer, scorable): ${residue.length}; small ran ${smallRows.length}. small on them: verified ${smallVer.length}, correct ${smallOk} (precision ${pct(smallOk, smallVer.length)}).`,
    `System (tiny first, small on the residue): verified correct ${tinyOk + smallOk}/${sc} scorable. Analogy pool +${added}.`, '',
    'Files: summary-tiny.md, summary-small.md (residue only), compare.md (small vs tiny on the residue).'].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'batch.md'), text);
  console.log(text);
}

// ---------------------------------------------------------------- commands
async function main() {
  const cmd = process.argv[2];
  const items = loadItems();
  if (cmd === 'sample') {
    const out = drawSample(items, {n: Number(args.n ?? 20), seed: String(args.seed ?? 'six-1'), exclude: String(args.exclude ?? '').split(',').filter(Boolean)});
    fs.mkdirSync(path.dirname(path.resolve(args.out)), {recursive: true});
    fs.writeFileSync(args.out, out.join('\n') + '\n');
    console.log(`${out.length} ids → ${args.out}`);
    return;
  }
  if (cmd === 'batch') { await batch(items); process.exit(0); }
  if (cmd === 'pool') {
    // Backfill the analogy pool from every stored run (rows of earlier batches and dev iterations).
    let n = 0;
    for (const d of fs.readdirSync(STATE)) for (const f of ['results.jsonl', 'tiny.jsonl', 'small.jsonl']) n += addToPool(readJsonl(path.join(STATE, d, f)), items);
    console.log(`analogy pool +${n}`); process.exit(0);
  }
  if (cmd === 'batch-report') { await batchReport(String(args['run-id']), items, {rescore: Boolean(args.rescore)}); process.exit(0); }
  if (cmd === 'iter' || cmd === 'measure') {
    const ids = fs.readFileSync(args.ids, 'utf8').split('\n').filter(Boolean);
    const runId = String(args['run-id']);
    const dir = path.join(STATE, runId); fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, 'results.jsonl');
    const done = new Set(readJsonl(file).map(r => r.id));
    const names = String(args.paths ?? 'A,B,C,D,E,F').split(',');
    const first = cmd === 'measure' ? String(args.first ?? 'B,D').split(',') : null;
    const tier = String(args.tier ?? 'small');
    const {chat, cost} = client({tier, run: `six-paths-${runId}`});
    // The judge's compare-only calls always go to small (one judge for both arms).
    const judge = tier === 'small' ? chat : client({tier: 'small', run: `six-paths-${runId}-judge`}).chat;
    const todo = ids.filter(id => !done.has(id) && items.has(id));
    let k = 0;
    const worker = async () => {
      while (todo.length) {
        const id = todo.shift();
        const row = await score(await runItem(items.get(id), names, chat, {first}), items, judge);
        row.tier = tier;
        fs.appendFileSync(file, JSON.stringify(row) + '\n');
        console.log(`[${++k}/${ids.length}] ${id} ${Object.entries(row.paths).map(([n, p]) => `${n}:${p.verdict}`).join(' ')} → ${row.decision.status}${row.decision.verdict ? `/${row.decision.verdict}` : ''}`);
      }
    };
    await Promise.all(Array.from({length: Number(args.concurrency ?? 3)}, worker));
    const rows = readJsonl(file);
    const rep = report(rows, {runId: `${runId} (tier ${tier})`, cost});
    fs.writeFileSync(path.join(dir, 'summary.md'), rep.text);
    // Only the small arm feeds the analogy pool (the tiny arm stays comparable: it reuses what small verified, never its own).
    const added = tier === 'small' ? addToPool(rows, items) : 0;
    console.log(rep.text);
    console.log(`analogy pool +${added}`);
    process.exit(0);
  }
  if (cmd === 'repair') {
    // A harness defect found after a run (preregistration "harness_break"): the named paths are run again on every row of the run
    // (unchanged questions come from the proxy cache) and the rows are scored and decided again.
    const runId = String(args['run-id']), tier = String(args.tier ?? 'small');
    const file = path.join(STATE, runId, 'results.jsonl');
    const rows = readJsonl(file), names = String(args.paths).split(',');
    const {chat, cost} = client({tier, run: `six-paths-${runId}-repair`});
    const judge = tier === 'small' ? chat : client({tier: 'small', run: `six-paths-${runId}-judge`}).chat;
    const queue = [...rows];
    const worker = async () => { while (queue.length) { const r = queue.shift(); const item = items.get(r.id), registry = registryFor(item.question); for (const n of names) r.paths[n] = await runPath(n, item, registry, chat); await score(r, items, judge); console.log(`${r.id} ${names.map(n => `${n}:${r.paths[n].verdict}`).join(' ')} → ${r.decision.status}`); } };
    await Promise.all(Array.from({length: Number(args.concurrency ?? 4)}, worker));
    fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const rep = report(rows, {runId: `${runId} (tier ${tier})`, cost});
    fs.writeFileSync(path.join(STATE, runId, 'summary.md'), rep.text);
    console.log(rep.text);
    process.exit(0);
  }
  if (cmd === 'report') {
    const runId = String(args['run-id']);
    const file = path.join(STATE, runId, 'results.jsonl');
    let rows = readJsonl(file);
    if (args.rescore) {
      const {chat} = client({tier: 'small', run: `six-paths-${runId}-rescore`});
      rows = await Promise.all(rows.map(r => score(r, items, chat)));
      fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    }
    const rep = report(rows, {runId});
    fs.writeFileSync(path.join(STATE, runId, 'summary.md'), rep.text);
    console.log(rep.text);
    process.exit(0);
  }
  console.error('usage: sample | iter | measure | report');
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error); process.exit(1); });
