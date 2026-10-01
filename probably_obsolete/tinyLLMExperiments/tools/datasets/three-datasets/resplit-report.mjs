/** Bookkeeping of the analysis-layer re-split (incident of 2026-09-30 night, DS008 "Three datasets"): a frozen snapshot of the
 * rows as the SOP-proxy builders had placed them, and the movement report (where each old row went).
 *
 * The snapshot keeps only ids and small labels (no text), one file per side (`before-train-dev.json`, `before-test.json`) under
 * eval/reports/current/three-datasets/resplit/. It is written once (never overwritten, so a second assembly still compares with the
 * original split); `--force` of the writers replaces it. The train/dev snapshot is written by tools/datasets/build-three-datasets.mjs
 * and the sealed one by tools/eval/three-datasets-suites.mjs (the only code that opens a sealed file).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';

export const RESPLIT_DIR = path.join(ROOT, 'eval/reports/current/three-datasets/resplit');

/** The old label of a row: its dataset, source corpus, split and (neuro) failure kind and SOP status under the old rules. */
export const oldLabel = row => ({d: row.dataset, s: row.source?.corpus ?? null, sp: row.split, fk: row.failure_kind ?? null, av: row.analysis_verified ?? null, gm: row.verification?.sop_gold_match ?? null, g: row.gold_sop ? 1 : 0});

export function writeSnapshot(side, rows, {force = false} = {}) {
  fs.mkdirSync(RESPLIT_DIR, {recursive: true});
  const file = path.join(RESPLIT_DIR, `before-${side}.json`);
  if (fs.existsSync(file) && !force) return {written: false, file};
  const ids = {};
  for (const row of rows) ids[row.id] = oldLabel(row);
  fs.writeFileSync(file, JSON.stringify({note: 'frozen labels of the symbolic_english and neuro_english rows before the analysis-layer re-split (ids and labels only, no text); d dataset, s source corpus, sp split, fk old failure_kind, av old analysis_verified, gm old sop_gold_match, g has a gold SOP', side, created_at: new Date().toISOString(), ids}) + '\n');
  return {written: true, file, rows: rows.length};
}

export const readSnapshot = side => { const file = path.join(RESPLIT_DIR, `before-${side}.json`); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).ids : null; };

const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

/** Movement of the clean-English rows: old dataset -> new dataset, with the old failure kind / verification of the movers. `rows`: the new symbolic and neuro rows. */
export function movement(side, rows) {
  const before = readSnapshot(side);
  if (!before) return null;
  const now = new Map(rows.map(r => [r.id, r]));
  const out = {side, before_rows: Object.keys(before).length, after_rows: now.size, transitions: {}, stayed_or_moved_by_old_failure_kind: {}, by_source: {}, appeared: 0, disappeared: 0, appeared_by_source: {}, disappeared_by_source: {}};
  for (const [id, old] of Object.entries(before)) {
    const row = now.get(id);
    if (!row) { out.disappeared++; bump(out.disappeared_by_source, `${old.d}/${old.s}`); continue; }
    const key = `${old.d} -> ${row.dataset}`;
    bump(out.transitions, key);
    if (old.d === 'neuro_english') { const t = out.stayed_or_moved_by_old_failure_kind[old.fk ?? 'none'] ??= {}; bump(t, row.dataset); }
    const s = out.by_source[old.s ?? 'none'] ??= {}; bump(s, key);
  }
  for (const row of rows) if (!(row.id in before)) { out.appeared++; bump(out.appeared_by_source, `${row.dataset}/${row.source?.corpus}`); }
  return out;
}
