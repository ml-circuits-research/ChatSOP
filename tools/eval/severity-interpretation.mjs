#!/usr/bin/env node
/**
 * Graded severity of the SymbolicLM final interpretation (DS016 "Graded severity", Task B): message -> SOP against the gold SOP of the sealed tests.
 *   node tools/eval/severity-interpretation.mjs [--sets symbolic_english,neuro_english]
 * SOP under test: the `sop` stored in each sealed row (SymbolicLM ud-rules-v2.5 with the Stanza accurate package; the row's `sop_layer` is the strict execution-equivalence verdict of the same SOP).
 * Row grade: strict `match` is S0 (the existing oracle); a mismatch is graded by lib/severity/sop-compare.mjs; a row SymbolicLM did not handle is NONE;
 * a handled row without gold SOP cannot be graded against gold (reported as `no_gold`, never counted as good or bad).
 * Output: eval/reports/current/severity/interpretation/<set>.graded.jsonl and interpretation.md / summary.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {SEV_DIR} from './severity-calibration.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {sopSeverity, SOP_COMPARE_VERSION} from '../../lib/severity/sop-compare.mjs';
import {distributionStats, fmt, wilson} from '../../lib/severity/metrics.mjs';
import {SEVERITIES, isGoodEnough} from '../../lib/severity/scale.mjs';

export const OUT = path.join(SEV_DIR, 'interpretation');
export function gradeRow(row) {
  const layer = row.sop_layer ?? {};
  if (layer.status === 'match') return {severity: 'S0', basis: 'strict_match', findings: []};
  if (row.gold_sop) {
    const r = sopSeverity(row.sop, row.gold_sop, {message: row.message, outcome: row.outcome});
    return {severity: r.severity, basis: 'sop_compare', findings: r.findings};
  }
  // no gold SOP: a handled row cannot be graded; an unhandled one is reported separately (the clear reading is unknown)
  if (layer.handled === false || (['nothing_formalized', 'crash'].includes(row.outcome) && !row.sop?.trim())) return {severity: null, basis: 'no_gold_not_handled', findings: [{kind: 'not_handled', detail: layer.failure?.reason ?? row.outcome}]};
  return {severity: null, basis: 'no_gold', findings: []};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sets = (process.argv[process.argv.indexOf('--sets') + 1]?.startsWith('--') || process.argv.indexOf('--sets') < 0 ? 'symbolic_english,neuro_english' : process.argv[process.argv.indexOf('--sets') + 1]).split(',');
  fs.mkdirSync(OUT, {recursive: true});
  const summary = {generated_at: new Date().toISOString(), compare_version: SOP_COMPARE_VERSION, sets: {}};
  const md = ['# Graded severity of the SymbolicLM interpretation (sealed tests, message -> SOP against gold)', '', `SOP under test: the stored SymbolicLM output of each sealed row (ud-rules-v2.5, Stanza accurate). Strict match with the gold SOP is S0; a mismatch is graded by lib/severity/sop-compare.mjs (${SOP_COMPARE_VERSION}); not handled is NONE; handled rows without gold SOP are not graded.`, ''];
  for (const set of sets) {
    const rows = readJsonlShardedSync(path.join(ROOT, `eval/suites/${set}/test.jsonl`));
    const graded = rows.map(r => ({id: r.id, message: r.message, ...gradeRow(r), strict: r.sop_layer?.status ?? null, failure_kind: r.failure_kind ?? null, uncertain: r.uncertain, sop: r.sop, gold_sop: r.gold_sop ?? null}));
    fs.writeFileSync(path.join(OUT, `${set}.graded.jsonl`), graded.map(g => JSON.stringify(g)).join('\n') + '\n');
    const withGold = graded.filter(g => g.severity), noGold = graded.filter(g => !g.severity);
    const all = distributionStats(withGold.map(g => g.severity));
    const bySub = {};
    for (const key of ['failure_kind']) for (const v of new Set(graded.map(g => g[key] ?? 'none'))) { const sub = withGold.filter(g => (g[key] ?? 'none') === v); if (sub.length >= 10) bySub[`${key}=${v}`] = distributionStats(sub.map(g => g.severity)); }
    const nonStrict = withGold.filter(g => g.basis !== 'strict_match');
    summary.sets[set] = {rows: rows.length, graded: withGold.length, no_gold: noGold.length, overall: all, by_failure_kind: bySub, mismatch_only: distributionStats(nonStrict.map(g => g.severity)), examples: Object.fromEntries(SEVERITIES.map(s => [s, withGold.filter(g => g.severity === s && g.basis !== 'strict_match').slice(0, 10).map(g => ({id: g.id, message: g.message.slice(0, 220), findings: g.findings.slice(0, 4)}))]))};
    const c = all.counts;
    md.push(`## ${set}`, '', `${rows.length} sealed rows; ${withGold.length} graded against gold (strict match ${graded.filter(g => g.basis === 'strict_match').length}, compared ${graded.filter(g => g.basis === 'sop_compare').length}); ${noGold.length} rows have no gold SOP and are not graded, of which ${graded.filter(g => g.basis === 'no_gold_not_handled').length} were not handled by SymbolicLM (no interpretation, but the clear reading is unknown, so they are not counted as NONE here).`, '', '| S0 | S1 | S2 | S3 | S4 | NONE | good enough (S0-S2) | catastrophic S4 | NONE rate |', '| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |', `| ${c.S0} | ${c.S1} | ${c.S2} | ${c.S3} | ${c.S4} | ${c.NONE} | ${fmt(all.good_enough)} | ${fmt(all.catastrophic)} | ${fmt(all.none)} |`, '');
    const m = summary.sets[set].mismatch_only;
    md.push(`Among the ${nonStrict.length} rows that are not a strict match: S1 ${m.counts.S1}, S2 ${m.counts.S2}, S3 ${m.counts.S3}, S4 ${m.counts.S4}, NONE ${m.counts.NONE}; good enough ${fmt(m.good_enough)}.`, '');
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'interpretation.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}
