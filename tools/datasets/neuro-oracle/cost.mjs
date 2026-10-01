/** DeepSeek cost of the oracle tasks from the omp session files (~/.omp/agent/sessions/-work-ChatSOP/*.jsonl, message.usage.cost.total).
 *
 * A session is attributed to a task folder by the folder name in its first user message. The session files meter the
 * agent's own turns; the judge requests issued from the eval kernel with completion() are NOT in them, so their cost is
 * estimated from the item sizes and the price implied by the metered turns (deepseek-flash: input, output and cache-read
 * per million tokens as recorded in the usage records).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.omp/agent/sessions/-work-ChatSOP');
export const FOLDERS = ['neuro_english_targets', 'neuro_oracle_parse_judge', 'neuro_oracle_meaning_judge', 'resplit_parse_judge', 'resplit_neuro_targets'];

export function sessionCosts() {
  const out = Object.fromEntries(FOLDERS.map(f => [f, {sessions: 0, turns: 0, cost_usd: 0, input: 0, output: 0, cache_read: 0, price_per_m: null}]));
  if (!fs.existsSync(DIR)) return out;
  const price = {in: [0, 0], out: [0, 0], cr: [0, 0]}; // only the sessions of the oracle task folders count (others used other models)
  for (const name of fs.readdirSync(DIR).filter(n => n.endsWith('.jsonl'))) {
    const lines = fs.readFileSync(path.join(DIR, name), 'utf8').split('\n');
    let folder = null, turns = 0, cost = 0, input = 0, output = 0, cacheRead = 0;
    const local = {in: [0, 0], out: [0, 0], cr: [0, 0]};
    for (const line of lines) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      const m = r.message;
      if (!m) continue;
      if (!folder && m.role === 'user') { const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content); folder = FOLDERS.find(f => text.includes(f)) ?? null; }
      const u = m.usage;
      if (u?.cost) { turns++; cost += u.cost.total ?? 0; input += u.input ?? 0; output += u.output ?? 0; cacheRead += u.cacheRead ?? 0; local.in[0] += u.cost.input ?? 0; local.in[1] += u.input ?? 0; local.out[0] += u.cost.output ?? 0; local.out[1] += u.output ?? 0; local.cr[0] += u.cost.cacheRead ?? 0; local.cr[1] += u.cacheRead ?? 0; }
    }
    if (folder) { for (const k of Object.keys(price)) { price[k][0] += local[k][0]; price[k][1] += local[k][1]; } const o = out[folder]; o.sessions++; o.turns += turns; o.cost_usd += cost; o.input += input; o.output += output; o.cache_read += cacheRead; }
  }
  const per = ([c, n]) => (n ? (c / n) * 1e6 : null);
  for (const o of Object.values(out)) { o.cost_usd = Number(o.cost_usd.toFixed(4)); o.price_per_m = {input: per(price.in), output: per(price.out), cache_read: per(price.cr)}; }
  return out;
}

/** Estimated cost of `calls` kernel completion() calls: `systemChars` cached system prompt, `userChars` and `outputTokens` per call. */
export function estimateKernel({calls, systemChars, userChars, outputTokens}, p) {
  if (!p?.input) return null;
  const perCall = (userChars / 4) * p.input / 1e6 + (systemChars / 4) * p.cache_read / 1e6 + outputTokens * p.output / 1e6;
  return Number((calls * perCall).toFixed(3));
}
