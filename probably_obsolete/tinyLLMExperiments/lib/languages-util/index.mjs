/**
 * LanguagesUtil (lib/languages-util/): language-level utilities split out of SymbolicLM (owner decision
 * 2026-09-29, DS021 "LanguagesUtil") — per-token/message language identification (`langid.mjs`, moved unchanged
 * from the former `lib/symbolic-lm/langid.mjs`) and the conservative symbolic spelling corrector (`spellfix.mjs`,
 * moved unchanged from the former `lib/spellfix.mjs`). SymbolicLM keeps UD parsing, SOP Lang generation, the
 * uncertainty signal and routing, and calls LanguagesUtil for both; TranslatorService (lib/translator-service/)
 * may also call it to decide which words of a message need translating (for example the `matrix` frame-language
 * detection below, used by the mixed-message route of `eval-translator-compare-v1`).
 */
export {identify, lexiconsFromSpellfix, LANGID_VERSION} from './langid.mjs';
export {loadSpellfix, SPELLFIX_VERSION, DEFAULTS} from './spellfix.mjs';
export {detectFrame, FRAME_VERSION} from './frame.mjs';
