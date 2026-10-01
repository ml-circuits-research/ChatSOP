#!/usr/bin/env node
/** Verifiers of the two archived corpora that tools/datasets/verify-corpus.mjs cannot check (TODO 1e): `clean-english` and `proofing`.
 *
 *   node tools/datasets/verify-view-corpora.mjs --corpus clean-english|proofing [--no-language-gate]
 *
 * `clean-english` (datasets_archive/clean-english + eval/suites/clean-english/test.jsonl) is a filtered view of the formalizer corpora: rows keep the
 * formalizer row schema (question, sop_target, rights, ...), but its sealed test also holds the wild suite rows, which have no split groups. Checks:
 * manifest and split files, sha256 of every file, counts, row shape, unique ids, language `en`, the message as the only model input, a model-language
 * target (checkModelProgram), rights declaring that no text was copied, split-group integrity (rows with a group never cross splits; wild rows with
 * `writer` have none and are exempt, their id is their identity), no repeated normalized message across splits, and every message passes the clean-English
 * gate (tools/datasets/clean-english.mjs, partition `clean_en`; skipped with --no-language-gate).
 *
 * `proofing` (datasets_archive/proofing + eval/suites/proofing/test.jsonl) has the schema {input, target, kind identity|repair|hard}: no SOP. Checks:
 * manifest, sha256 of every file, row shape per kind (identity: target equals the input; repair: a non-empty target that differs, a passing target oracle and
 * meaning check; hard: no target, and a hard row is never in train or dev), quality flags (synthetic, not human reviewed, not training approved), unique ids,
 * split groups that never cross train, dev and test, no test input repeated in train, dev or ro_translated, and the training projection
 * (`proofreader/{train,dev}.jsonl`, prompt/target) equals the train/dev/ro_translated rows it was built from.
 *
 * Fail-closed: exit 0 pass, 1 a check failed, 2 the run could not start. No model, no GPU.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, hashJsonlSharded, jsonlExists} from '../../lib/jsonl-shards.mjs';
import {ROOT, corpusDir, resolveDatasetPath} from '../../lib/dataset-paths.mjs';

const normalize = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;

/** Collects failures (the first 50 are kept, all are counted). */
function reporter() {
  const failures = [];
  let count = 0;
  const fail = message => { count++; if (failures.length < (Number(process.env.VERIFY_KEEP) || 50)) failures.push(message); };
  return {fail, failures, get count() { return count; }};
}

/** Read the manifest and every split file; verify the checksums. Returns {manifest, files: Map(name -> rows)}. */
export async function loadCorpus(corpus, root, r) {
  const manifestPath = path.join(root, corpusDir(corpus, root), 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw Error(`missing ${path.relative(root, manifestPath)}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'chatsop-corpus-manifest-v2') r.fail(`manifest format ${manifest.format}, expected chatsop-corpus-manifest-v2`);
  if (manifest.corpus !== corpus) r.fail(`manifest names corpus ${manifest.corpus}`);
  if (manifest.training_authorized !== false) r.fail('manifest: training_authorized is not false');
  const files = new Map();
  for (const [name, stored] of Object.entries(manifest.splits ?? {})) {
    const relative = String(stored).split(' ')[0]; // a stored path may carry a note after a space (hard_cases)
    const file = path.join(root, resolveDatasetPath(relative));
    if (!jsonlExists(file)) { r.fail(`${name}: missing ${relative}`); continue; }
    if (manifest.sha256?.[relative] && await hashJsonlSharded(file) !== manifest.sha256[relative]) r.fail(`${relative}: sha256 differs from the manifest`);
    else if (!manifest.sha256?.[relative]) r.fail(`${relative}: no sha256 in the manifest`);
    files.set(name, readJsonlShardedSync(file));
  }
  for (const required of ['train', 'dev', 'test']) if (!files.has(required)) r.fail(`manifest has no ${required} split`);
  return {manifest, files};
}

/** Cross-split integrity shared by both corpora: unique ids, row.split equals the file's split, groups never cross train/dev/test. */
function structure(files, r, {splitNames = ['train', 'dev', 'test'], groupExempt = () => false} = {}) {
  const ids = new Map(), groups = new Map();
  for (const name of splitNames) for (const row of files.get(name) ?? []) {
    if (!nonEmpty(row.id)) { r.fail(`${name}: a row without id`); continue; }
    if (ids.has(row.id)) r.fail(`${row.id}: duplicate id (also in ${ids.get(row.id)})`);
    ids.set(row.id, name);
    if (row.split !== name) r.fail(`${row.id}: row of split ${row.split} in the ${name} file`);
    if (groupExempt(row)) continue;
    if (!nonEmpty(row.split_group_id)) { r.fail(`${row.id}: missing split_group_id`); continue; }
    if (!groups.has(row.split_group_id)) groups.set(row.split_group_id, new Set());
    groups.get(row.split_group_id).add(name);
  }
  for (const [group, splits] of groups) if (splits.size > 1) r.fail(`group ${group} crosses splits ${[...splits].join(', ')}`);
  return {ids, groups};
}

/** Counts of the manifest equal the rows read. */
function countsMatch(manifest, files, r, names = ['train', 'dev', 'test']) {
  for (const name of names) {
    const expected = manifest.counts?.[name];
    if (expected !== undefined && expected !== files.get(name)?.length) r.fail(`counts.${name}: manifest ${expected}, file ${files.get(name)?.length}`);
  }
}

// ------------------------------------------------------------------ clean-english
const CLEAN_REQUIRED = ['id', 'question', 'language', 'split', 'sop_target', 'expected', 'rights', 'quality_flags'];

export async function verifyCleanEnglish({root = ROOT, languageGate = true} = {}) {
  const r = reporter();
  const {manifest, files} = await loadCorpus('clean-english', root, r);
  countsMatch(manifest, files, r);
  const {parse} = await import('../../sop/parser.mjs');
  const {checkModelProgram} = await import('../../sop/declarative.mjs');
  const wild = row => row.writer !== undefined || row.suite === 'formalizer-wild-v1';
  structure(files, r, {groupExempt: wild});
  let resources = null;
  if (languageGate) {
    const {loadSpellfix} = await import('../../lib/languages-util/spellfix.mjs');
    const {defaultDictionary} = await import('../../sop/dictionary.mjs');
    resources = {spellfix: loadSpellfix(), dictionary: defaultDictionary()};
  }
  const {classifyPartition} = await import('./clean-english.mjs');
  const seen = new Map();
  let checked = 0;
  for (const [name, rows] of files) for (const row of rows) {
    checked++;
    for (const key of CLEAN_REQUIRED) if (row[key] === undefined || row[key] === null) r.fail(`${row.id}: missing ${key}`);
    if (row.language !== 'en') r.fail(`${row.id}: language ${row.language}, a clean-English row is en`);
    if (!nonEmpty(row.question)) r.fail(`${row.id}: empty question`);
    if (row.model_input !== undefined && row.model_input !== row.question) r.fail(`${row.id}: model_input differs from the message`);
    if (row.context !== undefined) r.fail(`${row.id}: the evaluation-only scaffolding is named verification_context, not context (DS022 row fields)`);
    if (row.verification_context && row.verification_context.model_visible !== false) r.fail(`${row.id}: verification_context is not marked model_visible false`);
    if (wild(row)) { // independent writers: quality_flags is a list of tags, and the row is evaluation-only
      if (row.rights?.text_copied !== false) r.fail(`${row.id}: rights do not declare that no text was copied`);
      if (!Array.isArray(row.quality_flags) || !row.quality_flags.includes('eval_only_never_training')) r.fail(`${row.id}: a wild row must carry the quality flag eval_only_never_training`);
      if (name !== 'test') r.fail(`${row.id}: a wild row outside the sealed test (${name})`);
    } else {
      if (row.rights?.text_copied !== false || row.quality_flags?.source_rows_copied !== false) r.fail(`${row.id}: rights/provenance do not declare that no text was copied`);
      if (row.quality_flags?.training_approved === true) r.fail(`${row.id}: quality_flags.training_approved is true`);
    }
    try { checkModelProgram(parse(row.sop_target)); } catch (error) { r.fail(`${row.id}: target is not model language (${error.message})`); }
    const key = normalize(row.question);
    const earlier = seen.get(key);
    if (earlier && earlier.split !== name) r.fail(`${row.id}: message repeated from ${earlier.id} of split ${earlier.split}`);
    else if (!earlier) seen.set(key, {id: row.id, split: name});
    if (resources) {
      const {partition, reasons} = classifyPartition(row, resources);
      if (partition !== 'clean_en') r.fail(`${row.id}: not clean English by the gate (${partition}${reasons.length ? ': ' + reasons.join('; ') : ''})`);
    }
  }
  return {corpus: 'clean-english', rows: checked, languageGate, failures: r.failures, failureCount: r.count};
}

// ------------------------------------------------------------------ proofing
const PROOFING_KINDS = new Set(['identity', 'repair', 'hard']);
const PROOFING_REQUIRED = ['id', 'source_corpus', 'source_id', 'split_group_id', 'split', 'language', 'input', 'kind', 'quality_flags', 'rights'];

function proofingRow(row, name, r, {where}) {
  // the rows of the diversified arm (proofdiv_*) in hard_cases carry no split of their own: their group decides
  for (const key of PROOFING_REQUIRED) if (!(key === 'split' && where === 'hard_cases') && (row[key] === undefined || row[key] === null)) r.fail(`${where} ${row.id}: missing ${key}`);
  if (!PROOFING_KINDS.has(row.kind)) { r.fail(`${where} ${row.id}: kind ${row.kind}`); return; }
  if (!nonEmpty(row.input)) r.fail(`${where} ${row.id}: empty input`);
  if (row.quality_flags?.synthetic !== true || row.quality_flags?.human_reviewed !== false || row.quality_flags?.training_approved !== false) r.fail(`${where} ${row.id}: quality_flags must be synthetic true, human_reviewed false, training_approved false`);
  if (row.kind === 'identity') {
    if (row.target !== row.input) r.fail(`${where} ${row.id}: identity row whose target differs from its input`);
    if (row.meaning_checks && row.meaning_checks.ok !== true) r.fail(`${where} ${row.id}: identity row failing its meaning check`);
  } else if (row.kind === 'repair') {
    if (!nonEmpty(row.target)) r.fail(`${where} ${row.id}: repair row without target`);
    else if (row.target === row.input) r.fail(`${where} ${row.id}: repair row whose target equals its input`);
    if (!nonEmpty(row.target_source)) r.fail(`${where} ${row.id}: repair row without target_source`);
    if (row.target_oracle && row.target_oracle.strict !== true) r.fail(`${where} ${row.id}: repair target did not pass the strict oracle`);
    if (row.meaning_checks && row.meaning_checks.ok !== true) r.fail(`${where} ${row.id}: repair target failing its meaning check`);
  } else {
    if (row.target !== null && row.target !== undefined) r.fail(`${where} ${row.id}: hard row with a target`);
    if (name === 'train' || name === 'dev') r.fail(`${where} ${row.id}: hard row in ${name} (hard rows are never a training target)`);
  }
}

export async function verifyProofing({root = ROOT} = {}) {
  const r = reporter();
  const {manifest, files} = await loadCorpus('proofing', root, r);
  countsMatch(manifest, files, r);
  structure(files, r);
  for (const name of ['train', 'dev', 'test']) for (const row of files.get(name) ?? []) proofingRow(row, name, r, {where: name});
  // hard_cases: rows of any split, never repaired, never in train/dev files; groups must agree with the split the row declares
  const trainDevIds = new Set([...(files.get('train') ?? []), ...(files.get('dev') ?? [])].map(row => row.id));
  const groupSplit = new Map();
  for (const name of ['train', 'dev', 'test']) for (const row of files.get(name) ?? []) groupSplit.set(row.split_group_id, name);
  const hardIds = new Set();
  for (const row of files.get('hard_cases') ?? []) {
    if (hardIds.has(row.id)) r.fail(`hard_cases ${row.id}: duplicate id`);
    hardIds.add(row.id);
    proofingRow(row, 'hard_cases', r, {where: 'hard_cases'});
    if (row.kind !== 'hard') r.fail(`hard_cases ${row.id}: kind ${row.kind}`);
    if (trainDevIds.has(row.id)) r.fail(`hard_cases ${row.id}: also a train/dev row`);
    if (row.split != null && groupSplit.has(row.split_group_id) && groupSplit.get(row.split_group_id) !== row.split) r.fail(`hard_cases ${row.id}: split ${row.split}, but its group is in ${groupSplit.get(row.split_group_id)}`);
  }
  // Romanian arm: translated rows, English input/target, a different id space, no overlap with the other files
  const ro = files.get('ro_translated') ?? [];
  const roIds = new Set();
  for (const row of ro) {
    if (roIds.has(row.id)) r.fail(`ro_translated ${row.id}: duplicate id`);
    roIds.add(row.id);
    proofingRow(row, 'ro_translated', r, {where: 'ro_translated'});
    if (row.pipeline !== 'translate' || row.source_language !== 'ro') r.fail(`ro_translated ${row.id}: pipeline ${row.pipeline}, source_language ${row.source_language}`);
    if (row.language !== 'en') r.fail(`ro_translated ${row.id}: the translated row is English, language ${row.language}`);
    if (trainDevIds.has(row.id) || (files.get('test') ?? []).some(t => t.id === row.id)) r.fail(`ro_translated ${row.id}: id also in another file`);
    if (groupSplit.has(row.split_group_id) && groupSplit.get(row.split_group_id) !== row.split) r.fail(`ro_translated ${row.id}: split ${row.split}, but its group is in ${groupSplit.get(row.split_group_id)}`);
  }
  // no test input (the sealed text) appears in any training-side row
  const testInputs = new Set((files.get('test') ?? []).map(row => normalize(row.input)));
  for (const [where, rows] of [['train', files.get('train')], ['dev', files.get('dev')], ['ro_translated', ro]]) for (const row of rows ?? []) if (row.split !== 'test' && testInputs.has(normalize(row.input))) r.fail(`${where} ${row.id}: input repeats a sealed test input`);
  for (const row of ro) if (row.split === 'test') r.fail(`ro_translated ${row.id}: a test-split row outside the sealed file`);
  // the training projection prompt/target is the train/dev/ro_translated rows without hard rows
  const projectionDir = path.join(root, corpusDir('proofing', root), 'proofreader');
  for (const name of ['train', 'dev']) {
    const file = path.join(projectionDir, `${name}.jsonl`);
    if (!jsonlExists(file)) { r.fail(`proofreader/${name}.jsonl is missing`); continue; }
    const projected = readJsonlShardedSync(file);
    const source = new Map([...(files.get(name) ?? []), ...ro.filter(row => row.split === name)].filter(row => row.kind !== 'hard').map(row => [row.id, row]));
    const seen = new Set();
    for (const row of projected) {
      if (seen.has(row.id)) r.fail(`proofreader/${name} ${row.id}: duplicate id`);
      seen.add(row.id);
      const origin = source.get(row.id);
      if (!origin) { r.fail(`proofreader/${name} ${row.id}: no such train/dev/ro_translated row`); continue; }
      if (row.prompt !== origin.input || row.target !== origin.target) r.fail(`proofreader/${name} ${row.id}: prompt/target differ from the source row`);
      if (!nonEmpty(row.prompt) || !nonEmpty(row.target)) r.fail(`proofreader/${name} ${row.id}: empty prompt or target`);
    }
    if (seen.size !== source.size) r.fail(`proofreader/${name}: ${seen.size} rows, the source holds ${source.size} non-hard rows`);
  }
  return {corpus: 'proofing', rows: [...files.values()].reduce((n, rows) => n + rows.length, 0), failures: r.failures, failureCount: r.count};
}

async function main() {
  const args = process.argv.slice(2);
  const corpus = args[args.indexOf('--corpus') + 1];
  const verifiers = {'clean-english': () => verifyCleanEnglish({languageGate: !args.includes('--no-language-gate')}), proofing: () => verifyProofing()};
  if (!verifiers[corpus]) { console.error('usage: verify-view-corpora.mjs --corpus clean-english|proofing [--no-language-gate]'); process.exit(2); }
  const result = await verifiers[corpus]();
  for (const message of result.failures) console.error(`  ${message}`);
  if (result.failureCount > result.failures.length) console.error(`  ... and ${result.failureCount - result.failures.length} more`);
  console.log(`${result.corpus}: ${result.rows} rows, ${result.failureCount} failure(s)`);
  process.exit(result.failureCount ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(2); });
