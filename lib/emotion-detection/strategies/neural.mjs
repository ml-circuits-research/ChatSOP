/** Optional neural strategy (id `neural`, basis `classifier`, DS029): local CPU text classifiers behind a Python worker
 * (`training/python/emotion_worker.py`, run in `~/emotion-venv`, no network, no GPU). It reads the English text, so
 * Romanian and mixed messages are classified after textToCleanEnglish (LanguageProofingLLM). Each model's labels are
 * mapped to the closed kinds by `config.map`; a label becomes a signal when its probability reaches its threshold
 * (`config.thresholds["model.label"]`, then `config.thresholds[kind]`, then `config.defaultThreshold`, default 0.5).
 */
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const expand = p => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(ROOT, p));

/** Maps one text's raw `{model: {label: p}}` scores to signals. */
export function signalsFromScores(scores, config) {
  const out = [];
  for (const [model, labels] of Object.entries(scores)) {
    const map = config.map?.[model] ?? {};
    for (const [label, p] of Object.entries(labels)) {
      const kind = map[label];
      if (!kind) continue;
      const threshold = config.thresholds?.[`${model}.${label}`] ?? config.thresholds?.[kind] ?? config.defaultThreshold ?? 0.5;
      if (p >= threshold) out.push({kind, label, score: Math.round(p * 1000) / 1000, span: null, source: model, basis: 'classifier'});
    }
  }
  return out;
}

export function createNeuralStrategy(config, {spawnProcess = spawn} = {}) {
  let child = null, ready = null, buffer = '';
  const pending = new Map();
  let nextId = 1;

  function start() {
    if (ready) return ready;
    const args = [expand(config.worker), '--threads', String(config.threads ?? 4), ...Object.entries(config.models ?? {}).flatMap(([name, m]) => ['--model', `${name}=${expand(m.dir)}`])];
    child = spawnProcess(expand(config.python), args, {stdio: ['pipe', 'pipe', 'inherit'], env: {...process.env, HF_HUB_OFFLINE: '1', TORCH_DISABLE_NATIVE_JIT: '1'}});
    ready = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => {
        for (const p of pending.values()) p.reject(new Error('emotion worker exited ' + code));
        pending.clear(); ready = null; child = null;
        reject(new Error('emotion worker exited ' + code));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.ready) { resolve(); continue; }
          pending.get(msg.id)?.resolve(msg.scores); pending.delete(msg.id);
        }
      });
    });
    ready.catch(() => {});
    return ready;
  }

  /** Raw scores for several texts: [{model: {label: p}}]. */
  async function scoreBatch(texts) {
    await start();
    const id = nextId++;
    return new Promise((resolve, reject) => { pending.set(id, {resolve, reject}); child.stdin.write(JSON.stringify({id, texts}) + '\n'); });
  }

  return {
    id: 'neural',
    kinds: [...new Set(Object.values(config.map ?? {}).flatMap(m => Object.values(m)))],
    scoreBatch,
    async detect(message, {englishText} = {}) {
      const [scores] = await scoreBatch([englishText ?? message]);
      return signalsFromScores(scores, config);
    },
    close() { child?.kill(); },
  };
}
