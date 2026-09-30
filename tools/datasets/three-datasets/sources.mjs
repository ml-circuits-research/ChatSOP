/** Source records of the three datasets: one normalized record per candidate message, whatever its origin
 * (formalizer-v1 family rows, the LLM-written new cases, the Haiku-diversified paraphrases), classified once by the
 * clean-English classifier (`tools/datasets/clean-english.mjs`). The record keeps the source row (`row`) so the
 * assembler can score it against the gold SOP; nothing here opens a sealed test file (callers pass sealed rows in).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {loadSpellfix} from '../../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../../sop/dictionary.mjs';
import {classifyPartition} from '../clean-english.mjs';

export const NEW_CASES_DIR = 'datasets_sources/new_cases';
/** Noise tags of a new case whose message differs from its clean reference because of typing or register (bad_english). */
export const NEW_CASE_NOISE_TAGS = Object.freeze(['typos', 'casual_register']);

let resources = null;
export const languageResources = () => (resources ??= {spellfix: loadSpellfix(), dictionary: defaultDictionary()});

/** Partition of a bare message: `clean_en`, `noisy_en`, `ro` or `mixed` (the classifier's four classes). */
export function classifyMessage(message, language = 'en', row = {}) {
  return classifyPartition({...row, question: message, language, noise: row.noise ?? [], noise_level: row.noise_level ?? null, code_switch: row.code_switch ?? null}, languageResources());
}

/** Record of one formalizer-family row. `wild` marks rows without a verification world (scored against accepted golds). */
export function formalizerRecord(row, {corpus, split, suite = corpus, wild = false}) {
  const {partition, reasons} = classifyPartition(row, languageResources());
  return {
    kind: 'formalizer', corpus, suite, sourceId: row.id, split, splitGroupId: row.split_group_id ?? row.id, semanticCaseId: row.semantic_case_id ?? null,
    message: row.question, language: row.language, partition, reasons, family: row.family ?? null, questionType: row.question_type ?? null,
    noise: row.noise ?? [], noiseLevel: row.noise_level ?? null, codeSwitch: row.code_switch ?? null, wild, row,
  };
}

const sha = text => crypto.createHash('sha1').update(text).digest('hex');
/** The writer id of a new case (`llm-deepseek-flash/writer-07` -> `writer-07`). */
export const writerOf = nc => /writer-\d+/.exec(nc.author ?? '')?.[0] ?? 'writer-unknown';

/** Owner-sealed writers (split-proposal.json of the new-case delivery) and the deterministic dev writers. */
export function newCaseSplits(writers, sealed, devCount = 4) {
  const open = writers.filter(w => !sealed.includes(w)).sort((a, b) => sha('three-datasets-v1:' + a).localeCompare(sha('three-datasets-v1:' + b)));
  const dev = new Set(open.slice(0, devCount));
  return writer => (sealed.includes(writer) ? 'test' : dev.has(writer) ? 'dev' : 'train');
}

/** The new-case delivery as read-only input: rows, the sealed writers and the source hash. */
export function readNewCases(root = ROOT) {
  const file = path.join(root, NEW_CASES_DIR, 'cases.jsonl');
  const text = fs.readFileSync(file, 'utf8');
  const rows = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const proposal = JSON.parse(fs.readFileSync(path.join(root, NEW_CASES_DIR, 'split-proposal.json'), 'utf8'));
  return {rows, sealedWriters: proposal.sealedWriters, sha256: crypto.createHash('sha256').update(text).digest('hex'), bytes: text.length};
}

/**
 * Record of one new case. `partition` classifies the message; `noisy` is true when the message differs from its
 * clean reference and either the classifier calls it not clean English or a noise tag (`typos`, `casual_register`)
 * says so.
 */
export function newCaseRecord(nc, split) {
  let {partition, reasons} = classifyMessage(nc.message, nc.language ?? 'en');
  const different = nc.clean?.[0] !== nc.message;
  // Language identification calls ordinary English "mixed" when it contains words Romanian also lists ("dorm",
  // "can", "receipt"). A new case whose author declares the message already clean (identity) keeps that verdict.
  if (!different && partition === 'mixed') { partition = 'clean_en'; reasons = ['langid mixed overridden: identity case declared clean by its author']; }
  const noiseTags = (nc.categories ?? []).filter(tag => NEW_CASE_NOISE_TAGS.includes(tag));
  return {
    kind: 'new_case', corpus: 'new_cases', suite: 'new_cases', sourceId: nc.id, split, splitGroupId: writerOf(nc), semanticCaseId: null,
    message: nc.message, language: nc.language ?? 'en', partition, reasons, family: (nc.categories ?? [])[0] ?? null, questionType: null,
    noise: [], noiseLevel: null, codeSwitch: null, wild: false, different, noiseTags,
    noisy: partition !== 'clean_en' || (different && noiseTags.length > 0), row: nc,
  };
}
