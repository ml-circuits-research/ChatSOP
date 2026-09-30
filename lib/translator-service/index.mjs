/**
 * TranslatorService (lib/translator-service/): translation toward English as a component separate from SymbolicLM
 * (owner decision 2026-09-29, DS021 "TranslatorService"). SymbolicLM keeps language id, spelling, UD parsing and
 * SOP generation, and calls TranslatorService when a route needs translation; TranslatorService itself never
 * parses or emits SOP.
 *
 * Backends are pluggable by name and loaded lazily (`loadBackend`). The `symbolic` backend
 * (lib/translator-service/backends/symbolic.mjs, moved here unchanged from the former
 * lib/symbolic-lm/translate.mjs) is the only one wired into the runtime pipeline: it translates from a Romanian UD
 * parse it is handed (SymbolicLM already produced that parse for its own purposes). `opus-mt` and `apertium`
 * (lib/translator-service/backends/opus-mt.mjs, apertium.mjs) are research backends that translate raw
 * (name/number/quote-masked) text through an external CPU translator; they are exercised by
 * tools/research/translator-compare-eval.mjs (experiment eval-translator-compare-v1) and are not called by
 * SymbolicLM. A backend is adopted into the runtime pipeline only after a preregistered comparison, per DS010.
 */

export const BACKENDS = Object.freeze({
  symbolic: () => import('./backends/symbolic.mjs'),
  'opus-mt': () => import('./backends/opus-mt.mjs'),
  apertium: () => import('./backends/apertium.mjs'),
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
