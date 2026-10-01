/**
 * Oracle of the proofing corpus (experiment proofing-candidates-v1): a text passes when the FROZEN symbolic path
 * (Stanza UD worker + lib/ud-to-sop at a frozen rules version) turns it into an SOP program that matches the gold of
 * its source row. No human and no LLM judge is involved.
 *
 * A frozen version lives in eval/reports/history/baseline-ud-rules/frozen-rules-<v>/ (SHA256SUMS). Its files import
 * the repository parser by a path relative to lib/ud-to-sop/, so `loadFrozenRules(v)` copies the directory to
 * eval/reports/current/proofing/rules/<v>/ after checking every hash, rewrites only the `../../sop/` imports and the
 * worker path to absolute file URLs, and imports the copy. Live edits of lib/ud-to-sop by other agents therefore never
 * change a score. Stanza parses are cached per (worker hash, masked text) because the rules do not change the parse.
 *
 * Scoring: eval/run.mjs executes gold and prediction against the row's verification world; `strict` is
 * `execution_equivalent`, `tolerant` is `execution_equivalent_tolerant`. The row keeps its ORIGINAL message (a rewrite
 * only changes the text the parser sees), exactly like tools/research/rewrite-symbolic-eval.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = path.join(ROOT, 'eval/reports/current/proofing');
const FROZEN = path.join(ROOT, 'eval/reports/history/baseline-ud-rules');
export const sha = text => createHash('sha256').update(text).digest('hex');
export const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
export const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
export const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };

/** Newest frozen rules version on disk ("v1.3", "v1.4", …). */
export function frozenVersions() {
  return fs.readdirSync(FROZEN).map(d => /^frozen-rules-(v\d+\.\d+)$/.exec(d)?.[1]).filter(Boolean)
    .filter(v => fs.existsSync(path.join(FROZEN, 'frozen-rules-' + v, 'SHA256SUMS')))
    .sort((a, b) => a.slice(1).split('.').map(Number).reduce((x, n, i) => x || n - b.slice(1).split('.').map(Number)[i], 0));
}

const loaded = new Map();
/** Import a frozen rules version: {version, convertParse, maskMessage, StanzaWorker, workerSha, sums}. */
export async function loadFrozenRules(version) {
  if (loaded.has(version)) return loaded.get(version);
  const src = path.join(FROZEN, 'frozen-rules-' + version);
  const sums = fs.readFileSync(path.join(src, 'SHA256SUMS'), 'utf8').trim().split('\n').map(l => l.trim().split(/\s+/)).map(([h, f]) => ({h, f}));
  for (const {h, f} of sums) if (sha(fs.readFileSync(path.join(src, f))) !== h) throw Error(`frozen ${version}: ${f} does not match SHA256SUMS`);
  const dst = path.join(OUT, 'rules', version);
  fs.mkdirSync(dst, {recursive: true});
  const sopUrl = pathToFileURL(path.join(ROOT, 'sop')).href + '/';
  const worker = path.join(src, 'ud_parse_worker.py');
  for (const f of fs.readdirSync(src)) {
    let text = fs.readFileSync(path.join(src, f), 'utf8');
    if (f.endsWith('.mjs')) {
      text = text.replace(/from '\.\.\/\.\.\/sop\//g, `from '${sopUrl}`);
      if (f === 'stanza.mjs') text = text.replace(/export const WORKER = [^\n]+/, `export const WORKER = ${JSON.stringify(worker)};`);
    }
    fs.writeFileSync(path.join(dst, f), text);
  }
  const index = await import(pathToFileURL(path.join(dst, 'index.mjs')).href);
  const stanza = await import(pathToFileURL(path.join(dst, 'stanza.mjs')).href);
  const protect = fs.existsSync(path.join(dst, 'protect.mjs')) ? await import(pathToFileURL(path.join(dst, 'protect.mjs')).href) : null;
  const rules = {version, convertParse: index.convertParse, maskMessage: index.maskMessage, StanzaWorker: stanza.StanzaWorker, protect,
    workerSha: sha(fs.readFileSync(worker)), sums: Object.fromEntries(sums.map(s => [s.f, s.h]))};
  loaded.set(version, rules);
  return rules;
}

/** Parse cache: one JSON line per masked text, keyed by sha(workerSha + text). */
export class ParseCache {
  constructor(rules, {device = 'cuda'} = {}) {
    this.rules = rules; this.device = device;
    this.file = path.join(OUT, 'cache', 'parses-' + rules.workerSha.slice(0, 12) + '.jsonl');
    this.map = new Map();
    if (fs.existsSync(this.file)) for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) { if (!line) continue; try { const r = JSON.parse(line); this.map.set(r.k, r.p); } catch { /* torn last line */ } }
    this.worker = null;
  }
  key(text) { return sha(this.rules.workerSha + '\u0000' + text); }
  async parseAll(texts, {batch = 64, log = null} = {}) {
    const masked = texts.map(t => this.rules.maskMessage(t));
    const todo = [...new Set(masked.filter(m => !this.map.has(this.key(m))))];
    if (todo.length) {
      this.worker ??= new this.rules.StanzaWorker({device: this.device});
      await this.worker.start();
      fs.mkdirSync(path.dirname(this.file), {recursive: true});
      for (let i = 0; i < todo.length; i += batch) {
        const chunk = todo.slice(i, i + batch);
        const {parses} = await this.worker.parseMany(chunk);
        const lines = chunk.map((m, j) => { const k = this.key(m); this.map.set(k, parses[j]); return JSON.stringify({k, p: parses[j]}); });
        fs.appendFileSync(this.file, lines.join('\n') + '\n');
        if (log && (i / batch) % 20 === 0) log(`parsed ${Math.min(i + batch, todo.length)}/${todo.length}`);
      }
    }
    return masked.map(m => this.map.get(this.key(m)));
  }
  async stop() { if (this.worker) await this.worker.stop(); this.worker = null; }
}

/** Convert texts (already parsed) with the rules: [{sop, valid, outcome, unparsed:[{span,hint,why}], notes}]. */
export function convertAll(rules, texts, parses) {
  return texts.map((text, i) => {
    if (!String(text).trim()) return {sop: '@u unclear\n  kind no_request\n', valid: true, outcome: 'empty', unparsed: [], notes: []};
    try {
      const r = rules.convertParse(parses[i], text);
      return {sop: r.sop, valid: r.valid, outcome: r.outcome, unparsed: r.wires.filter(w => w.type === 'unparsed').map(({span, hint, why}) => ({span, hint, why})), notes: r.notes ?? []};
    } catch (error) { return {sop: '', valid: false, outcome: 'crash', unparsed: [], notes: ['converter: ' + error.message]}; }
  });
}

/**
 * Score predictions against source rows with eval/run.mjs: Map id -> {strict, tolerant, canonical}. `rows` are the
 * source rows (their original question), `preds` [{id, sop}]; ids must be unique within one call.
 */
export function scoreRows(rows, preds, workDir, {chunk = 2000} = {}) {
  fs.mkdirSync(workDir, {recursive: true});
  const out = new Map();
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const ids = new Set(part.map(r => r.id));
    const suite = path.join(workDir, `suite-${i}.jsonl`), pred = path.join(workDir, `pred-${i}.jsonl`), rep = path.join(workDir, `eval-${i}.json`);
    writeJsonl(suite, part);
    writeJsonl(pred, preds.filter(p => ids.has(p.id)));
    execFileSync(process.execPath, [path.join(ROOT, 'eval/run.mjs'), '--file', suite, '--predictions', pred, '--out', rep], {cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 30});
    const report = JSON.parse(fs.readFileSync(rep, 'utf8'));
    for (const r of report.records) out.set(r.id, {strict: !!r.execution_equivalent, tolerant: !!r.execution_equivalent_tolerant, canonical: !!r.canonical_match});
    for (const f of [suite, pred, rep]) fs.rmSync(f, {force: true});
  }
  return out;
}
