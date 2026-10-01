/**
 * SymbolicLM: the symbolic language model of ChatSOP (DS021 "SymbolicLM", DS006, DS012 "Formalizer models").
 *
 * One component, one API, the message as its only input. It owns exactly three things:
 *   1. UD parsing (Stanza) in the message's language(s),
 *   2. generate SOP Lang from the grammatical analysis (the UD → SOP rules of lib/ud-to-sop/),
 *   3. the uncertainty signal and routing (direct / translate / auto) that calls the other two components below.
 * Per-token language identification and symbolic spelling correction are LanguagesUtil's job
 * (lib/languages-util/, owner decision 2026-09-29); translation toward English is TranslatorService's job
 * (lib/translator-service/, same decision). SymbolicLM calls both when a route needs them, but implements
 * neither itself. Every step is deterministic and inspectable: `analyze(message)` returns the SOP text and a trace with the language
 * of every token, the spelling corrections, the English text with its word alignment, the UD parses, the rule
 * decisions and the unparsed spans. A Romanian word the dictionary does not know is reported as `untranslated` and
 * copied, never guessed. Its static resources (Stanza models, word lists, the host dictionary) are language data,
 * never per-turn context: no entity list, predicate, knowledge, identifier or clock reaches it.
 *
 * Routes: `direct` parses each sentence in its own language and runs the rules (Romanian rules keep Romanian
 * lemmas, owner decision D1); `translate` parses Romanian sentences with the Romanian model, calls TranslatorService
 * (the `symbolic` backend) to realize them in English, parses the English with the English model and runs the
 * English rules, then maps every value back to the verbatim span of the message it came from (so values stay spans
 * of the message, as in the direct route); `auto` picks the route per message from the language identification and
 * `routes` (the default per language, chosen by experiment eval-symbolic-lm-v1 and revisited by
 * eval-translator-compare-v1, DS021 "TranslatorService").
 */
import {convertParse, maskMessage, admissionError} from '../ud-to-sop/index.mjs';
import {mergeFileNames} from '../ud-to-sop/filenames.mjs';
import {StanzaWorker, workerMissing, defaultPython, stanzaSetup, symbolicLmConfig} from '../ud-to-sop/stanza.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {identify, lexiconsFromSpellfix, LANGID_VERSION, loadSpellfix} from '../languages-util/index.mjs';
import {translateParse, joinPieces, TRANSLATE_VERSION} from '../translator-service/index.mjs';
import {uncertaintyOf} from './uncertainty.mjs';
import {treesCertified, runRewritePipeline, REWRITE_GATES, REWRITE_ACCEPTANCE} from './rewrite-gate.mjs';
import {splitSentences} from '../sentence-split.mjs';
import {compareAnalyses} from '../languages-util/analysis-compare.mjs';
import {createCache, cacheKey} from '../cache/lru.mjs';

export const SYMBOLIC_LM_VERSION = 'symbolic-lm-v2.0';

/**
 * The grammatical analysis of a parse in a compact CoNLL-U-like form (owner decision 2026-09-30, DS008 "Three
 * datasets"): per sentence its text, character span and one row per token `[id, form, lemma, upos, head, deprel]`
 * (head 0 = root). Offsets refer to the text that was parsed (quoted spans are masked by `maskMessage`, which keeps
 * every offset).
 */
export const ANALYSIS_COLUMNS = Object.freeze(['id', 'form', 'lemma', 'upos', 'head', 'deprel']);
export const compactAnalysis = (parse, {language = null} = {}) => ({
  columns: ANALYSIS_COLUMNS,
  language: language ?? parse.language ?? null,
  sentences: (parse.sentences ?? []).map(s => ({text: s.text, start: s.start, end: s.end, tokens: s.words.map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel])})),
});

/**
 * Identifier of the Stanza English models the analysis came from: the package version plus the processor packages of
 * the configured (or given) Stanza package, `default` or `accurate` (config/symbolic-lm.json).
 */
const stanzaIds = new Map();
export function stanzaModelId(env = process.env, pkg = null) {
  const setup = stanzaSetup(pkg, env);
  const key = `${setup.name}|${setup.resourcesDir}`;
  if (stanzaIds.has(key)) return stanzaIds.get(key);
  let id;
  try {
    const resources = JSON.parse(fs.readFileSync(path.join(setup.resourcesDir, 'resources.json'), 'utf8'));
    const packages = {...(setup.stanzaPackage === 'default' ? resources.en?.default_processors ?? {} : resources.en?.packages?.[setup.stanzaPackage] ?? {})};
    if (setup.lemmaModel) packages.lemma = path.basename(setup.lemmaModel, '.pt'); // the configured lemmatizer file replaces the package's
    const lib = path.join(path.dirname(defaultPython(env)), '..', 'lib');
    let version = 'unknown';
    for (const dir of fs.existsSync(lib) ? fs.readdirSync(lib) : []) {
      const site = path.join(lib, dir, 'site-packages');
      const dist = fs.existsSync(site) ? fs.readdirSync(site).find(name => /^stanza-[\d.]+\.dist-info$/.test(name)) : null;
      if (dist) version = dist.slice(7, -10);
    }
    id = `stanza-${version}/en:` + ['tokenize', 'mwt', 'pos', 'lemma', 'depparse'].map(k => `${k}=${packages[k]}`).join(',');
  } catch { id = 'stanza/en:unknown'; }
  stanzaIds.set(key, id);
  return id;
}
export {identify, lexiconsFromSpellfix} from '../languages-util/index.mjs';
export {translateParse} from '../translator-service/index.mjs';
export {uncertaintyOf, treeShape} from './uncertainty.mjs';

/**
 * Default route per message language (data-driven decision of 2026-09-30, Q-PIPE-1, experiment
 * `eval-translator-compare-v1`, confirming eval-symbolic-lm-v1's own finding): monolingual Romanian messages go
 * `direct` (no arm beat it on `eval-translator-compare-v1`'s `ro` set: symbolic-hybrid tolerant +4.7 points
 * [-1.3, +10.7], symbolic +2.0 [-4.7, +8.7], opus-mt -15.3 [-22.7, -8.0] -- none has a lower 95% CI bound above 0,
 * so the preregistered decision rule's explicit Romanian fallback applies); mixed messages keep `translate` (the
 * `symbolic` backend): its tolerant lead over direct on the `mixed` set, +7.0 points, has a 95% CI of exactly
 * [0.0, +14.0] -- not decisively above 0, so the current default is kept, not replaced. See
 * eval/reports/current/translator-compare/summary.md.
 */
export const DEFAULT_ROUTES = Object.freeze({en: 'direct', ro: 'direct', mixed: 'translate'});

/** Keywords whose quoted strings are content the host translates, not verbatim values (left as produced). */
const NOT_VALUES = /^\s*(?:relation|reading|basis|hint|certainty|kind|mode|measure|quantifier|polarity)\b/;

export class SymbolicLM {
  /**
   * `worker`: a started or startable lib/ud-to-sop/stanza.mjs StanzaWorker (default: a CPU worker);
   * `spellfix`: a loaded lib/languages-util/spellfix.mjs corrector (default: loaded lazily when first needed);
   * `dictionary`: sop/dictionary.mjs Dictionary (default: config/dictionary); `routes`: default route per language;
   * `threads`: CPU threads of the Stanza worker (default 4, `CHATSOP_SYMBOLIC_LM_THREADS`);
   * `package`: the Stanza English package, `default` or `accurate` (default: config/symbolic-lm.json, overridden by
   * `CHATSOP_STANZA_PACKAGE`);
   * `parsersDisagree`: add the uncertainty reason `parsers_disagree` (a second worker runs the other package; default:
   * config/symbolic-lm.json `uncertainty.parsers_disagree`, off).
   */
  constructor({worker = null, device = 'cpu', threads = Number(process.env.CHATSOP_SYMBOLIC_LM_THREADS ?? 4), spellfix = null, dictionary = null, routes = DEFAULT_ROUTES, spell = false, lexicons = null, package: pkg = null, parsersDisagree = null} = {}) {
    // CPU threads of the Stanza worker (torch/OpenMP); a small number keeps the worker from starving other jobs.
    const env = threads > 0 ? {OMP_NUM_THREADS: String(threads), MKL_NUM_THREADS: String(threads)} : {};
    this.device = device;
    this.env = env;
    this.worker = worker ?? new StanzaWorker({device, env, package: pkg});
    this.package = this.worker.package ?? pkg ?? symbolicLmConfig().stanza.package;
    this.parsersDisagree = parsersDisagree ?? symbolicLmConfig().uncertainty?.parsers_disagree ?? false;
    this.prefetched = new Map();
    // Small bounded caches in front of the expensive per-sentence calls (DS030): the Stanza parse of a text and the local facts of a sentence unit.
    // Keys carry the Stanza package, so a package switch never serves a stale parse; concurrent identical calls share one computation.
    this.parseCache = createCache({name: 'stanza-parse', maxEntries: 400, maxBytes: 16_000_000, ttlMs: 30 * 60_000, clone: true});
    this.unitCache = createCache({name: 'stanza-unit', maxEntries: 400, maxBytes: 16_000_000, ttlMs: 30 * 60_000, clone: true});
    this.spellfix = spellfix;
    this.dictionary = dictionary ?? defaultDictionary();
    this.routes = {...DEFAULT_ROUTES, ...routes};
    this.spell = spell;
    // Word lists for language identification; default: the Hunspell sets of the spelling corrector (tests inject small ones).
    this.lexicons = lexicons;
  }

  static missing(env = process.env, pkg = null) { return workerMissing(env, pkg); }

  async start() {
    const info = await this.worker.start();
    this.resources();
    return info;
  }

  resources({spelling = false} = {}) {
    if (!this.spellfix && (spelling || !this.lexicons)) this.spellfix = loadSpellfix();
    this.lexicons ??= lexiconsFromSpellfix(this.spellfix);
    return this;
  }

  async stop() { await this.worker.stop(); if (this.other) await this.other.stop(); }

  async parse(text, language = null) {
    const key = `${language ?? 'auto'}|${text}`;
    const known = this.prefetched.get(key);
    if (known) { this.prefetched.delete(key); return {...known, parse: mergeFileNames(known.parse)}; }
    const {value} = await this.parseCache.getOrCompute(cacheKey('stanza-parse', this.package, language, text), async () => {
      const {parse, ms} = await this.worker.request({id: 0, text, ...(language ? {language} : {})});
      return {parse, ms};
    });
    return {...value, parse: mergeFileNames(value.parse)}; // v2.6: a file name or path is one word
  }

  /**
   * Parse the texts the direct route will ask for in one batch (`parseMany`: one GPU pass per language instead of one
   * request per message); `parse` then answers from this store. Only an optimisation: results are identical.
   */
  async prefetch(messages, {language = 'auto', route = 'auto'} = {}) {
    if (typeof this.worker.parseMany !== 'function') return 0;
    this.resources();
    const jobs = [];
    for (const message of messages) {
      const text = String(message);
      const lid = this.identify(text);
      const lang = language === 'auto' ? lid.language : language;
      if (lang === 'mixed' && route !== 'direct') continue; // the translate route parses in its own steps
      jobs.push({masked: maskMessage(text), forced: lang === 'en' ? 'en' : lang === 'ro' ? 'ro' : null});
    }
    if (!jobs.length) return 0;
    const {parses, ms} = await this.worker.parseMany(jobs.map(j => j.masked), jobs.map(j => j.forced));
    jobs.forEach((job, i) => this.prefetched.set(`${job.forced ?? 'auto'}|${job.masked}`, {parse: parses[i], ms: ms / jobs.length}));
    return jobs.length;
  }

  /** Analyze several messages: one batched parse (`prefetch`), then `analyze` for each; same results as `analyze` one by one. */
  async analyzeMany(messages, options = {}) {
    if (!options.spell && !this.spell && !options.rewrite) await this.prefetch(messages, {language: options.language ?? 'auto', route: options.route ?? 'auto'});
    const out = [];
    for (const message of messages) out.push(await this.analyze(message, options));
    this.prefetched.clear();
    return out;
  }

  /** The English sentences of `text` parsed by the other Stanza package (for `parsers_disagree`), or null when unavailable. */
  async otherParses(text) {
    if (!this.parsersDisagree) return null;
    const name = this.package === 'accurate' ? 'default' : 'accurate';
    if (workerMissing(process.env, name)) return null;
    this.other ??= new StanzaWorker({device: this.device, env: this.env, package: name});
    const {parse} = await this.other.request({id: 0, text, language: 'en'});
    return parse.sentences ?? [];
  }

  /** Component (b): spelling correction; returns {text, changes, map} where `map(i)` gives the original offset. */
  correct(message) {
    this.resources({spelling: true});
    const fixed = this.spellfix.fix(message);
    return {text: fixed.text, changes: fixed.changes, language: fixed.language, skipped: fixed.skipped ?? null, original: message};
  }

  /** Component (a): per-token language identification. */
  identify(message) {
    this.resources();
    return identify(message, {lexicons: this.lexicons, dictionary: this.dictionary});
  }

  /**
   * Component (c) alone: the English rendering of a message, without SOP generation. A Romanian message is parsed
   * with the Romanian model and realized in English; a mixed message keeps its English sentences and translates
   * its Romanian sentences and Romanian word runs; an English message is returned unchanged.
   * Returns {text, language, untranslated, spelling, pieces, ms}; `untranslated` lists Romanian words the dictionary
   * does not know (copied, never guessed).
   */
  async toEnglish(message, {spell = this.spell, language = 'auto'} = {}) {
    const started = performance.now();
    let text = String(message);
    let spelling = [];
    if (spell) { const fixed = this.correct(text); spelling = fixed.changes; text = fixed.text; }
    const lid = this.identify(text);
    const messageLanguage = language === 'auto' ? lid.language : language;
    if (messageLanguage === 'en' && !lid.counts.ro) return {text, language: 'en', untranslated: [], spelling, pieces: [], ms: performance.now() - started};
    const english = await this.englishOf(text, lid, messageLanguage === 'ro');
    return {text: english.text, language: messageLanguage, untranslated: english.untranslated, spelling, pieces: english.pieces, decisions: english.decisions, ms: performance.now() - started};
  }

  /**
   * Analyze one message. Options:
   *   `route`     `auto` (per message language, `routes`), `direct` or `translate`;
   *   `language`  `auto`, `en` or `ro` (forces the message language);
   *   `spell`     apply the spelling corrector first;
   *   `values`    `source` (map translated values back to message spans) or `english`;
   *   `rewrite`   optional async function (englishText) → englishText, e.g. SymbolicProofingLLM, called on the
   *               English text before it is parsed again; `rewriteWhen` `uncertain` (default: only when the
   *               uncertainty signal fires) or `always`. The rewrite never sees anything but the English text;
   *   `englishOnly` the product mode (owner decision 2026-10-01, DS021 "English-only core"): a message that is not English is refused
   *               with an Error whose `.code` is `non_english_input`, never analysed; the edges (textToCleanEnglish, TranslatorService)
   *               translate first. The default `false` keeps the research routes (`direct` Romanian, `translate`) for the archived evaluations.
   * Returns {sop, valid, route, language, outcome, english, uncertain, reasons, uncertainty: {uncertain, score,
   * kinds, reasons}, analysis, trace}. `analysis` is the grammatical analysis finally used (`compactAnalysis`: the UD
   * parse per sentence, {columns, language, sentences: [{text, start, end, tokens}]}, plus `parser`); null when no
   * parse was made. `english` is the English text finally parsed (null on a direct non-English route, or
   * when the Romanian rules kept a direct outcome before any translation); `uncertain` and `reasons` are the
   * shorthand of `uncertainty.uncertain` / `uncertainty.reasons`, kept alongside it for callers that do not need
   * `score`/`kinds`.
   */
  async analyze(message, {route = 'auto', language = 'auto', spell = this.spell, values = 'source', rewrite = null, rewriteWhen = 'uncertain', rewriteAccept = 'off', keepConstraints = true, englishOnly = false} = {}) {
    const started = performance.now();
    const trace = {version: SYMBOLIC_LM_VERSION, components: {langid: LANGID_VERSION, translate: TRANSLATE_VERSION}};
    let text = String(message);
    if (spell) {
      const fixed = this.correct(text);
      trace.spelling = {changes: fixed.changes, skipped: fixed.skipped};
      text = fixed.text;
    } else trace.spelling = {changes: [], skipped: 'disabled'};
    const lid = this.identify(text);
    trace.language_id = {language: lid.language, counts: lid.counts, runs: lid.runs, tokens: lid.tokens.filter(t => t.kind === 'word').map(({text: t, start, end, label, reasons}) => ({text: t, start, end, label, reasons}))};
    const messageLanguage = language === 'auto' ? lid.language : language;
    if (englishOnly && messageLanguage !== 'en') throw Object.assign(Error(`SymbolicLM takes English only; the message was identified as "${messageLanguage}". Translate it first (textToCleanEnglish).`), {code: 'non_english_input', language: messageLanguage});
    const chosen = route === 'auto' ? this.routes[messageLanguage] ?? 'direct' : route;
    if (!REWRITE_GATES.includes(rewriteWhen)) throw Error(`unknown rewriteWhen ${rewriteWhen}`);
    if (!REWRITE_ACCEPTANCE.includes(rewriteAccept)) throw Error(`unknown rewriteAccept ${rewriteAccept}`);
    const options = {values, rewrite, rewriteWhen, rewriteAccept, keepConstraints};
    let result;
    if (chosen === 'translate' && (lid.counts.ro > 0 || messageLanguage === 'ro')) result = await this.translateRoute(text, lid, trace, {...options, whole: messageLanguage === 'ro'});
    else result = await this.directRoute(text, messageLanguage, trace, options);
    trace.ms = performance.now() - started;
    return {sop: result.sop, valid: result.valid, route: result.route, language: messageLanguage, outcome: result.outcome, english: result.english ?? null, uncertain: trace.uncertainty?.uncertain ?? false, reasons: trace.uncertainty?.reasons ?? [], uncertainty: trace.uncertainty, message: text, analysis: trace.analysis ? {parser: stanzaModelId(process.env, this.package), ...trace.analysis} : null, trace};
  }

  /**
   * Local facts of one English sentence unit for the rewrite pipeline: `certified` (the default and accurate Stanza trees are identical),
   * `uncertain` (SymbolicLM does not handle the unit alone: invalid, not converted, an unparsed span or any uncertainty reason) and the
   * compact analysis. Runs both Stanza packages on the unit (the other one in a second worker).
   */
  async inspectUnit(unit) {
    return (await this.unitCache.getOrCompute(cacheKey('stanza-unit', this.package, unit), () => this.inspectUnitUncached(unit))).value;
  }

  async inspectUnitUncached(unit) {
    const masked = maskMessage(unit);
    const {parse} = await this.parse(masked, 'en');
    const name = this.package === 'accurate' ? 'default' : 'accurate';
    this.other ??= new StanzaWorker({device: this.device, env: this.env, package: name});
    const {parse: other} = await this.other.request({id: 0, text: masked, language: 'en'});
    const accurate = this.package === 'accurate' ? parse : other, defaults = this.package === 'accurate' ? other : parse;
    const converted = convertParse(parse, unit);
    const trace = {rules: rulesTrace(converted), unparsed: unparsedOf(converted)};
    const signal = uncertaintyOf(trace, {englishSentences: parse.sentences ?? []});
    return {certified: treesCertified(accurate.sentences ?? [], defaults.sentences ?? []), uncertain: !converted.valid || converted.outcome !== 'converted' || signal.uncertain, compact: compactAnalysis(accurate, {language: 'en'})};
  }

  /** Analysis comparison verdict (`equivalent`, `different`, `uncertain`) of a unit and its rewrite, for the `certified_compare` acceptance. */
  compareUnits(a, b, textA, textB) {
    try { return compareAnalyses(a, b, {textA, textB}).verdict; } catch { return 'uncertain'; }
  }

  /**
   * Parse and convert an English text, compute the uncertainty signal, and apply the optional rewrite:
   * returns {converted, parse, english (the text finally parsed), rewritten}.
   */
  async englishPass(englishText, message, trace, {rewrite, rewriteWhen, rewriteAccept = 'off', source = null}) {
    const {parse, ms} = await this.parse(maskMessage(englishText), 'en');
    let converted = convertParse(parse, englishText);
    trace.parse_english = {ms, sentences: summarizeParse(parse)};
    trace.analysis = compactAnalysis(parse, {language: 'en'});
    trace.rules = rulesTrace(converted);
    trace.unparsed = unparsedOf(converted);
    const otherStanza = await this.otherParses(maskMessage(englishText));
    const signal = uncertaintyOf({...trace, value_mapping: source?.mapping ?? []}, {englishSentences: parse.sentences ?? [], otherStanza});
    trace.uncertainty = signal;
    trace.english_signal = signal;
    let finalText = englishText, finalParse = parse, rewritten = false;
    if (rewrite && (rewriteAccept !== 'off' || rewriteWhen === 'trees' || rewriteWhen === 'trees_or_uncertain')) {
      // Optional rewrite pipeline (DS021 "Optional rewrite pipeline"): per sentence unit, a local gate and an acceptance check.
      const run = await runRewritePipeline(englishText, {split: splitSentences, inspect: unit => this.inspectUnit(unit), rewrite, gate: rewriteWhen, acceptance: rewriteAccept, compare: (a, b, ta, tb) => this.compareUnits(a, b, ta, tb)});
      trace.rewrite = {input: englishText, output: run.text, applied: run.applied, gate: rewriteWhen, acceptance: rewriteAccept, units: run.units.map(({text, sent, accepted, reasons, output, certified, uncertain}) => ({text, sent, accepted, reasons, output, certified, uncertain}))};
      if (run.applied) {
        const second = await this.parse(maskMessage(run.text), 'en');
        converted = convertParse(second.parse, run.text);
        finalText = run.text;
        finalParse = second.parse;
        rewritten = true;
        trace.parse_rewritten = {ms: second.ms, sentences: summarizeParse(second.parse)};
        trace.analysis = compactAnalysis(second.parse, {language: 'en'});
        trace.rules = rulesTrace(converted);
        trace.unparsed = unparsedOf(converted);
      }
    } else if (rewrite && (rewriteWhen === 'always' || signal.uncertain)) {
      const output = String(await rewrite(englishText) ?? '').trim();
      trace.rewrite = {input: englishText, output, applied: Boolean(output) && output !== englishText.trim(), gate: rewriteWhen === 'always' ? 'always' : signal.kinds};
      if (trace.rewrite.applied) {
        const second = await this.parse(maskMessage(output), 'en');
        converted = convertParse(second.parse, output);
        finalText = output;
        finalParse = second.parse;
        rewritten = true;
        trace.parse_rewritten = {ms: second.ms, sentences: summarizeParse(second.parse)};
        trace.analysis = compactAnalysis(second.parse, {language: 'en'});
        trace.rules = rulesTrace(converted);
        trace.unparsed = unparsedOf(converted);
      }
    } else trace.rewrite = {applied: false, gate: rewrite ? 'certain' : 'no rewrite function'};
    return {converted, parse: finalParse, english: finalText, rewritten};
  }

  /** Route `direct`: parse in the message language (per sentence when mixed) and run the rules. */
  async directRoute(text, messageLanguage, trace, options = {}) {
    if (messageLanguage === 'en') {
      // English: the message is the English text (the rewrite hook applies to it).
      const pass = await this.englishPass(text, text, trace, options);
      trace.parse = {route: 'direct', language: 'en', sentences: trace.parse_english.sentences};
      return {sop: pass.converted.sop, valid: pass.converted.valid, outcome: pass.converted.outcome, route: 'direct', english: pass.english};
    }
    const forced = messageLanguage === 'ro' ? 'ro' : null;
    const {parse, ms} = await this.parse(maskMessage(text), forced);
    const converted = convertParse(parse, text);
    trace.parse = {route: 'direct', language: parse.language, ms, sentences: summarizeParse(parse)};
    trace.analysis = compactAnalysis(parse);
    trace.rules = rulesTrace(converted);
    trace.unparsed = unparsedOf(converted);
    trace.uncertainty = uncertaintyOf(trace, {englishSentences: parse.sentences ?? []});
    // Direct non-English route: no English rendering was produced (the message is parsed and converted in its own
    // language), so there is nothing to report as `english`.
    return {sop: converted.sop, valid: converted.valid, outcome: converted.outcome, route: 'direct', english: null};
  }

  /** The English text of a Romanian or mixed message with its word alignment (see `toEnglish`). */
  async englishOf(text, lid, whole, roParse = null) {
    const masked = maskMessage(text);
    roParse ??= (await this.parse(masked, 'ro')).parse;
    let sentences = roParse.sentences;
    let enKept = [];
    if (!whole) {
      // Mixed message: each Romanian-parser sentence is Romanian when most of its decided tokens are; the English
      // sentences come from the English parse of the same message.
      const {parse: enParse} = await this.parse(masked, 'en');
      const langOf = (start, end) => {
        const tokens = lid.tokens.filter(t => t.start >= start && t.end <= end && (t.label === 'ro' || t.label === 'en'));
        return tokens.filter(t => t.label === 'ro').length > tokens.filter(t => t.label === 'en').length ? 'ro' : 'en';
      };
      sentences = roParse.sentences.filter(s => langOf(s.start, s.end) === 'ro');
      enKept = enParse.sentences.filter(s => langOf(s.start, s.end) === 'en' && !sentences.some(r => r.start < s.end && s.start < r.end));
    }
    const labels = new Map(lid.tokens.map(t => [`${t.start}:${t.end}`, t.label]));
    const roText = {sentences};
    const isEnglish = word => this.lexicons.has('en', String(word).toLowerCase());
    const translated = translateParse(roText, text, {dictionary: this.dictionary, labels, isEnglish});
    // English sentences are copied token by token (their own words are their source) and interleaved by position.
    const blocks = [...sentences.map(s => ({start: s.start, kind: 'ro'})), ...enKept.map(s => ({start: s.start, kind: 'en', s}))].sort((a, b) => a.start - b.start);
    const pieces = [];
    let roIndex = 0;
    const roPieces = splitBySentence(translated.pieces, sentences);
    for (const block of blocks) {
      if (block.kind === 'ro') pieces.push(...roPieces[roIndex++]);
      else pieces.push(...this.englishSentence(block.s, text, lid, translated.untranslated));
    }
    const english = joinPieces(pieces);
    const words = new Map();
    for (const s of sentences) for (const w of s.words) words.set(`${w.start}:${w.end}`, w);
    for (const s of enKept) for (const w of s.words) words.set(`${w.start}:${w.end}`, w);
    return {...english, untranslated: translated.untranslated, decisions: translated.decisions, words, sentences};
  }

  /**
   * Route `translate`: Romanian sentences are parsed with the Romanian model and realized in English; English
   * sentences are kept. The English text is parsed and converted; values are mapped back to message spans.
   */
  async translateRoute(text, lid, trace, {whole = false, ...options} = {}) {
    const masked = maskMessage(text);
    const {parse: roParse, ms: roMs} = await this.parse(masked, 'ro');
    // What the Romanian rules decide before any structure (gibberish, a pure request or greeting, labelled simple
    // text) does not depend on translation: the direct result is kept.
    if (whole) {
      const direct = convertParse(roParse, text);
      // v1.1 (eval-symbolic-lm-v1 deviation D2): a numeric constraint the Romanian rules recognize ("între 3 și 8
      // locuri … peste 5?") keeps the direct result; the English realization loses its pattern.
      const constraint = options.keepConstraints !== false && direct.wires.some(w => w.type === 'constraint');
      if (constraint || ['gibberish', 'no_request', 'labelled', 'nothing_formalized'].includes(direct.outcome)) {
        trace.parse = {route: 'translate', source: {language: 'ro', ms: roMs, sentences: summarizeParse(roParse)}, english: null};
        trace.translation = {text: null, untranslated: [], decisions: [], pieces: [], kept_direct: constraint ? 'constraint' : direct.outcome};
        trace.rules = rulesTrace(direct);
        trace.unparsed = unparsedOf(direct);
        trace.uncertainty = uncertaintyOf(trace, {englishSentences: []});
        return {sop: direct.sop, valid: direct.valid, outcome: direct.outcome, route: 'translate', english: null};
      }
    }
    const english = await this.englishOf(text, lid, whole, roParse);
    const {words, sentences} = english;
    trace.translation = {text: english.text, untranslated: english.untranslated, decisions: english.decisions, pieces: english.pieces.map(({text: t, start, end, src, kind}) => ({text: t, start, end, src, kind}))};
    const pass = await this.englishPass(english.text, text, trace, options);
    const converted = pass.converted;
    trace.parse = {route: 'translate', source: {language: 'ro', ms: roMs, sentences: summarizeParse({sentences})}, english: trace.parse_english};
    let sop = converted.sop;
    let mapping = [];
    if (options.values !== 'english' && converted.valid) {
      // After a rewrite the alignment is to the translation, not to the rewritten text: values the rewrite kept
      // verbatim are still found in the translation and mapped; the others keep the rewritten English.
      const mapped = mapValues(sop, english, words, text);
      mapping = mapped.mapping;
      if (!admissionError(mapped.sop, text)) sop = mapped.sop;
      else mapping.push({error: 'mapped SOP not admitted; English values kept'});
    }
    trace.value_mapping = mapping;
    if (!pass.rewritten) {
      // The value-mapping reason joins the uncertainty signal once the mapping is known.
      trace.uncertainty = uncertaintyOf(trace, {englishSentences: []});
      trace.uncertainty = mergeSignals(trace.uncertainty, this.lastSignal(trace));
    }
    trace.unparsed = (trace.unparsed ?? []).map(u => ({...u, mapped: mapping.find(m => m.english === u.span)?.source ?? null}));
    return {sop, valid: !admissionError(sop, text), outcome: converted.outcome, route: 'translate', english: pass.english};
  }

  /** The tree-shape, OOV and parser reasons of the English pass (kept when the signal is recomputed). */
  lastSignal(trace) { return trace.english_signal ?? null; }
}

/** Union of two uncertainty signals (reasons deduplicated). */
function mergeSignals(a, b) {
  if (!b) return a;
  const seen = new Set();
  const reasons = [...a.reasons, ...b.reasons].filter(r => { const k = r.kind + '\u0000' + r.detail; if (seen.has(k)) return false; seen.add(k); return true; });
  const kinds = [...new Set(reasons.map(r => r.kind))];
  return {uncertain: reasons.length > 0, score: kinds.length, kinds, reasons};
}

/**
 * Word-level translation inside an English sentence: each run of Romanian-labelled tokens ("autorizația de
 * construire", "raport") is replaced by the host dictionary's first English candidate; a run the dictionary cannot
 * translate is copied and reported as untranslated. Every other token is copied.
 */
SymbolicLM.prototype.englishSentence = function englishSentence(sentence, text, lid, untranslated) {
  const label = new Map(lid.tokens.map(t => [`${t.start}:${t.end}`, t.label]));
  const out = [];
  const words = sentence.words;
  for (let i = 0; i < words.length;) {
    const w = words[i];
    if (label.get(`${w.start}:${w.end}`) !== 'ro') { out.push({text: text.slice(w.start, w.end), src: [`${w.start}:${w.end}:en:${w.id}`], kind: 'english'}); i++; continue; }
    let j = i;
    while (j + 1 < words.length && label.get(`${words[j + 1].start}:${words[j + 1].end}`) === 'ro') j++;
    const run = words.slice(i, j + 1);
    const phrase = text.slice(run[0].start, run.at(-1).end);
    const found = this.dictionary.candidates(phrase, run.some(x => x.upos === 'VERB') ? 'relation' : 'value');
    const src = run.map(x => `${x.start}:${x.end}:en:${x.id}`);
    if (found.status === 'translated') out.push({text: found.candidates[0], src, kind: 'word-translation'});
    else {
      out.push({text: phrase, src, kind: 'untranslated'});
      if (found.status === 'untranslated') untranslated.push(...found.untranslated.map(word => ({word, start: run[0].start, end: run.at(-1).end, upos: null})));
    }
    i = j + 1;
  }
  return out;
};

/** Split translated pieces by the Romanian sentence their source words belong to. */
function splitBySentence(pieces, sentences) {
  const out = sentences.map(() => []);
  let current = 0;
  for (const p of pieces) {
    const key = p.src[0];
    if (key) {
      const start = Number(key.split(':')[0]);
      const index = sentences.findIndex(s => start >= s.start && start < s.end + 1);
      if (index >= 0) current = index;
    }
    out[current]?.push(p);
  }
  return out;
}

const summarizeParse = parse => (parse.sentences ?? []).map(s => ({language: s.language, text: s.text, start: s.start, end: s.end,
  words: s.words.map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel].join(' '))}));
const rulesTrace = converted => ({outcome: converted.outcome, valid: converted.valid, error: converted.error ?? null, repaired: converted.repaired, notes: converted.notes, stats: converted.stats});
const unparsedOf = converted => converted.wires.filter(w => w.type === 'unparsed').map(({span, near, hint}) => ({span, near: near ?? null, hint: hint ?? null}));

const DROP = Symbol('drop');
const CONTENT_UPOS = new Set(['NOUN', 'PROPN', 'VERB', 'ADJ', 'NUM', 'PRON', 'ADV', 'X', 'SYM']);

/**
 * Map every quoted value of a translated SOP text back to the verbatim message span its English words came from.
 * A value is mapped when its English span renders a set of message words that forms one run of the message in
 * which every content word belongs to the value; otherwise the English value is kept and the reason recorded.
 */
export function mapValues(sop, english, words, message) {
  const mapping = [];
  const cache = new Map();
  const mapOne = value => {
    if (cache.has(value)) return cache.get(value);
    let result = null, why = 'not found in the English text';
    if (/^the user\b/i.test(value)) why = 'first person';
    else if (english.pieces.some(p => p.kind === 'pro-drop' && p.text === value)) { result = DROP; why = 'pro-drop subject'; }
    else {
      let from = 0;
      for (;;) {
        const at = english.text.indexOf(value, from);
        if (at < 0) break;
        from = at + 1;
        const end = at + value.length;
        const covered = english.pieces.filter(p => p.start < end && at < p.end);
        if (covered.length && covered.every(p => p.kind === 'pro-drop')) { result = DROP; why = 'pro-drop subject'; break; }
        const keys = new Set(covered.flatMap(p => p.src.map(k => k.split(':').slice(0, 2).join(':'))));
        const src = [...keys].map(k => words.get(k)).filter(Boolean);
        if (!src.length) { why = 'inserted English words only'; continue; }
        const lo = Math.min(...src.map(w => w.start)), hi = Math.max(...src.map(w => w.end));
        // Every content word inside the message range must be rendered inside the value.
        const inside = [...words.values()].filter(w => w.start >= lo && w.end <= hi);
        const outside = inside.filter(w => !keys.has(`${w.start}:${w.end}`) && CONTENT_UPOS.has(w.upos) && english.pieces.some(p => p.src.some(k => k.startsWith(`${w.start}:${w.end}:`))));
        if (outside.length) { why = 'reordered: ' + outside.map(w => w.text).join(' '); continue; }
        result = message.slice(lo, hi).replace(/^[\s,.;:!?"'„”“«»()-]+|[\s,.;:!?"'„”“«»()]+$/gu, '');
        break;
      }
    }
    const entry = {english: value, source: result === DROP ? null : result, ...(result && result !== DROP ? {} : {why}), ...(result === DROP ? {dropped: true} : {})};
    mapping.push(entry);
    cache.set(value, result);
    return result;
  };
  const lines = String(sop).split('\n').map(line => {
    if (NOT_VALUES.test(line)) return line;
    // A role filled only by a pronoun the translation inserted for a Romanian pro-drop subject is left open, as the
    // direct route leaves it.
    const role = /^\s*role \w+ ("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    if (role) { try { if (mapOne(JSON.parse(role[1])) === DROP) return null; } catch { /* keep */ } }
    return line.replace(/"(?:[^"\\]|\\.)*"/g, literal => {
      let value;
      try { value = JSON.parse(literal); } catch { return literal; }
      const mapped = mapOne(value);
      return mapped && mapped !== DROP ? JSON.stringify(mapped) : literal;
    });
  }).filter(line => line !== null);
  return {sop: lines.join('\n'), mapping};
}

/** A started SymbolicLM (CPU Stanza worker, spelling resources loaded). */
export async function createSymbolicLM(options = {}) {
  const lm = new SymbolicLM(options);
  await lm.start();
  return lm;
}
