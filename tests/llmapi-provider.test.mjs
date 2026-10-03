// Runs the LLMAPIProvider tests (local stub upstream, no network; the small-model service with fake backends) as part of npm test.
import '../LLMAPIProvider/proxy.test.mjs';
import '../LLMAPIProvider/local-services/small-models/server.test.mjs';
