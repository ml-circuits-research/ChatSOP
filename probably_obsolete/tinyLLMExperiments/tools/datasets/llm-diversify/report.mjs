/** Markdown rendering of a paraphrase-pilot summary (regenerable: `pipeline.mjs report --out <dir>`). */
const pct = x => x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`;
const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderSummary(s, history = null) {
  const lines = [];
  const push = (...xs) => lines.push(...xs);
  const o = s.overall;
  push(`# LLM paraphrase pilot (${s.corpus})`, '',
    `**Observation, ${s.generated_at.slice(0, 10)}.** Regenerable from the call cache with \`node tools/datasets/llm-diversify/pipeline.mjs paraphrase --rows ${s.sample.rows} --n ${s.paraphrases_per_row} --seed ${s.seed}\`. Owner decision D2 (2026-09-29): "OK. Can you do this with a Haiku agent? It's fine to diversify as much as we need. Can it be done systematically?" Method: DS022 "LLM diversification"; rights: DS014 "LLM-authored text". Model \`${s.model}\` (no thinking), paraphrase prompt \`${s.prompts.paraphrase.version}\` (${s.prompts.paraphrase.system_sha256.slice(0, 12)}), judge prompt \`${s.prompts.judge.version}\` (${s.prompts.judge.system_sha256.slice(0, 12)}). No training was run; nothing was added to \`datasets/\`.`, '');
  push('## Result', '',
    `- Source rows: ${o.source_rows} train rows (${Object.keys(s.sample.by_family).length} families; ${Object.entries(s.sample.by_language).map(([k, v]) => `${k} ${v}`).join(', ')}), ${s.paraphrases_per_row} paraphrases each; writer parse failures ${o.writer_parse_failures}.`,
    `- Candidates ${o.candidates}, accepted **${o.accepted} (${pct(o.acceptance_rate)})**; source rows with at least one accepted paraphrase: ${o.source_rows_with_an_accepted_paraphrase}.`,
    `- Early stopping: ${s.stages[0].early_stopping.stop ? '**stopped** after stage 1' : 'not triggered'} (stage-1 acceptance ${pct(s.stages[0].early_stopping.acceptance_rate)}, minimum judge-control accuracy ${pct(s.stages[0].early_stopping.min_control_accuracy)}; rule: ${s.stages[0].early_stopping.rule}).`,
    `- Cost: ${s.cost.logged_calls} calls, $${s.cost.total_usd_all_logged_calls} in total, **$${s.cost.usd_per_accepted_row} per accepted row**; latency p50 ${s.cost.latency_ms.p50} ms, p90 ${s.cost.latency_ms.p90} ms per call (headless Claude Code, 8 concurrent).`, '');
  push('## Acceptance per filter', '', '| Filter | Pass rate (each filter alone, all candidates) | Survivors in pipeline order |', '| --- | --- | --- |');
  for (const [f, r] of Object.entries(o.pass_rate_by_filter)) push(`| ${f} | ${pct(r)} | ${o.funnel_in_order[f]} |`);
  push('', `Judge controls (stage 1): ${Object.entries(o.judge_controls).map(([k, v]) => `${k} ${v.correct}/${v.n} (${pct(v.accuracy)})`).join('; ')}. The judge accepted ${pct(o.judge_agreement_with_mechanical_filters)} of the candidates that passed (a), (b) and (e).`, '');
  push('| Language | Candidates | Accepted | Rate |', '| --- | --- | --- | --- |');
  for (const [k, v] of Object.entries(s.by_language)) push(`| ${k} | ${v.candidates} | ${v.accepted} | ${pct(v.rate)} |`);
  const fams = Object.entries(s.by_family).sort((a, b) => a[1].rate - b[1].rate);
  push('', `Families, lowest acceptance first: ${fams.slice(0, 8).map(([k, v]) => `${k} ${pct(v.rate)}`).join(', ')}; highest: ${fams.slice(-6).reverse().map(([k, v]) => `${k} ${pct(v.rate)}`).join(', ')}.`, '');
  const d = s.diversity, a = d.accepted_paraphrases_vs_train_dev, b = d.generator_baseline_dev_vs_train, ws = d.within_set;
  push('## Diversity gain', '', `Reference: ${d.reference}. Baseline: the generator's own dev messages measured against its train messages.`, '',
    '| Measure | Accepted paraphrases vs train+dev | Generator baseline (dev vs train) |', '| --- | --- | --- |',
    `| New masked templates | ${pct(a.new_masked_templates)} | ${pct(b.new_masked_templates)} |`,
    `| New structural skeletons | ${pct(a.new_structural_skeletons)} | ${pct(b.new_structural_skeletons)} |`,
    `| New lead-ins (first 5 skeleton tokens, frame proxy) | ${pct(a.new_lead_ins)} | ${pct(b.new_lead_ins)} |`,
    `| Novel word 3-gram occurrences | ${pct(a.novel_3gram_occurrences)} | ${pct(b.novel_3gram_occurrences)} |`,
    `| Novel word 4-gram occurrences | ${pct(a.novel_4gram_occurrences)} | ${pct(b.novel_4gram_occurrences)} |`,
    `| New word types (count) | ${a.new_word_types} | ${b.new_word_types} |`,
    `| Words p50 / p90 | ${a.words.p50} / ${a.words.p90} | ${b.words.p50} / ${b.words.p90} |`,
    `| Lower-case start | ${pct(a.lower_case_start)} | ${pct(b.lower_case_start)} |`, '',
    `Within the set (no reference): the accepted paraphrases have ${ws.accepted_paraphrases.distinct_masked_templates} distinct masked templates for ${ws.accepted_paraphrases.rows} rows and ${ws.accepted_paraphrases.distinct_lead_ins} distinct lead-ins (distinct-2 ${ws.accepted_paraphrases.distinct_2}); their ${ws.source_rows.rows} source rows have ${ws.source_rows.distinct_masked_templates} templates and ${ws.source_rows.distinct_lead_ins} lead-ins (distinct-2 ${ws.source_rows.distinct_2}).`, '');
  push('## No-copy', '', `Cached sources (last stage): pass ${s.no_copy_sources_report.pass}, rows with a shared 8-gram ${s.no_copy_sources_report.rows_with_shared_8gram}, rows with an identifier ${s.no_copy_sources_report.rows_with_identifier}. Sealed suites: see the \`no_copy_sealed\` filter above; the guard reports counts only.`, '');
  push('## Examples', '', '### Accepted', '', '| Family | Lang | Source message | Paraphrase |', '| --- | --- | --- | --- |');
  for (const e of s.examples.accepted) push(`| ${e.family} | ${e.language} | ${cell(e.message)} | ${cell(e.paraphrase)} |`);
  push('', '### Rejected', '', '| Family | Lang | Source message | Paraphrase | Why |', '| --- | --- | --- | --- | --- |');
  for (const e of s.examples.rejected) push(`| ${e.family} | ${e.language} | ${cell(e.message)} | ${cell(e.paraphrase)} | ${cell(e.why)} |`);
  if (history?.iterations?.length) {
    push('', '## How the pilot evolved', '', history.note, '');
    for (const it of history.iterations) push(`- **${it.step}.** ${[it.change, it.result, it.review, it.fix, it.why, it.cost, it.recommendation].filter(Boolean).join(' ')}`);
  }
  push('', '## Files', '', '- `eval/reports/current/llm-diversify/pilot/summary.json` (this report as data), `candidates.jsonl` (every candidate and its filter results), `accepted.jsonl` (corpus rows with provenance), `judge-controls.jsonl`, `calls.jsonl` (latency and cost per call); `cache/` holds every response.', '');
  return lines.join('\n');
}
