/** Sealed test rows for the auditor side of the composed evaluation (tools/eval): generators never import this module (AGENTS.md rule 9,
 * eval/leakage.mjs). The composed suites are built from these rows, and only from them.
 */
import path from 'node:path';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {poolsFromRows} from './components.mjs';

export const SEALED_DATASETS = Object.freeze(['symbolic_english', 'neuro_english', 'bad_english']);

/** The sealed test rows of one dataset (`eval/suites/<dataset>/test.jsonl`). */
export function loadSealedRows(dataset, root = ROOT) {
  const file = path.join(root, 'eval/suites', dataset, 'test.jsonl');
  return jsonlExists(file) ? readJsonlShardedSync(file) : [];
}

/** The three component pools of the sealed test rows. */
export function loadSealedPools(root = ROOT) {
  return poolsFromRows({symbolic: loadSealedRows('symbolic_english', root), neuro: loadSealedRows('neuro_english', root), bad: loadSealedRows('bad_english', root)});
}
