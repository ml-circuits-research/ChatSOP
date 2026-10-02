#!/usr/bin/env node
/**
 * One trial worker of the knowledge-mining pipeline (tools/knowledge-mining/mine.mjs): runs book problems through the product chat turn
 * (tools/eval/books/system.mjs, strategy LocalLLMDirect on the remote default model) over a private fork of the chat's default base
 * memory with extra knowledge circuits added, and appends one record per problem.
 *
 *   node tools/knowledge-mining/trial.mjs --ids a,b --out records.jsonl --tag baseline [--layer f1.sop,f2.sop] [--base world-v1]
 *
 * The fork (`tmp-mining-<pid>`) is a hard-link clone of the base; the layer files are validated and added with `addKnowledge` (the same
 * validator as every base-memory addition); the fork is deleted at the end, also on failure. Every proxy call of this process carries
 * `x-client-name: knowledge-mining-trial`, so its cost is read from the proxy log.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ChatData} from '../../lib/chat-data/index.mjs';
import {BaseMemories} from '../../lib/chat-data/memories.mjs';
import {openChatTurn} from '../eval/books/system.mjs';
import {attribution} from '../eval/books/attribution.mjs';
import {loadItems} from '../eval/books/sample.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TRIAL_CLIENT = 'knowledge-mining-trial';
const PROXY = /^https?:\/\/(127\.0\.0\.1|localhost):18080\//;

/** Tags every request to the local proxy with this tool's client name (cost attribution in the proxy log). */
export function tagProxyCalls(client = TRIAL_CLIENT) {
  const original = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => {
    if (!PROXY.test(String(url))) return original(url, init);
    const headers = new Headers(init.headers ?? {});
    headers.set('x-client-name', client);
    return original(url, {...init, headers});
  };
}

/** The circuits of the layer files, as base-memory additions: [{name, text}]. */
export const layerCircuits = files => files.filter(Boolean).map(f => ({name: path.basename(f, '.sop'), text: fs.readFileSync(f, 'utf8')}));

export async function runTrial({ids, out, tag, layer = [], base = 'world-v1'}) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'runtime.json'), 'utf8'));
  const memories = new BaseMemories({chatData: ChatData.open(config, {}, ROOT), memory: config.memory});
  const items = new Map(loadItems(ROOT).map(i => [i.id, i]));
  const forkId = `tmp-mining-${process.pid}`;
  if (memories.list().some(m => m.id === forkId)) memories.delete(forkId);
  memories.fork(base, {name: 'knowledge-mining trial', newId: forkId, description: 'temporary fork of a knowledge-mining trial; deleted at the end'});
  let system = null;
  try {
    const circuits = layerCircuits(layer);
    if (circuits.length) memories.addKnowledge(forkId, {circuits, approvedBy: 'knowledge-mining', reason: `trial ${tag}`});
    system = await openChatTurn({base: forkId, strategy: 'LocalLLMDirect'});
    for (const id of ids) {
      const item = items.get(id);
      if (!item) throw new Error(`unknown problem id ${id}`);
      const r = await system.ask(item.question);
      const rec = {tag, id, book: item.book, area: item.area, gold: item.answer, gold_kind: item.answer_kind, gold_value: item.answer_value, arm: 'remote-direct',
        ms: r.ms, ok: r.ok, text: r.text ?? null, error: r.error ?? null, system: attribution(r), sop: r.sop ?? null, at: new Date().toISOString()};
      fs.appendFileSync(out, JSON.stringify(rec) + '\n');
      console.error(`[trial ${tag}] ${id} ${r.ok ? r.packet?.status : 'ERR ' + r.error?.code} ${r.ms} ms`);
    }
  } finally {
    await system?.close();
    memories.delete(forkId);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const list = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
  tagProxyCalls();
  await runTrial({ids: list(opt('ids')), out: path.resolve(opt('out')), tag: opt('tag', 'trial'), layer: list(opt('layer')), base: opt('base', 'world-v1')});
}
