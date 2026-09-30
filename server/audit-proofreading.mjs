/** Proofreading corpora in the visual audit (DS020 "Type-specific case views"): datasets_archive/proofing (train, dev,
 * hard_cases, ro_translated), the sealed eval/suites/proofing and datasets_archive/proofing-diverse-dev. A row is
 * `input` → `target`, an English message and its clean rewrite (`target` is null for a hard case with no rewrite
 * yet); a case groups every surface of one `semantic_case_id`. The reviewer sees the word diff, the kind, layer
 * and pipeline, and can run SymbolicLM on the input and on the target on demand.
 */
import {label, tally, compareChecks, CHECK_ROW_LIMIT, symbolicChecker} from './audit-shared.mjs';
import {diffWords} from '../lib/text-to-clean-english/index.mjs';

export const PROOFREADING_FACETS = [
  {key: 'split', label: 'Split'},
  {key: 'kind', label: 'Kind'},
  {key: 'layer', label: 'Failing layer'},
  {key: 'pipeline', label: 'Pipeline'},
  {key: 'language', label: 'Language'},
  {key: 'question_type', label: 'Question type'},
  {key: 'verdict', label: 'Verdict'},
];

const unique = values => [...new Set(values)].sort();

export function indexProofreadingCase(id, entries) {
  const rows = entries.map(entry => entry.row);
  const first = rows[0];
  const request = String(first.input ?? '').replace(/\s+/g, ' ').trim();
  return {
    id,
    entries,
    splits: unique(entries.map(entry => entry.split)),
    languages: unique(rows.map(row => label(row.language))),
    kind: unique(rows.map(row => label(row.kind))),
    layer: unique(rows.map(row => label(row.layer))),
    pipeline: unique(rows.map(row => label(row.pipeline ?? 'english'))),
    question_type: unique(rows.map(row => label(row.question_type))),
    request,
    haystack: (id + '\n' + rows.map(row => `${row.id}\n${row.input ?? ''}\n${row.target ?? ''}`).join('\n')).toLowerCase(),
  };
}

export const proofreadingListItem = item => ({kind: item.kind.join(', '), layer: item.layer.join(', '), pipeline: item.pipeline.join(', '), question_type: item.question_type.join(', ')});

const rowView = entry => {
  const {row} = entry;
  return {
    id: row.id,
    split: entry.split,
    file: entry.file,
    language: row.language,
    source_language: row.source_language ?? null,
    input: row.input ?? '',
    target: row.target ?? null,
    // Uniform names the verdict ledger fingerprints (server/audit.mjs recordVerdict).
    question: row.input ?? '',
    expected: row.target ?? null,
    spans: row.target === null || row.target === undefined ? null : diffWords(row.input ?? '', row.target),
    kind: row.kind ?? null,
    layer: row.layer ?? null,
    pipeline: row.pipeline ?? 'english',
    question_type: row.question_type ?? null,
    target_source: row.target_source ?? null,
    noise_ops: row.noise_ops ?? [],
    char_edit: row.char_edit ?? null,
    untranslated: row.untranslated ?? [],
    meaning_checks: row.meaning_checks ?? null,
    raw_oracle: row.raw_oracle ?? null,
    target_oracle: row.target_oracle ?? null,
    signals: row.signals ?? null,
    rights: row.rights ?? null,
    flags: row.quality_flags ?? {},
  };
};

export function proofreadingCaseDetail(item, {corpus, verdict, history, audit}) {
  return {
    id: item.id,
    corpus,
    type: 'proofreading',
    splits: item.splits,
    languages: item.languages,
    kind: item.kind,
    layer: item.layer,
    pipeline: item.pipeline,
    target: null,
    verdict,
    history,
    audit,
    rows: item.entries.map(rowView),
    raw: item.entries.map(entry => entry.row),
  };
}

/** SymbolicLM on the input and the target of each row (at most CHECK_ROW_LIMIT rows). */
export async function executeProofreadingCase(item, {corpus, symbolic = symbolicChecker()}) {
  const entries = item.entries.slice(0, CHECK_ROW_LIMIT);
  const rows = [];
  for (const {row} of entries) {
    const input = await symbolic.check(row.input ?? '');
    const target = row.target ? await symbolic.check(row.target) : null;
    rows.push({id: row.id, input, target, ...(target ? compareChecks(input, target) : {same_sop: null, improved: null})});
  }
  return {caseId: item.id, corpus, type: 'proofreading', truncated: item.entries.length > entries.length, rows, available: rows.every(row => row.input.ok)};
}

export const proofreadingSummary = rows => ({kinds: tally(rows.map(row => label(row.kind))), pipelines: tally(rows.map(row => label(row.pipeline ?? 'english')))});
