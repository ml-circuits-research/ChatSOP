/** Concise human summary of a corpus audit report. */
const percent = value => value === null || value === undefined ? 'n/a' : `${(100 * value).toFixed(1)}%`;
const format = (check, value) => value === null ? 'n/a' : check.id === 'diversity.target_skeletons' ? String(value) : check.id === 'diversity.template_ratio' ? value.toFixed(3) : percent(value);

export function humanSummary(report, reportPath = null) {
  const lines = [];
  const test = report.leakage?.test_vs_development;
  lines.push(`corpus ${report.corpus}: ${report.rows} rows, ${report.cases} cases (${Object.entries(report.by_split).map(([split, count]) => `${split} ${count}`).join(', ')})`);
  lines.push(`invariants: ${report.invariants.total ? `${report.invariants.total} violation(s) ${JSON.stringify(report.invariants.counts)}` : 'ok'}`);
  lines.push(`wires: ${JSON.stringify(report.wires.by_type)}; grounded ${report.wires.grounded}, assumption ${report.wires.assumption} (rows ${percent(report.wires.assumption_row_ratio)})`);
  lines.push(`faithfulness errors: ${percent(report.faithfulness.error_rate)} of ${report.faithfulness.rows_with_target} rows with a target`);
  const dev = report.diversity.development;
  lines.push(`diversity: ${dev.templates.distinct} input templates / ${dev.rows} rows, top-10 share ${percent(dev.templates.top_share)}, ${dev.target_skeletons.distinct} target skeletons, near-duplicates ${percent(report.diversity.near_duplicates.rate)}`);
  if (test) lines.push(`sealed test vs train+dev: templates ${percent(test.template_overlap)}, skeletons ${percent(test.target_skeleton_overlap)}, entities ${percent(test.entity_overlap)}, exact ${percent(test.exact_input_overlap)}, near-dup ${percent(test.near_duplicate_overlap)}`);
  const flagged = report.checks.filter(check => check.status !== 'ok' && check.status !== 'n/a');
  if (flagged.length) {
    lines.push('checks over threshold:');
    for (const check of flagged) {
      const count = check.scope === 'row' ? ` (${check.flagged}/${check.eligible})` : '';
      lines.push(`  ${check.status.toUpperCase().padEnd(7)} ${check.id.padEnd(34)} ${format(check, check.value)}${count} ${check.direction === 'min' ? '<' : '>'} ${format(check, check.threshold)}`);
    }
  }
  lines.push(`verdict: ${report.verdict.status.toUpperCase()}${report.verdict.failed_checks.length ? ` (${report.verdict.failed_checks.join(', ')})` : ''}${report.verdict.invariant_failures ? ' (invariants)' : ''}`);
  if (reportPath) lines.push(`report: ${reportPath}`);
  return lines.join('\n');
}
