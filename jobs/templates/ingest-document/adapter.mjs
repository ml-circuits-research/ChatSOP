/**
 * Adapter of the ingest-document template: wraps the product's direct ingestion (lib/ingest Ingestions.draft) without rewriting it.
 * The model is the template's tier name on the endpoint's default route (LLMAPIProvider tiers); every call carries the task's purpose
 * and run id through the tagged fetch the runner passes.
 */
import fs from 'node:fs';
import {Ingestions, openaiChat} from '../../../lib/ingest/index.mjs';
import {ChatData, chatDataSettings} from '../../../lib/chat-data/index.mjs';
import {BaseMemories} from '../../../lib/chat-data/memories.mjs';

export async function run({params, attachments, target, endpoint, fetchImpl, log = () => {}, context = {}}) {
  if (target?.kind !== 'memory' || !target.id) throw new Error('ingest-document writes into a base memory: give a memory target');
  const memories = context.memories ?? new BaseMemories({chatData: new ChatData(chatDataSettings({}))});
  const documents = attachments.map(a => ({name: a.name, text: fs.readFileSync(a.path, 'utf8'), source: {rights: params.rights, ...(params.source_url ? {url: params.source_url} : {})}}));
  const chat = openaiChat({endpoint: `${String(endpoint).replace(/\/+$/, '')}/v1`, fetchImpl, purpose: null});
  const record = await new Ingestions({memories}).draft(target.id, {documents, model: params.tier, purpose: params.purpose ?? '', ...(params.max_chunk_bytes ? {maxChunkBytes: params.max_chunk_bytes} : {}), user: 'llm-jobs', author: 'direct', chat,
    onProgress: p => log(`ingest ${p.phase ?? ''} ${p.chunk ?? ''}`)});
  const t = record.totals ?? {};
  return {status: record.status === 'failed' ? 'failed' : 'finished', ingestion: record.id,
    summary: `ingestion ${record.id} into ${target.id}: ${record.status}; chunks ${record.chunks.length}; ${Object.entries(t).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(', ')}`};
}
