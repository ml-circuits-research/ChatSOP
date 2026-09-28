/** Evaluation browser, mounted inside the main server under `/eval`,
 * `/eval/guide` and `/eval/api/*` (same access rules as the corpus audit).
 *
 * It shows only evaluation data, step by step:
 *
 *   suites     — the sealed tests `eval/suites/<name>/test.jsonl` (and their
 *                `system/` exports) plus the core suites `eval/suites/*.jsonl`;
 *   artifacts  — prediction files, registry manifests and report files under
 *                `eval/predictions`, `eval/registry`, `eval/reports/current`
 *                and `eval/reports/history` (the last marked historical).
 *
 * For one suite row it shows the message (the model input), the gold target,
 * what the evaluator executes and compares (with file:line citations), the
 * expected result and, when predictions or evaluator reports exist, the
 * prediction, its line diff against the gold and the per-row outcome.
 * Reports are attached to a suite by the evaluator's own fingerprint
 * (`suite_sha256 = sha256(stable(rows))`, eval/run.mjs). On request the page
 * runs the real evaluator (`evaluate` in eval/run.mjs) on one row. Nothing is
 * written.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assert, stable} from '../lib/util.mjs';
import {jsonlExists, readJsonlShardedSync, shardPaths} from '../lib/jsonl-shards.mjs';
import {barePrompt} from './llm.mjs';
import {cite} from './eval-guide.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
// Suites and predictions may be stored as shards (lib/jsonl-shards.mjs); the logical base path reads either form.
const readJsonl = file => readJsonlShardedSync(file);
const label = value => (value === undefined || value === null || value === '' ? 'none' : String(value));
const tally = values => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
};

/** Suites whose status the eval README records as historical (not an active suite). The legacy suites were
 * deleted with the regeneration (DS022); a historical suite would be listed here with its README citation. */
const HISTORICAL_SUITES = {};
const ARTIFACT_DIRS = [
  {key: 'predictions', label: 'Predictions', dir: 'eval/predictions', historical: false},
  {key: 'registry', label: 'Registry', dir: 'eval/registry', historical: false},
  {key: 'current', label: 'Reports: current', dir: 'eval/reports/current', historical: false},
  {key: 'history', label: 'Reports: history', dir: 'eval/reports/history', historical: true},
];
/** Case-level categories of a suite, in tree order. */
export const EVAL_FACETS = [
  {key: 'track', label: 'Evaluation track'},
  {key: 'form', label: 'Target form'},
  {key: 'language', label: 'Language'},
  {key: 'family', label: 'Family / structure'},
  {key: 'status', label: 'Expected status'},
  {key: 'input_mode', label: 'Input mode'},
  {key: 'prediction', label: 'Prediction'},
  {key: 'outcome', label: 'Outcome (latest report)'},
];

const targetOf = row => row.sop_target ?? row.target ?? null;
/**
 * The target form: `legacy` when the gold uses `premise` or identifier atoms
 * directly in `where`/`filter` (the old form with a CONTEXT shortlist),
 * `current` when it uses the context-free wires (stated, assumed, unclear) or
 * string `match` blocks, `undetermined` when nothing distinguishes them (for
 * example a numeric constraint alone). One language, no profiles (owner
 * decision 2026-09-28); legacy rows are to be regenerated.
 */
export function targetForm(row) {
  const target = targetOf(row);
  if (typeof target !== 'string') return 'none';
  if (/^@\S+\s+premise\b/m.test(target) || /^\s+where\s+(?!match\b|all\b|any\b)\S/m.test(target)) return 'legacy';
  if (/^@\S+\s+(stated|assumed|unclear)\b/m.test(target) || /^\s+(where\s+)?match\b/m.test(target)) return 'current';
  return 'undetermined';
}
/** The message a user typed. Legacy rows split it into context_assertions + question. */
const messageOf = row => [...(row.context_assertions ?? []), row.question ?? row.input ?? ''].join('\n');
/** The exact instruction-free model input (server/llm.mjs `barePrompt`): the message; legacy rows also carried CONTEXT. */
function modelInputOf(row, form) {
  try {
    return barePrompt(messageOf(row));
  } catch {
    return messageOf(row);
  }
}

/** Reads a file once and re-reads it only when its size or mtime changes. */
function cachedFile(parse) {
  const cache = new Map();
  return file => {
    const physical = file.endsWith('.jsonl') ? shardPaths(file) : [file];
    const stats = physical.map(item => fs.statSync(item, {throwIfNoEntry: false}));
    if (!stats.length || stats.some(stat => !stat)) return cache.delete(file), null;
    const stamp = physical.map((item, index) => `${item}:${stats[index].size}:${stats[index].mtimeMs}`).join('|');
    const hit = cache.get(file);
    if (hit?.stamp === stamp) return hit.value;
    const value = parse(file);
    cache.set(file, {stamp, value});
    return value;
  };
}

/** Line diff (LCS) between two short texts: `[{op:' '|'-'|'+', line}]`. */
export function lineDiff(before, after) {
  const a = String(before ?? '').replace(/\n$/, '').split('\n');
  const b = String(after ?? '').replace(/\n$/, '').split('\n');
  const table = Array.from({length: a.length + 1}, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push({op: ' ', line: a[i++]}), j++;
    else if (table[i + 1][j] >= table[i][j + 1]) out.push({op: '-', line: a[i++]});
    else out.push({op: '+', line: b[j++]});
  }
  while (i < a.length) out.push({op: '-', line: a[i++]});
  while (j < b.length) out.push({op: '+', line: b[j++]});
  return out;
}

/** The compact evaluator outcome of one report record. */
const outcomeOf = record => {
  if (!record) return 'not evaluated';
  if (record.error) return 'failed: ' + record.error.stage;
  if (record.execution_equivalent) return 'execution-equivalent';
  if (record.runtime_valid) return 'executed, not equivalent';
  return 'not equivalent';
};
const slimRecord = record => record && ({
  id: record.id, syntax_valid: record.syntax_valid, runtime_valid: record.runtime_valid, reference_valid: record.reference_valid,
  canonical_match: record.canonical_match, execution_equivalent: record.execution_equivalent, error: record.error ?? null,
  gold_status: record.gold_status ?? record.reference?.status ?? null, predicted_status: record.predicted_status ?? record.observed?.status ?? null,
  reference_answers: record.reference?.answers ?? null, observed_answers: record.observed?.answers ?? null,
  signatures_equal: record.prediction_signature !== undefined ? record.prediction_signature === record.reference_signature : null,
  propositions: record.propositions ?? null, timing_ms: record.timing_ms ?? null, route: record.route ?? null, prediction: record.prediction ?? null,
  outcome: outcomeOf(record),
});

export function createEvalRouter({root = projectRoot} = {}) {
  const rel = file => path.relative(root, file).split(path.sep).join('/');

  /** Suite descriptors, discovered on every call (cheap directory reads). */
  function discoverSuites() {
    const suites = [];
    const base = path.join(root, 'eval/suites');
    for (const entry of fs.readdirSync(base, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        for (const [name, file] of [[entry.name, 'test.jsonl'], [entry.name + '/system', 'system/test.jsonl']]) {
          const full = path.join(base, entry.name, file);
          if (jsonlExists(full)) suites.push({name, file: full, group: 'sealed'});
        }
      } else if (entry.name.endsWith('.jsonl')) {
        const shard = /^(.*)\.part-(\d{3,})\.jsonl$/.exec(entry.name);
        if (shard && Number(shard[2]) !== 0) continue;
        const name = shard ? shard[1] : entry.name.slice(0, -'.jsonl'.length);
        suites.push({name, file: path.join(base, name + '.jsonl'), group: 'core'});
      }
    }
    for (const suite of suites) {
      const historical = HISTORICAL_SUITES[suite.name];
      suite.historical = Boolean(historical);
      suite.historicalCite = historical ? cite(root, ...historical) : null;
    }
    return suites;
  }
  const suiteByName = name => {
    const suite = discoverSuites().find(entry => entry.name === name);
    assert(suite, 'Unknown suite ' + name);
    return suite;
  };

  const loadRows = cachedFile(file => {
    const rows = readJsonl(file);
    const items = rows.map((row, index) => {
      const form = targetForm(row);
      const message = messageOf(row);
      return {
        index, row, id: String(row.id), form,
        track: label(row.evaluation_track), language: label(row.language), family: label(row.structure_id ?? row.family ?? row.case),
        status: label(row.expected?.status), input_mode: label(row.input_mode), message,
        haystack: (row.id + '\n' + message).toLowerCase(),
      };
    });
    return {rows, items, byId: new Map(items.map(item => [item.id, item])), sha: sha256(stable(rows))};
  });

  /** Every artifact file, with its kind; historical under eval/reports/history. */
  function artifacts() {
    const out = [];
    for (const group of ARTIFACT_DIRS) {
      const walk = dir => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else {
            const stat = fs.statSync(full);
            out.push({path: rel(full), group: group.key, historical: group.historical, size: stat.size, mtime: stat.mtime.toISOString(), format: formatOf(full, stat.size)});
          }
        }
      };
      if (fs.existsSync(path.join(root, group.dir))) walk(path.join(root, group.dir));
    }
    return out;
  }
  const formatCache = new Map();
  function formatOf(file, size) {
    const key = file + ':' + size;
    if (formatCache.has(key)) return formatCache.get(key);
    let format = null;
    if (file.endsWith('.json')) {
      const fd = fs.openSync(file, 'r');
      try {
        const head = Buffer.alloc(Math.min(size, 400));
        fs.readSync(fd, head, 0, head.length, 0);
        format = /"format"\s*:\s*"([^"]+)"/.exec(head.toString('utf8'))?.[1] ?? null;
      } finally {
        fs.closeSync(fd);
      }
    } else if (file.endsWith('.jsonl')) format = file.includes('/predictions') ? 'predictions-jsonl' : 'jsonl';
    formatCache.set(key, format);
    return format;
  }

  const readReport = cachedFile(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const readJson = cachedFile(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const readPredictions = cachedFile(file => new Map(readJsonl(file).map(row => [String(row.id), row.sop ?? row.prediction])));

  /** Evaluator reports (chatsop-evaluation-v1) attached to a suite by fingerprint. */
  function reportsFor(sha) {
    return artifacts().filter(item => item.format === 'chatsop-evaluation-v1').map(item => ({item, report: readReport(path.join(root, item.path))}))
      .filter(({report}) => report?.suite_sha256 === sha)
      .sort((a, b) => b.item.mtime.localeCompare(a.item.mtime))
      .map(({item, report}) => ({file: item.path, historical: item.historical, mtime: item.mtime, report}));
  }

  /** Prediction files declared for a suite by a sidecar manifest or a registry cell. */
  function predictionsFor(suiteFile) {
    const wanted = rel(suiteFile);
    const found = new Map();
    for (const item of artifacts()) {
      if (item.format === 'chatsop-baseline-predictions-v1' || /\.manifest\.json$/.test(item.path)) {
        const manifest = readJson(path.join(root, item.path));
        if (manifest?.suite === wanted && manifest.predictions) found.set(manifest.predictions, {file: manifest.predictions, identity: manifest.predictor_identity ?? null, claim: manifest.claim ?? null, declared_by: item.path});
      }
      if (item.format === 'chatsop-experiment-registry-v1') {
        const registry = readJson(path.join(root, item.path));
        for (const cell of registry?.cells ?? []) if (cell.suite === wanted && cell.predictions && !found.has(cell.predictions)) found.set(cell.predictions, {file: cell.predictions, identity: registry.predictor_identity ?? null, claim: registry.description ?? null, declared_by: item.path});
      }
    }
    return [...found.values()].map(entry => ({...entry, exists: entry.file.endsWith('.jsonl') ? jsonlExists(path.join(root, entry.file)) : fs.existsSync(path.join(root, entry.file))}));
  }

  /** Leakage of the sealed test against train+dev, from the corpus audit report. */
  function leakageFor(name) {
    const file = path.join(root, 'eval/reports/current/corpus-audit', name.split('/')[0] + '.json');
    const report = fs.existsSync(file) ? readJson(file) : null;
    if (!report?.leakage) return null;
    return {report: rel(file), verdict: report.verdict ?? null, test_vs_development: report.leakage.test_vs_development ?? null, test_vs_train: report.leakage.test_vs_train ?? null};
  }

  /** Per-row predictions and outcome, derived once per request from the linked files. */
  function linked(suite) {
    const loaded = loadRows(suite.file);
    const reports = reportsFor(loaded.sha);
    const predictionFiles = predictionsFor(suite.file);
    const latest = reports[0] ? new Map(reports[0].report.records.map(record => [String(record.id), record])) : new Map();
    const predicted = new Set();
    for (const entry of predictionFiles) if (entry.exists) for (const id of readPredictions(path.join(root, entry.file)).keys()) predicted.add(id);
    for (const {report} of reports) for (const record of report.records ?? []) if (typeof record.prediction === 'string') predicted.add(String(record.id));
    return {loaded, reports, predictionFiles, latest, predicted};
  }
  const facetValue = (item, key, link) => (key === 'prediction' ? (link.predicted.has(item.id) ? 'has prediction' : 'no prediction') : key === 'outcome' ? outcomeOf(link.latest.get(item.id)) : item[key]);

  const suiteSummary = suite => {
    const {loaded, reports, predictionFiles} = linked(suite);
    const items = loaded.items;
    return {
      suite: suite.name, file: rel(suite.file), group: suite.group, historical: suite.historical, historicalCite: suite.historicalCite,
      rows: items.length, cases: new Set(loaded.rows.map(row => row.semantic_case_id ?? row.id)).size, suite_sha256: loaded.sha,
      tracks: tally(items.map(item => item.track)), forms: tally(items.map(item => item.form)), languages: tally(items.map(item => item.language)),
      statuses: tally(items.map(item => item.status)),
      predictions: predictionFiles,
      reports: reports.map(({file, historical, mtime, report}) => ({file, historical, mtime, source: report.source, run_label: report.run_label ?? null, evaluation_valid: report.evaluation_valid, model_identity_verified: report.model_identity_verified ?? false, evaluated_rows: report.evaluated_rows, metrics: report.metrics, propositions: report.propositions ?? null, limitations: report.limitations ?? []})),
      leakage: leakageFor(suite.name),
    };
  };

  const facets = name => {
    const suite = suiteByName(name);
    const link = linked(suite);
    return {suite: name, rows: link.loaded.items.length, groups: EVAL_FACETS.map(({key, label: title}) => ({key, label: title, values: tally(link.loaded.items.map(item => facetValue(item, key, link)))}))};
  };

  const caseList = (name, query = {}) => {
    const suite = suiteByName(name);
    const link = linked(suite);
    const filters = Object.fromEntries(EVAL_FACETS.filter(({key}) => query[key]).map(({key}) => [key, String(query[key])]));
    const text = String(query.q ?? '').trim().toLowerCase();
    const matches = link.loaded.items.filter(item => Object.entries(filters).every(([key, value]) => facetValue(item, key, link) === value) && (!text || item.haystack.includes(text)));
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(query.limit ?? 50)) || 50));
    let offset = query.page !== undefined ? Math.max(0, (Math.trunc(Number(query.page)) || 1) - 1) * limit : Math.max(0, Math.trunc(Number(query.offset ?? 0)) || 0);
    if (query.around) {
      const found = matches.findIndex(item => item.id === query.around);
      if (found >= 0) offset = Math.floor(found / limit) * limit;
    }
    if (offset >= matches.length && matches.length) offset = Math.floor((matches.length - 1) / limit) * limit;
    return {
      suite: name, total: matches.length, offset, limit, page: Math.floor(offset / limit) + 1, pages: Math.max(1, Math.ceil(matches.length / limit)),
      items: matches.slice(offset, offset + limit).map(item => ({
        id: item.id, language: item.language, track: item.track, form: item.form, status: item.status, family: item.family,
        prediction: link.predicted.has(item.id), outcome: outcomeOf(link.latest.get(item.id)),
        request: item.message.replace(/\s+/g, ' ').trim().slice(0, 240),
      })),
    };
  };

  /** What eval/run.mjs does with this row, step by step, with live citations. */
  const pipeline = (row, form) => {
    const R = 'eval/run.mjs';
    const steps = [
      ['Admit the gold', 'Parse the gold target and check it only uses model wires (formalization) or ends in a checked result operation (system).', [R, 'const targetProgram = parse(target)']],
      ['Build the world', row.setup_sop?.trim() ? 'Publish setup_sop as reviewed knowledge into a fresh repository (a temporary directory per row).' : 'Empty setup_sop: an empty repository.', [R, "publishKnowledge(repo, 'world'"]],
      ['Run the gold', 'Execute the gold in its own session; record its packet and execution signature.', [R, 'record.reference_signature = executionSignature(']],
      ['Check the reference', 'Compare the gold packet with the stored expected status/answers/outputs/effects; a mismatch is a reference failure.', [R, 'checkReference(row, gold']],
      ['Ask the predictor', 'The predictor receives only {id, prompt}; the prompt is built from the message only' + (form === 'legacy' ? ' (legacy rows also carried a CONTEXT block).' : '.'), [R, 'const predicted = await predictor(']],
      ['Parse the prediction', 'syntax_valid; canonical_match compares canonical forms with basis removed; propositions are paired by identity.', [R, 'record.canonical_match = ']],
      ['Execute the prediction', 'Admit and run the prediction on the same world in a separate session.', [R, 'const actual = await predExecutor.runtime.run(']],
      ['Compare executions', 'execution_equivalent is true when both execution signatures are identical.', [R, 'record.execution_equivalent = ']],
    ];
    return steps.map(([step, what, [file, anchor]]) => ({step, what, cite: cite(root, file, anchor)}));
  };

  const caseDetail = (name, id) => {
    const suite = suiteByName(name);
    const link = linked(suite);
    const item = link.loaded.byId.get(String(id));
    assert(item, 'Unknown case ' + id);
    const {row, form} = item;
    const target = targetOf(row);
    const predictions = [];
    for (const entry of link.predictionFiles) {
      if (!entry.exists) continue;
      const sop = readPredictions(path.join(root, entry.file)).get(item.id);
      if (typeof sop === 'string') predictions.push({source: entry.file, identity: entry.identity, claim: entry.claim, sop, diff: lineDiff(target, sop)});
    }
    const records = link.reports.map(({file, historical, report}) => ({file, historical, source: report.source, run_label: report.run_label ?? null, record: slimRecord(report.records.find(record => String(record.id) === item.id))})).filter(entry => entry.record);
    for (const entry of records) if (typeof entry.record.prediction === 'string' && !predictions.some(p => p.sop === entry.record.prediction)) predictions.push({source: entry.file, identity: entry.run_label ?? entry.source, claim: 'prediction text recorded in the evaluator report', sop: entry.record.prediction, diff: lineDiff(target, entry.record.prediction)});
    return {
      id: item.id, suite: name, file: rel(suite.file), historical: suite.historical,
      semantic_case_id: row.semantic_case_id ?? null, negative_of: row.negative_of ?? null, split: row.split ?? 'test',
      language: item.language, track: item.track, form, 
      family: item.family, input_mode: row.input_mode ?? null, source: row.source ? {id: row.source.id, kind: row.source.kind, uri: row.source.uri, license: row.source.license} : null,
      review: row.generation_trace?.review_status ?? row.review_status ?? null, flags: row.quality_flags ?? null,
      message: item.message, modelInput: modelInputOf(row, form),
      target, setup: row.setup_sop ?? null, ontology: row.ontology_sop ?? null, verification_context: row.verification_context ?? row.context ?? null, expected: row.expected ?? null,
      pipeline: pipeline(row, form), predictions, records, raw: row,
    };
  };

  /** Runs the real evaluator on one row: the stored prediction when given, else the gold (a labelled gold-copy sanity check). */
  const executeCase = async ({suite: name, id, prediction = null} = {}) => {
    const suite = suiteByName(name);
    const item = loadRows(suite.file).byId.get(String(id));
    assert(item, 'Unknown case ' + id);
    const detail = caseDetail(name, id);
    const chosen = prediction ? detail.predictions.find(entry => entry.source === prediction) : null;
    assert(!prediction || chosen, 'Unknown prediction source for this case');
    const {evaluate} = await import('../eval/run.mjs');
    const report = await evaluate([item.row], {predictor: () => (chosen ? chosen.sop : targetOf(item.row)), source: 'predictions'});
    return {
      suite: name, id: item.id, predictor: chosen ? {source: chosen.source, identity: chosen.identity} : {source: 'gold target', identity: 'gold-copy sanity check (not a model)'},
      evaluation_valid: report.evaluation_valid, record: slimRecord(report.records[0]), metrics: report.metrics,
    };
  };

  /** One artifact: metadata plus a bounded, parsed or textual preview. */
  const artifactDetail = file => {
    const item = artifacts().find(entry => entry.path === file);
    assert(item, 'Unknown artifact ' + file);
    const full = path.join(root, item.path);
    const out = {...item};
    if (item.format === 'chatsop-evaluation-v1') {
      const {records, ...rest} = readReport(full);
      const suite = discoverSuites().find(entry => loadRows(entry.file).sha === rest.suite_sha256);
      return {...out, kind: 'evaluation report', suite: suite?.name ?? null, summary: rest, records: records.length, outcomes: tally(records.map(outcomeOf))};
    }
    if (item.size > 2_000_000) return {...out, kind: 'large file', preview: null, note: 'Larger than 2 MB; open it from the repository.'};
    const raw = fs.readFileSync(full, 'utf8');
    if (item.path.endsWith('.json')) {
      try {
        return {...out, kind: 'json', json: JSON.parse(raw)};
      } catch { /* fall through to text */ }
    }
    if (item.path.endsWith('.jsonl')) {
      const lines = raw.split('\n').filter(Boolean);
      return {...out, kind: 'jsonl', lines: lines.length, preview: lines.slice(0, 50).map(line => {
        try { return JSON.parse(line); } catch { return line; }
      })};
    }
    return {...out, kind: 'text', text: raw.slice(0, 100_000), truncated: raw.length > 100_000};
  };

  const artifactList = (group, query = {}) => {
    const text = String(query.q ?? '').trim().toLowerCase();
    const items = artifacts().filter(item => (!group || item.group === group) && (!text || item.path.toLowerCase().includes(text)));
    const limit = 50;
    const page = Math.max(1, Math.trunc(Number(query.page ?? 1)) || 1);
    const pages = Math.max(1, Math.ceil(items.length / limit));
    const offset = (Math.min(page, pages) - 1) * limit;
    return {group, total: items.length, offset, limit, page: Math.min(page, pages), pages, items: items.slice(offset, offset + limit)};
  };

  const suitesIndex = () => ({
    suites: discoverSuites().map(suite => {
      const loaded = loadRows(suite.file);
      return {suite: suite.name, group: suite.group, historical: suite.historical, rows: loaded.items.length, forms: tally(loaded.items.map(item => item.form))};
    }),
    artifacts: ARTIFACT_DIRS.map(group => ({group: group.key, label: group.label, historical: group.historical, count: artifacts().filter(item => item.group === group.key).length})),
  });

  /** Handles `/eval/api/*`; returns true when the request was handled. Pages are served by server/web.mjs. */
  const handle = async (req, res, pathname, query, send) => {
    if (!pathname.startsWith('/eval/api/')) return false;
    const route = pathname.slice('/eval/api/'.length);
    if (req.method === 'GET') {
      if (route === 'suites') return send(200, suitesIndex()), true;
      if (route === 'suite') return send(200, suiteSummary(suiteByName(query.suite))), true;
      if (route === 'facets') return send(200, facets(query.suite)), true;
      if (route === 'cases') return send(200, caseList(query.suite, query)), true;
      if (route === 'case') return send(200, caseDetail(query.suite, query.id)), true;
      if (route === 'artifacts') return send(200, artifactList(query.group, query)), true;
      if (route === 'artifact') return send(200, artifactDetail(query.path)), true;
    }
    if (req.method === 'POST' && route === 'execute') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      assert(raw.length < 100_000, 'Request too large');
      return send(200, await executeCase(raw ? JSON.parse(raw) : {})), true;
    }
    send(404, {error: {message: 'Unknown eval endpoint', code: 'not_found'}});
    return true;
  };

  return {handle, discoverSuites, suitesIndex, suiteSummary, facets, caseList, caseDetail, executeCase, artifactList, artifactDetail};
}
