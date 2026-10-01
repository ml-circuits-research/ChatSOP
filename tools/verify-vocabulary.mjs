#!/usr/bin/env node
/** Vocabulary verification: find SOP constructs that are not in the language contract, wherever SOP is written.
 *
 *   node tools/verify-vocabulary.mjs [--scope corpora|docs|examples|all] [--corpus <name>]
 *     [--pending-types a,b] [--out <file.json>] [--stdout] [--findings-out <file.jsonl>] [--examples 3] [--no-parse] [--root <dir>]
 *
 * The vocabulary (wire types, fields, cardinality, enumerated values, model-authorable types) is read
 * from sop/parser.mjs, sop/declarative.mjs and sop/contracts/wires.json at run time by
 * tools/datasets/audit/vocabulary.mjs; nothing is listed here. Scopes:
 *   corpora   targets, setup and ontology programs of datasets/<corpus>/{train,dev}.jsonl and the sealed
 *             eval/suites/<corpus>/test.jsonl (model targets also against the model-authorable subset)
 *   examples  examples/**, tests/fixtures/** and config/ *.sop programs
 *   docs      SOP blocks in docs/**, skills/**, README.md and AGENTS.md, plus the wire help cross-check
 * Writes eval/reports/current/vocabulary.json (a regenerable observation) and prints a summary grouped by
 * construct. Exit status: 0 no failing finding, 1 failing findings, 2 the check could not run. Findings about
 * types whose migration is in flight, and SOP in a docs proposals/ folder (none today; past proposals are archived under probably_obsolete/specs/), are reported but do not fail.
 * Reading the sealed test is an audit measurement, never training or selection input (AGENTS.md rule 9).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {streamJsonl} from './datasets/audit/rows.mjs';
import {jsonlExists} from '../lib/jsonl-shards.mjs';
import {corpusDir, corpusNames} from '../lib/dataset-paths.mjs';
import {
  NON_FAILING, checkHelpPages, checkProgram, checkRow, describeVocabulary, htmlBlocks, loadVocabulary, markdownBlocks,
} from './datasets/audit/vocabulary.mjs';

const args = process.argv.slice(2);
const has = name => args.includes('--' + name);
const value = name => {
  const index = args.indexOf('--' + name);
  return index === -1 ? undefined : args[index + 1];
};
const root = path.resolve(value('root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const scope = value('scope') ?? 'all';
if (!['corpora', 'docs', 'examples', 'all'].includes(scope)) {
  console.error('Use --scope corpora|docs|examples|all');
  process.exit(2);
}
const inScope = name => scope === 'all' || scope === name;
const exampleLimit = Number(value('examples') ?? 3);
const relative = file => path.relative(root, file).split(path.sep).join('/');

function walk(dir, pattern, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(file, pattern, out);
    } else if (pattern.test(entry.name)) out.push(file);
  }
  return out;
}

const findings = [];
const scanned = {corpora: {}, examples: 0, doc_files: 0, doc_blocks: 0, help_pages: false};
const record = (scopeName, source, location, finding) => findings.push({scope: scopeName, source, location, ...finding});

/** Corpora whose rows carry English text in `target` (message/rewrite pairs), not an SOP program: nothing to check here. */
const TEXT_TARGET_CORPORA = new Set(['proofing', 'proofing-diverse-dev', 'bad_english', 'symbolic_english', 'neuro_english']);

async function scanCorpora(vocabulary) {
  const names = new Set(corpusNames(root));
  const suites = path.join(root, 'eval/suites');
  if (fs.existsSync(suites)) for (const entry of fs.readdirSync(suites, {withFileTypes: true})) if (entry.isDirectory()) names.add(entry.name);
  for (const corpus of [...names].sort()) {
    if (value('corpus') && corpus !== value('corpus')) continue;
    if (TEXT_TARGET_CORPORA.has(corpus)) continue;
    const files = {
      train: path.join(root, corpusDir(corpus, root), 'train.jsonl'),
      dev: path.join(root, corpusDir(corpus, root), 'dev.jsonl'),
      test: path.join(root, 'eval', 'suites', corpus, 'test.jsonl'),
    };
    for (const [split, file] of Object.entries(files)) {
      if (!jsonlExists(file)) continue;
      let rows = 0;
      for await (const {row, line, error} of streamJsonl(file)) {
        if (!row) {
          record('corpora', corpus, `${relative(file)}:${line}`, {construct: 'parse_error', class: 'contract', message: error});
          continue;
        }
        rows++;
        for (const finding of checkRow(row, vocabulary, {parse: !has('no-parse')})) {
          record('corpora', corpus, `${corpus}:${split}:${row.id ?? '#' + line}:${finding.where}${finding.line ? ':' + finding.line : ''}`, {...finding, row: `${corpus}:${split}:${row.id ?? '#' + line}`});
        }
      }
      scanned.corpora[corpus] = {...scanned.corpora[corpus], [split]: rows};
    }
  }
}

function scanExamples(vocabulary) {
  const files = [
    ...walk(path.join(root, 'examples'), /\.sop$/),
    ...walk(path.join(root, 'tests', 'fixtures'), /\.sop$/),
    ...walk(path.join(root, 'config'), /\.sop$/),
  ];
  for (const file of files) {
    scanned.examples++;
    const text = fs.readFileSync(file, 'utf8');
    for (const finding of checkProgram(text, vocabulary, {ontology: 'allow', complete: true, parse: !has('no-parse')})) {
      record('examples', relative(file), `${relative(file)}:${finding.line ?? '?'}`, finding);
    }
  }
}

function scanDocs(vocabulary) {
  const files = [
    ...walk(path.join(root, 'docs'), /\.(html|md)$/),
    ...walk(path.join(root, 'skills'), /\.md$/),
    ...['README.md', 'AGENTS.md'].map(name => path.join(root, name)).filter(file => fs.existsSync(file)),
  ];
  for (const file of files) {
    scanned.doc_files++;
    const name = relative(file), text = fs.readFileSync(file, 'utf8');
    const proposal = /(^|\/)proposals\//.test(name);
    const blocks = file.endsWith('.html') ? htmlBlocks(text) : markdownBlocks(text);
    for (const block of blocks) {
      scanned.doc_blocks++;
      if (block.knowledge) continue; // knowledge-language block: validated by sop/knowledge (tests/wire-help.test.mjs, tests/knowledge-docs.test.mjs)
      for (const finding of checkProgram(block.source, vocabulary, {ontology: block.ontology, complete: false, invalid: block.invalid, proposal})) {
        record('docs', name, `${name}:${block.line + (finding.line ?? 1)}`, finding);
      }
    }
  }
  const help = path.join(root, 'docs', 'wire_typs');
  if (fs.existsSync(help)) {
    scanned.help_pages = true;
    for (const finding of checkHelpPages(help, vocabulary)) record('docs', 'docs/wire_typs', `docs/wire_typs/${finding.file}`, finding);
  }
}

function group(list) {
  const groups = new Map();
  for (const finding of list) {
    const key = `${finding.construct}\u0000${finding.class}`;
    if (!groups.has(key)) groups.set(key, {construct: finding.construct, class: finding.class, count: 0, rowSet: new Set(), by_source: {}, by_detail: {}, examples: []});
    const entry = groups.get(key);
    entry.count++;
    if (finding.row) entry.rowSet.add(finding.row);
    entry.by_source[finding.source] = (entry.by_source[finding.source] ?? 0) + 1;
    const detail = [finding.type, finding.field, finding.value].filter(x => x !== undefined && x !== null).join('.') || finding.message;
    entry.by_detail[detail] = (entry.by_detail[detail] ?? 0) + 1;
    if (entry.examples.length < exampleLimit) entry.examples.push({location: finding.location, message: finding.message});
  }
  const sortCounts = object => Object.fromEntries(Object.entries(object).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return [...groups.values()].map(({rowSet, ...entry}) => ({...entry, ...(rowSet.size ? {corpus_rows: rowSet.size} : {}), by_source: sortCounts(entry.by_source), by_detail: sortCounts(entry.by_detail)}))
    .sort((a, b) => Number(NON_FAILING.has(a.class)) - Number(NON_FAILING.has(b.class)) || b.count - a.count);
}

let vocabulary;
try {
  vocabulary = await loadVocabulary({root, pendingTypes: (value('pending-types') ?? '').split(',').map(x => x.trim()).filter(Boolean)});
  if (inScope('corpora')) await scanCorpora(vocabulary);
  if (inScope('examples')) scanExamples(vocabulary);
  if (inScope('docs')) scanDocs(vocabulary);
} catch (error) {
  console.error(`vocabulary check could not run: ${error.stack ?? error.message}`);
  process.exit(2);
}

const failing = findings.filter(finding => !NON_FAILING.has(finding.class));
const byClass = {};
for (const finding of findings) byClass[finding.class] = (byClass[finding.class] ?? 0) + 1;
const groups = group(findings);
const FINDINGS_CAP = 2000;
const report = {
  format: 'chatsop-vocabulary-v1',
  note: 'Regenerable observation of the files on disk (AGENTS.md rule 9); the vocabulary is read from the contract at run time.',
  scope,
  contract: describeVocabulary(vocabulary),
  scanned,
  totals: {findings: findings.length, failing: failing.length, by_class: byClass},
  groups,
  // Failing findings first, so the cap never hides them behind pending-migration volume.
  findings: [...failing, ...findings.filter(finding => NON_FAILING.has(finding.class))].slice(0, FINDINGS_CAP),
  findings_truncated: findings.length > FINDINGS_CAP,
  verdict: failing.length ? 'fail' : 'pass',
};

if (value('findings-out')) {
  const out = path.resolve(value('findings-out'));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, findings.map(finding => JSON.stringify(finding)).join('\n') + (findings.length ? '\n' : ''));
}

function summary(target) {
  const v = report.contract;
  const lines = [];
  lines.push(`vocabulary: ${Object.keys(v.types).length} types; model types [${v.model_types.join(' ')}]`);
  lines.push(`enums verified from exports: ${Object.keys(v.enums).join(', ') || 'none'}`);
  const unverified = [...new Set(v.unverified_enums.map(item => `${item.type}.${item.field}`))];
  if (unverified.length) lines.push(`enums NOT verifiable (inline in code, not exported): ${unverified.join(', ')}`);
  if (Object.keys(v.pending_types).length) lines.push(`migration pending: ${Object.entries(v.pending_types).map(([type, reason]) => `${type} (${reason})`).join('; ')}`);
  const corpusRows = Object.values(scanned.corpora).reduce((sum, splits) => sum + Object.values(splits).reduce((a, b) => a + b, 0), 0);
  lines.push(`scanned: ${Object.keys(scanned.corpora).length} corpora (${corpusRows} rows), ${scanned.examples} program files, ${scanned.doc_blocks} SOP blocks in ${scanned.doc_files} doc files${scanned.help_pages ? ', wire help pages' : ''}`);
  for (const entry of groups) {
    lines.push(`${NON_FAILING.has(entry.class) ? '  (not failing) ' : '  '}${entry.construct} [${entry.class}]: ${entry.count}${entry.corpus_rows ? ` in ${entry.corpus_rows} corpus rows` : ''}`);
    const details = Object.entries(entry.by_detail).slice(0, 6).map(([detail, count]) => `${detail}=${count}`).join(', ');
    lines.push(`      top: ${details}`);
    const sources = Object.entries(entry.by_source).slice(0, 6).map(([source, count]) => `${source}=${count}`).join(', ');
    lines.push(`      in: ${sources}`);
    for (const example of entry.examples) lines.push(`      e.g. ${example.location}: ${example.message}`);
  }
  lines.push(`verdict: ${report.verdict.toUpperCase()} (${failing.length} failing, ${findings.length - failing.length} pending/proposal)${target ? `; report ${target}` : ''}`);
  return lines.join('\n');
}

if (has('stdout')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  console.error(summary());
} else {
  const out = path.resolve(value('out') ?? path.join(root, 'eval', 'reports', 'current', 'vocabulary.json'));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(summary(path.relative(process.cwd(), out) || out));
}
if (failing.length) process.exitCode = 1;
