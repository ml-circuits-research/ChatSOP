import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCurriculum } from '../build-curriculum.mjs';
import { caseDocument } from '../build-cases-md.mjs';
import { authoringProvenance, validateAuthoringRecord, validateCorpus, sha256 } from '../schema.mjs';
import { evaluate } from '../../../eval/run.mjs';

const root = fileURLToPath(new URL('../../../datasets/cases/', import.meta.url));
const heading = {
  questions: '## Questions (surfaces → the same canonical target)\n\n',
  expected: '## Expected (independent oracle, never computed from the target)\n\n',
  target: track => `${track === 'system' ? '## Trusted system circuit (not model target)' : '## Declarative model target (canonical)'}\n\n`,
  setup: '## Host world background (oracle basis, NOT model input)\n\n',
};
const requireField = (condition, message) => { if (!condition) throw Error(message); };
function section(body, start, end) {
  const from = body.indexOf(start);
  requireField(from >= 0 && body.indexOf(start, from + start.length) < 0, `Missing or duplicate section: ${start.trim()}`);
  const offset = from + start.length, to = body.indexOf(end, offset);
  requireField(to >= 0, `Missing section boundary: ${end.trim()}`);
  return body.slice(offset, to);
}
function sop(source, name) {
  const match = /^```sop\n([\s\S]*?)\n```\n$/.exec(source);
  requireField(match && match[1].length, `Invalid ${name} SOP fence`);
  return match[1] + '\n';
}

// The generated template is the immutable frame; only questions, oracle and SOP blocks are editable.
// Re-rendering and exact byte comparison rejects every unknown key, heading or metadata change.
export function parseCaseMd(body, baselineRows, id) {
  const first = baselineRows[0], targetHeading = heading.target(first.evaluation_track);
  const questions = section(body, heading.questions, first.context_assertions.length ? '\n## Attached assertions (' : `\n${heading.expected}`).trimEnd();
  const questionLines = questions.split('\n');
  requireField(questionLines.length === baselineRows.length, `${id}: surface count changed`);
  const parsedQuestions = questionLines.map((line, index) => {
    const row = baselineRows[index];
    const marker = row.language === 'ro' ? '  (Romanian surface; model intent remains canonical and language-independent)' : '';
    const match = new RegExp(`^${index + 1}\\. \\[${row.language}\\] (.+)$`, 'u').exec(line);
    requireField(match && (!marker || match[1].endsWith(marker)), `${id}: malformed surface ${index + 1}`);
    return marker ? match[1].slice(0, -marker.length) : match[1];
  });
  const oracle = section(body, heading.expected, `\n${targetHeading}`).trimEnd();
  const expected = {};
  for (const line of oracle.split('\n')) {
    const match = /^- ([a-z_]+): `([^`]+)`$/.exec(line);
    requireField(match && Object.hasOwn(first.expected, match[1]) && !Object.hasOwn(expected, match[1]), `${id}: unknown or malformed oracle field: ${line}`);
    try { expected[match[1]] = JSON.parse(match[2]); } catch { throw Error(`${id}: invalid oracle JSON in ${match[1]}`); }
  }
  requireField(Object.keys(expected).length === Object.keys(first.expected).length, `${id}: missing oracle field`);
  const targetEnd = first.setup_sop ? `\n${heading.setup}` : '\n---\n';
  const target = sop(section(body, targetHeading, targetEnd), 'target');
  const setup = first.setup_sop ? sop(section(body, heading.setup, '\n---\n'), 'background') : '';
  const rows = baselineRows.map((row, index) => ({ ...row, question: parsedQuestions[index], expected, sop_target: target, setup_sop: setup }));
  requireField(caseDocument(rows, id) === body, `${id}: unparseable or out-of-schema Markdown drift`);
  for (const row of rows) { row.authoring = authoringProvenance(row, body); validateAuthoringRecord(row, body); }
  return rows;
}

export async function compileCase({ file, out, rows = buildCurriculum(), dir = root, write = true } = {}) {
  requireField(file && out, 'Usage: --case datasets/cases/<family>/<id>.md --out <case.jsonl>');
  const full = path.resolve(file), directory = path.resolve(dir);
  requireField(full.startsWith(directory + path.sep) && full.endsWith('.md'), 'Case must reside under the authoring tree');
  const id = path.basename(full, '.md');
  const baseline = rows.filter(row => row.semantic_case_id === id);
  requireField(baseline.length && path.dirname(full) === path.join(directory, baseline[0].matrix.family_id), `${id}: unknown case or family`);
  const compiled = parseCaseMd(fs.readFileSync(full, 'utf8'), baseline, id);
  const replacements = new Map(compiled.map(row => [row.id, row]));
  validateCorpus(rows.map(row => replacements.get(row.id) ?? row));
  const report = await evaluate(compiled, { predictor: async ({ id: rowId }) => replacements.get(rowId).sop_target, source: 'gold-validation' });
  for (const record of report.records) requireField(record.reference_valid, `${record.id}: independent oracle mismatch: ${record.error?.message ?? 'unknown'}`);
  const jsonl = compiled.map(row => JSON.stringify(row)).join('\n') + '\n';
  if (write) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, jsonl); }
  return { case_id: id, rows: compiled.length, sha256: sha256(jsonl), oracle: 'verified_against_runtime', review_status: 'integrator-authored-not-human-validated', jsonl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--case' || args[2] !== '--out') throw Error('Usage: node tools/datasets/authoring/compile-case.mjs --case datasets/cases/<family>/<id>.md --out <case.jsonl>');
    const { jsonl, ...result } = await compileCase({ file: args[1], out: args[3] });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
