#!/usr/bin/env node
/** Wrapper-variant generalization check of rules v2.0 (experiment eval-symbolic-accurate-adopt-v1, deviation D1).
 *
 *   node tools/research/rules-v2-variants.mjs run [--rules live|v2.0] [--per 3]
 *
 * The development rows that open with a wrapper ("Do you know", "Tell me", "I wonder", ...) are rewritten with the other
 * wrappers around the same inner clause. The gold SOP of the source row stays the gold of every variant (the wrapper
 * carries no content), so both systems can be scored strictly on sentences whose phrasing was not seen in the
 * development rows: A (frozen rules v1.6 + default package) against B (`--rules`: live or frozen rules + accurate
 * package). Only train and dev rows (never the sealed test) are used; the variants are regenerable observations.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {StanzaWorker} from '../../lib/ud-to-sop/stanza.mjs';
import {strictScores} from '../datasets/three-datasets/score.mjs';
import {loadFrozenRules} from './proofing-oracle.mjs';
import {maskMessage as liveMask, convertParse as liveConvert} from '../../lib/ud-to-sop/index.mjs';
import {devRecords, OUT} from './rules-v2-dev.mjs';

const WRAPPERS = [
  {text: 'Do you know', ask: true}, {text: 'Can you tell me', ask: true}, {text: 'Could you check', ask: true}, {text: 'Can you check', ask: true}, {text: 'Could you tell me', ask: true},
  {text: 'Tell me', ask: false}, {text: 'I wonder', ask: false}, {text: "I'd like to know", ask: false}, {text: 'I need to know', ask: false}, {text: 'Remind me', ask: false}, {text: 'I was wondering', ask: false},
  {text: 'Can you confirm', ask: true, that: true}, {text: 'Could you confirm', ask: true, that: true}, {text: 'Can you verify', ask: true, that: true}, {text: 'Is it true', ask: true, that: true}, {text: 'Is it correct', ask: true, that: true},
];
const args = argv => { const o = {command: argv[0]}; for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
const sha = t => createHash('sha1').update(t).digest('hex').slice(0, 12);

/** Variants of the development rows: {id, source, message, wrapper}. */
export function variants(records, per = 3) {
  const out = [];
  const opener = new RegExp('^(' + WRAPPERS.map(w => w.text.replace(/'/g, "['’]")).join('|') + ')\\s+(?=(why|when|where|how|who|whom|what|which|since when|until when|whether|if|that)\\b)', 'i');
  for (const r of records) {
    if (/\n|[.?!].+[.?!]\s*$/.test(r.message.trim())) continue; // one sentence only
    const m = opener.exec(r.message);
    if (!m) continue;
    const inner = r.message.slice(m[0].length).replace(/[?.!]+\s*$/, '');
    const own = WRAPPERS.find(w => w.text.toLowerCase() === m[1].toLowerCase().replace('’', "'"));
    const thatClause = /^that\b/i.test(inner);
    const pool = WRAPPERS.filter(w => w !== own && Boolean(w.that) === thatClause);
    const start = parseInt(sha(r.sourceId).slice(0, 6), 16);
    for (let i = 0; i < per; i++) {
      const w = pool[(start + i * 3) % pool.length];
      out.push({id: `${r.corpus}::${r.sourceId}#${i}`, source: r, message: `${w.text} ${inner}${w.ask ? '?' : '.'}`, wrapper: w.text});
    }
  }
  return out;
}

async function parseAll(pkg, texts) {
  const file = path.join(OUT, `variant-parses-${pkg}.json`);
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const todo = [...new Set(texts)].filter(t => !cache[sha(t)]);
  if (todo.length) {
    const w = new StanzaWorker({device: 'cuda', package: pkg});
    try { for (let i = 0; i < todo.length; i += 64) { const chunk = todo.slice(i, i + 64); const {parses} = await w.parseMany(chunk, chunk.map(() => 'en')); chunk.forEach((t, j) => { cache[sha(t)] = parses[j]; }); } } finally { await w.stop(); }
    fs.writeFileSync(file, JSON.stringify(cache));
  }
  return cache;
}

async function run(o) {
  const src = devRecords('dev').filter(r => r.split === 'train' || r.split === 'dev');
  const vs = variants(src, Number(o.per ?? 3));
  const A = await loadFrozenRules('v1.6');
  const B = o.rules && o.rules !== 'live' ? await loadFrozenRules(o.rules) : {maskMessage: liveMask, convertParse: liveConvert};
  const cacheA = await parseAll('default', vs.map(v => A.maskMessage(v.message)));
  const cacheB = await parseAll('accurate', vs.map(v => B.maskMessage(v.message)));
  const sop = (rules, cache, v) => { try { return rules.convertParse(cache[sha(rules.maskMessage(v.message))], v.message).sop; } catch { return ''; } };
  const records = vs.map(v => ({corpus: 'variant', sourceId: v.id, wild: false, row: v.source.row, message: v.message}));
  const outA = new Map(vs.map(v => [v.id, sop(A, cacheA, v)])), outB = new Map(vs.map(v => [v.id, sop(B, cacheB, v)]));
  const sa = await strictScores(records, r => outA.get(r.sourceId)), sb = await strictScores(records, r => outB.get(r.sourceId));
  let a = 0, b = 0, gained = 0, lost = 0;
  const lostRows = [];
  for (const v of vs) { const ka = sa.get(`variant::${v.id}`).ok, kb = sb.get(`variant::${v.id}`).ok; a += ka; b += kb; if (kb && !ka) gained++; if (ka && !kb) { lost++; lostRows.push(v); } }
  console.log(`variants ${vs.length}: A ${(100 * a / vs.length).toFixed(2)}%  B ${(100 * b / vs.length).toFixed(2)}%  gained ${gained} lost ${lost}`);
  const byWrapper = {};
  for (const v of vs) { const w = byWrapper[v.wrapper] ??= {n: 0, a: 0, b: 0}; w.n++; w.a += sa.get(`variant::${v.id}`).ok; w.b += sb.get(`variant::${v.id}`).ok; }
  for (const [w, x] of Object.entries(byWrapper)) console.log(`  ${w.padEnd(20)} n ${String(x.n).padStart(4)}  A ${(100 * x.a / x.n).toFixed(1)}  B ${(100 * x.b / x.n).toFixed(1)}`);
  fs.writeFileSync(path.join(OUT, 'variants-lost.json'), JSON.stringify(lostRows.map(v => ({id: v.id, message: v.message, qt: v.source.questionType, a: outA.get(v.id), b: outB.get(v.id)})), null, 1));
  const seen = new Set();
  for (const v of lostRows) { const t = v.message.replace(/\b[A-Z][\w&.'’-]*\b/g, 'X').slice(0, 70); if (seen.has(t)) continue; seen.add(t); if (seen.size > Number(o.show ?? 25)) break; console.log('LOST', JSON.stringify(v.message)); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  run(o).catch(e => { console.error(e.stack); process.exit(1); });
}
