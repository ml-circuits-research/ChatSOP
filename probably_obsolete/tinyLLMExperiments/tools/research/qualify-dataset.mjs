#!/usr/bin/env node
/** Dataset qualification record (`chatsop-dataset-qualification-v1`) built from the actual check outputs.
 *
 * Runs the fail-closed checks on a corpus, its message-only projection and its sealed suites, keeps every
 * check's raw output as evidence under `eval/reports/current/qualification/<corpus>/`, and writes the record
 * that `node training/cli.mjs train --qualification` verifies (dataset, projection, contract and evidence hashes).
 * The record is `qualified` only when every check passes; otherwise it is written with status `not_qualified`
 * and the command exits 1. It modifies no data and trains nothing.
 *
 * With `--authorize MODEL[,MODEL…] --run RUN`, it also writes one `chatsop-training-authorization-v1` receipt per
 * model, bound to that model, run, role, recipe, dataset and this qualification. A receipt only transcribes an
 * explicit owner approval that is already in the journal (`--decision-ts` names that `training`/`decision` event);
 * it refuses when no such event exists.
 *
 *   node tools/research/qualify-dataset.mjs --corpus formalizer-v1 [--reviewer-id ID] [--skip-heavy]
 *     [--authorize smollm2-135m,gemma --run fv1-size-a1 --decision-ts 2026-09-28T18:13:13.644Z]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists, shardPaths} from '../../lib/jsonl-shards.mjs';
import {readJournal} from '../../lib/journal.mjs';
import {parse} from '../../sop/parser.mjs';
import {checkModelProgram} from '../../sop/declarative.mjs';
import {corpusDir} from '../../lib/dataset-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Must equal training/cli.mjs `contractFiles` and `qualificationChecks`.
const CONTRACT_FILES = ['sop/parser.mjs', 'sop/runtime.mjs', 'server/agent.mjs', 'server/prompts/formalizer.txt', 'config/knowledge/demo/0001-vocabulary.sop', 'tools/datasets/schema.mjs', 'tools/research/prepare-experiment.mjs'];
const CHECKS = ['syntax_execution', 'semantic_review', 'leakage', 'coverage', 'source_rights', 'independent_reference_suite'];

const rel = file => path.relative(root, file).split(path.sep).join('/');
function sha(file) {
  const hash = crypto.createHash('sha256');
  const parts = file.endsWith('.jsonl') && jsonlExists(file) ? shardPaths(file) : [file];
  for (const part of parts) hash.update(fs.readFileSync(part));
  return hash.digest('hex');
}
function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!['corpus', 'reviewer-id', 'skip-heavy', 'receipts-only', 'authorize', 'run', 'decision-ts'].includes(name)) throw Error(`Unknown option ${argv[i]}`);
    if (name === 'skip-heavy' || name === 'receipts-only') { out[name] = true; continue; }
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Missing value for ${argv[i]}`);
    out[name] = argv[++i];
  }
  if (!out.corpus) throw Error('--corpus is required');
  return out;
}
/** Runs one Node tool from the root and returns its exit code and output tails. */
function tool(argv) {
  const started = Date.now();
  const run = spawnSync(process.execPath, argv, {cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
  return {command: `node ${argv.join(' ')}`, exit: run.status, seconds: (Date.now() - started) / 1000,
    stdout_tail: (run.stdout ?? '').slice(-4000), stderr_tail: (run.stderr ?? '').slice(-4000)};
}
const normal = text => String(text).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function main() {
  const o = args(process.argv.slice(2));
  if (o['receipts-only']) {
    // Receipts for an existing qualified record, which training/cli.mjs re-verifies against every hash at launch.
    const qualificationPath = path.join(root, 'status/training', `qualification-${o.corpus}.json`);
    const qualification = JSON.parse(fs.readFileSync(qualificationPath, 'utf8'));
    if (qualification.status !== 'qualified') throw Error(`${rel(qualificationPath)} is not qualified`);
    if (qualification.dataset_manifest_sha256 !== sha(path.join(root, corpusDir(o.corpus, root), 'manifest.json'))) throw Error('The dataset manifest changed after qualification');
    if (!o.authorize) throw Error('--receipts-only needs --authorize');
    return authorize(o, o.corpus, qualificationPath, qualification);
  }
  const corpus = o.corpus, data = path.join(root, corpusDir(corpus, root)), evidenceDir = path.join(root, 'eval/reports/current/qualification', corpus);
  fs.mkdirSync(evidenceDir, {recursive: true});
  const manifestPath = path.join(data, 'manifest.json'), versionPath = path.join(data, 'VERSION');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const projectionManifest = JSON.parse(fs.readFileSync(path.join(data, 'formalizer/manifest.json'), 'utf8'));
  const split = name => readJsonlShardedSync(path.join(data, `${name}.jsonl`));
  const rows = {train: split('train'), dev: split('dev')};
  const projection = {train: readJsonlShardedSync(path.join(data, 'formalizer/train.jsonl')), dev: readJsonlShardedSync(path.join(data, 'formalizer/dev.jsonl'))};
  // Companion suites are recorded as {label: 'eval/suites/<name>/test.jsonl'}; the wild suite is added when present.
  const companions = Object.values(manifest.companion_suites ?? {}).map(file => String(file).split('/').at(-2));
  const suites = [corpus, ...companions, 'formalizer-ood-v1', 'formalizer-wild-v1']
    .filter((name, i, all) => name && all.indexOf(name) === i && jsonlExists(path.join(root, 'eval/suites', name, 'test.jsonl')));
  const tests = Object.fromEntries(suites.map(name => [name, readJsonlShardedSync(path.join(root, 'eval/suites', name, 'test.jsonl'))]));
  const labeled = name => tests[name].every(row => typeof row.sop_target === 'string');
  // An independent eval-only suite (eval/leakage.mjs INDEPENDENT_SUITES) has no verification worlds: it is scored by
  // accepted-gold match and reference-free metrics, and validated by its own checker, never executed as gold here.
  const independent = name => tests[name].every(row => row.scoring?.executed === false);
  const evidence = {}, checks = {};
  const record = (name, pass, body) => {
    const file = path.join(evidenceDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify({check: name, corpus, pass, generated_at: new Date().toISOString(), ...body}, null, 2) + '\n');
    evidence[name] = {path: rel(file), sha256: sha(file)};
    checks[name] = pass;
    console.log(JSON.stringify({check: name, pass}));
  };

  // syntax_execution: projection is message-only and model-language; every gold target executes to its expected result.
  const problems = [];
  if (projectionManifest.prompt_profile !== 'message-only') problems.push(`projection prompt_profile ${projectionManifest.prompt_profile}`);
  for (const name of ['train', 'dev']) {
    const byId = new Map(rows[name].map(row => [row.id, row]));
    if (projection[name].length !== rows[name].length) problems.push(`${name}: projection has ${projection[name].length} rows, corpus ${rows[name].length}`);
    for (const row of projection[name]) {
      const source = byId.get(row.id);
      if (!source) { problems.push(`${row.id}: not in corpus ${name}`); continue; }
      if (row.prompt !== source.question) problems.push(`${row.id}: prompt differs from the message`);
      try { checkModelProgram(parse(row.target)); } catch (error) { problems.push(`${row.id}: ${error.message}`); }
      if (problems.length > 50) break;
    }
  }
  for (const [file, value] of Object.entries(projectionManifest.files ?? {})) if (sha(path.join(root, file)) !== value.sha256) problems.push(`${file}: sha256 differs from the projection manifest`);
  const verify = o['skip-heavy'] ? null : tool(['tools/datasets/verify-corpus.mjs', '--corpus', corpus, '--all']);
  record('syntax_execution', !problems.length && (verify === null ? false : verify.exit === 0), {projection_problems: problems.slice(0, 50), verify_corpus: verify ?? 'skipped (--skip-heavy): not qualified'});

  // semantic_review: the independent automated corpus auditor (owner decision 2026-09-28: experiment-grade, no human review).
  const auditFile = path.join(root, 'eval/reports/current/corpus-audit', `${corpus}.json`);
  const audit = tool(['tools/datasets/audit-corpus.mjs', '--corpus', corpus]);
  record('semantic_review', audit.exit === 0 && fs.existsSync(auditFile), {auditor: 'tools/datasets/audit-corpus.mjs (DS020 machine audit, default --fail-on: every error-severity check)', audit_report: fs.existsSync(auditFile) ? {path: rel(auditFile), sha256: sha(auditFile)} : null, run: audit,
    human_review: 'none: experiment-grade by the owner decision of 2026-09-28'});

  // leakage: no connected group or identical message is shared between train/dev and any sealed suite.
  const leaks = [];
  const groups = new Map(), messages = new Map();
  for (const name of ['train', 'dev']) for (const row of rows[name]) {
    for (const key of [row.split_group_id, row.semantic_case_id]) if (key) groups.set(key, `${name}:${row.id}`);
    messages.set(normal(row.question), `${name}:${row.id}`);
  }
  const trainGroups = new Set(rows.train.map(row => row.split_group_id));
  for (const row of rows.dev) if (trainGroups.has(row.split_group_id)) leaks.push({kind: 'group train/dev', id: row.id});
  for (const [name, suite] of Object.entries(tests)) for (const row of suite) {
    for (const key of [row.split_group_id, row.semantic_case_id]) if (key && groups.has(key)) leaks.push({kind: 'group', suite: name, id: row.id, with: groups.get(key)});
    if (messages.has(normal(row.question))) leaks.push({kind: 'identical message', suite: name, id: row.id, with: messages.get(normal(row.question)),
      // In an independently written suite a message of one to three words (for example "hello") can coincide by chance.
      trivial: independent(name) && normal(row.question).split(' ').length < 4});
  }
  const blocking = leaks.filter(leak => !leak.trivial);
  record('leakage', blocking.length === 0, {suites, leaks: leaks.slice(0, 200), leak_count: leaks.length, blocking_count: blocking.length,
    rule: 'any shared group or identical message fails, except identical messages of fewer than four words in an independent suite (reported)', audit_template_leakage: 'reported in the semantic_review audit report'});

  // coverage: every language and question type of each sealed labelled suite occurs in train.
  const tally = list => list.reduce((map, row) => (map[`${row.language ?? 'unspecified'}|${row.question_type ?? 'unspecified'}`] = (map[`${row.language ?? 'unspecified'}|${row.question_type ?? 'unspecified'}`] ?? 0) + 1, map), {});
  const trainCells = tally(rows.train), missing = [];
  const suiteCells = Object.fromEntries(Object.entries(tests).map(([name, suite]) => [name, tally(suite)]));
  for (const cell of Object.keys(suiteCells[corpus] ?? {})) if (!trainCells[cell]) missing.push(cell);
  record('coverage', missing.length === 0 && rows.train.length > 0 && rows.dev.length > 0, {rows: {train: rows.train.length, dev: rows.dev.length, ...Object.fromEntries(Object.entries(tests).map(([n, s]) => [n, s.length]))},
    language_by_question_type: {train: trainCells, dev: tally(rows.dev), ...suiteCells}, test_cells_missing_in_train: missing});

  // source_rights: the no-copy check on the corpus and every sealed suite, and no row copies source text.
  const noCopy = [tool(['tools/datasets/no-copy.mjs', '--corpus', corpus, '--out', rel(path.join(evidenceDir, 'no-copy-corpus.json'))])];
  for (const name of suites) noCopy.push(tool(['tools/datasets/no-copy.mjs', '--files', `eval/suites/${name}/test.jsonl`, '--name', `${name}-test`, '--out', rel(path.join(evidenceDir, `no-copy-${name}.json`))]));
  // The generated corpus and its generated sealed suites gate; an independent suite's no-copy result is reported
  // (its messages were written without sources, and its identifier check can flag product names such as "Log4j").
  const gating = noCopy.filter((run, i) => i === 0 || !independent(suites[i - 1]));
  const copiedRows = [...rows.train, ...rows.dev, ...suites.filter(name => !independent(name)).flatMap(name => tests[name])];
  const copied = copiedRows.filter(row => row.rights?.text_copied !== false || row.quality_flags?.source_rows_copied === true).map(row => row.id);
  record('source_rights', gating.every(run => run.exit === 0) && copied.length === 0, {no_copy: noCopy, rows_without_text_copied_false: copied.slice(0, 50), rows_without_text_copied_false_count: copied.length, rights_basis: 'docs/specs/DS014-source-rights.md owner decision 2026-09-28 (inspired-by-released)'});

  // independent_reference_suite: every labelled sealed suite verifies, and its gold executes as its own prediction.
  const references = [];
  for (const name of suites) {
    if (!labeled(name)) { references.push({suite: name, labeled: false, note: 'unlabeled: reference-free evaluation only'}); continue; }
    if (independent(name)) {
      const check = tool(['tools/eval/wild-suite.mjs', '--check']);
      references.push({suite: name, labeled: true, independent: true, suite_sha256: sha(path.join(root, 'eval/suites', name, 'test.jsonl')), check, pass: check.exit === 0,
        note: 'no verification world: scored by accepted-gold match and reference-free metrics'});
      continue;
    }
    const out = path.join(evidenceDir, `gold-${name}`);
    // The corpus's own sealed test is one of its manifest splits, already executed by verify-corpus --corpus --all.
    const verifySuite = name === corpus ? verify : o['skip-heavy'] ? null : tool(['tools/datasets/verify-corpus.mjs', '--suite', name, '--all']);
    const gold = tool(['tools/metrics/run.mjs', '--file', `eval/suites/${name}/test.jsonl`, '--gold-as-prediction', '--out', rel(out)]);
    let metrics = null;
    try { metrics = JSON.parse(fs.readFileSync(path.join(out, 'metrics.json'), 'utf8')); } catch {}
    const ee = metrics?.formalizer?.execution_equivalence;
    references.push({suite: name, labeled: true, suite_sha256: sha(path.join(root, 'eval/suites', name, 'test.jsonl')), verify: verifySuite ?? 'skipped (--skip-heavy): not qualified', gold_as_prediction: gold,
      evaluation_valid: metrics?.evaluation_valid ?? false, valid_references: metrics?.valid_references ?? 0, rows: metrics?.rows ?? 0, execution_equivalence: ee ?? null,
      pass: gold.exit === 0 && verifySuite?.exit === 0 && metrics?.evaluation_valid === true && metrics.valid_references === metrics.rows && ee?.numerator === ee?.denominator && ee?.denominator === metrics.rows});
  }
  record('independent_reference_suite', references.some(r => r.suite === corpus && r.pass) && references.filter(r => r.labeled).every(r => r.pass), {references});

  const qualified = CHECKS.every(name => checks[name] === true) && fs.existsSync(versionPath);
  const dataset_files = Object.fromEntries(['formalizer/train.jsonl', 'formalizer/dev.jsonl'].map(name => [name, sha(path.join(data, name))]));
  const qualification = {
    format: 'chatsop-dataset-qualification-v1', status: qualified ? 'qualified' : 'not_qualified', corpus,
    grade: 'experiment-grade: semantic review by the independent automated auditor, no human review (owner decision 2026-09-28)',
    dataset_manifest_sha256: sha(manifestPath), dataset_version_sha256: fs.existsSync(versionPath) ? sha(versionPath) : null,
    dataset_version: fs.existsSync(versionPath) ? JSON.parse(fs.readFileSync(versionPath, 'utf8')) : null,
    dataset_files, sealed_suites: Object.fromEntries(suites.map(name => [name, sha(path.join(root, 'eval/suites', name, 'test.jsonl'))])),
    contract_files: Object.fromEntries(CONTRACT_FILES.map(name => [name, sha(path.join(root, name))])),
    checks, evidence,
    reviewer: {kind: 'principal_integrator', id: o['reviewer-id'] ?? 'training-agent (automated qualification; owner approval 2026-09-28)', reviewed_at: new Date().toISOString()},
    blockers: [...(fs.existsSync(versionPath) ? [] : [`missing ${rel(versionPath)} ({"counter": N, "label": "..."}), required by training/cli.mjs`]), ...CHECKS.filter(name => checks[name] !== true).map(name => `check failed: ${name}`)],
  };
  const qualificationPath = path.join(root, 'status/training', `qualification-${corpus}.json`);
  fs.mkdirSync(path.dirname(qualificationPath), {recursive: true});
  fs.writeFileSync(qualificationPath, JSON.stringify(qualification, null, 2) + '\n');
  console.log(JSON.stringify({qualification: rel(qualificationPath), status: qualification.status, sha256: sha(qualificationPath), blockers: qualification.blockers}));
  if (!qualified) { process.exitCode = 1; return; }

  if (o.authorize) authorize(o, corpus, qualificationPath, qualification);
}

/** Writes one authorization receipt per model from the owner's journal decision and its approval scope. */
function authorize(o, corpus, qualificationPath, qualification) {
  {
    if (!o.run || !o['decision-ts']) throw Error('--authorize needs --run and --decision-ts');
    const decision = readJournal().find(event => event.ts === o['decision-ts'] && event.area === 'training' && event.state === 'decision');
    if (!decision) throw Error(`No training decision event at ${o['decision-ts']} in status/journal.jsonl`);
    const scope = JSON.parse(fs.readFileSync(path.join(root, 'status/training/owner-approval-formalizer-size-v1.json'), 'utf8'));
    if (scope.journal_event.ts !== decision.ts || scope.corpus !== corpus) throw Error('The approval scope does not match this decision or corpus');
    for (const model of o.authorize.split(',')) {
      if (!scope.approved_models.includes(model)) throw Error(`${model} is outside the owner's approved models`);
      const receipt = {
        format: 'chatsop-training-authorization-v1', authorization: 'explicit-user-approval', approved: true, approved_by: 'user',
        approved_at: decision.ts, instruction: `${decision.title}: ${decision.detail}`,
        journal_event: {file: 'status/journal.jsonl', ts: decision.ts, actor: decision.actor},
        model, run: o.run, role: 'formalizer', qualification_sha256: sha(qualificationPath),
        recipe_sha256: sha(path.join(root, 'config', `train-${model}.json`)),
        dataset_manifest_sha256: qualification.dataset_manifest_sha256, dataset_version_sha256: qualification.dataset_version_sha256,
        transcribed_by: 'training-agent', transcribed_at: new Date().toISOString(),
      };
      const file = path.join(root, 'status/training', `authorization-${model}-${o.run}.json`);
      fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
      console.log(JSON.stringify({authorization: rel(file), sha256: sha(file)}));
    }
  }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
