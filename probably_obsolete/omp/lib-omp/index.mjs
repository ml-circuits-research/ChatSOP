/** omp integration (DS022): model discovery, a fenced non-interactive run, and the authoring loop. Settings: `omp` in config/runtime.json. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {OmpModels} from './models.mjs';
import {ensureAgentDir, PROXY_PROVIDER} from './agent-dir.mjs';
import {providerSettings} from '../../../lib/llm-providers.mjs';

export {OmpModels, costClassOf} from './models.mjs';
export {runOmp, ompArguments, readSessionUsage, ompEnvironment} from './run.mjs';
export {ensureAgentDir, PROXY_PROVIDER} from './agent-dir.mjs';
export {authorCircuits, validateAuthored, checkFiles, taskText, vocabularyOf, LIMITS} from './author.mjs';

export const DEFAULT_OMP = Object.freeze({enabled: true, bin: 'omp', timeoutSeconds: 600, maxFixRounds: 3, maxConcurrent: 2, modelsCacheSeconds: 600, defaultModel: null,
  subscriptionProviders: null, thinking: null, proxyProvider: 'openference'});

/** The omp settings from the runtime configuration; `CHATSOP_OMP_BIN` overrides the binary (tests use a stub). */
export function ompSettings(config = {}, env = process.env) {
  const merged = {...DEFAULT_OMP, ...(config.omp ?? {})};
  if (env.CHATSOP_OMP_BIN) merged.bin = env.CHATSOP_OMP_BIN;
  // `omp.proxyProvider` names the `llmProviders` entry (the local proxy LLMAPIProvider) that omp may use as the provider
  // `llmapiprovider`; omp then runs with an overlay agent dir (lib/omp/agent-dir.mjs). Not with a stub omp, and not when the caller set its own.
  if (merged.proxyProvider && !env.CHATSOP_OMP_BIN && !env.PI_CODING_AGENT_DIR && !merged.agentDir) {
    const provider = providerSettings(config)[merged.proxyProvider];
    if (provider) {
      try { merged.agentDir = ensureAgentDir({provider: {baseUrl: provider.baseUrl, models: [{id: provider.model}]}}); env.PI_CODING_AGENT_DIR = merged.agentDir; }
      catch (error) { merged.agentDirError = error.message; }
    }
  }
  return merged;
}

export function createOmpModels(settings, run) {
  const classes = settings.subscriptionProviders ? {subscription: settings.subscriptionProviders} : {};
  return new OmpModels({bin: settings.bin, ttlMs: settings.modelsCacheSeconds * 1000, ...(run ? {run} : {}), classes,
    readConfig: async () => fs.readFileSync(path.join(os.homedir(), '.omp/agent/config.yml'), 'utf8')});
}
