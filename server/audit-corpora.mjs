/** Registry for the visual corpus audit (DS020, `/audit`): which review type — `formalizer`, `proofreading` or
 * `cleanText` — each corpus belongs to, plus split files beyond the directory scan `server/audit.mjs` already
 * does (datasets/<corpus>/{train,dev}.jsonl, eval/suites/<corpus>/test.jsonl). The data itself is
 * `config/audit-corpora.json`; this module only reads and interprets it. A corpus not named explicitly is
 * classified by the first matching `patterns` entry, else `default_type`, so a brand-new corpus that follows an
 * existing naming convention (for example `formalizer-*`) needs no edit here at all — the audit page picks it up
 * from the directory scan the moment its files exist (DS020 "Corpus registry").
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryFile = path.join(projectRoot, 'config/audit-corpora.json');

/** The review types of the three current datasets (each is also its own tab) and of the legacy corpora (archive tab). */
export const DATASET_TYPES = ['bad_english', 'symbolic_english', 'neuro_english'];
export const LEGACY_TYPES = ['formalizer', 'proofreading', 'cleanText'];
export const AUDIT_TYPES = [...DATASET_TYPES, ...LEGACY_TYPES];
export const AUDIT_TYPE_LABELS = {bad_english: 'bad_english', symbolic_english: 'symbolic_english', neuro_english: 'neuro_english', formalizer: 'Formalizer (archive)', proofreading: 'Proofreading (archive)', cleanText: 'Clean text (archive source)'};
/** The audit page tabs, in order: the three datasets, then the secondary archive / sources view. */
export const AUDIT_TABS = [...DATASET_TYPES, 'archive'];
/** The tab of a corpus type: a dataset type is its own tab, every legacy type sits under `archive`. */
export const tabOf = type => (DATASET_TYPES.includes(type) ? type : 'archive');
/** `{id, label, purpose}` of each tab, from the registry (with a fallback label when a tab is not described there). */
export function tabDescriptions(registry = loadAuditRegistry()) {
  return AUDIT_TABS.map(id => ({id, label: id === 'archive' ? 'archive / sources' : id, purpose: '', ...(registry.tabs ?? []).find(tab => tab.id === id)}));
}

export function loadAuditRegistry(file = registryFile) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The audit review type of corpus `name`: an explicit registry entry, else the first matching pattern, else the registry's `default_type`. */
export function corpusType(name, registry = loadAuditRegistry()) {
  const explicit = registry.corpora?.[name]?.type;
  if (explicit) return explicit;
  const pattern = (registry.patterns ?? []).find(({test}) => new RegExp(test).test(name));
  return pattern?.type ?? registry.default_type ?? 'formalizer';
}

/** Whether the registry seals corpus `name` entirely (view-only, verdicts still append to the ledger). Splits read from eval/suites are sealed by location regardless. */
export function corpusSealed(name, registry = loadAuditRegistry()) {
  return registry.corpora?.[name]?.sealed === true;
}

/** Extra `{split, file}` split files declared for `name` beyond the default discovery, `file` resolved from the repository root. */
export function extraFiles(name, registry = loadAuditRegistry(), root = projectRoot) {
  return (registry.corpora?.[name]?.extra_files ?? []).map(({split, path: relative}) => ({split, file: path.join(root, relative)}));
}

/** The read-only local-source directories shown under the cleanText tab (never a train/dev/test corpus, never exported: AGENTS.md rule 10, DS014). */
export function cleanTextSources(registry = loadAuditRegistry(), root = projectRoot) {
  return (registry.clean_text_sources ?? []).map(entry => ({...entry, dir: path.join(root, entry.dir)}));
}
