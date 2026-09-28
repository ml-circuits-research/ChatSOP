/** Corpus audit page (`/audit`): a three-pane browser over the audit API.
 *
 *   left    — corpora as a collapsible tree of categories (split, family,
 *             language, input mode, review status, theme, expected status,
 *             verdict) with counts, plus free-text search;
 *   middle  — the server-paginated case list (50 per page), keyboard
 *             navigable (up/down, j/k), selection kept in the URL hash;
 *   right   — the selected case in full, in two separated groups: what the
 *             model sees (the user message only, which is the exact training
 *             prompt from server/llm.mjs `barePrompt`, and the target SOP it
 *             must output) and the verification-only world, vocabulary, entity
 *             and predicate index, expected result and execution it never
 *             sees; then fields, machine-audit findings, verdicts and raw JSON.
 *
 * SOP code is rendered by the shared server/pages/sop-code.mjs renderer, which
 * links wire types and fields to their documentation pages. The layout, the
 * skeleton and the generic browser helpers come from server/pages/three-pane.mjs,
 * shared with the evaluation browser (`/eval`).
 *
 * The page only reads `/audit/api/*` and posts executions and verdicts; access
 * control stays with the server. The client code below is plain browser
 * JavaScript, serialised with `Function.prototype.toString`.
 */
import {layout} from './layout.mjs';
import {SOP_CODE_STYLE, sopCodeScript} from './sop-code.mjs';
import {THREE_PANE_STYLE, threePaneBody, paneKitScript} from './three-pane.mjs';

/** Audit-only styles; the three-pane layout comes from THREE_PANE_STYLE. */
const style = `
.badge.v-approve{background:var(--ok);border-color:var(--ok);color:var(--accent-text)}
.badge.v-reject{background:var(--bad);border-color:var(--bad);color:var(--accent-text)}
.badge.v-needs_fix{background:#c77d12;border-color:#c77d12;color:#fff}
.alert{border:2px solid var(--bad);background:color-mix(in srgb,var(--bad) 12%,var(--panel))}
.alert h3{color:var(--bad)}
.verdicts{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.verdicts textarea{width:100%;min-height:3.2em;margin-top:6px}
.verdicts button[data-verdict=approve]{border-color:var(--ok)}
.verdicts button[data-verdict=reject]{border-color:var(--bad)}
.verdicts button[data-verdict=needs_fix]{border-color:#c77d12}
.detail section.model{border:2px solid var(--accent)}
.detail section.model .message{font-size:16px;font-weight:500}
pre.prompt{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;margin:4px 0 8px}
.detail section.verify{background:var(--soft);border:1px dashed var(--line);color:var(--muted)}
.detail section.verify h3{text-transform:uppercase;letter-spacing:.03em;font-size:.9rem}
.detail section.verify .why{margin:0 0 6px;font-size:13px}
.detail section.verify pre,.detail section.verify .code{opacity:.9}
`;

/** Browser code. Runs as `(${client})()`, so it must not close over module scope. */
function client() {
  const PAGE_SIZE = 50;
  const VERDICT_LABEL = {unreviewed: 'unreviewed', approve: 'ok', needs_fix: 'needs fix', reject: 'reject'};
  const FILTER_KEYS = ['split', 'family', 'language', 'input_mode', 'review', 'theme', 'status', 'verdict'];
  const openGroups = new Set(['split', 'family', 'language', 'verdict']);

  const state = {corpora: [], facets: {}, corpus: null, filters: {}, q: '', page: 1, list: null, selected: null, detail: null};
  const {$, esc, json, kv, inline, codeBlock} = window.ChatSopPane;

  async function api(route, params, body) {
    const url = '/audit/api/' + route + (params ? '?' + new URLSearchParams(params) : '');
    const options = body === undefined ? {credentials: 'same-origin'} : {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
    const response = await fetch(url, options);
    if (response.status === 401) {
      location.href = '/login?next=' + encodeURIComponent('/audit' + location.hash);
      throw new Error('signed out');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message ?? 'HTTP ' + response.status);
    return data;
  }

  // ---- URL hash: corpus, filters, search, page and selected case ----

  function writeHash() {
    const params = new URLSearchParams();
    if (state.corpus) params.set('corpus', state.corpus);
    for (const key of FILTER_KEYS) if (state.filters[key]) params.set(key, state.filters[key]);
    if (state.q) params.set('q', state.q);
    if (state.page > 1) params.set('page', String(state.page));
    if (state.selected) params.set('id', state.selected);
    const hash = '#' + params.toString();
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    state.corpus = params.get('corpus');
    state.filters = {};
    for (const key of FILTER_KEYS) if (params.get(key)) state.filters[key] = params.get(key);
    state.q = params.get('q') ?? '';
    state.page = Math.max(1, Number(params.get('page')) || 1);
    state.selected = params.get('id');
  }

  // ---- Left pane: corpus tree ----

  function renderTree() {
    $('search').value = state.q;
    const html = state.corpora.map(corpus => {
      const active = corpus.corpus === state.corpus;
      const facets = state.facets[corpus.corpus];
      let inner = '';
      if (active && facets) {
        const chips = Object.entries(state.filters).map(([key, value]) => '<span class="chip" data-unfilter="' + esc(key) + '" title="remove filter">' + esc(key) + ': ' + esc(labelOf(key, value)) + ' ✕</span>').join('');
        inner = (chips ? '<div class="chips">' + chips + '<span class="chip" data-unfilter="*">clear all</span></div>' : '') +
          facets.groups.map(group => {
            const values = Object.entries(group.values);
            if (!values.length) return '';
            const open = openGroups.has(group.key) || state.filters[group.key] ? ' open' : '';
            const items = values.map(([value, count]) => {
              const on = state.filters[group.key] === value ? ' class="on"' : '';
              return '<li><button type="button"' + on + ' data-facet="' + esc(group.key) + '" data-value="' + esc(value) + '" title="' + esc(value) + '"><span class="name">' + esc(labelOf(group.key, value)) + '</span><span class="count">' + count.toLocaleString() + '</span></button></li>';
            }).join('');
            return '<details class="group" data-group="' + esc(group.key) + '"' + open + '><summary>' + esc(group.label) + '<span class="count">' + values.length + '</span></summary><ul class="values">' + items + '</ul></details>';
          }).join('');
      } else if (active) {
        inner = '<div class="muted" style="margin-left:30px">loading…</div>';
      }
      const reviewed = corpus.reviewed ? ' · ' + corpus.reviewed + ' reviewed' : '';
      return '<details class="corpus' + (active ? ' active' : '') + '" data-corpus="' + esc(corpus.corpus) + '"' + (active ? ' open' : '') + '>' +
        '<summary title="' + esc(corpus.rows + ' rows, ' + corpus.cases + ' cases' + reviewed) + '"><span>' + esc(corpus.corpus) + '</span><span class="count">' + corpus.cases.toLocaleString() + '</span></summary>' + inner + '</details>';
    }).join('');
    $('tree').innerHTML = html || '<p class="muted">No corpora found.</p>';
  }

  const labelOf = (key, value) => (key === 'verdict' ? VERDICT_LABEL[value] ?? value : value);

  async function openCorpus(name) {
    if (state.corpus !== name) {
      state.corpus = name;
      state.filters = {};
      state.page = 1;
      state.selected = null;
      state.detail = null;
    }
    renderTree();
    await loadFacets();
    await loadList();
  }

  async function loadFacets() {
    if (!state.corpus) return;
    state.facets[state.corpus] = await api('facets', {corpus: state.corpus});
    renderTree();
  }

  // ---- Middle pane: paginated case list ----

  async function loadList({around = null, select = null} = {}) {
    if (!state.corpus) return;
    const params = {corpus: state.corpus, limit: PAGE_SIZE, page: state.page, ...state.filters};
    if (state.q) params.q = state.q;
    if (around) params.around = around;
    $('cases').innerHTML = '<li class="empty">loading…</li>';
    state.list = await api('cases', params);
    state.page = state.list.page;
    renderList();
    if (select === 'first' && state.list.items.length) return pick(state.list.items[0].id);
    if (select === 'last' && state.list.items.length) return pick(state.list.items.at(-1).id);
    writeHash();
  }

  function badges(item) {
    return item.languages.map(lang => '<span class="badge">' + esc(lang) + '</span>').join('') +
      item.splits.map(split => '<span class="badge">' + esc(split) + '</span>').join('') +
      (item.verdict !== 'unreviewed' ? '<span class="badge v-' + esc(item.verdict) + '">' + esc(VERDICT_LABEL[item.verdict]) + '</span>' : '');
  }

  function renderList() {
    const list = state.list;
    if (!list) {
      $('listhead').innerHTML = '<span class="total">Pick a corpus</span>';
      $('cases').innerHTML = '<li class="empty">Open a corpus in the left column.</li>';
      return;
    }
    $('listhead').innerHTML = window.ChatSopPane.listHead(list, 'cases');
    $('cases').innerHTML = list.items.map(item =>
      '<li data-id="' + esc(item.id) + '"' + (item.id === state.selected ? ' class="sel" aria-selected="true"' : '') + '>' +
      '<div class="cid"><b>' + esc(item.id) + '</b>' + badges(item) + '</div>' +
      '<div class="msg" title="' + esc(item.request) + '">' + esc(item.request || '(no message)') + '</div></li>').join('') ||
      '<li class="empty">No case matches these filters.</li>';
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
    const index = items.findIndex(item => item.id === state.selected);
    const next = index < 0 ? 0 : index + delta;
    if (next < 0) {
      if (state.list.page > 1) await gotoPage(state.list.page - 1, 'last');
      return;
    }
    if (next >= items.length) {
      if (state.list.page < state.list.pages) await gotoPage(state.list.page + 1, 'first');
      return;
    }
    await pick(items[next].id);
  }

  // ---- Right pane: case detail ----

  async function pick(id) {
    state.selected = id;
    writeHash();
    window.ChatSopPane.markSelected(id);
    window.ChatSopPane.closeDrawer();
    $('detail').innerHTML = '<p class="muted">loading ' + esc(id) + '…</p>';
    try {
      const detail = await api('case', {corpus: state.corpus, id});
      if (state.selected !== id) return;
      state.detail = detail;
      renderDetail();
      $('detail').scrollTop = 0;
    } catch (error) {
      $('detail').innerHTML = '<p class="bad">' + esc(error.message) + '</p>';
    }
  }

  function renderDetail() {
    const c = state.detail;
    if (!c) {
      $('detail').innerHTML = '<div class="empty">Select a case in the list.<br><small>Keys: <kbd>↑</kbd>/<kbd>↓</kbd> or <kbd>k</kbd>/<kbd>j</kbd> move, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> change page, <kbd>/</kbd> search.</small></div>';
      return;
    }
    const flags = Object.entries(c.flags ?? {}).map(([key, value]) => '<span class="badge">' + esc(key) + '=' + esc(typeof value === 'object' ? JSON.stringify(value) : value) + '</span>').join(' ');
    const source = c.source ? inline({id: c.source.id, kind: c.source.kind, uri: c.source.uri, license: c.source.license}) : '';
    const header = '<h2>' + esc(c.id) + '</h2><div class="rowhead" style="margin-bottom:10px">' + c.languages.map(l => '<span class="badge">' + esc(l) + '</span>').join('') + c.splits.map(s => '<span class="badge">' + esc(s) + '</span>').join('') +
      (c.verdict ? '<span class="badge v-' + esc(c.verdict.verdict) + '">' + esc(VERDICT_LABEL[c.verdict.verdict]) + '</span>' : '<span class="badge">unreviewed</span>') + '</div>';

    const audit = c.audit ?? {findings: []};
    const alert = audit.faithfulnessErrors ? '<section class="alert"><h3>Faithfulness errors (' + audit.faithfulnessErrors + ')</h3>' + findingsList(audit.findings.filter(f => f.severity === 'error' && /^(faithfulness|label)\./.test(f.check))) + '</section>' : '';

    const fields = '<section>' + kv([
      ['id', '<code>' + esc(c.id) + '</code>'],
      ['corpus', esc(c.corpus)],
      ['split', esc(c.splits.join(', '))],
      ['family / structure', esc(c.family)],
      ['theme', esc(c.theme)],
      ['language', esc(c.languages.join(', '))],
      ['input_mode', esc(c.input_mode)],
      ['evaluation track', esc(c.evaluation_track)],
      ['semantic status', esc(c.semantic_status)],
      ['review status', esc(c.review)],
      ['target status', esc(c.target_status)],
      ['groups', inline(c.groups)],
      ['source', source],
      ['lineage', c.lineage ? inline(c.lineage) : ''],
      ['generation', c.generation ? inline({method: c.generation.method, template: c.generation.template, model: c.generation.model, review_status: c.generation.review_status}) : ''],
      ['flags', flags],
    ]) + '</section>';

    // ---- Group 1: exactly what the small model receives and must produce: the message, nothing else ----
    const prompts = c.rows.map(row =>
      '<div class="rowhead"><code>' + esc(row.id) + '</code><span class="badge">' + esc(row.split) + '</span><span class="badge">' + esc(row.language) + '</span>' + (row.question_type ? '<span class="badge">' + esc(row.question_type) + '</span>' : '') + '<span>' + esc(row.file) + '</span></div>' +
      '<div class="message">' + esc(row.message) + '</div>' +
      '<details class="fold"' + (c.rows.length === 1 ? ' open' : '') + '><summary>Exact prompt string (the message only)</summary><pre class="prompt">' + esc(row.prompt) + '</pre></details>').join('');
    const context = c.verification_context ?? c.context ?? {};
    const scaffold = c.scaffold ?? {entities: [], predicates: []};
    const entities = scaffold.entities.length ? '<div class="tablewrap"><table class="small"><thead><tr><th>entity</th><th>type</th><th>label</th></tr></thead><tbody>' + scaffold.entities.map(e => '<tr><td><code>' + esc(e.id) + '</code></td><td>' + esc(e.type ?? e.kind) + '</td><td>' + esc(e.label) + '</td></tr>').join('') + '</tbody></table></div>' : '';
    const predicates = scaffold.predicates.length ? '<div class="tablewrap"><table class="small"><thead><tr><th>predicate</th><th>args</th><th>meaning</th></tr></thead><tbody>' + scaffold.predicates.map(p => '<tr><td><code>' + esc(p.id) + '</code></td><td>' + esc((p.args ?? []).join(' ')) + '</td><td>' + esc(p.meaning ?? p.gloss ?? p.description ?? '') + '</td></tr>').join('') + '</tbody></table></div>' : '';
    const worldIndex = entities || predicates ? '<details class="fold" style="margin-top:10px"><summary>Entities and predicates of the verification world (never in the prompt)</summary>' + kv([['clock', esc(context.now)], ['row language', esc(context.language)]]) + entities + predicates + '</details>' : '';
    const targets = '<h4 style="margin:14px 0 4px">What the model must output</h4>' + (c.target ? codeBlock(c.target, 'target') : '<p class="muted">(no target yet)</p>') +
      c.rows.filter(row => row.target && row.target !== c.target).map(row => '<div class="rowhead" style="margin-top:8px">target of <code>' + esc(row.id) + '</code></div>' + codeBlock(row.target, 'row:' + row.id)).join('');
    const model = '<section class="model"><h3>What the model sees: the user message only' + (c.rows.length > 1 ? ' · ' + c.rows.length + ' surfaces' : '') + '</h3>' + prompts + targets + '</section>';

    // ---- Group 2: evaluation-only scaffolding, never part of the prompt ----
    const oracle = Object.entries(c.oracle ?? {}).filter(([, value]) => value !== null && value !== undefined);
    const verify = '<section class="verify"><h3>Verification only: NOT shown to the model</h3>' +
      '<p class="why">These fields let the host execute the target and compare with the expected result, which catches swapped arguments or wrong negation automatically. The small model never receives them.</p>' +
      '<h4>World used to check the target</h4>' + (c.setup ? codeBlock(c.setup, 'setup') : '<p class="muted">(none recorded)</p>') +
      (c.ontology ? '<details class="fold" style="margin-top:10px"><summary>Vocabulary definitions</summary>' + codeBlock(c.ontology, 'ontology') + '</details>' : '') + worldIndex +
      '<h4>Expected result when the target is executed on that world</h4>' + (oracle.length ? kv(oracle.map(([key, value]) => [key, inline(value)])) : '') +
      '<pre>' + esc(json(c.expected)) + '</pre>' +
      c.rows.filter(row => JSON.stringify(row.expected) !== JSON.stringify(c.expected)).map(row => '<div class="rowhead">expected for <code>' + esc(row.id) + '</code></div><pre>' + esc(json(row.expected)) + '</pre>').join('') +
      '<h4>Execute the target on that world</h4><button type="button" class="primary" id="run"' + (c.target ? '' : ' disabled') + '>Execute</button> <span class="muted">re-runs the target through the runtime and compares with the expected result</span><div id="runout"></div></section>';

    const sourceContent = c.source?.content ? '<section><details class="fold"><summary>Source content</summary><div class="message">' + esc(c.source.content) + '</div></details></section>' : '';

    const metrics = '<section><h3>Machine audit</h3>' + auditSummary(audit) + findingsList(audit.findings) + '</section>';

    const historyRows = (c.history ?? []).slice().reverse().map(record => '<tr><td>' + esc(record.ts) + '</td><td><span class="badge v-' + esc(record.verdict) + '">' + esc(VERDICT_LABEL[record.verdict] ?? record.verdict) + '</span></td><td>' + esc(record.note) + '</td></tr>').join('');
    const verdict = '<section><h3>Verdict</h3><div class="verdicts">' +
      '<button type="button" data-verdict="approve">ok</button><button type="button" data-verdict="needs_fix">needs fix</button><button type="button" data-verdict="reject">reject</button>' +
      '<span id="verdictout" class="muted"></span><textarea id="note" placeholder="note (optional, kept in the ledger)" maxlength="2000"></textarea></div>' +
      (historyRows ? '<h4 style="margin:12px 0 4px">History</h4><div class="tablewrap"><table class="small"><thead><tr><th>time</th><th>verdict</th><th>note</th></tr></thead><tbody>' + historyRows + '</tbody></table></div>' : '<p class="muted" style="margin:8px 0 0">No verdict recorded yet.</p>') + '</section>';

    const raw = '<section><details class="fold"><summary>Raw JSON (' + c.raw.length + ' row' + (c.raw.length > 1 ? 's' : '') + ')</summary><pre>' + esc(json(c.raw)) + '</pre></details></section>';

    $('detail').innerHTML = header + alert + fields + model + verify + sourceContent + metrics + verdict + raw;
  }

  function auditSummary(audit) {
    if (audit.coverage === 'none') return '<p class="muted" style="margin:0">No corpus-audit report for this corpus. Run <code>node tools/datasets/audit-corpus.mjs --corpus ' + esc(state.corpus) + '</code>.</p>';
    const coverage = audit.coverage === 'all_rows'
      ? 'per-row findings from <code>' + esc(audit.rowsFile) + '</code>'
      : 'report examples only — <code>' + esc(audit.report) + '</code> lists a few flagged rows per check; write <code>--rows-out eval/reports/current/corpus-audit/' + esc(state.corpus) + '.rows.jsonl</code> for every row';
    const verdict = audit.verdict ? ' · corpus audit verdict: <b>' + esc(typeof audit.verdict === 'object' ? audit.verdict.status ?? JSON.stringify(audit.verdict) : audit.verdict) + '</b>' : '';
    return '<p class="muted" style="margin:0 0 6px">' + coverage + verdict + '</p>' + (audit.findings.length ? '' : '<p class="ok" style="margin:0">No findings for this case.</p>');
  }

  function findingsList(findings) {
    if (!findings.length) return '';
    return '<ul style="margin:0;padding-left:18px">' + findings.map(f => '<li><span class="badge ' + esc(f.severity) + '">' + esc(f.severity) + '</span> <code>' + esc(f.check) + '</code> on <code>' + esc(f.row) + '</code>' +
      (f.description ? '<div class="muted" style="font-size:13px">' + esc(f.description) + '</div>' : '') +
      '<ul>' + f.findings.map(text => '<li>' + esc(text) + '</li>').join('') + '</ul></li>').join('') + '</ul>';
  }

  async function execute() {
    const out = $('runout');
    const button = $('run');
    button.disabled = true;
    out.innerHTML = '<p class="muted">running…</p>';
    try {
      const data = await api('execute', null, {corpus: state.corpus, id: state.selected});
      out.innerHTML = '<p class="match ' + (data.allMatch ? 'ok' : 'bad') + '">' + (data.allMatch ? '✓ matches the stored expectation' : '✗ differs from the stored expectation') + '</p>' +
        data.rows.map(row => '<div style="margin:6px 0 10px">' + kv([
          ['row', '<code>' + esc(row.id) + '</code>'],
          ['status', '<span class="match ' + (row.statusMatch ? 'ok' : 'bad') + '">' + esc(row.status) + '</span>' + (row.statusMatch ? '' : ' (expected ' + esc(row.expectedStatus) + ')')],
          ['answers', '<code>' + esc(JSON.stringify(row.answers)) + '</code>' + (row.answersMatch ? '' : ' <span class="match bad">expected <code>' + esc(JSON.stringify(row.expectedAnswers)) + '</code></span>')],
          ['depth', esc(row.depth)],
          ['complete', esc(row.complete)],
          ['error', row.error ? '<span class="bad">' + esc(row.error) + '</span>' : ''],
          ['rendered', row.text ? '<div class="message" style="margin:0">' + esc(row.text) + '</div>' : ''],
        ]) + (row.packet ? '<details class="fold"><summary>Runtime packet</summary><pre>' + esc(json(row.packet)) + '</pre></details>' : '') + '</div>').join('');
    } catch (error) {
      out.innerHTML = '<p class="bad">' + esc(error.message) + '</p>';
    } finally {
      button.disabled = false;
    }
  }

  async function recordVerdict(verdict) {
    const note = $('note').value;
    $('verdictout').textContent = 'saving…';
    try {
      await api('verdict', null, {corpus: state.corpus, caseId: state.selected, verdict, note});
      const id = state.selected;
      state.detail = await api('case', {corpus: state.corpus, id});
      renderDetail();
      $('verdictout').textContent = 'saved: ' + VERDICT_LABEL[verdict];
      const item = state.list?.items.find(entry => entry.id === id);
      if (item) {
        item.verdict = verdict;
        item.reviewed = verdict;
        renderList();
      }
      loadFacets();
    } catch (error) {
      $('verdictout').textContent = error.message;
    }
  }

  function copy(name, button) {
    const c = state.detail;
    const text = name === 'target' ? c.target : name === 'setup' ? c.setup : name === 'ontology' ? c.ontology : c.rows.find(row => 'row:' + row.id === name)?.target;
    window.ChatSopPane.copyText(text, button);
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
      if (summary) {
        const name = summary.parentElement.dataset.corpus;
        if (name !== state.corpus) {
          event.preventDefault();
          openCorpus(name);
        }
      }
    });
    // Remember which category groups the reviewer opened or closed across re-renders.
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
      if (target.id === 'run') execute();
      else if (target.dataset.verdict) recordVerdict(target.dataset.verdict);
      else if (target.dataset.copy) copy(target.dataset.copy, target);
    });
    window.ChatSopPane.bindDrawer();
    window.ChatSopPane.bindKeys({
      ArrowDown: () => move(1), j: () => move(1),
      ArrowUp: () => move(-1), k: () => move(-1),
      PageDown: () => state.list && gotoPage(state.list.page + 1, 'first'),
      PageUp: () => state.list && gotoPage(state.list.page - 1, 'first'),
      '/': () => $('search').focus(),
    });
    window.ChatSopPane.bindDivider('chatsop.audit.listWidth');
  }

  async function start() {
    bind();
    readHash();
    renderDetail();
    try {
      state.corpora = await api('corpora');
    } catch (error) {
      $('tree').innerHTML = '<p class="bad">' + esc(error.message) + '</p>';
      return;
    }
    if (state.corpus && !state.corpora.some(entry => entry.corpus === state.corpus)) state.corpus = null;
    renderTree();
    renderList();
    if (!state.corpus) return;
    await loadFacets();
    const selected = state.selected;
    await loadList({around: selected});
    if (selected) await pick(selected);
  }

  start();
}

const body = threePaneBody({search: 'Search id or message', treeLabel: 'Corpora and categories', listLabel: 'Cases', drawer: 'Cases', treeLoading: 'loading corpora…'});

/** The `/audit` page; the server only serves it to a signed-in administrator. */
export const auditPage = ({signedIn = true} = {}) => layout({title: 'Corpus audit · ChatSOP', active: 'audit', signedIn, body, style: THREE_PANE_STYLE + style + SOP_CODE_STYLE, script: `${sopCodeScript}\n${paneKitScript}\n(${client})();`});
