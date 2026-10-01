/**
 * textToCleanEnglish (owner decision 2026-09-30, journaled; DS012 "textToCleanEnglish", DS021 "textToCleanEnglish"):
 * a host step that runs in the chat UI BEFORE formalization, entirely outside the small formalizer's own model
 * boundary (AGENTS.md "Model boundary"). Romanian, mixed Romanian/English and badly written English are
 * corrected, translated toward English and simplified here; the user reviews the proposal (accept, edit, or send
 * the original) before anything is formalized. This is a UI convenience, not a repository write and not a change
 * to DS021: the formalizer still receives exactly the one message the user finally sent, with no context, and it
 * still accepts English, Romanian and mixed text on its own (DS021 "Input languages and content words") — this
 * component only gives the user an English-language preview to check before that happens.
 *
 * The `llm` backend is LanguageProofingLLM (Romanian, mixed and badly written English into acceptable English; today
 * the fine-tuned Gemma 3 270M of run language-proofing-gemma270m-prod1, registry id `language-proofing-llm`) and
 * `languagetool` is LanguageTool, an optional backend that is off by default; SymbolicProofingLLM is a different model (correct English into the limited English SymbolicLM
 * understands) and is not called here. Names: DS021 "Names, roles and datasets".
 *
 * `textToCleanEnglish(message, options)` is the whole surface: it runs the cheap gate (`gate.mjs`, LanguagesUtil
 * alone, no backend) and, only when it reports something to check, calls the configured backend and returns
 * `{original, clean, changed, reasons, spans, backend, confidence}` (`spans`: `diffWords`'s word-level diff).
 * `config/text-to-clean-english.json` (`enabled`, `backends.english`/`backends.nonEnglish`: `languagetool`, `llm`
 * or `none`, plus each backend's own options such as `llm.sendAll`) chooses the behavior; the message is split into
 * sentences and each is gated and routed alone; `enabled: false` always returns the message
 * unchanged (`backend: "none"`) without ever loading the gate's resources or calling anything. An unreachable or
 * unconfigured backend throws an Error with `.code = 'backend_unavailable'`; the caller (`server/http.mjs`)
 * degrades that to "no change" rather than failing the chat request.
 *
 * Backends (`backends/`), loaded by name from the config:
 *   - `languagetool` an external LanguageTool HTTP server (LGPL, `dependencies.md`, DS014): fast and safe for
 *     monolingual noisy English once names, numbers and quotes are masked first (survey
 *     `text-to-clean-english-v1`: unmasked, it corrupts unknown proper names); it never translates.
 *   - `llm`          LanguageProofingLLM behind a chat-completion endpoint (the registry model with the `proofread`
 *     capability, started on demand by `server/formalizers.mjs` `FormalizerManager.ensure` and passed in as
 *     `options.backendOptions.endpoint`): proofreads, translates and simplifies in one pass; one sentence per
 *     call, the message-only prompt of its training.
 *   - `none`         never called; `backends.english`/`backends.nonEnglish: "none"` disables cleaning for that
 *     message class only (the gate still runs, so `reasons` still explains what it found).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gate} from './gate.mjs';
import {splitSentences} from '../sentence-split.mjs';
import {createLanguageToolBackend} from './backends/languagetool.mjs';
import {createLlmBackend} from './backends/llm.mjs';

export const TEXT_TO_CLEAN_ENGLISH_VERSION = 'text-to-clean-english-v1';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config/text-to-clean-english.json');
const DEFAULT_CONFIG = Object.freeze({enabled: true, backends: {english: 'none', nonEnglish: 'none'}, languagetool: {}, llm: {}});

let configCache = null;
function loadConfig(configPath) {
  if (configCache?.path === configPath) return configCache.config;
  let config = DEFAULT_CONFIG;
  try { config = {...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, 'utf8'))}; }
  catch { /* no config file: cleaning stays off (backends default to 'none') */ }
  configCache = {path: configPath, config};
  return config;
}

/** The loaded `config/text-to-clean-english.json` (defaults when the file is missing), for callers that need a setting such as `llm.model`. */
export const loadTextToCleanEnglishConfig = (configPath = DEFAULT_CONFIG_PATH) => loadConfig(configPath);

const unchanged = (original, reasons = []) => ({original, clean: original, changed: false, reasons, spans: [], backend: 'none', confidence: 1});

function backendUnavailable(message) { return Object.assign(new Error(message), {code: 'backend_unavailable'}); }

/** Word-and-whitespace tokens, so a diff span never splits a word. */
function tokenizeWords(text) {
  return String(text ?? '').match(/\S+|\s+/g) ?? [];
}

/**
 * A word-level diff of `a` (original) against `b` (clean): `[{type: 'equal'|'delete'|'insert', text}]`, in order,
 * adjacent same-type spans merged. Longest-common-subsequence on whitespace-preserving tokens; short chat messages
 * only, so the O(n*m) table is cheap.
 */
export function diffWords(a, b) {
  const left = tokenizeWords(a), right = tokenizeWords(b);
  const n = left.length, m = right.length;
  const table = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const spans = [];
  const push = (type, text) => {
    const last = spans.at(-1);
    if (last && last.type === type) last.text += text; else spans.push({type, text});
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) { push('equal', left[i]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push('delete', left[i]); i++; }
    else { push('insert', right[j]); j++; }
  }
  while (i < n) { push('delete', left[i]); i++; }
  while (j < m) { push('insert', right[j]); j++; }
  return spans;
}

function resolveBackend(name, config, backendOptions) {
  if (name === 'languagetool') return createLanguageToolBackend({...config.languagetool, ...backendOptions.languagetool});
  if (name === 'llm') {
    const url = backendOptions.endpoint ?? config.llm?.url;
    if (!url) throw backendUnavailable('textToCleanEnglish: no translate-capable model endpoint is available for the llm backend');
    return createLlmBackend({...config.llm, ...backendOptions.llm, url});
  }
  throw Error(`textToCleanEnglish: unknown backend "${name}" (known: languagetool, llm, none)`);
}

/**
 * Clean one message, sentence by sentence (only sentences the gate flags reach a backend, all of them with
 * `llm.sendAll: true` or `options.sendAll`). `options`: `configPath` (default `config/text-to-clean-english.json`),
 * `config` (an object, bypassing the file for tests), `sendAll`, `backendOptions` (`{endpoint}` the base URL of the
 * LanguageProofingLLM server for the `llm` backend, or a function returning it, and/or `{languagetool, llm}`
 * per-call overrides), `gateResources` (LanguagesUtil overrides passed to `gate()`, for tests), `partial` (a failed sentence stays as written and is listed in `failures`), `memo` (an async `(parts, compute) => result` that caches one backend call per sentence; the server's per-model cache). Never throws for "nothing to do"; throws `{code:
 * 'backend_unavailable'}` only when a configured, needed backend cannot run.
 */
export async function textToCleanEnglish(message, options = {}) {
  const original = String(message ?? '');
  const config = options.config ?? loadConfig(options.configPath ?? DEFAULT_CONFIG_PATH);
  if (!config.enabled) return unchanged(original);
  const sendAll = options.sendAll ?? config.llm?.sendAll === true;
  const gateResources = options.gateResources ?? {};
  // The host splits the message (lib/sentence-split.mjs) and each sentence is gated, routed and cleaned alone, the way the
  // model was trained; a sentence the gate finds clean is left as it is unless `sendAll` sends every sentence.
  const units = splitSentences(original);
  const reasons = [];
  const edits = [];
  const backendsUsed = [];
  const confidences = [];
  const failures = [];
  for (const unit of units) {
    const decision = gate(unit.text, gateResources);
    for (const reason of decision.reasons) if (!reasons.includes(reason)) reasons.push(reason);
    const backendName = decision.language === 'en' ? (config.backends?.english ?? 'none') : (config.backends?.nonEnglish ?? 'none');
    if (backendName === 'none' || (!decision.needed && !(sendAll && backendName === 'llm'))) continue;
    // The backend is resolved and called inside `compute`, so a memoized sentence (`options.memo`) never starts a model.
    const compute = async () => {
      let impl;
      try {
        // `endpoint` may be a function (sync or async) that starts the model only when a sentence really needs it.
        const given = options.backendOptions ?? {};
        const endpoint = typeof given.endpoint === 'function' ? await given.endpoint() : given.endpoint;
        impl = resolveBackend(backendName, config, {...given, endpoint});
      }
      catch (error) { if (error.code === 'backend_unavailable') throw error; throw backendUnavailable(error.message); }
      try { return await impl.clean(unit.text, {language: decision.language, reasons: decision.reasons}); }
      catch (error) { throw backendUnavailable(`textToCleanEnglish: backend "${backendName}" failed: ${error.message}`); }
    };
    // `options.memo({backend, language, text}, compute)` lets the server cache one backend call per sentence (lib/cache/lru.mjs).
    let result;
    try { result = options.memo ? await options.memo({backend: backendName, language: decision.language, text: unit.text}, compute) : await compute(); }
    catch (error) {
      // `options.partial`: a sentence whose backend failed stays as written and is reported in `failures`; the others are still cleaned.
      if (!options.partial) throw error;
      failures.push({start: unit.start, end: unit.end, text: unit.text, code: error.code ?? 'backend_failed', message: String(error.message).slice(0, 200)});
      continue;
    }
    // A backend that returns nothing (a model that emits its end token at once) must never propose an empty message:
    // that is a failed backend, and the host degrades it to "no change".
    if (!String(result.text ?? '').trim()) throw backendUnavailable(`textToCleanEnglish: backend "${backendName}" returned no text`);
    if (!backendsUsed.includes(backendName)) backendsUsed.push(backendName);
    confidences.push(result.confidence ?? (result.text === unit.text ? 1 : 0.8));
    if (result.text !== unit.text) edits.push({start: unit.start, end: unit.end, text: result.text.trim()});
  }
  if (!backendsUsed.length) return {...unchanged(original, reasons), ...(failures.length ? {failures} : {})};
  let cleanText = original;
  for (const edit of [...edits].reverse()) cleanText = cleanText.slice(0, edit.start) + edit.text + cleanText.slice(edit.end);
  return {
    original,
    clean: cleanText,
    changed: cleanText !== original,
    reasons,
    spans: diffWords(original, cleanText),
    backend: backendsUsed.join('+'),
    confidence: Math.min(...confidences),
    ...(failures.length ? {failures} : {}),
  };
}
