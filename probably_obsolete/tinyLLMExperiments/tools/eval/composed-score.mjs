#!/usr/bin/env node
/** Scorer of the composed evaluation suites (DS008 "Composed evaluation suites", DS016 "Composed metrics").
 *
 *   node tools/eval/composed-score.mjs symbolic [--kinds K1,K3,K5] [--stages 100,300] [--suite-root eval/suites] [--out-dir DIR]
 *   node tools/eval/composed-score.mjs rewrite --kind K2|K3|K4|K5 --mode paragraph|sentence [--gate symbolic|clean-english]
 *        [--splitter host|stanza] [--e2e true|false] [--max-stage N] (--endpoint http://127.0.0.1:PORT [--model proofreader] | --command "CMD" | identity) --name NAME [--stages 100,300]
 *   node tools/eval/composed-score.mjs decompose [--dataset neuro_english|bad_english] (--endpoint URL | --command CMD | identity) --name NAME   # K6

 *
 * `symbolic` scores SymbolicLM alone on K1, K3 and K5 (does it still pass known forms when there are many); `rewrite` scores any
 * text-to-text rewriter on the other kinds and on K3/K5 (does it leave clean text untouched, repair the bad sentences, drop or add
 * nothing, keep the order). Cases run in nested stratified stages (default 100, 300, full); each stage boundary writes the summary
 * with Wilson intervals, so a run can be stopped early by the preregistered rules. Records are appended to
 * <out-dir>/runs/<name>__<kind>__<mode>.jsonl and a re-run skips finished ids.
 * No training happens here; rewriters are called as black boxes.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../lib/jsonl-shards.mjs';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {openLm} from './composed/lm.mjs';
import {scoreCase, summarize} from './composed/score-symbolic.mjs';
import {scoreRewrite, summarizeRewrite, GATES} from './composed/score-rewrite.mjs';
import {scoreDecomposition, summarizeDecomposition} from './composed/score-decomposition.mjs';
import {rewriterFromArgs, cachedRewriter} from './composed/rewriters.mjs';
import {stagesOf} from './composed/stats.mjs';

const KIND_DATASET = {K1: 'symbolic_english', K3: 'symbolic_english', K5: 'symbolic_english', K2: 'neuro_english', K4: 'bad_english', K6: 'neuro_english'};
const parseArgs = argv => { const o = {_: []}; for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(argv[i]); } return o; };

export function loadCases(kind, suiteRoot, dataset = KIND_DATASET[kind]) {
  const file = path.join(suiteRoot, dataset, 'test-composed.jsonl');
  if (!jsonlExists(file)) throw Error(`missing ${file}; build it with node tools/eval/composed-suites.mjs`);
  return readJsonlShardedSync(file).filter(r => r.kind === kind);
}

const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);

async function runStaged({cases, recordsFile, summaryFile, stages, one, summarizeFn, label, maxStage = Infinity}) {
  fs.mkdirSync(path.dirname(recordsFile), {recursive: true});
  const done = new Map(readJsonl(recordsFile).map(r => [r.id, r]));
  const ordered = stagesOf(cases, r => r.stratum ?? String(r.n_components), stages, `stages:${label}`);
  const fd = fs.openSync(recordsFile, 'a');
  const summaries = [];
  for (const stage of ordered) {
    for (const row of stage.items) {
      if (done.has(row.id)) continue;
      const rec = await one(row);
      done.set(row.id, rec);
      fs.writeSync(fd, JSON.stringify(rec) + '\n');
    }
    const records = stage.items.map(r => done.get(r.id));
    summaries.push({stage: stage.size, ...summarizeFn(records)});
    fs.writeFileSync(summaryFile, JSON.stringify({label, generated_at: new Date().toISOString(), stages: summaries}, null, 1) + '\n');
    console.log(`${label}: stage ${stage.size}/${cases.length} done`);
    if (stage.size >= maxStage) break;
  }
  fs.closeSync(fd);
  return summaries;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const o = parseArgs(rest);
  const suiteRoot = path.resolve(ROOT, o['suite-root'] ?? 'eval/suites');
  const outDir = path.resolve(ROOT, o['out-dir'] ?? 'eval/reports/current/composed-eval');
  const stages = String(o.stages ?? '100,300').split(',').map(Number).filter(Boolean);
  const maxStage = o['max-stage'] ? Number(o['max-stage']) : Infinity;
  const lm = await openLm({cacheDir: path.join(outDir, 'cache')});
  try {
    if (command === 'symbolic') {
      for (const kind of String(o.kinds ?? 'K1,K3,K5').split(',')) {
        const cases = loadCases(kind, suiteRoot);
        await runStaged({cases, recordsFile: path.join(outDir, 'runs', `symbolic-lm__${kind}.jsonl`), summaryFile: path.join(outDir, `symbolic-lm__${kind}.summary.json`), stages, one: row => scoreCase(row, lm), summarizeFn: summarize, label: `symbolic-lm ${kind}`, maxStage});
      }
    } else if (command === 'rewrite') {
      const kind = o.kind, mode = o.mode ?? 'paragraph';
      const {name, fn: raw} = rewriterFromArgs(o);
      const fn = raw.identity ? raw : cachedRewriter(raw, path.join(outDir, 'cache', `rewriter-${String(o.name ?? name).replace(/[^A-Za-z0-9._-]+/g, '_')}.jsonl`));
      const gate = (GATES[o.gate ?? (kind === 'K4' ? 'clean-english' : 'symbolic')])(lm);
      const cases = loadCases(kind, suiteRoot);
      const tokensFile = path.join(suiteRoot, KIND_DATASET[kind], 'test-composed.tokens.json');
      const tokens = fs.existsSync(tokensFile) ? JSON.parse(fs.readFileSync(tokensFile, 'utf8')).cases : {};
      const slug = String(o.name ?? name).replace(/[^A-Za-z0-9._-]+/g, '_');
      await runStaged({cases, recordsFile: path.join(outDir, 'runs', `${slug}__${kind}__${mode}.jsonl`), summaryFile: path.join(outDir, `${slug}__${kind}__${mode}.summary.json`), stages,
        one: row => scoreRewrite(row, {mode, rewriter: fn, gate, splitter: o.splitter ?? 'host', lm, tokens: tokens[row.id] ?? null, endToEnd: o.e2e ? o.e2e !== 'false' : kind !== 'K4'}), summarizeFn: summarizeRewrite, label: `${slug} ${kind} ${mode}`, maxStage});
    } else if (command === 'decompose') {
      const dataset = o.dataset ?? 'neuro_english';
      const {name, fn: raw} = rewriterFromArgs(o);
      const fn = raw.identity ? raw : cachedRewriter(raw, path.join(outDir, 'cache', `rewriter-${String(o.name ?? name).replace(/[^A-Za-z0-9._-]+/g, '_')}.jsonl`));
      const slug = String(o.name ?? name).replace(/[^A-Za-z0-9._-]+/g, '_');
      await runStaged({cases: loadCases('K6', suiteRoot, dataset), recordsFile: path.join(outDir, 'runs', `${slug}__K6-${dataset}.jsonl`), summaryFile: path.join(outDir, `${slug}__K6-${dataset}.summary.json`), stages, one: row => scoreDecomposition(row, {rewriter: fn, lm, mode: o.mode === 'sentence' ? 'sentence' : 'whole'}), summarizeFn: summarizeDecomposition, label: `${slug} K6 ${dataset}`, maxStage});
    } else { console.error('usage: composed-score.mjs symbolic|rewrite|decompose ...'); process.exitCode = 2; }
  } finally { await lm.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(process.exitCode ?? 0), error => { console.error(error); process.exit(1); });
