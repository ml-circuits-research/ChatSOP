#!/usr/bin/env node
/**
 * Compare pairs of English texts by their grammatical analyses (DS016 "Analysis comparison").
 *   node tools/eval/analysis-compare.mjs --pairs pairs.jsonl --out verdicts.jsonl [--summary summary.json] [--device cpu|cuda] [--min-f1 0.6] [--synonyms uncertain|accept]
 * `pairs.jsonl`: one {id, a, b} per line (a and b are English texts: the model output and the reference or the input). Every distinct text
 * is parsed once with SymbolicLM (configured Stanza package, cached; see tools/eval/analysis-compare-parses.mjs), then compared with
 * `compareAnalyses` (lib/languages-util/analysis-compare.mjs). Identical strings are `equivalent` without a parse. Output: one
 * {id, verdict, reasons, failedChecks, checks, tripleF1, voiceChange} per pair and a summary {n, equivalent, different, uncertain, ...}.
 * Recipe for the proofing evaluations: cheap symbolic checks first, then this, then the LLM meaning judge only on `different` and `uncertain`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {compareAnalyses, defaultSynonyms, ANALYSIS_COMPARE_VERSION} from '../../lib/languages-util/analysis-compare.mjs';
import {parseTexts} from './analysis-compare-parses.mjs';

export async function comparePairs(pairs, {device, minTripleF1 = 0.6, synonymPolicy = 'uncertain', synonyms = defaultSynonyms()} = {}) {
  const todo = pairs.filter(p => p.a !== p.b);
  const analyses = todo.length ? await parseTexts(todo.flatMap(p => [p.a, p.b]), device ? {device} : {}) : new Map();
  return pairs.map(p => {
    if (p.a === p.b) return {id: p.id, verdict: 'equivalent', reasons: ['identical text'], failedChecks: [], checks: {}, tripleF1: null, voiceChange: []};
    const r = compareAnalyses(analyses.get(p.a), analyses.get(p.b), {minTripleF1, synonymPolicy, synonyms, textA: p.a, textB: p.b});
    return {id: p.id, verdict: r.verdict, reasons: r.reasons, failedChecks: r.failedChecks ?? [], checks: r.checks, tripleF1: r.tripleF1 ? +r.tripleF1Synonym.f1.toFixed(3) : null, voiceChange: r.voiceChange};
  });
}

export const summaryOf = verdicts => {
  const count = v => verdicts.filter(r => r.verdict === v).length;
  const failed = {};
  for (const r of verdicts) for (const c of r.failedChecks ?? []) failed[c] = (failed[c] ?? 0) + 1;
  return {version: ANALYSIS_COMPARE_VERSION, n: verdicts.length, equivalent: count('equivalent'), different: count('different'), uncertain: count('uncertain'), failed_checks: failed, needs_llm_judge: count('different') + count('uncertain')};
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.pairs || !args.out) { console.error('usage: node tools/eval/analysis-compare.mjs --pairs pairs.jsonl --out verdicts.jsonl [--summary summary.json] [--device cpu|cuda] [--min-f1 0.6] [--synonyms uncertain|accept]'); process.exit(2); }
  const pairs = fs.readFileSync(args.pairs, 'utf8').split('\n').filter(Boolean).map((l, i) => { const r = JSON.parse(l); return {id: r.id ?? i, a: String(r.a), b: String(r.b)}; });
  const verdicts = await comparePairs(pairs, {device: args.device, minTripleF1: Number(args['min-f1'] ?? 0.6), synonymPolicy: args.synonyms ?? 'uncertain'});
  fs.mkdirSync(path.dirname(path.resolve(args.out)), {recursive: true});
  fs.writeFileSync(args.out, verdicts.map(v => JSON.stringify(v)).join('\n') + '\n');
  const summary = summaryOf(verdicts);
  if (args.summary) fs.writeFileSync(args.summary, JSON.stringify(summary, null, 1) + '\n');
  console.log(JSON.stringify(summary));
}
