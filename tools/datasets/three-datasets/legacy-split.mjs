/** Split rule of the two legacy out-of-distribution and wild suites across train, dev and test of the three datasets
 * (owner decision 2026-09-30, DS008 "Form coverage and form variants"; it supersedes the earlier rule that rows of the sealed legacy
 * suites go only to the test). Pure: no file is named or read here (the auditor-side tool tools/eval/legacy-resplit.mjs reads the legacy
 * files and writes the train and dev parts into datasets_archive/, which the builders read like any legacy corpus).
 *
 * The owner decided that the only generalization tested is the same form with different words, and that the forms of the legacy OOD and
 * wild suites are learning material. Their rows are split by split group (a row without a group is its own group) with the proportions
 * of the other sources (70% train, 15% dev, 15% test) and a fixed seed, so every rebuild gives the same split.
 */
import {createHash} from 'node:crypto';

export const LEGACY_SPLIT_SEED = 'legacy-resplit-v1';
export const LEGACY_PROPORTIONS = Object.freeze({train: 70, dev: 15, test: 15});

/** `train`, `dev` or `test` of a legacy row, by its split group. */
export function legacySplitOf(row, corpus) {
  const group = row.split_group_id ?? row.id;
  const bucket = parseInt(createHash('sha1').update(`${LEGACY_SPLIT_SEED}:${corpus}:${group}`).digest('hex').slice(0, 8), 16) % 100;
  return bucket < LEGACY_PROPORTIONS.train ? 'train' : bucket < LEGACY_PROPORTIONS.train + LEGACY_PROPORTIONS.dev ? 'dev' : 'test';
}
