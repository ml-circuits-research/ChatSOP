/** Summary of the analysis-layer re-split of symbolic_english / neuro_english (incident of 2026-09-30 night, DS008 "Three datasets").
 *
 * Reads only manifests, the frozen snapshots of the old rows (ids and labels, no text), the movement reports of both sides and the judge folders'
 * verdict files; it never opens a sealed file. Writes eval/reports/current/three-datasets/resplit-summary.md and resplit/summary.json. The final train/dev
 * movement is computed here from the finished train/dev files (composed and form-variant rows are regenerated after the assembly); the sealed movement comes from
 * tools/eval/three-datasets-suites.mjs (resplit/movement-test.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';
import {movement, RESPLIT_DIR} from './resplit-report.mjs';
import {loadVerdictIndex, JUDGE_DIR, VERDICT_FOLDERS} from './analysis-gate.mjs';
import {sessionCosts, estimateKernel, FOLDERS} from '../neuro-oracle/cost.mjs';

const OUT = path.join(ROOT, 'eval/reports/current/three-datasets');
const DATASETS = ['symbolic_english', 'neuro_english'];
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fmt = n => (n ?? 0).toLocaleString('en-US');
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');
const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
const SPLITS = ['train', 'dev', 'test'];

const currentTrainDevRows = () => DATASETS.flatMap(dataset => ['train', 'dev'].flatMap(split => { const file = path.join(ROOT, 'datasets', dataset, `${split}.jsonl`); return jsonlExists(file) ? readJsonlShardedSync(file) : []; }));

/** Coverage table rows `{split, source, symbolic, neuro}` from two manifests' counts. */
function coverageRows(sym, neu) {
  const out = [];
  for (const split of SPLITS) {
    const sources = [...new Set([...Object.keys(sym[split]?.by_source ?? {}), ...Object.keys(neu[split]?.by_source ?? {})])].sort();
    for (const source of sources) out.push({split, source, symbolic: sym[split]?.by_source?.[source] ?? 0, neuro: neu[split]?.by_source?.[source] ?? 0});
    out.push({split, source: 'all', symbolic: sym[split]?.rows ?? 0, neuro: neu[split]?.rows ?? 0});
  }
  return out;
}

export function writeResplitSummary({extra = {}} = {}) {
  const beforeM = Object.fromEntries(DATASETS.map(d => [d, json(path.join(RESPLIT_DIR, `before-manifest-${d}.json`)).counts]));
  const afterM = Object.fromEntries(DATASETS.map(d => [d, json(path.join(ROOT, 'datasets', d, 'manifest.json')).counts]));
  const moveTrainDev = movement('train-dev', currentTrainDevRows());
  fs.writeFileSync(path.join(RESPLIT_DIR, 'movement-train-dev-final.json'), JSON.stringify(moveTrainDev, null, 1) + '\n');
  const moveTest = fs.existsSync(path.join(RESPLIT_DIR, 'movement-test.json')) ? json(path.join(RESPLIT_DIR, 'movement-test.json')) : null;
  const L = [];
  L.push('# Re-split of symbolic_english / neuro_english on the analysis layer', '');
  L.push(`Generated ${new Date().toISOString()} by \`node tools/datasets/build-three-datasets.mjs resplit-report\`. Incident and decision: journal 2026-09-30 night ("Incident: symbolic/neuro split used SOP match instead of the grammatical analysis"); criterion: DS008 "Three datasets". Counts of the old split are **computed on the SOP-proxy split** (a row with a gold SOP was in symbolic_english only when SymbolicLM's SOP matched the gold); the new split decides on the analysis (every sentence: identical default and accurate Stanza trees and the DeepSeek parse judge, conditions a and c, good enough). Rows never change split (train, dev, test).`, '');

  L.push('## 1. Rows per dataset and split', '');
  L.push(table(['dataset', 'split', 'before (SOP proxy)', 'after (analysis gate)'], DATASETS.flatMap(d => SPLITS.map(s => [d, s, fmt(beforeM[d][s]?.rows), fmt(afterM[d][s]?.rows)]))), '');
  L.push('Rows by source corpus:', '');
  const sources = [...new Set(DATASETS.flatMap(d => SPLITS.flatMap(s => [...Object.keys(beforeM[d][s]?.by_source ?? {}), ...Object.keys(afterM[d][s]?.by_source ?? {})])))].sort();
  L.push(table(['dataset', 'source', ...SPLITS.flatMap(s => [`${s} before`, `${s} after`])], DATASETS.flatMap(d => sources.map(src => [d, src, ...SPLITS.flatMap(s => [fmt(beforeM[d][s]?.by_source?.[src] ?? 0), fmt(afterM[d][s]?.by_source?.[src] ?? 0)])]))), '');
  const totalBefore = DATASETS.reduce((a, d) => a + SPLITS.reduce((b, s) => b + (beforeM[d][s]?.rows ?? 0), 0), 0), totalAfter = DATASETS.reduce((a, d) => a + SPLITS.reduce((b, s) => b + (afterM[d][s]?.rows ?? 0), 0), 0);
  L.push(`Clean-English rows in total: ${fmt(totalBefore)} before, ${fmt(totalAfter)} after (the difference is the content-word overlap drop, the regenerated composed and form-variant additions and rows that the earlier drop had removed).`, '');

  L.push('## 2. Analysis-layer coverage of clean English', '');
  L.push('Coverage = symbolic_english / (symbolic_english + neuro_english), per split and source corpus.', '');
  const cb = coverageRows(beforeM.symbolic_english, beforeM.neuro_english), ca = coverageRows(afterM.symbolic_english, afterM.neuro_english);
  const key = r => `${r.split}|${r.source}`;
  const cbm = new Map(cb.map(r => [key(r), r]));
  L.push(table(['split', 'source', 'symbolic before', 'neuro before', 'coverage before', 'symbolic after', 'neuro after', 'coverage after'], ca.map(r => { const b = cbm.get(key(r)) ?? {symbolic: 0, neuro: 0}; return [r.split, r.source, fmt(b.symbolic), fmt(b.neuro), pct(b.symbolic, b.symbolic + b.neuro), fmt(r.symbolic), fmt(r.neuro), pct(r.symbolic, r.symbolic + r.neuro)]; })), '');

  L.push('## 3. Where the old neuro_english rows went', '');
  const sides = [['train and dev (final files)', moveTrainDev], ['sealed test', moveTest]].filter(([, m]) => m);
  for (const [name, m] of sides) {
    const t = m.transitions;
    L.push(`**${name}**: ${fmt(m.before_rows)} rows before, ${fmt(m.after_rows)} after. Transitions: ${Object.entries(t).map(([k, n]) => `${k} ${fmt(n)}`).join('; ')}; appeared ${fmt(m.appeared)} (${Object.entries(m.appeared_by_source).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}), disappeared ${fmt(m.disappeared)} (${Object.entries(m.disappeared_by_source).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}).`, '');
  }
  L.push('Old neuro_english rows by their old (SOP-layer) `failure_kind`, and the dataset each is in now:', '');
  const kinds = new Set(), kindRows = {};
  for (const [, m] of sides) for (const [k, byDataset] of Object.entries(m.stayed_or_moved_by_old_failure_kind)) { kinds.add(k); kindRows[k] ??= {symbolic_english: 0, neuro_english: 0}; for (const [d, n] of Object.entries(byDataset)) kindRows[k][d] = (kindRows[k][d] ?? 0) + n; }
  L.push(table(['old failure_kind', 'now symbolic_english (analysis correct)', 'still neuro_english', 'total'], [...kinds].sort().map(k => [k, fmt(kindRows[k].symbolic_english), fmt(kindRows[k].neuro_english), fmt(kindRows[k].symbolic_english + kindRows[k].neuro_english)])), '');
  const movedSym = [...kinds].reduce((a, k) => a + kindRows[k].symbolic_english, 0), oldNeuro = [...kinds].reduce((a, k) => a + kindRows[k].symbolic_english + kindRows[k].neuro_english, 0);
  L.push(`**${fmt(movedSym)} of the ${fmt(oldNeuro)} old neuro_english rows (${pct(movedSym, oldNeuro)}) had a correct analysis** by the gate and are in symbolic_english now; the rest fail the gate on the analysis itself. The old symbolic_english rows that fail the gate are the opposite movement:`, '');
  const flow = {};
  for (const [, m] of sides) for (const [k, n] of Object.entries(m.transitions)) flow[k] = (flow[k] ?? 0) + n;
  L.push(table(['movement', 'rows'], Object.entries(flow).sort().map(([k, n]) => [k, fmt(n)])), '');
  L.push('Movement by source corpus (both sides):', '');
  const bySource = {};
  for (const [, m] of sides) for (const [s, flows] of Object.entries(m.by_source)) { bySource[s] ??= {}; for (const [k, n] of Object.entries(flows)) bySource[s][k] = (bySource[s][k] ?? 0) + n; }
  const flowKeys = Object.keys(flow).sort();
  L.push(table(['source', ...flowKeys], Object.entries(bySource).sort().map(([s, f]) => [s, ...flowKeys.map(k => fmt(f[k] ?? 0))])), '');

  L.push('## 4. The new split in numbers', '');
  for (const d of DATASETS) {
    const c = afterM[d];
    const extra1 = d === 'symbolic_english' ? ['by_analysis_verified', 'by_sop_layer'] : ['by_failure_kind', 'by_sop_layer', 'by_sop_failure_kind'];
    for (const k of extra1) {
      const values = [...new Set(SPLITS.flatMap(s => Object.keys(c[s]?.[k] ?? {})))];
      L.push(`\`${d}\` by \`${k.replace('by_', '')}\`:`, '', table([k.replace('by_', ''), ...SPLITS], values.map(v => [v, ...SPLITS.map(s => fmt(c[s]?.[k]?.[v] ?? 0))])), '');
    }
  }

  L.push('## 5. The DeepSeek parse judge', '');
  const index = loadVerdictIndex();
  const tally = {a: {}, c: {}};
  for (const [k, v] of index.byId) if (v.folder === 'resplit_parse_judge') { const cond = k.slice(k.lastIndexOf('|') + 1); tally[cond][v.verdict] = (tally[cond][v.verdict] ?? 0) + 1; }
  const items = fs.existsSync(path.join(JUDGE_DIR, 'input/items.jsonl')) ? fs.readFileSync(path.join(JUDGE_DIR, 'input/items.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0;
  L.push(`Folders read for verdicts (keyed on sentence text plus tree; the first folder with a usable verdict wins): ${VERDICT_FOLDERS.map(f => `\`${f}\` ${fmt(index.count[f] ?? 0)} verdicts`).join(', ')}. New items judged for this re-split in \`datasets_sources/resplit_parse_judge/\`: ${fmt(items)} (${fmt(items / 2)} sentences, conditions a and c; system prompts \`SYSTEM_a.txt\` and \`SYSTEM_c.txt\`, byte-identical to \`datasets_sources/parse_judge_deepseek/\`, generated from \`tools/research/parse-judge.mjs\`).`, '');
  const verdicts = ['CORRECT', 'MINOR', 'INPUT_TYPO', 'DEEP', 'FAIL'];
  L.push(table(['condition', ...verdicts], ['a', 'c'].map(c => [c, ...verdicts.map(v => fmt(tally[c][v] ?? 0))])), '');
  const costs = sessionCosts();
  const price = Object.values(costs).find(c => c.price_per_m?.input)?.price_per_m;
  const kernel = estimateKernel({calls: items, systemChars: 8000, userChars: 2300, outputTokens: 220}, price);
  const metered = costs.resplit_parse_judge?.cost_usd ?? 0;
  L.push(`**Cost.** The omp session that drives the judge is metered at ${metered.toFixed(4)} USD; the judge requests themselves go through the eval kernel's \`completion()\`, which the session files do not meter, so they are estimated from the item sizes and the metered price of deepseek-flash (${price ? `${price.input} / ${price.output} / ${price.cache_read}` : 'n/a'} USD per million input / output / cache-read tokens): about ${kernel === null ? 'n/a' : kernel.toFixed(2)} USD for ${fmt(items)} calls (8,000 chars of system prompt from cache, 2,300 chars of item, 220 output tokens per call). Earlier folders' metered sessions: ${FOLDERS.filter(f => f !== 'resplit_parse_judge').map(f => `${f} ${(costs[f]?.cost_usd ?? 0).toFixed(4)}`).join(', ')} USD.`, '');
  // reuse of earlier verdicts, per side (from the assembly reports: sentence verdicts the gate used, by folder)
  const gateStats = ['assemble-train-dev.json', 'assemble-test.json'].filter(f => fs.existsSync(path.join(OUT, f))).map(f => json(path.join(OUT, f)).gate);
  const from = {}; for (const g of gateStats) for (const [k, n] of Object.entries(g.sentence_verdicts_from ?? {})) for (const folder of k.split('+')) from[folder] = (from[folder] ?? 0) + n;
  const fromTotal = Object.values(from).reduce((a, b) => a + b, 0), fromNew = from.resplit_parse_judge ?? 0;
  L.push(`**Reuse.** Of the ${fmt(fromTotal)} sentence verdicts the gate used for the final clean-English rows (train, dev and sealed test, rows with identical trees), ${fmt(fromTotal - fromNew)} (${pct(fromTotal - fromNew, fromTotal)}) came from earlier DeepSeek task folders (${Object.entries(from).filter(([k]) => k !== 'resplit_parse_judge').map(([k, n]) => `\`${k}\` ${fmt(n)}`).join(', ')}) and ${fmt(fromNew)} from this re-split's own folder. Sentences whose default and accurate trees differ (${fmt(gateStats.reduce((a, g) => a + (g.sentence_trees?.core_diff ?? 0) + (g.sentence_trees?.noncore_diff ?? 0), 0))} of ${fmt(gateStats.reduce((a, g) => a + Object.values(g.sentence_trees ?? {}).reduce((x, y) => x + y, 0), 0))} sentence occurrences) fail without a judge call. The folder holds ${fmt(items)} items in total: the gate of the clean-English rows, the additions (composed paragraphs, form variants, test variants) and the parse gate of the rewrite candidates of the pair set (DeepSeek candidates of \`datasets_sources/neuro_english_targets/\` and \`resplit_neuro_targets/\`); a sentence that an earlier folder had judged was never asked again.`, '');
  const mItems = fs.existsSync(path.join(ROOT, 'datasets_sources/resplit_meaning_judge/input/items.jsonl')) ? fs.readFileSync(path.join(ROOT, 'datasets_sources/resplit_meaning_judge/input/items.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0;
  const mKernel = estimateKernel({calls: mItems, systemChars: 4600, userChars: 650, outputTokens: 130}, price);
  const tOut = path.join(ROOT, 'datasets_sources/resplit_neuro_targets/input');
  const tRows = fs.existsSync(tOut) ? fs.readdirSync(tOut).filter(n => /^part-/.test(n)).reduce((a, n) => a + fs.readFileSync(path.join(tOut, n), 'utf8').split('\n').filter(Boolean).length, 0) : 0;
  const tKernel = estimateKernel({calls: Math.round(tRows / 12 * 1.5), systemChars: 7000, userChars: 1400, outputTokens: 1300}, price);
  const meteredAll = Object.values(costs).reduce((a, c) => a + c.cost_usd, 0);
  L.push(`**Other DeepSeek work of the re-split.** The meaning check of the rewrite candidates (two votes, prompts m1 and m2 of the calibrated judge, \`datasets_sources/resplit_meaning_judge/\`): ${fmt(mItems)} calls, about ${mKernel === null ? 'n/a' : mKernel.toFixed(2)} USD estimated. The rewrite candidates of the ${fmt(tRows)} neuro rows that had none (\`datasets_sources/resplit_neuro_targets/\`, train/dev and sealed): about ${tKernel === null ? 'n/a' : tKernel.toFixed(2)} USD estimated (12 rows per call with retries). **Total cost of the re-split**: metered ${meteredAll.toFixed(2)} USD (agent turns, all task folders) plus about ${((kernel ?? 0) + (mKernel ?? 0) + (tKernel ?? 0)).toFixed(1)} USD estimated for the kernel calls (parse judge ${kernel === null ? 'n/a' : kernel.toFixed(1)}, meaning ${mKernel === null ? 'n/a' : mKernel.toFixed(1)}, candidates ${tKernel === null ? 'n/a' : tKernel.toFixed(1)}).`, '');

  // the SymbolicProofingLLM pair set, before and after
  const pairsBefore = fs.existsSync(path.join(RESPLIT_DIR, 'before-proofing-manifest.json')) ? json(path.join(RESPLIT_DIR, 'before-proofing-manifest.json')) : null;
  const pairsAfter = fs.existsSync(path.join(ROOT, 'datasets/neuro_english/proofing/manifest.json')) ? json(path.join(ROOT, 'datasets/neuro_english/proofing/manifest.json')) : null;
  if (pairsBefore && pairsAfter) {
    L.push('## 6. SymbolicProofingLLM pair set (`datasets/neuro_english/proofing`, `eval/suites/neuro_english/proofing-test.jsonl`)', '');
    L.push('Before: built on the SOP-proxy split (identity labels are the old `analysis_verified` names). After: rewrite candidates verified on the analysis layer (every sentence of the candidate passes the gate, and the meaning is kept: strict gold match, normalized gold match confirmed by the two-vote meaning judge, or the two-vote meaning judge alone).', '');
    const levels = [...new Set(['train', 'dev', 'test'].flatMap(sp => [...Object.keys(pairsBefore.summary[sp]?.by_verification ?? {}), ...Object.keys(pairsAfter.summary[sp]?.by_verification ?? {})]))].sort();
    L.push(table(['split', 'pairs before', 'repair before', 'identity before', 'pairs after', 'repair after', 'identity after'], ['train', 'dev', 'test'].map(sp => [sp, fmt(pairsBefore.summary[sp]?.pairs), fmt(pairsBefore.summary[sp]?.by_kind?.repair), fmt(pairsBefore.summary[sp]?.by_kind?.identity), fmt(pairsAfter.summary[sp]?.pairs), fmt(pairsAfter.summary[sp]?.by_kind?.repair), fmt(pairsAfter.summary[sp]?.by_kind?.identity)])), '');
    L.push('Pairs by verification level:', '', table(['level', ...['train', 'dev', 'test'].flatMap(sp => [`${sp} before`, `${sp} after`])], levels.map(v => [v, ...['train', 'dev', 'test'].flatMap(sp => [fmt(pairsBefore.summary[sp]?.by_verification?.[v] ?? 0), fmt(pairsAfter.summary[sp]?.by_verification?.[v] ?? 0)])])), '');
    L.push(`Meaning rule in force: ${pairsAfter.meaning_judge ? `\`${pairsAfter.meaning_judge.rule}\` of experiment \`${pairsAfter.meaning_judge.experiment}\` (trusted ${pairsAfter.meaning_judge.trusted}, raw precision ${pairsAfter.meaning_judge.precision_raw}, adjudicated ${pairsAfter.meaning_judge.precision_adjudicated})` : 'n/a'}. The full report is \`eval/reports/current/neuro-oracle/summary.md\`.`, '');
  }
  for (const [name, text] of Object.entries(extra)) L.push(`## ${name}`, '', text, '');
  const file = path.join(OUT, 'resplit-summary.md');
  fs.writeFileSync(file, L.join('\n') + '\n');
  fs.writeFileSync(path.join(RESPLIT_DIR, 'summary.json'), JSON.stringify({generated_at: new Date().toISOString(), before: beforeM, after: afterM, movement_train_dev: moveTrainDev, movement_test: moveTest, judge: {items, verdicts_by_condition: tally, folders: index.count, estimated_kernel_cost_usd: kernel, metered_session_cost_usd: metered}}, null, 1) + '\n');
  return file;
}
