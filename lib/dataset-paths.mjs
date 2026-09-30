/**
 * Locations of the ChatSOP datasets (owner decision 2026-09-30, DS008 "Three datasets"): `datasets/` holds exactly
 * `bad_english`, `symbolic_english` and `neuro_english`; the legacy corpora that feed them (formalizer-v1, proofing,
 * proofing-diverse-dev, clean-english, diversity) are provenance inputs and the gold-SOP arbiter, kept in the tracked
 * folder `datasets_archive/`. `archived(relative)` resolves a legacy path to whichever of the two folders holds it, so
 * tools keep working on a checkout that has not been restructured yet and old records that store a
 * `datasets/<legacy>/...` path stay resolvable (`resolveDatasetPath`).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {jsonlExists} from './jsonl-shards.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ARCHIVE_DIR = 'datasets_archive';
export const THREE_DATASETS = Object.freeze(['bad_english', 'symbolic_english', 'neuro_english']);
export const LEGACY_CORPORA = Object.freeze(['formalizer-v1', 'proofing', 'proofing-diverse-dev', 'clean-english', 'diversity']);

const exists = file => fs.existsSync(file) || (file.endsWith('.jsonl') && jsonlExists(file));

/** Repository-relative path of a legacy corpus file, e.g. archived('formalizer-v1/dev.jsonl'). */
export function archived(relative) {
  const inArchive = path.posix.join(ARCHIVE_DIR, relative);
  const inDatasets = path.posix.join('datasets', relative);
  if (exists(path.join(ROOT, inArchive))) return inArchive;
  if (exists(path.join(ROOT, inDatasets))) return inDatasets;
  return inArchive;
}

/**
 * Resolve a path stored in an older record (`datasets/<legacy corpus>/...`) to where the file lives now. Other paths
 * are returned unchanged.
 */
export function resolveDatasetPath(stored) {
  const match = /^datasets\/([^/]+)\/(.*)$/.exec(String(stored));
  if (!match || !LEGACY_CORPORA.includes(match[1])) return stored;
  return archived(`${match[1]}/${match[2]}`);
}

const isDirectory = dir => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };

/**
 * Repository-relative directory of a corpus by name: `datasets/<name>` for the three current datasets, otherwise the
 * legacy corpus in `datasets_archive/<name>`. Used by every tool that takes a corpus name.
 */
export function corpusDir(name, root = ROOT) {
  if (isDirectory(path.join(root, 'datasets', name))) return `datasets/${name}`;
  if (isDirectory(path.join(root, ARCHIVE_DIR, name))) return `${ARCHIVE_DIR}/${name}`;
  return `datasets/${name}`;
}

/** Names of all corpus directories under `datasets/` and `datasets_archive/` (sorted, without duplicates). */
export function corpusNames(root = ROOT) {
  const names = new Set();
  for (const base of ['datasets', ARCHIVE_DIR]) {
    const dir = path.join(root, base);
    if (!isDirectory(dir)) continue;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) if (entry.isDirectory()) names.add(entry.name);
  }
  return [...names].sort();
}
