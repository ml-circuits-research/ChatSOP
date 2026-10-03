#!/usr/bin/env node
/**
 * Ingestion v2 for experiment eval-ingest-v1 (status/preregistrations/eval-ingest-v1.json): builds the base memory of a document with
 * the task template ingest-document of TinyAgent's job runner, version v2 (lib/ingest/v2), so the measured path is the product's job path.
 *
 *   node tools/eval/ingest-v2.mjs build --doc handbook|europa [--base ID] [--fresh] [--tier small] [--fol-tier T] [--merge-tier medium] [--chunk-bytes 3000]
 *        creates the base memory (default exp-ingest-<doc>-v2, importing core-min; --fresh deletes it first), runs the template and
 *        prints the task summary, the run's credits and calls from TinyAgent's run registry and the wall time
 *   node tools/eval/ingest-v2.mjs facts --base ID [--grep TEXT]     the stored knowledge of a base memory (for the failure analysis)
 *
 * Questions are then answered by the product's question path: node tools/eval/ingest-v1.mjs pipeline --doc D --base ID --tag v2.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProduct, DOCS} from './ingest-v1.mjs';
// The job runner of TinyAgent, run in this process (the sink writes into this process's memories); its model calls go to the
// TinyAgent server, tagged with the task's purpose and run.
import {runTask, loadConfig} from '../../TinyAgent/lib/jobs/index.mjs';
import {tinyAgent} from '../../lib/tinyagent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

async function build() {
  const doc = opt('--doc');
  if (!DOCS[doc]) throw new Error('--doc handbook|europa');
  const base = opt('--base', `exp-ingest-${doc}-v2`);
  const product = openProduct();
  const {memories} = product;
  const exists = fs.existsSync(path.join(memories.dir(base), 'manifest.json'));
  if (exists && args.includes('--fresh')) fs.rmSync(memories.dir(base), {recursive: true, force: true});
  if (!exists || args.includes('--fresh')) memories.create({id: base, name: `EXPERIMENT eval-ingest-v1: ${doc} (ingestion v2)`, strategy: 'sqlite', imports: ['core-min'],
    description: 'Experimental task-type base memory made by document ingestion v2 (structure pass, canonical vocabulary, FOL per sentence, converter; TinyAgent tiers); stored by the automated checks, no human review.'});
  const config = loadConfig({jobDir: ROOT});
  const file = path.join(ROOT, DOCS[doc].file);
  const params = {rights: 'cleared', version: 'v2', purpose: 'eval-ingest-v1 (questions over the document)', tier: opt('--tier', 'small'), merge_tier: opt('--merge-tier', 'medium'), ...(opt('--fol-tier') ? {fol_tier: opt('--fol-tier')} : {}), ...(opt('--chunk-bytes') ? {max_chunk_bytes: Number(opt('--chunk-bytes'))} : {})};
  const started = Date.now();
  const result = await runTask({instructions: `ingest ${doc} (eval-ingest-v1, v2)`, attachments: [{name: path.basename(file), path: file}], target: {kind: 'memory', id: base}, template: 'ingest-document', params, config,
    sinkContext: {memories, chatData: memories.chatData}, log: m => process.stderr.write(`[task] ${m}\n`)});
  const ms = Date.now() - started;
  let spent = null;
  try { spent = (await tinyAgent({purpose: 'job:ingest-document'}).stats()).jobs?.runs?.find(r => r.run === result.task)?.spent ?? null; } catch { /* statistics are optional here */ }
  console.log(result.summary);
  console.log(JSON.stringify({task: result.task, dir: path.relative(ROOT, result.dir), base, wall_s: Math.round(ms / 1000), tinyagent_spent: spent, usage: result.result?.usage ?? null}));
}

function facts() {
  const {memories} = openProduct();
  const base = opt('--base');
  const grep = opt('--grep');
  const text = memories.circuits(base).map(c => `# ${c.name}\n${c.text}`).join('\n');
  if (!grep) { process.stdout.write(text); return; }
  const blocks = text.split(/\n(?=@)/).filter(b => b.toLowerCase().includes(grep.toLowerCase()));
  process.stdout.write(blocks.join('\n') + '\n');
}

const command = args[0];
if (command === 'build') build().then(() => process.exit(0), e => { console.error(e.stack); process.exit(1); });
else if (command === 'facts') facts();
else { console.error('usage: node tools/eval/ingest-v2.mjs build --doc handbook|europa [--fresh] | facts --base ID [--grep T]'); process.exit(2); }
