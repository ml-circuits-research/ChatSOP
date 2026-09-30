/** The acceptance gate of symbolic_english for rows without a gold SOP (experiments eval-symbolic-gate-v1 and
 * eval-symbolic-accurate-adopt-v1, DS008 "Three datasets").
 *
 * Reads only recorded observations (the analysis caches and the judge verdicts under
 * eval/reports/current/three-datasets/judge/), so the builders stay reproducible without Stanza or an API call.
 * The verdicts are written by tools/eval/symbolic-gate.mjs.
 *
 * Since the adoption of the accurate Stanza package the analysis of a row IS the accurate tree. A verdict judges a tree,
 * not an SOP, so the stored verdicts of the default package (`gate-verdicts.jsonl`, condition c on the default tree) still
 * hold for every sentence whose default and current trees are identical; the current tree of a differing sentence is
 * judged anew (`gate-verdicts-accurate.jsonl`).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {loadCache, DEFAULT_ANALYSIS_DIR} from './analysis.mjs';

export const JUDGE_DIR = path.join(ROOT, 'eval/reports/current/three-datasets/judge');
export const GATE_MODE = 'accurate_bc';
const GOOD = new Set(['CORRECT', 'MINOR', 'INPUT_TYPO']);
export const isGood = verdict => GOOD.has(verdict);

const readLines = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

/** Verdict index: `${textKey}|${sentence}|${condition}` -> verdict (null: unusable) from a verdicts file of the judge dir. */
export function loadVerdicts(name = 'gate-verdicts.jsonl', dir = JUDGE_DIR) {
  const map = new Map();
  for (const r of readLines(path.join(dir, name))) map.set(`${r.k}|${r.sentence}|${r.condition}`, r.verdict ?? null);
  return map;
}

/** Both verdict stores: `old` (condition c on default-package trees) and `acc` (current-tree verdicts). */
export const loadVerdictStores = () => ({old: loadVerdicts('gate-verdicts.jsonl'), acc: loadVerdicts('gate-verdicts-accurate.jsonl')});

/**
 * The verdict of one sentence and condition, or undefined when it still has to be judged. A current-tree verdict wins;
 * for a sentence with identical default and current trees the stored default-tree verdict is reused unless it was unusable.
 */
export function verdictOf(stores, k, i, condition, identical) {
  const key = `${k}|${i}|${condition}`;
  if (stores.acc.has(key)) return stores.acc.get(key);
  if (identical && stores.old.has(key) && stores.old.get(key) !== null) return stores.old.get(key);
  return undefined;
}

/**
 * Decision for a row without a gold SOP. `cmp` is the default/current comparison (`compareAnalyses`), `sentences` the
 * number of sentences of the current analysis. Returns {state: accept|reject|pending, route, failure_kind, judge, missing}.
 *
 * Every sentence needs an accepting condition-c verdict; a sentence whose tree differs from the default package's needs
 * condition b as well (b runs only on sentences c accepts). Route `parsers_agree_c` when every tree is identical (the
 * stored default-tree verdicts apply), else `accurate_judge_bc`. failure_kind is `parser` when both judges ran on a
 * sentence and both said not good enough, otherwise `unknown`. `missing` lists `{i, condition}` still to be judged.
 */
export function decideNoGold({k, sentences, cmp, stores}) {
  const judge = [], missing = [];
  let bad = 0, unclear = 0, anyDiffering = false;
  for (let i = 0; i < sentences; i++) {
    const cls = cmp?.sentences?.[i] ?? 'core_diff';
    const identical = cls === 'identical';
    if (!identical) anyDiffering = true;
    const c = verdictOf(stores, k, i, 'c', identical);
    const b = identical ? undefined : verdictOf(stores, k, i, 'b', false);
    judge.push({sentence: i, class: cls, b: b ?? null, c: c ?? null});
    if (c === undefined) { missing.push({i, condition: 'c', identical}); continue; }
    if (c === null || !isGood(c)) { if (c !== null && b !== undefined && b !== null && !isGood(b)) bad++; else unclear++; continue; }
    if (identical) continue;
    if (b === undefined) { missing.push({i, condition: 'b', identical}); continue; }
    if (b === null || !isGood(b)) unclear++;
  }
  const route = anyDiffering ? 'accurate_judge_bc' : 'parsers_agree_c';
  if (bad || unclear) return {state: 'reject', route: null, failure_kind: bad && !unclear ? 'parser' : 'unknown', judge, missing};
  if (missing.length) return {state: 'pending', route: null, failure_kind: null, judge, missing};
  return {state: 'accept', route, failure_kind: null, judge, missing};
}

/** Work lists (`gate-worklist-<side>.json`: text keys and the sentence judgements still to run) written by the assemblers. */
export function writeWorklist(side, list, dir = JUDGE_DIR) {
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, `gate-worklist-${side}.json`), JSON.stringify({note: 'text keys and sentence judgements still to run (no text); written by the dataset assemblers', side, ...list}) + '\n');
}
export function readWorklists(dir = JUDGE_DIR) {
  return ['train-dev', 'test'].map(side => path.join(dir, `gate-worklist-${side}.json`)).filter(f => fs.existsSync(f)).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
}

/** Everything the assembler needs: the default-package analyses (tree comparison), the verdict stores and the mode. */
export const loadGate = () => ({defaults: loadCache(DEFAULT_ANALYSIS_DIR), stores: loadVerdictStores(), mode: GATE_MODE});
