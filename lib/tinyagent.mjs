/**
 * ChatSOP's access to models (owner, 2026-10-03): every model call of the project goes through the TinyAgent server
 * (TinyAgent/README.md), by tier name, tagged with a purpose; no module of the project calls a model endpoint itself
 * (tests/tinyagent/no-direct-model-calls.test.mjs). The server runs once per machine on http://127.0.0.1:18080 (TINYAGENT_URL); a client
 * starts it when none answers, with ChatSOP's configuration layer config/tinyagent.json.
 *
 *   const ta = tinyAgent({purpose: 'formalize'});
 *   const r = await ta.chat({tier: 'tiny', messages, maxTokens: 400, temperature: 0});   // {ok, text, finish, cut, served, cached, ...}
 *
 * `fetchImpl` is the transport (tests pass a fake that answers the TinyAgent HTTP API).
 */
import {fileURLToPath} from 'node:url';
import {createTinyAgent} from '../TinyAgent/lib/client.mjs';

export {jsonOf, stripThinking, TinyAgentUnavailable} from '../TinyAgent/lib/client.mjs';
export const TINYAGENT_CONFIG = fileURLToPath(new URL('../config/tinyagent.json', import.meta.url));

/** A TinyAgent client for ChatSOP (`purpose` required: chat, formalize, answer-*, ingest, job:<name>, review:<run>, lambda:<name>, test:<name>). */
export function tinyAgent({purpose, run = null, client = null, cache = null, fetchImpl = null, url = null, autostart = null} = {}) {
  return createTinyAgent({purpose, run, client, cache, fetchImpl, url, autostart, config: TINYAGENT_CONFIG});
}

/** Whether the server serves `tier` (from its tier list), with the reason when it does not; never starts anything. */
export async function tierReadiness(tier, {fetchImpl = null, url = null} = {}) {
  const ta = tinyAgent({purpose: 'chat', fetchImpl, url, autostart: false});
  for (const wait of [1, 3]) {
    try {
      const tiers = await Promise.race([ta.tiers(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000 * wait))]);
      const item = Array.isArray(tiers) ? tiers.find(t => t === tier || t?.id === tier) : null;
      if (item && !item.x_tier?.error) return {available: true};
      return {available: false, reason: item?.x_tier?.error ?? `the TinyAgent server has no tier ${tier}`};
    } catch (error) {
      if (error?.code === 'tinyagent_unavailable') return {available: false, reason: error.message};
    }
  }
  return {available: false, reason: 'the TinyAgent server did not answer in time'};
}
