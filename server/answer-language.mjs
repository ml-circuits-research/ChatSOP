/**
 * Answer formulation in the user's language (DS009 "Answer language"). The request parser reads any language and writes English
 * circuits; the runtime reasons in English and `sop/answer-text.mjs` renders the answer deterministically in English. This optional
 * final step phrases that answer in the language of the user's message with a non-Anthropic model through omp (the configured chain,
 * by default the request parser's chain, GLM first), strictly from the result: the English answer and a compact copy of the result
 * packet (status, answers, count, the facts used and their sources). The model adds no fact; every number and every source id of the
 * English answer must appear in its text, otherwise the English answer is returned. The English rendering is always kept in the trace.
 *
 * Settings (`answerLanguage` of config/runtime.json): `mode` `auto` (the default: on when the message does not look English, off for
 * English), `always` or `off`; `models` (default: `queryParser.models`); `timeoutSeconds` (default 40); `thinking` (default `off`).
 * `looksEnglish` is also the hook for local formalization strategies: the request parser receives `messageLanguage` (`en` or `other`)
 * and may translate a non-English message to English before a small local model reads it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runOmpRpc} from '../lib/omp/rpc.mjs';
import {providerChat} from '../lib/llm-providers.mjs';

export const DEFAULT_ANSWER_LANGUAGE = Object.freeze({mode: 'auto', models: null, timeoutSeconds: 40, thinking: 'off', provider: 'openference'});

const ENGLISH = new Set(('a an the is are was were be been am do does did has have had who whom whose what which where when why how many much ' +
  'of in on at to from by with for about into over under than then and or not no yes my your his her its our their i you he she it we they ' +
  'this that these those there here can could would should will shall may might must located born live lives lived died wrote write written ' +
  'capital country city people person share border borders most least largest biggest list name all any some each every one two three if ' +
  'mother father son daughter wife husband author because after before since during').split(' '));

/** Whether a message reads as English: enough English function words, or a short plain-ASCII text (a name, a title). */
export function looksEnglish(text) {
  const words = String(text).toLowerCase().match(/\p{L}+/gu) ?? [];
  if (!words.length) return true;
  const english = words.filter(w => ENGLISH.has(w)).length;
  if (english / words.length >= 0.2) return true;
  return words.length <= 3 && /^[\x00-\x7f]*$/.test(text);
}

export function answerLanguageSettings(config = {}) {
  const merged = {...DEFAULT_ANSWER_LANGUAGE, ...(config.answerLanguage ?? {})};
  const chain = Array.isArray(merged.models) && merged.models.length ? merged.models
    : config.queryParser?.models?.length ? config.queryParser.models : [config.queryParser?.backend?.model].filter(Boolean);
  return {...merged, models: [...new Set(chain)], config};
}

const SYSTEM = `You phrase a verified answer for a user, in the language of the user's message.
Rules: use ONLY what the ENGLISH ANSWER and the RESULT say; add no fact, no explanation of your own, no opinion; never answer from your own knowledge; keep every number, date, proper name and source id exactly as written (you may use the usual form of a name in the user's language only when the English answer gives no other form of it); keep the meaning of yes, no, "I do not know" and of a clarification question; keep the sources line, translating only its words. Output only the answer text, nothing else.`;

/** The compact result the model may use: no more than the English answer already states. */
function compact(packet = {}) {
  const facts = (packet.proof ?? []).slice(0, 20).map(f => ({relation: f.atom?.p, args: f.atom?.a, negated: f.atom?.neg || undefined, source: f.source || undefined}));
  return {status: packet.status ?? null, answers: packet.answers ?? packet.rows ?? undefined, count: packet.count, at_least: packet.at_least, facts};
}

/** Numbers and source ids of the English answer that the formulated answer must keep. */
export function keptTokens(english) {
  return [...new Set(String(english).match(/\b(?:Q\d+|P\d+|\d+(?:[.,]\d+)?)\b/g) ?? [])];
}

export function createAnswerFormulator({settings, ompConfig = {}, chatData = null, runner = runOmpRpc, chat = providerChat}) {
  /** Returns `{applied, text?, model?, ms, reason?, tried}`; `applied: false` keeps the English answer. */
  async function formulate({message, english, packet}) {
    const started = Date.now();
    const mode = settings.mode;
    const english_input = looksEnglish(message);
    const base = {mode, message_language: english_input ? 'en' : 'other'};
    if (mode === 'off' || (mode === 'auto' && english_input)) return {...base, applied: false, ms: 0, reason: mode === 'off' ? 'off by configuration' : 'the message is English'};
    const prompt = `USER MESSAGE:\n${message}\n\nENGLISH ANSWER:\n${english}\n\nRESULT:\n${JSON.stringify(compact(packet))}\n\nWrite the answer in the language of the USER MESSAGE.`;
    const tried = [];
    // The default model of the user-language step is the remote direct call (llmProviders, the openference proxy); the omp chain is the fallback.
    if (settings.provider) {
      const run = await chat({system: SYSTEM, prompt, provider: settings.provider, config: settings.config ?? {}, timeoutMs: settings.timeoutSeconds * 1000});
      const text = String(run.text ?? '').trim();
      const missing = run.ok && text ? keptTokens(english).filter(t => !text.includes(t)) : [];
      if (run.ok && text && !missing.length) return {...base, applied: true, text, model: run.model, ms: Date.now() - started, tried};
      tried.push({model: run.model ?? settings.provider, reason: !run.ok || !text ? run.reason ?? 'no text' : `dropped ${missing.slice(0, 5).join(', ')}`});
    }
    if (ompConfig.enabled === false) return {...base, applied: false, ms: Date.now() - started, reason: tried.length ? `${tried.at(-1).reason}; omp is disabled` : 'omp is disabled', tried};
    for (const model of settings.models) {
      const folder = chatData ? chatData.tmpFolder('al') : fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-al-'));
      try {
        const run = await runner({folder, system: SYSTEM, prompt, model, thinking: settings.thinking, timeoutMs: settings.timeoutSeconds * 1000, bin: ompConfig.bin ?? 'omp'});
        const text = String(run.final_text ?? '').trim();
        if (!run.ok || !text) { tried.push({model, reason: run.reason ?? 'no text'}); continue; }
        const missing = keptTokens(english).filter(t => !text.includes(t));
        if (missing.length) { tried.push({model, reason: `dropped ${missing.slice(0, 5).join(', ')}`}); continue; }
        return {...base, applied: true, text, model, ms: Date.now() - started, tried};
      } finally { try { fs.rmSync(folder, {recursive: true, force: true}); } catch { /* the cleanup policy removes it */ } }
    }
    return {...base, applied: false, ms: Date.now() - started, reason: 'no model of the chain produced a faithful answer; the English answer is shown', tried};
  }
  return {formulate, settings};
}
