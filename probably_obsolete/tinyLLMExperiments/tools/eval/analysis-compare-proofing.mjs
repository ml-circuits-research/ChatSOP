#!/usr/bin/env node
/**
 * Applies the analysis-compare metric to the scored outputs of a proofing evaluation (DS016 "Analysis comparison", recipe for the proofing evaluations).
 *   node tools/eval/analysis-compare-proofing.mjs --report eval/reports/history/language-proofing-it1 --scores lp-it1__test600,identity__test600,... [--out eval/reports/current/analysis-compare/proofing-it1] [--ref target|input] [--judged lp-it1__test]
 * Each scores file (`<report>/scores/<name>.json`, records {id, input, target, output, chrf, clean_gate, kind}) gives pairs (output, reference): the reference is the target
 * (or the input with `--ref input`, for English inputs). Identical strings are equivalent without a parse; outputs that are not clean English (clean_gate false) are skipped
 * and counted. `--judged <name>` adds the records of that scores file whose (input, output) pair has a two-vote verdict in datasets_sources/language_proofing_meaning_judge
 * and reports the agreement of the metric (output against reference) with the judge (input against output).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {comparePairs} from './analysis-compare.mjs';
import {wilson} from './analysis-compare-validate.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const report = path.resolve(ROOT, args.report ?? 'eval/reports/history/language-proofing-it1');
const OUT = path.resolve(ROOT, args.out ?? 'eval/reports/current/analysis-compare/proofing-it1');
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const pct = w => (w.p === null ? 'n/a' : `${(w.p * 100).toFixed(1)}% [${(w.lo * 100).toFixed(1)}, ${(w.hi * 100).toFixed(1)}] (${w.k}/${w.n})`);
const mean = xs => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : null);

function judgeVotes() {
  const dir = path.join(ROOT, 'datasets_sources/language_proofing_meaning_judge');
  const verdict = new Map(rd(path.join(dir, 'output/verdicts.jsonl')).map(r => [`${r.id}|${r.condition}`, r.answer.preserves]));
  const votes = new Map();
  for (const it of rd(path.join(dir, 'input/items.jsonl'))) {
    const m = /^ORIGINAL: ([\s\S]*?)\n\nREWRITE: ([\s\S]*)$/.exec(it.user);
    if (!m || !['m1', 'm2'].includes(it.condition)) continue;
    const key = `${m[1]}\u0001${m[2]}`;
    const v = votes.get(key) ?? {};
    v[it.condition] = verdict.get(`${it.id}|${it.condition}`);
    votes.set(key, v);
  }
  return votes;
}

export async function main() {
  const names = String(args.scores ?? '').split(',').filter(Boolean);
  if (!names.length) { console.error('usage: --report <dir> --scores name1,name2 [--judged name]'); process.exit(2); }
  const votes = args.judged ? judgeVotes() : new Map();
  const jobs = [];
  const seen = new Set();
  for (const name of [...names, ...(args.judged ? [args.judged] : [])]) {
    const records = JSON.parse(fs.readFileSync(path.join(report, 'scores', `${name}.json`), 'utf8')).records;
    for (const r of records) {
      const ref = args.ref === 'input' ? r.input : r.target;
      if (ref == null || !r.output) continue;
      const judged = votes.get(`${r.input}\u0001${r.output}`);
      if (name === args.judged && !judged) continue;
      const key = `${name}|${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({arm: name, id: key, a: r.output, b: ref, chrf: r.chrf ?? null, kind: r.kind, clean: r.clean_gate !== false, exact: r.output === ref, judge: judged ? (judged.m1 === 'yes' && judged.m2 === 'yes' ? 'yes' : judged.m1 === 'no' && judged.m2 === 'no' ? 'no' : 'split') : null});
    }
  }
  const usable = jobs.filter(j => j.clean);
  const verdicts = await comparePairs(usable.map(j => ({id: j.id, a: j.a, b: j.b})));
  const byId = new Map(verdicts.map(v => [v.id, v]));
  const rows = usable.map(j => ({...j, verdict: byId.get(j.id).verdict, reasons: byId.get(j.id).reasons, failed: byId.get(j.id).failedChecks}));
  fs.mkdirSync(OUT, {recursive: true});
  fs.writeFileSync(path.join(OUT, 'verdicts.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const summary = {generated_at: new Date().toISOString(), report: path.relative(ROOT, report), reference: args.ref ?? 'target', arms: {}};
  const lines = ['# analysis-compare on proofing outputs', '', `reference: ${summary.reference}; identical text counts as equivalent; outputs that fail the clean-English gate are skipped`, '', '| arm | pairs | skipped (not clean English) | identical | equivalent (non-identical) | different | uncertain | LLM judge needed | chrF equivalent / different / uncertain |', '|---|---|---|---|---|---|---|---|---|'];
  for (const arm of [...new Set(jobs.map(j => j.arm))]) {
    const all = jobs.filter(j => j.arm === arm), rs = rows.filter(r => r.arm === arm);
    const c = v => rs.filter(r => r.verdict === v && !r.exact).length;
    const exact = rs.filter(r => r.exact).length;
    const judgeNeeded = rs.filter(r => r.verdict !== 'equivalent').length;
    const chrf = v => mean(rs.filter(r => r.verdict === v && !r.exact && r.chrf !== null).map(r => r.chrf));
    summary.arms[arm] = {pairs: all.length, skipped: all.length - rs.length, identical: exact, equivalent: c('equivalent'), different: c('different'), uncertain: c('uncertain'), judge_needed: judgeNeeded, chrf: {equivalent: chrf('equivalent'), different: chrf('different'), uncertain: chrf('uncertain')}};
    lines.push(`| ${arm} | ${all.length} | ${all.length - rs.length} | ${exact} | ${c('equivalent')} | ${c('different')} | ${c('uncertain')} | ${judgeNeeded} (${(100 * judgeNeeded / Math.max(1, rs.length)).toFixed(1)}%) | ${chrf('equivalent')} / ${chrf('different')} / ${chrf('uncertain')} |`);
  }
  if (args.judged) {
    const js = rows.filter(r => r.arm === args.judged && (r.judge === 'yes' || r.judge === 'no'));
    const nonExact = js.filter(r => !r.exact);
    const agree = {judged_pairs: js.length, non_identical: nonExact.length, equivalent_precision: wilson(nonExact.filter(r => r.verdict === 'equivalent' && r.judge === 'yes').length, nonExact.filter(r => r.verdict === 'equivalent').length), skip_of_judge_yes: wilson(nonExact.filter(r => r.verdict === 'equivalent' && r.judge === 'yes').length, nonExact.filter(r => r.judge === 'yes').length), different_precision: wilson(nonExact.filter(r => r.verdict === 'different' && r.judge === 'no').length, nonExact.filter(r => r.verdict === 'different').length), different_recall_of_judge_no: wilson(nonExact.filter(r => r.verdict === 'different' && r.judge === 'no').length, nonExact.filter(r => r.judge === 'no').length), uncertain: wilson(nonExact.filter(r => r.verdict === 'uncertain').length, nonExact.length)};
    summary.judge_agreement = agree;
    lines.push('', `## agreement with the two-vote meaning judge (${args.judged}; metric on output vs reference, judge on input vs output; identical outputs excluded)`, '', `- judged, decisive (both yes or both no), output differs from the reference: ${nonExact.length}`, `- equivalent precision vs judge: ${pct(agree.equivalent_precision)}; skip share of judge-yes: ${pct(agree.skip_of_judge_yes)}`, `- different precision vs judge: ${pct(agree.different_precision)}; different recall of judge-no: ${pct(agree.different_recall_of_judge_no)}; uncertain: ${pct(agree.uncertain)}`);
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
