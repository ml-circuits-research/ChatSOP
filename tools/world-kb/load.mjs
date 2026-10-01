/**
 * Loads the built world-v1 circuits (datasets_sources/world-kb/circuits/) into the base memory `world-v1` through the
 * product library (lib/chat-data/memories.mjs: validation, facts into the SQLite strategy, provenance). Administrator action:
 * the approver is named by --approved-by (default worldkb-agent, recorded as the loader, not as an independent review).
 *   node tools/world-kb/load.mjs [--id world-v1] [--strategy sqlite] [--exact] [--replace] [--chunk 30]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ChatData} from '../../lib/chat-data/index.mjs';
import {BaseMemories} from '../../lib/chat-data/memories.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const id = opt('--id', 'world-v1');
const strategy = opt('--strategy', 'sqlite');
const chunk = Number(opt('--chunk', 30));
const config = JSON.parse(fs.readFileSync(path.join(project, 'config/runtime.json'), 'utf8'));
const memories = new BaseMemories({chatData: ChatData.open(config), memory: config.memory});
if (args.includes('--replace') && memories.list().some(m => m.id === id)) memories.delete(id);
const dir = path.join(project, 'datasets_sources', 'world-kb', 'circuits');
const circuits = fs.readdirSync(dir).filter(f => f.endsWith('.sop')).sort().map(f => ({name: f.replace(/^\d+-/, '').replace(/\.sop$/, ''), text: fs.readFileSync(path.join(dir, f), 'utf8')}));
const t0 = Date.now();
memories.create({id, name: 'World knowledge v1 (Wikidata subset)', strategy, exact: args.includes('--exact'),
  description: 'A small encyclopedia mechanically built from a Wikidata subset (CC0): countries, capitals, cities, languages, currencies, famous people, organizations, chemical elements, planets, notable works. Open-world: nothing is closed. See docs/specs/DS031.'});
const by = opt('--approved-by', 'worldkb-agent');
let facts = 0, skipped = 0, warnings = 0;
for (let i = 0; i < circuits.length; i += chunk) {
  const r = memories.addKnowledge(id, {circuits: circuits.slice(i, i + chunk), approvedBy: by, reason: 'world-v1 initial load (mechanical Wikidata mapping)', source: 'Wikidata (CC0) via WDQS, tools/world-kb'});
  for (const a of r.added) { facts += a.ingest.facts_ingested; skipped += a.ingest.facts_skipped.length; }
  warnings += r.warnings.length;
  console.error(`circuits ${Math.min(i + chunk, circuits.length)}/${circuits.length} facts ${facts} skipped ${skipped} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(JSON.stringify({id, strategy, circuits: circuits.length, facts_ingested: facts, facts_skipped: skipped, warnings, seconds: (Date.now() - t0) / 1000, manifest: memories.manifest(id)}, null, 2));
