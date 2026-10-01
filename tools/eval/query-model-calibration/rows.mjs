/**
 * The questions of the calibration: the query-forms dev set (gold = the oracle's answer to the gold circuit, tools/eval/query-forms/gold.mjs)
 * and the English questions of eval/world-kb/questions.json (gold = the expected entities, lenient: any expected entity among the answers). Never a sealed
 * KBQA row. `stage` picks 50 rows stratified by form with a fixed seed, or all.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
export const SEED = 20261001;
export const DEV_PATH = path.join(ROOT, 'datasets_sources/query-forms/dev.jsonl');
const SKIP_WORLD = new Set(['q11', 'q28']); // gold is not an answer set ("population", "lower_bound")
const WORLD_FORM = {where: 'one_hop', who: 'one_hop', what: 'one_hop', when: 'one_hop', count: 'count', compare: 'comparative', exists: 'one_hop', join: 'multihop', compute: 'measure'};

export function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function loadRows({dev = DEV_PATH} = {}) {
  const rows = [];
  if (fs.existsSync(dev)) for (const line of fs.readFileSync(dev, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    rows.push({id: r.id, set: 'dev', form: r.form, question: r.question, gold: r.gold, gold_mode: 'equal'});
  }
  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/world-kb/questions.json'), 'utf8'));
  for (const q of world) {
    if (q.lang !== 'en' || SKIP_WORLD.has(q.id)) continue;
    const bool = q.expect.length === 1 && ['true', 'false'].includes(q.expect[0]);
    const num = q.id === 'q30';
    rows.push({id: 'wk-' + q.id, set: 'world-kb', form: WORLD_FORM[q.kind] ?? 'one_hop', question: q.q, gold: bool ? q.expect[0] === 'true' : q.expect.map(e => (/^\d+$/.test(e) ? Number(e) : e)), gold_mode: bool ? 'equal' : 'any'});
  }
  return rows;
}

/** 50 rows, round-robin over the forms in a seeded order, or all rows. */
export function stageRows(rows, stage) {
  if (stage === 'all') return rows;
  const n = Number(stage);
  const rand = mulberry(SEED);
  const byForm = new Map();
  for (const r of rows) (byForm.get(r.form) ?? byForm.set(r.form, []).get(r.form)).push(r);
  const pools = [...byForm.keys()].sort().map(f => { const a = [...byForm.get(f)].sort((x, y) => x.id.localeCompare(y.id)); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; });
  const out = [];
  while (out.length < Math.min(n, rows.length)) { let took = false; for (const p of pools) if (p.length && out.length < n) { out.push(p.shift()); took = true; } if (!took) break; }
  return out;
}
