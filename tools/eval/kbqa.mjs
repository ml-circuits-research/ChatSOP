#!/usr/bin/env node
/**
 * The end-to-end knowledge-base question-answering evaluation (KBQA, experiment eval-kbqa-v1): public benchmark questions answered from
 * Wikidata facts through the product chain, in process (no server, no port):
 *   question -> SymbolicLM (lib/symbolic-lm) -> Agent (server/agent.mjs: admission, KnowledgeLinker sop/linking.mjs + sop/copula-linker.mjs,
 *   the reasoning reference route over the base memory kbqa-<name>) -> answer -> compared with the gold.
 *
 *   node tools/eval/kbqa.mjs suites   [--suite mintaka|lcquad2|simplequestions|qald10|all] [--size 1000]   # sealed eval/suites/kbqa-<name>/test.jsonl
 *   node tools/eval/kbqa.mjs build    --suite <name> [--stage 100|300|all]   # Wikidata slice -> circuits + host lexicon -> base memory kbqa-<name>
 *   node tools/eval/kbqa.mjs run      --suite <name> [--stage 100|300|all]   # the chain on every question; per-question records
 *   node tools/eval/kbqa.mjs report   [--suite <name>|all]                   # scores, attribution, summary.md
 *   node tools/eval/kbqa.mjs baseline --suite <name> --stage 100 [--model grok|glm]  # omp task folder: an LLM answers from the same slice as text
 *
 * Outputs: eval/reports/current/kbqa/<name>/stage-<n>.jsonl (one record per question), eval/reports/current/kbqa/summary.{md,json}.
 * The gold answers are read only here and by the scorer; no generator or training code reads eval/suites/** (AGENTS.md rule 9).
 */
import {buildSuite} from './kbqa/suites.mjs';
import {BENCHMARKS} from './kbqa/benchmarks.mjs';

const args = process.argv.slice(2);
const command = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const suites = (value => (value === 'all' ? Object.keys(BENCHMARKS) : value.split(',')))(opt('--suite', 'all'));
const stage = opt('--stage', '100');

if (command === 'suites') {
  const results = [];
  for (const name of suites) results.push(await buildSuite(name, {size: Number(opt('--size', 1000))}));
  console.log(JSON.stringify(results, null, 2));
} else if (command === 'build') {
  const {buildMemory} = await import('./kbqa/memory.mjs');
  for (const name of suites) console.log(JSON.stringify(await buildMemory(name, {stage}), null, 2));
} else if (command === 'run') {
  const {runSuite} = await import('./kbqa/run.mjs');
  for (const name of suites) console.log(JSON.stringify(await runSuite(name, {stage, limit: opt('--limit', null), only: opt('--only', null)}), null, 2));
} else if (command === 'report') {
  const {writeReport} = await import('./kbqa/report.mjs');
  console.log(JSON.stringify(await writeReport({suites}), null, 2));
} else if (command === 'baseline') {
  const {makeBaseline} = await import('./kbqa/baseline.mjs');
  for (const name of suites) console.log(JSON.stringify(makeBaseline(name, {stage, model: opt('--model', 'grok'), shards: Number(opt('--shards', 1))}), null, 2));
} else {
  console.error('usage: node tools/eval/kbqa.mjs suites|build|run|report|baseline [--suite <name>] [--stage 100|300|all]');
  process.exit(2);
}
