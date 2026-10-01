/** omp integration (DS022): model discovery, a fenced non-interactive run, and the authoring loop. Settings: `omp` in config/runtime.json. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {OmpModels} from './models.mjs';

export {OmpModels, costClassOf} from './models.mjs';
export {runOmp, ompArguments, readSessionUsage, ompEnvironment} from './run.mjs';
export {authorCircuits, validateAuthored, checkFiles, taskText, vocabularyOf, LIMITS} from './author.mjs';

export const DEFAULT_OMP = Object.freeze({enabled: true, bin: 'omp', timeoutSeconds: 600, maxFixRounds: 3, maxConcurrent: 2, modelsCacheSeconds: 600, defaultModel: null,
  subscriptionProviders: null, thinking: null});

/** The omp settings from the runtime configuration; `CHATSOP_OMP_BIN` overrides the binary (tests use a stub). */
export function ompSettings(config = {}, env = process.env) {
  const merged = {...DEFAULT_OMP, ...(config.omp ?? {})};
  if (env.CHATSOP_OMP_BIN) merged.bin = env.CHATSOP_OMP_BIN;
  return merged;
}

export function createOmpModels(settings, run) {
  const classes = settings.subscriptionProviders ? {subscription: settings.subscriptionProviders} : {};
  return new OmpModels({bin: settings.bin, ttlMs: settings.modelsCacheSeconds * 1000, ...(run ? {run} : {}), classes,
    readConfig: async () => fs.readFileSync(path.join(os.homedir(), '.omp/agent/config.yml'), 'utf8')});
}
