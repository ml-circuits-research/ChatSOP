/** Evaluation browser page (`/eval`): the three-pane layout of the corpus
 * audit (server/pages/three-pane.mjs) over `/eval/api/*`.
 *
 *   left    — sealed suites and core suites (each with its categories: track,
 *             target form, language, family, expected status, input mode,
 *             prediction, latest outcome) and the evaluation artifacts
 *             (predictions, registry, current reports, historical reports);
 *   middle  — the paginated rows of a suite, or the files of an artifact group;
 *   right   — a suite summary (fingerprint, reports and their metrics,
 *             template leakage), one row (message, gold, evaluator steps,
 *             expected result, predictions with diff and outcome) or one file.
 *
 * `/eval/guide` (evalGuidePage) explains how evaluation works, with every claim
 * cited to file:line.
 */
import {escapeHtml, layout} from './layout.mjs';
import {SOP_CODE_STYLE, sopCodeScript} from './sop-code.mjs';
import {THREE_PANE_STYLE, threePaneBody, paneKitScript} from './three-pane.mjs';

const style = `
.detail section.model{border:2px solid var(--accent)}
.detail section.model .message{font-size:16px;font-weight:500}
.detail section.verify{background:var(--soft);border:1px dashed var(--line)}
.detail section.verify h3{text-transform:uppercase;letter-spacing:.03em;font-size:.9rem;color:var(--muted)}
ol.steps{margin:4px 0 0;padding-left:20px;font-size:14px}
ol.steps li{margin:0 0 4px}
ol.steps .cite,.cite{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--muted)}
.diff{margin:0;font-size:13px;line-height:1.5;white-space:pre;max-height:none}
.diff .add{background:color-mix(in srgb,var(--ok) 20%,transparent);display:block}
.diff .del{background:color-mix(in srgb,var(--bad) 20%,transparent);display:block}
.outcomes{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.outcomes span{font-size:13px;padding:2px 8px;border-radius:8px;border:1px solid var(--line)}
.outcomes .yes{border-color:var(--ok);color:var(--ok)}.outcomes .no{border-color:var(--bad);color:var(--bad)}
.guidebar{padding:6px 10px;border-bottom:1px solid var(--line);font-size:13px;background:var(--panel)}
`;

/** Browser code. Runs as `(${client})()`, so it must not close over module scope. */
function client() {
  const {$, esc, json, kv, inline, codeBlock} = window.ChatSopPane;
  const PAGE_SIZE = 50;
  const FILTER_KEYS = ['track', 'form', 'language', 'family', 'status', 'input_mode', 'prediction', 'outcome'];
  const openGroups = new Set(['track', 'form', 'language', 'outcome']);
  const state = {index: null, facets: {}, mode: null, suite: null, group: null, filters: {}, q: '', page: 1, list: null, selected: null, detail: null};
  const percent = value => (value === null || value === undefined ? '—' : (100 * value).toFixed(1) + '%');
  const frac = f => (f && typeof f === 'object' && 'numerator' in f ? f.numerator + '/' + f.denominator + ' (' + percent(f.value) + ')' : esc(JSON.stringify(f)));

  async function api(route, params, body) {
    const url = '/eval/api/' + route + (params ? '?' + new URLSearchParams(params) : '');
    const options = body === undefined ? {credentials: 'same-origin'} : {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
    const response = await fetch(url, options);
    if (response.status === 401) {
      location.href = '/login?next=' + encodeURIComponent('/eval' + location.hash);
      throw new Error('signed out');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message ?? 'HTTP ' + response.status);
    return data;
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.mode === 'suite' && state.suite) params.set('suite', state.suite);
    if (state.mode === 'artifacts' && state.group) params.set('artifacts', state.group);
    for (const key of FILTER_KEYS) if (state.filters[key]) params.set(key, state.filters[key]);
    if (state.q) params.set('q', state.q);
    if (state.page > 1) params.set('page', String(state.page));
    if (state.selected) params.set('id', state.selected);
    const hash = '#' + params.toString();
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }
  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    state.suite = params.get('suite');
    state.group = params.get('artifacts');
    state.mode = state.suite ? 'suite' : state.group ? 'artifacts' : null;
    state.filters = {};
    for (const key of FILTER_KEYS) if (params.get(key)) state.filters[key] = params.get(key);
    state.q = params.get('q') ?? '';
    state.page = Math.max(1, Number(params.get('page')) || 1);
    state.selected = params.get('id');
  }

  // ---- Left pane ----
  function suiteNode(entry) {
    const active = state.mode === 'suite' && entry.suite === state.suite;
    const facets = state.facets[entry.suite];
    let inner = '';
    if (active && facets) {
      const chips = Object.entries(state.filters).map(([key, value]) => '<span class="chip" data-unfilter="' + esc(key) + '">' + esc(key) + ': ' + esc(value) + ' ✕</span>').join('');
      inner = (chips ? '<div class="chips">' + chips + '<span class="chip" data-unfilter="*">clear all</span></div>' : '') + facets.groups.map(group => {
        const values = Object.entries(group.values);
        if (!values.length) return '';
        const open = openGroups.has(group.key) || state.filters[group.key] ? ' open' : '';
        return '<details class="group" data-group="' + esc(group.key) + '"' + open + '><summary>' + esc(group.label) + '<span class="count">' + values.length + '</span></summary><ul class="values">' +
          values.map(([value, count]) => '<li><button type="button"' + (state.filters[group.key] === value ? ' class="on"' : '') + ' data-facet="' + esc(group.key) + '" data-value="' + esc(value) + '" title="' + esc(value) + '"><span class="name">' + esc(value) + '</span><span class="count">' + count.toLocaleString() + '</span></button></li>').join('') + '</ul></details>';
      }).join('');
    } else if (active) inner = '<div class="muted" style="margin-left:30px">loading…</div>';
    const flag = entry.historical ? ' <span class="badge historical">historical</span>' : '';
    return '<details class="corpus' + (active ? ' active' : '') + '" data-suite="' + esc(entry.suite) + '"' + (active ? ' open' : '') + '><summary><span>' + esc(entry.suite) + flag + '</span><span class="count">' + entry.rows.toLocaleString() + '</span></summary>' + inner + '</details>';
  }
  function renderTree() {
    $('search').value = state.q;
    const index = state.index;
    if (!index) return;
    const sealed = index.suites.filter(entry => entry.group === 'sealed');
    const core = index.suites.filter(entry => entry.group === 'core');
    const groups = index.artifacts.map(group => '<details class="corpus' + (state.mode === 'artifacts' && state.group === group.group ? ' active' : '') + '" data-artifacts="' + esc(group.group) + '"><summary><span>' + esc(group.label) + (group.historical ? ' <span class="badge historical">historical</span>' : '') + '</span><span class="count">' + group.count + '</span></summary></details>').join('');
    $('tree').innerHTML = '<p style="margin:0 4px 8px;font-size:13px"><a href="/eval/guide">How evaluation works →</a></p>' +
      '<h4 class="section">Sealed suites (eval/suites/&lt;name&gt;/test.jsonl)</h4>' + sealed.map(suiteNode).join('') +
      (core.length ? '<h4 class="section">Other suites</h4>' + core.map(suiteNode).join('') : '') +
      '<h4 class="section">Predictions and reports</h4>' + groups;
  }

  async function openSuite(name) {
    if (state.mode !== 'suite' || state.suite !== name) Object.assign(state, {mode: 'suite', suite: name, group: null, filters: {}, page: 1, selected: null, detail: null});
    renderTree();
    await loadFacets();
    await loadList();
    if (!state.selected) showSuite();
  }
  async function openArtifacts(group) {
    Object.assign(state, {mode: 'artifacts', group, suite: null, filters: {}, page: 1, selected: null, detail: null});
    renderTree();
    await loadList();
    renderEmpty();
  }
  async function loadFacets() {
    state.facets[state.suite] = await api('facets', {suite: state.suite});
    renderTree();
  }

  // ---- Middle pane ----
  async function loadList({around = null, select = null} = {}) {
    if (!state.mode) return;
    $('cases').innerHTML = '<li class="empty">loading…</li>';
    if (state.mode === 'suite') {
      const params = {suite: state.suite, limit: PAGE_SIZE, page: state.page, ...state.filters};
      if (state.q) params.q = state.q;
      if (around) params.around = around;
      state.list = await api('cases', params);
    } else {
      const params = {group: state.group, page: state.page};
      if (state.q) params.q = state.q;
      state.list = await api('artifacts', params);
    }
    state.page = state.list.page;
    renderList();
    if (select === 'first' && state.list.items.length) return pick(itemId(state.list.items[0]));
    if (select === 'last' && state.list.items.length) return pick(itemId(state.list.items.at(-1)));
    writeHash();
  }
  const itemId = item => item.id ?? item.path;
  const outcomeClass = outcome => (outcome === 'execution-equivalent' ? 'good' : /^failed|not equivalent/.test(outcome) ? 'fail' : '');
  function renderList() {
    const list = state.list;
    if (!list) {
      $('listhead').innerHTML = '<span class="total">Pick a suite or an artifact group</span>';
      $('cases').innerHTML = '<li class="empty">Open a suite in the left column.</li>';
      return;
    }
    $('listhead').innerHTML = window.ChatSopPane.listHead(list, state.mode === 'suite' ? 'rows' : 'files');
    $('cases').innerHTML = list.items.map(item => {
      const id = itemId(item);
      const badges = state.mode === 'suite'
        ? '<span class="badge">' + esc(item.language) + '</span><span class="badge">' + esc(item.track) + '</span><span class="badge' + (item.form === 'legacy' ? ' historical' : '') + '">' + esc(item.form) + '</span>' + (item.prediction ? '<span class="badge ' + outcomeClass(item.outcome) + '">' + esc(item.outcome) + '</span>' : '')
        : '<span class="badge">' + esc(item.format ?? 'file') + '</span>' + (item.historical ? '<span class="badge historical">historical</span>' : '');
      const text = state.mode === 'suite' ? item.request || '(no message)' : (item.size / 1024).toFixed(1) + ' KB · ' + item.mtime.slice(0, 16).replace('T', ' ');
      return '<li data-id="' + esc(id) + '"' + (id === state.selected ? ' class="sel"' : '') + '><div class="cid"><b>' + esc(state.mode === 'suite' ? id : id.split('/').slice(-2).join('/')) + '</b>' + badges + '</div><div class="msg" title="' + esc(text) + '">' + esc(text) + '</div></li>';
    }).join('') || '<li class="empty">Nothing matches.</li>';
  }
  async function gotoPage(page, select) {
    if (!state.list) return;
    state.page = Math.min(Math.max(1, page), state.list.pages);
    await loadList({select});
    $('cases').scrollTop = 0;
  }
  async function move(delta) {
    const items = state.list?.items ?? [];
    if (!items.length) return;
    const index = items.findIndex(item => itemId(item) === state.selected);
    const next = index < 0 ? 0 : index + delta;
    if (next < 0) return state.list.page > 1 && gotoPage(state.list.page - 1, 'last');
    if (next >= items.length) return state.list.page < state.list.pages && gotoPage(state.list.page + 1, 'first');
    await pick(itemId(items[next]));
  }

  // ---- Right pane ----
  function renderEmpty() {
    $('detail').innerHTML = '<div class="empty">Select a suite, a row or a file.<br><small>Keys: <kbd>↑</kbd>/<kbd>↓</kbd> or <kbd>k</kbd>/<kbd>j</kbd> move, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> change page, <kbd>/</kbd> search.</small><p><a href="/eval/guide">How evaluation works</a></p></div>';
  }
  async function pick(id) {
    state.selected = id;
    writeHash();
    window.ChatSopPane.markSelected(id);
    window.ChatSopPane.closeDrawer();
    $('detail').innerHTML = '<p class="muted">loading ' + esc(id) + '…</p>';
    try {
      if (state.mode === 'suite') {
        const detail = await api('case', {suite: state.suite, id});
        if (state.selected !== id) return;
        state.detail = detail;
        renderCase();
      } else {
        const detail = await api('artifact', {path: id});
        if (state.selected !== id) return;
        renderArtifact(detail);
      }
      $('detail').scrollTop = 0;
    } catch (error) {
      $('detail').innerHTML = '<p class="bad">' + esc(error.message) + '</p>';
    }
  }

  const metricsTable = metrics => '<div class="tablewrap"><table class="small"><tbody>' + Object.entries(metrics ?? {}).filter(([, value]) => value && typeof value === 'object' && 'numerator' in value).map(([key, value]) => '<tr><td><code>' + esc(key) + '</code></td><td>' + frac(value) + '</td></tr>').join('') + '</tbody></table></div>';

  async function showSuite() {
    $('detail').innerHTML = '<p class="muted">loading suite…</p>';
    const s = await api('suite', {suite: state.suite});
    if (state.selected) return;
    const leak = s.leakage?.test_vs_development;
    const leakage = leak
      ? '<section><h3>Template-level leakage (sealed test vs train+dev)</h3>' + kv([['exact input', percent(leak.exact_input_overlap)], ['masked template', percent(leak.template_overlap)], ['near duplicate', percent(leak.near_duplicate_overlap)], ['target skeleton', percent(leak.target_skeleton_overlap)], ['entity heads', percent(leak.entity_overlap)], ['corpus audit', '<code>' + esc(s.leakage.report) + '</code> · verdict <b>' + esc(s.leakage.verdict?.status ?? '—') + '</b>']]) + '<p class="muted" style="margin:6px 0 0;font-size:13px">A score on this suite must be read together with these overlaps: high template overlap measures template recall, not language understanding.</p></section>'
      : '<section><h3>Template-level leakage</h3><p class="muted">No corpus-audit leakage measurement for this suite.</p></section>';
    const reports = s.reports.length ? s.reports.map(r => '<details class="fold"' + (s.reports.length === 1 ? ' open' : '') + '><summary>' + esc(r.file) + (r.historical ? ' <span class="badge historical">historical</span>' : '') + '</summary>' + kv([['source', esc(r.source)], ['run label', esc(r.run_label)], ['evaluation valid', esc(r.evaluation_valid)], ['model identity verified', esc(r.model_identity_verified)], ['evaluated rows', esc(r.evaluated_rows)]]) + metricsTable(r.metrics) + (r.limitations.length ? '<ul class="muted" style="font-size:13px">' + r.limitations.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '') + '</details>').join('') : '<p class="muted">No evaluator report matches this suite\'s fingerprint.</p>';
    const predictions = s.predictions.length ? '<ul>' + s.predictions.map(p => '<li><code>' + esc(p.file) + '</code> ' + (p.exists ? '' : '<span class="badge fail">missing</span> ') + '<span class="muted">' + esc(p.identity ?? '') + ' · declared by ' + esc(p.declared_by) + '</span>' + (p.claim ? '<div class="muted" style="font-size:13px">' + esc(p.claim) + '</div>' : '') + '</li>').join('') + '</ul>' : '<p class="muted">No prediction file is declared for this suite. No real model has produced predictions yet.</p>';
    $('detail').innerHTML = '<h2>' + esc(s.suite) + (s.historical ? ' <span class="badge historical">historical</span>' : '') + '</h2>' +
      (s.historicalCite ? '<p class="notice">Recorded as historical by <span class="cite">' + esc(s.historicalCite.file + ':' + (s.historicalCite.line ?? '?')) + '</span>; its numbers are never a current run.</p>' : '') +
      '<section>' + kv([['file', '<code>' + esc(s.file) + '</code>'], ['rows / cases', s.rows + ' / ' + s.cases], ['suite_sha256', '<code>' + esc(s.suite_sha256) + '</code>'], ['tracks', inline(s.tracks)], ['target form', inline(s.forms)], ['languages', inline(s.languages)], ['expected statuses', inline(s.statuses)]]) + '</section>' +
      '<section><h3>Predictions</h3>' + predictions + '</section><section><h3>Evaluator reports (matched by suite_sha256)</h3>' + reports + '</section>' + leakage;
  }

  function renderCase() {
    const c = state.detail;
    const header = '<h2>' + esc(c.id) + '</h2><div class="rowhead" style="margin-bottom:10px"><span class="badge">' + esc(c.suite) + '</span><span class="badge">' + esc(c.language) + '</span><span class="badge">' + esc(c.track) + '</span><span class="badge' + (c.form === 'legacy' ? ' historical' : '') + '">target form: ' + esc(c.form) + '</span>' + (c.historical ? '<span class="badge historical">historical suite</span>' : '') + '</div>' +
      (c.form === 'legacy' ? '<p class="notice">Legacy target form (identifiers, <code>premise</code> or a CONTEXT shortlist). There is one model language with no profiles, and the corpora were regenerated in it on 2026-09-28, so a row in this form is stale; report it. The evaluator executes it as recorded.</p>' : '');
    const model = '<section class="model"><h3>1 · Model input: the message only</h3><div class="message">' + esc(c.message) + '</div>' +
      (c.modelInput !== c.message ? '<details class="fold"><summary>Exact legacy prompt (carried CONTEXT)</summary><pre style="white-space:pre-wrap">' + esc(c.modelInput) + '</pre></details>' : '<p class="muted" style="margin:0;font-size:13px">The small model has no context: this text is its whole input (server/llm.mjs <code>barePrompt</code>).</p>') +
      '<h4>2 · Gold target (what the model should write)</h4>' + (c.target ? codeBlock(c.target, 'target') : '<p class="muted">(none)</p>') + '</section>';
    const steps = '<section><h3>3 · What the evaluator executes and compares</h3><ol class="steps">' + c.pipeline.map(s => '<li><b>' + esc(s.step) + '.</b> ' + esc(s.what) + ' <span class="cite">' + esc(s.cite.file + ':' + (s.cite.line ?? 'moved')) + '</span></li>').join('') + '</ol><p style="margin:8px 0 0"><a href="/eval/guide">How evaluation works</a></p></section>';
    const verify = '<section class="verify"><h3>4 · Expected result and its world (evaluation only, never model input)</h3><h4>Expected</h4><pre>' + esc(json(c.expected)) + '</pre>' +
      '<h4>World (setup_sop)</h4>' + (c.setup ? codeBlock(c.setup, 'setup') : '<p class="muted">(empty world)</p>') +
      (c.ontology ? '<details class="fold"><summary>Vocabulary (ontology_sop)</summary>' + codeBlock(c.ontology, 'ontology') + '</details>' : '') +
      ((c.verification_context ?? c.context) ? '<details class="fold"><summary>Verification context (scaffolding, never model input)</summary><pre>' + esc(json(c.verification_context ?? c.context)) + '</pre></details>' : '') + '</section>';
    const yes = (flag, text) => '<span class="' + (flag ? 'yes' : 'no') + '">' + (flag ? '✓ ' : '✗ ') + esc(text) + '</span>';
    const outcome = r => '<div class="outcomes">' + yes(r.reference_valid, 'reference valid') + yes(r.syntax_valid, 'parsed') + yes(r.canonical_match, 'canonical match') + yes(r.runtime_valid, 'executed') + yes(r.execution_equivalent, 'execution-equivalent') + '</div>' +
      kv([['outcome', '<b>' + esc(r.outcome) + '</b>'], ['error', r.error ? '<span class="bad">' + esc(r.error.stage + ': ' + r.error.message) + '</span>' : ''], ['gold status', esc(r.gold_status)], ['predicted status', esc(r.predicted_status)], ['gold answers', r.reference_answers ? '<code>' + esc(JSON.stringify(r.reference_answers)) + '</code>' : ''], ['predicted answers', r.observed_answers ? '<code>' + esc(JSON.stringify(r.observed_answers)) + '</code>' : ''], ['propositions', r.propositions ? inline(r.propositions) : '']]);
    const diff = d => '<pre class="diff">' + d.map(line => '<span class="' + (line.op === '+' ? 'add' : line.op === '-' ? 'del' : '') + '">' + esc(line.op + ' ' + line.line) + '</span>').join('') + '</pre>';
    const predictions = '<section><h3>5 · Predictions, diff and outcome</h3>' + (c.predictions.length
      ? c.predictions.map(p => '<details class="fold" open><summary>' + esc(p.source) + '</summary><p class="muted" style="font-size:13px;margin:4px 0">' + esc(p.identity ?? '') + (p.claim ? ' — ' + esc(p.claim) : '') + '</p>' + codeBlock(p.sop, 'pred:' + p.source) + '<h4>Diff against the gold (− gold, + prediction)</h4>' + diff(p.diff) + '</details>').join('')
      : '<p class="muted">No prediction exists for this row. No real model has produced predictions yet.</p>') +
      (c.records.length ? c.records.map(r => '<h4>Recorded outcome in <code>' + esc(r.file) + '</code>' + (r.historical ? ' <span class="badge historical">historical</span>' : '') + '</h4>' + outcome(r.record)).join('') : '') +
      '<h4>Run the evaluator now</h4><p style="margin:0 0 6px"><button type="button" class="primary" data-run="">Evaluate the gold as prediction</button> ' + c.predictions.map(p => '<button type="button" data-run="' + esc(p.source) + '">Evaluate ' + esc(p.source.split('/').pop()) + '</button>').join(' ') + '</p><p class="muted" style="font-size:13px;margin:0">Runs <code>evaluate</code> from eval/run.mjs on this single row. Gold as prediction is an evaluator sanity check, never a model score.</p><div id="runout"></div></section>';
    const raw = '<section><details class="fold"><summary>Raw row JSON</summary><pre>' + esc(json(c.raw)) + '</pre></details></section>';
    const fields = '<section>' + kv([['semantic case', esc(c.semantic_case_id)], ['negative of', esc(c.negative_of)], ['family', esc(c.family)], ['input mode', esc(c.input_mode)], ['source', c.source ? inline(c.source) : ''], ['review', esc(c.review)], ['flags', c.flags ? inline(c.flags) : '']]) + '</section>';
    $('detail').innerHTML = header + model + steps + verify + predictions + fields + raw;
    runOutcome = outcome;
  }
  let runOutcome = null;

  async function run(source, button) {
    button.disabled = true;
    $('runout').innerHTML = '<p class="muted">evaluating…</p>';
    try {
      const data = await api('execute', null, {suite: state.suite, id: state.selected, prediction: source || null});
      $('runout').innerHTML = '<p class="muted" style="margin:8px 0 0">predictor: ' + esc(data.predictor.source) + ' · ' + esc(data.predictor.identity ?? '') + ' · evaluation valid: ' + esc(data.evaluation_valid) + '</p>' + runOutcome(data.record);
    } catch (error) {
      $('runout').innerHTML = '<p class="bad">' + esc(error.message) + '</p>';
    } finally {
      button.disabled = false;
    }
  }

  function renderArtifact(a) {
    const head = '<h2>' + esc(a.path) + '</h2><div class="rowhead" style="margin-bottom:10px"><span class="badge">' + esc(a.format ?? a.kind) + '</span>' + (a.historical ? '<span class="badge historical">historical — never a current run</span>' : '<span class="badge">current observation</span>') + '</div>' +
      '<section>' + kv([['size', (a.size / 1024).toFixed(1) + ' KB'], ['modified', esc(a.mtime)], ['kind', esc(a.kind)]]) + '</section>';
    let body = '';
    if (a.kind === 'evaluation report') {
      const s = a.summary;
      body = '<section><h3>Evaluator report</h3>' + kv([['suite', a.suite ? '<a href="#suite=' + encodeURIComponent(a.suite) + '" data-open-suite="' + esc(a.suite) + '">' + esc(a.suite) + '</a>' : '<span class="muted">no suite with this fingerprint</span>'], ['source', esc(s.source)], ['run label', esc(s.run_label)], ['evaluation valid', esc(s.evaluation_valid)], ['model identity verified', esc(s.model_identity_verified)], ['records', esc(a.records)], ['outcomes', inline(a.outcomes)]]) + metricsTable(s.metrics) + '</section><section><details class="fold"><summary>Full summary JSON</summary><pre>' + esc(json(s)) + '</pre></details></section>';
    } else if (a.kind === 'json') body = '<section><pre>' + esc(json(a.json)) + '</pre></section>';
    else if (a.kind === 'jsonl') body = '<section><h3>' + a.lines + ' lines (first 50)</h3>' + a.preview.map(row => row && typeof row === 'object' && typeof (row.sop ?? row.prediction) === 'string' ? '<div class="rowhead"><code>' + esc(row.id) + '</code></div>' + codeBlock(row.sop ?? row.prediction, 'x') : '<pre>' + esc(json(row)) + '</pre>').join('') + '</section>';
    else if (a.kind === 'text') body = '<section><pre style="max-height:none">' + esc(a.text) + '</pre>' + (a.truncated ? '<p class="muted">truncated</p>' : '') + '</section>';
    else body = '<section><p class="muted">' + esc(a.note ?? '') + '</p></section>';
    $('detail').innerHTML = head + body;
  }

  // ---- Events ----
  function bind() {
    $('tree').addEventListener('click', event => {
      const facet = event.target.closest('[data-facet]');
      if (facet) {
        const {facet: key, value} = facet.dataset;
        if (state.filters[key] === value) delete state.filters[key];
        else state.filters[key] = value;
        state.page = 1;
        renderTree();
        loadList();
        return;
      }
      const chip = event.target.closest('[data-unfilter]');
      if (chip) {
        if (chip.dataset.unfilter === '*') state.filters = {};
        else delete state.filters[chip.dataset.unfilter];
        state.page = 1;
        renderTree();
        loadList();
        return;
      }
      const summary = event.target.closest('.corpus > summary');
      if (!summary) return;
      const node = summary.parentElement;
      event.preventDefault();
      if (node.dataset.suite && (state.mode !== 'suite' || node.dataset.suite !== state.suite)) openSuite(node.dataset.suite);
      else if (node.dataset.suite) {
        state.selected = null;
        writeHash();
        showSuite();
      } else if (node.dataset.artifacts) openArtifacts(node.dataset.artifacts);
    });
    $('tree').addEventListener('toggle', event => {
      const key = event.target.dataset?.group;
      if (!key) return;
      if (event.target.open) openGroups.add(key);
      else openGroups.delete(key);
    }, true);
    let timer = null;
    $('search').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.q = $('search').value.trim();
        state.page = 1;
        loadList();
      }, 250);
    });
    $('listhead').addEventListener('click', event => {
      const button = event.target.closest('[data-page]');
      if (button) gotoPage(state.list.page + (button.dataset.page === 'next' ? 1 : -1));
    });
    $('listhead').addEventListener('change', event => {
      if (event.target.id === 'pagejump') gotoPage(Number(event.target.value) || 1);
    });
    $('cases').addEventListener('click', event => {
      const li = event.target.closest('li[data-id]');
      if (li) pick(li.dataset.id);
    });
    $('detail').addEventListener('click', event => {
      const target = event.target;
      if (target.dataset.run !== undefined) run(target.dataset.run, target);
      else if (target.dataset.openSuite) {
        event.preventDefault();
        openSuite(target.dataset.openSuite);
      } else if (target.dataset.copy) {
        const c = state.detail;
        const name = target.dataset.copy;
        const text = name === 'target' ? c?.target : name === 'setup' ? c?.setup : name === 'ontology' ? c?.ontology : c?.predictions?.find(p => 'pred:' + p.source === name)?.sop ?? target.closest('.code')?.querySelector('pre')?.textContent;
        window.ChatSopPane.copyText(text, target);
      }
    });
    window.ChatSopPane.bindDrawer();
    window.ChatSopPane.bindKeys({
      ArrowDown: () => move(1), j: () => move(1), ArrowUp: () => move(-1), k: () => move(-1),
      PageDown: () => state.list && gotoPage(state.list.page + 1, 'first'),
      PageUp: () => state.list && gotoPage(state.list.page - 1, 'first'),
      '/': () => $('search').focus(),
    });
    window.ChatSopPane.bindDivider('chatsop.eval.listWidth');
    // A pasted or edited link (#suite=…&id=…) reloads the view; our own writes use replaceState and fire no event.
    window.addEventListener('hashchange', () => location.reload());
  }

  async function start() {
    bind();
    readHash();
    renderEmpty();
    try {
      state.index = await api('suites');
    } catch (error) {
      $('tree').innerHTML = '<p class="bad">' + esc(error.message) + '</p>';
      return;
    }
    renderTree();
    renderList();
    if (state.mode === 'suite' && state.index.suites.some(entry => entry.suite === state.suite)) {
      const selected = state.selected;
      await loadFacets();
      await loadList({around: selected});
      if (selected) await pick(selected);
      else showSuite();
    } else if (state.mode === 'artifacts') {
      const selected = state.selected;
      await loadList();
      if (selected) await pick(selected);
    }
  }
  start();
}

const body = threePaneBody({search: 'Search id, message or file', treeLabel: 'Suites and artifacts', listLabel: 'Rows', drawer: 'Rows', treeLoading: 'loading suites…'});

/** The `/eval` page; the server only serves it to a signed-in administrator. */
export const evalPage = ({signedIn = true} = {}) => layout({title: 'Evaluation · ChatSOP', active: 'eval', signedIn, body, style: THREE_PANE_STYLE + style + SOP_CODE_STYLE, script: `${sopCodeScript}\n${paneKitScript}\n(${client})();`});

const guideStyle = `
.guide{max-width:1000px}
.guide section{margin:0 0 18px}
.guide .claim{margin:0 0 10px;line-height:1.6}
.guide .cites{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--muted)}
.guide .moved{color:var(--bad)}
.guide table{border-collapse:collapse;width:100%;font-size:14px}
.guide td,.guide th{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
.guide nav.toc a{margin-right:12px;font-size:14px}
`;
const citeHtml = c => `<span class="${c.found ? '' : 'moved'}">${escapeHtml(c.file)}:${c.found ? c.line : 'moved (anchor not found)'}</span>`;

/** `/eval/guide`: every claim with its file:line citations, resolved when the page is served. */
export function evalGuidePage({guide, signedIn = true}) {
  const toc = guide.sections.map(s => `<a href="#${s.id}">${escapeHtml(s.title)}</a>`).join('') + '<a href="#metric-table">Metric table</a>';
  const sections = guide.sections.map(s => `<section class="card" id="${s.id}"><h2>${escapeHtml(s.title)}</h2>${s.claims.map(c => `<p class="claim">${escapeHtml(c.text)}<span class="cites">${c.cites.map(citeHtml).join(' · ')}</span></p>`).join('')}</section>`).join('');
  const metrics = `<section class="card" id="metric-table"><h2>Metric table</h2><p class="muted">Each value in a report is a fraction {numerator, denominator, value}; a zero denominator gives value null and never counts as success.</p><div class="tablewrap"><table><thead><tr><th>metric</th><th>numerator / denominator</th><th>defined at</th></tr></thead><tbody>${guide.metrics.map(m => `<tr><td><code>${escapeHtml(m.key)}</code></td><td>${escapeHtml(m.definition)}</td><td class="cites">${citeHtml(m.cite)}</td></tr>`).join('')}</tbody></table></div></section>`;
  const body = `<main class="wrap guide"><h1>How evaluation works</h1><p class="muted">Derived from the code and from DS008/DS010/DS016. Every citation is resolved against the files when this page is served. <a href="/eval">Back to the evaluation browser</a></p><nav class="toc card">${toc}</nav>${sections}${metrics}</main>`;
  return layout({title: 'How evaluation works · ChatSOP', active: 'eval', signedIn, body, style: guideStyle});
}
