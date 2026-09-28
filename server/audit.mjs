/** Visual corpus audit, mounted inside the main server.
 *
 * The main server (server/http.mjs) serves documentation, the admin page, the
 * chat API and this audit under `/audit` + `/audit/api/*` on ONE port. The audit
 * loads the corpora straight from the JSONL splits, lets a signed-in human read
 * a case (the exact training prompt and target the model sees, then the
 * verification-only world, vocabulary and stored expectation it never sees,
 * lineage, machine-audit findings), re-execute its gold against the real
 * runtime and record a verdict. Verdicts are appended to an evidence ledger;
 * nothing else is written.
 *
 * Each corpus is indexed once, on first use: cases are grouped by
 * `semantic_case_id`, sorted once, and their category counts (facets) are
 * computed once, so a 90k-row corpus pages and filters server-side without
 * re-sorting. Only the verdict counts follow the (small) ledger.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assert} from '../lib/util.mjs';
import {jsonlExists, readJsonlShardedSync} from '../lib/jsonl-shards.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {Repository} from '../memory/repository.mjs';
import {publishKnowledge} from '../sop/ingest.mjs';
import {Runtime} from '../sop/runtime.mjs';
import {parse} from '../sop/parser.mjs';
import {auditPage} from './pages/audit.mjs';
import {barePrompt} from './llm.mjs';
import {withInlineWorld, verificationContext} from '../lib/row-world.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
// Corpus splits may be stored as shards (lib/jsonl-shards.mjs); the logical base path reads either form.
const readJsonl = file => readJsonlShardedSync(file);
const label = value => (value === undefined || value === null || value === '' ? 'none' : typeof value === 'object' ? JSON.stringify(value) : String(value));

const targetOf = row => row.sop_target ?? row.target ?? null;
const themeOf = row => label(row.domain ?? row.theme ?? row.topical_domain ?? row.lineage?.theme ?? row.generation_trace?.theme ?? 'general');
const shapeOf = row => label(row.structure_id ?? row.form ?? row.surface_design ?? 'general');
const reviewOf = row => label(row.target_review_status ?? row.review_status ?? row.generation_trace?.review_status ?? 'not_reviewed');
/** The user's whole message: the model input carried in `question` (DS021). */
export const messageOf = row => row.question ?? '';
/** The exact training prompt the small model receives, built by the same call as tools/research/prepare-experiment.mjs. */
export const promptOf = row => barePrompt(messageOf(row));
const fingerprintOf = rows => sha256(rows.map(row => `${row.id}\t${targetOf(row) ?? ''}`).sort().join('\n'));

/** Browsable category groups, in tree order. `verdict` follows the ledger; the others are fixed at load. */
export const FACETS = [
  {key: 'split', label: 'Split'},
  {key: 'family', label: 'Family / structure'},
  {key: 'language', label: 'Language'},
  {key: 'question_type', label: 'Question type'},
  {key: 'input_mode', label: 'Input mode'},
  {key: 'review', label: 'Review status'},
  {key: 'theme', label: 'Theme'},
  {key: 'status', label: 'Expected status'},
  {key: 'verdict', label: 'Verdict'},
];
const VERDICTS = ['unreviewed', 'approve', 'needs_fix', 'reject'];
/** Query aliases kept from the first audit API. */
const ALIASES = {shape: 'family', reviewed: 'verdict'};

const tally = values => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
};

/** Reads a file once and re-reads it only when its size or mtime changes. */
function cachedFile(parse) {
  const cache = new Map();
  return file => {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      cache.delete(file);
      return null;
    }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const hit = cache.get(file);
    if (hit?.stamp === stamp) return hit.value;
    const value = parse(fs.readFileSync(file, 'utf8'));
    cache.set(file, {stamp, value});
    return value;
  };
}

/** JSON-safe copy of a runtime packet (BigInt as string, cycles cut). */
function plain(value) {
  const seen = new WeakSet();
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Map) return Object.fromEntries(item);
    if (item instanceof Set) return [...item];
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[circular]';
      seen.add(item);
    }
    return item;
  }));
}

/** One case: every row that shares a `semantic_case_id`, plus the fields the list and filters need. */
function indexCase(id, entries) {
  const first = entries[0].row;
  const splits = [...new Set(entries.map(entry => entry.split))].sort();
  const languages = [...new Set(entries.map(entry => label(entry.row.language)))].sort();
  return {
    id,
    entries,
    splits,
    languages,
    family: shapeOf(first),
    theme: themeOf(first),
    input_mode: label(first.input_mode),
    question_type: label(first.question_type),
    review: reviewOf(first),
    status: label(first.expected?.status),
    request: String(first.question ?? '').replace(/\s+/g, ' ').trim(),
    haystack: (id + '\n' + entries.map(entry => `${entry.row.id}\n${messageOf(entry.row)}`).join('\n')).toLowerCase(),
  };
}

/** The value(s) of one facet for a case; `verdict` needs the current ledger. */
const facetValues = (item, key, verdictOf) => {
  if (key === 'split') return item.splits;
  if (key === 'language') return item.languages;
  if (key === 'verdict') return [verdictOf(item.id)];
  return [item[key]];
};

export function createAuditRouter({
  root = projectRoot,
  ledgerDir = path.join(root, 'eval/reports/current/audit'),
  reportDir = path.join(root, 'eval/reports/current/corpus-audit'),
} = {}) {
  const corpora = new Map();
  const add = (name, split, file) => {
    if (!jsonlExists(file)) return;
    if (!corpora.has(name)) corpora.set(name, {name, files: []});
    corpora.get(name).files.push({split, file});
  };
  for (const entry of fs.readdirSync(path.join(root, 'datasets'), {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    add(entry.name, 'train', path.join(root, 'datasets', entry.name, 'train.jsonl'));
    add(entry.name, 'dev', path.join(root, 'datasets', entry.name, 'dev.jsonl'));
  }
  for (const entry of fs.readdirSync(path.join(root, 'eval/suites'), {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    add(entry.name, 'test', path.join(root, 'eval/suites', entry.name, 'test.jsonl'));
    add(entry.name, 'test', path.join(root, 'eval/suites', entry.name, 'system/test.jsonl'));
  }

  const cache = new Map();
  const loadCorpus = name => {
    assert(corpora.has(name), 'Unknown corpus ' + name);
    if (cache.has(name)) return cache.get(name);
    const entries = corpora.get(name).files.flatMap(({split, file}) => readJsonl(file).map(row => ({split, file: path.relative(root, file), row})));
    const grouped = new Map();
    for (const entry of entries) {
      const id = String(entry.row.semantic_case_id ?? entry.row.id);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(entry);
    }
    const cases = [...grouped].map(([id, group]) => indexCase(id, group)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const byCase = new Map(cases.map(item => [item.id, item]));
    const facets = {};
    for (const {key} of FACETS) if (key !== 'verdict') facets[key] = tally(cases.flatMap(item => facetValues(item, key)));
    const rows = entries.map(entry => entry.row);
    const loaded = {
      name,
      entries,
      cases,
      byCase,
      facets,
      summary: {
        rows: rows.length,
        cases: cases.length,
        splits: tally(entries.map(entry => entry.split)),
        languages: tally(rows.map(row => label(row.language))),
        shapes: tally(rows.map(shapeOf)),
        statuses: tally(rows.map(row => label(row.expected?.status))),
        themes: tally(rows.map(themeOf)),
        fingerprint: fingerprintOf(rows),
      },
    };
    cache.set(name, loaded);
    return loaded;
  };

  const readLedger = cachedFile(text => {
    const latest = new Map();
    const history = new Map();
    for (const line of text.split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      latest.set(record.caseId, record);
      if (!history.has(record.caseId)) history.set(record.caseId, []);
      history.get(record.caseId).push(record);
    }
    return {latest, history};
  });
  const ledger = name => readLedger(path.join(ledgerDir, name + '.jsonl')) ?? {latest: new Map(), history: new Map()};

  const readReport = cachedFile(text => JSON.parse(text));
  const readRowFindings = cachedFile(text => {
    const byRow = new Map();
    for (const line of text.split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      byRow.set(String(record.id), record.findings ?? {});
    }
    return byRow;
  });

  /** Machine-audit findings for the rows of one case: the full `--rows-out` file when present, else the report's examples. */
  const auditFindings = (name, rowIds) => {
    const reportFile = path.join(reportDir, name + '.json');
    const rowsFile = path.join(reportDir, name + '.rows.jsonl');
    const report = readReport(reportFile);
    const perRow = readRowFindings(rowsFile);
    const checks = new Map((report?.checks ?? []).map(check => [check.id, check]));
    const findings = [];
    const wanted = new Set(rowIds.map(String));
    const push = (rowId, split, checkId, messages) => {
      const check = checks.get(checkId);
      findings.push({row: rowId, split: split ?? null, check: checkId, severity: check?.severity ?? 'info', description: check?.description ?? null, findings: [].concat(messages ?? [])});
    };
    if (perRow) {
      for (const rowId of wanted) for (const [checkId, messages] of Object.entries(perRow.get(rowId) ?? {})) push(rowId, null, checkId, messages);
    } else if (report) {
      for (const check of report.checks ?? []) for (const example of check.examples ?? []) if (wanted.has(String(example.id))) push(String(example.id), example.split, check.id, example.findings);
    }
    const rank = {error: 0, warning: 1, info: 2};
    findings.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || a.check.localeCompare(b.check));
    return {
      report: report ? path.relative(root, reportFile) : null,
      rowsFile: perRow ? path.relative(root, rowsFile) : null,
      coverage: perRow ? 'all_rows' : report ? 'report_examples' : 'none',
      verdict: report?.verdict ?? null,
      findings,
      faithfulnessErrors: findings.filter(item => item.severity === 'error' && /^(faithfulness|label)\./.test(item.check)).length,
    };
  };

  const summary = name => {
    const loaded = loadCorpus(name);
    const {latest} = ledger(name);
    const records = [...latest.values()];
    return {
      corpus: name,
      ...loaded.summary,
      reviewed: latest.size,
      approved: records.filter(record => record.verdict === 'approve').length,
      rejected: records.filter(record => record.verdict === 'reject').length,
      needsFix: records.filter(record => record.verdict === 'needs_fix').length,
      files: corpora.get(name).files.map(({split, file}) => ({split, file: path.relative(root, file)})),
    };
  };

  /** Category counts for the tree, counted per case (a case in two splits counts in both). */
  const facets = name => {
    const loaded = loadCorpus(name);
    const {latest} = ledger(name);
    const verdict = Object.fromEntries(VERDICTS.map(value => [value, 0]));
    for (const item of loaded.cases) verdict[latest.get(item.id)?.verdict ?? 'unreviewed']++;
    return {
      corpus: name,
      rows: loaded.summary.rows,
      cases: loaded.cases.length,
      groups: FACETS.map(({key, label: title}) => ({key, label: title, values: key === 'verdict' ? verdict : loaded.facets[key]})),
    };
  };

  const caseList = (name, query = {}) => {
    const loaded = loadCorpus(name);
    const {latest} = ledger(name);
    const verdictOf = id => latest.get(id)?.verdict ?? 'unreviewed';
    const filters = {};
    for (const [key, value] of Object.entries(query)) {
      const facet = ALIASES[key] ?? key;
      if (value && FACETS.some(entry => entry.key === facet)) filters[facet] = String(value);
    }
    const text = String(query.q ?? '').trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(query.limit ?? 50)) || 50));
    const matches = [];
    for (const item of loaded.cases) {
      let keep = true;
      for (const [key, value] of Object.entries(filters)) {
        if (!facetValues(item, key, verdictOf).includes(value)) {
          keep = false;
          break;
        }
      }
      if (keep && text && !item.haystack.includes(text)) keep = false;
      if (keep) matches.push(item);
    }
    let offset = Math.max(0, Math.trunc(Number(query.offset ?? 0)) || 0);
    if (query.page !== undefined) offset = Math.max(0, (Math.trunc(Number(query.page)) || 1) - 1) * limit;
    // `around=<case id>` returns the page that contains that case, so a reloaded
    // link lands on the selected case.
    let index = null;
    if (query.around) {
      const found = matches.findIndex(item => item.id === query.around);
      if (found >= 0) {
        index = found;
        offset = Math.floor(found / limit) * limit;
      }
    }
    if (offset >= matches.length && matches.length > 0) offset = Math.floor((matches.length - 1) / limit) * limit;
    return {
      corpus: name,
      total: matches.length,
      offset,
      limit,
      page: Math.floor(offset / limit) + 1,
      pages: Math.max(1, Math.ceil(matches.length / limit)),
      index,
      items: matches.slice(offset, offset + limit).map(item => ({
        id: item.id,
        surfaces: item.entries.length,
        language: item.languages[0],
        languages: item.languages,
        splits: item.splits,
        shape: item.family,
        family: item.family,
        theme: item.theme,
        input_mode: item.input_mode,
        review: item.review,
        status: item.status === 'none' ? null : item.status,
        reviewed: verdictOf(item.id),
        verdict: verdictOf(item.id),
        request: item.request.length > 240 ? item.request.slice(0, 239) + '…' : item.request,
      })),
    };
  };

  const caseDetail = (name, id) => {
    const item = loadCorpus(name).byCase.get(String(id));
    assert(item, 'Unknown case ' + id);
    const {entries} = item;
    const first = entries[0].row;
    const {latest, history} = ledger(name);
    const flags = first.quality_flags ?? {};
    return {
      id: item.id,
      corpus: name,
      splits: item.splits,
      languages: item.languages,
      theme: item.theme,
      shape: item.family,
      family: item.family,
      input_mode: first.input_mode ?? null,
      evaluation_track: first.evaluation_track ?? null,
      semantic_status: first.semantic_status ?? null,
      review: item.review,
      target_status: first.target_status ?? first.target_review_status ?? null,
      flags,
      source: first.source ?? null,
      lineage: first.lineage ?? first.generation_trace?.lineage ?? null,
      generation: first.generation_trace ?? null,
      groups: {split: first.split_group_id ?? null, surface: first.surface_group_id ?? null, negative_of: first.negative_of ?? null},
      target: targetOf(first),
      // A row may reference its shared verification world; the browser shows it assembled (evaluation-only).
      setup: withInlineWorld(first, {root}).setup_sop || null,
      ontology: withInlineWorld(first, {root}).ontology_sop ?? null,
      // Evaluation-only: the clock and the entities and predicates of the verification world, never part of the prompt.
      verification_context: verificationContext(first),
      scaffold: {entities: verificationContext(first)?.entities ?? [], predicates: verificationContext(first)?.predicates ?? []},
      expected: first.expected ?? null,
      oracle: {
        independent: flags.independent_oracle ?? (flags.graph_oracle ? 'graph_oracle' : null),
        expected_from: flags.expected_from ?? null,
        executed: first.executed ?? first.execution ?? null,
      },
      verdict: latest.get(item.id) ?? null,
      history: history.get(item.id) ?? [],
      audit: auditFindings(name, entries.map(entry => entry.row.id)),
      rows: entries.map(entry => ({id: entry.row.id, split: entry.split, file: entry.file, language: entry.row.language, question: entry.row.question, message: messageOf(entry.row), prompt: promptOf(entry.row), question_type: entry.row.question_type ?? null, target: targetOf(entry.row), expected: entry.row.expected ?? null})),
      raw: entries.map(entry => entry.row),
    };
  };

  const executeCase = async (name, id) => {
    const item = loadCorpus(name).byCase.get(String(id));
    assert(item, 'Unknown case ' + id);
    const rows = item.entries.map(entry => withInlineWorld(entry.row, {root})).filter(row => targetOf(row));
    assert(rows.length > 0, 'This case has no target yet');
    const lexiconSource = rows[0].ontology_sop ?? null;
    const lexicon = lexiconSource ? new Lexicon(lexiconSource) : Lexicon.load(new URL('../config/ontology.sop', import.meta.url));
    const work = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'chatsop-audit-'));
    try {
      const repo = new Repository(work, {memory: {engine: 'sqlite', power: 8}});
      // Surfaces of one case usually share the same setup; publish each distinct setup once.
      const setup = [...new Set(rows.map(row => row.setup_sop ?? '').filter(Boolean))].join('\n\n');
      const late = [...new Set(rows.map(row => row.late_setup_sop ?? '').filter(Boolean))].join('\n\n');
      // Same knowledge times as the generator and the evaluator: early knowledge 2023-06-01, late knowledge 2025-06-01.
      if (setup.trim()) publishKnowledge(repo, 'audit', setup, {schema: lexicon.predicates, reviewed: true, knownAt: Date.parse('2023-06-01')});
      if (late.trim()) publishKnowledge(repo, 'audit', late, {schema: lexicon.predicates, reviewed: true, knownAt: Date.parse('2025-06-01')});
      if (!setup.trim() && !late.trim()) repo.init('audit');
      const session = repo.session('audit', 'reviewer', 'case');
      const observed = [];
      for (const row of rows) {
        const stored = row.expected ?? {};
        try {
          const runtime = new Runtime({repo, session, schema: lexicon.predicates, lexicon, now: Date.parse(verificationContext(row)?.now ?? '2026-09-26T12:00:00Z')});
          // Gold targets are model-language output (DS021); legacy-format rows fail here, which is correct.
          const out = await runtime.run(targetOf(row), {origin: 'model', inputText: row.question, language: row.language});
          const packet = out.result?.packet ?? out.result ?? {};
          // Same convention as eval/run.mjs: an answer is a tuple of the selected
          // fields, not the raw binding, so a reviewer sees what the evaluator sees.
          const answers = (packet.answers ?? []).map(answer => {
            const fields = packet.query?.select ?? Object.keys(answer.binding ?? {});
            return fields.map(field => answer.binding?.[field]);
          });
          const statusMatch = packet.status === stored.status;
          const answersMatch = stored.answers === undefined || JSON.stringify(answers) === JSON.stringify(stored.answers);
          observed.push({id: row.id, status: packet.status ?? null, expectedStatus: stored.status ?? null, answers, expectedAnswers: stored.answers ?? null, matches: statusMatch && answersMatch, statusMatch, answersMatch, depth: packet.depth ?? null, complete: packet.complete ?? null, text: String(out.result?.text ?? '').slice(0, 4000), packet: plain(packet)});
        } catch (error) {
          observed.push({id: row.id, status: 'error', expectedStatus: stored.status ?? null, answers: [], expectedAnswers: stored.answers ?? null, matches: false, statusMatch: false, answersMatch: false, error: error.message});
        }
      }
      return {caseId: item.id, corpus: name, rows: observed, allMatch: observed.every(entry => entry.matches)};
    } finally {
      fs.rmSync(work, {recursive: true, force: true});
    }
  };

  const recordVerdict = payload => {
    const {corpus, caseId, verdict, note} = payload ?? {};
    assert(corpora.has(corpus), 'Unknown corpus');
    assert(['approve', 'reject', 'needs_fix'].includes(verdict), 'verdict must be approve, reject or needs_fix');
    const detail = caseDetail(corpus, caseId);
    fs.mkdirSync(ledgerDir, {recursive: true});
    const record = {
      ts: new Date().toISOString(),
      corpus,
      caseId: detail.id,
      verdict,
      note: String(note ?? '').slice(0, 2000),
      rowFingerprint: sha256(JSON.stringify(detail.rows.map(row => ({id: row.id, split: row.split, language: row.language, question: row.question, expected: row.expected})))),
      targetSha256: detail.target ? sha256(detail.target) : null,
    };
    fs.appendFileSync(path.join(ledgerDir, corpus + '.jsonl'), JSON.stringify(record) + '\n');
    return record;
  };

  /** Handles `/audit` and `/audit/api/*`; returns true when the request was handled. */
  const handle = async (req, res, pathname, query, send) => {
    if (req.method === 'GET' && pathname === '/audit') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(auditPage({signedIn: true}));
      return true;
    }
    if (!pathname.startsWith('/audit/api/')) return false;
    const route = pathname.slice('/audit/api/'.length);
    if (req.method === 'GET') {
      if (route === 'corpora') return send(200, [...corpora.keys()].sort().map(summary)), true;
      if (route === 'facets') return send(200, facets(query.corpus)), true;
      if (route === 'cases') return send(200, caseList(query.corpus, query)), true;
      if (route === 'case') return send(200, caseDetail(query.corpus, query.id)), true;
    }
    if (req.method === 'POST' && (route === 'execute' || route === 'verdict')) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      assert(raw.length < 1_000_000, 'Request too large');
      const payload = raw ? JSON.parse(raw) : {};
      if (route === 'execute') return send(200, await executeCase(payload.corpus, payload.id)), true;
      return send(200, recordVerdict(payload)), true;
    }
    send(404, {error: {message: 'Unknown audit endpoint', code: 'not_found'}});
    return true;
  };

  return {handle, corpora, summary, facets, caseList, caseDetail, executeCase, recordVerdict, ledgerDir};
}
