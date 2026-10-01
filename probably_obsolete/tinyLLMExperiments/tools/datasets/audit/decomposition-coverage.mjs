#!/usr/bin/env node
/** Coverage of decomposition cases in neuro_english and bad_english, and how well their targets follow the contract
 * (DS008 "Decomposition coverage", DS021 "Limited English for SymbolicLM").
 *
 *   node tools/datasets/audit/decomposition-coverage.mjs [--check-targets] [--out-dir eval/reports/current/composed-eval]
 *
 * Counts per dataset and split: rows, candidates (more than one finite clause or several questions in the message), candidates with
 * a target, decomposition cases (candidate whose target has more sentences than the message), by type. With `--check-targets` every
 * target sentence of a decomposition case (and of every neuro_english target) is analysed by SymbolicLM (cached) and checked against
 * the contract: one finite clause per sentence except connective-linked and complement clauses, no coordinated or relative clause
 * inside the sentence, and an explicit subject. bad_english has no stored analysis, so its message shapes are approximate (cues).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {splitSentences} from '../../../lib/sentence-split.mjs';
import {loadRows} from '../../eval/composed/components.mjs';
import {loadSealedRows} from '../../eval/composed/sealed.mjs';
import {classifyRow, contractOfSentence} from '../three-datasets/decomposition.mjs';

const SPLITS = ['train', 'dev', 'test'];
/** Generated or production working data is not a natural decomposition case (the composed paragraphs would be counted twice). */
const WORKING_DATA = new Set(['composed', 'form-variant', 'production']);
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

export function coverage(rowsBy) {
  const out = {};
  for (const [dataset, splits] of Object.entries(rowsBy)) {
    out[dataset] = {};
    for (const [split, rows] of Object.entries(splits)) {
      const c = {rows: rows.length, candidates: 0, candidates_with_target: 0, decomposition_cases: 0, by_type: {}, by_type_with_target: {}, by_type_decomposition: {}, by_family_decomposition: {}, unpunctuated_candidates: 0, unpunctuated_decomposition: 0, approximate: dataset === 'bad_english'};
      for (const row of rows) {
        const k = classifyRow(row);
        if (!k.candidate) continue;
        c.candidates++; bump(c.by_type, k.type); if (k.unpunctuated) c.unpunctuated_candidates++; if (k.unpunctuated && k.decomposition) c.unpunctuated_decomposition++;
        if (k.has_target) { c.candidates_with_target++; bump(c.by_type_with_target, k.type); }
        if (k.decomposition) { c.decomposition_cases++; bump(c.by_type_decomposition, k.type); bump(c.by_family_decomposition, row.source?.family ?? 'none'); }
      }
      out[dataset][split] = c;
    }
  }
  return out;
}

/** Contract check of the target sentences of `rows` (decomposition cases); `lm.run(text)` returns the cached SymbolicLM record. */
export async function checkTargets(rows, lm) {
  const t = {rows: 0, sentences: 0, single_clause: 0, linked_by_connective: 0, complement_clause: 0, coordinated_clause: 0, relative_clause: 0, other_subordination: 0, elided_subject: 0, sentences_ok: 0, root_without_subject: 0, rows_all_sentences_ok: 0, examples: []};
  for (const row of rows) {
    t.rows++;
    let all = true;
    for (const unit of splitSentences(row.target)) {
      const rec = await lm.run(unit.text);
      const sentence = rec.sentences?.[0];
      t.sentences++;
      if (!sentence || rec.sentences.length > 1) { all = false; continue; }
      const v = contractOfSentence(sentence);
      if (v.single) t.single_clause++;
      if (v.linked) t.linked_by_connective++;
      if (v.complement) t.complement_clause++;
      if (v.coordinated) t.coordinated_clause++;
      if (v.relative) t.relative_clause++;
      if (v.other) t.other_subordination++;
      if (v.elided_subject) t.elided_subject++;
      if (v.clauses === 0) t.root_without_subject++;
      if (v.ok) t.sentences_ok++; else { all = false; if (t.examples.length < 12) t.examples.push({row: row.id, sentence: unit.text, verdict: v}); }
    }
    if (all) t.rows_all_sentences_ok++;
  }
  return t;
}

const TYPES = ['coordination', 'multiple_questions', 'subordinate_clause', 'relative_clause', 'list', 'other'];
const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : 'n/a');

/** Markdown of the coverage report (decomposition-coverage.md): counts by type and, when present, the contract check of the targets. */
export function render(report) {
  const L = ['# Decomposition coverage and target style', '', `Generated ${report.generated_at} by \`node tools/datasets/audit/decomposition-coverage.mjs${report.contract ? ' --check-targets' : ''}\`. ${report.definition}. Rows of source.corpus composed, form-variant and production are left out. Candidates are an upper bound (a message with several clauses whose rewrite, if any, is not a decomposition). \`bad_english\` has no stored analysis, so its message shapes come from surface cues and are approximate. The contract is DS021 "Limited English for SymbolicLM".`, '',
    '## Counts', '', `| dataset/split | rows | candidates | candidates with a verified target | decomposition cases | ${TYPES.join(' | ')} | unpunctuated run-ons among them |`, `| --- | --- | --- | --- | --- | ${TYPES.map(() => '---').join(' | ')} | --- |`];
  for (const [d, splits] of Object.entries(report.coverage)) for (const [sp, c] of Object.entries(splits)) L.push(`| ${d}/${sp} | ${c.rows} | ${c.candidates} | ${c.candidates_with_target} | ${c.decomposition_cases} | ${TYPES.map(t => c.by_type_decomposition[t] ?? 0).join(' | ')} | ${c.unpunctuated_decomposition} |`);
  L.push('', 'Candidates without a verified target are the pool a teacher-generation pass would work on (an LLM writing the decomposed target, checked by the same gates); no LLM is used here.', '');
  if (report.contract) {
    L.push('## How well the existing targets follow the contract', '', 'Every target sentence of a decomposition case (and every neuro_english target) is analysed alone by SymbolicLM. A sentence is within the contract when it has at most one finite clause apart from connective-linked and complement clauses, no coordinated or relative clause and no elided subject.', '', '| dataset/split | targets | target sentences | single clause | linked by a connective | complement clause | coordinated clause | relative clause | other subordination | elided subject | sentences within the contract | targets with every sentence within the contract |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [d, splits] of Object.entries(report.contract)) for (const [sp, v] of Object.entries(splits)) for (const [label, t] of [['decomposition cases', v.decomposition_targets], ['all neuro_english targets', v.all_neuro_targets]]) {
      if (!t) continue;
      L.push(`| ${d}/${sp} ${label} | ${t.rows} | ${t.sentences} | ${pct(t.single_clause, t.sentences)} | ${t.linked_by_connective} | ${t.complement_clause} | ${t.coordinated_clause} | ${t.relative_clause} | ${t.other_subordination} | ${t.elided_subject} | ${pct(t.sentences_ok, t.sentences)} | ${pct(t.rows_all_sentences_ok, t.rows)} |`);
    }
    L.push('');
  }
  return L.join('\n');
}

const parseArgs = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(ROOT, o['out-dir'] ?? 'eval/reports/current/composed-eval');
  const rowsBy = {};
  for (const d of ['neuro_english', 'bad_english']) { rowsBy[d] = {}; for (const s of SPLITS) rowsBy[d][s] = (s === 'test' ? loadSealedRows(d) : loadRows(d, [s])).filter(r => !WORKING_DATA.has(r.source?.corpus)); }
  const report = {generated_at: new Date().toISOString(), definition: 'candidate: message with more than one finite clause or several questions; decomposition case: a candidate whose verified target has more sentences than the message', coverage: coverage(rowsBy)};
  if (o['check-targets']) {
    const {openLm} = await import('../../eval/composed/lm.mjs');
    const lm = await openLm({cacheDir: path.join(outDir, 'cache')});
    try {
      report.contract = {};
      for (const d of Object.keys(rowsBy)) {
        for (const s of SPLITS) {
          const sel = rowsBy[d][s].filter(r => r.target && (d === 'neuro_english' || classifyRow(r).decomposition));
          const dec = sel.filter(r => classifyRow(r).decomposition);
          (report.contract[d] ??= {})[s] = {all_targets_checked: sel.length, decomposition_targets: await checkTargets(dec, lm), ...(d === 'neuro_english' ? {all_neuro_targets: await checkTargets(sel, lm)} : {})};
        }
      }
    } finally { await lm.close(); }
  }
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, 'decomposition-coverage.json'), JSON.stringify(report, null, 1) + '\n');
  fs.writeFileSync(path.join(outDir, 'decomposition-coverage.md'), render(report));
  for (const [d, splits] of Object.entries(report.coverage)) for (const [s, c] of Object.entries(splits)) console.log(`${d}/${s}: ${c.rows} rows, ${c.candidates} candidates (${c.candidates_with_target} with a target), ${c.decomposition_cases} decomposition cases ${JSON.stringify(c.by_type_decomposition)}, unpunctuated ${c.unpunctuated_decomposition}`);
  process.exit(0);
}
