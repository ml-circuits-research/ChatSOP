import { alphaCanonical } from './semantic-normalize.mjs';
export { alphaCanonical } from './semantic-normalize.mjs';
import { evaluate } from '../../eval/run.mjs';
import { sha256 } from './schema.mjs';

/** Finite worlds refute differences, never prove unrestricted semantic equivalence. */
export async function compareCircuits(row, candidate, { probes = [], config = {} } = {}) {
  const result = { verdict: 'pending', canonical_match: false, reference_valid: false, errors: [], probes: [], limitations: 'Finite probes cannot prove universal equivalence' };
  try { alphaCanonical(row.sop_target); }
  catch (error) { result.verdict = 'reference_error'; result.errors.push({ stage: 'parse_graph', message: error.message }); return result; }
  try { result.canonical_match = alphaCanonical(row.sop_target) === alphaCanonical(candidate); }
  catch (error) { result.verdict = 'invalid'; result.errors.push({ stage: 'parse_graph', message: error.message }); return result; }
  for (const [index, world] of [{}, ...probes].entries()) {
    const probe = { ...row, ...world, id: `${row.id}_probe_${index}`, sop_target: row.sop_target };
    // A probe's independently supplied oracle may differ; never inherit a baseline oracle.
    if (index > 0 && typeof world.expected?.status !== 'string') {
      result.verdict = 'reference_error';
      result.errors.push({ stage: 'independent_probe_oracle', message: 'A discriminating world needs an independent expected oracle', probe: index });
      return result;
    }
    if (index > 0) probe.expected = world.expected;
    const evaluated = await evaluate([probe], { predictor: async () => candidate, config, source: 'predictions' });
    const record = evaluated.records[0];
    const observation = { index, world_sha256: sha256(JSON.stringify({ setup_sop: probe.setup_sop, ontology_sop: probe.ontology_sop, context: probe.verification_context ?? probe.context, expected: probe.expected })), reference_valid: record.reference_valid, runtime_valid: record.runtime_valid, execution_equivalent: record.execution_equivalent, gold_status: record.gold_status, predicted_status: record.predicted_status, error: record.error ?? null, reference_signature: record.reference_signature ?? null, prediction_signature: record.prediction_signature ?? null };
    result.probes.push(observation);
    if (!record.reference_valid) { result.verdict = 'reference_error'; result.errors.push({ stage: 'reference', message: record.error?.message ?? 'Invalid reference', probe: index }); return result; }
    result.reference_valid = true;
    if (!record.runtime_valid) { result.verdict = 'invalid'; result.errors.push({ stage: record.error?.stage ?? 'prediction', message: record.error?.message ?? 'Invalid prediction', probe: index }); return result; }
    if (!record.execution_equivalent) { result.verdict = 'counterexample'; return result; }
  }
  if (result.canonical_match) result.verdict = 'equivalent';
  return result;
}
