/** Component sentences of the composed evaluation and training cases (DS008 "Composed evaluation suites").
 *
 * A component is a self-contained message of one of the three datasets: it needs no other sentence to be understood
 * (no third-person pronoun or demonstrative that refers outside it, no leading discourse marker, no ellipsis word), holds
 * exactly one request or statement, has a verified analysis and, where available, a gold SOP. Pure functions over dataset
 * rows; `loadRows` reads the split files. Roles: `symbolic` (correct English SymbolicLM analyses correctly; expected text is
 * the message itself), `neuro` (correct English SymbolicLM misses; expected text is the verified rewrite target) and `bad`
 * (Romanian, mixed or noisy English; expected text is the clean target).
 */
import path from 'node:path';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {splitSentences} from '../../../lib/sentence-split.mjs';
import {mainForm, nameEntities, PERSON} from '../../datasets/three-datasets/forms.mjs';
export {nameEntities, PERSON};
import {sopBlocks} from './sop-canon.mjs';
import {hasGoldMatch} from '../../datasets/three-datasets/rows.mjs';

export const splitPath = (dataset, split) => `datasets/${dataset}/${split}.jsonl`;
/** Rows of the train and dev files of a dataset. Sealed test rows are read only by the auditor side (tools/eval/composed/sealed.mjs). */
export function loadRows(dataset, splits, root = ROOT) {
  return splits.flatMap(split => {
    if (!['train', 'dev'].includes(split)) throw Error(`loadRows reads train and dev only, not ${split}`);
    const file = path.join(root, splitPath(dataset, split));
    return jsonlExists(file) ? readJsonlShardedSync(file) : [];
  });
}

const OUTSIDE_PRONOUNS = new Set(['he', 'she', 'it', 'they', 'him', 'her', 'them', 'his', 'hers', 'its', 'their', 'theirs', 'himself', 'herself', 'itself', 'themselves', 'this', 'that', 'these', 'those', 'one', 'ones']);
const DISCOURSE_START = new Set(['also', 'and', 'so', 'but', 'then', 'ok', 'okay', 'well', 'or', 'yet', 'plus', 'anyway', 'now', 'right', 'thanks', 'thank', 'hello', 'hi', 'hey']);
const ELLIPSIS_WORDS = /\b(again|too|same|either|another|previous|former|latter|earlier|above|below|aforementioned|such|likewise|similarly|meanwhile)\b/i;
const TERMINAL = /[.?!]$/;

const words = text => String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** Whether the first sentence of a plain text leans on context: a leading discourse marker or an outside pronoun. */
export function needsContext(text) {
  const first = splitSentences(text)[0]?.text ?? '';
  const w = words(first);
  if (!w.length) return true;
  if (DISCOURSE_START.has(w[0])) return true;
  if (ELLIPSIS_WORDS.test(first)) return true;
  return w.some(x => OUTSIDE_PRONOUNS.has(x) && !(x === 'that' || x === 'it'))
    || /\bit\b/i.test(first) && !/\b(is|was|would be) it (correct|true|possible|the case|right)\b|\bit is (correct|true|possible|the case|clear|certain)\b|\bis it\b.*\bthat\b/i.test(first);
}

/** Outside references in an analysed single sentence: a personal or demonstrative pronoun that is not an expletive or a relative. */
export function hasOutsideReference(analysis) {
  for (const s of analysis?.sentences ?? []) {
    const byId = new Map(s.tokens.map(t => [t[0], t]));
    for (const [, form, lemma, upos, head, deprel] of s.tokens) {
      const l = String(lemma).toLowerCase();
      if (upos !== 'PRON' && upos !== 'DET' && !OUTSIDE_PRONOUNS.has(String(form).toLowerCase())) continue;
      if (!OUTSIDE_PRONOUNS.has(l) && !OUTSIDE_PRONOUNS.has(String(form).toLowerCase())) continue;
      if (deprel === 'expl') continue;
      if (['that', 'this'].includes(l) && byId.get(head)?.[5] === 'acl:relcl') continue;
      if (l === 'that' && upos !== 'PRON') continue;
      if (l === 'it' && byId.get(head)?.[5] === 'csubj') continue;
      if (upos === 'PRON' || (upos === 'DET' && ['this', 'that', 'these', 'those'].includes(l) && !s.tokens.some(t => t[4] === s.tokens.indexOf(t) + 1))) return true;
    }
  }
  return false;
}

const wordCount = text => String(text).split(/\s+/).filter(Boolean).length;
const cleanText = text => typeof text === 'string' && text.trim() === text && !/["“”\n\t]/.test(text);

/** The symbolic component of a symbolic_english row, or null with a reason when the row is not a self-contained component. */
export function symbolicComponent(row) {
  const reason = why => ({component: null, reason: why});
  const sentences = row.analysis?.sentences ?? [];
  if (sentences.length !== 1) return reason('not_one_sentence');
  // The composed suites score the SOP as well (the later layer): a component's expected SOP is verified, never SymbolicLM's own wrong output (a row whose SOP misses its gold is a symbolic_english row on the analysis layer only).
  if (row.sop_layer?.status === 'mismatch') return reason('sop_layer_mismatch');
  if (splitSentences(row.message).length !== 1) return reason('splitter_sees_several_sentences');
  if (!cleanText(row.message) || !TERMINAL.test(row.message)) return reason('quotes_newlines_or_no_terminal_punctuation');
  if (row.outcome !== 'converted' || !row.sop_valid || (row.unparsed ?? []).length || row.uncertain) return reason('not_a_clean_conversion');
  if (needsContext(row.message) || hasOutsideReference(row.analysis)) return reason('needs_context');
  const blocks = sopBlocks(row.sop);
  if (!blocks.length || blocks.length > 3 || blocks.filter(b => b.keyword === 'query').length > 1 || blocks.some(b => ['unparsed', 'unclear'].includes(b.keyword))) return reason('not_one_request_or_statement');
  if (wordCount(row.message) > 40) return reason('too_long');
  return {component: {
    role: 'symbolic', source_id: row.id, source_dataset: row.dataset, source_split: row.split, text: row.message, expected_text: row.message,
    expected_sop: row.sop, expected_sop_source: hasGoldMatch(row) ? 'gold' : 'verified_analysis', must_change: false,
    form: mainForm(row.analysis), sentences: 1, punctuated: true, analysis: row.analysis, family: row.source?.family ?? null,
  }};
}

/** The neuro component of a neuro_english row with a verified rewrite target, or null with a reason. */
export function neuroComponent(row) {
  const reason = why => ({component: null, reason: why});
  if (!row.rewrite_target || typeof row.target !== 'string' || !row.target || row.target === row.message) return reason('no_verified_target');
  const check = row.targets?.[0]?.check ?? {};
  const verified = check.strict === true || check.symbolic_ok === true || check.parse_ok === true;
  if (!verified) return reason('target_not_verified');
  if (!cleanText(row.message) || !cleanText(row.target)) return reason('quotes_or_newlines');
  if (needsContext(row.message) || needsContext(row.target)) return reason('needs_context');
  if (wordCount(row.message) > 60 || wordCount(row.target) > 70) return reason('too_long');
  const n = splitSentences(row.message).length, m = splitSentences(row.target).length;
  return {component: {
    role: 'neuro', source_id: row.id, source_dataset: row.dataset, source_split: row.split, text: row.message, expected_text: row.target,
    expected_sop: row.gold_sop ?? null, expected_sop_source: row.gold_sop ? 'gold' : 'symbolic_lm_on_target', must_change: true, target_source: row.target_source,
    form: null, sentences: n, target_sentences: m, punctuated: TERMINAL.test(row.message), family: row.source?.family ?? null, failure_kind: row.failure_kind,
  }};
}

/** The bad component of a bad_english row with a clean target, or null with a reason. */
export function badComponent(row) {
  const reason = why => ({component: null, reason: why});
  if (typeof row.target !== 'string' || !row.target || row.target === row.message) return reason('no_target');
  if (!cleanText(row.message) || !cleanText(row.target)) return reason('quotes_or_newlines');
  if (needsContext(row.target)) return reason('needs_context');
  if (wordCount(row.message) > 40 || wordCount(row.target) > 40) return reason('too_long');
  return {component: {
    role: 'bad', source_id: row.id, source_dataset: row.dataset, source_split: row.split, text: row.message, expected_text: row.target,
    expected_sop: null, expected_sop_source: null, must_change: true, target_source: row.target_source, language_kind: row.language_kind, noise_categories: row.noise_categories ?? [],
    form: null, sentences: splitSentences(row.message).length, target_sentences: splitSentences(row.target).length, punctuated: TERMINAL.test(row.message.trim()), family: row.source?.family ?? null,
  }};
}

/** Eligible components of a row list with counts of the reasons rows were left out. */
export function eligible(rows, make) {
  const components = [], rejected = {};
  for (const row of rows) {
    const {component, reason} = make(row);
    if (component) components.push(component); else rejected[reason] = (rejected[reason] ?? 0) + 1;
  }
  return {components, rejected};
}

/** The three pools of given rows. */
export function poolsFromRows({symbolic, neuro, bad}) {
  return {symbolic: eligible(symbolic, symbolicComponent), neuro: eligible(neuro, neuroComponent), bad: eligible(bad, badComponent)};
}

/** The three pools of the training side (`['train']`, `['dev']` or both). */
export function loadPools(splits, root = ROOT) {
  return poolsFromRows({symbolic: loadRows('symbolic_english', splits, root), neuro: loadRows('neuro_english', splits, root), bad: loadRows('bad_english', splits, root)});
}
