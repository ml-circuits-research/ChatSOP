/**
 * TranslatorService (lib/translator-service/): translation toward English as a component separate from SymbolicLM
 * (owner decision 2026-09-29, DS021 "TranslatorService"). SymbolicLM keeps language id, spelling, UD parsing and
 * SOP generation, and calls TranslatorService when a route needs translation; TranslatorService itself never
 * parses or emits SOP.
 *
 * Backends are pluggable by name and loaded lazily (`loadBackend`). The `symbolic` backend
 * (lib/translator-service/backends/symbolic.mjs, moved here unchanged from the former
 * lib/symbolic-lm/translate.mjs) is the only one wired into the runtime pipeline: it translates from a Romanian UD
 * parse it is handed (SymbolicLM already produced that parse for its own purposes), and `gloss`. The research backends `opus-mt`
 * and `apertium` (tools/research/translator-backends/) translate raw (name/number/quote-masked) text through an external CPU
 * translator; they are not part of the product: tools/research/translator-compare-eval.mjs imports them directly
 * (experiment eval-translator-compare-v1). A backend is adopted into the runtime pipeline only after a preregistered
 * comparison, per DS010.
 */

export const BACKENDS = Object.freeze({
  symbolic: () => import('./backends/symbolic.mjs'),
  gloss: () => import('./backends/gloss.mjs'),
});

/** Load a translator backend module by name (default `symbolic`, the only one wired into the runtime pipeline). */
export function loadBackend(name = 'symbolic') {
  const loader = BACKENDS[name];
  if (!loader) throw Error(`TranslatorService: unknown backend "${name}" (known: ${Object.keys(BACKENDS).join(', ')})`);
  return loader();
}

// Re-exported for SymbolicLM and other direct callers of the default (symbolic) backend: unchanged call surface
// from the former lib/symbolic-lm/translate.mjs.
export {translateParse, joinPieces, TRANSLATE_VERSION, Translator} from './backends/symbolic.mjs';
// Mode `gloss` (morphology-aware word-by-word gloss that keeps Romanian word order; input of LanguageProofingLLM).
export {glossMessage, glossParse, glossStats, GLOSS_VERSION} from './backends/gloss.mjs';
