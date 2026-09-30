/**
 * Node client of the optional spaCy worker (training/python/spacy_worker.py), SymbolicLM's second English parser
 * for the `parser_disagreement` uncertainty reason. One long-lived child speaking JSON lines, answered in order.
 * Environment: `CHATSOP_SPACY_PYTHON` (default `~/spacy-venv/bin/python`). CPU only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SPACY_WORKER = path.join(ROOT, 'training/python/spacy_worker.py');
export const spacyPython = (env = process.env) => env.CHATSOP_SPACY_PYTHON ?? path.join(os.homedir(), 'spacy-venv/bin/python');
export const spacyMissing = (env = process.env) => (fs.existsSync(spacyPython(env)) ? null : 'spaCy venv not found: ' + spacyPython(env) + ' (see dependencies.md)');

export class SpacyWorker {
  constructor({python = spacyPython(), threads = 2} = {}) { Object.assign(this, {python, threads, child: null, pending: [], ready: null}); }

  start() {
    if (this.ready) return this.ready;
    this.child = spawn(this.python, [SPACY_WORKER], {stdio: ['pipe', 'pipe', 'ignore'], env: {...process.env, CUDA_VISIBLE_DEVICES: '', OMP_NUM_THREADS: String(this.threads)}});
    const lines = readline.createInterface({input: this.child.stdout});
    this.ready = new Promise((resolve, reject) => {
      let started = false;
      this.child.once('error', reject);
      this.child.once('exit', code => {
        const error = Error('spaCy worker exited with code ' + code);
        if (!started) reject(error);
        for (const job of this.pending.splice(0)) job.reject(error);
        this.child = null;
      });
      lines.on('line', line => {
        let data;
        try { data = JSON.parse(line); } catch { return; }
        if (!started) { if (data.ready) { started = true; resolve(data); } return; }
        const job = this.pending.shift();
        if (!job) return;
        if (data.error) job.reject(Error(data.error)); else job.resolve(data.tokens);
      });
    });
    return this.ready;
  }

  /** spaCy tokens of one text (offsets relative to it). */
  async parse(text) {
    await this.start();
    return new Promise((resolve, reject) => {
      this.pending.push({resolve, reject});
      this.child.stdin.write(JSON.stringify({id: 0, text}) + '\n');
    });
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    await new Promise(resolve => { const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.once('exit', () => { clearTimeout(t); resolve(); }); child.stdin.end(); child.kill('SIGTERM'); });
    this.child = null;
    this.ready = null;
  }
}
