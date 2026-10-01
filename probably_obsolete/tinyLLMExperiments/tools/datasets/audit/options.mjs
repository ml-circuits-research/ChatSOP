/** Configuration, thresholds and `--fail-on` parsing for the corpus audit. */
import {ROW_CHECKS} from './checks.mjs';

/** Corpus-level metrics. `direction: 'min'` means the value must not fall below the threshold. */
export const CORPUS_CHECKS = [
  {id: 'diversity.top10_template_share', severity: 'warning', threshold: 0.5, direction: 'max',
    description: 'Share of development rows covered by the 10 most frequent masked input templates.'},
  {id: 'diversity.template_ratio', severity: 'warning', threshold: 0.2, direction: 'min',
    description: 'Distinct masked input templates per development row.'},
  {id: 'diversity.target_skeletons', severity: 'warning', threshold: 10, direction: 'min',
    description: 'Distinct masked target skeletons in the development rows.'},
  {id: 'diversity.near_duplicate', severity: 'warning', threshold: 0.1, direction: 'max',
    description: 'Rows with a MinHash near-duplicate (3-shingle Jaccard >= 0.8) in the same split, outside their own split group.'},
  {id: 'leakage.exact_input', severity: 'error', threshold: 0, direction: 'max',
    description: 'Sealed-test rows whose normalized message also occurs in train or dev.'},
  {id: 'leakage.template_overlap', severity: 'warning', threshold: 0.2, direction: 'max',
    description: 'Sealed-test rows whose masked input template occurs in train or dev.'},
  {id: 'leakage.near_duplicate', severity: 'warning', threshold: 0.05, direction: 'max',
    description: 'Sealed-test rows with a near-duplicate message in train or dev.'},
  {id: 'leakage.entity_overlap', severity: 'warning', threshold: 0.5, direction: 'max',
    description: 'Sealed-test rows sharing at least one entity label head with train or dev.'},
  {id: 'leakage.target_skeleton_overlap', severity: 'info', threshold: 1, direction: 'max',
    description: 'Sealed-test rows whose target skeleton occurs in train or dev (expected to be high for closed families).'},
  {id: 'assumption.row_ratio', severity: 'info', threshold: 1, direction: 'max',
    description: 'Rows whose target contains at least one model-assumption wire.'},
];

export const ALL_CHECKS = [...ROW_CHECKS.map(check => ({...check, scope: 'row', direction: 'max'})), ...CORPUS_CHECKS.map(check => ({...check, scope: 'corpus'}))];
const KNOWN = new Map(ALL_CHECKS.map(check => [check.id, check]));

const list = value => value === undefined || value === null || value === true ? null
  : String(value).split(',').map(item => item.trim()).filter(Boolean);

export function parseRate(text, id) {
  const value = String(text).trim();
  const number = value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value);
  if (!Number.isFinite(number) || number < 0) throw Error(`Invalid threshold for ${id}: ${text}`);
  return number;
}

const known = id => {
  if (!KNOWN.has(id)) throw Error(`Unknown check id: ${id}. Known: ${[...KNOWN.keys()].join(', ')}`);
  return KNOWN.get(id);
};

/** `--threshold id=rate,...`: change thresholds without changing which checks fail the run. */
export function parseThresholds(value) {
  const thresholds = Object.fromEntries(ALL_CHECKS.map(check => [check.id, check.threshold]));
  for (const item of list(value) ?? []) {
    const [id, rate] = item.split('=');
    known(id);
    thresholds[id] = parseRate(rate, id);
  }
  return thresholds;
}

/**
 * `--fail-on` selects which checks fail the run when they breach their threshold. Invariants always fail.
 *   errors (default)  every error-severity check at its threshold
 *   warnings | all    error and warning checks
 *   none              report mode: only invariants fail
 *   id[=rate]         add one check, optionally with its own threshold (`5%` or `0.05`)
 */
export function parseFailOn(value, thresholds) {
  const failOn = new Map();
  const items = list(value) ?? ['errors'];
  for (const item of items) {
    if (item === 'none') continue;
    if (['errors', 'warnings', 'all'].includes(item)) {
      for (const check of ALL_CHECKS) {
        if (check.severity === 'error' || (item !== 'errors' && check.severity === 'warning')) failOn.set(check.id, thresholds[check.id]);
      }
      continue;
    }
    const [id, rate] = item.split('=');
    known(id);
    failOn.set(id, rate === undefined ? thresholds[id] : parseRate(rate, id));
  }
  return failOn;
}

/** Normalize a configuration object (from the CLI or a test). */
export function auditConfig(options = {}) {
  const thresholds = parseThresholds(options.threshold);
  const set = (value, fallback) => new Set(Array.isArray(value) ? value : (list(value) ?? fallback));
  const groundedTypes = set(options.groundedTypes, ['stated']);
  const assumptionTypes = set(options.assumptionTypes, ['assumed']);
  const problemTypes = set(options.problemTypes, ['query', 'constraint']);
  for (const type of assumptionTypes) {
    if (groundedTypes.has(type) || problemTypes.has(type)) throw Error(`Wire type ${type} cannot be both an assumption and a grounded/problem type`);
  }
  return {
    groundedTypes, assumptionTypes, problemTypes,
    thresholds,
    failOn: parseFailOn(options.failOn, thresholds),
    examples: Number(options.examples ?? 5),
    spot: Number(options.spot ?? 25),
    lexicon: options.lexicon ?? null,
    leakage: options.leakage !== false,
  };
}
