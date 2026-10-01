/** Stanza/spaCy agreement per analysed message (`verification.stanza_spacy_agree`), read from the recorded file.
 *
 * The records were computed once, with the spaCy parser (en_core_web_lg) that was removed from the product on
 * 2026-10-01 (hygiene H19), by comparing its root, subject, object, indirect object and negation arcs with Stanza's
 * (`coreDisagreement`). Nothing computes them any more; the file is recorded evidence, a message without a record
 * has no agreement value (null), and the dataset assembly only reads it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';

export const AGREE_FILE = path.join(ROOT, 'eval/reports/current/three-datasets/spacy-agree.jsonl');

/** The recorded agreement records by cache key (empty when the file is absent). */
export function loadAgreement() {
  const map = new Map();
  if (!fs.existsSync(AGREE_FILE)) return map;
  for (const line of fs.readFileSync(AGREE_FILE, 'utf8').split('\n')) if (line) { const r = JSON.parse(line); map.set(r.k, r); }
  return map;
}
