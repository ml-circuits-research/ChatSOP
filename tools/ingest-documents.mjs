#!/usr/bin/env node
/**
 * Ingest documents into a base memory from the command line (DS022 "Ingesting documents into a base memory"; library lib/ingest/).
 *
 *   node tools/ingest-documents.mjs create-memory --id ID --name NAME [--imports core-min,...] [--description TEXT]
 *   node tools/ingest-documents.mjs draft  --memory ID (--file PATH ... --rights cleared|permissive-attribution|owner-provided [--url U] [--licence L] [--title T]
 *                                          | --manifest FILE.json) [--model zai/glm-5.3] [--purpose TEXT] [--max-chunk-bytes N] [--thinking LEVEL] [--timeout-seconds S] [--user NAME]
 *   node tools/ingest-documents.mjs label-entities --memory ID (--file PATH --rights R | --manifest F)   entity wires for unlabelled symbols only
 *   node tools/ingest-documents.mjs accept --memory ID --ingestion ING --by USER [--reason TEXT] [--only key,key]
 *   node tools/ingest-documents.mjs reject --memory ID --ingestion ING --by USER [--reason TEXT]
 *   node tools/ingest-documents.mjs report --memory ID --ingestion ING
 *   node tools/ingest-documents.mjs list   --memory ID
 *
 * The manifest is `[{file, title?, source: {rights, url?, licence?, attribution?}}]`. `--chat-data DIR` (or CHATSOP_CHAT_DATA) selects the
 * chat data root. Drafting runs the coding agent (omp) and stores nothing; `accept` is the explicit act that adds the circuits to the memory.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ChatData} from '../lib/chat-data/index.mjs';
import {BaseMemories} from '../lib/chat-data/memories.mjs';
import {Ingestions} from '../lib/ingest/index.mjs';
import {ompSettings} from '../lib/omp/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0];
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const all = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));

export function open({chatDataRoot = opt('--chat-data', process.env.CHATSOP_CHAT_DATA ?? null)} = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'runtime.json'), 'utf8'));
  if (chatDataRoot) config.chatData = {...config.chatData, root: path.resolve(chatDataRoot)};
  const chatData = ChatData.open(config, {}, ROOT);
  const memories = new BaseMemories({chatData, memory: config.memory});
  return {config, memories, ingestions: new Ingestions({memories})};
}

function documentsFromArgs() {
  const manifest = opt('--manifest');
  if (manifest) {
    const base = path.dirname(path.resolve(manifest));
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).map(d => ({name: path.basename(d.file), title: d.title, text: fs.readFileSync(path.resolve(base, d.file), 'utf8'), source: d.source}));
  }
  const source = {rights: opt('--rights'), url: opt('--url'), licence: opt('--licence'), attribution: opt('--attribution')};
  return all('--file').map(file => ({name: path.basename(file), title: opt('--title') ?? undefined, text: fs.readFileSync(file, 'utf8'), source}));
}

async function main() {
  const {config, memories, ingestions} = open();
  const memory = opt('--memory');
  if (command === 'create-memory') {
    const imports = (opt('--imports', '') ?? '').split(',').filter(Boolean);
    console.log(JSON.stringify(memories.create({id: opt('--id'), name: opt('--name'), description: opt('--description', ''), imports}), null, 2));
  } else if (command === 'draft') {
    const omp = ompSettings(config);
    const record = await ingestions.draft(memory, {documents: documentsFromArgs(), model: opt('--model', config.queryParser?.models?.[0] ?? null), purpose: opt('--purpose', ''), user: opt('--user', process.env.CHATSOP_ACTOR ?? null),
      maxChunkBytes: Number(opt('--max-chunk-bytes', 7000)), maxFixRounds: Number(opt('--max-fix-rounds', omp.maxFixRounds ?? 3)), bin: omp.bin, thinking: opt('--thinking', omp.thinking ?? null), timeoutMs: Number(opt('--timeout-seconds', 900)) * 1000,
      onProgress: p => process.stderr.write(`[ingest] ${p.document} chunk ${p.chunk}/${p.of}\n`)});
    console.log(JSON.stringify({id: record.id, status: record.status, totals: record.totals, report: path.join(ingestions.dir(memory, record.id), 'report.md')}, null, 2));
  } else if (command === 'label-entities') {
    const omp = ompSettings(config);
    const record = await ingestions.labelEntities(memory, {documents: documentsFromArgs(), model: opt('--model', config.queryParser?.models?.[0] ?? null), user: opt('--user', process.env.CHATSOP_ACTOR ?? null),
      bin: omp.bin, thinking: opt('--thinking', omp.thinking ?? null), timeoutMs: Number(opt('--timeout-seconds', 900)) * 1000, maxFixRounds: Number(opt('--max-fix-rounds', omp.maxFixRounds ?? 3))});
    console.log(JSON.stringify({id: record.id, status: record.status, totals: record.totals, report: path.join(ingestions.dir(memory, record.id), 'report.md')}, null, 2));
  } else if (command === 'accept') {
    const only = opt('--only') ? opt('--only').split(',') : null;
    const {outcome, memory: manifest} = ingestions.accept(memory, opt('--ingestion'), {approvedBy: opt('--by'), reason: opt('--reason', 'document ingestion'), only});
    console.log(JSON.stringify({outcome, memory: {id: manifest.id, circuits: manifest.circuits, facts: manifest.facts}}, null, 2));
  } else if (command === 'reject') {
    console.log(JSON.stringify(ingestions.reject(memory, opt('--ingestion'), {user: opt('--by'), reason: opt('--reason', '')}).status));
  } else if (command === 'report') {
    process.stdout.write(fs.readFileSync(path.join(ingestions.dir(memory, opt('--ingestion')), 'report.md'), 'utf8'));
  } else if (command === 'list') {
    console.log(JSON.stringify(ingestions.list(memory), null, 2));
  } else {
    console.error('usage: node tools/ingest-documents.mjs create-memory|draft|accept|reject|report|list ... (see the header of this file)');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.problems ? JSON.stringify({error: error.message, problems: error.problems}, null, 2) : error.stack); process.exit(1); });
