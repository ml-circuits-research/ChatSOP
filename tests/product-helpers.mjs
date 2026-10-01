// A ChatSOP server with the chat data root, an administrator session and an API token, for the product-layer tests (DS031).
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../memory/repository.mjs';
import {createServer} from '../server/http.mjs';
import {loadRegistry, ModelManager} from '../server/formalizers.mjs';
import {Auth} from '../server/auth.mjs';
import {ChatData} from '../lib/chat-data/index.mjs';
import {cookieOf, httpClient, lex, listen, repoPath, tempDir} from './helpers.mjs';

export const runtimeConfig = () => JSON.parse(fs.readFileSync(repoPath('config/runtime.json'), 'utf8'));
export const PASSWORD = 'product-test-password';
export const FAMILY = fs.readFileSync(repoPath('eval/smoke-reasoning/cases/03-rules-chaining/knowledge.sop'), 'utf8');
export const FAMILY_QUERY = fs.readFileSync(repoPath('eval/smoke-reasoning/cases/03-rules-chaining/query.sop'), 'utf8');

/**
 * The product server with a registry whose only model is the stub SymbolicLM service (tests/fixtures/capability-api/stub-symbolic-service.mjs:
 * it answers every message with the same question, "Does Ana like Alpha Lab?"), the one formalizer of the product.
 */
export async function productServer(t, {config = {}, serverOptions = {}} = {}) {
  const root = tempDir(t, 'chatsop-product-');
  const runtime = runtimeConfig();
  const chatData = ChatData.open({chatData: {root: path.join(root, 'chat_data'), ...(config.chatData ?? {})}}, {});
  const repo = new Repository(path.join(root, 'state'));
  repo.init('demo');
  const auth = new Auth({file: path.join(root, 'state/auth.json')});
  const registryFile = path.join(root, 'formalizers.json');
  fs.writeFileSync(registryFile, JSON.stringify({default: 'symbolic-lm', models: [{id: 'symbolic-lm', label: 'SymbolicLM (stub)', service: repoPath('tests/fixtures/capability-api/stub-symbolic-service.mjs'), capabilities: ['formalize'], rewrite: {mode: 'off'}}]}));
  const registry = loadRegistry(registryFile, {root});
  const manager = new ModelManager({registry, logDir: null});
  t.after(() => manager.stopAll());
  const server = createServer({config: {memory: runtime.memory, policy: {allowWrite: true}, ...config}, repo, lexicon: lex, auth, chatData, formalizers: {registry, manager}, ...serverOptions});
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
