#!/usr/bin/env node
/** Independent machine audit of a corpus: structural invariants, semantic faithfulness, context
 * non-triviality, diversity and template-level leakage against the sealed test.
 *
 *   node tools/datasets/audit-corpus.mjs --corpus formalizer-v1
 *     [--out <file.json>] [--stdout] [--fail-on errors|warnings|none|<id>[=rate],...] [--threshold <id>=<rate>,...]
 *     [--grounded-types stated] [--assumption-types assumed] [--problem-types query,constraint]
 *     [--lexicon <file.json>] [--rows-out <file.jsonl>] [--examples 5] [--spot 25] [--no-leakage] [--root <dir>]
 *
 * Writes `eval/reports/current/corpus-audit/<corpus>.json` (or `--out`) and prints a concise summary. With
 * `--stdout` the JSON report goes to stdout and the summary to stderr, and no file is written. Invariant
 * violations always exit nonzero; semantic checks exit nonzero when a check selected by `--fail-on` (default:
 * every error-severity check) exceeds its threshold. The procedure is `skills/corpus-audit/SKILL.md`.
 *
 * Reading `eval/suites/<corpus>/test.jsonl` here is an audit measurement, not training or selection input.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditCorpus, corpusFiles, defaultReportPath} from './audit/engine.mjs';
import {humanSummary} from './audit/summary.mjs';

const args = process.argv.slice(2);
const has = name => args.includes('--' + name);
const value = name => {
  const index = args.indexOf('--' + name);
  return index === -1 ? undefined : args[index + 1];
};

const root = path.resolve(value('root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const corpus = value('corpus');
if (!corpus || !/^[a-z0-9-]+$/.test(corpus)) {
  console.error('Use --corpus <name> (see skills/corpus-audit/SKILL.md)');
  process.exit(2);
}

let report;
try {
  const files = corpusFiles(root, corpus);
  for (const split of ['train', 'dev', 'test']) if (value(split)) files[split] = path.resolve(value(split));
  report = await auditCorpus({
    root, corpus, files,
    rowsOut: value('rows-out') ? path.resolve(value('rows-out')) : null,
    options: {
      failOn: value('fail-on'), threshold: value('threshold'),
      groundedTypes: value('grounded-types'), assumptionTypes: value('assumption-types'), problemTypes: value('problem-types'),
      lexicon: value('lexicon') ? path.resolve(value('lexicon')) : null,
      examples: value('examples'), spot: value('spot'), leakage: !has('no-leakage'),
    },
  });
} catch (error) {
  console.error(`${corpus}: audit could not run: ${error.message}`);
  process.exit(2);
}

if (has('stdout')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  console.error(humanSummary(report));
} else {
  const out = path.resolve(value('out') ?? defaultReportPath(root, corpus));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(humanSummary(report, path.relative(process.cwd(), out) || out));
}
if (report.verdict.status !== 'pass') process.exitCode = 1;
