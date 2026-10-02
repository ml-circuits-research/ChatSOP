/**
 * The query author library (DS022 "LLMDirect"): (a) the prompt/context builder, (b) the validate-and-repair loop and
 * (c) the direct chat-completion backend, all producing the same `query.sop` contract. Calibration runs every model through
 * `authorQuery`, so the prompt, the vocabulary and the loop are identical and only the model differs. The omp backend was retired on
 * 2026-10-02 (owner: no formalization through omp; probably_obsolete/omp/).
 *
 *   import {authorQuery, completionBackend} from './lib/query-author/index.mjs';
 *   const r = await authorQuery({message, lexicon, backend: completionBackend({endpoint: 'http://127.0.0.1:8080/v1', model: 'qwen3-4b'})});
 */
export {buildContext, guideTexts, describeProblems, SKILL_FILES, MODES} from './context.mjs';
export {renderVocabulary, renderCandidates, renderEntityHints, renderIndex} from './vocabulary.mjs';
export {candidatePredicates, entityHints, predicateRecall, nearestPredicates, CORE_PREDICATES, stem} from './retrieval.mjs';
export {validateQuery, unclearKind, defaultAdmit, AUTHOR_TYPES} from './validate.mjs';
export {authorQuery} from './loop.mjs';
export {completionBackend, extractSop} from './backends/completion.mjs';

/** A backend from a settings object `{kind: 'completion', endpoint, model, apiKeyEnv, ...}` (the only kind). */
import {completionBackend} from './backends/completion.mjs';
export function backendFrom(settings = {}, defaults = {}) {
  const kind = settings.kind ?? 'completion';
  if (kind === 'completion') return completionBackend({...defaults, ...settings});
  throw Object.assign(new Error(`unknown query author backend ${JSON.stringify(kind)}; models are called directly (completion)`), {code: 'invalid_backend', status: 400});
}
