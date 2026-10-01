#!/usr/bin/env node
/** Tables of the SymbolicLM rewrite-pipeline evaluation (experiment eval-symbolic-pipeline-gate-v1) from the score files only.
 *   SYMPROOF_WORK=eval/reports/current/symbolic-pipeline-gate node tools/eval/symbolic-pipeline-gate-report.mjs [--arms a,b,c]
 * Pair sets come from scores/<arm>__<split>.json (tools/eval/symbolic-proofing-eval.mjs score), composed kinds from composed/analysis__*.json. No model is called. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';

const WORK = path.join(ROOT, process.env.SYMPROOF_WORK ?? 'eval/reports/current/symbolic-pipeline-gate');
const argv = process.argv.slice(2), armsArg = argv.includes('--arms') ? argv[argv.indexOf('--arms') + 1].split(',') : null;
const readJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const pc = x => (x && x.n ? `${x.p}% (${x.k}/${x.n})` : 'n/a');
const arms = armsArg ?? fs.readdirSync(path.join(WORK, 'scores')).filter(f => f.endsWith('__test.json')).map(f => f.split('__')[0]);
const order = a => (a === 'identity' ? '0' : a);
arms.sort((a, b) => order(a).localeCompare(order(b)));
const rows = [];
for (const arm of arms) {
  const t = readJson(path.join(WORK, 'scores', `${arm}__test.json`))?.summary, s = readJson(path.join(WORK, 'scores', `${arm}__sym500.json`))?.summary;
  if (!t) continue;
  const r = t.primary_repair, i = t.primary_identity, y = s?.primary_identity;
  rows.push([arm === 'identity' ? 'no rewrite' : arm, pc(r.output_analysis_correct_and_meaning_local), pc(r.output_analysis_correct_and_meaning_ok), pc(r.fixed_of_failing_inputs), pc(i.analysis_changed_or_text_changed), pc(y?.analysis_changed_or_text_changed), pc(y?.working_no_longer_analysis_correct), pc(r.meaning_judge_needed)]);
}
console.log('| arm | repair good, local only | repair good, with judges (pending count as not good) | fixed of failing inputs (with judges) | identity pairs changed | sym500 changed | sym500 working no longer analysis-correct | repair outputs needing the meaning judge |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);

// ------------------------------------------------------------------ composed suites (sentence mode)
const composed = (arm, kind, ds = '') => readJson(path.join(WORK, 'composed', `analysis__${arm}${kind === 'K6' ? '-sent' : ''}__${kind}${ds}__${kind === 'K6' ? 'whole' : 'sentence'}.json`))?.summary;
const text = (arm, kind) => readJson(path.join(WORK, 'composed', `${arm}${kind === 'K6' ? '-sent' : ''}__${kind}${kind === 'K6' ? '-neuro_english' : '__sentence'}.summary.json`))?.stages?.at(-1);
console.log('\n| arm | K2 sentences analysis-correct, local | K2 same, with judges (pending not good) | K2 clean sentences changed | K2 bad sentences fixed to the expected wording | K3 paragraphs untouched | K3 sentences analysis-correct, local | K5 pronouns kept | K6 sentence count reached | K6 changed |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const arm of arms) {
  const k2 = composed(arm, 'K2'), k3 = composed(arm, 'K3'), k5 = composed(arm, 'K5'), k6 = composed(arm, 'K6', '-neuro_english'), t2 = text(arm, 'K2'), t6 = text(arm, 'K6');
  if (!k2) continue;
  console.log(`| ${arm === 'identity' ? 'no rewrite' : arm} | ${pc(k2.sentences_correct_out_local)} | ${pc(k2.sentences_correct_out)} | ${pc(t2?.clean_sentences_changed)} | ${pc(t2?.bad_sentences_fixed)} | ${pc(k3?.text_unchanged)} | ${pc(k3?.sentences_correct_out_local)} | ${pc(k5?.pronouns_kept)} | ${pc(k6?.sentence_count_equals_expected)} | ${pc(t6?.changed)} |`);
}

// ------------------------------------------------------------------ paired differences on the sealed repair pairs and meaning kept
import {bootstrap} from '../research/proofing.mjs';
const records = (arm, split) => readJson(path.join(WORK, 'scores', `${arm}__${split}.json`))?.records ?? [];
const diff = (a, b, kind, metric) => {
  const B = new Map(records(b, 'test').map(r => [r.id, r])), clusters = [];
  for (const r of records(a, 'test')) { const o = B.get(r.id); if (o && r.kind === kind) clusters.push([[Number(metric(r)), Number(metric(o))]]); }
  const ci = bootstrap(clusters), delta = clusters.reduce((s, c) => s + c[0][0] - c[0][1], 0) / clusters.length;
  const f = x => Math.round(x * 1000) / 10;
  return `${delta >= 0 ? '+' : ''}${f(delta)} pp [${f(-ci[1])}, ${f(-ci[0])}] (n ${clusters.length})`;
};
console.log('\n| a minus b | repair good, local only | repair good, with judges | repair meaning kept |');
console.log('| --- | --- | --- | --- |');
for (const [a, b] of [['it2-g1-a', 'identity'], ['it2-g1-n', 'identity'], ['it2-g2-a', 'identity'], ['it1-g1-a', 'identity'], ['it2-g1-a', 'it1-g1-a'], ['it2-g1-a', 'it2-g3-n'], ['it2-g1-n', 'it2-g3-n'], ['it2-g1-n', 'it2-g1-a']]) {
  if (!records(a, 'test').length || !records(b, 'test').length) continue;
  console.log(`| ${a} minus ${b} | ${diff(a, b, 'repair', r => r.analysis.local_good)} | ${diff(a, b, 'repair', r => r.analysis.good)} | ${diff(a, b, 'repair', r => r.analysis.meaning_kept)} |`);
}
console.log('\n| arm | repair meaning kept (hard checks and local or judge) | repair meaning kept, mechanical only fails | statement turned into question | pronoun dropped |');
console.log('| --- | --- | --- | --- | --- |');
for (const arm of arms) {
  const t = readJson(path.join(WORK, 'scores', `${arm}__test.json`))?.summary?.primary_repair;
  if (t) console.log(`| ${arm === 'identity' ? 'no rewrite' : arm} | ${pc(t.output_meaning_kept)} | ${pc(t.output_meaning_ok_mechanical)} | ${pc(t.output_statement_to_question)} | ${pc(t.output_pronoun_dropped)} |`);
}
