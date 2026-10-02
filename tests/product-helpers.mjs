// A ChatSOP server with the chat data root, an administrator session and an API token, for the product-layer tests (DS022).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Repository} from '../memory/repository.mjs';
import {createServer} from '../server/http.mjs';
import {Auth} from '../server/auth.mjs';
import {ChatData} from '../lib/chat-data/index.mjs';
import {BaseMemories, ensureDefaultBase} from '../lib/chat-data/memories.mjs';
import {ensureReplyMemory} from '../lib/chat-data/composer.mjs';
import {cookieOf, httpClient, lex, listen, repoPath, tempDir, stubQueryParser} from './helpers.mjs';

export const runtimeConfig = () => JSON.parse(fs.readFileSync(repoPath('config/runtime.json'), 'utf8'));

// Building the seed memories of a fresh chat data root takes about a minute (commonsense-v1, the conversation collections), and
// every product test used to pay it. The built root is cached once per content of what shapes it (the seeds, the runtime
// configuration and the memory and chat-data code) under the system temp directory and copied into each test's root.
const TEMPLATE_INPUTS = ['config/knowledge', 'config/runtime.json', 'memory', 'lib/chat-data', 'lib/knowledge-seeds.mjs', 'sop'];
function inputsHash() {
  const hash = createHash('sha256');
  const walk = rel => {
    const abs = repoPath(rel);
    const stat = fs.statSync(abs, {throwIfNoEntry: false});
    if (!stat) return;
    if (stat.isDirectory()) { for (const name of fs.readdirSync(abs).sort()) walk(path.join(rel, name)); return; }
    hash.update(rel + '\0'); hash.update(fs.readFileSync(abs));
  };
  for (const rel of TEMPLATE_INPUTS) walk(rel);
  return hash.digest('hex').slice(0, 16);
}
let templateDir = null;
export function seededChatDataTemplate() {
  if (templateDir) return templateDir;
  const final = path.join(os.tmpdir(), `chatsop-seed-template-${inputsHash()}`);
  if (!fs.existsSync(final)) {
    const building = fs.mkdtempSync(final + '-building-');
    const runtime = runtimeConfig();
    const chatData = ChatData.open({chatData: {root: path.join(building, 'chat_data')}}, {});
    const memories = new BaseMemories({chatData, memory: runtime.memory});
    ensureDefaultBase(memories, {memory: runtime.memory});
    ensureReplyMemory(memories, runtime);
    try { fs.renameSync(building, final); } catch { fs.rmSync(building, {recursive: true, force: true}); } // another file built it first
  }
  return (templateDir = final);
}
export const PASSWORD = 'product-test-password';
export const FAMILY = fs.readFileSync(repoPath('eval/smoke-reasoning/cases/03-rules-chaining/knowledge.sop'), 'utf8');
export const FAMILY_QUERY = fs.readFileSync(repoPath('eval/smoke-reasoning/cases/03-rules-chaining/query.sop'), 'utf8');

export {STUB_QUERY, stubQueryParser} from './helpers.mjs';

/**
 * The product server with the chat data root, an administrator session and an API token. The request parser is `stubQueryParser()` unless
 * `serverOptions.queryParser` says otherwise (the omp tests pass a real parser over a stub omp binary).
 */
export async function productServer(t, {config = {}, serverOptions = {}} = {}) {
  const root = tempDir(t, 'chatsop-product-');
  const runtime = runtimeConfig();
  if (!config.chatData?.root) fs.cpSync(path.join(seededChatDataTemplate(), 'chat_data'), path.join(root, 'chat_data'), {recursive: true});
  const chatData = ChatData.open({chatData: {root: path.join(root, 'chat_data'), ...(config.chatData ?? {})}}, {});
  const repo = new Repository(path.join(root, 'state'));
  repo.init('demo');
  const auth = new Auth({file: path.join(root, 'state/auth.json')});
  const server = createServer({config: {memory: runtime.memory, policy: {allowWrite: true}, ...config}, repo, lexicon: lex, auth, chatData, queryParser: stubQueryParser(), authorChat: stubAuthorChat(), feedback: {dir: path.join(root, 'feedback'), inbox: path.join(root, 'formalization-inbox.jsonl')}, ...serverOptions});
  const base = await listen(t, server);
  const call = httpClient(base);
  const setup = await call('/admin/setup', {method: 'POST', body: {password: PASSWORD}});
  const cookie = cookieOf(setup);
  const {token} = auth.mintToken('product-test');
  const as = {admin: opts => call(opts.route, {...opts, cookie}), user: opts => call(opts.route, {...opts, bearer: token})};
  const admin = (route, method = 'GET', body) => call(route, {method, body, cookie});
  const user = (route, method = 'GET', body) => call(route, {method, body, bearer: token});
  return {root, chatData, server, base, call, cookie, token, admin, user, as, auth, repo};
}

/**
 * A stub of the direct authoring model (lib/ingest/direct-author.mjs `chat`): answers with `knowledge` (default FAMILY) in the three
 * delimited blocks, records each call in `calls`, and costs 0.0025 USD per call. No test calls a real model.
 */
export function stubAuthorChat({knowledge = FAMILY, replies = null, calls = []} = {}) {
  const chat = async ({messages, model}) => {
    calls.push({model, messages});
    const text = replies ? replies(calls.length, messages) : `=== BEGIN knowledge.sop ===\n${knowledge}\n=== END knowledge.sop ===\n=== BEGIN queries.sop ===\n=== END queries.sop ===\n=== BEGIN report.md ===\nStub report.\n=== END report.md ===\n`;
    return {ok: true, text, finish_reason: 'stop', ms: 1, usage: {input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cost_usd: 0.0025}};
  };
  chat.calls = calls;
  return chat;
}

