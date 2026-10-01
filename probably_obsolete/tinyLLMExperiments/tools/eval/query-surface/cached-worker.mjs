/**
 * A Stanza worker for SymbolicLM that answers from recorded parses and, for a text it has not recorded, from a live
 * worker (device `auto`, lib/ud-to-sop/device.mjs: the GPU only when free), recording the answer. Used by the
 * query-surface evaluation so a rule change replays in seconds while new texts are parsed once.
 */
import fs from 'node:fs';
import path from 'node:path';
import {StanzaWorker} from '../../../lib/ud-to-sop/stanza.mjs';

export class CachedWorker {
  /** `files`: read-only caches (`{parses}` JSON); `own`: the cache this worker writes (new parses). */
  constructor({files = [], own, device = 'auto'} = {}) {
    this.parses = {};
    for (const f of files) if (fs.existsSync(f)) Object.assign(this.parses, JSON.parse(fs.readFileSync(f, 'utf8')).parses);
    this.own = own;
    this.fresh = {};
    if (own && fs.existsSync(own)) { const mine = JSON.parse(fs.readFileSync(own, 'utf8')).parses; Object.assign(this.parses, mine); Object.assign(this.fresh, mine); }
    this.device = device;
    this.live = null;
    this.package = 'accurate';
    this.misses = 0;
  }
  async start() { return {ready: true}; }
  key(text, language) { return `${language ?? 'auto'}|${text}`; }
  liveWorker() { return (this.live ??= new StanzaWorker({device: this.device, env: {OMP_NUM_THREADS: '4'}})); }
  async request({text, language}) {
    const key = this.key(text, language);
    if (this.parses[key]) return {parse: this.parses[key], ms: 0};
    this.misses++;
    const answer = await this.liveWorker().request({id: 0, text, ...(language ? {language} : {})});
    this.parses[key] = this.fresh[key] = answer.parse;
    return {parse: answer.parse, ms: answer.ms};
  }
  async parseMany(texts, languages = []) {
    const missing = texts.map((t, i) => [t, languages[i]]).filter(([t, l]) => !this.parses[this.key(t, l)]);
    if (missing.length) {
      this.misses += missing.length;
      const answer = await this.liveWorker().parseMany(missing.map(m => m[0]), missing.map(m => m[1]));
      missing.forEach(([t, l], i) => { this.parses[this.key(t, l)] = this.fresh[this.key(t, l)] = answer.parses[i]; });
    }
    return {parses: texts.map((t, i) => this.parses[this.key(t, languages[i])]), ms: 0};
  }
  save() {
    if (!this.own || !Object.keys(this.fresh).length) return;
    fs.mkdirSync(path.dirname(this.own), {recursive: true});
    fs.writeFileSync(this.own, JSON.stringify({note: 'Stanza parses recorded by tools/eval/query-surface.mjs (texts not in the symbolic-regression cache).', parses: this.fresh}) + '\n');
  }
  async stop() { this.save(); await this.live?.stop(); this.live = null; }
}
