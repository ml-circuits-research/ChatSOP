#!/usr/bin/env node
/**
 * A/B of the PSM and LFM backends on the same book problems (owner, 2026-10-03: before any training, test `tiny` with role prompts and
 * off-the-shelf NL-to-FOL models). Every arm calls a tier of LLMAPIProvider with the same endpoint contract; the converters and the
 * scoring are those of the zero-shot probe (./score.mjs). Offline evaluation harness; book text stays local.
 *
 *   node tools/eval/structure-formalizer/ab.mjs fetch --run ab-1 --ids-from probe-1 [--arms a,b,...]
 *   node tools/eval/structure-formalizer/ab.mjs score --run ab-1
 *
 * Arms
 *   psm:<tier>              the structure tier on the problem text (schema config/formalize/psm-schema-v1.json)
 *   lfm:<tier>[:k]          the formalizer tier on the problem's sentences, k candidates (default 1), no inventory
 *   combo:<psmTier>+<lfmTier>   the formalizer with the inventory rendered from that structure tier's extraction
 * Calls are tagged job:psm-lfm-ab and cached by the proxy except where `--fresh` is given (then timed uncached: cache record).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadItems} from '../books/sample.mjs';
import {extractStructure, formalizeFol} from '../../../lib/formalize/small-models.mjs';
import {sentencesOf} from '../../../lib/formalize/fol/input.mjs';
import {loadSchema, schemaRequest, inventoryText} from '../../../lib/formalize/structure/schema.mjs';
import {registryOf} from '../../../lib/formalize/expression-program.mjs';
import {psmScore, lfmArm} from './score.mjs';
import {goldOf} from './gold.mjs';
import {engines} from './engines.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const run = arg('run', 'ab-1');
const OUT = path.join(ROOT, 'state/structure-formalizer', run);
const DEFAULT_ARMS = ['psm:structure-gliner', 'psm:structure-tiny', 'lfm:formalizer-t5:3', 'lfm:formalizer-t5-3b:3', 'lfm:formalizer-tiny', 'lfm:formalizer-llama-fol', 'combo:structure-tiny+formalizer-tiny', 'combo:structure-gliner+formalizer-tiny'];

async function fetchPhase() {
  const ids = readJsonl(path.join(ROOT, 'state/structure-formalizer', arg('ids-from', 'probe-1'), 'raw.jsonl')).map(r => r.id);
  const items = new Map(loadItems(ROOT).map(i => [i.id, i]));
  const arms = (arg('arms') ?? DEFAULT_ARMS.join(',')).split(',');
  const opts = {purpose: 'job:psm-lfm-ab', run, cache: process.argv.includes('--fresh') ? 'record' : null, timeoutMs: 1_800_000};
  const schema = loadSchema();
  fs.mkdirSync(OUT, {recursive: true});
  const file = path.join(OUT, 'raw.jsonl');
  const done = new Set(readJsonl(file).map(r => `${r.arm}|${r.id}`));
  const psmCache = new Map();
  const psm = async (tier, item) => {
    const k = `${tier}|${item.id}`;
    if (!psmCache.has(k)) psmCache.set(k, await extractStructure({...schemaRequest(schema, item.question), model: tier}, opts));
    return psmCache.get(k);
  };
  for (const arm of arms) {
    const [kind, spec, k] = arm.split(':');
    for (const id of ids) {
      if (done.has(`${arm}|${id}`)) continue;
      const item = items.get(id), units = sentencesOf(item.question);
      let row;
      if (kind === 'psm') { const r = await psm(spec, item); row = {psm: r.ok ? r.body : {error: r.reason}, ms: r.ms, cached: r.cached}; }
      else {
        const [psmTier, lfmTier] = kind === 'combo' ? spec.split('+') : [null, spec];
        const p = psmTier ? await psm(psmTier, item) : null;
        const context = p?.ok ? {inventory: inventoryText(p.body)} : undefined;
        const r = await formalizeFol({model: lfmTier, inputs: units.map(u => u.text), candidates: Number(k ?? 1), ...(context ? {context} : {})}, opts);
        row = {lfm: r.ok ? r.body.results : {error: r.reason}, ms: r.ms + (p?.ok && !p.cached ? p.ms : 0), cached: r.cached, psm: p?.ok ? p.body : null, extra: r.ok ? {dropped: r.body.dropped, unresolved: r.body.unresolved, reasks: r.body.reasks} : null};
      }
      fs.appendFileSync(file, JSON.stringify({arm, id, units, ...row}) + '\n');
      process.stdout.write('.');
    }
    console.log(` ${arm}`);
  }
}

async function scorePhase() {
  const raw = readJsonl(path.join(OUT, 'raw.jsonl'));
  const items = new Map(loadItems(ROOT).map(i => [i.id, i]));
  // Names for linking FOL constants: the arm's own PSM (combo), else GLiNER's extraction of the same problem (as in the probe).
  const gliner = new Map(raw.filter(r => r.arm === 'psm:structure-gliner' && r.psm && !r.psm.error).map(r => [r.id, r.psm]));
  const byArm = new Map();
  for (const r of raw) { if (!byArm.has(r.arm)) byArm.set(r.arm, []); byArm.get(r.arm).push(r); }
  const table = [], rows = [];
  for (const [arm, list] of byArm) {
    const kind = arm.split(':')[0];
    const ms = list.filter(r => !r.cached).map(r => r.ms).sort((a, b) => a - b);
    const sec = ms.length ? (ms[Math.floor(ms.length / 2)] / 1000).toFixed(1) : 'cached';
    if (kind === 'psm') {
      const P = list.map(r => ({id: r.id, ...psmScore(r, items.get(r.id))})).filter(p => !p.error);
      const sum = f => P.reduce((s, p) => s + f(p), 0);
      table.push({arm, n: list.length, qRecall: `${sum(p => p.covered)}/${sum(p => p.numbers)}`, qPrec: `${sum(p => p.digitSpansOnRegistry)}/${sum(p => p.digitSpans)}`, goal: `${P.filter(p => p.goalFound).length}/${P.length}`, sec});
      continue;
    }
    let queries = 0, compiled = 0, executed = 0, correct = 0, wrong = 0, convertedUnits = 0, units = 0;
    for (const r of list) {
      const item = items.get(r.id), registry = registryOf(item.question);
      const names = psmScore({psm: r.psm ?? gliner.get(r.id) ?? {entities: {}}}, item).names ?? new Map();
      const a = await lfmArm(r.units, r.lfm, {registry, names, gold: goldOf(item), item});
      rows.push({arm, id: r.id, ...a});
      if (a.error) continue;
      units += a.units.length; convertedUnits += a.units.filter(u => u.converted).length;
      if (a.queriesInIr) queries++;
      if (a.circuits) compiled++;
      if (a.executed) executed++;
      if (a.verdict === 'correct') correct++;
      if (a.verdict === 'wrong') wrong++;
    }
    table.push({arm, n: list.length, unitsConverted: `${convertedUnits}/${units}`, queries: `${queries}/${list.length}`, compiled, executed, correct, wrong, sec});
  }
  (await engines()).dispose();
  fs.writeFileSync(path.join(OUT, 'results.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  const L = [`# PSM/LFM A/B: ${run} (${new Set(raw.map(r => r.id)).size} book problems)`, '', '## Structure (PSM)', '',
    '| arm | quantity recall | quantity precision | goal found | s/problem (median, uncached) |', '|---|---|---|---|---|'];
  for (const t of table.filter(t => t.qRecall)) L.push(`| ${t.arm} | ${t.qRecall} | ${t.qPrec} | ${t.goal} | ${t.sec} |`);
  L.push('', '## Logic (LFM)', '', '| arm | units converted | problems with a query | compiled | executed | correct | wrong | s/problem |', '|---|---|---|---|---|---|---|---|');
  for (const t of table.filter(t => t.queries)) L.push(`| ${t.arm} | ${t.unitsConverted} | ${t.queries} | ${t.compiled}/${t.n} | ${t.executed} | ${t.correct} | ${t.wrong} | ${t.sec} |`);
  fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
}

const cmd = process.argv[2];
if (cmd === 'fetch') await fetchPhase();
else if (cmd === 'score') await scorePhase();
else { console.error('usage: ab.mjs fetch|score --run <id> [--ids-from probe-1] [--arms ...] [--fresh]'); process.exit(2); }
