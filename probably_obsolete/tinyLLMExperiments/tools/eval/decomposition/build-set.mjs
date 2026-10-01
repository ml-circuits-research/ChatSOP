#!/usr/bin/env node
/**
 * Builds the sealed decomposition evaluation set (eval-decomposition-v1) from the candidates, in gated stages:
 *   verify   mechanical checks of the generated decompositions (omp folder datasets_sources/decomp_eval_split): at least two short sentences,
 *            names, numbers, negation, quantifiers and the question mark of the message kept, no empty output; writes targets.jsonl
 *   parse    Stanza default and accurate parses of every target (CPU unless CHATSOP_UD_DEVICE says otherwise) -> certification by SymbolicLM
 *            (identical trees on every sentence, AnalysisLayer.localPass)
 *   judge    omp meaning-judge folders (Grok first, GLM second; the graded severity prompt: ORIGINAL = tangled message, REWRITE = joined decomposition)
 *   assemble the stratified set: certified AND both votes at most S1; writes eval/suites/decomposition/test.jsonl and manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {mechanicalMeaning} from '../../../lib/symbolic-lm/rewrite-gate.mjs';
import {AnalysisLayer} from '../analysis-layer.mjs';
import {folder as severityFolder} from '../severity-calibration.mjs';
import {WORK, readJsonl, writeJsonl} from './select.mjs';
import {loadAnswers} from './omp-folder.mjs';
import {TANGLE_TYPES} from './tangle.mjs';

export const SUITE = path.join(ROOT, 'eval/suites/decomposition');
export const QUOTA_FINAL = {coordination: 45, subordinate: 45, relative: 40, completive: 45, multi_question: 40, run_on: 40, list: 45};
const join = sentences => sentences.map(s => s.trim()).join(' ');
const sevOf = (name, id) => { const a = loadAnswers(name, 'severity').get(id); return a ? String(a.severity).toUpperCase() : null; };

export function verify() {
  const cands = new Map([...readJsonl(path.join(WORK, 'candidates.jsonl')), ...readJsonl(path.join(WORK, 'candidates-r2.jsonl')), ...readJsonl(path.join(WORK, 'candidates-r3.jsonl'))].map(r => [r.id, r]));
  const answers = new Map([...loadAnswers('decomp_eval_split', 'sentences'), ...loadAnswers('decomp_eval_split2', 'sentences'), ...loadAnswers('decomp_eval_split3', 'sentences')]);
  const rows = [], dropped = {};
  const drop = why => { dropped[why] = (dropped[why] ?? 0) + 1; };
  for (const [id, c] of cands) {
    const a = answers.get(id);
    const sentences = Array.isArray(a?.sentences) ? a.sentences.map(s => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
    if (!sentences.length) { drop('no_answer'); continue; }
    if (sentences.length < 2) { drop('not_split'); continue; }
    if (sentences.some(s => !/[.?!]$/.test(s) || s.split(/\s+/).length > 30)) { drop('long_or_unterminated'); continue; }
    const text = join(sentences), m = mechanicalMeaning(c.message, text);
    const failed = ['nonempty', 'names', 'numbers', 'negation', 'quantifiers', 'question'].filter(k => !m[k]);
    if (failed.length) { drop(`mechanical_${failed[0]}`); continue; }
    rows.push({...c, expected: sentences, expected_text: text});
  }
  writeJsonl(path.join(WORK, 'targets.jsonl'), rows);
  return {kept: rows.length, dropped, by_type: Object.fromEntries(TANGLE_TYPES.map(t => [t, rows.filter(r => r.type === t).length]))};
}

/** targets.jsonl (neuro_english rows) plus the verified extras of tools/eval/decomposition/extras.mjs -> targets-all.jsonl. */
export function merge() {
  const rows = [...readJsonl(path.join(WORK, 'targets.jsonl')), ...readJsonl(path.join(WORK, 'extra-candidates.jsonl'))];
  const seen = new Set();
  for (const r of rows) if (seen.has(r.id)) throw Error(`duplicate id ${r.id}`); else seen.add(r.id);
  writeJsonl(path.join(WORK, 'targets-all.jsonl'), rows);
  return {rows: rows.length};
}

export async function parse() {
  const rows = readJsonl(path.join(WORK, 'targets-all.jsonl'));
  const layer = new AnalysisLayer();
  return layer.ensure(rows.flatMap(r => [r.expected_text, r.message]));
}

export function certify() {
  const rows = readJsonl(path.join(WORK, 'targets-all.jsonl'));
  const layer = new AnalysisLayer();
  const out = rows.map(r => ({...r, expected_certified: layer.localPass(r.expected_text), message_certified: layer.localPass(r.message)}));
  writeJsonl(path.join(WORK, 'targets-certified.jsonl'), out);
  return {certified: out.filter(r => r.expected_certified).length, of: out.length, message_certified: out.filter(r => r.message_certified).length};
}

export function judgeFolders() {
  const rows = readJsonl(path.join(WORK, 'targets-certified.jsonl')).filter(r => r.expected_certified);
  const items = rows.map(r => ({id: r.id, message: r.message, candidate: r.expected_text}));
  return ['grok', 'glm'].map(j => severityFolder(`decomp_eval_meaning_${j}`, items));
}

export function assemble(seed = 'decomp-final') {
  const rows = readJsonl(path.join(WORK, 'targets-certified.jsonl')).filter(r => r.expected_certified);
  const ok = r => { const g = sevOf('decomp_eval_meaning_grok', r.id), z = sevOf('decomp_eval_meaning_glm', r.id); return ['S0', 'S1'].includes(g) && ['S0', 'S1'].includes(z); };
  const judged = rows.filter(ok);
  const rank = r => createHash('sha1').update(`${seed}|${r.id}`).digest('hex');
  const chosen = [];
  // uncertified first: a tangled paraphrase whose own trees are already certified is taken only when the stratum is short (it is flagged `message_certified`)
  const key = r => `${r.source && String(r.source).includes('tangled') && r.message_certified ? 1 : 0}${rank(r)}`;
  for (const t of TANGLE_TYPES) chosen.push(...judged.filter(r => r.type === t).sort((a, b) => (key(a) < key(b) ? -1 : 1)).slice(0, QUOTA_FINAL[t]));
    const suite = chosen.map((r, i) => ({id: `decomp::${String(i + 1).padStart(3, '0')}`, source_id: r.id, source: r.source ?? 'neuro_english/test (tangled, uncertified)', type: r.type, types: r.types, message: r.message, expected: r.expected, expected_text: r.expected_text,
    certified: true, meaning_votes: {grok: sevOf('decomp_eval_meaning_grok', r.id), glm: sevOf('decomp_eval_meaning_glm', r.id)}, clauses: r.clauses, message_certified: r.message_certified ?? false}));
  fs.mkdirSync(SUITE, {recursive: true});
  writeJsonl(path.join(SUITE, 'test.jsonl'), suite);
  const manifest = {format: 'chatsop-decomposition-suite-v1', experiment: 'eval-decomposition-v1', created: new Date().toISOString(), rows: suite.length,
    by_type: Object.fromEntries(TANGLE_TYPES.map(t => [t, suite.filter(r => r.type === t).length])), sha256: createHash('sha256').update(fs.readFileSync(path.join(SUITE, 'test.jsonl'))).digest('hex'),
    selection: 'tangled (more than one finite clause by the stored analysis) clean-English rows of the sealed neuro_english test (and DeepSeek tangled paraphrases of sealed symbolic_english test groups for the rare types); expected decompositions generated by DeepSeek, certified by SymbolicLM (identical default and accurate trees) and accepted when both meaning votes (Grok, GLM) are S0 or S1',
    judged_ok: judged.length};
  fs.writeFileSync(path.join(SUITE, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  const fn = {verify, merge, parse, certify, judge: judgeFolders, assemble}[cmd];
  if (!fn) { console.error('usage: verify | merge | parse | certify | judge | assemble'); process.exit(2); }
  console.log(JSON.stringify(await fn(), null, 1));
  process.exit(0);
}
