/**
 * The query author library (DS031 "codingAgentQuery"): (a) the prompt/context builder, (b) the validate-and-repair loop and
 * (c) pluggable backends, all producing the same `query.sop` contract. Calibration runs every model through `authorQuery`, so
 * the prompt, the vocabulary and the loop are identical and only the backend differs.
 *
 *   import {authorQuery, ompBackend, completionBackend} from './lib/query-author/index.mjs';
 *   const r = await authorQuery({message, lexicon, backend: completionBackend({endpoint: 'http://127.0.0.1:8080/v1', model: 'qwen3-4b'})});
 */
export {buildContext, guideTexts, describeProblems, SKILL_FILES} from './context.mjs';
export {renderVocabulary} from './vocabulary.mjs';
export {validateQuery, unclearKind, defaultAdmit, AUTHOR_TYPES} from './validate.mjs';
export {authorQuery} from './loop.mjs';
export {ompBackend} from './backends/omp.mjs';
export {completionBackend, extractSop} from './backends/completion.mjs';

/** A backend from a settings object: `{kind: 'omp', model, ...}` or `{kind: 'completion', endpoint, model, apiKeyEnv, ...}`. */
import {ompBackend} from './backends/omp.mjs';
import {completionBackend} from './backends/completion.mjs';
export function backendFrom(settings = {}, defaults = {}) {
  const kind = settings.kind ?? 'omp';
  if (kind === 'omp') return ompBackend({...defaults, ...settings});
  if (kind === 'completion') return completionBackend({...defaults, ...settings});
  throw Object.assign(new Error(`unknown query author backend ${JSON.stringify(kind)}; use omp or completion`), {code: 'invalid_backend', status: 400});
}
