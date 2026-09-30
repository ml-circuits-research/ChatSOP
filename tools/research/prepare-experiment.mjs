#!/usr/bin/env node
/** Projects the model-language corpora (DS022) for a future authorized experiment.
 *
 * For every corpus with a `datasets/<corpus>/manifest.json` (format chatsop-corpus-manifest-v2) it:
 *   1. executes no model and loads no weights;
 *   2. checks that every formalization target is model-language only (checkModelProgram) and that connected
 *      groups never cross splits;
 *   3. projects train/dev rows to `datasets/<corpus>/formalizer/{train,dev}.jsonl` as {id, prompt, target, …}
 *      where the prompt is the user's message and nothing else (`barePrompt(row.question)`);
 *   4. asserts, fail closed, that every projected prompt equals its row's message and carries no context,
 *      shortlist, identifiers, background or clock; it refuses to write anything when one does not;
 *   5. leaves the sealed test under eval/suites/<corpus>/ and records its fingerprint.
 *
 * It never fills in missing answers and never authorizes training (AGENTS.md rule 3).
 *
 *   node tools/research/prepare-experiment.mjs [--corpora formalizer-v1]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {barePrompt} from '../../server/llm.mjs';
import {parse} from '../../sop/parser.mjs';
import {checkModelProgram} from '../../sop/declarative.mjs';
import {assert} from '../../lib/util.mjs';
import {readJsonlShardedSync, jsonlExists, hashJsonlSharded} from '../../lib/jsonl-shards.mjs';
import {corpusDir, corpusNames, resolveDatasetPath} from '../../lib/dataset-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const tally = (values, pick) => Object.fromEntries([...values.reduce((map, value) => map.set(pick(value), (map.get(pick(value)) ?? 0) + 1), new Map())].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/** The only prompt profile a projection may carry: the prompt is the user's message. */
export const PROMPT_PROFILE = 'message-only';
/** Text that would mean a prompt carries more than the message (the retired CONTEXT projection, ids, scaffolding). */
export const FORBIDDEN_PROMPT = [/^CONTEXT\b/, /\nMESSAGE\n/, /"entities"\s*:/, /"predicates"\s*:/, /background_(assertions|rules)/, /canonicalMentions/, /\bshortlist\b/i];

/** Fail closed unless `prompt` is exactly the row's message (its `question`) and carries nothing else. */
export function assertMessageOnly(row, prompt) {
  assert(typeof row.question === 'string' && row.question.length > 0, `${row.id}: a row needs its message in question`);
  assert(prompt === row.question, `${row.id}: the projected prompt must equal the user's message`);
  assert(row.model_input === undefined || row.model_input === row.question, `${row.id}: model_input differs from the message`);
  assert(!(row.context_assertions ?? []).length, `${row.id}: context_assertions are not model input; the whole message belongs in question`);
  for (const pattern of FORBIDDEN_PROMPT) assert(!pattern.test(prompt), `${row.id}: the prompt carries context (${pattern})`);
  return prompt;
}

/** The training projection of one formalization row: the message as prompt, the model-language target. */
export function project(row) {
  const prompt = assertMessageOnly(row, barePrompt(row.question));
  return {id: row.id, prompt, target: row.sop_target, group: row.split_group_id, language: row.language, family: row.family, question_type: row.question_type ?? null};
}

function checkCorpus(corpus, rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.split_group_id)) groups.set(row.split_group_id, new Set());
    groups.get(row.split_group_id).add(row.split);
  }
  const crossing = [...groups].filter(([, splits]) => splits.size > 1).map(([key]) => key);
  assert(crossing.length === 0, `${corpus}: connected groups cross splits: ${crossing.slice(0, 5).join(', ')}`);
  for (const row of rows) {
    assert(row.evaluation_track === 'formalization', `${corpus}: ${row.id} is not a formalization row`);
    checkModelProgram(parse(row.sop_target));
  }
  return groups.size;
}

function discover() {
  const i = process.argv.indexOf('--corpora');
  if (i >= 0) return process.argv[i + 1].split(',').map(name => name.trim()).filter(Boolean);
  return corpusNames(root)
    .filter(name => fs.existsSync(path.join(root, corpusDir(name, root), 'manifest.json')))
    .filter(name => JSON.parse(fs.readFileSync(path.join(root, corpusDir(name, root), 'manifest.json'), 'utf8')).format === 'chatsop-corpus-manifest-v2');
}

async function main() {
  const corpora = discover();
  assert(corpora.length > 0, 'No model-language corpus manifest found under datasets/*/manifest.json');
  // Project everything first; nothing is written unless every corpus passes every check.
  const outputs = [];
  for (const corpus of corpora) {
    const base = path.join(root, corpusDir(corpus, root));
    const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
    // Splits may be sharded (lib/jsonl-shards.mjs); the projections are small and written as single files.
    const splits = Object.fromEntries(['train', 'dev'].map(split => [split, readJsonlShardedSync(path.join(root, resolveDatasetPath(manifest.splits[split])))]));
    const testFile = manifest.splits.test ? path.join(root, resolveDatasetPath(manifest.splits.test)) : null;
    const test = testFile && jsonlExists(testFile) ? readJsonlShardedSync(testFile) : [];
    const groups = checkCorpus(corpus, [...splits.train, ...splits.dev, ...test]);
    const projected = Object.fromEntries(Object.entries(splits).map(([split, rows]) => [split, rows.map(project)]));
    outputs.push({corpus, base, manifest, projected, groups, testFile, test});
  }
  for (const {corpus, base, projected, groups, testFile, test} of outputs) {
    const dir = path.join(base, 'formalizer');
    fs.mkdirSync(dir, {recursive: true});
    const files = {};
    for (const [split, rows] of Object.entries(projected)) {
      const text = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
      fs.writeFileSync(path.join(dir, `${split}.jsonl`), text);
      files[`${corpusDir(corpus, root)}/formalizer/${split}.jsonl`] = {rows: rows.length, sha256: sha256(text)};
    }
    const projection = {
      format: 'chatsop-formalizer-projection-v1', corpus, prompt_profile: PROMPT_PROFILE, prompt: 'barePrompt(row.question): the user message and nothing else',
      created: new Date().toISOString().slice(0, 10), training_authorized: false, review_status: 'not_reviewed', files, connected_groups: groups,
      by_question_type: tally([...projected.train, ...projected.dev], row => row.question_type),
      sealed_test: testFile ? {file: path.relative(root, testFile), rows: test.length, sha256: await hashJsonlSharded(testFile)} : null,
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(projection, null, 2) + '\n');
    console.log(JSON.stringify({corpus, prompt_profile: PROMPT_PROFILE, files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, value.rows])), sealed_test: projection.sealed_test?.file ?? null}));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
