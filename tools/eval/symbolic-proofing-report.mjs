#!/usr/bin/env node
/** Tables of the SymbolicProofingLLM iteration-2 evaluation report (experiment train-symbolic-proofing-gemma270m-it2), from the score files only.
 *
 *   SYMPROOF_WORK=eval/reports/current/symbolic-proofing-it2 node tools/eval/symbolic-proofing-report.mjs [--out tables.md]
 *
 * Reads `scores/<arm>__<split>.json` (tools/eval/symbolic-proofing-eval.mjs score), `composed/analysis__*.json` (composed-score) and
 * `composed/<arm>__<kind>__<mode>.summary.json` (text-level composed scorer), writes Markdown tables, paired bootstrap intervals (it2 minus the
 * other arms, 10,000 resamples, seed 7), the error categories and the examples. No model is called.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {bootstrap} from '../research/proofing.mjs';
import {wilson} from './composed/stats.mjs';
import {sentencesOf, fold, foldWords, lostFillers, fillersOf} from '../datasets/symbolic-proofing-v2/units.mjs';

const WORK = path.join(ROOT, process.env.SYMPROOF_WORK ?? 'eval/reports/current/symbolic-proofing-it2');
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'tables.md';
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const score = (arm, split) => { const f = path.join(WORK, 'scores', `${arm}__${split}.json`); return fs.existsSync(f) ? readJson(f) : null; };
const ARMS = [['identity', 'no rewrite'], ['base', 'untrained base'], ['it1', 'iteration 1'], ['it2', 'iteration 2']];
const pc = x => (x && x.n ? `${x.k}/${x.n} = ${x.p}% [${x.lo}, ${x.hi}]` : 'n/a');
const round = x => Math.round(x * 10) / 10;
const lines = [];
const h = (level, text) => lines.push('', `${'#'.repeat(level)} ${text}`, '');
const table = (head, rows) => { lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`); for (const r of rows) lines.push(`| ${r.join(' | ')} |`); lines.push(''); };
const trunc = (s, n = 220) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; };
const numbers = {};

/** Paired bootstrap of the mean difference a minus b over rows of one kind, metric 0/1 per row. */
function diff(recA, recB, metric) {
  const B = new Map(recB.map(r => [r.id, r])), clusters = [];
  for (const r of recA) { const o = B.get(r.id); if (o) clusters.push([[Number(metric(r)), Number(metric(o))]]); }
  const ci = bootstrap(clusters), delta = clusters.reduce((s, c) => s + c[0][0] - c[0][1], 0) / clusters.length;
  // bootstrap() returns the interval of (second minus first); flip the sign so that the reported difference is a minus b
  return {n: clusters.length, delta: round(delta * 100), lo: round(-ci[1] * 100), hi: round(-ci[0] * 100)};
}
const fmtDiff = d => `${d.delta >= 0 ? '+' : ''}${d.delta} pp [${d.lo}, ${d.hi}]`;

// ------------------------------------------------------------------ dev
h(2, 'Checkpoint selection on dev (it2 dev units)');
const devLoss = (() => { const f = path.join(WORK, 'train-symproof-it2-train-a.log'); if (!fs.existsSync(f)) return []; return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('"dev_loss"')).map(l => JSON.parse(l)); })();
{
  const rows = [];
  for (const e of [1, 2, 3]) {
    const s = score(`it2ep${e}`, 'dev');
    if (!s) continue;
    const r = s.summary.primary_repair, i = s.summary.primary_identity;
    rows.push([`epoch ${e}`, devLoss[e - 1] ? devLoss[e - 1].dev_loss.toFixed(4) : 'n/a', pc(r.output_analysis_correct_and_meaning_ok), pc(r.output_meaning_kept), pc(r.output_analysis_correct), pc(i.analysis_changed_or_text_changed), pc(i.analysis_changed), pc(r.output_runaway), pc(r.output_pronoun_dropped), pc(r.output_filler_dropped)]);
  }
  table(['checkpoint', 'dev loss', 'repair: analysis correct AND meaning kept', 'repair: meaning kept', 'repair: analysis correct', 'identity: analysis or text changed', 'identity: analysis changed', 'repair: runaway', 'repair: pronoun dropped', 'repair: filler dropped'], rows);
}

// ------------------------------------------------------------------ sealed pairs and sym500
function pairTables(split, title) {
  h(2, title);
  const S = Object.fromEntries(ARMS.map(([a]) => [a, score(a, split)]));
  const have = ARMS.filter(([a]) => S[a]);
  if (split === 'test') {
    const base = S.identity ?? S.it2;
    h(3, 'Repair pairs (PRIMARY, analysis layer)');
    const metrics = [
      ['input analysis correct (reference): local only (trees identical)', s => s.primary_repair.input_analysis_correct_local],
      ['input analysis correct (reference): with the judge', s => s.primary_repair.input_analysis_correct],
      ['verified target passes the same gate (ceiling)', s => s.primary_repair.target_analysis_correct],
      ['(a) output analysis correct, LOCAL ONLY (default and accurate trees identical)', s => s.primary_repair.output_analysis_correct_local],
      ['(a) **LOCAL ONLY: analysis correct AND meaning kept** (unchanged, equals target, or local analysis comparison equivalent)', s => s.primary_repair.output_analysis_correct_and_meaning_local],
      ['(b) output analysis correct, with the DeepSeek parse judge', s => s.primary_repair.output_analysis_correct],
      ['output meaning kept (unchanged, equals target, or hard mechanical checks AND two-vote judge)', s => s.primary_repair.output_meaning_kept],
      ['(b) **WITH JUDGES: analysis correct AND meaning kept**', s => s.primary_repair.output_analysis_correct_and_meaning_ok],
      ['outputs that needed the DeepSeek meaning judge (changed, not the target, hard checks pass, local comparison not equivalent)', s => s.primary_repair.meaning_judge_needed],
      ['  same, mechanical meaning checks only (iteration-1 definition)', s => s.primary_repair.output_analysis_correct_and_meaning_ok_mechanical_only],
      ['fixed, of the inputs whose analysis was not correct', s => s.primary_repair.fixed_of_failing_inputs],
      ['worse than input, of the inputs whose analysis was correct', s => s.primary_repair.worse_than_input],
      ['output equals the verified target text', s => s.repair_exact_text],
      ['output left unchanged', s => s.repair_left_unchanged],
      ['pronoun dropped or replaced', s => s.primary_repair.output_pronoun_dropped],
      ['lead-in, tag or question frame dropped', s => s.primary_repair.output_filler_dropped],
      ['statement turned into a question', s => s.primary_repair.output_statement_to_question],
      ['runaway (cap hit or repeated sentence)', s => s.primary_repair.output_runaway],
      ['one-clause sentences among the output sentences', s => s.primary_repair.output_one_clause_sentences],
      ['explicit-subject sentences among the output sentences', s => s.primary_repair.output_explicit_subject_sentences],
      ['output sentence count equals the target', s => s.primary_repair.sentence_count_equals_target],
    ];
    table(['metric', ...have.map(([, n]) => n)], metrics.map(([name, f]) => [name, ...have.map(([a]) => pc(f(S[a].summary)))]));
    h(3, 'Identity pairs (PRIMARY): the sentence works, nothing may change');
    const im = [
      ['**analysis OR text changed**', s => s.primary_identity.analysis_changed_or_text_changed],
      ['analysis changed', s => s.primary_identity.analysis_changed],
      ['text changed', s => s.primary_identity.text_changed],
      ['working inputs: output no longer analysis-correct', s => s.primary_identity.working_no_longer_analysis_correct],
      ['pronoun dropped or replaced', s => s.primary_identity.pronoun_dropped],
      ['runaway', s => s.primary_identity.runaway],
      ['meaning check failed (mechanical)', s => s.primary_identity.meaning_broken_mechanical],
    ];
    table(['metric', ...have.map(([, n]) => n)], im.map(([name, f]) => [name, ...have.map(([a]) => pc(f(S[a].summary)))]));
    h(3, 'Paired bootstrap, iteration 2 minus the other arm (95% interval, 10,000 resamples)');
    const rows = [];
    for (const [a, name] of have.filter(([a]) => a !== 'it2')) {
      const rep = diff(S.it2.records.filter(r => r.kind === 'repair'), S[a].records.filter(r => r.kind === 'repair'), r => r.analysis.good);
      const loc = diff(S.it2.records.filter(r => r.kind === 'repair'), S[a].records.filter(r => r.kind === 'repair'), r => r.analysis.local_good);
      const idn = diff(S.it2.records.filter(r => r.kind === 'identity'), S[a].records.filter(r => r.kind === 'identity'), r => r.unchanged && r.analysis.same_analysis);
      const fixed = diff(S.it2.records.filter(r => r.kind === 'repair' && !r.analysis.in_pass), S[a].records.filter(r => r.kind === 'repair' && !r.analysis.in_pass), r => r.analysis.good);
      rows.push([name, `${fmtDiff(loc)} (n ${loc.n})`, `${fmtDiff(rep)} (n ${rep.n})`, `${fmtDiff(fixed)} (n ${fixed.n})`, `${fmtDiff(idn)} (n ${idn.n})`]);
      numbers[`${split}_it2_minus_${a}`] = {repair_good_with_judges: rep, repair_good_local_only: loc, fixed, identity_kept: idn};
    }
    table(['it2 minus', '(a) repair, LOCAL ONLY: analysis correct AND meaning kept', '(b) repair, with judges: analysis correct AND meaning kept', '(b) repair: fixed of failing inputs', 'identity: analysis and text kept'], rows);
    h(3, 'Secondary: SOP layer (not used for selection or verdict)');
    const sm = [
      ['repair: SOP matches the gold, strict', s => s.repair_strict_gold], ['repair: SOP matches the gold, frame-normalized', s => s.repair_normalized_gold],
      ['repair: SOP equals the SOP of the verified target', s => s.repair_accepted_sop], ['identity: break (SOP no longer matches, strict)', s => s.identity_break],
      ['all pairs: SymbolicLM parses the output with no unparsed span', s => s.parsed_clean_all], ['empty or capped outputs', s => s.empty_or_truncated],
    ];
    table(['metric', ...have.map(([, n]) => n)], sm.map(([name, f]) => [name, ...have.map(([a]) => pc(f(S[a].summary)))]));
    // decomposition subset
    h(3, 'Decomposition pairs of the sealed set (the verified target has more sentences than the input)');
    const dec = {};
    for (const [a, name] of have) {
      const recs = S[a].records.filter(r => r.kind === 'repair' && r.decomposition);
      const cnt = f => recs.filter(f).length;
      dec[a] = [name, String(recs.length), pc(wilson(cnt(r => r.analysis.good), recs.length)), pc(wilson(cnt(r => r.analysis.shape_out?.sentences === r.analysis.shape_target?.sentences), recs.length)), pc(wilson(cnt(r => (r.analysis.shape_out?.sentences ?? 0) >= (r.analysis.shape_target?.sentences ?? 0)), recs.length)),
        pc(wilson(recs.reduce((x, r) => x + (r.analysis.shape_out?.one_clause ?? 0), 0), recs.reduce((x, r) => x + (r.analysis.shape_out?.sentences ?? 0), 0))), pc(wilson(recs.reduce((x, r) => x + (r.analysis.shape_out?.subject ?? 0), 0), recs.reduce((x, r) => x + (r.analysis.shape_out?.sentences ?? 0), 0))), pc(wilson(cnt(r => r.exact_text), recs.length))];
    }
    table(['arm', 'pairs', 'analysis correct AND meaning kept', 'sentence count equals target', 'sentence count at least target', 'one-clause output sentences', 'explicit-subject output sentences', 'equals the target text'], have.map(([a]) => dec[a]));
    void base;
  } else {
    const im = [['**analysis OR text changed**', s => s.primary_identity.analysis_changed_or_text_changed], ['analysis changed', s => s.primary_identity.analysis_changed], ['text changed', s => s.primary_identity.text_changed],
      ['working inputs (pass the gate): output no longer analysis-correct', s => s.primary_identity.working_no_longer_analysis_correct], ['pronoun dropped or replaced', s => s.primary_identity.pronoun_dropped], ['runaway', s => s.primary_identity.runaway], ['meaning check failed (mechanical)', s => s.primary_identity.meaning_broken_mechanical]];
    table(['metric', ...have.map(([, n]) => n)], im.map(([name, f]) => [name, ...have.map(([a]) => pc(f(S[a].summary)))]));
    const rows = [];
    for (const [a, name] of have.filter(([a]) => a !== 'it2')) { const d = diff(S.it2.records, S[a].records, r => r.unchanged && r.analysis.same_analysis); rows.push([name, `${fmtDiff(d)} (n ${d.n})`]); numbers[`${split}_it2_minus_${a}`] = {identity_kept: d}; }
    table(['it2 minus', 'identity: analysis and text kept'], rows);
  }
}
pairTables('test', 'Sealed pair test (every input cut by the host splitter, every sentence sent to the model, outputs joined; HF bf16 greedy)');
pairTables('sym500', '500 random working sentences of the sealed symbolic_english test (HF bf16 greedy)');

// ------------------------------------------------------------------ train fit
{
  const s = score('it2', 'trainfit');
  if (s) {
    h(2, 'Capacity check: the final model on 400 repair and 400 identity pairs of its own training file');
    const r = s.summary.primary_repair, i = s.summary.primary_identity;
    table(['metric', 'value'], [['repair: output equals the training target text', pc(s.summary.repair_exact_text)], ['repair: analysis correct AND meaning kept', pc(r.output_analysis_correct_and_meaning_ok)], ['repair: left unchanged', pc(s.summary.repair_left_unchanged)],
      ['identity: analysis or text changed', pc(i.analysis_changed_or_text_changed)]]);
  }
}

// ------------------------------------------------------------------ composed
h(2, 'Composed suites (analysis layer; GGUF Q8_0 through llama-server on the GPU)');
const CA = (name, kind, mode, dataset = null) => { const f = path.join(WORK, 'composed', `analysis__${name}__${kind}${dataset ? '-' + dataset : ''}__${mode}.json`); return fs.existsSync(f) ? readJson(f) : null; };
const CT = (name, kind, mode) => { const f = path.join(WORK, 'composed', `${name}__${kind}__${mode}.summary.json`); return fs.existsSync(f) ? readJson(f).stages.at(-1) : null; };
for (const [kind, title] of [['K2', 'K2 mixed paragraphs (bad and clean sentences mixed)'], ['K3', 'K3 long identity paragraphs (every sentence works)'], ['K5', 'K5 pronoun references (the later sentence refers by pronoun)']]) {
  for (const mode of ['sentence', 'paragraph']) {
    const rows = [];
    for (const [a, name] of ARMS) {
      const an = CA(a, kind, mode), tx = CT(a, kind, mode);
      if (!an) continue;
      const s = an.summary;
      rows.push([name, pc(s.sentences_correct_out_local), pc(s.sentences_correct_out), pc(s.output_analysis_correct_local), pc(s.output_analysis_correct), pc(s.output_analysis_correct_and_meaning_local), pc(s.output_analysis_correct_and_meaning_ok), pc(s.output_meaning_kept), pc(s.text_unchanged), pc(s.same_analysis_as_input), pc(s.pronouns_kept),
        tx ? pc(tx.clean_sentences_changed) : 'n/a', tx && kind === 'K2' ? pc(tx.bad_sentences_fixed) : '-', pc(s.runaway), pc(s.sentence_count_equals_expected)]);
    }
    if (!rows.length) continue;
    h(3, `${title}, ${mode === 'sentence' ? 'per-sentence mode (ALL sentences sent)' : 'whole-paragraph mode (comparison)'}`);
    table(['arm', '(a) sentences analysis-correct, local only', '(b) sentences analysis-correct, with judge', '(a) paragraphs analysis-correct, local only', '(b) paragraphs analysis-correct, with judge', '(a) paragraphs local-only analysis AND meaning kept', '(b) paragraphs analysis AND meaning kept, with judges', 'meaning kept (b)', 'text unchanged', 'same analysis as the input', 'pronouns kept', 'clean sentences changed (text scorer)', 'bad sentences fixed to the expected wording (text scorer)', 'runaway', 'sentence count equals expected'], rows);
  }
}
// paired bootstrap on composed cases (it2 minus it1, per-sentence)
{
  const rows = [];
  for (const kind of ['K2', 'K3', 'K5']) for (const mode of ['sentence', 'paragraph']) {
    const a = CA('it2', kind, mode), b = CA('it1', kind, mode), c = CA('identity', kind, mode);
    if (!a || !b) continue;
    const metric = r => r.out_sentences ? r.out_sentences_pass / r.out_sentences : 0;
    const dd = (A, B, m) => { const Bm = new Map(B.records.map(r => [r.id, r])); const cl = A.records.filter(r => Bm.has(r.id)).map(r => [[m(r), m(Bm.get(r.id))]]); const ci = bootstrap(cl); const delta = cl.reduce((s, x) => s + x[0][0] - x[0][1], 0) / cl.length; return `${delta >= 0 ? '+' : ''}${round(delta * 100)} pp [${round(-ci[1] * 100)}, ${round(-ci[0] * 100)}]`; };
    rows.push([kind, mode, dd(a, b, metric), c ? dd(a, c, metric) : 'n/a', dd(a, b, r => Number(r.same_analysis && r.unchanged)), c ? dd(a, c, r => Number(r.same_analysis && r.unchanged)) : 'n/a']);
  }
  h(3, 'Paired bootstrap over cases, iteration 2 minus iteration 1 / minus no rewrite');
  table(['suite', 'mode', 'share of output sentences analysis-correct, it2 - it1', 'it2 - no rewrite', 'text and analysis unchanged, it2 - it1', 'it2 - no rewrite'], rows);
}
// K6
{
  h(3, 'K6 decomposition (16 cases: one tangled message that must become several short sentences)');
  const rows = [];
  for (const [a, name] of ARMS) for (const [suffix, mode] of [['-sent', 'per sentence, all sent'], ['', 'whole message']]) {
    const f = path.join(WORK, 'composed', `${a}${suffix}__K6-neuro_english.summary.json`), an = CA(`${a}${suffix}`, 'K6', 'whole', 'neuro_english');
    if (!fs.existsSync(f) || !an) continue;
    const t = readJson(f).stages.at(-1), s = an.summary;
    rows.push([`${name}, ${mode}`, pc(t.changed), pc(t.output_sentence_count_matches.all), pc(t.output_at_least_expected_sentences), pc(t.every_sentence_within_contract.all), pc(s.output_one_clause_sentences), pc(s.output_explicit_subject_sentences), pc(s.output_analysis_correct), pc(s.output_analysis_correct_and_meaning_ok), pc(t.preserved.names)]);
  }
  table(['arm and mode', 'output changed', 'sentence count equals expected', 'sentence count at least expected', 'every sentence within the contract (one clause, explicit subject)', 'one-clause output sentences', 'explicit-subject output sentences', 'all output sentences analysis-correct (paragraph)', '... AND meaning kept', 'names preserved'], rows);
}

fs.writeFileSync(path.join(WORK, out), lines.join('\n') + '\n');
fs.writeFileSync(path.join(WORK, 'numbers.json'), JSON.stringify(numbers, null, 1) + '\n');
console.log(`wrote ${path.join(WORK, out)} (${lines.length} lines)`);
