/** EmotionDetectionSystem (DS029): a separate, switchable component that classifies the pragmatic or emotional role of
 * a message and of the spans SymbolicLM cannot formalize, and emits advisory `pragmatic` signals for the reasoner.
 *
 *   const system = createEmotionDetectionSystem({strategies: [createSymbolicStrategy()], enabled: true});
 *   const {signals, leftovers, trace} = await system.detect(message, {analysis, englishText, leftoverSpans});
 *
 * A signal is {kind, label, score, span?, source: strategy id, basis, emoji?, leftover?}; `emoji` is the config's suggestion (`kindEmoji`) for showing the kind in a UI. Strategies are pluggable objects
 * {id, kinds, detect(message, context)}; the cheap ones always run, the costly ones (`cost: 'costly'`) run in parallel
 * under the latency budget and are skipped when the symbolic signals already cover the message. The signals are the
 * system's subjective perception, never facts about the world.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRAGMATIC_KINDS} from '../../sop/enums.mjs';
import {createSymbolicStrategy, fold} from './strategies/symbolic.mjs';
export {adviceFor} from './advice.mjs';
export {signalsToSop, signalToWire} from './sop.mjs';
export {createSymbolicStrategy};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONFIG_PATH = path.join(ROOT, 'config/emotion-detection.json');
export const loadConfig = (file = CONFIG_PATH) => JSON.parse(fs.readFileSync(file, 'utf8'));

const letters = s => (s.match(/\p{L}/gu) ?? []).length;
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('latency budget exceeded')), ms);
  promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

/** Which leftover spans the signals explain (letters covered by signal spans reach `coverage`) and which stay unparsed. */
export function classifyLeftovers(leftoverSpans, signals, {coverage = 0.6} = {}) {
  const classified = [], remaining = [];
  for (const leftover of leftoverSpans) {
    const span = leftover.span ?? leftover, f = fold(span);
    const inside = signals.filter(s => s.span && (f.includes(fold(s.span)) || (f.length >= 3 && fold(s.span).includes(f))));
    const covered = new Set();
    for (const s of inside) { const fs = fold(s.span), whole = f.length >= 3 && fs.includes(f) && !f.includes(fs); const at = whole ? 0 : f.indexOf(fs); const len = whole ? f.length : s.span.length; for (let i = at; i < at + len; i++) covered.add(i); }
    const total = letters(span), hit = [...covered].filter(i => /\p{L}/u.test(span[i])).length;
    if (inside.length && total > 0 && hit / total >= coverage) classified.push({...(leftover.span ? leftover : {span}), kinds: [...new Set(inside.map(s => s.kind))]});
    else remaining.push(leftover);
  }
  return {classified, remaining};
}

export function createEmotionDetectionSystem({strategies = [], enabled = true, latencyBudgetMs = 400, minScore = 0.5, emitUnclassified = false, kindPolicy = {}, kindEmoji = {}, coverageSkip = 0.9, now = () => performance.now()} = {}) {
  const state = {enabled};
  const status = (strategy, kind) => kindPolicy[`${strategy}.${kind}`] ?? 'on';

  async function detect(message, {analysis = null, englishText = null, leftoverSpans = []} = {}) {
    const started = now();
    if (!state.enabled || typeof message !== 'string' || !message.trim()) return {signals: [], leftovers: {classified: [], remaining: leftoverSpans}, trace: {enabled: state.enabled, elapsedMs: 0, strategies: []}};
    const context = {analysis, englishText, leftoverSpans};
    const trace = [], collected = [];
    const run = async strategy => {
      const t0 = now();
      try {
        const budget = Math.max(1, latencyBudgetMs - (t0 - started));
        const found = strategy.cost === 'costly' ? await withTimeout(strategy.detect(message, context), budget) : await strategy.detect(message, context);
        collected.push(...found.map(s => ({...s, source: s.source ?? strategy.id})));
        trace.push({id: strategy.id, ms: Math.round((now() - t0) * 100) / 100, signals: found.length});
      } catch (error) { trace.push({id: strategy.id, ms: Math.round((now() - t0) * 100) / 100, error: error.message}); }
    };
    for (const s of strategies.filter(x => x.cost !== 'costly')) await run(s);
    const covered = letters(collected.filter(s => s.span && !s.leftover).map(s => s.span).join(' ')) / Math.max(1, letters(message));
    const costly = strategies.filter(x => x.cost === 'costly');
    if (costly.length && covered >= coverageSkip) for (const s of costly) trace.push({id: s.id, skipped: 'covered_by_symbolic'});
    else await Promise.all(costly.map(run));
    const signals = [];
    for (const s of collected.sort((a, b) => b.score - a.score)) {
      if (!PRAGMATIC_KINDS.includes(s.kind) || s.score < minScore || (s.kind === 'unclassified' && !emitUnclassified)) continue;
      const policy = status(s.source, s.kind);
      if (policy === 'off') continue;
      if (signals.some(k => k.kind === s.kind && k.source === s.source && fold(k.span ?? '') === fold(s.span ?? ''))) continue;
      const signal = kindEmoji[s.kind] ? {...s, emoji: kindEmoji[s.kind]} : s;
      signals.push(policy === 'experimental' ? {...signal, experimental: true} : signal);
    }
    return {signals, leftovers: classifyLeftovers(leftoverSpans, signals.filter(s => !s.experimental)), trace: {enabled: true, elapsedMs: Math.round((now() - started) * 100) / 100, strategies: trace}};
  }

  return {
    detect,
    get enabled() { return state.enabled; },
    setEnabled(value) { state.enabled = Boolean(value); },
    strategyIds: () => strategies.map(s => s.id),
    close() { for (const s of strategies) s.close?.(); },
  };
}

/** Builds the system from config/emotion-detection.json (or a given config object): the symbolic strategy. */
export function createDefaultEmotionDetectionSystem(config = loadConfig(), {enabled} = {}) {
  const strategies = [];
  const s = config.strategies ?? {};
  if (s.symbolic?.enabled !== false) strategies.push(createSymbolicStrategy());
  return createEmotionDetectionSystem({strategies, enabled: enabled ?? config.enabled, latencyBudgetMs: config.latencyBudgetMs, minScore: config.minScore, emitUnclassified: config.emitUnclassified, kindPolicy: config.kindPolicy ?? {}, kindEmoji: config.kindEmoji ?? {}});
}
