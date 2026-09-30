#!/usr/bin/env node
/** Tables of the formalizer size study as Markdown, from eval/reports/current/formalizer-size-v1/summary.json.
 *
 * Writes the generated tables to stdout; eval/reports/current/training/formalizer-size-v1-summary.md combines them
 * with the written conclusions. A cell without a finished report reads "pending" (never an estimate).
 *
 *   node tools/research/summarize-size-study.mjs --models smollm2-135m,gemma --run fv1-size-a4
 *   node tools/research/write-size-summary.mjs > tables.md
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'eval/reports/current/formalizer-size-v1');
const summary = JSON.parse(fs.readFileSync(path.join(base, 'summary.json'), 'utf8'));
const pct = f => (f && f.denominator ? `${(100 * f.value).toFixed(1)}% (${f.numerator}/${f.denominator})` : 'pending');
const rate = (v, n) => (typeof v === 'number' ? `${(100 * v).toFixed(1)}%${n ? ` of ${n}` : ''}` : 'pending');
const models = Object.keys(summary.arms);
const lines = [];
const table = (header, rows) => { lines.push(`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`), ''); };

lines.push('### Sealed in-distribution test `formalizer-v1` (Q8_0 on CPU, message-only input)', '');
table(['Model', 'Rows', 'Parse', 'Canonical', 'Strict exec.', 'Tolerant exec.', 'EN', 'RO', 'Mixed', 'Hard slice', 'Not hard'], models.map(m => {
  const s = summary.arms[m].suites['formalizer-v1'].q8_0;
  if (!s) return [m, 'pending', '', '', '', '', '', '', '', '', ''];
  const lang = s.slices.language, hard = s.slices.hard;
  return [m, s.rows, pct(s.formalizer.parse_rate), pct(s.formalizer.canonical_ast_match), pct(s.formalizer.execution_equivalence), pct(s.formalizer.execution_equivalence_tolerant),
    pct(lang.en?.execution_equivalence_tolerant), pct(lang.ro?.execution_equivalence_tolerant), pct(lang.mixed?.execution_equivalence_tolerant), pct(hard.hard?.execution_equivalence_tolerant), pct(hard.not_hard?.execution_equivalence_tolerant)];
}));
lines.push('Hard reasons (tolerant execution equivalence): ', '');
table(['Model', 'long', 'multi_statement', 'code_switched', 'high_noise'], models.map(m => {
  const s = summary.arms[m].suites['formalizer-v1'].q8_0;
  return [m, ...['long', 'multi_statement', 'code_switched', 'high_noise'].map(k => pct(s?.slices.hard_reason[k]?.execution_equivalence_tolerant))];
}));
lines.push('### Out-of-distribution `formalizer-ood-v1` and independent `formalizer-wild-v1` (Q8_0)', '');
table(['Model', 'OOD parse', 'OOD tolerant exec.', 'OOD EN', 'OOD RO', 'OOD mixed', 'Wild parsed', 'Wild accepted match', 'Wild decision match', 'Wild shape match', 'Wild prop. F1', 'Wild EN / RO / mixed accepted'], models.map(m => {
  const o = summary.arms[m].suites['formalizer-ood-v1'].q8_0, w = summary.arms[m].suites['formalizer-wild-v1'].q8_0.accepted;
  const lang = o?.slices.language ?? {};
  return [m, pct(o?.formalizer.parse_rate), pct(o?.formalizer.execution_equivalence_tolerant), pct(lang.en?.execution_equivalence_tolerant), pct(lang.ro?.execution_equivalence_tolerant), pct(lang.mixed?.execution_equivalence_tolerant),
    rate(w?.overall.parsed), rate(w?.overall.accepted_match, w?.overall.rows), rate(w?.overall.decision_match), rate(w?.overall.shape_match), w ? w.overall.proposition_f1.toFixed(3) : 'pending',
    w ? ['en', 'ro', 'mixed'].map(k => rate(w.by_language[k]?.accepted_match, w.by_language[k]?.rows)).join(' / ') : 'pending'];
}));
lines.push('Wild reference-free metrics (no gold needed):', '');
table(['Model', 'parse', 'compile', 'contract vocabulary', 'stated value anchoring', 'rows fully anchored', 'polarity agreement', 'unsupported negation', 'question form agreement'], models.map(m => {
  const r = summary.arms[m].suites['formalizer-wild-v1'].q8_0.reference_free;
  const v = k => (r ? (r[k]?.value ?? r[k]) : null);
  return [m, ...['parse_validity', 'compile_validity', 'contract_vocabulary', 'stated_value_anchoring', 'rows_fully_anchored', 'polarity_agreement', 'unsupported_negation', 'question_form_agreement'].map(k => (typeof v(k) === 'number' ? v(k).toFixed(3) : 'pending'))];
}));
lines.push('### Quantization (tolerant execution equivalence, Q8_0 versus Q4_K_M)', '');
table(['Model', 'v1 Q8_0', 'v1 Q4_K_M', 'OOD Q8_0', 'OOD Q4_K_M', 'v1 Q8−Q4 (95% paired CI)'], models.map(m => {
  const a = summary.arms[m], q = a['quantization_formalizer-v1']?.q8_minus_q4;
  return [m, pct(a.suites['formalizer-v1'].q8_0?.formalizer.execution_equivalence_tolerant), pct(a.suites['formalizer-v1'].q4_k_m?.formalizer.execution_equivalence_tolerant),
    pct(a.suites['formalizer-ood-v1'].q8_0?.formalizer.execution_equivalence_tolerant), pct(a.suites['formalizer-ood-v1'].q4_k_m?.formalizer.execution_equivalence_tolerant),
    q ? `${(100 * q.difference).toFixed(1)} pp (${q.ci95.map(x => (100 * x).toFixed(1)).join('..')})` : 'pending'];
}));
lines.push('### CPU speed (llama.cpp, GPU hidden; 10x Cortex-X925 + 10x Cortex-A725)', '');
table(['Model', 'Quant', 'tg128 t=1', 'tg128 t=4', 'tg128 t=10', 'pp512 t=10', 'Latency p50 / p95 per message (t=4, 1 slot)', 'Latency p50 / p95 (t=10)', 'Server gen. tok/s p50 (t=10)'], models.flatMap(m => ['q8_0', 'q4_k_m'].map(q => {
  const c = summary.arms[m].cpu, b = c[q] ?? [];
  const tg = t => b.find(r => r.test === 'tg128' && r.threads === t)?.tokens_per_second ?? 'pending';
  const lat = t => { const l = c[`${q}_latency_t${t}`]; return l ? `${(l.latency_ms.p50 / 1000).toFixed(2)} s / ${(l.latency_ms.p95 / 1000).toFixed(2)} s` : 'pending'; };
  const gen = c[`${q}_latency_t10`]?.generation_tokens_per_second?.p50;
  return [m, q, tg(1), tg(4), tg(10), b.find(r => r.test === 'pp512' && r.threads === 10)?.tokens_per_second ?? 'pending', lat(4), lat(10), gen ? gen.toFixed(0) : 'pending'];
})));
lines.push('### Preregistered adequacy gate', '');
table(['Model', 'parse ≥99%', 'EN ≥90%', 'RO ≥90%', 'OOD ≥70%', 'Adequate'], models.map(m => {
  const g = summary.arms[m].adequacy;
  return [m, ...(g.gates ? ['parse_rate_ge_99', 'tolerant_en_ge_90', 'tolerant_ro_ge_90', 'ood_tolerant_ge_70'].map(k => (g.gates[k] ? 'pass' : 'fail')) : ['pending', 'pending', 'pending', 'pending']), g.adequate === null ? 'pending' : g.adequate ? 'yes' : 'no'];
}));
lines.push('EN and RO in the gate use the row `language` field (a code-switched row counts in its base language); the tables above also show the separate `mixed` slice.', '');
if (summary.comparisons.length) {
  lines.push('### Between-arm differences (tolerant execution equivalence, Q8_0, 95% paired bootstrap over split groups)', '');
  table(['Suite', 'Difference', 'Value', '95% CI', 'Rows'], summary.comparisons.map(c => [c.suite, `${c.a} − ${c.b}`, `${(100 * c.difference).toFixed(1)} pp`, c.ci95.map(x => `${(100 * x).toFixed(1)}`).join('..'), c.rows]));
}
lines.push('### Error classes (heuristic labels on 40 sampled failures per suite, Q8_0)', '');
for (const m of models) {
  const file = path.join(base, m, 'error-analysis.json');
  if (!fs.existsSync(file)) { lines.push(`- ${m}: pending`); continue; }
  const e = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const s of e.suites) lines.push(`- ${m}, ${s.suite}: ${s.error ? 'pending' : `${s.failures} failures; sample of ${s.sampled}: ${Object.entries(s.class_counts).map(([k, v]) => `${k} ${v}`).join(', ')}`}`);
}
lines.push('');
process.stdout.write(lines.join('\n') + '\n');
