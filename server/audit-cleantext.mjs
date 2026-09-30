/** cleanText sources in the visual audit (DS020 "Type-specific case views"): the owner's writer drafts in
 * `datasets_sources/new_cases/raw/*.jsonl` (format: `new_cases.md`), each `{id, language, message, clean[],
 * categories[], domain, author, source, notes, gold_sop?}`. They are a local source cache (AGENTS.md rule 10,
 * DS014): shown read-only, never exported, never a train/dev/test corpus. One row is one case; the split label is
 * the writer's file name. The reviewer sees the message → clean candidates with word diffs, and can run
 * SymbolicLM on the message and on each candidate on demand.
 */
import path from 'node:path';
import {readJsonl, label, tally, sha256, compareChecks, CHECK_ROW_LIMIT, symbolicChecker} from './audit-shared.mjs';
import {diffWords} from '../lib/text-to-clean-english/index.mjs';

export const CLEANTEXT_FACETS = [
  {key: 'split', label: 'Writer file'},
  {key: 'category', label: 'Category'},
  {key: 'domain', label: 'Domain'},
  {key: 'kind', label: 'Identity or rewrite'},
  {key: 'language', label: 'Language'},
  {key: 'author', label: 'Author'},
  {key: 'verdict', label: 'Verdict'},
];

/** English clean candidates of a row: `clean`, or `clean_en` for a mixed message (its `clean_ro` is a Romanian reference, shown apart). */
export const candidatesOf = row => (row.clean ?? row.clean_en ?? []).map(String);

function indexRow(id, entry) {
  const {row} = entry;
  const candidates = candidatesOf(row);
  const request = String(row.message ?? '').replace(/\s+/g, ' ').trim();
  return {
    id,
    entries: [entry],
    splits: [entry.split],
    languages: [label(row.language)],
    category: (row.categories ?? []).length ? row.categories.map(String) : ['none'],
    domain: label(row.domain),
    author: label(row.author),
    kind: candidates.length && candidates.every(text => text === row.message) ? 'identity' : 'rewrite',
    request,
    haystack: (id + '\n' + row.message + '\n' + candidates.join('\n')).toLowerCase(),
  };
}

export const cleanTextListItem = item => ({category: item.category.join(', '), domain: item.domain, author: item.author, kind: item.kind});

/** Loads one registered cleanText source (`source.dir` files already resolved by the router). */
export function loadCleanTextCorpus(corpus, {root}) {
  const entries = corpus.files.flatMap(({split, file}) => readJsonl(file).map(row => ({split, file: path.relative(root, file), row})));
  const seen = new Map();
  const cases = [];
  for (const entry of entries) {
    // A repeated id across writer files stays visible as its own case.
    const base = String(entry.row.id);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    cases.push(indexRow(count ? `${base}#${count + 1}` : base, entry));
  }
  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byCase = new Map(cases.map(item => [item.id, item]));
  const facets = {};
  for (const {key} of CLEANTEXT_FACETS) {
    if (key === 'verdict') continue;
    facets[key] = tally(cases.flatMap(item => key === 'split' ? item.splits : key === 'language' ? item.languages : [].concat(item[key])));
  }
  const rows = entries.map(entry => entry.row);
  return {
    name: corpus.name,
    type: 'cleanText',
    entries,
    cases,
    byCase,
    facets,
    summary: {
      rows: rows.length,
      cases: cases.length,
      splits: tally(entries.map(entry => entry.split)),
      languages: tally(rows.map(row => label(row.language))),
      shapes: tally(cases.map(item => item.kind)),
      statuses: {},
      themes: tally(rows.map(row => label(row.domain))),
      fingerprint: sha256(rows.map(row => `${row.id}\t${row.message}\t${candidatesOf(row).join('|')}`).sort().join('\n')),
    },
  };
}

export function cleanTextCaseDetail(item, {corpus, verdict, history, audit}) {
  const {row, split, file} = item.entries[0];
  const candidates = candidatesOf(row);
  return {
    id: item.id,
    corpus,
    type: 'cleanText',
    splits: item.splits,
    languages: item.languages,
    category: item.category,
    domain: item.domain,
    author: item.author,
    kind: item.kind,
    source: row.source ?? null,
    notes: row.notes ?? '',
    local_only: true,
    gold_sop: row.gold_sop ?? null,
    clean_ro: row.clean_ro ?? [],
    target: null,
    verdict,
    history,
    audit,
    rows: [{
      id: row.id,
      split,
      file,
      language: row.language,
      message: row.message,
      candidates: candidates.map(text => ({text, spans: diffWords(row.message ?? '', text), identity: text === row.message})),
      // Uniform names the verdict ledger fingerprints (server/audit.mjs recordVerdict).
      question: row.message,
      expected: candidates,
    }],
    raw: item.entries.map(entry => entry.row),
  };
}

/** SymbolicLM on the message and on every clean candidate; a `gold_sop` is compared with the message's candidate parses. */
export async function executeCleanTextCase(item, {corpus, symbolic = symbolicChecker()}) {
  const {row} = item.entries[0];
  const message = await symbolic.check(row.message ?? '');
  const candidates = [];
  for (const text of candidatesOf(row).slice(0, CHECK_ROW_LIMIT)) {
    const check = await symbolic.check(text);
    candidates.push({text, check, ...compareChecks(message, check), matches_gold: row.gold_sop && check.ok ? check.sop.trim() === String(row.gold_sop).trim() : null});
  }
  return {caseId: item.id, corpus, type: 'cleanText', available: message.ok, rows: [{id: row.id, message: {text: row.message, check: message}, candidates}]};
}
