#!/usr/bin/env node
/** Oracle of the DeepSeek rewrite candidates of neuro_english (SymbolicProofingLLM material; owner task 2026-09-30).
 *
 * For every candidate SymbolicLM runs (accurate Stanza package, frozen rules; parses are recorded once on the GPU and the
 * rules replayed, as in tools/symbolic-regression.mjs). Levels: VERIFIED_GOLD (the row has a gold SOP and the candidate's SOP
 * matches it strictly, tools/datasets/three-datasets/score.mjs), VERIFIED_FORM (no gold SOP: valid SOP, no unparsed span, default
 * and accurate trees identical, DeepSeek parse judge conditions a and c good on every sentence, and a DeepSeek meaning check that
 * is used only when its calibrated precision reaches 95%, experiment eval-neuro-meaning-judge-v1), REJECTED (with the reason).
 *
 * This is the train/dev side. The sealed test rows are handled by tools/eval/neuro-oracle-test.mjs (AGENTS.md rule 9), which
 * reuses the modules of tools/datasets/neuro-oracle/ and writes eval/suites/neuro_english/proofing-test.jsonl.
 *
 *   node tools/datasets/neuro-targets-oracle.mjs resplit-candidates        # input parts (datasets_sources/resplit_neuro_targets) for the neuro rows without DeepSeek candidates (rows added by the analysis-layer re-split)
 *   node tools/datasets/neuro-targets-oracle.mjs collect                   # candidate list of the train/dev rows, matching counts
 *   node tools/datasets/neuro-targets-oracle.mjs parse [--package accurate|default]   # record Stanza parses of every candidate (GPU)
 *   node tools/datasets/neuro-targets-oracle.mjs stage-a                   # SymbolicLM, gold comparison, tree agreement
 *   node tools/datasets/neuro-targets-oracle.mjs judge-prepare             # parse-judge items (datasets_sources/neuro_oracle_parse_judge)
 *   node tools/datasets/neuro-targets-oracle.mjs meaning-calibrate | meaning-score | meaning-prepare   # meaning judge (…_meaning_judge)
 *   node tools/datasets/neuro-targets-oracle.mjs gaps                      # engine-gaps.jsonl: gold-row candidates the engine does not reproduce (backlog for rules)
 *   node tools/datasets/neuro-targets-oracle.mjs merge                     # final verdicts of the train/dev candidates
 *   node tools/datasets/neuro-targets-oracle.mjs build [--dry-name NAME] [--identity-ratio 0.67] [--include-extra form]
 *   node tools/datasets/neuro-targets-oracle.mjs summary                   # eval/reports/current/neuro-oracle/summary.md
 *
 * Observations go to eval/reports/current/neuro-oracle/; `build` writes datasets/neuro_english/proofing/ (train/dev pairs).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT as ROOT_DIR, datasetRows, isComposedRow, readTargets, candidateList, writeJsonl, writeJson, readJsonl, readJson, sha256, WORK, ParseStore, writeMissingTargetParts} from './neuro-oracle/common.mjs';
import {recordParses} from './neuro-oracle/parse.mjs';
import {matchRows, rowRecords, stageRows} from './neuro-oracle/stage.mjs';
import {writeParseItems, appendMeaningItems, meaningItemId} from './neuro-oracle/judge.mjs';
import {writeCalibration, scoreCalibration} from './neuro-oracle/calibrate.mjs';
import {finalVerdicts, needsMeaning, tally, meaningRule} from './neuro-oracle/merge.mjs';
import {engineGaps} from './neuro-oracle/gaps.mjs';
import {writeSummary} from './neuro-oracle/report.mjs';
import {buildPairs, dropLeaks, dedupePrompts, writePairs, integrity, loadSealedHashes} from './neuro-oracle/build.mjs';
import {codeHashes} from './three-datasets/hashes.mjs';
import {RULES_VERSION} from './three-datasets/score.mjs';

const args = argv => { const o = {_: []}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) { o._.push(argv[i]); continue; } o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } return o; };
const file = name => path.join(WORK, name);
const maybe = (name, fallback) => (fs.existsSync(file(name)) ? readJson(file(name)) : fallback);
const symbolicIds = () => new Set(datasetRows('symbolic_english').map(r => r.id));

async function main() {
  const [command] = process.argv.slice(2), o = args(process.argv.slice(3));
  if (command === 'resplit-candidates') {
    // Neuro rows of the analysis-layer re-split that the first DeepSeek task never saw (they were symbolic_english under the SOP-proxy split).
    const rows = datasetRows('neuro_english').filter(r => !isComposedRow(r) && r.rewrite_target !== false);
    console.log(JSON.stringify(writeMissingTargetParts(rows)));
  } else if (command === 'collect') {
    const rows = datasetRows('neuro_english').filter(r => !isComposedRow(r));
    const m = matchRows(rows, symbolicIds());
    const list = candidateList(m.outputs, rows).filter(c => m.byId.has(c.id));
    writeJsonl(file('candidates.jsonl'), list);
    writeJson(file('matching-train-dev.json'), {generated_at: new Date().toISOString(), counts: m.counts, moved: m.moved});
    console.log(JSON.stringify({...m.counts, ...m.moved, candidate_records: list.length}, null, 1));
  } else if (command === 'parse') {
    // Every DeepSeek candidate of every id (parsing labels nothing) plus the existing targets of the train/dev rows.
    const rows = datasetRows('neuro_english').filter(r => !isComposedRow(r));
    const {outputs} = readTargets();
    const texts = candidateList(outputs, rows).map(c => c.text);
    for (const pkg of o.package && o.package !== 'both' ? [o.package] : ['accurate', 'default']) {
      const r = await recordParses(texts, pkg, {onProgress: (d, t) => process.stderr.write(`\r${pkg} ${d}/${t}`)});
      console.log(`\n${pkg}: ${JSON.stringify(r)}`);
    }
  } else if (command === 'stage-a') {
    const rows = datasetRows('neuro_english').filter(r => !isComposedRow(r));
    const {outputs} = matchRows(rows);
    const {scoreAgainstAccepted} = await import('../eval/wild-suite.mjs'); // accepted golds of the wild rows re-split into train and dev (as build-three-datasets.mjs)
    const r = await stageRows({rows, outputs, wildScore: scoreAgainstAccepted});
    writeJsonl(file('stage-a.jsonl'), r.stage);
    writeJsonl(file('rows-train-dev.jsonl'), rowRecords(rows, outputs));
    console.log(JSON.stringify({candidates: r.stage.length, gold_sources_missing: r.gold_sources_missing, tally: tally(r.stage, x => `${x.has_gold ? 'gold' : 'nogold'}|${x.stage}`), frame_only: r.stage.filter(x => x.frame_ok).length}, null, 1));
  } else if (command === 'judge-prepare') {
    const stage = readJsonl(file('stage-a.jsonl')), cands = new Map(readJsonl(file('candidates.jsonl')).map(c => [c.cid, c]));
    const toJudge = stage.filter(r => ['to_judge', 'gold_match', 'gold_mismatch'].includes(r.stage)).map(r => cands.get(r.cid));
    const {index, sentences, new_items} = writeParseItems(toJudge, new ParseStore('accurate').load());
    writeJson(file('judge-index.json'), index);
    console.log(JSON.stringify({candidates: toJudge.length, distinct_sentences_in_input: sentences, new_items}));
  } else if (command === 'meaning-calibrate') {
    // The calibration pools are train/dev candidates only (deviation D1 of eval-neuro-meaning-judge-v1: the first run drew from all splits).
    const stage = readJsonl(file('stage-a.jsonl')), cands = readJsonl(file('candidates.jsonl'));
    const messages = new Map(datasetRows('neuro_english').map(r => [r.id, r.message]));
    console.log(JSON.stringify(writeCalibration(stage, cands, messages)));
  } else if (command === 'meaning-score') {
    const r = scoreCalibration();
    writeJson(file('meaning-calibration.json'), {generated_at: new Date().toISOString(), ...r});
    console.log(JSON.stringify(r, null, 1));
  } else if (command === 'meaning-prepare') {
    // meaning items (two votes, m1 and m2 of the calibrated judge) for the candidates that passed the analysis gate and need a meaning signal beyond a strict gold match
    const stage = readJsonl(file('stage-a.jsonl')), cands = new Map(readJsonl(file('candidates.jsonl')).map(c => [c.cid, c]));
    const index = readJson(file('judge-index.json')), messages = new Map(datasetRows('neuro_english').map(r => [r.id, r.message]));
    const passed = needsMeaning(stage, index); // gate passes and the normalized gold matches or there is no gold signal
    const r = appendMeaningItems(passed.filter(x => messages.has(x.id)).map(x => ({cid: x.cid, message: messages.get(x.id), candidate: cands.get(x.cid).text})));
    console.log(JSON.stringify({...r, candidates_needing_meaning: passed.length, rule: meaningRule()}));
  } else if (command === 'merge') {
    const stage = readJsonl(file('stage-a.jsonl'));
    const rule = meaningRule();
    const cands = new Map(readJsonl(file('candidates.jsonl')).map(c => [c.cid, c])), messages = new Map(datasetRows('neuro_english').map(r => [r.id, r.message]));
    const rows = finalVerdicts(stage, {index: maybe('judge-index.json', {}), meaningTrusted: rule.trusted, meaningId: r => meaningItemId(r.cid, messages.get(r.id), cands.get(r.cid)?.text)});
    writeJsonl(file('verdicts.jsonl'), rows);
    writeJson(file('meaning-rule.json'), {generated_at: new Date().toISOString(), ...rule});
    console.log(JSON.stringify({meaning_rule: rule, by_level: tally(rows, r => r.level), by_reason: tally(rows.filter(r => !['VERIFIED_GOLD', 'VERIFIED_GOLD_NORMALIZED', 'VERIFIED_FORM'].includes(r.level)), r => r.reason)}, null, 1));
  } else if (command === 'build') {
    const verdicts = readJsonl(file('verdicts.jsonl')), candidates = readJsonl(file('candidates.jsonl'));
    const ratio = Number(o['identity-ratio'] ?? 0.67);
    const allowExtra = new Set(String(o['include-extra'] ?? '').split(',').filter(Boolean).map(x => ({form: 'VERIFIED_FORM_UNTRUSTED'})[x] ?? x));
    const neuroRows = datasetRows('neuro_english'), symbolic = datasetRows('symbolic_english');
    const neuro = new Map(neuroRows.map(r => [r.id, r]));
    const built = buildPairs({verdicts, candidates, neuro, symbolic, splits: ['train', 'dev'], identityRatio: ratio, allowExtra});
    const sealed = loadSealedHashes();
    const dedupDropped = dedupePrompts(built.out);
    const leakDropped = dropLeaks(built.out, sealed.set);
    const integrityReport = integrity(built.out, sealed, new Map([...neuro, ...symbolic.map(r => [r.id, r])]));
    const sealedInfo = o['dry-name'] ? maybe(`dry/${o['dry-name']}/sealed-summary.json`, null) : maybe('sealed-summary.json', null);
    const cal = maybe('meaning-rule.json', null);
    const dry = o['dry-name'] ? {outDir: path.join(WORK, 'dry', o['dry-name'], 'proofing'), evidence: false} : {};
    const result = writePairs({...dry, allowExtra, integrityReport, out: built.out, notes: built.notes, leakDropped, dedupDropped, identityRatio: ratio, verdictsSha: sha256(fs.readFileSync(file('verdicts.jsonl'))), sealedInfo,
      meta: {source_manifests_sha256: Object.fromEntries(['datasets/neuro_english/manifest.json', 'datasets/symbolic_english/manifest.json', 'eval/suites/neuro_english/manifest.json', 'eval/suites/symbolic_english/manifest.json'].filter(f => fs.existsSync(path.join(ROOT_DIR, f))).map(f => [f, sha256(fs.readFileSync(path.join(ROOT_DIR, f)))])), rules_version: RULES_VERSION, code_sha256: codeHashes(), sealed_hashes_sha256: sealed.file_sha256, meaning_judge: cal ? {trusted: cal.trusted, rule: cal.rule, experiment: cal.experiment, precision_raw: cal.precision_raw, precision_adjudicated: cal.precision_adjudicated} : null}});
    console.log(JSON.stringify(result.summary, null, 1));
  } else if (command === 'gaps') {
    // engine-gaps.jsonl: the gold-row candidates the engine does not reproduce, with the structural diff classes and mechanical gap tags (train/dev rows only: the backlog of SymbolicLM rules must not see sealed rows)
    const stage = readJsonl(file('stage-a.jsonl')), cands = new Map(readJsonl(file('candidates.jsonl')).map(c => [c.cid, c]));
    const rows = new Map(datasetRows('neuro_english').map(r => [r.id, r]));
    const out = engineGaps(stage, cands, rows);
    writeJsonl(file('engine-gaps.jsonl'), out.rows);
    writeJson(file('engine-gaps-summary.json'), {generated_at: new Date().toISOString(), rows: out.rows.length, by_tag: out.byTag, by_category: out.byCategory, by_stage: out.byStage});
    console.log(JSON.stringify({rows: out.rows.length, by_tag: out.byTag, by_category: out.byCategory, by_stage: out.byStage}, null, 1));
  } else if (command === 'summary') {
    const manifestFile = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'datasets/neuro_english/proofing/manifest.json');
    console.log(`summary.md: ${writeSummary({manifest: fs.existsSync(manifestFile) ? readJson(manifestFile) : null})} lines`);
  } else throw Error(`unknown command ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
