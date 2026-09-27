import assert from 'node:assert/strict';

const statuses = new Map([
  ['supported', 'ENTAILED'], ['entailed', 'ENTAILED'],
  ['refuted', 'CONTRADICTED'], ['both', 'CONFLICT'],
  ['unknown', 'UNKNOWN'], ['possible', 'POSSIBLE'],
  ['hypotheses', 'PLAUSIBLE'], ['candidates', 'PLAUSIBLE'],
  ['patterns', 'PLAUSIBLE'], ['clarify', 'AMBIGUOUS'],
  ['unsupported', 'UNSUPPORTED'], ['blocked', 'BLOCKED'],
]);

/** Preserve conflicts, conditionality and incomplete search independently of truth. */
export function epistemicResult(packet) {
  assert(packet && typeof packet.status === 'string', 'A result requires a runtime status');
  return {
    status: statuses.get(packet.status) ?? packet.status.toUpperCase(),
    runtime_status: packet.status,
    complete: packet.complete ?? null,
    hypothetical: packet.hypothetical === true,
    epistemic: packet.epistemic ?? null,
  };
}

export function fraction(numerator, denominator) {
  return { numerator, denominator, value: denominator ? numerator / denominator : null };
}

export function distribution(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = percentile => sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) };
}
