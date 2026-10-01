#!/usr/bin/env node
/** Query-surface coverage of SymbolicLM (owner priority 2026-10-01): what the rules emit for each question form.
 *
 *   node tools/eval/query-surface.mjs run --tag before|after [--device auto] [--out eval/reports/current/query-rules]
 *   node tools/eval/query-surface.mjs table --tag before [--vs after] [--set symbolic_english,...] [--primary]   # markdown tables from results-<tag>.jsonl
 *
 * Items: the question-bearing messages of datasets/{symbolic_english,neuro_english}/{train,dev}.jsonl (gold SOP and
 * corpus question type known; the rules are tuned only on these), the decomposition suite and datasets/natural (no
 * gold; measurement only, never used to tune a rule). Forms come from tools/eval/query-surface/forms.mjs (a surface
 * classifier used for tabulation only). Per item: does SymbolicLM emit a query, which modes, and against the gold SOP
 * the query-form agreement (mode, select, measure, rank, compare, quantifier, order, time, scope) and the content
 * agreement (no rules or parser class difference; gold-convention differences are excused as in DS008).
 * Parses are replayed from caches (symbolic-regression parses plus this tool's own); a text not recorded is parsed
 * live with device `auto` (the GPU only when free) and recorded.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {SymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {programShape, diffCategories, classesOf} from '../research/symbolic-layers-diff.mjs';
import {loadFrames, normalizeProgram} from '../../sop/frames.mjs';
import {messageForms, primaryForm, FORMS} from './query-surface/forms.mjs';
import {CachedWorker} from './query-surface/cached-worker.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = 'eval/reports/current/query-rules';
const FILES = [['symbolic_english', 'train', 'datasets/symbolic_english/train.jsonl'], ['symbolic_english', 'dev', 'datasets/symbolic_english/dev.jsonl'],
  ['neuro_english', 'train', 'datasets/neuro_english/train.jsonl'], ['neuro_english', 'dev', 'datasets/neuro_english/dev.jsonl']];

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) { (o._ ??= []).push(argv[i]); continue; } o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  return o;
}

/** The evaluation items (question-bearing messages, deduplicated by message text). */
export function collectItems() {
  const items = [], seen = new Set();
  const add = item => { if (seen.has(item.message)) return; const {questions, forms} = messageForms(item.message); if (!questions.length) return; seen.add(item.message); items.push({...item, forms, primary: primaryForm(forms)}); };
  for (const [set, split, file] of FILES) for (const r of readJsonlShardedSync(path.join(ROOT, file))) add({id: r.id, set, split, tuning: true, message: r.message, qtype: r.source?.question_type ?? null, gold: r.gold_sop ?? null, stored: r.sop});
  const decomposition = path.join(ROOT, 'eval/suites/decomposition/test.jsonl');
  if (fs.existsSync(decomposition)) for (const r of readJsonlShardedSync(decomposition)) add({id: r.id, set: 'decomposition', split: 'test', tuning: false, message: r.message});
  const natural = path.join(ROOT, 'datasets/natural/messages.jsonl');
  if (fs.existsSync(natural)) for (const r of readJsonlShardedSync(natural)) add({id: r.id, set: 'natural', split: 'natural', tuning: false, message: r.message});
  return items;
}

let frames = null;
const normalized = sop => { try { return normalizeProgram(sop, (frames ??= loadFrames())).sop; } catch { return null; } };
const sigOf = q => JSON.stringify([q.mode, q.select > 0, q.measure, q.rank, q.except, q.compare, q.fragment, q.quantifier, q.order, q.time]);
export const signature = shape => (shape?.queries ?? []).map(sigOf).sort().join(';');

/** Measures of one item given SymbolicLM's result. */
export function measure(item, result) {
  const sop = result.sop ?? '';
  const shape = programShape(sop);
  const queries = shape?.queries ?? [];
  const out = {id: item.id, set: item.set, forms: item.forms, primary: item.primary, qtype: item.qtype, outcome: result.outcome, valid: Boolean(result.valid), emits_query: queries.length > 0, modes: queries.map(q => q.mode ?? 'select'), unparsed: sop.includes(' unparsed'), sop};
  if (item.gold) {
    const gold = programShape(item.gold);
    out.gold_modes = (gold?.queries ?? []).map(q => q.mode ?? 'select');
    out.form_ok = Boolean(shape) && signature(shape) === signature(gold);
    try { const cats = diffCategories(sop, item.gold, {executed: false, message: item.message}); const classes = classesOf(cats); out.content_ok = !classes.some(c => c !== 'C' && c !== 'E'); out.classes = classes; out.categories = cats.map(c => c.cat); }
    catch { out.content_ok = false; out.classes = ['?']; out.categories = []; }
    out.strict = sop.trim() === item.gold.trim();
    // the host's frame normalization (sop/frames.mjs) maps relation wording and role placement to one form: a difference it removes is a gold convention (DS008)
    out.frame_ok = out.strict || (normalized(sop) !== null && normalized(sop) === normalized(item.gold));
    if (out.frame_ok) out.content_ok = true;
  }
  return out;
}

async function run(o) {
  const tag = o.tag ?? 'run';
  const outDir = path.resolve(ROOT, o.out ?? OUT);
  fs.mkdirSync(outDir, {recursive: true});
  let items = collectItems();
  const worker = new CachedWorker({files: [path.join(ROOT, 'eval/reports/current/symbolic-regression/parses.json')], own: path.join(outDir, 'parses.json'), device: o.device ?? 'auto'});
  const lm = new SymbolicLM({worker, lexicons: undefined});
  await lm.start();
  const english = items.filter(i => i.set !== 'natural' || lm.identify(i.message).language === 'en');
  console.error(`natural questions: ${items.filter(i => i.set === 'natural').length}, English: ${english.filter(i => i.set === 'natural').length}`);
  items = english;
  const results = [];
  try {
    const chunk = 64;
    for (let i = 0; i < items.length; i += chunk) {
      const part = items.slice(i, i + chunk);
      try { await lm.prefetch(part.map(x => x.message), {language: 'auto', route: 'direct'}); } catch { /* single requests follow */ }
      for (const item of part) {
        let result;
        try { result = await lm.analyze(item.message, {route: 'direct', language: 'auto'}); } catch (error) { result = {sop: '', valid: false, outcome: 'crash', error: String(error.message).slice(0, 160)}; }
        results.push(measure(item, result));
      }
      lm.prefetched.clear();
      if (process.stderr.isTTY) process.stderr.write(`\r${Math.min(i + chunk, items.length)}/${items.length} (live parses ${worker.misses})`);
    }
  } finally { await lm.stop(); }
  fs.writeFileSync(path.join(outDir, `results-${tag}.jsonl`), results.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'items.jsonl'), items.map(({gold, stored, ...rest}) => JSON.stringify(rest)).join('\n') + '\n');
  console.log(`\n${results.length} items -> ${path.join(OUT, `results-${tag}.jsonl`)}; ${worker.misses} texts parsed live on ${worker.live?.device ?? 'no worker'}`);
}

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : '-');
/** Rows of the per-form table: {form, n, emits, form_ok, content_ok, strict, gold_n}. */
export function tableRows(results, {byPrimary = false} = {}) {
  const rows = [];
  for (const form of FORMS) {
    const sel = results.filter(r => (byPrimary ? r.primary === form : r.forms.includes(form)));
    const gold = sel.filter(r => 'form_ok' in r);
    rows.push({form, n: sel.length, emits: sel.filter(r => r.emits_query).length, gold_n: gold.length, form_ok: gold.filter(r => r.form_ok).length, content_ok: gold.filter(r => r.content_ok).length, strict: gold.filter(r => r.frame_ok).length,
      fail: sel.filter(r => !r.emits_query || r.unparsed || !r.valid).length});
  }
  return rows;
}

function table(o) {
  const dir = path.resolve(ROOT, o.out ?? OUT);
  // the forms are recomputed from the message, so a classifier change applies to results recorded earlier
  const messages = new Map(fs.readFileSync(path.join(dir, 'items.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id + '|' + r.set, r.message]));
  const read = tag => fs.readFileSync(path.join(dir, `results-${tag}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !o.set || String(o.set).split(',').includes(r.set)).map(r => { const forms = messageForms(messages.get(r.id + '|' + r.set) ?? '').forms; return {...r, forms, primary: primaryForm(forms)}; });
  const a = tableRows(read(o.tag ?? 'before'), {byPrimary: Boolean(o.primary)});
  const b = o.vs ? tableRows(read(o.vs), {byPrimary: Boolean(o.primary)}) : null;
  const lines = [`| form | n | emits query | no query / unparsed | query-form = gold | content ok (gold) | = gold after frames |${b ? ' after: no query/unparsed | after: form | after: content | after: strict |' : ''}`, `| --- | ---: | ---: | ---: | ---: | ---: | ---: |${b ? ' ---: | ---: | ---: | ---: |' : ''}`];
  a.forEach((r, i) => {
    const x = b?.[i];
    lines.push(`| ${r.form} | ${r.n} | ${pct(r.emits, r.n)} | ${r.fail} | ${pct(r.form_ok, r.gold_n)} (${r.gold_n}) | ${pct(r.content_ok, r.gold_n)} | ${pct(r.strict, r.gold_n)} |${x ? ` ${x.fail} | ${pct(x.form_ok, x.gold_n)} | ${pct(x.content_ok, x.gold_n)} | ${pct(x.strict, x.gold_n)} |` : ''}`);
  });
  console.log(lines.join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  const cmd = o._?.[0];
  (cmd === 'run' ? run(o) : cmd === 'table' ? Promise.resolve(table(o)) : Promise.reject(Error('usage: run|table'))).catch(e => { console.error(e.stack); process.exitCode = 1; });
}
