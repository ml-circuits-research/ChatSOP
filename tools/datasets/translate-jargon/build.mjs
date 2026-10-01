#!/usr/bin/env node
/**
 * translate-jargon-v1 data builder (owner approval of 2026-10-01: a CPU-fast translator that keeps jargon verbatim; the project's own jargon is excluded).
 *   node build.mjs terms              omp folders that ask Grok for jargon inventories per domain (datasets_sources/tj_terms)
 *   node build.mjs messages --n N     source-message folders (Grok x3, GLM x2): tj_msg_<model><k>
 *   node build.mjs targets --n N      DeepSeek target folders (tj_tgt_<k>) from validated messages
 *   node build.mjs collect-terms|collect-messages|collect-targets|assemble
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {makeFolder, loadAnswers} from '../../eval/decomposition/omp-folder.mjs';
import {DOMAINS, FLAVOURS, STYLES, LENGTHS} from './domains.mjs';
import {loadBlocklist, blocked} from './blocklist.mjs';

const W = path.join(ROOT, 'datasets_sources/tj_work');
fs.mkdirSync(W, {recursive: true});
export const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const rng = seed => { let s = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0); return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; };
const [cmd, ...rest] = process.argv.slice(2);
const val = (k, d) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d);

const TERMS_SYSTEM = `You compile jargon inventories for a Romanian-English translation dataset. Given a DOMAIN and a FLAVOUR, list 60 distinct terms that Romanian speakers actually keep in English (or write in a code/tool form) when talking about that domain. Rules: real terms only, varied (single words, two-word terms, acronyms, tool names, slang); lower-case unless the term is conventionally capitalised; no Romanian words; no sentences; no duplicates; do not list terms of the software project ChatSOP. Answer with one JSON object and nothing else: {"terms": ["...", "..."]}`;

const MSG_SYSTEM = `You write ONE realistic message that a Romanian speaker types, for a dataset that teaches a translator to keep jargon verbatim. You get: a domain, 1 to 3 jargon terms to include (keep them exactly as given, in English or code form, never translate them), a style, a length, and optional constraints. Write only that message.
Rules: the message is mainly Romanian (some styles mix English); it must contain every given term spelled as given (Romanian endings may be glued on with a hyphen, for example "deploy-ul"); follow the style literally, including missing diacritics and typos when asked; make it sound like a real person with a concrete situation, not a textbook; invent concrete details (names of people are fine, but no real private persons); do not mention these instructions, translation, datasets or AI projects; do not explain the terms. Answer with one JSON object and nothing else: {"message": "..."}`;

const TGT_SYSTEM = `You translate a Romanian (or Romanian-English mixed) message into plain, natural English, for training a translator. The message may contain jargon: English technical terms, product and tool names, acronyms, slang, code tokens, file names and quoted text. KEEP every one of them exactly as written (same spelling and case), also when Romanian endings are glued on (translate "deploy-ul" as "the deploy", but never translate or alter the term "deploy"). Translate every other Romanian word. Rules: fix spelling and missing diacritics silently (read a typo as the intended word); keep the meaning, negation, hedges, questions and the number of sentences; keep names, numbers, dates, amounts and quotation marks exactly; add nothing and drop nothing; a run-on may be split with punctuation but not rewritten; use a pronoun for a dropped subject; if the message has no jargon just translate it; if it is already clean English return it unchanged. A target is one line. Answer with one JSON object and nothing else: {"target": "..."}`;

const flatten = a => (Array.isArray(a) ? a : []).map(t => String(t).trim()).filter(t => t && t.length <= 40 && !/[\n]/.test(t));

if (cmd === 'terms') {
  const items = [];
  for (const d of DOMAINS) FLAVOURS.forEach((f, i) => items.push({id: `${d}|${i}`, user: `DOMAIN: ${d}\nFLAVOUR: ${f}`}));
  console.log(makeFolder('tj_terms', {system: TERMS_SYSTEM, items, answerKey: 'terms', title: 'jargon inventories per domain', model: 'xai-oauth/grok-4.20-0309-non-reasoning'}));
} else if (cmd === 'collect-terms') {
  const bl = loadBlocklist(), byDomain = {};
  for (const [id, a] of loadAnswers('tj_terms', 'terms')) { if (!a) continue; const [d] = id.split('|'); (byDomain[d] ??= new Set()); for (const t of flatten(a.terms)) if (!blocked(t, bl)) byDomain[d].add(t); }
  fs.writeFileSync(path.join(W, 'terms.json'), JSON.stringify(Object.fromEntries(Object.entries(byDomain).map(([d, s]) => [d, [...s]])), null, 1));
  console.log(Object.fromEntries(Object.entries(byDomain).map(([d, s]) => [d, s.size])));
} else if (cmd === 'messages') {
  const n = Number(val('--n', 6000)), terms = JSON.parse(fs.readFileSync(path.join(W, 'terms.json'), 'utf8'));
  const bl = loadBlocklist(), r = rng('tj-messages-v1'), pick = a => a[Math.floor(r() * a.length)];
  const lens = LENGTHS.flatMap(([l, w]) => Array(w).fill(l));
  const specs = [];
  for (let i = 0; i < n; i++) {
    const domain = pick(DOMAINS), pool = (terms[domain] ?? []).filter(t => !blocked(t, bl));
    const clean = r() < 0.14; // no jargon: plain Romanian, so the model does not learn to over-preserve
    const k = clean ? 0 : 1 + Math.floor(r() * 3), ts = [];
    while (ts.length < k && pool.length) { const t = pick(pool); if (!ts.includes(t)) ts.push(t); }
    const style = pick(STYLES), len = pick(lens);
    const user = `domain: ${domain}\njargon terms: ${ts.length ? ts.map(t => JSON.stringify(t)).join(', ') : '(none: write plain Romanian about the domain without any English technical word)'}\nstyle: ${style}\nlength: ${len}${ts.length && /double quotes/.test(style) ? '' : ''}`;
    specs.push({id: `tj${String(i).padStart(5, '0')}`, domain, terms: ts, style, length: len, clean, user});
  }
  writeJsonl(path.join(W, 'specs.jsonl'), specs);
  const plan = [['grok', 'a', 3], ['glm', 'b', 2]];
  // Grok takes 70%, GLM 30%
  const cut = Math.floor(specs.length * 0.7), parts = [['grok', specs.slice(0, cut), 3], ['glm', specs.slice(cut), 2]];
  for (const [m, list, sh] of parts) for (let s = 0; s < sh; s++) console.log(makeFolder(`tj_msg_${m}${s + 1}`, {system: MSG_SYSTEM, items: list.filter((_, i) => i % sh === s), answerKey: 'message', title: 'source messages with jargon', model: m === 'grok' ? 'xai-oauth/grok-4.20-0309-non-reasoning' : 'zai/glm-5.3-flash'}));
} else if (cmd === 'collect-messages') {
  const specs = new Map(readJsonl(path.join(W, 'specs.jsonl')).map(s => [s.id, s])), bl = loadBlocklist(), out = [], drop = {};
  const seen = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'datasets_sources')).filter(n => /^tj_msg_/.test(n))) for (const [id, a] of loadAnswers(f, 'message')) {
    const s = specs.get(id); if (!s) continue;
    const bump = k => (drop[k] = (drop[k] ?? 0) + 1);
    if (!a) { bump('unresolved'); continue; }
    const m = String(a.message).replace(/\s+/g, ' ').trim();
    if (m.length < 12 || m.length > 1200) { bump('length'); continue; }
    if (blocked(m, bl)) { bump('blocklist'); continue; }
    if (!s.clean && !s.terms.every(t => m.toLowerCase().includes(t.toLowerCase()))) { bump('term_missing'); continue; }
    if (seen.has(m.toLowerCase())) { bump('duplicate'); continue; }
    seen.add(m.toLowerCase()); out.push({...s, message: m, writer: f.replace(/^tj_msg_/, '').replace(/\d+$/, '')});
  }
  writeJsonl(path.join(W, 'messages.jsonl'), out); console.log({kept: out.length, drop});
} else if (cmd === 'targets') {
  const rows = readJsonl(path.join(W, val('--file', 'messages.jsonl'))), tag = val('--tag', 'b1'), n = Number(val('--n', 5000)), sh = Number(val('--shards', 2)), from = Number(val('--from', 0));
  const sel = rows.slice(from, from + n);
  for (let s = 0; s < sh; s++) console.log(makeFolder(`tj_tgt_${tag}_${s + 1}`, {system: TGT_SYSTEM, items: sel.filter((_, i) => i % sh === s).map(r => ({id: r.id, user: r.message})), answerKey: 'target', title: 'English targets keeping jargon verbatim', model: 'deepseek/deepseek-flash'}));
}

// ---------------------------------------------------------------------------------------------- assemble
const norm = t => String(t).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const words = t => norm(t).split(/[^a-z0-9_]+/).filter(Boolean);
const hasTok = (out, t) => new RegExp(`(?<![\\p{L}\\p{N}_])${String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(out);
const STOP = new Set('the and for you that this with have are was but not what from they will would there their about which when your can has been more some than then them into just like also our out all any how why who'.split(' '));

function assemble() {
  const bl = loadBlocklist(), msgs = new Map(readJsonl(path.join(W, 'messages.jsonl')).map(r => [r.id, r]));
  const tg = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'datasets_sources')).filter(n => /^tj_tgt_/.test(n))) for (const [id, a] of loadAnswers(f, 'target')) if (a && !tg.has(id)) tg.set(id, String(a.target).trim());
  const drop = {}, bump = k => (drop[k] = (drop[k] ?? 0) + 1), rows = [];
  const natural = readJsonl(path.join(ROOT, 'datasets/natural/messages.jsonl')).map(r => r.message);
  const natSets = natural.flatMap(m => m.split(/(?<=[.?!])\s+/)).concat(natural).map(m => new Set(words(m).filter(w => w.length > 3 && !STOP.has(w))));
  const hitFile = path.join(W, 'nocopy-hits.json'), copied = new Set(fs.existsSync(hitFile) ? JSON.parse(fs.readFileSync(hitFile, 'utf8')) : []);
  for (const [id, target] of tg) {
    const m = msgs.get(id); if (!m) continue;
    if (copied.has(id)) { bump('opus_8gram'); continue; }
    if (!target || /\n/.test(target) || target.length > 1400) { bump('target_shape'); continue; }
    if (blocked(target, bl) || blocked(m.message, bl)) { bump('blocklist_target'); continue; }
    if (!m.clean && !m.terms.every(t => hasTok(target, t))) { bump('term_not_kept'); continue; }
    const quoted = [...m.message.matchAll(/["“„]([^"”“„]{2,60})["”]/g)].map(x => x[1]);
    if (quoted.some(q => !target.toLowerCase().includes(q.toLowerCase()))) { bump('quote_not_kept'); continue; }
    const wr = words(target).length / Math.max(1, words(m.message).length);
    if (wr < 0.45 || wr > 2.2) { bump('length_ratio'); continue; }
    if (/[ăâîșțşţ]/i.test(target.replace(/["“„][^"”“„]*["”]/g, '')) && !m.terms.some(t => /[ăâîșț]/i.test(t))) { const rest = target.match(/\b\w*[ăâîșțşţ]\w*\b/gi) ?? []; if (rest.length > 1) { bump('romanian_left_in_target'); continue; } }
    const s = new Set(words(m.message).filter(w => w.length > 3 && !STOP.has(w)));
    let worst = 0;
    for (const n of natSets) { let k = 0; for (const w of s) if (n.has(w)) k++; const j = k / Math.max(1, new Set([...s, ...n]).size); if (j > worst) worst = j; }
    if (worst >= 0.5 && s.size >= 3) { bump('natural_overlap'); continue; }
    rows.push({id: `translate-jargon-v1::${id}`, source: m.message, target, terms: m.terms, clean: m.clean, domain: m.domain, style: m.style, length: m.length, writer: m.writer, target_source: 'llm:deepseek-flash', source_license: 'llm-authored'});
  }
  // held-out terms: 3% of distinct terms never in train; plus 3% random dev rows
  const all = [...new Set(rows.flatMap(r => r.terms.map(t => t.toLowerCase())))].sort();
  const rr = rng('tj-heldout'), held = new Set(all.filter(() => rr() < 0.03));
  const train = [], dev = [];
  for (const r of rows) {
    const heldRow = r.terms.some(t => held.has(t.toLowerCase())), h = parseInt(crypto.createHash('sha256').update(r.id).digest('hex').slice(0, 8), 16) / 2 ** 32;
    if (heldRow) dev.push({...r, split: 'dev', heldout_terms: true}); else if (h < 0.03) dev.push({...r, split: 'dev'}); else train.push({...r, split: 'train'});
  }
  const dir = path.join(ROOT, 'datasets/bad_english/translate-jargon-v1');
  fs.mkdirSync(dir, {recursive: true});
  writeJsonl(path.join(dir, 'train.jsonl'), train); writeJsonl(path.join(dir, 'dev.jsonl'), dev);
  const stats = {rows: rows.length, train: train.length, dev: dev.length, dev_heldout_terms: dev.filter(r => r.heldout_terms).length, heldout_terms: held.size, distinct_terms: all.length, clean_rows: rows.filter(r => r.clean).length, drop, by_writer: Object.fromEntries([...new Set(rows.map(r => r.writer))].map(w => [w, rows.filter(r => r.writer === w).length]))};
  fs.writeFileSync(path.join(W, 'assemble-stats.json'), JSON.stringify(stats, null, 1));
  console.log(stats);
}
if (cmd === 'assemble') assemble();
