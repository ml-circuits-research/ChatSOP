#!/usr/bin/env node
/** Sealed side of the neuro oracle (AGENTS.md rule 9): the verdicts of the DeepSeek rewrite candidates of the sealed
 * neuro_english test rows and the sealed SymbolicProofingLLM pair file `eval/suites/neuro_english/proofing-test.jsonl`.
 * It reuses the modules of tools/datasets/neuro-oracle/ (which never open a sealed file) and hands the train/dev side only
 * hashes of the sealed texts (`sealed-hashes.json`) and a summary of the sealed pairs (`sealed-summary.json`).
 *

 *   node tools/eval/neuro-oracle-test.mjs resplit-candidates  # input parts of the sealed neuro rows that have no DeepSeek output yet
 *   node tools/eval/neuro-oracle-test.mjs parse               # record the parses of the existing targets of the test rows (GPU)
 *   node tools/eval/neuro-oracle-test.mjs stage-a             # SymbolicLM, gold (formalizer-v1, ood, wild test suites), trees
 *   node tools/eval/neuro-oracle-test.mjs judge-prepare       # add the parse-judge items of the sealed candidates
 *   node tools/eval/neuro-oracle-test.mjs meaning-prepare     # add the meaning items of the sealed candidates that passed the gate
 *   node tools/eval/neuro-oracle-test.mjs gaps                # engine-gap counts of the sealed candidates (no text)
 *   node tools/eval/neuro-oracle-test.mjs merge               # verdicts-test.jsonl
 *   node tools/eval/neuro-oracle-test.mjs build [--identity-ratio 0.67] [--include-extra form] [--dry-name NAME]   # proofing-test.jsonl + hashes + summary
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, jsonlExists} from '../../lib/jsonl-shards.mjs';
import {ROOT, WORK, readTargets, candidateList, writeJsonl, writeJson, readJsonl, readJson, sha256, ParseStore, writeMissingTargetParts, isComposedRow} from '../datasets/neuro-oracle/common.mjs';
import {TRAIN_DEV_GOLD_FILES} from '../datasets/neuro-oracle/classify.mjs';
import {recordParses} from '../datasets/neuro-oracle/parse.mjs';
import {matchRows, rowRecords, stageRows} from '../datasets/neuro-oracle/stage.mjs';
import {writeParseItems, appendMeaningItems, meaningItemId} from '../datasets/neuro-oracle/judge.mjs';
import {finalVerdicts, needsMeaning, tally, meaningRule} from '../datasets/neuro-oracle/merge.mjs';
import {engineGaps} from '../datasets/neuro-oracle/gaps.mjs';
import {buildPairs, dropLeaks, auditRows, summarise, tokenLengths, hashText} from '../datasets/neuro-oracle/build.mjs';
import {scoreAgainstAccepted} from './wild-suite.mjs';

const SUITES = 'eval/suites';
const TEST_FILE = path.join(ROOT, SUITES, 'neuro_english', 'proofing-test.jsonl');
// sealed rows may come from the legacy train/dev files too (a re-split moved them), so those are listed as well
const SEALED_GOLD = {'formalizer-v1': [`${SUITES}/formalizer-v1/test.jsonl`], 'formalizer-ood-v1': [`${SUITES}/formalizer-ood-v1/test.jsonl`], 'formalizer-wild-v1': [`${SUITES}/formalizer-wild-v1/test.jsonl`]};
export const goldFiles = () => { const files = TRAIN_DEV_GOLD_FILES(); for (const [corpus, list] of Object.entries(SEALED_GOLD)) files[corpus] = [...(files[corpus] ?? []), ...list]; return files; };
const file = name => path.join(WORK, name);
const maybe = (name, fallback) => (fs.existsSync(file(name)) ? readJson(file(name)) : fallback);
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
export const sealedRows = dataset => { const f = path.join(ROOT, SUITES, dataset, 'test.jsonl'); return jsonlExists(f) ? readJsonlShardedSync(f).map(r => ({...r, split: 'test'})) : []; };
const trainDevIds = dataset => new Set(['train', 'dev'].flatMap(s => { const f = path.join(ROOT, 'datasets', dataset, `${s}.jsonl`); return jsonlExists(f) ? readJsonlShardedSync(f).map(r => r.id) : []; }));

async function main() {
  const [command, ...rest] = process.argv.slice(2), o = args(rest);
  const rows = sealedRows('neuro_english'), byId = new Map(rows.map(r => [r.id, r]));
  if (command === 'resplit-candidates') {
    // sealed neuro rows without a DeepSeek output (they were symbolic_english under the SOP-proxy split): input parts `part-sNNN` of datasets_sources/resplit_neuro_targets
    console.log(JSON.stringify(writeMissingTargetParts(rows.filter(r => !isComposedRow(r)), {sealed: true})));
  } else if (command === 'parse') {
    const texts = rows.filter(r => typeof r.target === 'string' && r.target).map(r => r.target);
    for (const pkg of ['accurate', 'default']) console.log(pkg, JSON.stringify(await recordParses(texts, pkg)));
  } else if (command === 'stage-a') {
    const m = matchRows(rows, new Set([...sealedRows('symbolic_english').map(r => r.id), ...trainDevIds('symbolic_english')]));
    const r = await stageRows({rows, outputs: m.outputs, goldFiles: goldFiles(), wildScore: scoreAgainstAccepted});
    writeJsonl(file('stage-a-test.jsonl'), r.stage);
    writeJsonl(file('rows-test.jsonl'), rowRecords(rows, m.outputs));
    writeJsonl(file('candidates-test.jsonl'), r.candidates);
    writeJson(file('matching-test.json'), {generated_at: new Date().toISOString(), counts: m.counts, moved: {note: 'ids of the DeepSeek output that are not sealed neuro rows are handled by the train/dev side or moved to symbolic_english'}});
    console.log(JSON.stringify({candidates: r.stage.length, gold_sources_missing: r.gold_sources_missing, tally: tally(r.stage, x => `${x.has_gold ? 'gold' : 'nogold'}|${x.stage}`), frame_only: r.stage.filter(x => x.frame_ok).length, matching: m.counts}, null, 1));
  } else if (command === 'judge-prepare') {
    const stage = readJsonl(file('stage-a-test.jsonl')), cands = new Map(readJsonl(file('candidates-test.jsonl')).map(c => [c.cid, c]));
    const toJudge = stage.filter(r => ['to_judge', 'gold_match', 'gold_mismatch'].includes(r.stage)).map(r => cands.get(r.cid));
    const {index, sentences, new_items} = writeParseItems(toJudge, new ParseStore('accurate').load());
    writeJson(file('judge-index-test.json'), index);
    console.log(JSON.stringify({candidates: toJudge.length, distinct_sentences_in_input: sentences, new_items}));
  } else if (command === 'meaning-prepare') {
    const stage = readJsonl(file('stage-a-test.jsonl')), cands = new Map(readJsonl(file('candidates-test.jsonl')).map(c => [c.cid, c]));
    const passed = needsMeaning(stage, maybe('judge-index-test.json', {})); // analysis gate passes and the normalized gold matches or there is no gold signal
    const r = appendMeaningItems(passed.map(x => ({cid: x.cid, message: byId.get(x.id).message, candidate: cands.get(x.cid).text})));
    console.log(JSON.stringify({...r, candidates_needing_meaning: passed.length}));
  } else if (command === 'gaps') {
    // counts only: the engine-gaps backlog (train/dev rows) is written by tools/datasets/neuro-targets-oracle.mjs gaps
    const stage = readJsonl(file('stage-a-test.jsonl')), cands = new Map(readJsonl(file('candidates-test.jsonl')).map(c => [c.cid, c]));
    const out = engineGaps(stage, cands, byId);
    writeJson(file('engine-gaps-test-counts.json'), {generated_at: new Date().toISOString(), note: 'counts only, no text: the sealed rows never enter the rules backlog', rows: out.rows.length, by_tag: out.byTag, by_category: out.byCategory, by_stage: out.byStage});
    console.log(JSON.stringify({rows: out.rows.length, by_tag: out.byTag, by_category: out.byCategory, by_stage: out.byStage}, null, 1));
  } else if (command === 'merge') {
    const rule = meaningRule();
    const cands = new Map(readJsonl(file('candidates-test.jsonl')).map(c => [c.cid, c]));
    const out = finalVerdicts(readJsonl(file('stage-a-test.jsonl')), {index: maybe('judge-index-test.json', {}), meaningTrusted: rule.trusted, meaningId: r => meaningItemId(r.cid, byId.get(r.id)?.message, cands.get(r.cid)?.text)});
    writeJsonl(file('verdicts-test.jsonl'), out);
    console.log(JSON.stringify({meaning_rule: rule, by_level: tally(out, r => r.level)}, null, 1));
  } else if (command === 'build') {
    const ratio = Number(o['identity-ratio'] ?? 0.67);
    const allowExtra = new Set(String(o['include-extra'] ?? '').split(',').filter(Boolean).map(x => ({form: 'VERIFIED_FORM_UNTRUSTED'})[x] ?? x));
    const verdicts = readJsonl(file('verdicts-test.jsonl')), candidates = readJsonl(file('candidates-test.jsonl'));
    const symbolic = sealedRows('symbolic_english');
    const built = buildPairs({verdicts, candidates, neuro: byId, symbolic, splits: ['test'], identityRatio: ratio, allowExtra});
    // dedupe prompts inside the sealed set
    const seen = new Set();
    for (const kind of ['repair', 'composed', 'identity']) built.out.test[kind] = built.out.test[kind].filter(p => { const k = hashText(p.flat.prompt); if (seen.has(k)) return false; seen.add(k); return true; });
    const flatFile = path.join(WORK, 'test-flat.jsonl');
    const pairs = [...built.out.test.repair, ...built.out.test.composed, ...built.out.test.identity].sort((a, b) => a.flat.id.localeCompare(b.flat.id));
    writeJsonl(flatFile, pairs.map(p => p.flat));
    const tokens = tokenLengths([flatFile])[flatFile];
    const {auditRows: audits} = auditRows(built.out, 'test', id => tokens[id]);
    const testRows = pairs.map((p, i) => ({...p.flat, ...audits[i], id: p.flat.id}));
    const dryDir = o['dry-name'] ? path.join(WORK, 'dry', o['dry-name']) : null; // a dry run sizes an option without touching the sealed suite or the hashes
    const testFile = dryDir ? path.join(dryDir, 'proofing-test.jsonl') : TEST_FILE;
    writeJsonl(testFile, testRows);
    fs.unlinkSync(flatFile);
    // hashes of every sealed text (messages and targets of the three sealed suites, the sealed pairs) for the train/dev leakage check
    const hashes = new Set();
    for (const dataset of ['neuro_english', 'symbolic_english', 'bad_english']) for (const r of sealedRows(dataset)) { hashes.add(hashText(r.message)); if (r.target) hashes.add(hashText(r.target)); }
    for (const p of pairs) { hashes.add(hashText(p.flat.prompt)); hashes.add(hashText(p.flat.target)); }
    if (!dryDir) writeJson(file('sealed-hashes.json'), {generated_at: new Date().toISOString(), note: 'sha1 prefixes of folded sealed texts; no text', hashes: [...hashes].sort(), test_pair_ids: pairs.map(p => p.flat.id), rows: pairs.length});
    const summary = summarise(audits);
    writeJson(dryDir ? path.join(dryDir, 'sealed-summary.json') : file('sealed-summary.json'), {generated_at: new Date().toISOString(), path: path.relative(ROOT, testFile), rows: testRows.length, sha256: sha256(fs.readFileSync(testFile)), summary, tokens: {over_2048: testRows.filter(r => r.tokens.total > 2048).length}, identity_ratio: ratio, include_extra: [...allowExtra], notes: built.notes});
    console.log(JSON.stringify(summary, null, 1));
  } else throw Error(`unknown command ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
