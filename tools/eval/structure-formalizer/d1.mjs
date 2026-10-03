#!/usr/bin/env node
/**
 * D1 of train-psm-lfm-v1: teacher data for the PSM and the LFM (status/preregistrations/train-psm-lfm-v1.json). One process:
 *   1. the LLMJobs job train-data-d1 runs with teacher `small` and then with teacher `medium` (jobs/train-data-d1/{small,medium};
 *      calls tagged job:train-data-d1, budgets registered with the proxy; the format checks of jobs/train-data-d1/checks.mjs);
 *   2. deterministic verification of every problem both teachers answered in the right format:
 *      gold      each teacher's circuits execute (product engines) to the book answer
 *      agree     the two teachers' answers are the same on the problem's own numbers (no perturbation: owner decision 2026-10-03;
 *                the converters refuse statically a circuit whose answer does not depend on the problem's numbers)
 *      psm       both teachers' goal spans overlap; every registry number the chosen teacher's circuits use lies in one of its quantity
 *                spans (the chosen teacher: small when it passes, else medium)
 *      kept = gold (both) AND agree AND psm
 *   3. verified.jsonl (local, book-derived: never in git) and summary.md in state/structure-formalizer/d1/<label>/; the problems both
 *      teachers formalized are marked seen (datasets_sources/books/eval/seen.jsonl), so no later evaluation samples them.
 *
 *   node tools/eval/structure-formalizer/d1.mjs run --stage pilot [--label d1-pilot]
 *   node tools/eval/structure-formalizer/d1.mjs verify --small <run-id> --medium <run-id> [--label x]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadJob, runJob, RunStore, loadConfig, liveTiers} from '../../../LLMJobs/lib/index.mjs';
import {parseFol} from '../../../lib/formalize/fol/parse.mjs';
import {folToIr} from '../../../lib/formalize/fol/to-ir.mjs';
import {compileIr, slug} from '../../../lib/formalize/fol/to-sop.mjs';
import {registryOf} from '../../../lib/formalize/expression-program.mjs';
import {numbersWithOffsets} from '../../../lib/formalize/structure/to-ir.mjs';
import {markSeen, loadItems} from '../books/sample.mjs';
import {goldOf} from './gold.mjs';
import {engines} from './engines.mjs';
import {unitsOf} from '../../../jobs/train-data-d1/checks.mjs';
import {sentencesOf} from '../../../lib/formalize/fol/input.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const JOB = path.join(ROOT, 'jobs/train-data-d1');
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);

async function runTeacher(teacher, stage) {
  const config = loadConfig({jobDir: path.join(JOB, teacher)});
  const job = await loadJob(path.join(JOB, teacher), {config, live: await liveTiers(config.endpoint)});
  const store = new RunStore({root: config.dataDir});
  const r = await runJob(job, {stage, store, log: m => process.stderr.write(`[d1 ${teacher}] ${m}\n`)});
  console.log(`${teacher}: ${r.status} ${r.run}\n${r.summary}`);
  return {run: r.run, dir: r.dir, status: r.status};
}

// ---------------------------------------------------------------- verification
const fold = s => String(s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const near = (a, b) => Math.abs(a - b) <= Math.max(1e-9, 1e-6 * Math.abs(b));
const sameValue = (a, b) => {
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'number') return near(a, b);
  if (Array.isArray(a) && Array.isArray(b)) { const x = new Set(a.map(fold)), y = new Set(b.map(fold)); return x.size === y.size && [...x].every(v => y.has(v)); }
  return a === b;
};
const sameVector = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));

/** The teacher's circuits for one problem: {circuits, names, usedNumbers} (null when they do not compile; checks already passed). */
function circuitsOf(item, value) {
  const question = String(item.question);
  const {units} = unitsOf(value.fol, sentencesOf(question).length);
  const names = new Map(value.psm.spans.filter(s => s.label === 'entity').map(s => [slug(s.text), s.text]));
  const registry = registryOf(question);
  const {circuits, rejected} = compileIr(folToIr(units), {registry, names});
  if (rejected.length || !circuits.length) return null;
  // Registry numbers a circuit uses: program references vK, and numbers stated in logic facts equal to a registry number.
  const used = new Set();
  for (const c of circuits) {
    for (const l of c.program ?? []) for (const m of l.text.matchAll(/\bv(\d+)\b/g)) used.add(Number(m[1]));
    if (!c.program) for (const m of c.sop.matchAll(/^\s*role \S+ (-?\d+(?:\.\d+)?)\s*$/gm)) for (const v of registry) if (v.value === Number(m[1])) used.add(v.index);
  }
  return {circuits, registry, usedNumbers: [...used]};
}

async function answersOn(cs) {
  const w = await engines();
  const out = [];
  for (const c of cs.circuits) {
    const sop = c.sop;
    const p = await w.run(sop, c.literals);
    out.push(p.status === 'error' ? null : c.decode(p));
  }
  return out;
}

/** Whether a teacher's answers (one per query, in order) give the book answer. */
function matchesGold(item, answers) {
  const g = goldOf(item);
  const vals = answers.filter(v => v !== null && v !== undefined);
  if (!g || !vals.length) return false;
  if (g.kind === 'yes_no') { const v = vals.find(x => typeof x === 'boolean') ?? (Array.isArray(vals[0]) ? vals[0].length > 0 : null); return v === g.values[0]; }
  if (g.kind === 'number') {
    const pct = /%|percent/i.test(item.answer ?? '');
    const nums = vals.filter(v => typeof v === 'number');
    return g.values.every(x => nums.some(h => Math.abs(h - x) <= Math.max(1e-9, 0.005 * Math.abs(x)) || (pct && Math.abs(h * 100 - x) <= Math.max(1e-9, 0.005 * Math.abs(x)))));
  }
  const names = vals.flatMap(v => (Array.isArray(v) ? v : [v])).filter(v => typeof v === 'string').map(fold);
  const want = g.values.map(fold);
  return want.length === new Set(names).size && want.every(x => names.includes(x));
}

const spansOverlap = (a, b) => a.some(x => b.some(y => x.start < y.end && y.start < x.end));

function psmOk(item, value, usedNumbers) {
  const nums = numbersWithOffsets(String(item.question));
  const q = value.psm.spans.filter(s => s.label === 'quantity' && s.start >= 0);
  const missing = usedNumbers.filter(k => { const n = nums.find(x => x.index === k); return !n || !q.some(s => s.start <= n.start && n.end <= s.end); });
  return {ok: !missing.length, missing};
}

async function verify(smallRun, mediumRun, label) {
  const config = loadConfig({jobDir: path.join(JOB, 'small')});
  const dirOf = run => path.join(config.dataDir, 'train-data-d1', run);
  const last = rows => new Map(rows.map(r => [r.id, r]));
  const A = last(readJsonl(path.join(dirOf(smallRun), 'accepted.jsonl'))), B = last(readJsonl(path.join(dirOf(mediumRun), 'accepted.jsonl')));
  const settledA = new Set([...A.keys(), ...readJsonl(path.join(dirOf(smallRun), 'rejected.jsonl')).map(r => r.id)]);
  const settledB = new Set([...B.keys(), ...readJsonl(path.join(dirOf(mediumRun), 'rejected.jsonl')).map(r => r.id)]);
  const items = new Map(loadItems(ROOT).map(i => [i.id, i]));
  const ids = [...settledA].filter(id => settledB.has(id));
  const rows = [], c = {problems: ids.length, formatA: 0, formatB: 0, goldA: 0, goldB: 0, both: 0, bothGold: 0, agree: 0, psm: 0, kept: 0, noNumbers: 0};
  for (const id of ids) {
    const item = items.get(id);
    const a = A.get(id)?.value, b = B.get(id)?.value;
    if (a) c.formatA++;
    if (b) c.formatB++;
    const ca = a ? circuitsOf(item, a) : null, cb = b ? circuitsOf(item, b) : null;
    const ansA = ca ? await answersOn(ca, null) : null, ansB = cb ? await answersOn(cb, null) : null;
    const gA = ansA ? matchesGold(item, ansA) : false, gB = ansB ? matchesGold(item, ansB) : false;
    if (gA) c.goldA++;
    if (gB) c.goldB++;
    const row = {id, book: item.book, format: {small: Boolean(a), medium: Boolean(b)}, gold: {small: gA, medium: gB}, answers: {small: ansA, medium: ansB}};
    if (ca && cb) c.both++;
    if (gA && gB) {
      c.bothGold++;
      const registry = ca.registry;
      // No perturbation (owner decision 2026-10-03): agreement on the problem's own numbers; the static data-dependency check is in
      // the converters (a written final number is refused before execution).
      const agree = sameVector(ansA, ansB);
      const conditions = [];
      if (!registry.length) c.noNumbers++;
      row.perturbed = conditions;
      row.agree = agree;
      if (agree) c.agree++;
      const pA = psmOk(item, a, ca.usedNumbers), pB = psmOk(item, b, cb.usedNumbers);
      const goals = s => s.psm.spans.filter(x => x.label === 'goal' && x.start >= 0);
      const goalsOverlap = spansOverlap(goals(a), goals(b));
      const chosen = pA.ok ? 'small' : pB.ok ? 'medium' : null;
      row.psm = {goalsOverlap, small: pA, medium: pB, chosen};
      if (goalsOverlap && chosen) c.psm++;
      if (agree && goalsOverlap && chosen) {
        c.kept++;
        row.kept = true;
        row.example = {id, book: item.book, question: item.question, teacher: chosen, psm: (chosen === 'small' ? a : b).psm, fol: (chosen === 'small' ? a : b).fol,
          other: {teacher: chosen === 'small' ? 'medium' : 'small', psm: (chosen === 'small' ? b : a).psm, fol: (chosen === 'small' ? b : a).fol}};
      }
    }
    rows.push(row);
  }
  (await engines()).dispose();
  const out = path.join(ROOT, 'state/structure-formalizer/d1', label);
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'verification.jsonl'), rows.map(r => JSON.stringify({...r, example: undefined})).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'verified.jsonl'), rows.filter(r => r.kept).map(r => JSON.stringify(r.example)).join('\n') + (c.kept ? '\n' : ''));
  const cost = run => { const f = path.join(dirOf(run), 'cost.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).total : null; };
  const cs = cost(smallRun), cm = cost(mediumRun);
  const pct = (x, n) => (n ? `${Math.round(100 * x / n)}%` : 'n/a');
  const byBook = {};
  for (const r of rows) { const e = (byBook[r.book] ??= [0, 0]); e[1]++; if (r.kept) e[0]++; }
  const summary = [`# D1 ${label}: teacher data for PSM/LFM (small run ${smallRun}, medium run ${mediumRun})`, '',
    `- problems settled by both teachers: ${c.problems}`,
    `- format accepted (converters compile): small ${c.formatA} (${pct(c.formatA, c.problems)}), medium ${c.formatB} (${pct(c.formatB, c.problems)})`,
    `- circuits execute to the book answer: small ${c.goldA} (${pct(c.goldA, c.problems)}), medium ${c.goldB} (${pct(c.goldB, c.problems)}); both ${c.bothGold}`,
    `- both gold and the teachers agree on the problem's own numbers: ${c.agree} (${c.noNumbers} without registry numbers)`,
    `- PSM criteria (goal spans overlap, used numbers inside quantity spans) among those both gold: ${c.psm}`,
    `- **verified (kept): ${c.kept}/${c.problems} = ${pct(c.kept, c.problems)}**; by book: ${Object.entries(byBook).map(([k, [x, n]]) => `${k} ${x}/${n}`).join(', ')}`,
    `- cost: small ${cs ? `${cs.calls} calls, ${(cs.credits ?? 0).toFixed(1)} plan credits` : 'n/a'}; medium ${cm ? `${cm.calls} calls, ${(cm.usd ?? 0).toFixed(4)} USD` : 'n/a'}`].join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'summary.md'), summary);
  markSeen(ROOT, ids, `train-data-d1-${label}`);
  console.log(summary);
  return c;
}

const cmd = process.argv[2];
if (cmd === 'run') {
  const stage = arg('stage', 'pilot'), label = arg('label', `d1-${stage}`);
  const s = await runTeacher('small', stage);
  const m = await runTeacher('medium', stage);
  await verify(s.run, m.run, label);
} else if (cmd === 'verify') await verify(arg('small'), arg('medium'), arg('label', 'd1-verify'));
else { console.error('usage: d1.mjs run --stage pilot|all [--label x] | verify --small <run> --medium <run> [--label x]'); process.exit(2); }
