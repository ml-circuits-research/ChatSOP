#!/usr/bin/env node
/**
 * Developer harness for the UD -> SOP rules: parses messages with the Stanza worker (cached per message in
 * eval/reports/current/ud-rules-try/parses.json, so re-runs of the rules need no parser), prints the dependency tree (--tree)
 * and the SOP the rules write.
 *   node tools/ud-rules-try.mjs [--tree] [--device auto|cpu] "Message one." "Message two." | --file messages.txt
 * The device defaults to `cpu` (the GPU belongs to the single GPU worker; pass `auto` to use the parse auto-device lock).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {convertParse, maskMessage} from '../lib/ud-to-sop/index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = path.join(ROOT, 'eval/reports/current/ud-rules-try/parses.json');
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const messages = opt('--file') ? fs.readFileSync(opt('--file'), 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
  : args.filter((a, i) => !a.startsWith('--') && !['--device', '--file'].includes(args[i - 1]));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const todo = messages.filter(m => !cache[m]);
if (todo.length) {
  const {StanzaWorker} = await import('../lib/ud-to-sop/stanza.mjs');
  const worker = new StanzaWorker({device: opt('--device') ?? 'cpu'});
  try {
    const {parses} = await worker.parseMany(todo.map(maskMessage));
    todo.forEach((m, i) => { cache[m] = parses[i]; });
  } finally { await worker.stop(); }
  fs.mkdirSync(path.dirname(CACHE), {recursive: true});
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}
for (const m of messages) {
  console.log('== ' + m);
  const parse = cache[m];
  if (flag('--tree')) for (const s of parse.sentences) for (const w of s.words ?? s.tokens ?? []) console.log(`  ${w.id}\t${w.text}\t${w.lemma}\t${w.upos}\t${w.head}\t${w.deprel}\t${w.feats ? JSON.stringify(w.feats) : ''}`);
  const out = convertParse(parse, m);
  console.log(out.sop.trimEnd());
}
process.exit(0);
