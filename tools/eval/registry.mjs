import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { auditSourceBoundary } from '../../eval/leakage.mjs';
import { evaluate } from '../../eval/run.mjs';
import { stable } from '../../lib/util.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const executionFiles = ['tools/eval/registry.mjs', 'tools/eval/baseline.mjs', 'eval/leakage.mjs', 'eval/run.mjs', 'eval/contracts.mjs', 'eval/signature.mjs', 'sop/parser.mjs', 'sop/runtime.mjs', 'server/agent.mjs', 'config/ontology.sop'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const within = (base, file) => file.startsWith(base + path.sep);
function resolved(relative) {
  assert(typeof relative === 'string' && relative && !path.isAbsolute(relative), 'Expected a repository-relative artifact');
  const file = path.resolve(root, relative);
  assert(within(root, file), `Artifact escapes repository: ${relative}`);
  if (fs.existsSync(file)) assert(within(root, fs.realpathSync(file)), `Artifact symlink escapes repository: ${relative}`);
  return file;
}
function checksum(relative) { const file = resolved(relative); return fs.existsSync(file) ? digest(fs.readFileSync(file)) : null; }
function suiteKind(cell) {
  const file = resolved(cell.suite);
  const actual = fs.existsSync(file) ? fs.realpathSync(file) : file;
  if (cell.split === 'test') assert(within(path.join(root, 'eval/suites'), actual), 'Test answers must live in eval/suites');
  else assert(cell.split === 'dev' && within(path.join(root, 'datasets'), actual) && /(?:^|\/)dev\.jsonl$/.test(actual), 'Selection requires a dataset dev suite');
}
function definition(manifest) {
  assert.equal(manifest.format, 'chatsop-experiment-registry-v1');
  assert(manifest.predictor_identity === undefined || manifest.predictor_identity === 'deterministic-baseline-gold-copy', 'Unknown predictor identity');
  assert(Array.isArray(manifest.cells) && manifest.cells.length > 0, 'Explicit cells required');
  assert.equal(new Set(manifest.cells.map(cell => cell.id)).size, manifest.cells.length, 'Duplicate cell');
  assert(manifest.cells.some(cell => cell.split === 'dev') && manifest.cells.some(cell => cell.split === 'test'), 'Require both dev and sealed test');
  for (const cell of manifest.cells) {
    assert(/^[a-z0-9_-]+$/.test(cell.id), 'Unsafe cell ID');
    suiteKind(cell);
    assert(typeof cell.predictions === 'string' && within(path.join(root, manifest.predictor_identity ? 'eval/predictions' : 'eval/registry'), resolved(cell.predictions)), 'Predictions must be explicit artifacts in the declared predictor directory');
    assert(cell.track === 'formalization' || cell.track === 'system', 'Explicit track required');
  }
}
function splitArtifacts() {
  const problems = [], entries = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { problems.push(`Symlink in splits: ${path.relative(root, file)}`); continue; }
      if (entry.isDirectory()) walk(file);
      else {
        const relative = path.relative(root, file);
        entries.push(relative);
        if (!/^(?:manifest\.json|(?:SHA256SUMS|CHECKSUMS|[^/]+\.sha256))$/.test(entry.name)) problems.push(`Non-manifest/checksum in splits: ${relative}`);
      }
    }
  };
  walk(path.join(root, 'datasets/splits'));
  return { entries, problems };
}
function localTestCorpora() {
  const found = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name === 'test.jsonl') found.push(path.relative(root, file));
    }
  };
  walk(path.join(root, 'datasets'));
  return found.sort();
}
function baselineProvenance(cell) {
  const file = cell.predictions + '.manifest.json';
  if (!checksum(file)) return { file, sha256:null, problem:`Missing baseline provenance: ${file}` };
  const record = json(resolved(file));
  const expectedSuite = cell.split === 'dev' ? checksum(cell.suite) : json(resolved(path.posix.join(path.posix.dirname(cell.suite), 'manifest.json'))).files?.[path.posix.basename(cell.suite)];
  const command = `node tools/eval/baseline.mjs --file ${cell.suite} --out ${cell.predictions}`;
  const valid = record.format === 'chatsop-baseline-predictions-v1' && record.predictor_identity === 'deterministic-baseline-gold-copy' &&
    record.suite === cell.suite && record.suite_sha256 === expectedSuite &&
    record.predictions === cell.predictions && record.predictions_sha256 === checksum(cell.predictions) &&
    record.command === command && Number.isSafeInteger(record.rows) && record.rows > 0;
  return { file, sha256:checksum(file), problem:valid ? null : `Baseline provenance mismatch: ${file}` };
}
export function audit(manifestFile, reportFile) {
  const manifest = json(resolved(manifestFile));
  definition(manifest);
  const boundary = auditSourceBoundary(root), splits = splitArtifacts();
  const cells = manifest.cells.map(cell => ({ id:cell.id, split:cell.split, suite:cell.suite, predictions:cell.predictions,
    // Never open sealed answers during preflight. The sealed manifest is a checksum-only authority here.
    suite_sha256:cell.split === 'dev' ? checksum(cell.suite) : null,
    sealed_manifest_sha256:cell.split === 'test' ? checksum(path.posix.join(path.posix.dirname(cell.suite), 'manifest.json')) : null,
    predictions_sha256:checksum(cell.predictions), ...(manifest.predictor_identity ? { baseline_provenance:baselineProvenance(cell) } : {}) }));
  const problems = [...boundary.violations, ...splits.problems];
  for (const cell of cells) {
    if (cell.split === 'dev' && !cell.suite_sha256) problems.push(`Missing dev suite: ${cell.suite}`);
    if (cell.split === 'test' && !cell.sealed_manifest_sha256) problems.push(`Missing sealed manifest: ${cell.suite}`);
    if (!cell.predictions_sha256) problems.push(`Missing predictions: ${cell.predictions}`);
    if (cell.baseline_provenance?.problem) problems.push(cell.baseline_provenance.problem);
  }
  const modelManifest = 'eval/registry/manifest.json';
  const modelMissing = checksum(modelManifest)
    ? json(resolved(modelManifest)).cells.filter(cell => !checksum(cell.predictions)).map(cell => ({ id:cell.id, split:cell.split, predictions:cell.predictions }))
    : [];
  const report = { format:'chatsop-leakage-audit-v1', manifest:manifestFile, manifest_sha256:checksum(manifestFile),
    source_files_checked:boundary.files, source_sha256:Object.fromEntries([...new Set([...boundary.files, ...executionFiles])].sort().map(file => [file, checksum(file)])),
    observed_training_selection_splits:boundary.observed_splits,
    training_selection_guard_passed:boundary.violations.length === 0,
    boundary:'Authoritative sealed evaluation answers are in eval/suites. Dataset-local test.jsonl files are execution corpora for validation/verifier, not training or checkpoint-selection inputs; the inspected training paths select train/dev only.',
    observed_evaluation_scope:manifest.predictor_identity
      ? 'Only deterministic gold-copy baseline predictions and their evaluator sanity check are configured here; no real-model predictions or model accuracy are observed.'
      : 'Real-model dev/selection and sealed-test prediction artifacts are absent; incomplete cells forbid a final model report.',
    observed_real_model_manifest_sha256:checksum(modelManifest), observed_real_model_missing_predictions:modelMissing,
    dataset_local_test_paths:localTestCorpora(), split_artifacts:splits.entries, cells, problems, ready:problems.length === 0,
    limitations:['Static source inspection is not a sandbox against computed paths or external processes.', 'Sealed answers are not read during preflight; semantic train/test overlap is not asserted.'] };
  save(resolved(reportFile), report);
  return report;
}
function rows(file) { return fs.readFileSync(resolved(file), 'utf8').trim().split('\n').map(line => JSON.parse(line)); }
function predictor(cellRows, file) {
  const predictions = rows(file), byId = new Map();
  for (const item of predictions) {
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.sop, 'string');
    assert(!byId.has(item.id), `Duplicate prediction: ${item.id}`);
    byId.set(item.id, item.sop);
  }
  assert.equal(byId.size, cellRows.length, 'Predictions must cover every row exactly');
  for (const row of cellRows) assert(byId.has(row.id), `Missing prediction: ${row.id}`);
  return ({ id }) => byId.get(id);
}
export async function run(manifestFile, reportDir) {
  const manifest = json(resolved(manifestFile));
  definition(manifest);
  const folder = resolved(reportDir), auditFile = path.join(folder, 'leakage.json');
  assert(fs.existsSync(auditFile), 'Run audit first; leakage.json must exist before evaluation');
  const prior = json(auditFile);
  // Audit writes first even on failure; changes between audit and run require a fresh preflight.
  const fresh = audit(manifestFile, path.relative(root, auditFile));
  assert.deepEqual(fresh, prior, 'Preflight changed: inspect fresh leakage report and rerun');
  assert(fresh.ready, `Preflight blocked: ${fresh.problems.join('; ')}`);
  for (const cell of [...manifest.cells.filter(item => item.split === 'dev'), ...manifest.cells.filter(item => item.split === 'test')]) {
    const suite = rows(cell.suite);
    assert(suite.length && suite.every(row => row.evaluation_track === cell.track), `Suite track mismatch: ${cell.id}`);
    if (cell.split === 'test') {
      const sealed = json(resolved(path.posix.join(path.posix.dirname(cell.suite), 'manifest.json')));
      const expected = sealed.files?.[path.posix.basename(cell.suite)] ?? sealed.files?.[cell.suite.split('/').slice(-2).join('/')];
      assert(expected && expected === checksum(cell.suite), `Sealed checksum mismatch: ${cell.id}`);
    }
    const report = await evaluate(suite, { predictor:predictor(suite, cell.predictions), source:'predictions', modelManifest:manifest.predictor_identity ? json(resolved(cell.predictions + '.manifest.json')) : null });
    assert(report.evaluation_valid, `Invalid evaluation: ${cell.id}`);
    const output = path.join(folder, `${cell.id}.json`);
    save(output, report);
    save(path.join(folder, `${cell.id}.inputs.json`), { manifest_sha256:checksum(manifestFile), suite_sha256:checksum(cell.suite), predictions_sha256:checksum(cell.predictions), report_sha256:digest(fs.readFileSync(output)) });
  }
  return index(manifestFile, reportDir);
}
export function requireCompleteMatrix(cells, reports) {
  assert.equal(new Set(cells.map(cell => cell.id)).size, cells.length, 'Duplicate declared matrix cell');
  assert.deepEqual(reports.map(report => report.id).sort(), cells.map(cell => cell.id).sort(), 'Missing or extra matrix cell');
}
export function index(manifestFile, reportDir) {
  const manifest = json(resolved(manifestFile));
  definition(manifest);
  const folder = resolved(reportDir), auditFile = path.join(folder, 'leakage.json');
  assert(fs.existsSync(auditFile), 'Missing leakage preflight');
  const prior = json(auditFile), fresh = audit(manifestFile, path.relative(root, auditFile));
  assert.deepEqual(fresh, prior, 'Stale leakage preflight');
  assert(fresh.ready, 'Leakage preflight is blocked');
  const reports = manifest.cells.map(cell => {
    const file = path.join(folder, `${cell.id}.json`), inputsFile = path.join(folder, `${cell.id}.inputs.json`);
    assert(fs.existsSync(file) && fs.existsSync(inputsFile), `Missing cell ${cell.id}: cannot produce final report`);
    const report = json(file), inputs = json(inputsFile);
    assert(report.evaluation_valid, `Invalid cell ${cell.id}`);
    const suite = rows(cell.suite);
    assert.equal(report.suite_sha256, digest(stable(suite)), `Stale suite report: ${cell.id}`);
    assert.equal(report.metrics.rows, suite.length, `Incomplete cell ${cell.id}`);
    assert.deepEqual(inputs, { manifest_sha256:checksum(manifestFile), suite_sha256:checksum(cell.suite), predictions_sha256:checksum(cell.predictions), report_sha256:digest(fs.readFileSync(file)) }, `Changed inputs for cell ${cell.id}`);
    return { id:cell.id, split:cell.split, suite_sha256:inputs.suite_sha256, predictions_sha256:inputs.predictions_sha256, report:path.relative(root, file), report_sha256:inputs.report_sha256, metrics:report.metrics };
  });
  requireCompleteMatrix(manifest.cells, reports);
  const result = { format:'chatsop-experiment-index-v1', predictor_identity:manifest.predictor_identity ?? null, evaluation_kind:manifest.predictor_identity ? 'gold-copy evaluator sanity check; no model predictions or model accuracy' : 'supplied predictions', manifest:manifestFile, manifest_sha256:checksum(manifestFile), leakage_report:path.relative(root, auditFile), leakage_sha256:checksum(path.relative(root, auditFile)), cells:reports };
  save(path.join(folder, 'index.json'), result);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, manifest = 'eval/registry/manifest.json', output = 'eval/reports/current/registry'] = process.argv.slice(2);
  try {
    assert(['audit', 'run', 'index'].includes(action), 'Usage: node tools/eval/registry.mjs audit|run|index [manifest] [report-directory]');
    const result = action === 'audit' ? audit(manifest, path.posix.join(output, 'leakage.json')) : action === 'run' ? await run(manifest, output) : index(manifest, output);
    console.log(JSON.stringify({ format:result.format, ready:result.ready, problems:result.problems, cells:result.cells.length }));
    if (action === 'audit' && !result.ready) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
