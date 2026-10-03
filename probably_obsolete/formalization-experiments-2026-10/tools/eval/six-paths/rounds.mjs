#!/usr/bin/env node
/**
 * Sequential rounds of the six-paths experiment (owner decision, 2026-10-03, after two 100-problem batches taught little): problems
 * are drawn one at a time from the books (round robin over the books across all rounds, a seeded random order within a book, never an
 * id used by any earlier six-paths run, never a structural gold defect). Each problem runs the kept paths on tier tiny; when no 2-of-N
 * tiny agreement verified a correct answer, the residue paths run on tier small. FAILURE = no verified correct answer after the small
 * pass. A round stops at its 5th failure; its RUN LENGTH (problems processed up to and including the 5th failure, in draw order) is
 * the progress metric.
 *
 *   node tools/eval/six-paths/rounds.mjs round --round 1 [--window 3] [--tiny-paths A,B,C,D,E] [--small-paths B,C,A]
 *   node tools/eval/six-paths/rounds.mjs curve                   run length per round and the cumulative solved/attempted ratio
 *   node tools/eval/six-paths/rounds.mjs failures --round 1      the failures of a round with every path's first diverging step
 *   node tools/eval/six-paths/rounds.mjs regress [--tier tiny]   every problem solved in an earlier round, run again (zero losses)
 *
 * Rows: state/six-paths/round-NN/rows.jsonl ({order, id, book, tiny, small, solved, by}); summary.md per round; state/six-paths/curve.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadItems} from '../formalization-regression/cases.mjs';
import {ROOT, client} from './common.mjs';
import {goldFor, isCorrect} from './score.mjs';
import {runItem, score, addToPool, report} from './run.mjs';
import {context} from './common.mjs';
import {pathZ} from './path-z.mjs';
import {accept} from './accept.mjs';
import {valuesOf, STATS} from './equivalence.mjs';
import {verdictOf} from './score.mjs';

const equivalenceChat = client({tier: 'equivalence', run: 'six-paths-rounds-equivalence', purpose: 'job:six-paths-equivalence'}).chat;

const STATE = path.join(ROOT, 'state/six-paths');
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const args = Object.fromEntries(process.argv.slice(3).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
const roundDir = n => path.join(STATE, `round-${String(n).padStart(2, '0')}`);
const roundsDone = () => (fs.existsSync(STATE) ? fs.readdirSync(STATE).filter(d => /^round-\d+$/.test(d)).sort() : []);
const solvedRow = r => { const a = r.accept ?? r.decision; return a?.status === 'verified' && isCorrect(a.verdict); };
/** Z's short parts as values for the scorer (yes/no, the first number, or the text). */
const zValues = z => (z?.answers ?? []).flatMap(p => { const v = valuesOf(p); const nums = [...String(p).replace(/(\d),(\d{3})/g, '$1$2').matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0])); return v.kind === 'yesno' ? [v.value, ...nums] : v.kind === 'number' ? v.values : nums.length ? nums : [p]; });
/** The acceptance of a tier's row with Z (accept.mjs), scored against the book's answer. */
async function accepted(row, z, item, chat, other = null) {
  // On the small pass the tiny paths of OTHER strategies also vote (B@tiny with small C): votes count per strategy, never per tier.
  const profiles = Object.fromEntries(Object.entries(row.paths).map(([n, p]) => [n, p.profile]));
  if (other) for (const [n, p] of Object.entries(other.paths)) profiles[`${n}@tiny`] = p.profile;
  const acc = await accept(profiles, z?.answers ?? null, {chat: equivalenceChat, problem: item.question});
  row.accept = {...acc, ...(acc.status === 'verified' ? await verdictOf(item, acc.answers, {chat}) : {})};
  return row;
}

/** Every id any six-paths run has used (rows of any file, ids lists). */
function usedIds() {
  const out = new Set();
  if (!fs.existsSync(STATE)) return out;
  for (const d of fs.readdirSync(STATE)) {
    const dir = path.join(STATE, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.jsonl')) for (const r of readJsonl(path.join(dir, f))) if (r.id) out.add(r.id);
      if (f.endsWith('.txt')) for (const id of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) out.add(id.trim());
    }
  }
  return out;
}

/** A drawer of fresh problems: the book of the k-th draw overall is books[k mod 7]; within a book a seeded hash order. */
function drawer(items, seed = 'six-rounds') {
  const used = usedIds();
  const books = [...new Set([...items.values()].map(i => i.book))].sort();
  const queues = new Map(books.map(b => [b, [...items.values()].filter(i => i.book === b && !used.has(i.id) && goldFor(i) && goldFor(i).kind !== 'defect')
    .sort((x, y) => createHash('sha256').update(`${seed}\0${x.id}`).digest('hex').localeCompare(createHash('sha256').update(`${seed}\0${y.id}`).digest('hex')))]));
  let k = roundsDone().reduce((s, d) => s + readJsonl(path.join(STATE, d, 'rows.jsonl')).length, 0);
  return () => { for (let t = 0; t < books.length; t++) { const q = queues.get(books[k++ % books.length]); if (q.length) return q.shift(); } return null; };
}

async function round(items) {
  const n = Number(args.round);
  const dir = roundDir(n); fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'rows.jsonl');
  const tinyPaths = String(args['tiny-paths'] ?? 'A,B,C,D,E').split(','), smallPaths = String(args['small-paths'] ?? 'B,C,A').split(',');
  const tiny = client({tier: 'tiny', run: `six-paths-round-${n}-tiny`}), small = client({tier: 'small', run: `six-paths-round-${n}-small`});
  const next = drawer(items);
  const rows = readJsonl(file);
  let order = rows.length, failures = rows.filter(r => !r.solved).length;
  const window = Number(args.window ?? 3);
  const one = async () => {
    while (failures < 5) {
      const item = next();
      if (!item) return;
      const o = ++order;
      const zctx = context(tiny.chat, 2);
      const z = await pathZ({item, ctx: zctx});
      z.verdict = z.status === 'ok' ? (await verdictOf(item, zValues(z), {chat: small.chat})).verdict : 'no_result';
      const t = await accepted(await score(await runItem(item, tinyPaths, tiny.chat), items, small.chat), z, item, small.chat);
      let s = null, by = solvedRow(t) ? 'tiny' : null;
      if (!by && failures < 5) { s = await accepted(await score(await runItem(item, smallPaths, small.chat), items, small.chat), z, item, small.chat, t); if (solvedRow(s)) by = 'small'; }
      const row = {order: o, id: item.id, book: item.book, z, tiny: t, small: s, solved: Boolean(by), by, gold_defect: Object.values(t.paths).some(p => p.verdict === 'gold_defect')};
      if (!row.solved && !row.gold_defect) failures++;
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
      console.log(`#${o} ${item.id} Z:${z.verdict} ${by ? `solved by ${by} (${(by === 'tiny' ? t : s).accept.kind}: ${(by === 'tiny' ? t : s).accept.paths.join('+')})` : row.gold_defect ? 'gold defect' : `FAILURE ${failures}`}`);
    }
  };
  await Promise.all(Array.from({length: window}, one));
  const all = readJsonl(file).sort((a, b) => a.order - b.order);
  addToPool(all.map(r => r.tiny), items); addToPool(all.filter(r => r.small).map(r => r.small), items);
  fs.writeFileSync(path.join(dir, 'summary.md'), summary(n, all));
  fs.writeFileSync(path.join(STATE, 'curve.md'), curve());
  console.log(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'));
}

/** Run length: problems in draw order up to and including the 5th failure (gold defects are not failures and not counted). */
export function runLength(rows) {
  let f = 0, len = 0;
  for (const r of [...rows].sort((a, b) => a.order - b.order)) { if (r.gold_defect) continue; len++; if (!r.solved && ++f === 5) break; }
  return len;
}

function summary(n, rows) {
  const scored = rows.filter(r => !r.gold_defect);
  const L = [`# Six paths round ${n}`, '', `Run length ${runLength(rows)} (problems to the 5th failure); solved ${scored.filter(r => r.solved).length}/${scored.length} (tiny ${scored.filter(r => r.by === 'tiny').length}, small ${scored.filter(r => r.by === 'small').length}); gold defects ${rows.length - scored.length}.`, ''];
  L.push('| # | problem | Z and tiny paths (verdict) | small paths (verdict) | result |', '|---|---|---|---|---|');
  for (const r of rows) {
    const v = row => (row ? Object.entries(row.paths).map(([k, p]) => `${k}:${p.verdict}`).join(' ') : '-');
    L.push(`| ${r.order} | ${r.id} | Z:${r.z?.verdict ?? '-'} ${v(r.tiny)} | ${v(r.small)} | ${r.gold_defect ? 'gold defect' : r.solved ? `solved by ${r.by} (${(r.by === 'tiny' ? r.tiny : r.small).accept.kind}: ${(r.by === 'tiny' ? r.tiny : r.small).accept.paths.join('+')})` : 'FAILURE'} |`);
  }
  const acc = scored.flatMap(r => [r.tiny, r.small].filter(Boolean).map(x => x.accept).filter(a => a?.status === 'verified'));
  const kinds = k => { const xs = acc.filter(a => (k === 'all' ? true : a.kind === k)); return `${xs.filter(a => isCorrect(a.verdict)).length}/${xs.length}`; };
  L.push('', `Comparisons decided per equivalence check (this process): ${Object.entries(STATS).map(([k, c]) => `${k} ${c}`).join(', ') || 'none'}.`);
  L.push('', `Z (tiny's direct answer) correct ${scored.filter(r => isCorrect(r.z?.verdict)).length}/${scored.length}. Accepted answers, correct/accepted: (a) Z + one symbolic path ${kinds('a')}, (b) two symbolic paths against Z ${kinds('b')}, (a)+(b) both ${kinds('ab')}, all ${kinds('all')}.`);
  const verifiedBy = {};
  for (const r of scored.filter(x => x.solved)) for (const p of (r.by === 'tiny' ? r.tiny : r.small).accept.paths) verifiedBy[`${r.by}:${p}`] = (verifiedBy[`${r.by}:${p}`] ?? 0) + 1;
  L.push('', `Paths in the verified answers: ${Object.entries(verifiedBy).sort().map(([k, c]) => `${k} ${c}`).join(', ') || 'none'}.`);
  return L.join('\n') + '\n';
}

/**
 * The run-length curve and the cumulative solved/attempted ratio, under two rules: tiny-only (owner clarification 2026-10-03: the
 * product goal is tiny; a problem is solved only when tiny's paths, Z included, give an accepted correct answer) and the earlier rule
 * (small on the residue counted too), kept to show how much the earlier curve overstated progress.
 */
export function curve() {
  const L = ['# Six paths: run length per round', '', '| round | run length, tiny only | solved / attempted, tiny only | cumulative, tiny only | run length, small counted (earlier rule) | solved, small counted |', '|---|---|---|---|---|---|'];
  let cs = 0, ca = 0;
  const lens = [];
  for (const d of roundsDone()) {
    const rows = readJsonl(path.join(STATE, d, 'rows.jsonl')).filter(r => !r.gold_defect).sort((a, b) => a.order - b.order);
    const tinyRows = rows.map(r => ({...r, solved: solvedRow(r.tiny)}));
    const s = tinyRows.filter(r => r.solved).length;
    cs += s; ca += rows.length;
    const len = runLength(tinyRows); lens.push([d, len]);
    L.push(`| ${d.slice(6)} | ${len} | ${s}/${rows.length} | ${cs}/${ca} (${ca ? Math.round(100 * cs / ca) : 0}%) | ${runLength(rows)} | ${rows.filter(r => r.solved).length}/${rows.length} |`);
  }
  L.push('', 'Run length, tiny only:', '```', ...lens.map(([d, len]) => `${d.slice(6).padStart(3)} | ${'#'.repeat(len)} ${len}`), '```');
  return L.join('\n') + '\n';
}

/** The failures of a round: every path's status, first unreadable step or the step the path stopped, and its answer vs the gold. */
function failures(items) {
  const rows = readJsonl(path.join(roundDir(Number(args.round)), 'rows.jsonl')).filter(r => !r.solved && !r.gold_defect);
  for (const r of rows) {
    const it = items.get(r.id);
    console.log(`\n=== #${r.order} ${r.id}\nQ: ${it.question}\nGOLD: ${it.answer} | ${JSON.stringify(it.answer_value)}`);
    for (const [tier, row] of [['tiny', r.tiny], ['small', r.small]]) {
      if (!row) continue;
      for (const [k, p] of Object.entries(row.paths)) {
        const firstBad = p.trace.find(t => t.read === null);
        console.log(`  ${tier} ${k}: ${p.verdict}/${p.status} ${p.why ? String(p.why).slice(0, 120) : ''} got ${JSON.stringify(p.profile?.[0] ?? null)}${firstBad ? ` | first unreadable ${firstBad.id}: ${JSON.stringify(firstBad.answer).slice(0, 160)}${firstBad.complaint ? ` (${firstBad.complaint.slice(0, 80)})` : ''}` : ''}`);
        if (args.full) { for (const t of p.trace) console.log(`      - ${t.id}${t.round ? ' (again)' : ''}: ${JSON.stringify(t.answer).slice(0, 400)}`); if (p.program) console.log(`      program: ${p.program.replace(/\n/g, ' ; ')}`); if (p.tree) console.log(`      tree: ${JSON.stringify(p.tree.nodes).slice(0, 400)}`); }
      }
    }
  }
}

/** Every problem solved in an earlier round, run again by the tier that solved it (with Z and the acceptance); a loss is a problem
 *  no longer solved (a problem now recognized as a gold defect is reported apart, not as a loss). */
async function regress(items) {
  const solved = roundsDone().flatMap(d => readJsonl(path.join(STATE, d, 'rows.jsonl'))).filter(r => r.solved);
  const tiny = client({tier: 'tiny', run: 'six-paths-regress-tiny'}), small = client({tier: 'small', run: 'six-paths-regress-small'});
  const losses = [], defects = [], queue = [...solved];
  const one = async () => {
    while (queue.length) {
      const r = queue.shift();
      const item = items.get(r.id);
      const z = await pathZ({item, ctx: context(tiny.chat, 2)});
      const t = await accepted(await score(await runItem(item, Object.keys(r.tiny.paths), tiny.chat), items, small.chat), z, item, small.chat);
      const row = r.by === 'tiny' || solvedRow(t) ? t : await accepted(await score(await runItem(item, Object.keys(r.small.paths), small.chat), items, small.chat), z, item, small.chat, t);
      if (Object.values(row.paths).some(p => p.verdict === 'gold_defect')) { defects.push(r.id); continue; }
      if (!solvedRow(row)) losses.push(`${r.id} (${r.by}: ${Object.entries(row.paths).map(([k, p]) => `${k}:${p.verdict}`).join(' ')}; accept ${row.accept.status})`);
    }
  };
  await Promise.all(Array.from({length: 6}, one));
  const text = `Regression over ${solved.length} solved problems: ${losses.length} losses${losses.length ? `\n${losses.map(x => `- ${x}`).join('\n')}` : ''}${defects.length ? `\nNow gold defects (not counted): ${defects.join(', ')}` : ''}\n`;
  fs.writeFileSync(path.join(STATE, 'regress.md'), text);
  console.log(text);
}

async function main() {
  const cmd = process.argv[2], items = loadItems();
  if (cmd === 'round') await round(items);
  else if (cmd === 'curve') { const t = curve(); fs.writeFileSync(path.join(STATE, 'curve.md'), t); console.log(t); }
  else if (cmd === 'failures') failures(items);
  else if (cmd === 'regress') await regress(items);
  else { console.error('usage: round | curve | failures | regress'); process.exit(2); }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error); process.exit(1); });
