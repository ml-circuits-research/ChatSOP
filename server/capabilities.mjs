/**
 * The service facts of the server (DS009 "Capabilities and caches"): the versions of the components that produce an answer and the
 * statistics of the one cache that exists, the request parser's circuit cache (server/query-parser.mjs).
 *
 * Every component is named once here so that `GET /v1/capabilities` and the trace of a turn agree: the circuit language and its guide
 * version (lib/query-author), the request parser with its model chain, the reasoning router and the answer renderer.
 */
import {SKILL_FILES} from '../lib/query-author/index.mjs';

export const API_VERSION = 'capability-api-v2';
export const RENDERER_VERSION = 'answer-text-v1';

export function createCapabilities({queryParser = null} = {}) {
  const chain = () => queryParser?.settings.models ?? [];
  return {
    versions: () => ({
      api: API_VERSION,
      request_parser: {parser: 'coding_agent', backend: queryParser?.settings.backend.kind ?? null, models: chain(), guide_files: SKILL_FILES.length},
      reasoning: {router: 'StrategyRouter v1', oracle: 'js-reference'},
      renderer: RENDERER_VERSION,
    }),
    cacheStats: () => (queryParser ? {'query-parser': {entries: queryParser.stats().cache_size, hits: queryParser.stats().cache_hits, requests: queryParser.stats().requests}} : {}),
    clearCaches: () => queryParser?.clearCache(),
    close: () => {},
  };
}
