/** DeepSeek judge inputs and verdicts of the neuro oracle (omp task folders, like datasets_sources/parse_judge_deepseek/).
 *
 *  - `datasets_sources/neuro_oracle_parse_judge/`: the calibrated parse judge, conditions a and c, one pair of items per
 *    distinct sentence of a candidate that reached the judge stage (tree of the accurate package, NER included);
 *  - `datasets_sources/neuro_oracle_meaning_judge/`: the meaning check, `ORIGINAL` vs `REWRITE`, yes/no with a reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {renderFull, renderTree, judgeMessage, checkMessage} from '../../research/parse-judge.mjs';
import {maskMessage} from '../../../lib/ud-to-sop/index.mjs';
import {ROOT, textKey, writeJsonl, readJsonl} from './common.mjs';
import {loadVerdictIndex, appendItems} from '../three-datasets/analysis-gate.mjs';

export const PARSE_DIR = path.join(ROOT, 'datasets_sources/neuro_oracle_parse_judge');
export const MEANING_DIR = path.join(ROOT, 'datasets_sources/neuro_oracle_meaning_judge');
const GOOD = new Set(['CORRECT', 'MINOR', 'INPUT_TYPO']);

/** Sentence objects of the accurate parse of a candidate text, as the judge renderers expect them. */
export function judgeSentences(text, store) {
  const parse = store.get(`en|${maskMessage(text)}`) ?? store.get(`auto|${maskMessage(text)}`);
  return (parse?.sentences ?? []).map(s => ({text: s.text, words: s.words.map(w => ({id: w.id, text: w.text, lemma: w.lemma, upos: w.upos, head: w.head, deprel: w.deprel, ner: w.ner}))}));
}
export const sentenceKey = sentence => textKey(sentence.text + '|' + sentence.words.map(w => [w.text, w.upos, w.head, w.deprel].join(':')).join(' '));

/** Verdict view over every DeepSeek parse-judge folder (tools/datasets/three-datasets/analysis-gate.mjs): `get('<sentence key>|a')` -> {verdict, folder}, the shape `gateOf` reads. */
export function parseVerdicts() { const index = loadVerdictIndex(); return {get: key => index.byId.get(key), index}; }

/**
 * Items of the parse judge for the candidates still to be gated, appended to the judge folder of the analysis-layer re-split
 * (datasets_sources/resplit_parse_judge/). A sentence that any DeepSeek folder already judged (same text and tree) is not asked again.
 * Returns the cid -> sentence keys index.
 */
export function writeParseItems(toJudge, store) {
  const {index: verdicts} = parseVerdicts();
  const items = new Map(), index = {};
  const seen = new Set();
  for (const c of toJudge) {
    const sentences = judgeSentences(c.text, store);
    index[c.cid] = sentences.map(sentenceKey);
    for (const s of sentences) {
      const k = sentenceKey(s);
      seen.add(k);
      for (const [condition, user] of [['a', judgeMessage(s.text, renderFull(s))], ['c', checkMessage(s.text, renderTree(s))]]) if (!verdicts.byId.has(`${k}|${condition}`)) items.set(`${k}|${condition}`, {id: k, condition, user});
    }
  }
  const {added} = appendItems([...items.values()]);
  return {index, sentences: seen.size, new_items: added};
}

/** Verdicts of a folder: Map('<id>|<condition>' -> answer object), the later line winning. */
export function readVerdicts(dir) {
  const file = path.join(dir, 'output/verdicts.jsonl'), map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) { if (!line) continue; try { const r = JSON.parse(line); map.set(`${r.id}|${r.condition}`, r.answer); } catch { /* partial line */ } }
  return map;
}

/** Gate verdict of a candidate: {state: 'pass'|'fail'|'pending', failed: [{sentence, a, c}]}. */
export function gateOf(keys, verdicts) {
  const failed = [];
  let pending = false;
  keys.forEach((k, i) => {
    const a = verdicts.get(`${k}|a`), c = verdicts.get(`${k}|c`);
    if (!a || !c) { pending = true; return; }
    const good = x => GOOD.has(x?.verdict);
    if (!good(a) || !good(c)) failed.push({sentence: i, a: a.verdict ?? null, c: c.verdict ?? null});
  });
  return {state: failed.length ? 'fail' : pending ? 'pending' : 'pass', failed};
}

export const meaningUser = (message, candidate) => `ORIGINAL: ${message}\n\nREWRITE: ${candidate}`;

/** The calibrated meaning judge (experiment eval-meaning-judge-calibration-v1, two-vote rule): the task folder of the re-split holds the prompts `SYSTEM_m1.txt` and `SYSTEM_m2.txt` (byte-identical to datasets_sources/backgen_meaning_judge/) and an item per vote. */
export const RESPLIT_MEANING_DIR = path.join(ROOT, 'datasets_sources/resplit_meaning_judge');
const MEANING_SHARED = ['SYSTEM_m1.txt', 'SYSTEM_m2.txt', 'scripts/judge.py'];

/** Appends meaning items `{cid, message, candidate}` (two per pair: m1 and m2) to the folder; returns {added, total}. Creates the folder from datasets_sources/backgen_meaning_judge/ on first use. */
/** Item id of a meaning pair: the candidate id plus a hash of the exact texts judged, so a candidate that was rewritten later never inherits the verdict of its earlier text. */
export const meaningItemId = (cid, message, candidate) => `${cid}~${crypto.createHash('sha1').update(meaningUser(message, candidate)).digest('hex').slice(0, 10)}`;

export function appendMeaningItems(pairs, dir = RESPLIT_MEANING_DIR) {
  const from = path.join(ROOT, 'datasets_sources/backgen_meaning_judge');
  for (const sub of ['input', 'output', 'scripts', 'logs']) fs.mkdirSync(path.join(dir, sub), {recursive: true});
  for (const f of MEANING_SHARED) if (!fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(from, f), path.join(dir, f));
  const task = path.join(dir, 'TASK.md');
  if (!fs.existsSync(task)) fs.writeFileSync(task, fs.readFileSync(path.join(from, 'TASK.md'), 'utf8').replaceAll('datasets_sources/backgen_meaning_judge/', 'datasets_sources/resplit_meaning_judge/').replace('(back-generated pairs)', '(rewrite candidates of neuro_english rows, analysis-layer re-split)').replace('a complex paraphrase) and a REWRITE of it (the plain original)', 'a message of a dataset row) and a REWRITE candidate of it'));
  const file = path.join(dir, 'input/items.jsonl');
  const have = new Set(fs.existsSync(file) ? readJsonl(file).map(i => `${i.id}|${i.condition}`) : []);
  const fresh = [];
  for (const p of pairs) for (const condition of ['m1', 'm2']) { const id = meaningItemId(p.cid, p.message, p.candidate), k = `${id}|${condition}`; if (have.has(k)) continue; have.add(k); fresh.push({id, condition, user: meaningUser(p.message, p.candidate)}); }
  if (fresh.length) fs.appendFileSync(file, fresh.map(i => JSON.stringify(i)).join('\n') + '\n');
  return {added: fresh.length, total: have.size};
}

/** Two-vote meaning of a candidate from the folder's verdicts: 'yes' only when m1 and m2 both say yes, 'no' when either says no, null while a vote is missing or unusable. */
export function meaningVotes(dir = RESPLIT_MEANING_DIR) {
  const verdicts = readVerdicts(dir), out = new Map();
  const cids = new Set([...verdicts.keys()].map(k => k.slice(0, k.lastIndexOf('|'))));
  for (const cid of cids) {
    const a = meaningOf(verdicts.get(`${cid}|m1`)), b = meaningOf(verdicts.get(`${cid}|m2`));
    out.set(cid, a === 'no' || b === 'no' ? 'no' : a === 'yes' && b === 'yes' ? 'yes' : null);
  }
  return out;
}
export const meaningOf = (answer) => (answer?.preserves === 'yes' ? 'yes' : answer?.preserves === 'no' ? 'no' : null);
