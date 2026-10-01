#!/usr/bin/env node
/**
 * Collector of the `natural` collection (datasets/natural/messages.jsonl, DS008 "The natural collection", DS016 "Natural input and the stability check"):
 * the owner's own chat messages to Claude Code in this project, the most realistic input the project has. Role (owner decision 2026-10-01): the
 * realism evaluation set, read as a whole, and seeds for synthetic training data that reuse a message's form with different words
 * (tools/datasets/audit/natural-overlap.mjs fails closed on any derived row that repeats a message or its content words).
 *
 *   node tools/eval/collect-natural.mjs [--transcripts DIR] [--out datasets/natural] [--dry-run]
 *
 * It re-reads the Claude Code transcripts (`~/.claude/projects/<project>/*.jsonl`), keeps the entries typed by the human owner (turnOrigin `human`: typed,
 * queued, accepted suggestions; never tool results, task notifications, sdk prompts or agent text), applies the filters below and appends
 * the messages that are not in the collection yet (idempotent: a row is identified by session + timestamp). The wording is the owner's, typos included.
 * Filters: `<pasted_content>` blocks, e-mail addresses, secret-looking tokens and absolute home paths are replaced by placeholders; a message that is
 * mostly pasted foreign content (logs, code, text quoted from others, or a prompt that lists dataset ids) is dropped.
 * Rights: owner-authored text, cleared (DS014 "Owner chat messages").
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {splitSentences} from '../../lib/sentence-split.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const DEFAULT_OUT = path.join(ROOT, 'datasets/natural');
const HOME = os.homedir();

export const PLACEHOLDERS = {pasted: '[pasted content]', email: '[email]', token: '[token]', path: '[path]'};

/** Replace the parts of a message that are not the owner's wording. Returns the cleaned text and what was replaced. */
export function scrub(text) {
  const removed = {pasted: 0, email: 0, token: 0, path: 0, pasted_chars: 0};
  let t = String(text).replace(/\r/g, '');
  t = t.replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, m => { removed.pasted++; removed.pasted_chars += m.length; return ` ${PLACEHOLDERS.pasted} `; });
  t = t.replace(/<pasted_content\b[^>]*>[\s\S]*$/g, m => { removed.pasted++; removed.pasted_chars += m.length; return ` ${PLACEHOLDERS.pasted} `; });
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, () => { removed.email++; return PLACEHOLDERS.email; });
  t = t.replace(/\b(?:sk|xai|glm|ghp|gho|ghs|hf|pk|rk|AKIA)[-_][A-Za-z0-9_-]{16,}\b|\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$)/g, () => { removed.token++; return PLACEHOLDERS.token; });
  const home = HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(`(?:${home}|/home/[A-Za-z0-9_.-]+|/Users/[A-Za-z0-9_.-]+)(?:/[^\\s"'<>)\\]]*)?`, 'g'), () => { removed.path++; return PLACEHOLDERS.path; });
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();
  return {text: t, removed};
}

const wordsOf = t => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []);

/** Why a scrubbed message is dropped (null = keep). */
export function dropReason(original, scrubbed, removed) {
  const raw = String(original);
  if (/^\s*(?:\[Request interrupted|<command-|<task-notification|<system-reminder|<local-command)/.test(raw)) return 'harness_text';
  const words = wordsOf(scrubbed.replace(/\[(?:pasted content|email|token|path)\]/g, ' '));
  if (words.length < 3) return removed.pasted ? 'only_pasted' : 'too_short';
  if (removed.pasted_chars > 0.6 * raw.length && words.length < 12) return 'mostly_pasted';
  const lines = scrubbed.split('\n').filter(l => l.trim());
  const idLines = lines.filter(l => /^[\w.-]*[_\d][\w.-]*:\s+\S/.test(l) && !/\s/.test(l.split(':')[0])).length;
  if (idLines >= 5 && idLines >= 0.4 * lines.length) return 'dataset_id_list';
  if (/```/.test(scrubbed)) return 'code_block';
  const logish = lines.filter(l => /^\s*(?:\d{4}-\d\d-\d\d|\d\d:\d\d:\d\d|at \S+ \(|[$#>] |\s*[{}\[\]],?$|\w+\(.*\);?$)/.test(l) || (l.length > 25 && (l.match(/[{}()[\];=<>|\\]/g) ?? []).length > 0.2 * l.length)).length;
  if (lines.length >= 5 && logish >= 0.5 * lines.length) return 'log_or_code';
  return null;
}

/** The owner's typed entries of one transcript file: [{session, ts, text}]. */
export function ownerEntries(file) {
  const out = [];
  const session = path.basename(file, '.jsonl');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'user' || o.isSidechain || o.isMeta || o.toolUseResult || o.turnOrigin !== 'human' || o.userType !== 'external') continue;
    const c = o.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
    if (text.trim() && o.timestamp) out.push({session, ts: o.timestamp, text});
  }
  return out;
}

export const idOf = ts => `natural::${ts.replace(/[-:.]/g, '').replace('Z', '')}`;

export function readRows(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; }

export function collect({transcripts, out = DEFAULT_OUT, dryRun = false} = {}) {
  const dir = transcripts ?? path.join(HOME, '.claude/projects', ROOT.replace(/[^A-Za-z0-9]/g, '-'));
  const file = path.join(out, 'messages.jsonl');
  const rows = readRows(file);
  const have = new Set(rows.map(r => `${r.session}|${r.ts}`));
  const stats = {transcripts: 0, entries: 0, already: 0, added: 0, dropped: {}};
  const added = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl')).sort()) {
    stats.transcripts++;
    for (const e of ownerEntries(path.join(dir, f))) {
      stats.entries++;
      const key = `${e.session}|${e.ts}`;
      if (have.has(key)) { stats.already++; continue; }
      have.add(key);
      const {text, removed} = scrub(e.text);
      const reason = dropReason(e.text, text, removed);
      if (reason) { stats.dropped[reason] = (stats.dropped[reason] ?? 0) + 1; continue; }
      added.push({id: idOf(e.ts), ts: e.ts, session: e.session, message: text, words: wordsOf(text).length, sentences: splitSentences(text).length});
    }
  }
  stats.added = added.length;
  const all = [...rows, ...added].sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
  if (!dryRun && added.length) {
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(file, all.map(r => JSON.stringify(r)).join('\n') + '\n');
  }
  if (!dryRun) writeManifest(out, all, stats);
  return {rows: all, stats};
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export function writeManifest(out, rows, lastRun = null) {
  const file = path.join(out, 'messages.jsonl');
  const bytes = fs.readFileSync(file);
  const w = rows.map(r => r.words);
  const old = fs.existsSync(path.join(out, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')) : {};
  const manifest = {
    format: 'chatsop-natural-collection-v1', dataset: 'natural', role: 'realism evaluation set (read as a whole) and seeds for synthetic training data', sealed: false, training_authorized: false,
    purpose: 'Realistic owner input: the project owner\'s own chat messages to Claude Code in this repository (mostly Romanian with typos and English technical words; instructions to an AI assistant about software). Two roles. (a) The realism evaluation set, read as a whole and reported separately: a check of the input pipeline (textToCleanEnglish, SymbolicLM, the interpretation, the SymbolicProofingLLM rewrite), with no claim of form coverage. (b) Seeds for synthetic training data: a derived row reuses the FORM of a message with different content words (names, nouns, verbs, numbers), never the message or its words; tools/datasets/audit/natural-overlap.mjs fails closed.',
    path: 'datasets/natural/messages.jsonl',
    collector: 'tools/eval/collect-natural.mjs (idempotent: a row is identified by session + ts; the collection grows over time)',
    rights: {holder: 'owner (the author of the messages)', status: 'cleared', record: 'docs/specs/DS014-source-rights.md "Owner chat messages"'},
    scrubbed: 'pasted_content blocks, e-mail addresses, secret-looking tokens and absolute home paths are replaced by placeholders ([pasted content], [email], [token], [path]); the wording is otherwise verbatim, typos included; mostly-pasted messages are dropped',
    rows: rows.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    words: {median: pct(w, 0.5), p90: pct(w, 0.9), max: Math.max(...w), total: w.reduce((a, b) => a + b, 0)},
    first_ts: rows[0]?.ts, last_ts: rows.at(-1)?.ts,
    sessions: new Set(rows.map(r => r.session)).size,
    last_run: lastRun ? {...lastRun, at: new Date().toISOString()} : old.last_run,
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf(`--${n}`); return i < 0 ? null : a[i + 1]; };
  const res = collect({transcripts: opt('transcripts') ?? undefined, out: opt('out') ? path.resolve(opt('out')) : DEFAULT_OUT, dryRun: a.includes('--dry-run')});
  console.log(JSON.stringify({rows: res.rows.length, ...res.stats}));
}
