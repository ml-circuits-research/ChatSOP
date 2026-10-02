/**
 * The formalization regression set (AGENTS.md "Formalization improvement"): every case of the formalization error inbox
 * (state/formalization-errors/inbox.jsonl) enters an accumulating set, `eval/formalization-regression/cases.jsonl` (in git).
 *
 * Rights (DS011, docs/runtime.html "Evaluating on the owner's problem books"): the owner's books and every text derived from them stay
 * in the gitignored datasets_sources/ and state/, so a case in git holds only references and labels: its id, provenance (source, book,
 * problem id, the inbox observations), the kind of the gold answer, and the cluster of its last failure. The runner resolves the
 * message and the gold answer at run time from `datasets_sources/books/eval/items.jsonl` (books) or from the inbox (other sources).
 * Annotations derived from a book text (a gold circuit, the key values and formula) live in the gitignored
 * `datasets_sources/formalization-regression/annotations.jsonl`, keyed by case id.
 *
 * Sealed suites never enter: a case whose provenance points at `eval/suites/` (or at a sealed test file) is refused by provenance,
 * so this code never opens a sealed test file (eval/leakage.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {INBOX} from '../../../lib/formalization-errors.mjs';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const CASES = path.join(ROOT, 'eval/formalization-regression/cases.jsonl');
export const ITEMS = path.join(ROOT, 'datasets_sources/books/eval/items.jsonl');
export const ANNOTATIONS = path.join(ROOT, 'datasets_sources/formalization-regression/annotations.jsonl');
export const STATE = path.join(ROOT, 'state/formalization-regression');

const readJsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const norm = s => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export const messageHash = text => createHash('sha256').update(norm(text)).digest('hex').slice(0, 16);

/** A provenance that points into a sealed suite (never admitted). */
export const sealedRef = ref => /(?:^|\/)eval\/suites\/|(?:^|\/)test\.jsonl\b/.test(typeof ref === 'string' ? ref : JSON.stringify(ref ?? ''));

/** The structural codes of an inbox detail (outcome, status, validator codes); free text (a judge's reason, a quoted value) is dropped. */
export function detailCodes(detail) {
  const parts = (Array.isArray(detail) ? detail : String(detail ?? '').split(/\s*\|\s*/)).map(String);
  const codes = parts.flatMap(p => /^[a-z_]+(?:\s*\([a-z_]+\))?$/.test(p.trim()) ? [p.trim()] : [...p.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map(m => m[1]));
  return [...new Set(codes)].slice(0, 12);
}

/** The case id of an inbox row: a book problem is `books/<problem id>`; anything else is `<source>/<hash of the message>`. */
export function caseIdOf(row) {
  if (row.ref && typeof row.ref === 'object' && row.ref.book && row.ref.id) return `books/${row.ref.id}`;
  return `${String(row.source ?? 'unknown').replace(/[^\w-]+/g, '-')}/${messageHash(row.message)}`;
}

/** The base memory a case runs against: book problems state their own data (the chat default); other sources name theirs. */
function needsOf(row) {
  const ref = typeof row.ref === 'string' ? row.ref : '';
  if (/ingest-v1\//.test(ref)) return {runnable: false, reason: 'needs the ingest-v1 base memory of its document (the runner covers the chat default base)'};
  return {runnable: true};
}

export const loadCases = (file = CASES) => readJsonl(file);
export const loadItems = () => new Map(readJsonl(ITEMS).map(i => [i.id, i]));
export const loadAnnotations = () => new Map(readJsonl(ANNOTATIONS).map(a => [a.id, a]));

/**
 * Merge the inbox into the case list: new cases are appended (dedup by case id, and by message hash across sources), an existing
 * case gains the new observations. Returns {cases, added, updated, refused}. Order is stable: existing cases first, then new ones by
 * first observation time.
 */
export function mergeInbox({cases = loadCases(), inbox = readJsonl(INBOX), items = loadItems()} = {}) {
  const byId = new Map(cases.map(c => [c.id, c]));
  const byHash = new Map(cases.filter(c => c.message_sha).map(c => [c.message_sha, c.id]));
  const refused = [], added = [], updated = new Set();
  for (const row of inbox) {
    if (!row?.message) continue;
    if (sealedRef(row.ref)) { refused.push({reason: 'sealed suite', ref: row.ref}); continue; }
    const sha = messageHash(row.message);
    const id = byId.has(caseIdOf(row)) ? caseIdOf(row) : byHash.get(sha) ?? caseIdOf(row);
    const observation = {t: row.t, source: row.source, kind: row.kind, strategy: row.strategy ?? null, tier: row.tier ?? null,
      run: row.ref?.run ?? (typeof row.ref === 'string' ? row.ref : null), arm: row.ref?.arm ?? null, codes: detailCodes(row.detail)};
    let c = byId.get(id);
    if (!c) {
      const item = row.ref?.book ? items.get(row.ref.id) : null;
      c = {id, source: row.ref?.book ? 'books' : row.source, provenance: {reporter: row.source, book: row.ref?.book ?? null, problem_id: row.ref?.book ? row.ref.id : null,
          ref: typeof row.ref === 'string' ? row.ref : null, first_seen: row.t},
        message_sha: sha, gold_kind: item?.answer_kind ?? (row.expected == null ? 'none' : 'text'), area: item?.area ?? null, grade: item?.grade ?? null,
        ...needsOf(row), observations: []};
      byId.set(id, c); byHash.set(sha, id); added.push(id);
    }
    const key = o => `${o.t}|${o.kind}|${o.strategy}|${o.tier}|${o.run}`;
    if (!c.observations.some(o => key(o) === key(observation))) { c.observations.push(observation); if (!added.includes(id)) updated.add(id); }
  }
  return {cases: [...byId.values()], added, updated: [...updated], refused};
}

/** The text and gold of a case at run time (never stored in git). Returns null when its source text is not available locally. */
export function resolveCase(c, {items = loadItems(), inbox = null, annotations = loadAnnotations()} = {}) {
  let message = null, gold = null, gold_kind = c.gold_kind, gold_value = null;
  if (c.source === 'books') {
    const item = items.get(c.provenance.problem_id);
    if (!item) return null;
    ({question: message, answer: gold, answer_kind: gold_kind, answer_value: gold_value} = item);
  } else {
    const row = (inbox ?? readJsonl(INBOX)).find(r => messageHash(r.message) === c.message_sha);
    if (!row) return null;
    message = row.message; gold = row.expected ?? null;
  }
  return {...c, message, gold, gold_kind, gold_value, annotation: annotations.get(c.id) ?? null};
}

export function writeCases(cases, file = CASES) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, cases.map(c => JSON.stringify(c)).join('\n') + '\n');
}
