#!/usr/bin/env node
/** Experiment text-to-clean-english-v1, independent noisy-English check (inference only): the owner's writer drafts in
 * datasets_sources/new_cases/raw/ (format new_cases.md) carry a reviewed-style `clean` rewrite for each message, which
 * gives a reference for real-looking noisy English that the generator-noise buckets of formalizer-v1 cannot. The
 * drafts are a local source cache (AGENTS.md rule 10, DS014): the sample and the raw outputs are written under the
 * git-ignored eval/reports/current/ only, and the report keeps counts and rates, never message text.
 *
 *   node tools/research/text-to-clean-english-newcases.mjs sample --out <sample.jsonl>            # seeded stratified sample
 *   node tools/research/text-to-clean-english-newcases.mjs score --sample <s> --candidate <name> --file <raw.jsonl> --out <scored.jsonl>
 *   node tools/research/text-to-clean-english-newcases.mjs summarize --dir <scored dir> --out <report.json>
 *
 * A candidate's output is compared with the nearest of the row's `clean` rewrites after lower-casing and dropping
 * punctuation: `exact` (equal), `distance` (character edit distance / length, lower is closer) and `worse` (farther from
 * the reference than the untouched message was). The `original` candidate is the message itself, so its `exact` rate is
 * the share of rows that were already acceptable; a good cleaner raises `exact` and never lowers it on identity rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const abs = file => path.join(ROOT, file);
const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
const readJsonl = file => fs.readFileSync(abs(file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(abs(file)), {recursive: true}); fs.writeFileSync(abs(file), rows.map(row => JSON.stringify(row)).join('\n') + '\n'); };
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const norm = text => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
function distance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: n + 1}, (_, j) => j);
  for (let i = 1; i <= m; i++) { let prev = dp[0]; dp[0] = i; for (let j = 1; j <= n; j++) { const tmp = dp[j]; dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]); prev = tmp; } }
  return dp[n];
}
const nearest = (text, cleans) => Math.min(...cleans.map(clean => distance(norm(text), norm(clean)) / Math.max(1, norm(clean).length)));
const NUMBERS = text => new Set((String(text).match(/\d+/g) ?? []));

const QUOTAS = {typos: 60, casual_register: 40, stranded_preposition: 30, multi_question: 20, long_coordination: 20, identity_clean: 60};

function sample() {
  const rows = fs.readdirSync(abs('datasets_sources/new_cases/raw')).filter(name => name.endsWith('.jsonl')).sort().flatMap(name => readJsonl('datasets_sources/new_cases/raw/' + name));
  const random = mulberry(20260930);
  const out = [];
  for (const [category, count] of Object.entries(QUOTAS)) {
    const pool = rows.filter(row => row.categories.length === 1 && row.categories[0] === category && row.language === 'en');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (const row of pool.slice(0, count)) out.push({id: row.id, kind: category === 'identity_clean' ? 'nc_identity' : 'nc_noisy', category, text: row.message, clean: row.clean});
  }
  writeJsonl(args.out, out);
  console.log(JSON.stringify({rows: out.length, quotas: QUOTAS, seed: 20260930}));
}

function score() {
  const samples = new Map(readJsonl(args.sample).map(row => [row.id, row]));
  const out = [];
  for (const raw of readJsonl(args.file)) {
    const row = samples.get(raw.id);
    if (!row) continue;
    const output = String(raw.output ?? '');
    const before = nearest(row.text, row.clean), after = output.trim() ? nearest(output, row.clean) : 1;
    const keepsNumbers = [...NUMBERS(row.text)].every(n => NUMBERS(output).has(n));
    out.push({id: row.id, kind: row.kind, category: row.category, candidate: args.candidate, exact: after === 0, distance: after, distance_before: before, worse: after > before + 1e-9, better: after < before - 1e-9, changed: norm(output) !== norm(row.text), empty: !output.trim(), numbers_kept: keepsNumbers, ms: raw.ms ?? null});
  }
  writeJsonl(args.out, out);
  console.log(JSON.stringify({candidate: args.candidate, rows: out.length}));
}

function wilson(k, n) { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }

function pairedBootstrap(diffs) {
  const random = mulberry(20260930), means = [];
  for (let r = 0; r < 2000; r++) { let sum = 0; for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(random() * diffs.length)]; means.push(sum / diffs.length); }
  means.sort((a, b) => a - b);
  return {n: diffs.length, mean: diffs.reduce((a, b) => a + b, 0) / diffs.length, ci95: [means[50], means[1949]]};
}

function summarize() {
  const dir = abs(args.dir);
  const rows = fs.readdirSync(dir).filter(name => name.endsWith('.scored.jsonl')).flatMap(name => fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
  const byCandidate = new Map();
  for (const row of rows) { if (!byCandidate.has(row.candidate)) byCandidate.set(row.candidate, []); byCandidate.get(row.candidate).push(row); }
  const rate = (list, pred) => { const k = list.filter(pred).length; return {k, n: list.length, p: list.length ? k / list.length : null, ci95: wilson(k, list.length)}; };
  const summary = {}, paired = {};
  for (const [candidate, list] of byCandidate) {
    const noisy = list.filter(row => row.kind === 'nc_noisy'), identity = list.filter(row => row.kind === 'nc_identity');
    summary[candidate] = {
      noisy_exact: rate(noisy, row => row.exact), noisy_better: rate(noisy, row => row.better), noisy_worse: rate(noisy, row => row.worse),
      noisy_mean_distance: noisy.reduce((a, row) => a + row.distance, 0) / Math.max(1, noisy.length),
      noisy_by_category: Object.fromEntries([...new Set(noisy.map(row => row.category))].sort().map(category => [category, rate(noisy.filter(row => row.category === category), row => row.exact)])),
      noisy_numbers_kept: rate(noisy, row => row.numbers_kept),
      identity_changed: rate(identity, row => row.changed), identity_worse: rate(identity, row => row.worse),
      empty: rate(list, row => row.empty),
      ms_mean: list.some(row => row.ms != null) ? list.reduce((a, row) => a + (row.ms ?? 0), 0) / list.length : null,
    };
  }
  const original = new Map((byCandidate.get('original') ?? []).map(row => [row.id, row]));
  for (const [candidate, list] of byCandidate) {
    if (candidate === 'original') continue;
    const noisy = list.filter(row => row.kind === 'nc_noisy' && original.has(row.id));
    paired[`${candidate} minus original (noisy exact)`] = pairedBootstrap(noisy.map(row => Number(row.exact) - Number(original.get(row.id).exact)));
  }
  const reference = byCandidate.get('languagetool-masked');
  if (reference) {
    const other = new Map(reference.map(row => [row.id, row]));
    for (const [candidate, list] of byCandidate) if (candidate !== 'languagetool-masked' && candidate !== 'original') paired[`${candidate} minus languagetool-masked (noisy exact)`] = pairedBootstrap(list.filter(row => row.kind === 'nc_noisy' && other.has(row.id)).map(row => Number(row.exact) - Number(other.get(row.id).exact)));
  }
  fs.writeFileSync(abs(args.out), JSON.stringify({format: 'chatsop-report-v1', generated_at: new Date().toISOString(), note: 'counts and rates only; the source drafts are a local cache (DS014) and no message text is stored here', summary, paired}, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 1).slice(0, 3000));
}

const commands = {sample, score, summarize};
if (!commands[command]) { console.log('Unknown command. See the header comment.'); process.exit(1); }
commands[command]();
