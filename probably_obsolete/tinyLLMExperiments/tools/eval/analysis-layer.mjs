/** Grammatical-analysis layer of the SymbolicProofingLLM evaluation (owner direction of 2026-09-30: test one layer at a time,
 * natural language and grammatical analysis first, SOP Lang second).
 *
 * The calibrated gate of a sentence is: the Stanza default and accurate trees are identical (`compareSentence` class
 * `identical`, lib/symbolic-lm/uncertainty.mjs) AND the DeepSeek parse judge, conditions a and c, both say good enough
 * (CORRECT, MINOR or INPUT_TYPO; tools/datasets/neuro-oracle/judge.mjs). A text passes when every one of its sentences passes.
 * Judge verdicts come from omp task folders (datasets_sources/neuro_oracle_parse_judge/, read only, and this experiment's own
 * datasets_sources/symbolic_proofing_parse_judge/); a sentence without verdict is `pending`, never guessed.
 *
 * Also here: the analysis signature (two texts have "the same analysis" when their sentences have the same non-punctuation
 * tokens with the same part of speech, relation and head word), and the decomposition measures (sentence count, finite clauses
 * per sentence, explicit subject). No text leaves the repository; nothing here trains or calls a model.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, ParseStore, readJsonl, writeJsonl} from '../datasets/neuro-oracle/common.mjs';
import {recordParses} from '../datasets/neuro-oracle/parse.mjs';
import {judgeSentences, sentenceKey, gateOf, PARSE_DIR} from '../datasets/neuro-oracle/judge.mjs';
import {loadVerdictIndex} from '../datasets/three-datasets/analysis-gate.mjs';
import {defaultTrees, treeAgreement} from '../datasets/neuro-oracle/classify.mjs';
import {renderFull, renderTree, judgeMessage, checkMessage} from '../research/parse-judge.mjs';
import {maskMessage} from '../../lib/ud-to-sop/index.mjs';
import {compareAnalyses} from '../../lib/languages-util/analysis-compare.mjs';

export const JUDGE_DIR = path.join(ROOT, 'datasets_sources/symbolic_proofing_parse_judge');
const SHARED_FILES = ['SYSTEM_a.txt', 'SYSTEM_c.txt', 'scripts/judge.py'];

const compact = sentence => sentence.words.map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel]);
const CLAUSAL = new Set(['root', 'advcl', 'acl', 'acl:relcl', 'ccomp', 'csubj', 'csubj:pass', 'parataxis']);

export class AnalysisLayer {
  constructor() { this.acc = new ParseStore('accurate'); this.def = new ParseStore('default'); this.cache = new Map(); this.verdicts = null; }

  /** Record the accurate and default Stanza parses of the texts not yet recorded (GPU, one worker). */
  async ensure(texts) {
    const unique = [...new Set(texts.filter(t => typeof t === 'string' && t.trim()))];
    const out = {};
    for (const pkg of ['accurate', 'default']) { out[pkg] = await recordParses(unique, pkg); (pkg === 'accurate' ? this.acc : this.def).map = null; }
    this.cache.clear();
    return out;
  }

  reloadVerdicts() {
    // every DeepSeek parse-judge task folder (the gate of the datasets uses the same index), keyed on sentence text plus tree
    this.verdicts = new Map([...loadVerdictIndex().byId].map(([key, entry]) => [key, {verdict: entry.verdict}]));
    return this.verdicts.size;
  }

  /** Analysis of a text: sentences with compact trees, tree-agreement class and judge key. Null when the parse is not recorded. */
  info(text) {
    if (this.cache.has(text)) return this.cache.get(text);
    const sentences = judgeSentences(text, this.acc.load());
    let result = null;
    if (sentences.length) {
      const tokens = sentences.map(s => ({tokens: compact(s)}));
      const agreement = treeAgreement(tokens, defaultTrees(text, this.def.load(), maskMessage));
      result = {sentences: sentences.map((s, i) => ({text: s.text, words: s.words, key: sentenceKey(s), tree: agreement.sentences[i]}))};
    }
    this.cache.set(text, result);
    return result;
  }

  /** Items the judge still has to answer for these texts (sentences with identical trees and no verdict yet). */
  pendingItems(texts) {
    if (!this.verdicts) this.reloadVerdicts();
    const items = new Map();
    for (const text of texts) {
      const info = this.info(text);
      if (!info) continue;
      for (const s of info.sentences) {
        if (s.tree !== 'identical') continue;
        if (!this.verdicts.has(`${s.key}|a`)) items.set(`${s.key}|a`, {id: s.key, condition: 'a', user: judgeMessage(s.text, renderFull(s))});
        if (!this.verdicts.has(`${s.key}|c`)) items.set(`${s.key}|c`, {id: s.key, condition: 'c', user: checkMessage(s.text, renderTree(s))});
      }
    }
    return [...items.values()];
  }

  /** Gate of a text: {pass, pending, sentences, failed}; a sentence fails on a tree disagreement or a judge verdict below good enough. */
  gate(text) {
    if (!this.verdicts) this.reloadVerdicts();
    const info = this.info(text);
    if (!info) return {pass: false, pending: false, parsed: false, sentences: 0, failed: [{sentence: 0, tree: 'no_parse'}]};
    const failed = [];
    let pending = false;
    info.sentences.forEach((s, i) => {
      if (s.tree !== 'identical') { failed.push({sentence: i, tree: s.tree}); return; }
      const g = gateOf([s.key], this.verdicts);
      if (g.state === 'pending') pending = true;
      else if (g.state === 'fail') failed.push({sentence: i, tree: 'identical', a: g.failed[0].a, c: g.failed[0].c});
    });
    return {pass: !failed.length && !pending, pending: !failed.length && pending, parsed: true, sentences: info.sentences.length, failed};
  }

  /** Local-only analysis check (no DeepSeek): every sentence of the text has identical Stanza default and accurate trees. A tree disagreement is "not certified", never "wrong". */
  localPass(text) {
    const info = this.info(text);
    return Boolean(info && info.sentences.every(s => s.tree === 'identical'));
  }

  /** Compact analysis of a text (the accurate parse) in the shape of lib/languages-util/analysis-compare.mjs; null when the parse is not recorded. */
  compact(text) {
    const info = this.info(text);
    if (!info) return null;
    return {columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences: info.sentences.map(s => ({text: s.text, tokens: s.words.map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel])}))};
  }

  /** Local meaning check (analysis-compare-v1, about 98% precision when it says `equivalent`): the verdict of the rewrite `output` against the message `input`. Only `equivalent` lets a pair skip the LLM judge. */
  localMeaning(input, output) {
    const a = this.compact(input), b = this.compact(output);
    if (!a || !b) return 'uncertain';
    try { return compareAnalyses(a, b, {textA: input, textB: output}).verdict; } catch { return 'uncertain'; }
  }

  /** Signature of the analysis: per sentence the non-punctuation tokens as text|upos|deprel|head word. */
  signature(text) {
    const info = this.info(text);
    if (!info) return null;
    return info.sentences.map(s => {
      const byId = new Map(s.words.map(w => [w.id, w]));
      return s.words.filter(w => w.upos !== 'PUNCT').map(w => [w.text, w.upos, w.deprel, w.head ? byId.get(w.head)?.text ?? '' : 'ROOT'].join('|')).join(' ');
    });
  }

  sameAnalysis(a, b) {
    const x = this.signature(a), y = this.signature(b);
    return Boolean(x && y && x.length === y.length && x.every((s, i) => s === y[i]));
  }

  /** Decomposition measures of a text: sentences, finite clauses per sentence, explicit subject of the main clause. */
  shape(text) {
    const info = this.info(text);
    if (!info) return null;
    const rows = info.sentences.map(s => {
      const kids = new Map(s.words.map(w => [w.id, []]));
      for (const w of s.words) if (w.head) kids.get(w.head)?.push(w);
      const predWord = w => ['VERB', 'AUX'].includes(w.upos) || kids.get(w.id).some(k => k.deprel === 'cop');
      const heads = s.words.filter(w => CLAUSAL.has(w.deprel) || (w.deprel === 'conj' && (predWord(w) || kids.get(w.id).some(k => /^(nsubj|csubj|cop|aux)/.test(k.deprel)))));
      const root = s.words.find(w => w.deprel === 'root');
      const subject = root ? kids.get(root.id).some(k => /^(nsubj|csubj|expl)/.test(k.deprel)) : false;
      return {clauses: Math.max(heads.length, 1), subject, words: s.words.filter(w => w.upos !== 'PUNCT').length};
    });
    return {sentences: rows.length, one_clause: rows.filter(r => r.clauses === 1).length, subject: rows.filter(r => r.subject).length, max_words: Math.max(...rows.map(r => r.words)), clauses: rows.reduce((a, r) => a + r.clauses, 0)};
  }
}

/** Write the judge task folder (shared system prompts and driver copied from the neuro oracle folder) and append the pending items. */
export function writeJudgeItems(items) {
  fs.mkdirSync(path.join(JUDGE_DIR, 'input'), {recursive: true});
  fs.mkdirSync(path.join(JUDGE_DIR, 'output'), {recursive: true});
  fs.mkdirSync(path.join(JUDGE_DIR, 'scripts'), {recursive: true});
  for (const f of SHARED_FILES) if (!fs.existsSync(path.join(JUDGE_DIR, f))) fs.copyFileSync(path.join(PARSE_DIR, f), path.join(JUDGE_DIR, f));
  const task = path.join(JUDGE_DIR, 'TASK.md');
  if (!fs.existsSync(task)) fs.writeFileSync(task, fs.readFileSync(path.join(PARSE_DIR, 'TASK.md'), 'utf8').replaceAll('neuro_oracle_parse_judge', 'symbolic_proofing_parse_judge').replace('(neuro oracle gate)', '(SymbolicProofingLLM evaluation, analysis layer)').replace('of the acceptance gate of the neuro oracle', 'of the analysis gate of the SymbolicProofingLLM evaluation'));
  const file = path.join(JUDGE_DIR, 'input/items.jsonl');
  const have = new Set(fs.existsSync(file) ? readJsonl(file).map(i => `${i.id}|${i.condition}`) : []);
  const add = items.filter(i => !have.has(`${i.id}|${i.condition}`));
  if (add.length) fs.appendFileSync(file, add.map(i => JSON.stringify(i)).join('\n') + '\n');
  return {added: add.length, total: have.size + add.length};
}

/** Wilson interval in percent (shared with the composed evaluation). */
export {wilson} from './composed/stats.mjs';
export {writeJsonl};
