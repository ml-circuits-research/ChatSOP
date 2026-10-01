#!/usr/bin/env node
/**
 * Validation of the analysis-compare metric (preregistration status/preregistrations/eval-analysis-compare-v1.json).
 *   node tools/eval/analysis-compare-validate.mjs [--out eval/reports/current/analysis-compare/validation] [--min-f1 0.6] [--synonyms uncertain|accept]
 * Reads the pair files of eval/reports/current/analysis-compare/pairs-*.jsonl (built from the calibration v2 set, the backgen and
 * the bad_english judged pairs), gets every analysis from the parse cache (tools/eval/analysis-compare-parses.mjs; parses the rest
 * on the CPU), scores the metric against the labels and the two-vote LLM verdicts, and writes verdicts and summary.json/summary.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {compareAnalyses, defaultSynonyms} from '../../lib/languages-util/analysis-compare.mjs';
import {parseTexts} from './analysis-compare-parses.mjs';
import {loadSpellfix} from '../../lib/languages-util/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
const DIR = path.join(ROOT, 'eval/reports/current/analysis-compare');
const OUT = path.resolve(ROOT, args.out ?? 'eval/reports/current/analysis-compare/validation');
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
export const MECHANICAL = ['flip_negation', 'replace_name', 'swap_names', 'change_number_date', 'change_quantifier', 'change_question_type'];

export function wilson(k, n, z = 1.96) {
  if (!n) return {k, n, p: null, lo: null, hi: null};
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return {k, n, p: +p.toFixed(4), lo: +((c - m) / d).toFixed(4), hi: +((c + m) / d).toFixed(4)};
}
const pct = w => (w.p === null ? 'n/a' : `${(w.p * 100).toFixed(1)}% [${(w.lo * 100).toFixed(1)}, ${(w.hi * 100).toFixed(1)}] (${w.k}/${w.n})`);

function loadItems() {
  const adj = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/reports/current/meaning-judge/v2/adjudication.json'), 'utf8'));
  const items = [];
  for (const r of rd(path.join(DIR, 'pairs-calibration.jsonl'))) {
    const n = Number(r.id.replace('mj-', ''));
    const base = {set: 'calibration', id: r.id, type: r.type, label: r.label === 'same' ? 'same' : 'different', half: n % 2 ? 'tune' : 'test', noise: Boolean(adj.noise?.[r.id]), votes: r.m1 + r.m2, source: r.source};
    items.push({...base, view: 'A', a: r.a, b: r.b});
    if (r.a_clean) items.push({...base, view: 'B', a: r.a_clean, b: r.b});
  }
  for (const r of rd(path.join(DIR, 'pairs-backgen.jsonl'))) items.push({set: 'backgen', id: r.id, type: 'judged', label: null, view: 'A', half: 'test', votes: r.m1 + r.m2, a: r.a, b: r.b});
  for (const r of rd(path.join(DIR, 'pairs-badenglish.jsonl'))) items.push({set: 'bad_english', id: r.id, type: 'judged', label: null, view: 'A', half: 'test', votes: r.m1 + r.m2, a: r.a, b: r.b});
  for (const i of items) i.k = pairKey(i.a, i.b);
  const spell = loadSpellfix();
  for (const i of items) { const f = spell.fix(i.a); i.typo_free = !f.changes.length && !f.skipped; }
  return items;
}

export const pairKey = (a, b) => crypto.createHash('sha1').update(`${a}\u0001${b}`).digest('hex').slice(0, 16);
const tally = (rows, pred) => rows.filter(pred);
function verdictTable(rows) {
  const n = rows.length, c = v => rows.filter(r => r.verdict === v).length;
  return {n, equivalent: c('equivalent'), different: c('different'), uncertain: c('uncertain')};
}

export function summarise(rows) {
  const out = {};
  const cal = rows.filter(r => r.set === 'calibration' && !r.noise);
  for (const half of ['tune', 'test', 'all']) {
    const hs = cal.filter(r => half === 'all' || r.half === half);
    const s = {};
    for (const view of ['A', 'B', 'C']) {
      // A: as labelled. B: the mechanical negatives start from the clean text they were built from. C: B, and only the positives whose input has no typo the symbolic spelling corrector finds (clean text against clean text).
      const ids = [...new Set(hs.map(r => r.id))];
      const vr = ids.map(id => { const rs = hs.filter(r => r.id === id); return view === 'A' ? rs.find(r => r.view === 'A') : rs.find(r => r.view === 'B') ?? rs.find(r => r.view === 'A'); }).filter(r => r && (view !== 'C' || r.label !== 'same' || r.typo_free));
      const positives = vr.filter(r => r.label === 'same'), negatives = vr.filter(r => r.label === 'different');
      const mech = negatives.filter(r => MECHANICAL.includes(r.type)), hard = negatives.filter(r => r.type.startsWith('hard')), other = negatives.filter(r => !MECHANICAL.includes(r.type) && !r.type.startsWith('hard'));
      const byType = {};
      for (const t of [...new Set(negatives.map(r => r.type))].sort()) {
        const rs = negatives.filter(r => r.type === t);
        byType[t] = {n: rs.length, different: wilson(rs.filter(r => r.verdict === 'different').length, rs.length), uncertain: rs.filter(r => r.verdict === 'uncertain').length, equivalent: rs.filter(r => r.verdict === 'equivalent').length};
      }
      const eq = vr.filter(r => r.verdict === 'equivalent'), df = vr.filter(r => r.verdict === 'different');
      s[view] = {
        positives: {...verdictTable(positives), false_alarm: wilson(positives.filter(r => r.verdict === 'different').length, positives.length), equivalent_rate: wilson(eq.filter(r => r.label === 'same').length, positives.length), uncertain_rate: wilson(positives.filter(r => r.verdict === 'uncertain').length, positives.length)},
        mechanical: {n: mech.length, recall_different: wilson(mech.filter(r => r.verdict === 'different').length, mech.length), uncertain: mech.filter(r => r.verdict === 'uncertain').length, equivalent: mech.filter(r => r.verdict === 'equivalent').length},
        other_mechanical: {n: other.length, recall_different: wilson(other.filter(r => r.verdict === 'different').length, other.length)},
        hard: {n: hard.length, recall_different: wilson(hard.filter(r => r.verdict === 'different').length, hard.length)},
        equivalent_precision: wilson(eq.filter(r => r.label === 'same').length, eq.length),
        different_precision: wilson(df.filter(r => r.label === 'different').length, df.length),
        uncertain_rate: wilson(vr.filter(r => r.verdict === 'uncertain').length, vr.length),
        by_type: byType,
      };
    }
    out[half] = s;
  }
  for (const set of ['backgen', 'bad_english']) {
    for (const subset of ['all', 'typo_free']) {
    const rs = rows.filter(r => r.set === set && (r.votes === 'yesyes' || r.votes === 'nono') && (subset === 'all' || r.typo_free));
    const yes = rs.filter(r => r.votes === 'yesyes'), no = rs.filter(r => r.votes === 'nono');
    const eq = rs.filter(r => r.verdict === 'equivalent'), df = rs.filter(r => r.verdict === 'different');
    out[subset === 'all' ? set : `${set}_typo_free`] = {
      decisive_pairs: rs.length, both_yes: yes.length, both_no: no.length, table_yes: verdictTable(yes), table_no: verdictTable(no),
      equivalent_precision_vs_judge: wilson(eq.filter(r => r.votes === 'yesyes').length, eq.length),
      different_precision_vs_judge: wilson(df.filter(r => r.votes === 'nono').length, df.length),
      skip_rate_of_both_yes: wilson(yes.filter(r => r.verdict === 'equivalent').length, yes.length),
      different_recall_of_both_no: wilson(no.filter(r => r.verdict === 'different').length, no.length),
      agreement_decisive: wilson(rs.filter(r => (r.verdict === 'equivalent' && r.votes === 'yesyes') || (r.verdict === 'different' && r.votes === 'nono')).length, rs.filter(r => r.verdict !== 'uncertain').length),
      uncertain_rate: wilson(rs.filter(r => r.verdict === 'uncertain').length, rs.length),
    };
    }
  }
  return out;
}

export async function main() {
  fs.mkdirSync(OUT, {recursive: true});
  let items = loadItems();
  if (args['export-pairs']) {
    const dir = path.join(DIR, 'semsim'); fs.mkdirSync(dir, {recursive: true});
    const seen = new Map(items.map(i => [i.k, {k: i.k, a: i.a, b: i.b}]));
    fs.writeFileSync(path.join(dir, 'pairs.jsonl'), [...seen.values()].map(r => JSON.stringify(r)).join('\n') + '\n');
    console.log('exported', seen.size, 'unique pairs');
    return;
  }
  if (args.blind) items = items.filter(i => i.set === 'calibration' && i.half === 'tune'); // development mode: the test half and the other sets stay unseen
  const analyses = await parseTexts(items.flatMap(i => [i.a, i.b]), {});
  const options = {minTripleF1: Number(args['min-f1'] ?? 0.6), synonymPolicy: args.synonyms ?? 'uncertain', synonyms: defaultSynonyms()};
  const t0 = performance.now();
  const rows = items.map(i => {
    const r = compareAnalyses(analyses.get(i.a), analyses.get(i.b), {...options, textA: i.a, textB: i.b});
    return {...i, verdict: r.verdict, reasons: r.reasons, failed: r.failedChecks ?? [], f1: r.tripleF1 ? +r.tripleF1Synonym.f1.toFixed(3) : null, voice: r.voiceChange};
  });
  const ms = performance.now() - t0;
  fs.writeFileSync(path.join(OUT, args.blind ? 'verdicts-tune-dev.jsonl' : 'verdicts.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const summary = {generated_at: new Date().toISOString(), options: {...options, synonyms: 'wordnet+dictionary'}, parse: analyses.stats, compare_ms_per_pair: +(ms / rows.length).toFixed(3), pairs: rows.length, ...summarise(rows)};
  fs.writeFileSync(path.join(OUT, args.blind ? 'summary-tune-dev.json' : 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  const lines = [`# analysis-compare validation`, '', `options ${JSON.stringify({minTripleF1: options.minTripleF1, synonymPolicy: options.synonymPolicy})}; compare time ${summary.compare_ms_per_pair} ms/pair (parsing excluded)`, ''];
  for (const half of args.blind ? ['tune'] : ['tune', 'test', 'all']) for (const view of ['A', 'B', 'C']) {
    const s = summary[half][view];
    lines.push(`## calibration ${half} view ${view}`, `- mechanical recall of different: ${pct(s.mechanical.recall_different)}`, `- false alarm on positives: ${pct(s.positives.false_alarm)}; equivalent on positives ${pct(s.positives.equivalent_rate)}; uncertain ${pct(s.positives.uncertain_rate)}`, `- equivalent precision: ${pct(s.equivalent_precision)}; different precision: ${pct(s.different_precision)}`, `- per type different: ${Object.entries(s.by_type).map(([t, v]) => `${t} ${v.different.k}/${v.n}`).join(', ')}`, '');
  }
  for (const set of args.blind ? [] : ['backgen', 'backgen_typo_free', 'bad_english', 'bad_english_typo_free']) { const s = summary[set]; lines.push(`## ${set} vs the two-vote judge (${s.decisive_pairs} decisive pairs)`, `- equivalent precision vs judge: ${pct(s.equivalent_precision_vs_judge)}; skip rate of both-yes: ${pct(s.skip_rate_of_both_yes)}`, `- different recall of both-no: ${pct(s.different_recall_of_both_no)}; different precision ${pct(s.different_precision_vs_judge)}`, `- agreement on decisive verdicts: ${pct(s.agreement_decisive)}; uncertain ${pct(s.uncertain_rate)}`, ''); }
  if (!args.blind) fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n'));
  console.log(lines.join('\n'));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
