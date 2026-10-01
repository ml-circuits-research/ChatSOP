/**
 * Polite Wikidata Query Service client for the world-v1 base memory (tools/world-kb/).
 * One request at a time, a descriptive User-Agent, a minimum gap between requests, retries with back-off on 429/5xx/timeouts,
 * and a raw-response cache under datasets_sources/world-kb/raw/ (gitignored) so a repeated run costs nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RAW = path.join(ROOT, 'datasets_sources', 'world-kb', 'raw');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'ChatSOP-worldkb/0.1 (https://github.com/axiologic; research@axiologic.net) node-fetch';
const GAP_MS = 2500;
let last = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Runs a SPARQL SELECT and returns the bindings flattened to plain strings; `name` names the cache file. */
export async function sparql(name, query, {timeoutMs = 90000, retries = 4} = {}) {
  fs.mkdirSync(RAW, {recursive: true});
  const file = path.join(RAW, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).rows;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({query}).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        const retry = Number(res.headers.get('retry-after')) || 15 * (attempt + 1);
        console.error(`[wdqs] ${name}: HTTP ${res.status}, waiting ${retry}s`);
        await sleep(retry * 1000);
        last = Date.now();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      const rows = json.results.bindings.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
      fs.writeFileSync(file, JSON.stringify({name, fetched_at: new Date().toISOString(), query, rows}));
      return rows;
    } catch (error) {
      console.error(`[wdqs] ${name}: ${error.message} (attempt ${attempt + 1})`);
      await sleep(10000 * (attempt + 1));
      last = Date.now();
    }
  }
  throw new Error(`wdqs: ${name} failed`);
}
export const qid = uri => uri?.replace('http://www.wikidata.org/entity/', '');
