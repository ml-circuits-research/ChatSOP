#!/usr/bin/env node
/** Experiment eval-stanza-accurate-v1 (preregistered: status/preregistrations/eval-stanza-accurate-v1.json):
 * Stanza default (charlm) vs default_accurate (electra-large) English models under the frozen rules v1.4, on clean English.
 *
 *   node tools/research/stanza-accurate-eval.mjs sets   [--set dev|test]
 *   node tools/research/stanza-accurate-eval.mjs run    --variant default|accurate|default-protect|accurate-protect --set dev|test --stage 100|300|full
 *   node tools/research/stanza-accurate-eval.mjs compare --a VARIANT --b VARIANT --set dev|test --stage S      # paired bootstrap b - a
 *   node tools/research/stanza-accurate-eval.mjs diff    --set dev --stage S                                  # tree differences default vs accurate
 *   node tools/research/stanza-accurate-extra.mjs spacy --set dev --stage S                                  # spaCy disagreement as uncertainty signal
 *   node tools/research/stanza-accurate-extra.mjs pairs --set dev --stage S [--n 48]                          # pairwise stronger-model judgement
 *   node tools/research/stanza-accurate-extra.mjs speed                                                       # ms/sentence, GPU and CPU
 *
 * The frozen rules are copied to a private snapshot (proofing-oracle.mjs loadFrozenRules); the accurate worker is
 * tools/research/stanza-accurate/ud_parse_worker_accurate.py. Parses are cached per variant in
 * eval/reports/current/stanza-accurate/cache/. Everything runs on one GPU worker at a time (AGENTS.md rule 2).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {execFileSync} from 'node:child_process';
import {loadFrozenRules, convertAll} from './proofing-oracle.mjs';
import {stages} from './ud-baseline-eval.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = path.join(ROOT, 'eval/reports/current/stanza-accurate');
const RULES = 'v1.4';
const WORKER = path.join(ROOT, 'tools/research/stanza-accurate/ud_parse_worker_accurate.py');
const HOME = os.homedir();
const DEFAULT_DIR = path.join(HOME, 'nlp-venv/stanza_resources');
const ACCURATE_DIR = path.join(HOME, 'stanza_accurate/resources');
const PYTHON = path.join(HOME, 'nlp-venv/bin/python');
const sha = t => createHash('sha256').update(t).digest('hex');
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };
const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
export const mulberry = seed => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ------------------------------------------------------------------ data
export function resolveDev() {
  for (const p of ['datasets_archive/clean-english/dev.jsonl', 'datasets_archive/clean-english/dev.jsonl']) if (fs.existsSync(path.join(ROOT, p)) || fs.existsSync(path.join(ROOT, p.replace('.jsonl', '.part-000.jsonl')))) return p;
  throw Error('clean-English dev rows not found under datasets/ or datasets_archive/');
}
export function setRows(set) { return readJsonlShardedSync(path.join(ROOT, set === 'test' ? 'eval/suites/clean-english/test.jsonl' : resolveDev())); }
const setsFile = set => path.join(OUT, `sets-${set}.json`);
export function stageRows(set, stage) {
  const rows = setRows(set);
  let info = fs.existsSync(setsFile(set)) ? JSON.parse(fs.readFileSync(setsFile(set), 'utf8')) : null;
  if (!info) {
    info = {rows: rows.length, source: set === 'test' ? 'eval/suites/clean-english/test.jsonl' : resolveDev(), stages: stages(rows, r => r.question_type ?? 'unspecified', [100, 300], 20260930)};
    writeJson(setsFile(set), info);
  }
  const ids = new Set(info.stages[stage] ?? info.stages.full);
  return rows.filter(r => ids.has(r.id));
}

// ------------------------------------------------------------------ worker client
export class Worker {
  constructor({variant = 'default', device = 'cuda', threads = null, taskset = null}) { Object.assign(this, {variant, device, threads, taskset, child: null, pending: [], ready: null}); }
  start() {
    if (this.ready) return this.ready;
    const accurate = this.variant.startsWith('accurate');
    const args = [WORKER, '--device', this.device, '--models-dir', DEFAULT_DIR, '--en-dir', accurate ? ACCURATE_DIR : DEFAULT_DIR, '--en-package', accurate ? 'default_accurate' : 'default'];
    const env = {...process.env, HF_HOME: path.join(HOME, 'stanza_accurate/hf'), HF_HUB_OFFLINE: '1', ...(this.device === 'cpu' ? {CUDA_VISIBLE_DEVICES: ''} : {}), ...(this.threads ? {OMP_NUM_THREADS: String(this.threads), MKL_NUM_THREADS: String(this.threads)} : {})};
    const [cmd, cmdArgs] = this.taskset ? ['taskset', ['-c', this.taskset, PYTHON, ...args]] : [PYTHON, args];
    const t0 = performance.now();
    this.child = spawn(cmd, cmdArgs, {stdio: ['pipe', 'pipe', 'inherit'], env});
    const lines = readline.createInterface({input: this.child.stdout});
    this.ready = new Promise((resolve, reject) => {
      let started = false;
      this.child.once('error', reject);
      this.child.once('exit', code => { const e = Error('worker exited ' + code); if (!started) reject(e); for (const j of this.pending.splice(0)) j.reject(e); this.child = null; });
      lines.on('line', line => {
        let d; try { d = JSON.parse(line); } catch { return; }
        if (!started) { if (d.ready) { started = true; this.loadMs = performance.now() - t0; resolve(d); } return; }
        const job = this.pending.shift(); if (!job) return;
        if (d.error) job.reject(Error(d.error)); else job.resolve(d);
      });
    });
    return this.ready;
  }
  async parseMany(texts) { await this.start(); return new Promise((resolve, reject) => { this.pending.push({resolve, reject}); this.child.stdin.write(JSON.stringify({id: 0, texts}) + '\n'); }); }
  async stop() { const c = this.child; if (!c) return; await new Promise(r => { const t = setTimeout(() => { c.kill('SIGKILL'); r(); }, 5000); c.once('exit', () => { clearTimeout(t); r(); }); c.stdin.end(); }); this.child = null; this.ready = null; }
}

// ------------------------------------------------------------------ name/title protection (lever L1)
/** Spans [{start, end, kind}] of multiword proper-name runs found by protect.mjs in `masked` (deviation D1: quoted spans are not protected, protect-v1 joined whole quoted claims). */
export function nameSpans(masked, protectMod) {
  const {text: P, slots} = protectMod.protect(masked);
  const spans = [];
  let pi = 0, oi = 0;
  const re = /(?:Ent|Num|Quote)\d+/g;
  for (let m; (m = re.exec(P));) {
    const literal = P.slice(pi, m.index);
    if (masked.slice(oi, oi + literal.length) !== literal) return [];
    oi += literal.length;
    const slot = slots.find(s => s.key === m[0]);
    if (!slot || masked.slice(oi, oi + slot.value.length) !== slot.value) return [];
    const words = slot.value.trim().split(/\s+/).length;
    if (slot.kind === 'Ent' && words >= 2) spans.push({start: oi, end: oi + slot.value.length, kind: slot.kind});
    oi += slot.value.length;
    pi = m.index + m[0].length;
  }
  return spans;
}
export const protectedInput = (masked, spans) => { let out = masked; for (const s of spans) out = out.slice(0, s.start) + out.slice(s.start, s.end).replace(/ /g, '_') + out.slice(s.end); return out; };
/** Restore a parse of the underscore-joined input: the protected token becomes one PROPN word with its spaces. */
export function restoreParse(parse, masked, spans) {
  for (const sent of parse.sentences) {
    sent.text = masked.slice(sent.start, sent.end);
    for (const w of sent.words) {
      const span = spans.find(s => w.start >= s.start && w.end <= s.end);
      if (!span) continue;
      const text = masked.slice(w.start, w.end);
      if (w.start === span.start && w.end === span.end || /_/.test(w.text)) { w.text = text; w.lemma = text; w.token = text; if (w.upos !== 'PROPN') { w.upos = 'PROPN'; w.xpos = 'NNP'; } }
    }
  }
  parse.text = masked;
  return parse;
}

// ------------------------------------------------------------------ parse cache + run
class Cache {
  constructor(variant, rules) { this.variant = variant; this.rules = rules; this.file = path.join(OUT, 'cache', `parses-${variant}.jsonl`); this.map = new Map(); for (const r of readJsonl(this.file)) this.map.set(r.k, r); this.worker = null; this.ms = []; }
  async parseAll(texts, {batch = 64, log = null} = {}) {
    const masked = texts.map(t => this.rules.maskMessage(t));
    const protect = this.variant.endsWith('-protect');
    const inputs = masked.map(m => { if (!protect) return {m, input: m, spans: []}; const spans = nameSpans(m, this.rules.protect); return {m, input: protectedInput(m, spans), spans}; });
    const todo = [...new Map(inputs.filter(i => !this.map.has(sha(i.input))).map(i => [i.input, i])).values()];
    if (todo.length) {
      this.worker ??= new Worker({variant: this.variant.replace('-protect', '')});
      await this.worker.start();
      fs.mkdirSync(path.dirname(this.file), {recursive: true});
      for (let i = 0; i < todo.length; i += batch) {
        const chunk = todo.slice(i, i + batch);
        const {parses, ms} = await this.worker.parseMany(chunk.map(c => c.input));
        this.ms.push({sentences: parses.reduce((s, p) => s + p.sentences.length, 0), ms});
        const lines = chunk.map((c, j) => { const rec = {k: sha(c.input), p: parses[j]}; this.map.set(rec.k, rec); return JSON.stringify(rec); });
        fs.appendFileSync(this.file, lines.join('\n') + '\n');
        if (log) log(`${this.variant} parsed ${Math.min(i + batch, todo.length)}/${todo.length}`);
      }
    }
    return inputs.map(i => { const p = structuredClone(this.map.get(sha(i.input)).p); return protect && i.spans.length ? restoreParse(p, i.m, i.spans) : p; });
  }
  async stop() { await this.worker?.stop(); this.worker = null; }
}

export async function parsesFor(variant, rows, rules) {
  const cache = new Cache(variant, rules);
  const parses = await cache.parseAll(rows.map(r => r.question), {log: m => process.stderr.write(`\r${m}`)});
  await cache.stop();
  return parses;
}

const scoreDir = f => path.join(OUT, 'work', f);
/** Scores predictions with eval/run.mjs of a private snapshot of the repository (eval/reports/current/stanza-accurate/repo,
 * SNAPSHOT.sha256): other agents edit eval/ and lib/ while this study runs, and one evaluator must score every variant. */
export async function scoreRows(rows, preds, workDir, {chunk = 2000} = {}) {
  const snap = path.join(OUT, 'repo');
  const out = new Map();
  // The wild suite has no verification world: scored against every accepted gold (eval/wild-suite.mjs scoreAgainstAccepted), as eval-clean-english-v1 does.
  const wild = rows.filter(r => (r.suite ?? r.id.split('::')[0]) === 'formalizer-wild-v1');
  if (wild.length) {
    const {scoreAgainstAccepted} = await import(pathToFileURL(path.join(snap, 'tools/eval/wild-suite.mjs')).href);
    const sopOf = new Map(preds.map(p => [p.id, p.sop]));
    for (const r of wild) { const sc = scoreAgainstAccepted(sopOf.get(r.id), r.sop_targets_accepted ?? [r.sop_target]); out.set(r.id, {strict: !!sc.accepted_match, tolerant: !!sc.accepted_match_tolerant, canonical: false}); }
    rows = rows.filter(r => !wild.includes(r));
  }
  fs.mkdirSync(workDir, {recursive: true});
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk), ids = new Set(part.map(r => r.id));
    const suite = path.join(workDir, `suite-${i}.jsonl`), pred = path.join(workDir, `pred-${i}.jsonl`), rep = path.join(workDir, `eval-${i}.json`);
    writeJsonl(suite, part); writeJsonl(pred, preds.filter(p => ids.has(p.id)));
    execFileSync(process.execPath, [path.join(snap, 'eval/run.mjs'), '--file', suite, '--predictions', pred, '--out', rep], {cwd: snap, stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 30});
    for (const r of JSON.parse(fs.readFileSync(rep, 'utf8')).records) out.set(r.id, {strict: !!r.execution_equivalent, tolerant: !!r.execution_equivalent_tolerant, canonical: !!r.canonical_match});
    for (const f of [suite, pred, rep]) fs.rmSync(f, {force: true});
  }
  return out;
}
async function runCommand(o) {
  const rules = await loadFrozenRules(RULES);
  const rows = stageRows(o.set, o.stage);
  const t0 = performance.now();
  const parses = await parsesFor(o.variant, rows, rules);
  const conv = convertAll(rules, rows.map(r => r.question), parses);
  const preds = rows.map((r, i) => ({id: r.id, sop: conv[i].sop, valid: conv[i].valid, outcome: conv[i].outcome}));
  const scores = await scoreRows(rows, preds, scoreDir(`${o.variant}-${o.set}-${o.stage}`));
  const recs = rows.map((r, i) => ({id: r.id, group: r.split_group_id, question_type: r.question_type ?? 'unspecified', suite: r.suite ?? 'dev', ...scores.get(r.id), outcome: conv[i].outcome, valid: conv[i].valid}));
  writeJsonl(path.join(OUT, 'runs', `${o.variant}-${o.set}-${o.stage}.jsonl`), recs);
  const n = recs.length, k = key => recs.filter(r => r[key]).length;
  const empty = recs.filter(r => !r.valid).length;
  const summary = {variant: o.variant, set: o.set, stage: o.stage, rows: n, strict: k('strict') / n, tolerant: k('tolerant') / n, invalid_or_crash: empty, broken: empty / n > 0.2, rules: RULES, seconds: (performance.now() - t0) / 1000};
  writeJson(path.join(OUT, 'runs', `${o.variant}-${o.set}-${o.stage}.json`), summary);
  console.log(JSON.stringify(summary));
}

// ------------------------------------------------------------------ statistics
export function wilson(k, n, z = 1.96) { const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
/** Paired cluster bootstrap of mean(b) - mean(a) over clusters; recs are aligned by id. */
export function pairedDelta(a, b, key = 'strict', B = 10000, seed = 7) {
  const bm = new Map(b.map(r => [r.id, r]));
  const pairs = a.filter(r => bm.has(r.id)).map(r => ({g: r.group, x: r[key] ? 1 : 0, y: bm.get(r.id)[key] ? 1 : 0}));
  const groups = new Map();
  for (const p of pairs) { if (!groups.has(p.g)) groups.set(p.g, []); groups.get(p.g).push(p); }
  const cl = [...groups.values()];
  const rand = mulberry(seed), deltas = [];
  for (let i = 0; i < B; i++) { let s = 0, n = 0; for (let j = 0; j < cl.length; j++) { const c = cl[Math.floor(rand() * cl.length)]; for (const p of c) { s += p.y - p.x; n++; } } deltas.push(s / n); }
  deltas.sort((u, v) => u - v);
  const n = pairs.length, gained = pairs.filter(p => p.y && !p.x).length, lost = pairs.filter(p => p.x && !p.y).length;
  return {n, a: pairs.reduce((s, p) => s + p.x, 0) / n, b: pairs.reduce((s, p) => s + p.y, 0) / n, delta: (gained - lost) / n, ci95: [deltas[Math.floor(0.025 * B)], deltas[Math.floor(0.975 * B)]], gained, lost};
}
async function compareCommand(o) {
  const load = v => readJsonl(path.join(OUT, 'runs', `${v}-${o.set}-${o.stage}.jsonl`));
  const a = load(o.a), b = load(o.b);
  const out = {a: o.a, b: o.b, set: o.set, stage: o.stage, strict: pairedDelta(a, b, 'strict'), tolerant: pairedDelta(a, b, 'tolerant')};
  const types = [...new Set(a.map(r => r.question_type))].sort();
  out.by_question_type = Object.fromEntries(types.map(t => { const x = a.filter(r => r.question_type === t), y = b.filter(r => r.question_type === t); const d = pairedDelta(x, y, 'strict', 2000); return [t, {n: x.length, a: d.a, b: d.b, gained: d.gained, lost: d.lost}]; }));
  const suites = [...new Set(a.map(r => r.suite))].sort();
  out.by_suite = Object.fromEntries(suites.map(t => { const x = a.filter(r => r.suite === t), y = b.filter(r => r.suite === t); const d = pairedDelta(x, y, 'strict', 2000); return [t, {n: x.length, a: d.a, b: d.b, delta: d.delta, ci95: d.ci95, gained: d.gained, lost: d.lost}]; }));
  writeJson(path.join(OUT, `compare-${o.a}-vs-${o.b}-${o.set}-${o.stage}.json`), out);
  console.log(JSON.stringify({a: o.a, b: o.b, stage: o.stage, n: out.strict.n, strict_a: out.strict.a, strict_b: out.strict.b, delta: out.strict.delta, ci95: out.strict.ci95, gained: out.strict.gained, lost: out.strict.lost, tolerant_delta: out.tolerant.delta, tolerant_ci95: out.tolerant.ci95}));
}

// ------------------------------------------------------------------ tree differences
const coreClass = w => (w.head === 0 ? 'root' : /^nsubj/.test(w.deprel) ? 'subj' : w.deprel === 'obj' ? 'obj' : w.deprel === 'iobj' ? 'iobj' : (w.deprel === 'advmod' && /^(not|n't|never)$/i.test(w.text)) ? 'neg' : null);
export function treeDiff(sa, sb) {
  if (sa.words.length !== sb.words.length || sa.words.some((w, i) => w.text !== sb.words[i].text)) return {tokens_differ: true, any: true, core: true, arcs: [], upos: 0};
  const arcs = [];
  let upos = 0;
  sa.words.forEach((w, i) => { const v = sb.words[i]; if (w.head !== v.head || w.deprel !== v.deprel) arcs.push({i: w.id, text: w.text, a: `${w.head}:${w.deprel}`, b: `${v.head}:${v.deprel}`}); if (w.upos !== v.upos) upos++; });
  const core = sa.words.some((w, i) => { const v = sb.words[i]; const ca = coreClass(w), cb = coreClass(v); return ca !== cb || (ca && w.head !== v.head); });
  return {tokens_differ: false, any: arcs.length > 0, core, arcs, upos};
}
async function diffCommand(o) {
  const rules = await loadFrozenRules(RULES);
  const rows = stageRows(o.set, o.stage);
  const pa = await parsesFor('default', rows, rules), pb = await parsesFor('accurate', rows, rules);
  const out = [];
  rows.forEach((r, i) => pa[i].sentences.forEach((sa, j) => { const sb = pb[i].sentences[j]; if (!sb) return; out.push({id: r.id, index: j, question_type: r.question_type, text: sa.text, ...treeDiff(sa, sb), words: sa.words.length}); }));
  writeJsonl(path.join(OUT, `diff-${o.set}-${o.stage}.jsonl`), out);
  const n = out.length, any = out.filter(d => d.any).length, core = out.filter(d => d.core).length, tok = out.filter(d => d.tokens_differ).length;
  const byLen = {short: out.filter(d => d.words <= 8), medium: out.filter(d => d.words > 8 && d.words <= 15), long: out.filter(d => d.words > 15)};
  const summary = {sentences: n, any_arc_differs: any, any_share: any / n, any_ci95: wilson(any, n), core_differs: core, core_share: core / n, core_ci95: wilson(core, n), tokens_differ: tok,
    by_length: Object.fromEntries(Object.entries(byLen).map(([k, v]) => [k, {n: v.length, any: v.filter(d => d.any).length, core: v.filter(d => d.core).length}])),
    upos_changed_words: out.reduce((s, d) => s + d.upos, 0)};
  writeJson(path.join(OUT, `diff-${o.set}-${o.stage}.json`), summary);
  console.log(JSON.stringify(summary));
}

const COMMANDS = {sets: o => { for (const set of [o.set ?? 'dev']) console.log(set, stageRows(set, 100).length, stageRows(set, 300).length, setRows(set).length); }, run: runCommand, compare: compareCommand, diff: diffCommand};
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, ...rest] = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) o[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  const cmd = COMMANDS[command];
  if (!cmd) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n')); process.exit(0); }
  await cmd(o);
}
