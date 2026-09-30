/** Reports of the three datasets: reuse analysis (eval/reports/current/three-datasets/reuse-analysis.md), coverage and the
 * counts tables the dataset READMEs embed. Reads only sources of train/dev rows, manifests and reports; sealed counts come
 * from the manifests and `eval/reports/current/three-datasets/sealed-source-counts.json` (written by the sealed tool). */
import fs from 'node:fs';
import path from 'node:path';
import {readJsonlShardedSync} from '../../../lib/jsonl-shards.mjs';
import {ROOT, archived, THREE_DATASETS} from '../../../lib/dataset-paths.mjs';

const WORK = path.join(ROOT, 'eval/reports/current/three-datasets');
const json = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const tally = (rows, key) => { const out = {}; for (const r of rows) { const k = key(r) ?? 'none'; out[k] = (out[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(out).sort()); };
const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
const fmt = n => (n ?? 0).toLocaleString('en-US');
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : 'n/a');

export const manifestOf = name => json(`datasets/${name}/manifest.json`);

/** Markdown table of the counts of one dataset manifest, for its README. */
export function countsSection(name) {
  const m = manifestOf(name), c = m.counts;
  const splits = ['train', 'dev', 'test'].filter(s => c[s]);
  const out = [`## Counts at the last build\n`, `Rebuilt ${m.train_dev_built_at ?? '?'} (train, dev) and ${m.test_built_at ?? '?'} (sealed test); SymbolicLM \`${m.symbolic_lm?.version}\`, rules \`${m.symbolic_lm?.rules}\`, ${m.symbolic_lm?.stanza}.\n`];
  out.push(table(['split', 'rows', ...(name === 'bad_english' ? ['with target'] : name === 'neuro_english' ? ['with target', 'rewrite targets'] : [])], splits.map(s => [s, fmt(c[s].rows), ...(name === 'bad_english' ? [fmt(c[s].with_target)] : name === 'neuro_english' ? [fmt(c[s].with_target), fmt(c[s].rewrite_targets)] : [])])));
  const sources = [...new Set(splits.flatMap(s => Object.keys(c[s].by_source ?? {})))];
  out.push('\nRows by source corpus:\n', table(['source', ...splits], sources.map(src => [src, ...splits.map(s => fmt(c[s].by_source?.[src] ?? 0))])));
  const extra = name === 'bad_english' ? ['by_language_kind', 'by_target_source'] : name === 'symbolic_english' ? ['by_analysis_verified'] : ['by_failure_kind', 'by_target_source'];
  for (const key of extra) {
    const values = [...new Set(splits.flatMap(s => Object.keys(c[s][key] ?? {})))];
    out.push(`\n\`${key.replace('by_', '')}\`:\n`, table([key.replace('by_', ''), ...splits], values.map(v => [v, ...splits.map(s => fmt(c[s][key]?.[v] ?? 0))])));
  }
  return out.join('\n');
}

const START = '<!-- counts -->';
/** Replace the section after the counts marker of every dataset README. */
export function updateReadmes() {
  for (const name of THREE_DATASETS) {
    const file = path.join(ROOT, 'datasets', name, 'README.md');
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, text.slice(0, text.indexOf(START) + START.length) + '\n\n' + countsSection(name) + '\n');
  }
}

/** Coverage per source corpus and split: symbolic / (symbolic + neuro). */
export function coverage() {
  const sym = manifestOf('symbolic_english').counts, neu = manifestOf('neuro_english').counts;
  const rows = [];
  for (const split of ['train', 'dev', 'test']) {
    const sources = new Set([...Object.keys(sym[split]?.by_source ?? {}), ...Object.keys(neu[split]?.by_source ?? {})]);
    for (const source of [...sources].sort()) {
      const a = sym[split]?.by_source?.[source] ?? 0, b = neu[split]?.by_source?.[source] ?? 0;
      rows.push({split, source, symbolic: a, neuro: b, coverage: a + b ? a / (a + b) : null});
    }
    const a = sym[split]?.rows ?? 0, b = neu[split]?.rows ?? 0;
    rows.push({split, source: 'all', symbolic: a, neuro: b, coverage: a + b ? a / (a + b) : null});
  }
  return rows;
}

const readAll = relative => readJsonlShardedSync(path.join(ROOT, relative));
const sealedCounts = () => { const file = path.join(WORK, 'sealed-source-counts.json'); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; };

/**
 * Markdown of eval/reports/current/three-datasets/reuse-analysis.md: what each source offers, what was reused for which
 * dataset, with counts. `formalizer` = classified train/dev records, `newCases` = the new-case records (all splits).
 */
export function reuseAnalysis({formalizer, newCases, movedToTest = []}) {
  const out = [];
  const w = (...lines) => out.push(...lines);
  const sealed = sealedCounts();
  const bad = manifestOf('bad_english'), sym = manifestOf('symbolic_english'), neu = manifestOf('neuro_english');
  const at = (m, split, key) => m.counts[split]?.[key] ?? {};
  const rowsIn = (m, split) => m.counts[split]?.rows ?? 0;
  w('# Reuse analysis for the three datasets', '', `Generated by \`tools/datasets/build-three-datasets.mjs report\` on ${new Date().toISOString()}. Inputs: the legacy corpora (now under \`datasets_archive/\`), the sealed suites (counts only, via \`eval/reports/current/three-datasets/sealed-source-counts.json\`), the new-case delivery under \`datasets_sources/new_cases/\` (read-only) and the reports named below. Rules: \`docs/specs/DS008-data-evaluation.md\` "Three datasets".`, '');
  w('## 1. Result in one table', '');
  const totals = split => [rowsIn(bad, split), rowsIn(sym, split), rowsIn(neu, split)];
  w(table(['split', 'bad_english', 'symbolic_english', 'neuro_english', 'total'], ['train', 'dev', 'test'].map(s => { const t = totals(s); return [s, ...t.map(fmt), fmt(t.reduce((a, b) => a + b, 0))]; })));
  w('', 'Sources of the rows (all splits):', '');
  const sources = [...new Set(['bad_english', 'symbolic_english', 'neuro_english'].flatMap(name => ['train', 'dev', 'test'].flatMap(split => Object.keys(manifestOf(name).counts[split]?.by_source ?? {}))))].sort();
  w(table(['source corpus', 'bad_english', 'symbolic_english', 'neuro_english'], sources.map(src => [src, ...[bad, sym, neu].map(m => fmt(['train', 'dev', 'test'].reduce((a, s) => a + (at(m, s, 'by_source')[src] ?? 0), 0)))])));

  w('', '## 2. Source by source', '');
  const cleanManifest = json(archived('clean-english/manifest.json'));
  w('### `datasets_archive/clean-english` (now `datasets_archive/clean-english`) and `eval/suites/clean-english`', '',
    `Clean-English formalization corpus of eval-clean-english-v1: train ${fmt(cleanManifest.counts.train)}, dev ${fmt(cleanManifest.counts.dev)}, sealed test ${fmt(cleanManifest.counts.test)} rows, all rows the classifier called \`clean_en\` (formalizer-v1 train/dev, and the three sealed suites). **Reuse:** it is exactly the population of \`symbolic_english\` plus \`neuro_english\` from formalizer sources, re-derived from the classifier rather than copied (so the datasets carry the analysis and the SymbolicLM verdict per row). Its sealed test is the sealed side of that population; sealed rows land only in the sealed tests of the new datasets. Per suite (test): ${Object.entries(cleanManifest.counts.test_by_suite).map(([k, v]) => `${k} ${fmt(v.clean_en)} clean of ${fmt(Object.values(v).reduce((a, b) => a + b, 0))}`).join('; ')}.`, '');
  w('### Partition manifests (clean_en, noisy_en, ro, mixed)', '');
  const partRows = [];
  const tallyTrainDev = tally(formalizer.filter(r => r.corpus === 'formalizer-v1'), r => `${r.split}|${r.partition}`);
  for (const split of ['train', 'dev']) partRows.push([`formalizer-v1 ${split}${split === 'dev' ? ' (all)' : ''}`, ...['clean_en', 'noisy_en', 'ro', 'mixed'].map(p => fmt(tallyTrainDev[`${split}|${p}`] ?? 0))]);
  const partitionDir = 'eval/reports/current/clean-english/partitions';
  for (const name of fs.readdirSync(path.join(ROOT, partitionDir)).filter(n => n.endsWith('.json')).sort()) { const c = json(`${partitionDir}/${name}`).counts; partRows.push([`${name.slice(0, -5)} (sealed test)`, ...['clean_en', 'noisy_en', 'ro', 'mixed'].map(p => fmt(c[p]))]); }
  const movedTally = tally(movedToTest, r => r.partition);
  w(table(['set', 'clean_en', 'noisy_en', 'ro', 'mixed'], partRows), '', `Of the formalizer-v1 dev rows, ${fmt(movedToTest.length)} (clean_en ${fmt(movedTally.clean_en)}, noisy_en ${fmt(movedTally.noisy_en)}, ro ${fmt(movedTally.ro)}, mixed ${fmt(movedTally.mixed)}) belong to split groups used by the sealed proofing test; by AGENTS.md rule 9 they are sealed as test in the three datasets and are not dev there.`, '',
    '**Reuse:** `noisy_en`, `ro` and `mixed` rows are the population of `bad_english` from formalizer sources (the classifier is `tools/datasets/clean-english.mjs`, re-run on every row, and its counts equal the manifests above); `clean_en` rows go to `symbolic_english` or `neuro_english` by the SymbolicLM verdict. The manifests list ids only, so they are used as a cross-check, not as data.', '');
  w('### `datasets_archive/formalizer-v1` and the sealed suites', '',
    `Gold SOP per row (the arbiter of "strict") and, for formalizer-v1 and formalizer-ood-v1, a verification world; the wild suite has accepted golds instead. Train ${fmt(formalizer.filter(r => r.corpus === 'formalizer-v1' && r.split === 'train').length)}, dev ${fmt(formalizer.filter(r => r.corpus === 'formalizer-v1' && r.split === 'dev').length)} rows; sealed test rows: ${Object.entries(sealed?.formalizer ?? {}).map(([suite, n]) => `${suite} ${fmt(n)}`).join(', ')}. **Reuse:** every row (rows of noisy or non-English partitions go to \`bad_english\`, the others by the SymbolicLM verdict). Noisy English rows get a target by reconstructing the clean text from their recorded noise operations (${fmt(Object.values(['train', 'dev', 'test'].reduce((a, s) => ({...a, [s]: at(bad, s, 'by_target_source')['noise-inverse'] ?? 0}), {})).reduce((a, b) => a + b, 0))} targets), from \`proofing\` repairs, or from a clean sibling.`, '');
  w('### `datasets_archive/proofing` and `datasets_archive/proofing-diverse-dev`', '');
  const proofing = {train: readAll(archived('proofing/train.jsonl')), dev: readAll(archived('proofing/dev.jsonl')), hard: readAll(archived('proofing/hard_cases.jsonl')), ro: readAll(archived('proofing/ro_translated.jsonl'))};
  w(table(['file', 'rows', 'by kind', 'by layer'], Object.entries(proofing).map(([k, rows]) => [k, fmt(rows.length), Object.entries(tally(rows, r => r.kind)).map(([a, b]) => `${a} ${fmt(b)}`).join(', '), Object.entries(tally(rows, r => r.layer)).map(([a, b]) => `${a} ${fmt(b)}`).join(', ')])),
    '', `The sealed proofing test: ${fmt(sealed?.proofing?.rows ?? 0)} rows (${Object.entries(sealed?.proofing?.by_kind ?? {}).map(([a, b]) => `${a} ${fmt(b)}`).join(', ')}). **Reuse:** message to oracle-passing rewrite pairs (\`kind: repair\`, target checked by the strict ud-rules-v1.4 oracle and the meaning checks) are the rewrite targets: \`proofing.repair\` targets in \`neuro_english\` ${fmt(['train', 'dev', 'test'].reduce((a, s) => a + (at(neu, s, 'by_target_source')['proofing.repair'] ?? 0), 0))} (layers parser/rules; layer \`input\` pairs belong to noisy messages and become \`bad_english\` targets: ${fmt(['train', 'dev', 'test'].reduce((a, s) => a + (at(bad, s, 'by_target_source')['proofing.repair'] ?? 0), 0))}); \`hard\` rows are the failure-layer evidence (\`parser\`, \`rules\`, \`convention\`, \`wording\`, \`input\`) behind \`failure_kind\`; identity rows only confirm handled messages (already in \`symbolic_english\`); the Romanian translate arm gives \`proofing.translate\` targets for Romanian/mixed rows (${fmt(['train', 'dev', 'test'].reduce((a, s) => a + (at(bad, s, 'by_target_source')['proofing.translate'] ?? 0), 0))}). \`proofing-diverse-dev\`: 669 Haiku-diversified paraphrases of formalizer-v1 train groups (415 English), used as additional rows in the split of their group (${fmt(['train', 'dev', 'test'].reduce((a, s) => a + ['bad_english', 'symbolic_english', 'neuro_english'].reduce((b, name) => b + (at(manifestOf(name), s, 'by_source')['proofing-diverse-dev'] ?? 0), 0), 0))} rows) and its \`v2-additions-*\` pairs as targets; \`candidates\`, \`teacher-variants\` and \`teacher-ledger\` are raw pools, not reused.`, '');
  w('### `datasets_sources/new_cases`', '');
  const byClass = {};
  for (const r of newCases) { const c = r.noisy ? 'noisy (bad_english)' : r.different ? 'clean message, differs from its reference' : 'clean identity'; const k = `${r.split}|${c}`; byClass[k] = (byClass[k] ?? 0) + 1; }
  const classes = ['noisy (bad_english)', 'clean message, differs from its reference', 'clean identity'];
  w(`6,000 LLM-written cases (writers 01-30, 200 each; \`reviewed-by:pending\`), format of \`new_cases.md\`: message, \`clean[]\` (one to three rewrites), categories, author, source; \`validation.json\` has 0 errors and 3,046 warnings (question mark added, names not verifiable); \`symbolic-lm-check.json.jsonl\` covers only 37 rows and was not used; \`gold_sop\` is absent, so nothing is gold-verified. The sealed writers of \`split-proposal.json\` (13, 14, 15, 28, 29, 30; 1,200 rows) are the test.`, '',
    table(['split', ...classes], ['train', 'dev', 'test'].map(s => [s, ...classes.map(c => fmt(byClass[`${s}|${c}`] ?? 0))])), '',
    `**Reuse:** noisy messages (classifier not clean, or a \`typos\`/\`casual_register\` tag with a differing reference) become \`bad_english\` rows with the clean reference as target; clean messages that SymbolicLM handles (valid SOP, no unparsed span) become \`symbolic_english\` rows when their analysis passes the gate (\`analysis_verified: parsers_agree\` or \`judge_bc\`, otherwise they move to \`neuro_english\` with \`failure_kind\` parser or unknown); clean messages it does not handle become \`neuro_english\` rows with the reference as target when SymbolicLM handles the reference (otherwise \`no_target\`). In numbers (all splits): bad_english ${fmt(['train', 'dev', 'test'].reduce((a, s) => a + (at(bad, s, 'by_source').new_cases ?? 0), 0))}, symbolic_english ${fmt(['train', 'dev', 'test'].reduce((a, s) => a + (at(sym, s, 'by_source').new_cases ?? 0), 0))}, neuro_english ${fmt(['train', 'dev', 'test'].reduce((a, s) => a + (at(neu, s, 'by_source').new_cases ?? 0), 0))}.`, '');
  w('### `eval/reports/current/symbolic-layers/regularization-candidates.jsonl`', '',
    `175 sealed-suite sentences (test 78, ood 58, wild 39) that the layered study judged wrongly parsed (DEEP 121, INPUT_TYPO 49, FAIL 5), each with rewrite attempts that preserved the meaning; 119 have an attempt that preserved the meaning and parsed correctly. **Reuse:** as \`regularization\` targets of sealed \`neuro_english\` rows (${fmt(at(neu, 'test', 'by_target_source').regularization ?? 0)} rows here; the rest of the candidates are noisy or already had a \`proofing\` target) and as \`parser\` failure evidence.`, '');
  w('### `eval/reports/current/clean-english/blame-clean-full.json` and the text-to-clean-english samples', '',
    'The blame report is aggregate (top categories and 3 examples each, no per-row list), so `failure_kind` is recomputed per row with the same diff (`tools/research/symbolic-layers-diff.mjs`) plus the proofing layers; it is consistent with the report (classes P, R, C, F). The text-to-clean-english samples (`samples/`, `raw/`, `newcases/`) are candidate model outputs and small bucket samples drawn from formalizer dev and the new cases: no new messages and no verified targets, so they are not reused as data; they document that the gate leaves clean input untouched and that LanguageTool/Qwen3 are the current LanguageProofingLLM baselines.', '');
  w('## 3. Coverage: how many clean-English rows SymbolicLM handles', '',
    'Coverage = symbolic / (symbolic + neuro), per source corpus and split (from the dataset manifests; `coverage.json`). For the gold-verified sources it is the strict accuracy of eval-clean-english-v1 under the same rules (ud-rules-v1.4): the three original sealed suites give 1,516 of 2,543 clean rows = 59.6% (formalizer-v1 63.1%, ood 74.2%, wild 16.0%), as in the blame report. New cases have no gold: their coverage counts handled messages (valid SOP, real outcome, no unparsed span), not verified analyses.', '');
  const cov = coverage();
  w(table(['split', 'source', 'symbolic_english', 'neuro_english', 'coverage'], cov.map(r => [r.split, r.source, fmt(r.symbolic), fmt(r.neuro), r.coverage === null ? 'n/a' : (100 * r.coverage).toFixed(1) + '%'])), '');
  return out.join('\n') + '\n';
}
