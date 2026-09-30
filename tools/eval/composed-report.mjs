#!/usr/bin/env node
/** Renders eval/reports/current/composed-eval/summary.md from the run summaries and records of tools/eval/composed-score.mjs.
 *
 *   node tools/eval/composed-report.mjs [--dir eval/reports/current/composed-eval]
 *
 * Every table is per sentence count or mix with Wilson 95% intervals; the last stage of each summary is used. Nothing is a claim about
 * forms the system was not built on (DS008 "Form coverage and form variants"). Per-legacy-suite breakdowns are not reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {wilson} from './composed/stats.mjs';

const w = x => (x && x.p !== null && x.p !== undefined ? `${x.p}% [${x.lo}, ${x.hi}] ${x.k}/${x.n}` : 'n/a');
const short = x => (x && x.p !== null && x.p !== undefined ? `${x.p}% (${x.k}/${x.n})` : 'n/a');
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const last = summary => summary?.stages?.at(-1) ?? null;
const strata = (...rates) => [...new Set(rates.flatMap(r => Object.keys(r?.by ?? {})))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

function symbolicSection(dir) {
  const L = ['## 1. SymbolicLM alone on composed paragraphs (K1, K3, K5)', '', 'Each paragraph is analysed as one message; each component alone is the control. `paragraph = concatenation` compares the SOP with the concatenated stored SOPs (ids renumbered, statements before queries). The **composition effect** restricts to cases whose components all pass alone, so a loss there is a cross-sentence effect. `sentences as alone` means every sentence keeps its tokens, heads and labels and no sentence is cut or merged. `handled` is a valid conversion with nothing unparsed and no uncertainty flag on the paragraph.', ''];
  for (const kind of ['K1', 'K3', 'K5']) {
    const s = last(readJson(path.join(dir, `symbolic-lm__${kind}.summary.json`)));
    if (!s) continue;
    const ids = [...new Set(readJsonl(path.join(dir, 'runs', `symbolic-lm__${kind}.jsonl`)).map(r => r.lm_id).filter(Boolean))];
    L.push(`### ${kind} (${s.cases} cases${ids.length ? `; SymbolicLM code hash ${ids.join(', ')}` : ''})`, '', '| sentences | paragraph = concatenation | composition effect (components all pass alone) | sentences as alone | sentence split as alone | components alone pass | paragraph handled |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const st of strata(s.sop_exact)) L.push(`| ${st} | ${w(s.sop_exact.by[st])} | ${w(s.composition_effect.by?.[st])} | ${w(s.analysis_equal.by[st])} | ${w(s.sentence_split_ok.by[st])} | ${w(s.components_alone_ok.by[st])} | ${w(s.handled.by[st])} |`);
    L.push(`| all | ${w(s.sop_exact.all)} | ${w(s.composition_effect.all)} | ${w(s.analysis_equal.all)} | ${w(s.sentence_split_ok.all)} | ${w(s.components_alone_ok.all)} | ${w(s.handled.all)} |`, '', `Per component: right in the paragraph ${w(s.components)}; right alone ${w(s.components_alone)}. Causes of a loss: ${JSON.stringify(s.causes_of_loss ?? {})}.`, '');
  }
  return L;
}

const RW = [['clean_sentences_changed', 'clean sentences changed (break)'], ['bad_sentences_fixed', 'bad sentences fixed'], ['bad_sentences_untouched', 'bad sentences left as they were'], ['bad_sentences_wrong_rewrite', 'bad sentences wrongly rewritten'], ['dropped_components', 'sentences dropped'], ['cases_with_added_text', 'cases with added text'], ['cases_order_preserved', 'cases with order preserved']];

function rewriteSection(dir) {
  const L = ['## 2. A rewriter on composed paragraphs (baseline: the existing Gemma 3 270M proofreader, not trained for this)', '', 'Whole paragraph: the rewriter gets the text. Per sentence: the host splits, a gate keeps the sentences that are fine (SymbolicLM handles them alone; for K4 the clean-English gate), the rewriter gets only the others. "no rewrite" is the identity rewriter: SymbolicLM on the original paragraph.', ''];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /__K[2345]__(paragraph|sentence)\.summary\.json$/.test(f)).sort() : [];
  if (!files.length) return [...L, '(no rewriter run yet)', ''];
  L.push('| rewriter | kind | mode | cases | clean sentences changed | bad fixed | bad untouched | bad wrong | dropped | added text | exact cases | end-to-end SOP | splitter agrees |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const f of files) {
    const s = readJson(path.join(dir, f)), l = last(s); if (!l) continue;
    const [name, kind, mode] = f.replace('.summary.json', '').split('__');
    L.push(`| ${name} | ${kind} | ${mode} | ${l.cases} | ${short(l.clean_sentences_changed)} | ${short(l.bad_sentences_fixed)} | ${short(l.bad_sentences_untouched)} | ${short(l.bad_sentences_wrong_rewrite)} | ${short(l.dropped_components)} | ${short(l.cases_with_added_text)} | ${short(l.cases_exact.all)} | ${short(l.cases_e2e_sop_exact.all)} | ${short(l.splitter_agrees)} |`);
  }
  L.push('', '### Per-sentence mode: gate and splitter', '', '| rewriter | kind | gate recall (sentences that need a rewrite and were sent) | clean sentences sent | rewriter calls per sentence | splitter agrees, all components punctuated | splitter agrees, an unpunctuated component |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const f of files.filter(f => f.endsWith('__sentence.summary.json'))) {
    const l = last(readJson(path.join(dir, f))); if (!l) continue;
    const [name, kind] = f.split('__');
    L.push(`| ${name} | ${kind} | ${short(l.gate?.recall_of_sentences_that_need_a_rewrite)} | ${short(l.gate?.clean_sentences_sent_to_the_rewriter)} | ${short(l.sentence_mode?.share_sent)} | ${short(l.splitter_agrees_when_all_components_punctuated)} | ${short(l.splitter_agrees_with_an_unpunctuated_component)} |`);
  }
  L.push('', '### By number of sentences (whole paragraph, exact cases and clean sentences untouched)', '', '| rewriter | kind | mode | stratum | exact cases | cases without a broken clean sentence |', '| --- | --- | --- | --- | --- | --- |');
  for (const f of files) {
    const l = last(readJson(path.join(dir, f))); if (!l) continue;
    const [name, kind, mode] = f.replace('.summary.json', '').split('__');
    for (const st of strata(l.cases_exact)) L.push(`| ${name} | ${kind} | ${mode} | ${st} | ${short(l.cases_exact.by[st])} | ${short(l.clean_changed_by_stratum?.by?.[st])} |`);
  }
  // Token-length strata (whole paragraph): the sidecar marks the cases beyond the proofreader's training length.
  const tok = [];
  for (const f of files.filter(f => f.endsWith('__paragraph.summary.json'))) {
    const [name, kind] = f.split('__');
    const rec = readJsonl(path.join(dir, 'runs', f.replace('.summary.json', '.jsonl'))).filter(r => r.tokens);
    if (!rec.length) continue;
    for (const [label, pred] of [['within training p99 (<= 87 tokens)', r => !r.tokens.beyond_train_p99], ['beyond training p99', r => r.tokens.beyond_train_p99 && !r.tokens.beyond_train_max_total], ['beyond the longest training example (> 547 tokens)', r => r.tokens.beyond_train_max_total]]) {
      const sel = rec.filter(pred); if (!sel.length) continue;
      const clean = sel.reduce((a, r) => a + r.clean_components, 0), broken = sel.reduce((a, r) => a + r.broken, 0);
      tok.push(`| ${name} | ${kind} | ${label} | ${sel.length} | ${short(wilson(sel.filter(r => r.exact).length, sel.length))} | ${short(wilson(broken, clean))} |`);
    }
  }
  if (tok.length) L.push('', '### By token length (whole paragraph; Gemma 3 270M tokens, training-style length)', '', '| rewriter | kind | length | cases | exact cases | clean sentences changed |', '| --- | --- | --- | --- | --- | --- |', ...tok);
  return [...L, ''];
}

function decompositionSection(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /__K6-.*\.summary\.json$/.test(f)).sort() : [];
  const L = ['## 3. Decomposition (K6): a tangled message into short simple sentences', ''];
  if (!files.length) return [...L, '(no K6 run yet)', ''];
  L.push('| rewriter | dataset | cases | changed | sentence count matches | at least the expected sentences | every sentence within the contract | SymbolicLM handles every sentence | exact target | names kept | numbers kept | negations kept | connectives kept | SOP = gold |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const f of files) {
    const l = last(readJson(path.join(dir, f))); if (!l) continue;
    const [name, rest] = f.replace('.summary.json', '').split('__K6-');
    L.push(`| ${name} | ${rest} | ${l.cases} | ${short(l.changed)} | ${short(l.output_sentence_count_matches.all)} | ${short(l.output_at_least_expected_sentences)} | ${short(l.every_sentence_within_contract.all)} | ${short(l.every_sentence_handled_by_symbolic_lm.all)} | ${short(l.exact_target)} | ${short(l.preserved.names)} | ${short(l.preserved.numbers)} | ${short(l.preserved.negations)} | ${short(l.preserved.connectives)} | ${short(l.sop_equals_gold)} |`);
  }
  return [...L, ''];
}

export function render(dir) {
  const manifests = ['symbolic_english', 'neuro_english', 'bad_english'].map(d => readJson(path.join(ROOT, 'eval/suites', d, 'manifest-composed.json'))).filter(Boolean);
  return [
    '# Composed evaluation: summary', '',
    `Generated ${new Date().toISOString()} by \`node tools/eval/composed-report.mjs\` from the run summaries of \`tools/eval/composed-score.mjs\` (preregistration \`status/preregistrations/eval-composed-v1.json\`). No training; the rewriter is an existing checkpoint measured as a baseline. Suites: ${manifests.map(m => `${m.dataset} ${m.rows} rows (sha256 ${m.sha256.slice(0, 12)}, built ${m.built_at})`).join('; ') || 'not built'}.`, '',
    ...symbolicSection(dir), ...rewriteSection(dir), ...decompositionSection(dir),
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = path.resolve(ROOT, args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'eval/reports/current/composed-eval');
  fs.writeFileSync(path.join(dir, 'summary.md'), render(dir));
  console.log(`wrote ${path.relative(ROOT, path.join(dir, 'summary.md'))}`);
}
