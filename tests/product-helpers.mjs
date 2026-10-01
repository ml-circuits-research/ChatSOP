// A ChatSOP server with the chat data root, an administrator session and an API token, for the product-layer tests (DS031).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {Repository} from '../memory/repository.mjs';
import {createServer} from '../server/http.mjs';
import {Auth} from '../server/auth.mjs';
import {ChatData} from '../lib/chat-data/index.mjs';
import {closedPort, cookieOf, httpClient, lex, listen, repoPath, tempDir} from './helpers.mjs';

export const runtimeConfig = () => JSON.parse(fs.readFileSync(repoPath('config/runtime.json'), 'utf8'));
export const PASSWORD = 'product-test-password';
export const FAMILY = fs.readFileSync(repoPath('eval/smoke-reasoning/cases/03-rules-chaining/knowledge.sop'), 'utf8');
export const FAMILY_QUERY = fs.readFileSync(repoPath('eval/smoke-reasoning/cases/03-rules-chaining/query.sop'), 'utf8');

/** A mock formalizer endpoint answering every call with `sop`. */
export async function mockFormalizer(t, sop) {
  const calls = [];
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({data: [{id: 'mock'}]})); }
    let raw = '';
    for await (const part of req) raw += part;
    calls.push(JSON.parse(raw));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: typeof sop === 'function' ? sop(JSON.parse(raw)) : sop}, finish_reason: 'stop'}]}));
  });
  const endpoint = await listen(t, mock);
  return {url: endpoint + '/v1/chat/completions', model: 'mock', calls};
}

export async function productServer(t, {config = {}, formalizer = null, serverOptions = {}} = {}) {
  const root = tempDir(t, 'chatsop-product-');
  const runtime = runtimeConfig();
  const chatData = ChatData.open({chatData: {root: path.join(root, 'chat_data'), ...(config.chatData ?? {})}}, {});
  const repo = new Repository(path.join(root, 'state'));
  repo.init('demo');
  const auth = new Auth({file: path.join(root, 'state/auth.json')});
  const fz = formalizer ?? {url: `http://127.0.0.1:${await closedPort()}/v1/chat/completions`, model: 'mock'};
  const server = createServer({config: {promptProfile: 'formal', formalizer: fz, memory: runtime.memory, policy: {allowWrite: true}, ...config}, repo, lexicon: lex, auth, chatData, ...serverOptions});
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
