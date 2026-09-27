#!/usr/bin/env node
// Licensed source scaffold only: no SQuAD answer span is a SOP target or model gold.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sourcesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../datasets_sources');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../datasets');
const url = 'https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v2.0.json';
const rawPath = path.join(sourcesRoot, 'squad2-dev/raw/dev-v2.0.json');
const outPath = path.join(root, 'normalized/squad2-dev/scaffold.jsonl');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw Error(reason); };

export function scaffold(original, { sha256, limit = 24 } = {}) {
  if (original.version !== 'v2.0' || !Array.isArray(original.data)) fail('unexpected_squad_version');
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail('missing_verified_source_hash');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('limit_must_be_1_to_1000');
  const items = [];
  for (const article of original.data) for (const paragraph of article.paragraphs) for (const question of paragraph.qas) {
    if (items.length === limit) return items;
    if (!question.id || typeof question.question !== 'string' || typeof paragraph.context !== 'string' || !Array.isArray(question.answers)) fail('incomplete_source_record');
    items.push({
      source: { id: 'squad2-dev', kind: 'source_scaffold', uri: url, revision: sha256, sha256,
        license: 'CC-BY-SA-4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode',
        original_id: question.id, article_title: article.title },
      question: question.question, context_text: paragraph.context,
      answer_spans: question.answers.map(a => ({ text: a.text, answer_start: a.answer_start })),
      is_impossible: question.is_impossible,
      semantic_status: 'pending_independent_semantic_mapping', sop_target: null,
      note: 'Source Q/A with passage only; neither an assertion-query row nor standalone SOP gold.'
    });
  }
  return items;
}

async function getBounded(url, maxBytes) {
  const response = await fetch(url);
  if (!response.ok) fail(`download_status_${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) fail('download_exceeds_bound');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) { await response.body.cancel().catch(() => {}); fail('download_exceeds_bound'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function importSquad({ limit = 24 } = {}) {
  if (fs.existsSync(rawPath) && fs.statSync(rawPath).size > 8 * 1024 * 1024) fail('cached_file_exceeds_bound');
  const bytes = fs.existsSync(rawPath) ? fs.readFileSync(rawPath) : await getBounded(url, 8 * 1024 * 1024);
  const sha256 = hash(bytes);
  const catalog = JSON.parse(fs.readFileSync(path.join(sourcesRoot, 'catalog.json'), 'utf8'));
  if (sha256 !== catalog.sources.find(source => source.id === 'squad2-dev')?.raw_sha256) fail('source_checksum_changed');
  const rows = scaffold(JSON.parse(bytes), { sha256, limit });
  if (!fs.existsSync(rawPath)) { fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.writeFileSync(rawPath, bytes, { flag: 'wx' }); }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return { raw: path.relative(path.dirname(sourcesRoot), rawPath), normalized: path.relative(path.dirname(root), outPath), sha256, rows: rows.length, status: 'source_scaffold_only' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--limit' || !/^[1-9]\d*$/.test(args[1])) fail('usage: node tools/datasets/import-squad.mjs --limit 24');
  console.log(JSON.stringify(await importSquad({ limit: Number(args[1]) })));
}
