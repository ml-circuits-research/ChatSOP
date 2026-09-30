/**
 * Report slices (DS016 "Slices"). Every evaluator record carries the slice fields of its row, and the reports
 * group every metric by them: question type, language (`en`, `ro`, `mixed` = a labelled code switch), noise level
 * (`clean`, `light`, `medium`, `heavy`), family, and the HARD slice. A row is hard when any of these holds:
 *   - long: the message has at least LONG_WORDS whitespace-separated words (about the longest tenth of
 *     formalizer-v1 test, where the median is 11 words);
 *   - multi_statement: the gold has at least two `stated` wires (an unlabeled message: at least three sentences);
 *   - code_switched: the row carries a labelled code switch (`row.code_switch`);
 *   - high_noise: the row's noise level is `heavy` (4–6 typing-noise operations, DS022).
 * Fields a row does not record (an unlabeled message without language or noise labels) are `unspecified`.
 */
export const LONG_WORDS = 20;
export const SLICE_FIELDS = Object.freeze(['question_type', 'language_slice', 'noise_slice', 'family', 'hard_slice']);
export const HARD_REASONS = Object.freeze(['long', 'multi_statement', 'code_switched', 'high_noise']);

const statedWires = text => (String(text ?? '').match(/^@\S+\s+stated\s*$/gm) ?? []).length;
const sentences = text => String(text ?? '').split(/(?<=[.!?])\s+/).filter(part => /\p{L}/u.test(part)).length;

/** Slice fields of one suite row (or unlabeled message row). */
export function sliceFields(row) {
  const message = row.question ?? row.message ?? row.input ?? '';
  const target = row.sop_target ?? row.target;
  const reasons = [];
  if (String(message).trim().split(/\s+/).filter(Boolean).length >= LONG_WORDS) reasons.push('long');
  if (typeof target === 'string' ? statedWires(target) >= 2 : sentences(message) >= 3) reasons.push('multi_statement');
  if (row.code_switch) reasons.push('code_switched');
  if (row.noise_level === 'heavy') reasons.push('high_noise');
  return {
    language_slice: row.code_switch ? 'mixed' : row.language ?? 'unspecified',
    noise_slice: row.noise_level ?? (Array.isArray(row.noise) ? 'clean' : row.language ? 'clean' : 'unspecified'),
    hard_reasons: reasons,
    hard_slice: reasons.length ? 'hard' : 'not_hard',
  };
}

/** Group records by a slice field; `summarize(records)` computes the metrics of one group. */
export function groupBy(records, field, summarize) {
  const groups = new Map();
  for (const record of records) {
    const key = record[field] ?? 'unspecified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([name, values]) => [name, summarize(values)]));
}

/** Every slice of a record set: the SLICE_FIELDS groupings plus one group per hard reason. */
export function slices(records, summarize) {
  const out = Object.fromEntries(SLICE_FIELDS.map(field => [`by_${field}`, groupBy(records, field, summarize)]));
  out.by_hard_reason = Object.fromEntries(HARD_REASONS.map(reason => {
    const group = records.filter(record => record.hard_reasons?.includes(reason));
    return [reason, group.length ? summarize(group) : { rows: 0 }];
  }));
  return out;
}
