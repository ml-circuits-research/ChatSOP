#!/usr/bin/env node
/** Evaluation of the TranslatorService `gloss` mode (experiment eval-gloss-v1; no training). Uses the units and tools of the
 * LanguageProofingLLM evaluation (tools/eval/language-proofing-eval.mjs); outputs go to $LP_WORK (default eval/reports/current/gloss).
 *
 *   node tools/eval/gloss-eval.mjs gloss    --split S [--sample N] [--name gloss] [--senses 1|2] [--nospell]   # gloss every prompt; outputs/NAME__S.jsonl + gloss-events__S.jsonl
 *   node tools/eval/gloss-eval.mjs via      --split S [--sample N] --from gloss --name glossit2 --url URL      # send the gloss as the prompt to a llama-server (outputs/NAME__S.jsonl)
 *   node tools/eval/gloss-eval.mjs coverage --split S [--sample N] [--name gloss]                              # token coverage per kind, from the events
 *   node tools/eval/gloss-eval.mjs sample   --split S --n 50 --seed 3 [--kind ro|mixed] [--name gloss]         # a deterministic sample to read: prompt, gloss, target
 *
 * Scoring of an arm is the unchanged `node tools/eval/language-proofing-eval.mjs score --split S --name NAME` (clean-English gate, content, analysis gate).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {glossMessage} from '../../lib/translator-service/index.mjs';
import {loadSplit, WORK} from './language-proofing-eval.mjs';

const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
const tag = (split, sample) => (sample ? `${split}${sample}` : split);
const outputFile = (name, t) => path.join(WORK, 'outputs', `${name}__${t}.jsonl`);
const pct = (k, n) => (n ? Math.round(1000 * k / n) / 10 : null);

async function glossCommand(rows, t, o) {
  const lm = await createSymbolicLM({});
  const outs = [], events = [];
  for (const r of rows) {
    const g = await glossMessage(lm, r.prompt, {spell: !o.nospell, senses: Number(o.senses ?? 1)});
    outs.push({id: r.id, output: g.text, in_tokens: null, out_tokens: null, truncated: false, ms: Math.round(g.ms), device: 'cpu', mode: g.mode, language: g.language, stats: g.stats});
    events.push({id: r.id, kind: r.kind, events: g.events});
  }
  writeJsonl(outputFile(o.name ?? 'gloss', t), outs);
  writeJsonl(path.join(WORK, `${o.name ?? 'gloss'}-events__${t}.jsonl`), events);
  const ms = outs.map(x => x.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({split: t, rows: rows.length, median_ms: ms[Math.floor(ms.length / 2)], p95_ms: ms[Math.floor(ms.length * 0.95)]}));
}

async function viaCommand(rows, t, o) {
  const identity = o.from === 'identity';
  const src = identity ? new Map() : new Map(readJsonl(outputFile(o.from ?? 'gloss', t)).map(r => [r.id, r]));
  const records = [];
  for (const r of rows) {
    const text = identity ? r.prompt : src.get(r.id).output;
    const t0 = Date.now();
    const res = await fetch(`${o.url.replace(/\/$/, '')}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: text}], temperature: 0, top_k: 1, seed: 0, cache_prompt: false, max_tokens: 400})});
    if (!res.ok) throw Error(`endpoint ${res.status}`);
    const data = await res.json(), choice = data.choices?.[0];
    records.push({id: r.id, output: String(choice?.message?.content ?? '').trim(), in_tokens: data.usage?.prompt_tokens ?? null, out_tokens: data.usage?.completion_tokens ?? null, truncated: choice?.finish_reason === 'length', ms: Date.now() - t0, device: 'llama-server-cpu'});
  }
  writeJsonl(outputFile(o.name, t), records);
  const ms = records.map(x => x.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({split: t, rows: rows.length, median_ms: ms[Math.floor(ms.length / 2)], p95_ms: ms[Math.floor(ms.length * 0.95)]}));
}

function coverage(rows, t, o) {
  const kindOf = new Map(rows.map(r => [r.id, r.kind]));
  const ev = readJsonl(path.join(WORK, `${o.name ?? 'gloss'}-events__${t}.jsonl`));
  const by = {}, unknown = new Map();
  for (const e of ev) {
    const k = kindOf.get(e.id) ?? 'all';
    for (const key of [k, 'all']) {
      const b = (by[key] ??= {rows: 0, content: 0, translated: 0, unknown: 0, english: 0, names: 0, fn: 0, mismatch: 0});
      if (key === k) b.rows++; else if (key === 'all') b.rows++;
      for (const x of e.events) {
        if (x.kind === 'tr') { b.content++; b.translated++; if (x.mismatch) b.mismatch++; }
        else if (x.kind === 'unk') b.content++, b.unknown++;
        else if (x.kind === 'en') b.english++;
        else if (x.kind === 'name') b.names++;
        else if (x.kind === 'fn') b.fn++;
      }
    }
    for (const x of e.events) if (x.kind === 'unk') unknown.set(x.ro.toLowerCase(), (unknown.get(x.ro.toLowerCase()) ?? 0) + 1);
  }
  const table = Object.fromEntries(Object.entries(by).map(([k, b]) => [k, {...b, translated_pct: pct(b.translated, b.content), unknown_pct: pct(b.unknown, b.content)}]));
  const top = [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const res = {split: t, name: o.name ?? 'gloss', table, top_unknown: top};
  fs.writeFileSync(path.join(WORK, 'scores', `coverage-${o.name ?? 'gloss'}__${t}.json`), JSON.stringify(res, null, 1) + '\n');
  console.log(JSON.stringify(res, null, 1));
}

function sample(rows, t, o) {
  const outs = new Map(readJsonl(outputFile(o.name ?? 'gloss', t)).map(r => [r.id, r]));
  let pool = rows.filter(r => !o.kind || r.kind === o.kind);
  let s = Number(o.seed ?? 1) >>> 0;
  const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const picked = idx.slice(0, Number(o.n ?? 50)).map(i => pool[i]);
  const rowsOut = picked.map(r => ({id: r.id, kind: r.kind, prompt: r.prompt, gloss: outs.get(r.id)?.output, target: r.target}));
  writeJsonl(path.join(WORK, `sample-${o.name ?? 'gloss'}-${t}-${o.kind ?? 'all'}-${o.n ?? 50}.jsonl`), rowsOut);
  for (const r of rowsOut) console.log(`[${r.kind}] ${r.prompt}\n   GLOSS  ${r.gloss}\n   TARGET ${r.target}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2), o = args(rest);
  const n = o.sample ? Number(o.sample) : null, t = tag(o.split, n);
  const rows = loadSplit(o.split, n);
  fs.mkdirSync(path.join(WORK, 'scores'), {recursive: true});
  if (command === 'gloss') await glossCommand(rows, t, o);
  else if (command === 'via') await viaCommand(rows, t, o);
  else if (command === 'coverage') coverage(rows, t, o);
  else if (command === 'sample') sample(rows, t, o);
  else throw Error('usage: gloss-eval.mjs gloss|via|coverage|sample ...');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
