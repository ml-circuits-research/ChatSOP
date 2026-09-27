import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parse } from '../../sop/parser.mjs';
import { Lexicon } from '../../sop/lexicon.mjs';
import { Runtime } from '../../sop/runtime.mjs';
import { publishKnowledge } from '../../sop/ingest.mjs';
import { Repository } from '../../memory/repository.mjs';
import { Agent } from '../../server/agent.mjs';
import { sha256, validateCorpus } from './schema.mjs';
import { evaluate } from '../../eval/run.mjs';
import { curriculumMatrix } from './build-curriculum.mjs';
import { barePrompt as formalPrompt } from '../../server/llm.mjs';
import { buildCasesMd } from './build-cases-md.mjs';

const templatePath = fileURLToPath(new URL('../../datasets/templates/pilot.json', import.meta.url));
const curriculumPath = fileURLToPath(new URL('./curriculum/cases.mjs', import.meta.url));
const ontologyPath = fileURLToPath(new URL('../../config/ontology.sop', import.meta.url));
const requireField = (condition, message) => { if (!condition) throw Error(message); };

export function readJsonl(file) {
  let body;
  try { body = fs.readFileSync(file, 'utf8'); } catch (error) { throw Error(`Missing source file ${file}: ${error.message}`); }
  requireField(body.endsWith('\n') && body.length > 1, `${file}: expected nonempty newline-terminated JSONL`);
  return body.trimEnd().split('\n').map((line, i) => { try { return JSON.parse(line); } catch { throw Error(`${file}:${i + 1}: malformed JSON`); } });
}

export function validateFile(file, options = {}) {
  return validateCorpus(readJsonl(file), options);
}

function verifiedManifest(file, format, names, { template = templatePath, label = 'pilot-source-v1', reviewStatus = null } = {}) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw Error(`Missing/invalid manifest ${file}: ${error.message}`); }
  requireField(manifest.format === format && manifest.profile === 'sop-agent-3', `${file}: incompatible manifest`);
  requireField(manifest.source_template_sha256 === sha256(fs.readFileSync(template)), `${file}: source template checksum mismatch`);
  requireField(manifest.version?.counter === 1 && manifest.version?.label === label, `${file}: invalid VERSION`);
  if (reviewStatus) requireField(manifest.review_status === reviewStatus && manifest.version.review_status === reviewStatus, `${file}: invalid review status`);
  else requireField(Array.isArray(manifest.reserved_structures) && manifest.reserved_structures.length > 0, `${file}: missing reserved structures`);
  requireField(manifest.files && Object.keys(manifest.files).sort().join('|') === names.slice().sort().join('|'), `${file}: missing/extra files`);
  for (const [relative, checksum] of Object.entries(manifest.files)) {
    const resolved = path.resolve(path.dirname(file), relative);
    requireField(resolved.startsWith(path.resolve(path.dirname(file)) + path.sep) && /^[a-f0-9]{64}$/.test(checksum), `${file}: unsafe file entry ${relative}`);
    let body;
    try { body = fs.readFileSync(resolved); } catch (error) { throw Error(`Missing source file ${resolved}: ${error.message}`); }
    requireField(sha256(body) === checksum, `${resolved}: checksum mismatch`);
  }
  requireField(fs.readFileSync(path.join(path.dirname(file), 'VERSION'), 'utf8') === JSON.stringify(manifest.version) + '\n', `${file}: VERSION differs from manifest`);
  return manifest;
}

export function validateManifest(file) {
  let format;
  try { format = JSON.parse(fs.readFileSync(file, 'utf8')).format; } catch (error) { throw Error(`Missing/invalid manifest ${file}: ${error.message}`); }
  if (format === 'chatsop-query-curriculum-v1') return validateQueryManifest(file);
  const train = verifiedManifest(file, 'chatsop-pilot-v1', ['VERSION', 'train.jsonl', 'dev.jsonl', 'formalizer/train.jsonl', 'formalizer/dev.jsonl']);
  requireField(train.sealed_eval && typeof train.sealed_eval.relative_directory === 'string' && train.sealed_eval.manifest === 'manifest.json', `${file}: missing sealed eval manifest reference`);
  const evalDir = path.resolve(path.dirname(file), train.sealed_eval.relative_directory);
  const development = path.resolve(path.dirname(file));
  requireField(evalDir !== development && !evalDir.startsWith(development + path.sep) && !development.startsWith(evalDir + path.sep), `${file}: test must be in a disjoint directory`);
  const evaluation = verifiedManifest(path.join(evalDir, 'manifest.json'), 'chatsop-pilot-eval-v1', ['VERSION', 'test.jsonl']);
  requireField(train.seed === evaluation.seed && train.worlds === evaluation.worlds && train.source_template_sha256 === evaluation.source_template_sha256 && JSON.stringify(train.version) === JSON.stringify(evaluation.version) && JSON.stringify(train.reserved_structures) === JSON.stringify(evaluation.reserved_structures), `${file}: mismatched sealed eval manifest`);
  const rows = ['train.jsonl', 'dev.jsonl'].flatMap(name => readJsonl(path.join(path.dirname(file), name))).concat(readJsonl(path.join(evalDir, 'test.jsonl')));
  for (const split of ['train', 'dev', 'test']) requireField(rows.some(row => row.split === split), `${file}: missing ${split} split`);
  const summary = validateCorpus(rows, { reservedStructures: train.reserved_structures });
  requireField(JSON.stringify(summary) === JSON.stringify(train.summary), `${file}: summary does not match corpus`);
  for (const split of ['train', 'dev']) {
    const actual = readJsonl(path.join(path.dirname(file), `formalizer/${split}.jsonl`));
    const canonical = rows.filter(row => row.split === split).map(row => ({ id: row.id, prompt: formalPrompt([...row.context_assertions, row.question].join('\n'), row.context), target: row.sop_target, context: row.context, setup: row.setup_sop, group: row.split_group_id }));
    requireField(JSON.stringify(actual) === JSON.stringify(canonical), `${file}: formalizer/${split}.jsonl does not match canonical rows`);
  }
  return { rows, summary };
}

export function validateQueryManifest(file) {
  const spec = { template: curriculumPath, label: 'query-curriculum-v1', reviewStatus: 'synthetic_unreviewed_not_training_approved' };
  const train = verifiedManifest(file, 'chatsop-query-curriculum-v1', ['VERSION', 'train.jsonl', 'dev.jsonl', 'formalizer/train.jsonl', 'formalizer/dev.jsonl'], spec);
  requireField(train.sealed_eval?.manifest === 'manifest.json' && typeof train.sealed_eval.relative_directory === 'string', `${file}: missing sealed eval manifest`);
  const development = path.resolve(path.dirname(file));
  const evalDir = path.resolve(development, train.sealed_eval.relative_directory);
  requireField(evalDir !== development && !evalDir.startsWith(development + path.sep) && !development.startsWith(evalDir + path.sep), `${file}: test must be in a disjoint directory`);
  const evaluation = verifiedManifest(path.join(evalDir, 'manifest.json'), 'chatsop-query-curriculum-eval-v1', ['VERSION', 'test.jsonl'], spec);
  requireField(train.source_template_sha256 === evaluation.source_template_sha256 && JSON.stringify(train.version) === JSON.stringify(evaluation.version) && JSON.stringify(train.matrix) === JSON.stringify(evaluation.matrix), `${file}: mismatched sealed eval manifest`);
  if (train.cases_md) {
    const tree = buildCasesMd({ write: false });
    requireField(tree.up_to_date && tree.tree_sha256 === train.cases_md.tree_sha256 && tree.files === train.cases_md.files, `${file}: authoring tree datasets/cases does not match the compiled corpus (manual edit or missing regeneration); run node tools/datasets/build-cases-md.mjs after changing tools/datasets/curriculum/cases.mjs`);
  }
  const rows = ['train.jsonl', 'dev.jsonl'].flatMap(name => readJsonl(path.join(development, name))).concat(readJsonl(path.join(evalDir, 'test.jsonl')));
  for (const split of ['train', 'dev', 'test']) requireField(rows.some(row => row.split === split), `${file}: missing ${split} split`);
  const summary = validateCorpus(rows);
  assert.deepEqual(train.matrix, curriculumMatrix(rows), `${file}: matrix does not match corpus`);
  requireField(train.matrix.measured_structure.holdouts.every(item => !item.checked || item.pass), `${file}: heldout composition or vocabulary is exposed in training`);
  for (const split of ['train', 'dev']) {
    const actual = readJsonl(path.join(development, `formalizer/${split}.jsonl`));
    const projected = rows.filter(row => row.split === split).map(row => ({ id: row.id, input_mode: row.input_mode, prompt: formalPrompt([...row.context_assertions, row.question].join('\n'), row.context), target: row.sop_target, context: row.context, group: row.split_group_id }));
    requireField(JSON.stringify(actual) === JSON.stringify(projected), `${file}: formalizer/${split}.jsonl does not match canonical rows`);
  }
  return { rows, summary, matrix: train.matrix, qualification: 'synthetic_unreviewed_not_training_approved' };
}

// Legacy pilot uses the historical graph-oracle path; production rows reuse the guarded evaluator.
export async function executeCorpus(rows) {
  validateCorpus(rows);
  if (rows.some(row => row.input_mode !== undefined)) {
    const targets = new Map(rows.map(row => [row.id, row.sop_target]));
    const report = await evaluate(rows, { predictor: async ({ id }) => targets.get(id), source: 'gold-validation' });
    for (const record of report.records) requireField(record.reference_valid, `${record.id}: gold setup/reference error: ${record.error?.message ?? 'unknown'}`);
    return { executed: rows.length, status: 'verified_against_runtime', qualification: 'not_reviewed' };
  }
  const lexicon = Lexicon.load(ontologyPath), root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-pilot-validator-'));
  try {
    for (const [index, row] of rows.entries()) {
      const repo = new Repository(path.join(root, `case-${index}`), { memory: { engine: 'sqlite', power: 10 } });
      const document = row.context_assertions.join('\n') + '\n';
      requireField(sha256(document) === row.source.sha256, `${row.id}: source tampering`);
      publishKnowledge(repo, 'world', row.setup_sop, { schema: lexicon.predicates, knownAt: Date.parse('2024-01-01'), reviewed: true, requireQuotes: true, documents: { [row.source.id]: document } });
      const session = repo.session('world', 'validator', 'isolated');
      const guard = new Agent({ repo, session, lexicon, config: {} });
      guard.validateVocabulary(row.sop_target, row.context);
      const actual = await new Runtime({ repo, session, schema: lexicon.predicates, now: Date.parse(row.context.now), policy: { allowWrite: false }, atomGuard: (atom, meta) => guard.validateAtom(atom, row.context, meta), factGuard: fact => assert.equal(fact.source, 'user') }).run(row.sop_target, { origin: 'model' });
      const packet = actual.result?.packet ?? actual.result;
      assert.equal(packet.status, row.expected.status, `${row.id}: graph oracle status mismatch`);
      if (row.expected.answers) {
        const order = packet.query?.select ?? [];
        const answers = (packet.answers ?? []).map(answer => order.map(field => answer.binding[field])).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const expected = [...row.expected.answers].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        assert.deepEqual(answers, expected, `${row.id}: graph oracle answers mismatch`);
      }
      for (const [field, expected] of Object.entries(row.expected.outputs ?? {})) assert.deepEqual(actual.values[field], expected, `${row.id}: output ${field} mismatch`);
      // No side effects may leak into later test records.
      requireField(parse(row.sop_target).wires.every(w => w.type !== 'assert'), `${row.id}: corpus target attempts write`);
    }
    return { executed: rows.length, status: 'verified_against_runtime' };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), flags = {};
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--execute') flags.execute = true;
      else if (['--file', '--manifest'].includes(key) && args[i + 1]) flags[key.slice(2)] = args[++i];
      else throw Error('Usage: node tools/datasets/validate.mjs (--file ROWS.jsonl | --manifest MANIFEST.json) [--execute]');
    }
    if (!!flags.file === !!flags.manifest) throw Error('Specify exactly one of --file or --manifest');
    const result = flags.manifest ? validateManifest(flags.manifest) : { rows: readJsonl(flags.file) };
    const summary = result.summary ?? validateCorpus(result.rows);
    const execution = flags.execute ? await executeCorpus(result.rows) : null;
    console.log(JSON.stringify({ summary, execution }));
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
