/**
 * The independent capabilities of the server and their caches (DS030 "Capability APIs and caching").
 *
 * Five capabilities, each usable alone and by the chat page alone: `proofread` (LanguageProofingLLM through textToCleanEnglish),
 * `understand` (SymbolicLM analysis + interpretation CNL + certification, optionally after the gated SymbolicProofingLLM rewrite),
 * `rewrite` (SymbolicProofingLLM alone), `analyze` (the raw SymbolicLM analysis) and `emotion` (EmotionDetectionSystem, DS029).
 * Every result carries `timings`, `cache` and `versions`; the expensive calls sit behind small bounded caches (lib/cache/lru.mjs)
 * whose keys contain the capability, the model or run version, the exact input and the options, so a model switch never serves a
 * stale result and concurrent identical requests share one computation.
 *
 * Principle (owner, 2026-10-01): analysis never fails totally. A component that cannot run is reported in `errors`, what could be
 * understood is still returned, the failed or unrepresented parts are marked, and `clarify` proposes a follow-up message.
 * The chat's formalize request calls `symbolicFormalize` and `emotionFor`, the same cached calls as the independent APIs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCacheSet, cacheKey} from '../lib/cache/lru.mjs';
import {textToCleanEnglish, loadTextToCleanEnglishConfig, TEXT_TO_CLEAN_ENGLISH_VERSION} from '../lib/text-to-clean-english/index.mjs';
import {gate as gateCleaning} from '../lib/text-to-clean-english/gate.mjs';
import {splitSentences} from '../lib/sentence-split.mjs';
import {SYMBOLIC_LM_VERSION} from '../lib/symbolic-lm/index.mjs';
import {INTERPRETATION_VERSION} from '../lib/symbolic-lm/interpretation.mjs';
import {createDefaultEmotionDetectionSystem, loadConfig as loadEmotionConfig, signalsToSop, adviceFor} from '../lib/emotion-detection/index.mjs';
import {chatMessages} from '../lib/llama-chat.mjs';
import {detectAnalysis} from '../lib/symbolic-lm/scope-detect.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The SymbolicProofingLLM rewrite settings (DS012 "Understanding in the chat"): off, gated (rewriteWhen trees + rewriteAccept certified) or always (every sentence, every rewrite kept). */
export const REWRITE_MODES = Object.freeze(['off', 'gated', 'always']);
export const REWRITE_ACCEPT = Object.freeze(['off', 'certified', 'certified_compare']);
const REWRITE_OPTIONS = {gated: {rewrite_when: 'trees', rewrite_accept: 'certified'}, always: {rewrite_when: 'always', rewrite_accept: 'off'}};

const round = value => Math.round(value * 100) / 100;
const failure = (code, message, status = 503) => Object.assign(new Error(message), {code, status});
const errorOf = (component, error) => ({component, code: error.code ?? 'component_failed', message: String(error.message).slice(0, 300)});
const worst = statuses => statuses.length && statuses.every(s => s === 'hit' || s === 'shared') ? 'hit' : 'miss';

/** The component statuses of one request: `cache` is `hit` when every expensive component came from a cache (stored or shared in flight), else `miss`. */
function cacheReport(detail) {
  const statuses = Object.values(detail);
  return {cache: worst(statuses), cache_detail: detail};
}

export function createCapabilities({registry = null, manager = null, timeoutMs = 30000, cache = {}, emotion = null, emotionConfig = null} = {}) {
  const caches = createCacheSet({maxEntries: cache.maxEntries ?? 256, maxBytes: cache.maxBytes ?? 8_000_000, ttlMs: cache.ttlMs ?? 15 * 60_000, failureTtlMs: cache.failureTtlMs ?? 0});
  const store = {
    proofread: caches.add('proofread', {maxEntries: 200, maxBytes: 2_000_000}),
    proofreadLlm: caches.add('proofread-llm', {maxEntries: 600, maxBytes: 2_000_000}),
    symbolic: caches.add('symbolic-lm', {maxEntries: 200, maxBytes: 16_000_000}),
    rewriteLlm: caches.add('symbolic-proofing-llm', {maxEntries: 600, maxBytes: 2_000_000}),
    emotion: caches.add('emotion', {maxEntries: 500, maxBytes: 4_000_000}),
  };

  // ---- registry facts: which model serves what, and its version ----
  const modelOf = id => registry?.models.find(m => m.id === id) ?? null;
  const versionOf = id => {
    const model = modelOf(id);
    if (!model) return null;
    const file = model.gguf ?? model.service ?? null;
    if (!file) return {id, run: null, file: null, stamp: null};
    const stat = fs.statSync(file, {throwIfNoEntry: false});
    const relative = path.relative(ROOT, file);
    return {id, run: model.gguf && !relative.startsWith('..') ? relative.split(path.sep)[2] ?? null : null, file: relative.startsWith('..') ? path.basename(file) : relative, stamp: stat ? `${stat.size}-${Math.round(stat.mtimeMs)}` : 'missing'};
  };
  const versionKey = id => { const v = versionOf(id); return v ? `${v.file}@${v.stamp}` : 'none'; };
  const proofreadId = () => {
    if (!registry || !manager) return null;
    const wanted = loadTextToCleanEnglishConfig().llm?.model;
    return (wanted && registry.models.some(m => m.id === wanted && m.capabilities.includes('proofread')) ? wanted : null) ?? registry.defaults?.proofread ?? null;
  };
  /** The translator LLM (registry capability `translate-clean`) that serves Romanian and mixed sentences; null when the registry has none. */
  const translatorId = () => {
    if (!registry || !manager) return null;
    const wanted = loadTextToCleanEnglishConfig().translator?.model;
    return (wanted && registry.models.some(m => m.id === wanted && m.capabilities.includes('translate-clean')) ? wanted : null) ?? registry.defaults?.['translate-clean'] ?? null;
  };
  const symbolicId = () => registry && manager ? (modelOf('symbolic-lm') && manager.entries.has('symbolic-lm') ? 'symbolic-lm' : registry.models.find(m => m.kind === 'service')?.id ?? null) : null;
  const rewriteId = () => registry?.defaults?.['proofread-symbolic'] ?? null;
  /** The default of the rewrite setting: `rewrite.mode` of the SymbolicLM registry entry (off unless the owner decides otherwise). */
  const rewriteDefault = () => { const mode = modelOf('symbolic-lm')?.rewriteMode; return REWRITE_MODES.includes(mode) ? mode : 'off'; };

  // ---- EmotionDetectionSystem ----
  const config = emotionConfig ?? loadEmotionConfig();
  const system = emotion ?? createDefaultEmotionDetectionSystem(config, {enabled: true});
  const emotionSig = cacheKey(config, system.strategyIds());
  const emotionDefault = () => loadEmotionConfig().enabled !== false;

  function versions(used = []) {
    const all = {
      api: 'capability-api-v1',
      text_to_clean_english: TEXT_TO_CLEAN_ENGLISH_VERSION,
      language_proofing_llm: versionOf(proofreadId()),
      translator_llm: versionOf(translatorId()),
      symbolic_lm: {version: SYMBOLIC_LM_VERSION, service: symbolicId()},
      interpretation: INTERPRETATION_VERSION,
      symbolic_proofing_llm: versionOf(rewriteId()),
      emotion: {config: emotionSig.slice(0, 12), strategies: system.strategyIds()},
    };
    return used.length ? Object.fromEntries(['api', ...used].map(k => [k, all[k]])) : all;
  }

  // ---- proofread ----
  async function proofread(message, {sendAll} = {}) {
    const started = performance.now();
    const cleaning = loadTextToCleanEnglishConfig();
    const llmId = proofreadId();
    const effectiveSendAll = typeof sendAll === 'boolean' ? sendAll : cleaning.llm?.sendAll === true;
    const trId = translatorId();
    const key = cacheKey('proofread', TEXT_TO_CLEAN_ENGLISH_VERSION, llmId ? versionKey(llmId) : 'none', trId ? versionKey(trId) : 'none', message, {sendAll: effectiveSendAll, backends: cleaning.backends, enabled: cleaning.enabled});
    const units = {hit: 0, miss: 0, shared: 0};
    const {value, status} = await store.proofread.getOrCompute(key, async () => {
      const t0 = performance.now();
      const endpoint = llmId ? () => manager.ensure(llmId) : null;
      const translatorEndpoint = trId ? () => manager.ensure(trId) : null;
      // One turn holds both cleaning models until it ends: no other start may evict the translator or the proofreader in the middle of it.
      const release = manager?.hold([llmId, trId].filter(Boolean)) ?? (() => {});
      // One cache entry per sentence and backend; a sentence the fallback served is never stored under the translator's key.
      const memo = (parts, compute) => store.proofreadLlm.getOrCompute(cacheKey('proofread-llm', parts.backend === 'translator-llm' && trId ? versionKey(trId) : llmId ? versionKey(llmId) : 'none', parts), compute, {cacheable: v => !v.fallback}).then(r => { units[r.status]++; return r.value; });
      try {
        const outcome = await textToCleanEnglish(message, {backendOptions: {endpoint, translatorEndpoint}, sendAll: effectiveSendAll, partial: true, memo});
        return {outcome, ms: round(performance.now() - t0)};
      } finally { release(); }
    }, {cacheable: v => !v.outcome.failures && !v.outcome.fallback});
    const {outcome} = value;
    const errors = (outcome.failures ?? []).map(f => ({component: 'language-proofing-llm', code: f.code, message: f.message, span: f.text}));
    // A translator that could not run is not an error of the request (the fallback answered) but is never silent: `fallback` and `routes` say so.
    const warnings = (outcome.fallbacks ?? []).map(f => ({component: f.from, code: 'fallback', message: `${f.from} unavailable, ${f.to} answered: ${f.reason}`, span: null}));
    return {object: 'language.proofread', ...outcome, status: errors.length ? 'partial' : 'ok', errors, warnings, sentence_cache: units,
      timings: {total_ms: round(performance.now() - started), compute_ms: value.ms}, cache: worst([status]), cache_detail: {proofread: status, llm_sentences: units},
      versions: versions(['text_to_clean_english', 'language_proofing_llm', 'translator_llm'])};
  }

  // ---- the SymbolicLM service call (analysis + interpretation), shared by analyze, understand, rewrite and the chat's formalize ----
  /**
   * One cached SymbolicLM service call. `asked`: `{interpret (default true), rewrite (off|gated|always, default from the registry), accept}`.
   * Returns `{sop, ms, symbolic, requested, status}`; throws when the service cannot run (the callers degrade, never fail totally).
   */
  async function symbolicCall(message, asked = {}) {
    const id = symbolicId();
    if (!id) throw failure('symbolic_lm_unavailable', 'No SymbolicLM service is registered on this server');
    const interpret = asked.interpret !== false;
    let mode = asked.rewrite ?? rewriteDefault();
    const requested = {interpret, rewrite: mode};
    const rid = mode === 'off' ? null : rewriteId();
    if (mode !== 'off' && (!rid || !manager?.entries.has(rid))) { requested.rewrite = 'off'; requested.rewrite_error = 'no registry model offers proofread-symbolic'; mode = 'off'; }
    const accept = mode === 'off' ? null : asked.accept ?? REWRITE_OPTIONS[mode].rewrite_accept;
    const keyFor = interpreted => cacheKey('symbolic-lm', SYMBOLIC_LM_VERSION, versionKey(id), message, {interpret: interpreted, mode, accept, rewrite_model: mode === 'off' ? null : versionKey(rid)});
    // An analysis without the interpretation is contained in the same call with it: reuse a stored (or running) interpreted call instead of analysing the message again.
    if (!interpret) {
      const richer = keyFor(true);
      const stored = store.symbolic.get(richer);
      if (stored) return {...stored, requested: {...stored.requested, interpret}, status: 'hit'};
    }
    const {value, status} = await store.symbolic.getOrCompute(keyFor(interpret), async () => {
      const options = {interpret, emotion: false};
      const outRequested = {...requested};
      // The SymbolicLM service and the rewrite model are held for the whole call (never evicted in the middle of a turn).
      const release = manager.hold([id, ...(mode !== 'off' ? [rid] : [])]);
      try {
        if (mode !== 'off') {
          try {
            const url = await manager.proofreadSymbolic(rid, async base => base);
            Object.assign(options, {rewrite_url: url + '/v1/chat/completions', rewrite_version: versionKey(rid)}, REWRITE_OPTIONS[mode], {rewrite_accept: accept});
            outRequested.rewrite_model = rid;
          } catch (error) { outRequested.rewrite = 'off'; outRequested.rewrite_error = String(error.message).slice(0, 200); }
        }
        const reply = await manager.formalize(id, message, {timeoutMs, extra: {symbolic_lm: options}});
        return {sop: reply.sop, ms: round(reply.ms ?? 0), symbolic: reply.symbolic ?? null, requested: outRequested};
      } finally { release(); }
    }, {cacheable: v => !v.requested.rewrite_error});
    return {...value, status};
  }

  /** The chat's formalize request: the same cached call as `understand` (same message and rewrite setting), so the earlier call is reused. */
  const symbolicFormalize = (message, understanding = {}) => symbolicCall(message, {interpret: understanding.interpret, rewrite: understanding.rewrite});

  // ---- emotion ----
  async function emotionFor(message, {leftoverSpans = [], hasContent = true} = {}) {
    const spans = [...new Set(leftoverSpans.map(x => x.span ?? x).filter(Boolean))];
    const key = cacheKey('emotion', emotionSig, message, spans);
    const {value, status} = await store.emotion.getOrCompute(key, async () => {
      const t0 = performance.now();
      const result = await system.detect(message, {leftoverSpans: spans.map(span => ({span}))});
      return {signals: result.signals, leftovers: result.leftovers, trace: result.trace, ms: round(performance.now() - t0)};
    });
    const live = value.signals.filter(s => !s.experimental);
    return {...value, sop: signalsToSop(live), advice: adviceFor(live, {hasContent}), cache: status};
  }
  const emojiOf = signals => {
    const best = new Map();
    for (const s of signals) if (!best.has(s.kind) || best.get(s.kind).score < s.score) best.set(s.kind, s);
    return [...best.values()].sort((a, b) => b.score - a.score).map(s => ({kind: s.kind, emoji: s.emoji ?? '\u{1F4AC}', label: s.label ?? s.kind, score: s.score, span: s.span ?? null, source: s.source ?? null, ...(s.experimental ? {experimental: true} : {})}));
  };

  async function detectEmotion(message, {hasContent = true} = {}) {
    const started = performance.now();
    const result = await emotionFor(message, {hasContent});
    return {object: 'emotion.detection', status: 'ok', message, signals: result.signals, emoji: emojiOf(result.signals), leftovers: result.leftovers, sop: result.sop, advice: result.advice, trace: result.trace,
      timings: {total_ms: round(performance.now() - started), compute_ms: result.ms}, ...cacheReport({emotion: result.cache}), versions: versions(['emotion'])};
  }

  // ---- understand ----
  /** The whole message failed: analyse the sentences one by one so a failing sentence does not hide the others (never a total failure). */
  async function understandBySentence(message, asked) {
    const units = splitSentences(message);
    if (units.length < 2) return null;
    const sentences = [], errors = [], notRepresented = [], parts = [];
    let language = null, rewriteUnits = [];
    for (const unit of units) {
      try {
        const call = await symbolicCall(unit.text, asked);
        parts.push(call);
        const i = call.symbolic?.interpretation;
        language ??= call.symbolic?.language ?? null;
        if (i?.available) {
          for (const s of i.sentences) sentences.push({...s, index: sentences.length, start: s.start + unit.start, end: s.end + unit.start});
          notRepresented.push(...i.not_represented);
          if (i.rewrite?.units) rewriteUnits.push(...i.rewrite.units);
        } else if (i) throw failure('no_interpretation', i.reason ?? 'no interpretation');
      } catch (error) {
        errors.push({...errorOf('symbolic-lm', error), span: unit.text});
        sentences.push({index: sentences.length, text: unit.text, start: unit.start, end: unit.end, status: 'failed', cnl: null, cnl_sentences: [], unverified_cnl: null, round_trip: null, not_represented: [unit.text], framing: [], notes: [], summary: '', certified: null, rewrite: null, error: String(error.message).slice(0, 200)});
        notRepresented.push(unit.text);
      }
    }
    if (!sentences.some(s => s.status !== 'failed')) return {errors};
    const certified = sentences.every(s => s.certified === true) ? true : sentences.some(s => s.certified === false) ? false : null;
    const interpretation = {version: INTERPRETATION_VERSION, available: true, text: message, language: language ?? 'en', sentences, not_represented: [...new Set(notRepresented)], outside_sentences: [], framing: [],
      rewrite: rewriteUnits.length ? {gate: null, acceptance: null, applied: rewriteUnits.some(u => u.accepted), input: message, output: null, units: rewriteUnits} : null, certified};
    return {interpretation, errors, parts};
  }

  /** The follow-up message and its items for what was not understood (DS030 "Never a total failure"); null when everything was represented. */
  function clarification(interpretation, remaining) {
    const items = [];
    for (const span of remaining) items.push({kind: 'not_represented', text: span});
    for (const s of interpretation?.sentences ?? []) {
      if (s.status === 'failed') items.push({kind: 'failed', text: s.text});
      else if (s.status === 'uncertain') items.push({kind: 'uncertain', text: s.text});
    }
    const seen = new Set();
    const unique = items.filter(i => { const k = i.kind + '|' + i.text; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!unique.length) return {clarify: null, clarify_items: []};
    const quote = list => list.map(i => '“' + i.text + '”').join(', ');
    const missed = unique.filter(i => i.kind !== 'uncertain'), unsure = unique.filter(i => i.kind === 'uncertain');
    const sentence = [missed.length ? `I did not understand: ${quote(missed)}.` : '', unsure.length ? `I am not sure I understood: ${quote(unsure)}.` : '', 'Could you rephrase it?'].filter(Boolean).join(' ');
    return {clarify: sentence, clarify_items: unique};
  }

  async function understand(message, {rewrite, emotion: wantEmotion, interpret = true, accept} = {}) {
    const started = performance.now();
    const asked = {interpret, rewrite, accept};
    const detail = {}, errors = [];
    let call = null, interpretation = null, symbolic = null, requested = {interpret, rewrite: rewrite ?? rewriteDefault()};
    try {
      call = await symbolicCall(message, asked);
      symbolic = call.symbolic;
      requested = call.requested;
      interpretation = symbolic?.interpretation ?? null;
      detail.symbolic_lm = call.status;
    } catch (error) {
      errors.push(errorOf('symbolic-lm', error));
      detail.symbolic_lm = 'miss';
      try {
        const part = await understandBySentence(message, asked);
        if (part?.interpretation) { interpretation = part.interpretation; errors.push(...part.errors); }
        else if (part) errors.push(...part.errors);
      } catch (inner) { errors.push(errorOf('symbolic-lm', inner)); }
    }
    if (interpretation && !interpretation.available && !interpretation.reason) interpretation = null;
    // The pragmatic signals (DS029): the whole message, and the classification of the spans the interpretation does not represent.
    let pragmatic = null;
    if (typeof wantEmotion === 'boolean' ? wantEmotion : emotionDefault()) {
      try {
        const result = await emotionFor(message, {leftoverSpans: interpretation?.available ? interpretation.not_represented : []});
        pragmatic = {signals: result.signals, emoji: emojiOf(result.signals), leftovers: result.leftovers, sop: result.sop, trace: result.trace};
        detail.emotion = result.cache;
      } catch (error) { errors.push(errorOf('emotion', error)); }
    }
    const notRepresented = interpretation?.available ? interpretation.not_represented : [];
    const done = new Set((pragmatic?.leftovers.classified ?? []).map(c => c.span));
    const remaining = notRepresented.filter(span => !done.has(span));
    const {clarify, clarify_items} = clarification(interpretation?.available ? interpretation : null, remaining);
    const answered = interpretation?.available === true;
    const status = !answered ? (symbolic || pragmatic ? 'partial' : 'unavailable') : errors.length || clarify_items.some(i => i.kind === 'failed') ? 'partial' : 'ok';
    return {object: 'symbolic.understanding', status, message, analysed_text: symbolic?.analysed_text ?? (answered ? interpretation.text : null), language: symbolic?.language ?? interpretation?.language ?? null,
      route: symbolic?.route ?? null, english: symbolic?.english ?? null, uncertainty: symbolic?.uncertainty ?? null,
      interpretation: interpretation ?? {version: INTERPRETATION_VERSION, available: false, reason: errors[0]?.message ?? 'no interpretation was made', sentences: [], not_represented: []},
      certified: interpretation?.certified ?? null, rewrite: interpretation?.rewrite ?? symbolic?.rewrite ?? null, requested,
      emotion: pragmatic, leftovers: {classified: pragmatic?.leftovers.classified ?? [], remaining: remaining.map(span => ({span}))},
      clarify, clarify_items, errors, timings: {total_ms: round(performance.now() - started), compute_ms: call?.ms ?? null},
      ...cacheReport(detail), versions: versions(['symbolic_lm', 'interpretation', ...(requested.rewrite !== 'off' ? ['symbolic_proofing_llm'] : []), ...(pragmatic ? ['emotion'] : [])])};
  }

  // ---- analyze ----
  async function analyze(message, {rewrite = 'off', accept, interpret = false} = {}) {
    const started = performance.now();
    try {
      const call = await symbolicCall(message, {interpret, rewrite, accept});
      const s = call.symbolic ?? {};
      return {object: 'symbolic.analysis', status: 'ok', message, sop: call.sop, analysis: s.analysis ?? null, analysed_text: s.analysed_text ?? message, language: s.language ?? null, route: s.route ?? null,
        english: s.english ?? null, uncertainty: s.uncertainty ?? null, rewrite: s.rewrite ?? null, requested: call.requested, errors: [],
        timings: {total_ms: round(performance.now() - started), compute_ms: call.ms}, ...cacheReport({symbolic_lm: call.status}), versions: versions(['symbolic_lm'])};
    } catch (error) {
      const language = (() => { try { return gateCleaning(message).language; } catch { return null; } })();
      return {object: 'symbolic.analysis', status: 'unavailable', message, sop: null, analysis: null, analysed_text: null, language, route: null, english: null, uncertainty: null, rewrite: null,
        requested: {interpret: false, rewrite}, errors: [errorOf('symbolic-lm', error)], timings: {total_ms: round(performance.now() - started), compute_ms: null}, ...cacheReport({symbolic_lm: 'miss'}), versions: versions(['symbolic_lm'])};
    }
  }

  // ---- rewrite (SymbolicProofingLLM) ----
  async function rewriteUnit(rid, text) {
    const key = cacheKey('symbolic-proofing-llm', versionKey(rid), text);
    return store.rewriteLlm.getOrCompute(key, async () => {
      const t0 = performance.now();
      const output = await manager.proofreadSymbolic(rid, async url => String((await chatMessages(url, [{role: 'user', content: text}], {temperature: 0, maxTokens: 384, timeoutMs})).text ?? '').trim());
      return {output, ms: round(performance.now() - t0)};
    }, {cacheable: v => Boolean(v.output)});
  }

  /** `mode` `always` with no acceptance check calls the model alone, sentence by sentence; every other combination runs SymbolicLM's gated pipeline. */
  async function rewrite(message, {mode = 'gated', accept} = {}) {
    const started = performance.now();
    const rid = rewriteId();
    const base = {object: 'symbolic.rewrite', input: message, mode, accept: accept ?? (mode === 'always' ? 'off' : 'certified')};
    if (!rid || !manager?.entries.has(rid)) {
      return {...base, status: 'unavailable', output: message, applied: false, units: [], errors: [{component: 'symbolic-proofing-llm', code: 'model_unavailable', message: 'no registry model offers proofread-symbolic'}],
        timings: {total_ms: round(performance.now() - started)}, ...cacheReport({symbolic_proofing_llm: 'miss'}), versions: versions(['symbolic_proofing_llm'])};
    }
    if (mode === 'always' && base.accept === 'off') {
      const units = [], errors = [], detail = {};
      for (const u of splitSentences(message)) {
        const unit = {text: u.text, start: u.start, end: u.end, sent: true, accepted: false, output: null, reasons: []};
        try { const r = await rewriteUnit(rid, u.text); unit.output = r.value.output; unit.accepted = unit.output !== u.text; unit.ms = r.value.ms; detail[`unit${units.length}`] = r.status; }
        catch (error) { errors.push({...errorOf('symbolic-proofing-llm', error), span: u.text}); unit.reasons.push('model_failed'); detail[`unit${units.length}`] = 'miss'; }
        units.push(unit);
      }
      let output = message;
      for (const u of [...units].reverse()) if (u.accepted) output = output.slice(0, u.start) + u.output + output.slice(u.end);
      return {...base, status: errors.length ? 'partial' : 'ok', output, applied: units.some(u => u.accepted), units, gate: 'always', acceptance: 'off', errors,
        timings: {total_ms: round(performance.now() - started)}, ...cacheReport(detail), versions: versions(['symbolic_proofing_llm'])};
    }
    try {
      const call = await symbolicCall(message, {interpret: false, rewrite: mode, accept});
      const r = call.symbolic?.rewrite ?? null;
      return {...base, status: call.requested.rewrite_error ? 'unavailable' : 'ok', output: r?.output ?? call.symbolic?.analysed_text ?? message, applied: Boolean(r?.applied), units: r?.units ?? [], gate: r?.gate ?? null, acceptance: r?.acceptance ?? null,
        errors: call.requested.rewrite_error ? [{component: 'symbolic-proofing-llm', code: 'model_unavailable', message: call.requested.rewrite_error}] : [], timings: {total_ms: round(performance.now() - started), compute_ms: call.ms},
        ...cacheReport({symbolic_lm: call.status}), versions: versions(['symbolic_lm', 'symbolic_proofing_llm'])};
    } catch (error) {
      return {...base, status: 'unavailable', output: message, applied: false, units: [], errors: [errorOf('symbolic-lm', error)], timings: {total_ms: round(performance.now() - started)}, ...cacheReport({symbolic_lm: 'miss'}), versions: versions(['symbolic_lm', 'symbolic_proofing_llm'])};
    }
  }

  // ---- warm state and the start-up warmup (DS012 "Model lifecycle") ----
  const warm = {enabled: false, state: 'disabled', started_at: null, finished_at: null, ms: null, resources: 'not_loaded', probes: {}};
  /** The warm state: the warmup's progress and, per managed model, its mode, state and whether its probe request has been answered. */
  function warmState() {
    const models = {};
    for (const entry of manager?.entries.values() ?? []) {
      const row = manager.describe(entry);
      if (entry.mode === 'off' && warm.state === 'disabled') continue;
      models[row.id] = {mode: row.mode, state: row.state, warm: row.warm, start_ms: row.start_ms, ...(row.error ? {error: row.error} : {}), ...(warm.probes[row.id] ? {probe_ms: warm.probes[row.id].ms, ...(warm.probes[row.id].error ? {probe_error: warm.probes[row.id].error} : {})} : {})};
    }
    const kept = Object.entries(models).filter(([, m]) => m.mode === 'keep_open');
    return {...warm, ready: warm.state === 'warm' && kept.every(([, m]) => m.state === 'ready'), kept_open: kept.map(([id]) => id), models};
  }
  /** The first requests of a model are slow (the weights are paged in, the parsers load): one small real request per kept-open model, through the same code the chat uses. */
  async function probeModel(id) {
    const model = modelOf(id);
    if (!model) return;
    if (id === symbolicId()) {
      // The whole analysis path of a turn: parse, interpretation, tone, and the scope detector the route step runs on the analysis (each loads resources on first use).
      await understand('Hello there.', {emotion: true});
      const analysed = await analyze('Hello there.', {rewrite: rewriteDefault(), interpret: true});
      if (analysed.analysis?.sentences?.length) detectAnalysis(analysed.analysis);
      await understand('Bună ziua, ce faci?', {emotion: true});
    }
    else if (id === translatorId()) await proofread('Bună ziua, mă duc la piață mâine.');
    else if (id === proofreadId()) await proofread('i dont no what happen tomorow', {sendAll: true});
    else if (id === rewriteId()) await rewriteUnit(id, 'The dog bite he yesterday.');
  }
  if (manager) manager.warmHook = async id => { await probeModel(id); manager.markWarm(id); };
  /**
   * Starts every kept-open model in the background and sends each a probe request; resolves with the warm state when all are done
   * (the server does not wait for it). Failures are recorded per model and never thrown. Also loads the LanguagesUtil word lists
   * of the cleaning gate in this process (a synchronous read of several seconds, started after the model processes are spawned).
   */
  async function warmup({probe = true, resources = true} = {}) {
    if (!manager) return warmState();
    manager.autoRevive = true;
    Object.assign(warm, {enabled: true, state: 'warming', started_at: new Date().toISOString(), finished_at: null, ms: null, probes: {}});
    const t0 = performance.now();
    const ids = manager.keptOpen();
    const started = ids.map(id => manager.ensure(id).then(() => null, error => ({id, error})));
    await new Promise(resolve => setImmediate(resolve));
    if (resources) { try { gateCleaning('Hello'); warm.resources = 'loaded'; } catch (error) { warm.resources = 'failed: ' + String(error.message).slice(0, 100); } }
    const failed = (await Promise.all(started)).filter(Boolean);
    if (probe) {
      await Promise.all(ids.filter(id => !failed.some(f => f.id === id)).map(async id => {
        const p0 = performance.now();
        try { await probeModel(id); manager.markWarm(id); warm.probes[id] = {ms: Math.round(performance.now() - p0)}; }
        catch (error) { warm.probes[id] = {ms: Math.round(performance.now() - p0), error: String(error.message).slice(0, 150)}; }
      }));
    } else for (const id of ids) manager.markWarm(id);
    for (const f of failed) warm.probes[f.id] = {ms: 0, error: String(f.error.message).slice(0, 150)};
    Object.assign(warm, {state: failed.length || Object.values(warm.probes).some(p => p.error) ? 'partial' : 'warm', finished_at: new Date().toISOString(), ms: Math.round(performance.now() - t0)});
    return warmState();
  }

  return {proofread, understand, analyze, warmup, warmState, rewrite, detectEmotion, symbolicCall, symbolicFormalize, emotionFor, emojiOf, versions, cacheStats: () => caches.stats(), clearCaches: () => caches.clear(),
    rewriteDefault, emotionDefault, symbolicId, rewriteId, close: () => system.close?.()};
}
