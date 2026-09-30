/** Live project status (`/experiments/timeline`, `/experiments/api/status`;
 * the former `/project/api/status` stays as an API alias) and the JSON APIs of
 * the project history (`/experiments/api/{tasks,topics,notes,report}`, data in
 * server/history.mjs).
 *
 * Everything on the page is computed on request from files, so it stays near
 * real time: the append-only journal and the experiment registry
 * (lib/journal.mjs, `status/`), the training rule in AGENTS.md, qualification
 * and preflight records, the corpora on disk, the machine corpus audits, the
 * vocabulary check, the sealed-test leakage audit and `questions.md`.
 * Nothing here opens a gate: training stays prohibited until the owner's new
 * explicit approval, whatever the computed checks say.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recentEvents, readExperiments, journalFile, experimentsFile, statusDir, JOURNAL_AREAS} from '../lib/journal.mjs';
import {jsonlExists, shardPaths} from '../lib/jsonl-shards.mjs';
import {targetForm} from './eval-browser.mjs';
import {loadHistory, entries, topicSummaries, readReport, listReports} from './history.mjs';
import {corpusDir, corpusNames} from '../lib/dataset-paths.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** Rows of a JSONL file (newline count) and a sample of its first rows, cached by size and mtime. */
const fileCache = new Map();
function jsonlStats(file) {
  // A split may be stored as shards (lib/jsonl-shards.mjs); rows are counted across every part.
  const parts = shardPaths(file);
  if (!parts.length) return null;
  const stamp = parts.map(part => { const stat = fs.statSync(part); return `${part}:${stat.size}:${stat.mtimeMs}`; }).join('|');
  const hit = fileCache.get(file);
  if (hit?.stamp === stamp) return hit.value;
  const buffer = Buffer.alloc(4 << 20);
  let rows = 0, head = '';
  for (const part of parts) {
    const fd = fs.openSync(part, 'r');
    let position = 0, last = 0x0a;
    try {
      for (;;) {
        const read = fs.readSync(fd, buffer, 0, buffer.length, position);
        if (!read) break;
        if (position === 0 && !head) head = buffer.toString('utf8', 0, Math.min(read, 256 * 1024));
        for (let i = 0; i < read; i++) if (buffer[i] === 0x0a) rows++;
        last = buffer[read - 1];
        position += read;
      }
    } finally {
      fs.closeSync(fd);
    }
    if (position && last !== 0x0a) rows++;
  }
  const sample = head.split('\n').slice(0, -1).slice(0, 40).flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const value = {rows, sample};
  fileCache.set(file, {stamp, value});
  return value;
}

/** Directory of a corpus (or of a nested projection `<corpus>/<sub>`) under datasets/ or datasets_archive/. */
const corpusPath = (root, name) => path.join(root, corpusDir(name.split('/')[0], root), ...name.split('/').slice(1));

/** Corpus directories under datasets/ and datasets_archive/ (one or two levels deep) that hold train or dev splits. */
function corpora(root) {
  const found = [];
  const visit = (relative, depth) => {
    const dir = corpusPath(root, relative);
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    const corpus = entries.some(entry => entry.isFile() && /^(train|dev)\.jsonl$/.test(entry.name));
    if (corpus) found.push(relative);
    // formalizer/, system/ and verbalizer/ under a corpus are its training projections, not separate corpora.
    if (depth < 2 && !corpus) for (const entry of entries) if (entry.isDirectory()) visit(path.posix.join(relative, entry.name), depth + 1);
  };
  for (const name of corpusNames(root)) visit(name, 1);
  // A sealed-only suite (such as the out-of-distribution suite) has a test split under eval/suites/ and no train/dev.
  const suites = path.join(root, 'eval/suites');
  if (fs.existsSync(suites)) for (const entry of fs.readdirSync(suites, {withFileTypes: true}))
    if (entry.isDirectory() && !found.includes(entry.name) && jsonlExists(path.join(suites, entry.name, 'test.jsonl'))) found.push(entry.name);
  return found.sort();
}

/** Machine corpus-audit reports indexed by the directory of their train split. */
function auditReports(root) {
  const dir = path.join(root, 'eval/reports/current/corpus-audit');
  const byCorpus = new Map();
  if (!fs.existsSync(dir)) return byCorpus;
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
    const report = readJson(path.join(dir, name));
    if (!report) continue;
    const trainDir = report.files?.train?.file ? path.posix.dirname(report.files.train.file).replace(/^datasets(?:_archive)?\//, '') : null;
    byCorpus.set(trainDir ?? report.corpus ?? name.slice(0, -5), {file: `eval/reports/current/corpus-audit/${name}`, report});
  }
  return byCorpus;
}

/** Live data pipeline status per corpus. */
export function dataPipeline(root = projectRoot) {
  const audits = auditReports(root);
  return corpora(root).map(name => {
    const splits = {};
    let sample = [];
    for (const split of ['train', 'dev']) {
      const stats = jsonlStats(path.join(corpusPath(root, name), split + '.jsonl'));
      if (stats) {
        splits[split] = stats.rows;
        if (!sample.length) sample = stats.sample;
      }
    }
    const sealed = [path.join(root, 'eval/suites', name, 'test.jsonl'), path.join(corpusPath(root, name), 'test.jsonl')].find(file => jsonlExists(file));
    if (sealed) splits.test = jsonlStats(sealed).rows;
    const forms = {};
    if (!sample.length && sealed) sample = jsonlStats(sealed).sample;
    for (const row of sample) forms[targetForm(row)] = (forms[targetForm(row)] ?? 0) + 1;
    delete forms.undetermined;
    const form = forms.current && !forms.legacy ? 'current' : forms.legacy && !forms.current ? 'legacy' : Object.keys(forms).length ? 'mixed' : 'unknown';
    const audit = audits.get(name);
    const report = audit?.report;
    const leak = report?.leakage?.test_vs_development;
    return {
      corpus: name, splits, rows: Object.values(splits).reduce((a, b) => a + b, 0),
      form, form_sample: forms, test_file: sealed ? path.relative(root, sealed) : null,
      audit: report ? {
        file: audit.file, verdict: report.verdict?.status ?? null, failed_checks: report.verdict?.failed_checks ?? [], invariant_failures: report.verdict?.invariant_failures ?? null,
        faithfulness_error_rate: report.faithfulness?.error_rate ?? null,
        template_top_share: report.diversity?.development?.templates?.top_share ?? null,
        template_distinct_ratio: report.diversity?.development?.templates?.distinct_ratio ?? null,
        test_template_overlap: leak?.template_overlap ?? null, test_exact_overlap: leak?.exact_input_overlap ?? null,
      } : null,
    };
  });
}

/** The vocabulary hallucination check, summarised. */
function vocabulary(root) {
  const file = path.join(root, 'eval/reports/current/vocabulary.json');
  const report = readJson(file);
  if (!report) return null;
  return {file: 'eval/reports/current/vocabulary.json', verdict: report.verdict ?? null, totals: report.totals ?? null, scope: report.scope ?? null, scanned: report.scanned ?? null, mtime: fs.statSync(file).mtime.toISOString()};
}

/** The AGENTS.md training rule, quoted live. */
function trainingRule(root) {
  const text = fs.existsSync(path.join(root, 'AGENTS.md')) ? fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8') : '';
  const line = text.split('\n').find(entry => /prohibits training/.test(entry));
  return line ? line.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '') : null;
}

/** Records under training/ or models/ whose name says qualification (none exist yet). */
function qualificationRecords(root) {
  const out = [];
  const walk = (relative, depth) => {
    const dir = path.join(root, relative);
    let entries;
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.posix.join(relative, entry.name);
      if (entry.isDirectory() && depth < 4 && !['bases', 'node_modules'].includes(entry.name)) walk(next, depth + 1);
      else if (entry.isFile() && /qualif/i.test(entry.name) && entry.name.endsWith('.json')) out.push(next);
    }
  };
  walk('training', 0);
  walk('models', 0);
  return out;
}

/** Infrastructure preflight evidence from rootless Podman runs (models/.container-runs/*preflight*). */
function preflight(root) {
  const dir = path.join(root, 'models/.container-runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /preflight/.test(name)).map(name => {
    const result = readJson(path.join(dir, name, 'result.json'));
    return {run: name, exitCode: result?.exitCode ?? null, oomKilled: result?.oomKilled ?? null, at: result?.at ?? null};
  });
}

/** Gates in order. `open` is a computed observation; only the owner opens the training gate. */
export function gates(root = projectRoot, {pipeline = dataPipeline(root), experiments = []} = {}) {
  const rule = trainingRule(root);
  const vocab = vocabulary(root);
  const leakage = readJson(path.join(root, 'eval/reports/current/registry/leakage.json'));
  const sweep = readJson(path.join(root, 'eval/reports/current/no-context-sweep.json'));
  const sweepGone = (sweep?.findings ?? []).filter(finding => finding.file && !fs.existsSync(path.join(root, String(finding.file).split(':')[0]))).length;
  const guards = ['tests/model-input-boundary.test.mjs', 'tests/no-context-lint.test.mjs', 'tools/lint/model-surface.mjs'].map(file => ({file, exists: fs.existsSync(path.join(root, file))}));
  const flights = preflight(root);
  const records = qualificationRecords(root);
  const registry = readJson(path.join(root, 'eval/registry/manifest.json'));
  const predictionCells = (registry?.cells ?? []).map(cell => ({cell: cell.id, predictions: cell.predictions, exists: fs.existsSync(path.join(root, cell.predictions ?? ''))}));
  const current = pipeline.filter(entry => entry.form === 'current');
  const audited = pipeline.filter(entry => entry.audit);
  const passing = audited.filter(entry => entry.audit.verdict === 'pass');
  const prereg = experiments.filter(entry => ['preregistered', 'approved', 'running', 'done'].includes(entry.status));
  return [
    {id: 'owner-approval', title: 'Owner approval for training', open: false, prohibited: true,
      evidence: rule ?? 'AGENTS.md rule 3', source: 'AGENTS.md', note: 'PROHIBITED until the owner gives a new explicit approval. Never inferred from any check below.'},
    {id: 'language', title: 'Corpora written in the current language (message-only, string targets)', open: pipeline.length > 0 && current.length === pipeline.length,
      evidence: `${current.length} of ${pipeline.length} corpora sampled as current${current.length < pipeline.length ? `; not current: ${pipeline.filter(entry => entry.form !== 'current').map(entry => `${entry.corpus} (${entry.form})`).join(', ')}` : ''}`, source: 'datasets/*/{train,dev}.jsonl, eval/suites/*/test.jsonl'},
    {id: 'corpus-audit', title: 'Machine corpus audit passes', open: audited.length > 0 && passing.length === audited.length && audited.length === pipeline.length,
      evidence: `${passing.length} of ${audited.length} audited corpora pass; ${pipeline.length - audited.length} corpora have no audit report`, source: 'eval/reports/current/corpus-audit/'},
    {id: 'vocabulary', title: 'Vocabulary check: no undocumented (hallucinated) wires', open: vocab?.verdict === 'pass',
      evidence: vocab ? `verdict ${vocab.verdict}; ${vocab.totals?.failing ?? "?"} failing of ${vocab.totals?.findings ?? "?"} findings` : "no report", source: 'eval/reports/current/vocabulary.json'},
    {id: 'no-context', title: 'Model input is the message only (no-context guards in place)', open: guards.every(guard => guard.exists),
      evidence: `guards: ${guards.map(guard => `${guard.file} ${guard.exists ? 'present' : 'MISSING'}`).join('; ')} (run by npm test)` +
        (sweep ? `; the ${sweep.meta?.generated ?? 'undated'} sweep snapshot listed ${sweep.findings?.length ?? '?'} findings, ${sweepGone} of them in files deleted since` : ''),
      source: 'tests/model-input-boundary.test.mjs, tests/no-context-lint.test.mjs, eval/reports/current/no-context-sweep.json'},
    {id: 'sealed-boundary', title: 'Sealed-test boundary guard (training/selection reads train/dev only)', open: leakage?.training_selection_guard_passed === true,
      evidence: leakage ? `training_selection_guard_passed: ${leakage.training_selection_guard_passed}; ${(leakage.problems ?? []).length} problems listed` : 'no leakage audit', source: 'eval/reports/current/registry/leakage.json'},
    {id: 'preflight', title: 'CUDA infrastructure preflight (no optimizer)', open: flights.some(run => run.exitCode === 0 && run.oomKilled === false),
      evidence: flights.length ? flights.map(run => `${run.run}: exit ${run.exitCode}, OOM ${run.oomKilled}`).join('; ') : 'no preflight record', source: 'models/.container-runs/'},
    {id: 'qualification', title: 'Dataset / run qualification record', open: records.length > 0,
      evidence: records.length ? records.join(', ') : 'no qualification record under training/ or models/', source: 'training/, models/'},
    {id: 'preregistration', title: 'Preregistered experiment (DS010)', open: prereg.length > 0,
      evidence: `${prereg.length} preregistered of ${experiments.length} registered`, source: 'status/experiments.json'},
    {id: 'model-predictions', title: 'Real model predictions for dev and sealed test', open: predictionCells.length > 0 && predictionCells.every(cell => cell.exists),
      evidence: predictionCells.length ? predictionCells.map(cell => `${cell.cell}: ${cell.exists ? 'present' : 'missing'}`).join('; ') : 'no registry manifest', source: 'eval/registry/manifest.json'},
  ];
}

/** questions.md, raw; the page renders it. */
function questions(root) {
  const file = path.join(root, 'questions.md');
  return fs.existsSync(file) ? {file: 'questions.md', path: file, text: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtime.toISOString()} : null;
}

/** Everything `/project` shows, computed now. */
export function projectStatus({root = projectRoot, dir = statusDir(), area = null, limit = 300} = {}) {
  const pipeline = dataPipeline(root);
  let journalError = null, experimentsError = null, journal = [], registry = {experiments: []};
  try {
    journal = recentEvents({file: journalFile(dir), area, limit});
  } catch (error) {
    journalError = error.message;
  }
  try {
    registry = readExperiments({file: experimentsFile(dir)});
  } catch (error) {
    experimentsError = error.message;
  }
  return {
    generated: new Date().toISOString(),
    phase: {name: 'Data preparation and owner review before training', training: 'prohibited', rule: trainingRule(root)},
    gates: gates(root, {pipeline, experiments: registry.experiments}),
    journal, journalError, areas: JOURNAL_AREAS, journalFile: path.relative(root, journalFile(dir)) || journalFile(dir),
    pipeline, vocabulary: vocabulary(root),
    experiments: registry.experiments, experimentsNote: registry.note ?? null, experimentsError,
    questions: questions(root),
  };
}

/** Handles `/experiments/api/*` (and the alias `/project/api/*`); returns true when handled. Pages are served by server/web.mjs. */
export function createProjectRouter({root = projectRoot} = {}) {
  const handle = async (req, res, pathname, query, send) => {
    const match = /^\/(?:experiments|project)\/api\/([a-z]+)$/.exec(pathname);
    if (!/^\/(?:experiments|project)\/api\//.test(pathname)) return false;
    const endpoint = req.method === 'GET' ? match?.[1] : null;
    const history = () => loadHistory({root});
    if (endpoint === 'status') return send(200, projectStatus({root, area: JOURNAL_AREAS.includes(query.area) ? query.area : null})), true;
    if (endpoint === 'tasks') {
      const data = history();
      return send(200, {entries: entries(data), tasks: data.tasks, phase: data.phase, errors: data.errors}), true;
    }
    if (endpoint === 'topics') {
      const data = history();
      return send(200, {topics: topicSummaries(data).map(({latest, ...topic}) => ({...topic, latest: latest ? {id: latest.id, ts: latest.ts, kind: latest.kind, title: latest.title} : null})), errors: data.errors}), true;
    }
    if (endpoint === 'notes') {
      const data = history();
      const notes = data.notes.filter(note => (!query.topic || note.topic === query.topic) && (!query.kind || note.kind === query.kind) && (!query.author || note.author === query.author));
      return send(200, {notes, errors: data.errors}), true;
    }
    if (endpoint === 'report') {
      try {
        return send(200, query.path ? readReport(root, query.path) : listReports(root, query.dir ?? null)), true;
      } catch (error) {
        return send(error.status ?? 400, {error: {message: error.message, code: error.code ?? 'invalid_request'}}), true;
      }
    }
    send(404, {error: {message: 'Unknown experiments endpoint', code: 'not_found'}});
    return true;
  };
  return {handle};
}
