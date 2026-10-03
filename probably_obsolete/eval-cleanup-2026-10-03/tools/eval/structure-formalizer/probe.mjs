#!/usr/bin/env node
/**
 * Zero-shot probe of the PSM (GLiNER2.5 base, tier `structure`) and the LFM (T5-base NL-to-FOL, tier `formalizer`) on book problems
 * (experiments/proposal/structure-and-formalizer-models.md). Offline evaluation harness, never the product path; book text stays
 * local (datasets_sources/, state/).
 *
 *   node tools/eval/structure-formalizer/probe.mjs fetch --run <id> [--n 30] [--seed psm-lfm-1] [--candidates 3] [--schema file]
 *        [--ids-from <run>]
 *        samples n scorable book items stratified by book (never a seen item; marks them seen), calls both tiers through TinyAgent
 *        (purpose job:psm-lfm-probe, cached), writes state/structure-formalizer/<run>/raw.jsonl
 *   node tools/eval/structure-formalizer/probe.mjs score --run <id>
 *        converts deterministically (PSM JSON → SOP-IR, FOL → SOP-IR → SOP Lang), executes on the engines, scores against the book
 *        answers, writes results.jsonl and summary.md
 *   node tools/eval/structure-formalizer/probe.mjs speed --run <id>
 *        times both roles through TinyAgent on the first 10 problems, uncached (cache mode record)
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadItems, loadSeen, sampleItems, markSeen} from '../books/sample.mjs';
import {goldOf} from './gold.mjs';
import {extractStructure, formalizeFol} from '../../../lib/formalize/small-models.mjs';
import {sentencesOf} from '../../../lib/formalize/fol/input.mjs';
import {loadSchema, schemaRequest, sketchSentences} from '../../../lib/formalize/structure/schema.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const arg = (name, dflt = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const cmd = process.argv[2];
const run = arg('run', 'probe-1');
const OUT = path.join(ROOT, 'state/structure-formalizer', run);
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const opts = {purpose: 'job:psm-lfm-probe', run};

async function fetchPhase() {
  const n = Number(arg('n', 30)), seed = arg('seed', 'psm-lfm-1'), k = Number(arg('candidates', 3));
  fs.mkdirSync(OUT, {recursive: true});
  const items = loadItems(ROOT).filter(i => goldOf(i));
  // --ids-from <run>: the same items as an earlier run (a variant of the schema or the candidates), not sampled or marked again.
  const from = arg('ids-from');
  const picked = from ? readJsonl(path.join(ROOT, 'state/structure-formalizer', from, 'raw.jsonl')).map(r => items.find(i => i.id === r.id)) : sampleItems(items, {n, seed, seen: loadSeen(ROOT)});
  const schema = loadSchema(arg('schema') ? path.resolve(arg('schema')) : undefined);
  const rows = [];
  for (const item of picked) {
    const psm = await extractStructure(schemaRequest(schema, item.question), opts);
    const units = sentencesOf(item.question);
    const lfm = await formalizeFol({inputs: units.map(u => u.text), candidates: k}, opts);
    const sketch = psm.ok ? sketchSentences(psm.body, item.question) : [];
    const lfmSketch = sketch.length ? await formalizeFol({inputs: sketch.map(u => u.text), candidates: 1}, opts) : {ok: false, reason: 'no sketch'};
    rows.push({id: item.id, book: item.book, units, psm: psm.ok ? psm.body : {error: psm.reason}, psm_ms: psm.ms,
      lfm: lfm.ok ? lfm.body.results : {error: lfm.reason}, lfm_ms: lfm.ms, sketch, lfm_sketch: lfmSketch.ok ? lfmSketch.body.results : {error: lfmSketch.reason}});
    process.stdout.write('.');
  }
  fs.writeFileSync(path.join(OUT, 'raw.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  if (!from) markSeen(ROOT, picked.map(i => i.id), `psm-lfm-${run}`);
  console.log(`\n${rows.length} items → ${path.relative(ROOT, OUT)}/raw.jsonl`);
}

async function speedPhase() {
  const raw = readJsonl(path.join(OUT, 'raw.jsonl'));
  // The roles through TinyAgent with the cache bypassed (record), so each call is timed on the model.
  const timed = {...opts, cache: 'record'};
  const schema = loadSchema();
  const psm = [], lfm = [];
  let tokens = 0, lfmMs = 0;
  for (const r of raw.slice(0, 10)) {
    const item = r.units.map(u => u.text).join(' ');
    psm.push((await extractStructure(schemaRequest(schema, item), timed)).ms);
    const f = await formalizeFol({inputs: r.units.map(u => u.text), candidates: 1}, timed);
    lfm.push(f.ms); lfmMs += f.ms; tokens += f.ok ? f.body.results.reduce((s, x) => s + (x.tokens ?? 0), 0) : 0;
  }
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const out = {psm_ms_median: med(psm), lfm_ms_per_problem_median: med(lfm), lfm_tokens_per_s: Math.round(tokens / (lfmMs / 1000)), problems: psm.length};
  fs.writeFileSync(path.join(OUT, 'speed.json'), JSON.stringify(out, null, 2));
  console.log(out);
}

if (cmd === 'fetch') await fetchPhase();
else if (cmd === 'score') await (await import('./score.mjs')).scorePhase({OUT, ROOT});
else if (cmd === 'speed') await speedPhase();
else { console.error('usage: probe.mjs fetch|score|speed --run <id>'); process.exit(2); }
