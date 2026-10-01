/** The analysis-layer gate of symbolic_english and neuro_english (owner direction of 2026-09-30 night; DS008 "Three datasets").
 *
 * A clean-English message is in `symbolic_english` when EVERY sentence of it passes the calibrated gate: the Stanza default and
 * accurate trees of the sentence are identical (head and relation of every word; `compareSentence` class `identical`,
 * lib/symbolic-lm/uncertainty.mjs) AND the DeepSeek parse judge (conditions a and c of tools/research/parse-judge.mjs, run from omp task
 * folders) says good enough on both (CORRECT, MINOR or INPUT_TYPO). The gate was calibrated at 97.8% precision on an enriched sample
 * (datasets_sources/parse_judge_deepseek/, journal "DeepSeek flash calibrated as a UD parse judge"). The SOP is not part of it: the
 * translation of the analysis into SOP Lang is a later layer and is kept per row as `sop_layer`.
 *
 * Everything here reads recorded observations only: the analysis cache of the datasets (the accurate tree of record), the default-package
 * trees (the cache `analysis-default-v1.6/`, else the recorded parses of eval/reports/current/neuro-oracle/parses/), and the verdict
 * files of every DeepSeek omp task folder, keyed on the sentence text plus its tree (`sentenceKey`; the calibration folder, whose ids are
 * not tree keys, is matched on the hash of the judged message). `decide` never calls Stanza or a model; `stage` records the missing
 * parses (GPU, one worker) and writes the judge items that are still missing into datasets_sources/resplit_parse_judge/.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {maskMessage} from '../../../lib/ud-to-sop/index.mjs';
import {compareSentence} from '../../../lib/symbolic-lm/uncertainty.mjs';
import {renderFull, renderTree, judgeMessage, checkMessage, RUBRIC, CHECK_SYSTEM} from '../../research/parse-judge.mjs';
import {ParseStore, readJsonl} from '../neuro-oracle/common.mjs';
import {recordParses} from '../neuro-oracle/parse.mjs';
import {sentenceKey} from '../neuro-oracle/judge.mjs';
import {loadCache, textKey, DEFAULT_ANALYSIS_DIR} from './analysis.mjs';

export const SOURCES_DIR = path.join(ROOT, 'datasets_sources');
export const JUDGE_DIR = path.join(SOURCES_DIR, 'resplit_parse_judge');
/** Verdict folders, in priority order (the first folder that holds a usable verdict for a sentence wins). */
export const VERDICT_FOLDERS = ['neuro_oracle_parse_judge', 'symbolic_proofing_parse_judge', 'backgen_parse_judge', 'parse_judge_deepseek', 'resplit_parse_judge'];
export const GATE_NAME = 'identical_trees_and_deepseek_ac';
export const GATE_JUDGE = 'DeepSeek-V4.1-Flash parse judge, conditions a and c (calibrated: datasets_sources/parse_judge_deepseek)';
const GOOD = new Set(['CORRECT', 'MINOR', 'INPUT_TYPO']);
export const isGood = verdict => GOOD.has(verdict);
const sha = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 20);
const WORST = {identical: 0, noncore_diff: 1, core_diff: 2};
/** Failure kinds of the analysis layer (neuro_english `failure_kind`), most objective first: the row takes the first that any sentence has. */
export const ANALYSIS_FAILURE_KINDS = Object.freeze(['trees_differ', 'judge_ac', 'judge_a', 'judge_c']);
/** `failure_kind` values beyond the gate: a row without analysis or with an unparsed span follows the SOP rules; `pending_judge` has no verdict yet. */
export const ROW_FAILURE_KINDS = Object.freeze([...ANALYSIS_FAILURE_KINDS, 'no_analysis', 'unparsed_span', 'pending_judge']);

// ------------------------------------------------------------------ verdicts
function readOutputs(dir) {
  const file = path.join(dir, 'output/verdicts.jsonl'), map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) { if (!line) continue; try { const r = JSON.parse(line); map.set(`${r.id}|${r.condition}`, r.answer); } catch { /* a partial last line of a running judge */ } }
  return map;
}

/** Verdict index over the task folders: by item id (a tree key) and by the hash of the judged message. Usable verdicts only (a null verdict is missing). */
export function loadVerdictIndex(folders = VERDICT_FOLDERS, base = SOURCES_DIR) {
  const byId = new Map(), byUser = new Map(), count = {};
  for (const folder of folders) {
    const dir = path.join(base, folder);
    const outputs = readOutputs(dir);
    if (!outputs.size) continue;
    const inputFile = path.join(dir, 'input/items.jsonl');
    const users = new Map();
    if (fs.existsSync(inputFile)) for (const item of readJsonl(inputFile)) users.set(`${item.id}|${item.condition}`, item.user);
    count[folder] = 0;
    for (const [k, answer] of outputs) {
      const verdict = answer?.verdict;
      if (typeof verdict !== 'string' || !verdict) continue;
      const entry = {verdict, folder};
      if (!byId.has(k)) byId.set(k, entry);
      const user = users.get(k);
      if (user !== undefined) { const u = `${sha(user)}|${k.slice(k.lastIndexOf('|') + 1)}`; if (!byUser.has(u)) byUser.set(u, entry); }
      count[folder]++;
    }
  }
  return {byId, byUser, count, get: (key, condition, user = null) => byId.get(`${key}|${condition}`) ?? (user === null ? undefined : byUser.get(`${sha(user)}|${condition}`))};
}

/** The judge messages of a sentence object `{text, words}`: condition a (reading plus arcs) and c (compact tree). */
export const judgeUsers = sentence => ({a: judgeMessage(sentence.text, renderFull(sentence)), c: checkMessage(sentence.text, renderTree(sentence))});

// ------------------------------------------------------------------ the gate
const compact = words => words.map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel]);

export class AnalysisGate {
  /** `acc` and `def` are the parse stores of the recorded accurate and default parses (tests inject empty ones). */
  constructor({cache = null, defaults = null, verdicts = null, acc = null, def = null} = {}) {
    this.cache = cache ?? loadCache();
    this.defaults = defaults ?? loadCache(DEFAULT_ANALYSIS_DIR);
    this.verdicts = verdicts ?? loadVerdictIndex();
    this.acc = acc ?? new ParseStore('accurate');
    this.def = def ?? new ParseStore('default');
    this.memo = new Map();
  }

  /** Reload the recorded parses and the judge verdicts (after a stage or a judge run). */
  reload() { this.acc.map = null; this.def.map = null; this.verdicts = loadVerdictIndex(); this.memo.clear(); }

  /** Analysis of a message: the stored analysis of the row (the accurate tree of record) from the cache unless given. */
  analysisOf(text, analysis = undefined) { return analysis !== undefined ? analysis : this.cache.get(textKey(text))?.analysis ?? null; }

  /** The recorded accurate parse (with entity tags) of a text, or null. */
  fullParse(text) { const store = this.acc.load(), m = maskMessage(text); return store.get(`en|${m}`) ?? store.get(`auto|${m}`) ?? null; }

  /** Sentences of the analysis as judge sentence objects `{text, words, key, ner, tokens}`; entity tags come from the recorded accurate parse when its tree is the same. */
  sentencesOf(text, analysis) {
    const full = this.fullParse(text);
    return (analysis?.sentences ?? []).map((s, i) => {
      const words = s.tokens.map(([id, form, lemma, upos, head, deprel]) => ({id, text: form, lemma, upos, head, deprel}));
      const sentence = {text: s.text, words};
      const key = sentenceKey(sentence);
      const f = full?.sentences?.[i];
      let ner = false;
      if (f && f.words.length === words.length && sentenceKey({text: f.text, words: f.words}) === key) { words.forEach((w, j) => { w.ner = f.words[j].ner; }); ner = true; }
      return {...sentence, key, ner, tokens: s.tokens};
    });
  }

  /** Compact default-package trees per sentence: the recorded default analysis (rules v1.6 cache), else the recorded default parse; null when neither exists. */
  defaultTokens(text) {
    const sentences = this.defaults.get(textKey(text))?.analysis?.sentences;
    if (sentences?.length) return sentences.map(s => s.tokens);
    const store = this.def.load(), m = maskMessage(text);
    const parse = store.get(`en|${m}`) ?? store.get(`auto|${m}`);
    return parse ? (parse.sentences ?? []).map(s => compact(s.words)) : null;
  }

  /**
   * Gate of one message. Returns {state: pass|fail|pending|no_analysis, sentences: [{sentence, key, tree, a, c, from}], reasons: [{sentence, kind, ...}],
   * failure_kind, worst_tree, missing: {default: bool, verdicts: [{sentence, condition}], ner: [sentence]}}. `pending` means a recorded parse or a judge verdict is
   * still missing and nothing failed; `no_analysis` means the message has no analysed sentence (the SOP rules then decide).
   */
  decide(text, analysis = undefined) {
    const memoKey = analysis === undefined ? text : null;
    if (memoKey !== null && this.memo.has(memoKey)) return this.memo.get(memoKey);
    const result = this.compute(text, this.analysisOf(text, analysis));
    if (memoKey !== null) this.memo.set(memoKey, result);
    return result;
  }

  compute(text, analysis) {
    const sentences = this.sentencesOf(text, analysis);
    if (!sentences.length) return {state: 'no_analysis', sentences: [], reasons: [], failure_kind: null, worst_tree: null, missing: {default: false, verdicts: [], ner: []}};
    const defaults = this.defaultTokens(text);
    const missing = {default: defaults === null, verdicts: [], ner: []};
    const detail = [], reasons = [];
    let worst = defaults === null ? null : 'identical';
    sentences.forEach((s, i) => {
      const tree = defaults === null ? null : (defaults.length !== sentences.length ? 'core_diff' : compareSentence(defaults[i], s.tokens));
      if (tree !== null && WORST[tree] > WORST[worst]) worst = tree;
      const row = {sentence: i, key: s.key, tree, a: null, c: null, from: null};
      detail.push(row);
      if (tree === null) return;
      if (tree !== 'identical') { reasons.push({sentence: i, kind: 'trees_differ', tree}); return; }
      const users = judgeUsers(s);
      const a = this.verdicts.get(s.key, 'a', users.a), c = this.verdicts.get(s.key, 'c', users.c);
      row.a = a?.verdict ?? null; row.c = c?.verdict ?? null; row.from = [...new Set([a?.folder, c?.folder].filter(Boolean))].join('+') || null;
      if (!a) missing.verdicts.push({sentence: i, condition: 'a'});
      if (!c) missing.verdicts.push({sentence: i, condition: 'c'});
      if ((!a || !c) && !s.ner) missing.ner.push(i);
      const badA = a && !isGood(a.verdict), badC = c && !isGood(c.verdict);
      if (badA || badC) reasons.push({sentence: i, kind: badA && badC ? 'judge_ac' : badA ? 'judge_a' : 'judge_c', a: row.a, c: row.c});
    });
    const failure_kind = ANALYSIS_FAILURE_KINDS.find(kind => reasons.some(r => r.kind === kind)) ?? null;
    const pending = missing.default || missing.verdicts.length > 0;
    return {state: reasons.length ? 'fail' : pending ? 'pending' : 'pass', sentences: detail, reasons, failure_kind, worst_tree: worst, missing};
  }
}

/** The `analysis_verdict` object stored on a row (no pending state is ever stored except on a `pending_judge` row). */
export function verdictRecord(decision, {unparsed = []} = {}) {
  return {
    state: decision.state, gate: GATE_NAME, judge: GATE_JUDGE,
    sentences: decision.sentences.map(({sentence, key, tree, a, c, from}) => ({sentence, key, tree, a, c, from})),
    reasons: decision.reasons, unparsed,
  };
}

/** The `verification.judge` object of a row (what the audit page shows): the per-sentence verdicts of the gate. */
export const judgeSummary = decision => ({mode: GATE_NAME, verdict: decision.state === 'pass' ? 'good_enough' : decision.state === 'fail' ? (decision.failure_kind ?? 'failed') : decision.state, sentences: decision.sentences.map(({sentence, tree, a, c}) => ({sentence, class: tree, a, c}))});

// ------------------------------------------------------------------ the judge task folder and staging
const JUDGE_SCRIPT = path.join(SOURCES_DIR, 'neuro_oracle_parse_judge/scripts/judge.py');

const TASK_TEXT = `# Task: judge automatic grammatical analyses (analysis-layer re-split of symbolic_english / neuro_english)

You are the judge of the analysis gate of the re-split of two datasets. Each item gives an English sentence and an automatic
dependency analysis of it produced by the Stanza parser. You decide whether the analysis is correct. Answer each item
honestly and independently of the others.

## Hard limits

- Work ONLY inside this folder (\`datasets_sources/resplit_parse_judge/\`). Read \`input/items.jsonl\`, \`SYSTEM_a.txt\`,
  \`SYSTEM_c.txt\`, \`scripts/judge.py\`; write \`output/verdicts.jsonl\` and, if needed, helper scripts in \`scripts/\`.
- Do NOT read or search other files of the repository, especially nothing under \`eval/\`. Do not edit anything outside
  this folder. No training, no servers, no GPU jobs, no commits.

## Input

\`input/items.jsonl\`: one line per judgement \`{"id": "...", "condition": "a" | "c", "user": "<the message to judge>"}\`. The
same sentence appears twice, once per condition. Condition \`a\` uses the instructions in \`SYSTEM_a.txt\`; condition \`c\` uses
\`SYSTEM_c.txt\`. For each item, treat the matching SYSTEM file as your complete instructions and the \`user\` text as the
material to judge. Answer exactly in the JSON format that the SYSTEM file prescribes.

## Output

\`output/verdicts.jsonl\`: one line per input item, same order:

\`\`\`json
{"id": "<item id>", "condition": "a", "answer": { ...the JSON object the SYSTEM file asks for... }}
\`\`\`

\`answer\` is the parsed JSON object, including at least \`verdict\` (CORRECT, MINOR, INPUT_TYPO, DEEP or FAIL, as the SYSTEM
file allows) and \`note\`. Every item appears exactly once.

## How to work

\`scripts/judge.py\` is the driver (the same one as the earlier runs): it calls the kernel \`completion()\` once per
item, at most N in flight, resumes from \`output/verdicts.jsonl\`, and rewrites the file in input order. In the omp eval
kernel run \`%load datasets_sources/resplit_parse_judge/scripts/judge.py\` and then \`state = run(concurrency=24)\`; repeat
\`run(concurrency=24)\` until \`written\` equals \`items\` (unresolved items are retried on the next call). Judge each item
separately; no extended reasoning budget beyond your default. The file \`input/items.jsonl\` may grow while earlier items
are judged (the builders append): always re-read it when you call \`run()\`. At the end check that the file has one valid
JSON line per input item, each with a \`verdict\`, and write \`REPORT.md\` (items done, verdict distribution per condition,
time taken, unresolved items).
`;

/** Create the judge task folder (system prompts generated from tools/research/parse-judge.mjs, the driver of the earlier runs, TASK.md). Idempotent. */
export function ensureJudgeFolder(dir = JUDGE_DIR) {
  for (const sub of ['input', 'output', 'scripts', 'logs']) fs.mkdirSync(path.join(dir, sub), {recursive: true});
  const put = (name, text) => { const file = path.join(dir, name); if (!fs.existsSync(file)) fs.writeFileSync(file, text); };
  put("SYSTEM_a.txt", RUBRIC + "\n");
  put("SYSTEM_c.txt", CHECK_SYSTEM + "\n");
  put('TASK.md', TASK_TEXT);
  const script = path.join(dir, 'scripts/judge.py');
  if (!fs.existsSync(script)) fs.writeFileSync(script, fs.readFileSync(JUDGE_SCRIPT, 'utf8').replaceAll('datasets_sources/neuro_oracle_parse_judge/', 'datasets_sources/resplit_parse_judge/').replace('for the neuro oracle parse judge (conditions a and c)', 'for the analysis-layer re-split parse judge (conditions a and c)'));
  return dir;
}

/** Append items (`{id, condition, user}`) not yet in the folder's input; returns {added, total}. */
export function appendItems(items, dir = JUDGE_DIR) {
  ensureJudgeFolder(dir);
  const file = path.join(dir, 'input/items.jsonl');
  const have = new Set(fs.existsSync(file) ? readJsonl(file).map(i => `${i.id}|${i.condition}`) : []);
  const fresh = [];
  for (const item of items) { const k = `${item.id}|${item.condition}`; if (!have.has(k)) { have.add(k); fresh.push(item); } }
  if (fresh.length) fs.appendFileSync(file, fresh.map(i => JSON.stringify(i)).join('\n') + '\n');
  return {added: fresh.length, total: have.size};
}

/** Seed the recorded accurate parses from the regression parse cache (tools/symbolic-regression.mjs record-parses) for the texts it holds. */
export function seedFromRegression(gate, file = path.join(ROOT, 'eval/reports/current/symbolic-regression/parses.json')) {
  if (!fs.existsSync(file)) return 0;
  const store = gate.acc, known = store.load();
  const parses = JSON.parse(fs.readFileSync(file, 'utf8')).parses ?? {};
  const entries = Object.entries(parses).filter(([key, parse]) => /^(en|auto)\|/.test(key) && !known.has(key) && parse?.sentences?.every(s => Array.isArray(s.words)));
  if (entries.length) store.append(entries);
  return entries.length;
}

/**
 * Stage the gate for `entries` (`{text, analysis?}`): record the default-package parses the gate lacks, seed or record the accurate parses that
 * carry the entity tags of the judge items, and append the judge items still missing. Returns the counts. `record: false` only counts.
 */
export async function stage(gate, entries, {record = true, log = () => {}} = {}) {
  const uniq = [...new Map(entries.map(e => [e.text, e])).values()];
  const decisions = () => uniq.map(e => ({e, d: gate.compute(e.text, gate.analysisOf(e.text, e.analysis))}));
  let seeded = 0, recordedDefault = 0, recordedAccurate = 0;
  if (record) seeded = seedFromRegression(gate);
  let now = decisions();
  const needDefault = now.filter(({d}) => d.missing.default).map(({e}) => e.text);
  if (record && needDefault.length) { log(`recording ${needDefault.length} default-package parses`); recordedDefault = (await recordParses(needDefault, 'default', {onProgress: (n, t) => log(`default ${n}/${t}`)})).recorded; gate.reload(); now = decisions(); }
  const needAccurate = now.filter(({d}) => d.missing.ner.length && d.state !== 'fail').map(({e}) => e.text);
  if (record && needAccurate.length) { log(`recording ${needAccurate.length} accurate parses (entity tags of the judge items)`); recordedAccurate = (await recordParses(needAccurate, 'accurate', {onProgress: (n, t) => log(`accurate ${n}/${t}`)})).recorded; gate.reload(); now = decisions(); }
  const items = new Map();
  for (const {e, d} of now) {
    // a text that already fails (trees differ in another sentence, or a verdict below good enough) needs no further judge call: its gate answer is fixed
    if (!d.missing.verdicts.length || d.state === 'fail') continue;
    const sentences = gate.sentencesOf(e.text, gate.analysisOf(e.text, e.analysis));
    for (const {sentence, condition} of d.missing.verdicts) {
      const s = sentences[sentence], users = judgeUsers(s);
      items.set(`${s.key}|${condition}`, {id: s.key, condition, user: users[condition]});
    }
  }
  const appended = record ? appendItems([...items.values()]) : {added: 0, total: null};
  const state = {};
  for (const {d} of now) state[d.state] = (state[d.state] ?? 0) + 1;
  return {texts: uniq.length, state, seeded, recorded_default: recordedDefault, recorded_accurate: recordedAccurate, items_needed: items.size, items_added: appended.added};
}
