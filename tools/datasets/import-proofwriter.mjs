#!/usr/bin/env node
// OWA structured source probe and rights-gated review-candidate importer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { convertTheory } from './converters/proofwriter.mjs';

const sourcesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../datasets_sources');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../datasets');
const catalog = JSON.parse(fs.readFileSync(path.join(sourcesRoot, 'catalog.json')));
const entry = catalog.sources.find(source => source.id === 'proofwriter-structured');
const metadata = entry.metadata_url;
const endpoint = 'https://datasets-server.huggingface.co/rows';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = reason => { throw Error(reason); };

async function boundedJson(url, limit = 5 * 1024 * 1024) {
  const response = await fetch(url);
  if (!response.ok || Number(response.headers.get('content-length')) > limit) fail(`source_fetch_rejected_${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { await response.body.cancel().catch(() => {}); fail('source_response_exceeds_bound'); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function checkedRevision() {
  const info = await boundedJson(metadata);
  if (info.sha !== entry.revision || info.gated || info.private) fail('source_revision_or_access_changed');
}

async function acquire(limit, offset) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('limit_must_be_1_to_50');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 50000) fail('offset_must_be_0_to_50000');
  await checkedRevision();
  const request = `${endpoint}?dataset=rlhf-and-friends%2Fproofwriter&config=OWA&split=train&offset=${offset}&length=${limit}`;
  const response = await boundedJson(request);
  if (!Array.isArray(response.rows) || response.partial || response.rows.length !== limit) fail('source_rows_partial');
  await checkedRevision();
  return { request, items: response.rows };
}

export async function probeProofwriter({ limit = 8, offset = 0 } = {}) {
  const { request, items } = await acquire(limit, offset);
  let accepted = 0;
  const rejected = [];
  const examples = [];
  for (const item of items) {
    if (item.truncated_cells?.length) { rejected.push({ theory: item.row?.id ?? null, reason: 'source_cells_truncated' }); continue; }
    const raw = item.row;
    try {
      const result = convertTheory(raw, {
        uri: `${request}&source_row_idx=${item.row_idx}`,
        revision: entry.revision, sha256: hash(JSON.stringify(raw)), license: null
      });
      accepted += result.rows.length;
      rejected.push(...result.rejected);
      examples.push({ theory: raw.id, raw_sha256: hash(JSON.stringify(raw)), accepted_questions: result.rows.map(row => ({ id: row.source.original_id.question, source_answer: row.expected.status, generated_question: row.question, sop_target: row.sop_target })) });
    } catch (error) { rejected.push({ theory: raw?.id ?? null, reason: error.message }); }
  }
  return {
    source: entry.repository, revision: entry.revision, queried: items.length,
    accepted_in_memory: accepted, rejected, examples,
    rights: entry.license_review, written_to_normalized: false,
    note: 'Probe-only; source rights unresolved. Examples are ephemeral and not approved training rows.'
  };
}

/** Requires an independently reviewed, documented license in the catalog; currently blocked. */
export async function importProofwriter({ limit = 8, offset = 0 } = {}) {
  if (!entry.redistribution_approved || !entry.declared_license || !entry.license_url || !entry.license_evidence_url) fail('upstream_dataset_rights_unresolved');
  const { request, items } = await acquire(limit, offset);
  const rawPath = path.join(sourcesRoot, `proofwriter-structured/raw/structured-api-OWA-train-${offset}-${limit}.jsonl`);
  const rowsPath = path.join(root, `normalized/proofwriter-structured/review-candidates-${offset}-${limit}.jsonl`);
  const rejectPath = path.join(root, `normalized/proofwriter-structured/rejected-${offset}-${limit}.json`);
  if ([rawPath, rowsPath, rejectPath].some(file => fs.existsSync(file))) fail('import_paths_already_exist');
  const rows = [], rejected = [];
  for (const item of items) {
    if (item.truncated_cells?.length) { rejected.push({ theory: item.row?.id ?? null, reason: 'source_cells_truncated' }); continue; }
    const raw = item.row;
    try {
      const result = convertTheory(raw, {
        uri: `${request}&source_row_idx=${item.row_idx}`,
        revision: entry.revision, sha256: hash(JSON.stringify(raw)), license: entry.declared_license
      });
      rows.push(...result.rows.map(row => ({ ...row, source: { ...row.source, license_url: entry.license_url } })));
      rejected.push(...result.rejected);
    } catch (error) { rejected.push({ theory: raw?.id ?? null, reason: error.message }); }
  }
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  fs.mkdirSync(path.dirname(rowsPath), { recursive: true });
  fs.writeFileSync(rawPath, items.map(item => JSON.stringify(item.row)).join('\n') + '\n', { flag: 'wx' });
  fs.writeFileSync(rowsPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
  fs.writeFileSync(rejectPath, JSON.stringify({ source: entry.repository, revision: entry.revision, raw_path: path.relative(root, rawPath), accepted: rows.length, rejected }, null, 2) + '\n', { flag: 'wx' });
  return { source: entry.repository, revision: entry.revision, raw: path.relative(root, rawPath), review_candidates: path.relative(root, rowsPath), accepted: rows.length, rejected: rejected.length, rights: entry.license_review };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!['--probe', '--import'].includes(args[0]) || args[1] !== '--limit' || !/^[1-9]\d*$/.test(args[2]) || args.length !== 3 && (args.length !== 5 || args[3] !== '--offset' || !/^(0|[1-9]\d*)$/.test(args[4]))) fail('usage: node datasets/import-proofwriter.mjs (--probe|--import) --limit 8 [--offset 30000]');
  console.log(JSON.stringify(await (args[0] === '--probe' ? probeProofwriter : importProofwriter)({ limit: Number(args[2]), offset: args.length === 5 ? Number(args[4]) : 0 }), null, 2));
}
