import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildCurriculum } from './build-curriculum.mjs';
import { cases, attached, numeric, extra, assumptions } from './curriculum/cases.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const defaultDir = fileURLToPath(new URL('../../datasets/cases/', import.meta.url));
const itemById = new Map([...cases, ...attached, ...numeric, ...extra, ...assumptions].map(item => [item.id, item]));
const optional = (value, format) => value === undefined || value === null ? '' : format(value);
const jsonLine = (label, value) => `- ${label}: \`${JSON.stringify(value)}\``;

function caseDocument(rows, itemId) {
  const item = itemById.get(itemId);
  if (!item) throw Error(`No authored item for case ${itemId}`);
  const first = rows[0];
  const lines = [
    `# ${itemId}`, '',
    `- family: ${item.family}`,
    `- split: ${first.split}`,
    `- world: ${item.world ?? `attached_${first.split}`}`,
    `- operators: ${item.operators.join(', ')}`,
    `- input_mode: ${first.input_mode}`,
    `- structure: ${first.structure_id}`,
    `- oracle: ${first.quality_flags.independent_oracle}`,
    optional(item.negativeOf, value => `- negative_of: ${value}`),
    optional(item.holdout, value => `- holdout: ${value}`),
    optional(item.time, value => `- time: ${JSON.stringify(value)}`),
    optional(item.resolve, value => `- resolve: ${JSON.stringify(value)}`),
    optional(item.reservedLexemes?.length ? item.reservedLexemes : null, value => `- reserved_lexemes: ${value.join(', ')}`),
    optional(item.clarification, value => `- required_clarification: ${JSON.stringify(value)}`),
    '',
    '## Questions (surfaces → the same canonical target)', '',
    ...rows.map((row, index) => `${index + 1}. [${row.language}] ${row.question}${row.language === 'ro' ? '  (Romanian surface; canonical target and internal CNL stay English)' : ''}`),
    '',
  ];
  if (item.claims?.length) {
    lines.push('## Attached assertions (model input at request time)', '',
      ...item.claims.map(claim => `- "${claim.text}" → \`${claim.atom}\` valid ${claim.valid}`), '');
  }
  lines.push('## Expected (independent oracle, never computed from the target)', '');
  const expected = { ...first.expected };
  const sessionClaims = expected.session_claims;
  delete expected.session_claims;
  for (const [key, value] of Object.entries(expected)) lines.push(jsonLine(key, value));
  if (sessionClaims) {
    lines.push('- session_claims:');
    for (const claim of sessionClaims) lines.push(`  - ${jsonLine('holds', claim.holds).slice(2)} · valid ${claim.valid} · source ${claim.source} · quote "${claim.quote}" · retention ${claim.retention}`);
  }
  lines.push('', '## SOP target (compiled, canonical)', '', '```sop', first.sop_target.replace(/\n$/, ''), '```', '');
  if (first.setup_sop) lines.push('## Host world background (oracle basis, NOT model input)', '', '```sop', first.setup_sop.replace(/\n$/, ''), '```', '');
  lines.push('---', '', `Generated from \`tools/datasets/curriculum/cases.mjs\` (revision ${first.source.revision.split('/')[0]}). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit \`cases.mjs\`, then run \`node tools/datasets/build-cases-md.mjs\` and rebuild the corpus.`);
  return lines.join('\n') + '\n';
}

export function buildCasesTree(rows = buildCurriculum()) {
  const byCase = new Map();
  for (const row of rows) {
    if (!byCase.has(row.semantic_case_id)) byCase.set(row.semantic_case_id, []);
    byCase.get(row.semantic_case_id).push(row);
  }
  const files = new Map();
  for (const [caseId, caseRows] of [...byCase].sort(([a], [b]) => a.localeCompare(b))) {
    const family = caseRows[0].matrix.family_id;
    files.set(path.join(family, `${caseId}.md`), caseDocument(caseRows, caseId));
  }
  const tree_sha256 = sha256([...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, content]) => `${file}\0${content}`).join('\n'));
  return { files, tree_sha256 };
}

export function buildCasesMd({ dir = defaultDir, rows, write = true } = {}) {
  const { files, tree_sha256 } = buildCasesTree(rows);
  const root = path.resolve(dir);
  const existing = new Map();
  if (fs.existsSync(root)) {
    const walk = current => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md') && entry.name !== 'README.md') existing.set(path.relative(root, full), fs.readFileSync(full, 'utf8'));
      }
    };
    walk(root);
  }
  const changed = [...files].filter(([file, content]) => existing.get(file) !== content).map(([file]) => file);
  const stale = [...existing].filter(([file]) => !files.has(file)).map(([file]) => file);
  if (write) {
    for (const [file, content] of files) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (existing.get(file) !== content) fs.writeFileSync(target, content);
    }
    for (const file of stale) fs.rmSync(path.join(root, file));
  }
  return { directory: root, files: files.size, tree_sha256, changed, stale, up_to_date: !changed.length && !stale.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const result = buildCasesMd({ write: !check });
  if (check) {
    if (!result.up_to_date) {
      console.error(`STALE authoring tree: changed=[${result.changed.join(', ')}] removed=[${result.stale.join(', ')}]\nRun: node tools/datasets/build-cases-md.mjs`);
      process.exitCode = 1;
    } else console.log(JSON.stringify({ files: result.files, tree_sha256: result.tree_sha256, status: 'authoring_tree_up_to_date' }));
  } else console.log(JSON.stringify({ files: result.files, tree_sha256: result.tree_sha256, written: result.changed.length, removed: result.stale.length }));
}
