/** Shared pieces of the neuro_english rewrite-candidate oracle (tools/datasets/neuro-targets-oracle.mjs): paths, the
 * rows of neuro_english and symbolic_english, the DeepSeek candidates, and the recorded Stanza parses.
 *
 * The candidates are read-only input (`datasets_sources/neuro_english_targets/output/`); every observation goes under
 * `eval/reports/current/neuro-oracle/` (regenerable). Nothing here reads a sealed test file: the sealed side (test rows, their
 * gold, the sealed pair file) is tools/eval/neuro-oracle-test.mjs, which reuses these modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {readJsonlShardedSync, jsonlExists} from '../../../lib/jsonl-shards.mjs';

export {ROOT};
export const SOURCE_DIR = path.join(ROOT, 'datasets_sources/neuro_english_targets');
export const WORK = path.join(ROOT, 'eval/reports/current/neuro-oracle');
export const textKey = text => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
export const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };

/** Train and dev rows of a dataset with their split. The sealed test rows are read only by tools/eval/neuro-oracle-test.mjs (AGENTS.md rule 9). */
export function datasetRows(dataset, splits = ['train', 'dev']) {
  const out = [];
  for (const split of splits) { const file = path.join(ROOT, 'datasets', dataset, `${split}.jsonl`); if (jsonlExists(file)) for (const row of readJsonlShardedSync(file)) out.push({...row, split}); }
  return out;
}

/** Composed long cases and form variants carry their own verified target (tools/datasets/composed-train.mjs, form-variants.mjs); the oracle leaves them out and the pair builder takes them through its hook. */
export const isComposedRow = row => ['composed', 'form-variant'].includes(row.source?.corpus) || row.composed === true;

/** Second candidate folder: the rewrite candidates of the neuro rows that the analysis-layer re-split added (rows that were symbolic_english under the SOP-proxy split). */
export const RESPLIT_TARGETS_DIR = path.join(ROOT, 'datasets_sources/resplit_neuro_targets');
const PART = /^part-[a-z]?\d+\.jsonl$/; // part-NNN (train/dev rows) and part-sNNN (sealed rows)

/** The DeepSeek output: {id -> {candidates: [...]|null, unchanged, reason}} and the message of every input id. Without `dir`, both candidate folders are read. */
export function readTargets(dir = null) {
  const inputs = new Map(), outputs = new Map();
  for (const folder of dir ? [dir] : [SOURCE_DIR, RESPLIT_TARGETS_DIR]) {
    if (!fs.existsSync(path.join(folder, 'input'))) continue;
    for (const name of fs.readdirSync(path.join(folder, 'input')).filter(n => PART.test(n)).sort()) {
      for (const row of readJsonl(path.join(folder, 'input', name))) inputs.set(row.id, row.message);
      const out = path.join(folder, 'output', name);
      // the external agent may still be writing: a truncated last line is skipped
      if (fs.existsSync(out)) for (const line of fs.readFileSync(out, 'utf8').split('\n')) { if (!line) continue; try { const row = JSON.parse(line); outputs.set(row.id, row); } catch { /* partial line */ } }
    }
  }
  return {inputs, outputs};
}

/**
 * Writes the input parts of the neuro rows that have no DeepSeek output yet into the re-split candidate folder (`part-NNN` for train/dev rows, `part-sNNN`
 * for sealed rows; the sealed tool writes its own) and the task files. `rows`: neuro rows; returns {missing, parts}. Existing parts of the same kind are replaced.
 */
export function writeMissingTargetParts(rows, {sealed = false, perPart = 250} = {}) {
  const have = readTargets(SOURCE_DIR).outputs;
  const missing = rows.filter(r => !have.has(r.id) && typeof r.message === 'string' && r.message.trim());
  const folder = RESPLIT_TARGETS_DIR;
  fs.mkdirSync(path.join(folder, 'input'), {recursive: true});
  fs.mkdirSync(path.join(folder, 'output'), {recursive: true});
  const prefix = sealed ? 's' : '';
  for (const name of fs.readdirSync(path.join(folder, 'input'))) if (sealed ? /^part-s\d+\.jsonl$/.test(name) : /^part-\d+\.jsonl$/.test(name)) fs.unlinkSync(path.join(folder, 'input', name));
  const sorted = missing.slice().sort((a, b) => a.id.localeCompare(b.id));
  let parts = 0;
  for (let i = 0; i < sorted.length; i += perPart) { writeJsonl(path.join(folder, 'input', `part-${prefix}${String(parts).padStart(3, '0')}.jsonl`), sorted.slice(i, i + perPart).map(r => ({id: r.id, message: r.message}))); parts++; }
  const task = path.join(folder, 'TASK.md');
  if (!fs.existsSync(task)) {
    const old = fs.readFileSync(path.join(SOURCE_DIR, 'TASK.md'), 'utf8');
    const intro = `# Task: rewrite candidates for \`neuro_english\` (rows added by the analysis-layer re-split)

Each input line is a correct English message whose grammatical analysis by **SymbolicLM** (the Stanza dependency parse)
is not correct: the two Stanza packages disagree on it, or a parse judge rejects the analysis (a few rows are here because SymbolicLM left a span of them unparsed; rewrite those the same way). Your job is to rewrite
each message into the **limited English** whose analysis is correct, without changing its meaning. Write 1 to 3
different candidate rewrites per message. Afterwards, the ChatSOP side parses every candidate and keeps only the ones
whose analysis passes the gate and whose meaning is unchanged. The kept pairs train **SymbolicProofingLLM**, a very small
model (Gemma 3 270M) that will do this rewriting in production. So the rewrites must be simple, regular and teachable.

`;
    const rest = old.slice(old.indexOf('## Hard limits'))
      .replaceAll('datasets_sources/neuro_english_targets/', 'datasets_sources/resplit_neuro_targets/')
      .replace(/`input\/part-000\.jsonl` … `input\/part-023\.jsonl`, [\d,]+ lines/, '`input/part-NNN.jsonl` (train/dev rows) and `input/part-sNNN.jsonl` (sealed rows), all the lines')
      .replace('validate --file part-NNN.jsonl', 'validate --dir datasets_sources/resplit_neuro_targets --file part-NNN.jsonl');
    fs.writeFileSync(task, intro + rest);
    fs.copyFileSync(path.join(SOURCE_DIR, 'FORMS.md'), path.join(folder, 'FORMS.md'));
  }
  return {missing: missing.length, parts, folder: path.relative(ROOT, folder)};
}

/** Flat candidate list: {cid: '<row id>#<n>', id, n, text, src}. `rows` adds the verified target a neuro row already has (`#t`, src `dataset_target`). */
export function candidateList(outputs, rows = []) {
  const list = [];
  for (const [id, out] of outputs) (out.candidates ?? []).forEach((text, n) => list.push({cid: `${id}#${n}`, id, n, text, src: 'deepseek'}));
  for (const row of rows) if (typeof row.target === 'string' && row.target && row.target !== row.message) list.push({cid: `${row.id}#t`, id: row.id, n: 't', text: row.target, src: 'dataset_target'});
  return list;
}

// ------------------------------------------------------------------ recorded parses
const PART_BYTES = 25e6;
/** Stanza parses keyed like the SymbolicLM prefetch store (`<language>|<masked text>`), one JSONL family per package. */
export class ParseStore {
  constructor(name, dir = path.join(WORK, 'parses')) { this.name = name; this.dir = dir; this.map = null; }
  files() { return fs.existsSync(this.dir) ? fs.readdirSync(this.dir).filter(n => n.startsWith(`${this.name}.part-`) && n.endsWith('.jsonl')).sort().map(n => path.join(this.dir, n)) : []; }
  load() {
    if (this.map) return this.map;
    this.map = new Map();
    for (const file of this.files()) for (const line of fs.readFileSync(file, 'utf8').split('\n')) { if (!line) continue; try { const r = JSON.parse(line); this.map.set(r.key, r.parse); } catch { /* truncated last line of a killed run */ } }
    return this.map;
  }
  append(entries) {
    fs.mkdirSync(this.dir, {recursive: true});
    const text = entries.map(([key, parse]) => JSON.stringify({key, parse})).join('\n') + '\n';
    const files = this.files();
    let file = files.at(-1);
    if (!file || fs.statSync(file).size + text.length > PART_BYTES) file = path.join(this.dir, `${this.name}.part-${String(files.length).padStart(3, '0')}.jsonl`);
    fs.appendFileSync(file, text);
    for (const [key, parse] of entries) this.load().set(key, parse);
  }
  /** Replay object for `replayLm`: `{key -> parse}`. */
  record() { return Object.fromEntries(this.load()); }
}
