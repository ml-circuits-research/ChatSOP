/** Corpus audit page (`/audit`): a three-pane browser over the audit API.
 *
 *   left    — corpora as a collapsible tree of categories (split, family,
 *             language, input mode, review status, theme, expected status,
 *             verdict) with counts, plus free-text search;
 *   middle  — the server-paginated case list (50 per page), keyboard
 *             navigable (up/down, j/k), selection kept in the URL hash;
 *   right   — the selected case in full, in two separated groups: what the
 *             model sees (the user message only, which is the exact training
 *             prompt (the message alone), and the target SOP it
 *             must output) and the verification-only world, vocabulary, entity
 *             and predicate index, expected result and execution it never
 *             sees; then fields, machine-audit findings, verdicts and raw JSON.
 *
 * SOP code is rendered by the shared server/pages/sop-code.mjs renderer, which
 * links wire types and fields to their documentation pages. The layout, the
 * skeleton and the generic browser helpers come from server/pages/three-pane.mjs,
 * shared with the evaluation browser (`/eval`).
 *
 * Four tabs (registry config/audit-corpora.json, DS020 "Corpus registry"): `bad_english`, `symbolic_english` and
 * `neuro_english`, the three datasets, each with a statement of purpose, row counts per split, its own filters and case
 * view and an on-demand check (SymbolicLM re-run, SymbolicLM on message and target, clean-English classifier), and a
 * secondary `archive / sources` tab for the legacy corpora (formalizer, proofreading and cleanText views) and the
 * read-only local source cache.
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
.tabs{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px;position:sticky;top:0;background:var(--panel);z-index:2;padding-bottom:4px}
.tabs button{flex:1 1 44%;min-width:0;padding:5px 4px;font-size:13px;border-radius:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tabs button[aria-selected=true]{background:var(--accent);color:var(--accent-text);border-color:var(--accent)}
.tabs .count{color:inherit;margin-left:4px}
.tabnote{font-size:12px;color:var(--muted);margin:0 4px 8px}
.banner{border:1px dashed var(--line);background:var(--soft);border-radius:8px;padding:6px 10px;margin:0 0 10px;font-size:13px}
.diff{white-space:pre-wrap;word-break:break-word;font-size:15px;padding:8px 10px;background:var(--soft);border-radius:6px;margin:4px 0 10px}
.diff .ins{background:color-mix(in srgb,var(--ok) 28%,transparent);border-radius:3px}
.diff .del{background:color-mix(in srgb,var(--bad) 24%,transparent);text-decoration:line-through;border-radius:3px}
.candidate{margin:0 0 10px}
.symres{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:8px}
.symres>div{border:1px solid var(--line);border-radius:8px;padding:6px 8px;min-width:0}
.symres pre{white-space:pre-wrap;word-break:break-word;font-size:12px;margin:4px 0 0}
.purpose{color:var(--text);font-size:13px;line-height:1.4}
.stats{font-weight:500}
.analysis{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
.analysis .deptreebox{flex:1 1 240px;min-width:0}
.analysis .tablebox{flex:2 1 340px;min-width:0}
pre.deptree{white-space:pre;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.35;margin:4px 0 8px;padding:8px 10px;background:var(--soft);border-radius:6px}
table.deps td,table.deps th{padding:2px 6px;white-space:nowrap}
.sentence{margin:0 0 14px}
.detail section .why{margin:0 0 6px;font-size:13px}
.detail section.verify .why{margin:0 0 6px;font-size:13px}
.detail section.verify pre,.detail section.verify .code{opacity:.9}
`;

/** Browser code. Runs as `(${client})()`, so it must not close over module scope. */
function client() {
  const PAGE_SIZE = 50;
  const VERDICT_LABEL = {unreviewed: 'unreviewed', approve: 'ok', needs_fix: 'needs fix', reject: 'reject'};
  const FILTER_KEYS = ['split', 'family', 'language', 'input_mode', 'review', 'theme', 'status', 'verdict', 'kind', 'layer', 'pipeline', 'question_type', 'category', 'domain', 'author', 'source', 'verification', 'sop_layer', 'judge', 'agreement', 'outcome', 'failure_kind', 'blame', 'target_state', 'flag', 'target_source', 'noise'];
  const TABS = window.CHATSOP_AUDIT.tabs;
  const TAB_IDS = TABS.map(tab => tab.id);
  const openGroups = new Set(['split', 'family', 'language', 'verdict']);

  const state = {corpora: [], facets: {}, tab: TAB_IDS[0], corpus: null, filters: {}, q: '', page: 1, list: null, selected: null, detail: null};
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
    if (state.tab && state.tab !== TAB_IDS[0]) params.set('tab', state.tab);
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
    state.tab = TAB_IDS.includes(params.get('tab')) ? params.get('tab') : TAB_IDS[0];
    state.filters = {};
    for (const key of FILTER_KEYS) if (params.get(key)) state.filters[key] = params.get(key);
    state.q = params.get('q') ?? '';
    state.page = Math.max(1, Number(params.get('page')) || 1);
    state.selected = params.get('id');
  }

  // ---- Left pane: corpus tree ----

  function renderTree() {
    $('search').value = state.q;
    const inTab = state.corpora.filter(corpus => corpus.tab === state.tab);
    const tabs = '<div class="tabs" role="tablist" aria-label="Dataset">' + TABS.map(tab => '<button type="button" role="tab" data-tab="' + esc(tab.id) + '" aria-selected="' + (tab.id === state.tab) + '" title="' + esc(tab.label) + '">' + esc(tab.id === 'archive' ? 'archive' : tab.label) + '</button>').join('') + '</div>' +
      '<p class="tabnote purpose">' + esc(TABS.find(tab => tab.id === state.tab)?.purpose ?? '') + '</p>';
    const html = tabs + inTab.map(corpus => {
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
      const reviewed = (corpus.reviewed ? ' · ' + corpus.reviewed + ' reviewed' : '') + (corpus.sealed ? ' · sealed (view only)' : corpus.sealedSplits?.length ? ' · sealed splits: ' + corpus.sealedSplits.join(', ') : '') + (corpus.localOnly ? ' · local source cache' : '');
      return '<details class="corpus' + (active ? ' active' : '') + '" data-corpus="' + esc(corpus.corpus) + '"' + (active ? ' open' : '') + '>' +
        '<summary title="' + esc(corpus.rows + ' rows' + reviewed) + '"><span>' + esc(corpus.corpus) + '</span><span class="count">' + (corpus.cases ?? corpus.rows).toLocaleString() + '</span></summary>' +
        '<div class="tabnote stats">' + esc(Object.keys(corpus.splits).length > 6 ? Object.keys(corpus.splits).length + ' files · ' + corpus.rows.toLocaleString() + ' rows' : Object.entries(corpus.splits).map(([split, n]) => split + ' ' + n.toLocaleString() + (corpus.sealedSplits?.includes(split) ? ' (sealed, view only)' : '')).join(' · ')) + (corpus.localOnly ? ' · local source cache, never exported' : '') + '</div>' + inner + '</details>';
    }).join('');
    $('tree').innerHTML = html + (inTab.length ? '' : '<p class="muted">No corpus was found for this tab.</p>');
  }

  const labelOf = (key, value) => (key === 'verdict' ? VERDICT_LABEL[value] ?? value : value);

  async function openCorpus(name) {
    if (state.corpus !== name) {
      state.corpus = name;
      state.tab = state.corpora.find(corpus => corpus.corpus === name)?.tab ?? state.tab;
      state.filters = {};
      state.page = 1;
      state.selected = null;
      state.detail = null;
    }
    renderTree();
    await loadFacets();
    await loadList();
  }

  /** One tab per dataset type; switching opens the first corpus of that type. */
  async function switchTab(tab) {
    if (tab === state.tab) return;
    state.tab = tab;
    state.corpus = null;
    state.filters = {};
    state.page = 1;
    state.selected = null;
    state.detail = null;
    state.list = null;
    renderDetail();
    renderList();
    const first = state.corpora.find(corpus => corpus.tab === tab);
    if (first) await openCorpus(first.corpus);
    else {
      renderTree();
      writeHash();
    }
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
    const extra = item.type === 'proofreading' ? [item.kind, item.pipeline] : item.type === 'cleanText' ? [item.kind] : item.type === 'bad_english' ? [item.target_state] : item.type === 'symbolic_english' ? [item.verification] : item.type === 'neuro_english' ? [item.failure_kind, item.target_state] : [];
    return extra.filter(Boolean).map(text => '<span class="badge">' + esc(text) + '</span>').join('') + item.languages.map(lang => '<span class="badge">' + esc(lang) + '</span>').join('') +
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
    if (c.type === 'symbolic_english') return renderSymbolicEnglish(c);
    if (c.type === 'neuro_english') return renderNeuroEnglish(c);
    if (c.type === 'bad_english') return renderBadEnglish(c);
    if (c.type === 'proofreading') return renderProofreading(c);
    if (c.type === 'cleanText') return renderCleanText(c);
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

  // ---- Proofreading and cleanText views (message to clean rewrite, word diff, on-demand SymbolicLM) ----

  const diffHtml = spans => '<div class="diff">' + (spans ?? []).map(part => '<span class="' + (part.type === 'insert' ? 'ins' : part.type === 'delete' ? 'del' : 'eq') + '">' + esc(part.text) + '</span>').join('') + '</div>';
  const corpusInfo = () => state.corpora.find(entry => entry.corpus === state.corpus) ?? {};

  function banner(c) {
    const info = corpusInfo();
    const notes = [];
    if (info.localOnly) notes.push('Local source cache (<code>datasets_sources/</code>): read-only, never exported (DS014). Your verdicts are appended to the audit ledger only.');
    if (info.sealed || (info.sealedSplits ?? []).some(split => c.splits.includes(split))) notes.push('Sealed suite: view only. The data is never edited here; your verdict is appended to <code>eval/reports/current/audit/' + esc(state.corpus) + '.jsonl</code>.');
    return notes.map(note => '<div class="banner">' + note + '</div>').join('');
  }

  function commonHead(c) {
    return '<h2>' + esc(c.id) + '</h2><div class="rowhead" style="margin-bottom:10px">' + c.languages.map(l => '<span class="badge">' + esc(l) + '</span>').join('') + c.splits.map(s => '<span class="badge">' + esc(s) + '</span>').join('') +
      (c.verdict ? '<span class="badge v-' + esc(c.verdict.verdict) + '">' + esc(VERDICT_LABEL[c.verdict.verdict]) + '</span>' : '<span class="badge">unreviewed</span>') + '</div>' + banner(c);
  }

  function verdictSection(c) {
    const historyRows = (c.history ?? []).slice().reverse().map(record => '<tr><td>' + esc(record.ts) + '</td><td><span class="badge v-' + esc(record.verdict) + '">' + esc(VERDICT_LABEL[record.verdict] ?? record.verdict) + '</span></td><td>' + esc(record.note) + '</td></tr>').join('');
    return '<section><h3>Verdict</h3><div class="verdicts"><button type="button" data-verdict="approve">ok</button><button type="button" data-verdict="needs_fix">needs fix</button><button type="button" data-verdict="reject">reject</button>' +
      '<span id="verdictout" class="muted"></span><textarea id="note" placeholder="note (optional, kept in the ledger)" maxlength="2000"></textarea></div>' +
      (historyRows ? '<h4 style="margin:12px 0 4px">History</h4><div class="tablewrap"><table class="small"><thead><tr><th>time</th><th>verdict</th><th>note</th></tr></thead><tbody>' + historyRows + '</tbody></table></div>' : '<p class="muted" style="margin:8px 0 0">No verdict recorded yet.</p>') + '</section>';
  }

  const rawSection = c => '<section><details class="fold"><summary>Raw JSON (' + c.raw.length + ' row' + (c.raw.length > 1 ? 's' : '') + ')</summary><pre>' + esc(json(c.raw)) + '</pre></details></section>';

  function commonTail(c, sym) {
    const audit = c.audit ?? {findings: []};
    return '<section><h3>SymbolicLM check</h3><button type="button" class="primary" id="run">Check with SymbolicLM</button> <span class="muted">' + esc(sym) + '</span><div id="runout"></div></section>' +
      '<section><h3>Machine audit</h3>' + auditSummary(audit) + findingsList(audit.findings) + '</section>' + verdictSection(c) + rawSection(c);
  }

  // ---- The three datasets: symbolic_english, neuro_english, bad_english ----

  const chips = (values, cls = '') => (values ?? []).map(name => '<span class="badge ' + cls + '">' + esc(name) + '</span>').join(' ');
  const yesNo = value => (value === true ? '<span class="badge good">yes</span>' : value === false ? '<span class="badge bad">no</span>' : '<span class="badge">not available</span>');
  const judgeText = judge => (judge === null || judge === undefined ? '<span class="badge">pending (no judge verdict yet)</span>' : '<span class="badge">' + esc(typeof judge === 'object' ? judge.verdict ?? judge.status ?? JSON.stringify(judge) : judge) + '</span>');

  function tokenTable(tokens) {
    return '<div class="tablewrap"><table class="small deps"><thead><tr><th>id</th><th>form</th><th>lemma</th><th>upos</th><th>head</th><th>deprel</th></tr></thead><tbody>' +
      tokens.map(t => '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.form) + '</td><td>' + esc(t.lemma) + '</td><td>' + esc(t.upos) + '</td><td>' + esc(t.head) + '</td><td>' + esc(t.deprel) + '</td></tr>').join('') + '</tbody></table></div>';
  }

  /** Grammatical analysis, per sentence: indented dependency tree, dependency table, arc list. */
  function analysisHtml(sentences) {
    if (!sentences?.length) return '<p class="muted">No grammatical analysis stored for this row.</p>';
    return sentences.map((sentence, index) => '<div class="sentence"><div class="rowhead"><b>sentence ' + (index + 1) + '</b></div><div class="message">' + esc(sentence.text) + '</div>' +
      '<div class="analysis"><div class="deptreebox"><h4>Dependency tree</h4><pre class="deptree">' + esc(sentence.tree) + '</pre></div><div class="tablebox"><h4>Dependency table</h4>' + tokenTable(sentence.tokens) + '</div></div>' +
      '<details class="fold"><summary>Arc list (' + sentence.arcs.length + ')</summary><pre>' + esc(sentence.arcs.join('\n')) + '</pre></details></div>').join('');
  }

  const sopLayerText = layer => (layer ? '<span class="badge">' + esc(layer.status) + '</span>' + (layer.failure_kind ? ' <span class="muted">SOP failure kind ' + esc(layer.failure_kind) + '</span>' : '') : '<span class="badge">none</span>');
  const verifyStatus = c => '<span class="badge ' + (['analysis_gate', 'sop_rule', 'gold_sop_match'].includes(c.verification.analysis_verified) ? 'good' : 'warning') + '">' + esc(c.verification.analysis_verified) + '</span>';

  function lmInfo(c) {
    return c.symbolic_lm ? inline({version: c.symbolic_lm.version, rules: c.symbolic_lm.rules, stanza: c.symbolic_lm.stanza}) : '';
  }

  function renderSymbolicEnglish(c) {
    const fields = '<section>' + kv([['dataset', esc(c.corpus)], ['split', esc(c.splits.join(', '))], ['source corpus', esc(c.source?.corpus)], ['source id', '<code>' + esc(c.source?.id) + '</code>'], ['file', esc(c.file)], ['SymbolicLM', lmInfo(c)], ['review status', esc(c.review_status)]]) + '</section>';
    const verification = '<section><h3>Verification status</h3>' + kv([
      ['analysis verified', verifyStatus(c)],
      ['analysis judge (DeepSeek a and c, identical trees)', judgeText(c.verification.judge)],
      ['SOP layer (later layer)', sopLayerText(c.verification.sop_layer)],
      ['SOP matches the gold', yesNo(c.verification.sop_gold_match)],
      ['Stanza and spaCy agree on the core arcs', yesNo(c.verification.stanza_spacy_agree)],
    ]) + '<p class="muted" style="margin:6px 0 0">analysis_gate: every sentence has identical default and accurate Stanza trees and the DeepSeek parse judge (conditions a and c) says good enough. sop_rule: no analysed sentence or an unparsed span, so the SOP rules decided. The SOP layer (match, mismatch, no gold) is information for the later layer and never decides the dataset. Stanza-spaCy agreement is a weak second opinion, not a verdict.</p></section>';
    const message = '<section class="model"><h3>Message</h3><div class="message">' + esc(c.message) + '</div></section>';
    const analysis = '<section><h3>SymbolicLM grammatical analysis</h3>' + analysisHtml(c.sentences) + '</section>';
    const sop = '<section><h3>SOP Lang produced from the analysis</h3>' + (c.sop ? codeBlock(c.sop, 'sop') : '<p class="muted">No SOP stored (SOP generation is a later stage).</p>') + kv([['valid', yesNo(c.sop_valid)], ['outcome', esc(c.outcome)], ['unparsed', esc((c.unparsed ?? []).join(' | '))]]) +
      (c.gold_sop ? '<details class="fold"><summary>Gold SOP</summary>' + codeBlock(c.gold_sop, 'gold_sop') + '</details>' : '') + '</section>';
    const rerun = '<section><h3>Regression check of this row</h3><button type="button" class="primary" id="run">Re-run SymbolicLM</button> <span class="muted">runs the current engine on this message and reports whether it still gives the same analysis and SOP (same classes as tools/symbolic-regression.mjs)</span><div id="runout"></div></section>';
    $('detail').innerHTML = commonHead(c) + fields + message + verification + analysis + sop + rerun + verdictSection(c) + rawSection(c);
  }

  const failureNotes = {trees_differ: 'The default and accurate Stanza trees of a sentence differ.', judge_ac: 'The DeepSeek parse judge says not good enough on both conditions a and c.', judge_a: 'The DeepSeek parse judge says not good enough on condition a (reading and arcs).', judge_c: 'The DeepSeek parse judge says not good enough on condition c (six checks on the tree).', no_analysis: 'No analysed sentence; the SOP rules decided.', unparsed_span: 'SymbolicLM left an unparsed span; the SOP rules decided.', pending_judge: 'No judge verdict yet.', parser: 'Stanza analysed the sentence wrongly.', rules: 'The parse is usable but the UD-to-SOP rules miss or mis-build.', gold_convention: 'Only a gold convention differs (boundary, role name, wording); not a rewrite target.', unknown: 'No layer information.'};

  function renderNeuroEnglish(c) {
    const f = c.failure ?? {};
    const fields = '<section>' + kv([['dataset', esc(c.corpus)], ['split', esc(c.splits.join(', '))], ['source corpus', esc(c.source?.corpus)], ['file', esc(c.file)], ['SymbolicLM', lmInfo(c)], ['analysis verified', verifyStatus(c)], ['SOP layer (later layer)', sopLayerText(c.verification?.sop_layer)], ['review status', esc(c.review_status)]]) + '</section>';
    const failure = '<section><h3>Failure: ' + esc(c.failure_kind) + '</h3><p class="why">' + esc(failureNotes[c.failure_kind] ?? '') + '</p>' + kv([
      ['failure_kind', '<span class="badge">' + esc(c.failure_kind) + '</span>'],
      ['blame categories', chips(f.categories)],
      ['difference classes', chips(f.classes)],
      ['proofing layer', esc(f.proofing_layer)],
      ['frame recoverable', yesNo(f.frame_recoverable)],
      ['also a gold convention', yesNo(f.also_gold_convention)],
      ['formatting only', yesNo(f.formatting_only)],
      ['unparsed spans', esc((f.unparsed ?? c.unparsed ?? []).join(' | '))],
      ['rewrite target', c.rewrite_target === false ? '<span class="badge warning">no: not a rewrite target</span>' : '<span class="badge good">yes</span>'],
      ['flags', chips(c.flags)],
    ]) + '<details class="fold"><summary>All blame details</summary><pre>' + esc(json(c.failure)) + '</pre></details></section>';
    const message = '<section class="model"><h3>Message</h3><div class="message">' + esc(c.message) + '</div></section>';
    const compare = '<section><h3>What SymbolicLM produced against the gold</h3><div class="symres"><div><b>SymbolicLM output</b> <span class="badge ' + (c.sop_valid ? 'good' : 'warning') + '">' + (c.sop_valid ? 'valid SOP' : 'invalid SOP') + '</span> <span class="muted">outcome ' + esc(c.outcome) + '</span>' + (c.sop ? codeBlock(c.sop, 'sop') : '<pre>(empty)</pre>') + '</div><div><b>Gold SOP</b>' + (c.gold_sop ? codeBlock(c.gold_sop, 'gold_sop') : '<p class="muted">No gold (new case).</p>') + '</div></div></section>';
    const analysis = '<section><h3>SymbolicLM grammatical analysis of the message</h3>' + analysisHtml(c.sentences) + '</section>';
    const targets = (c.targets ?? []).map((target, index) => '<div class="candidate"><div class="rowhead">target ' + (index + 1) + ' <span class="badge">' + esc(target.source) + '</span></div><div class="message">' + esc(target.text) + '</div>' + (target.spans ? '<h4>Changes</h4>' + diffHtml(target.spans) : '<p class="muted">Identical to the message.</p>') + '</div>').join('');
    const rewrite = '<section><h3>Rewrite target (meaning-preserving, in a form SymbolicLM handles)</h3>' + (targets || '<p class="muted">No target' + (c.rewrite_target === false ? ' (a gold convention, not a rewrite).' : ' yet.') + '</p>') +
      ((c.unverified_references ?? []).length ? '<details class="fold"><summary>References that SymbolicLM does not handle (' + c.unverified_references.length + ')</summary><pre>' + esc(json(c.unverified_references)) + '</pre></details>' : '') + '</section>';
    const check = '<section><h3>SymbolicLM check</h3><button type="button" class="primary" id="run">Check message and target</button> <span class="muted">runs the current engine on the message and on each target and compares with the stored output and the gold</span><div id="runout"></div></section>';
    $('detail').innerHTML = commonHead(c) + fields + message + failure + compare + analysis + rewrite + check + verdictSection(c) + rawSection(c);
  }

  function renderBadEnglish(c) {
    const fields = '<section>' + kv([['dataset', esc(c.corpus)], ['split', esc(c.splits.join(', '))], ['kind', '<span class="badge">' + esc(c.kind) + '</span>'], ['noise categories', chips(c.noise_categories)], ['noise', c.noise ? inline(c.noise) : ''], ['source corpus', esc(c.source?.corpus)], ['file', esc(c.file)], ['review status', esc(c.review_status)]]) + '</section>';
    const message = '<section class="model"><h3>Message as written</h3><div class="message">' + esc(c.message) + '</div>' + ((c.gate_reasons ?? []).length ? '<details class="fold"><summary>Why the classifier says not clean English</summary><ul>' + c.gate_reasons.map(text => '<li>' + esc(text) + '</li>').join('') + '</ul></details>' : '') + '</section>';
    const targets = (c.targets ?? []).map((target, index) => '<div class="candidate"><div class="rowhead">target ' + (index + 1) + ' <span class="badge">' + esc(target.source) + '</span></div><div class="message">' + esc(target.text) + '</div>' + (target.spans ? '<h4>Changes</h4>' + diffHtml(target.spans) : '<p class="muted">Identical to the message.</p>') + '</div>').join('');
    const clean = '<section><h3>Clean English target</h3>' + (targets || '<p class="muted">No clean target known for this row (kept for evaluation; nobody could rewrite it yet).</p>') + '</section>';
    const check = '<section><h3>Target check</h3><button type="button" class="primary" id="run"' + ((c.targets ?? []).length ? '' : ' disabled') + '>Check the target</button> <span class="muted">classifies the message and each target (is it clean English?) and parses each target with SymbolicLM</span><div id="runout"></div></section>';
    $('detail').innerHTML = commonHead(c) + fields + message + clean + check + verdictSection(c) + rawSection(c);
  }

  function renderProofreading(c) {
    const fields = '<section>' + kv([['corpus', esc(c.corpus)], ['split', esc(c.splits.join(', '))], ['kind', esc(c.kind.join(', '))], ['failing layer', esc(c.layer.join(', '))], ['pipeline', esc(c.pipeline.join(', '))], ['language', esc(c.languages.join(', '))]]) + '</section>';
    const rows = c.rows.map(row =>
      '<section><div class="rowhead"><code>' + esc(row.id) + '</code><span class="badge">' + esc(row.split) + '</span><span class="badge">' + esc(row.kind) + '</span>' + (row.layer ? '<span class="badge">layer ' + esc(row.layer) + '</span>' : '') + '<span class="badge">' + esc(row.pipeline) + '</span>' +
      (row.source_language ? '<span class="badge">from ' + esc(row.source_language) + '</span>' : '') + (row.question_type ? '<span class="badge">' + esc(row.question_type) + '</span>' : '') + (row.char_edit !== null ? '<span>' + esc(row.char_edit) + ' char edits</span>' : '') + '<span>' + esc(row.file) + '</span></div>' +
      '<h4>Message</h4><div class="message">' + esc(row.input) + '</div>' +
      '<h4>Clean rewrite</h4>' + (row.target === null ? '<p class="muted">No rewrite yet (a hard case kept for evaluation).</p>' : '<div class="message">' + esc(row.target) + '</div><h4>Changes</h4>' + (row.target === row.input ? '<p class="muted">Unchanged (identity).</p>' : diffHtml(row.spans))) +
      kv([['target source', esc(row.target_source)], ['noise', esc((row.noise_ops ?? []).join(', '))], ['untranslated', esc((row.untranslated ?? []).join(', '))]]) +
      '<details class="fold"><summary>Oracle, signals and meaning checks</summary><pre>' + esc(json({raw_oracle: row.raw_oracle, target_oracle: row.target_oracle, signals: row.signals, meaning_checks: row.meaning_checks, flags: row.flags, rights: row.rights})) + '</pre></details></section>').join('');
    $('detail').innerHTML = commonHead(c) + fields + rows + commonTail(c, 'parses the message and the rewrite of each surface (first ' + 6 + ') with the local Stanza worker and compares them');
  }

  function renderCleanText(c) {
    const fields = '<section>' + kv([['corpus', esc(c.corpus)], ['file', esc(c.splits.join(', '))], ['kind', esc(c.kind)], ['categories', c.category.map(name => '<span class="badge">' + esc(name) + '</span>').join(' ')], ['domain', esc(c.domain)], ['author', esc(c.author)], ['source', esc(c.source)], ['notes', esc(c.notes)]]) + '</section>';
    const row = c.rows[0];
    const cands = row.candidates.map((cand, index) => '<div class="candidate"><div class="rowhead">candidate ' + (index + 1) + (cand.identity ? ' · identical to the message' : '') + '</div><div class="message">' + esc(cand.text) + '</div>' + (cand.identity ? '' : diffHtml(cand.spans)) + '</div>').join('');
    const body = '<section><div class="rowhead"><code>' + esc(row.id) + '</code><span class="badge">' + esc(row.language) + '</span><span>' + esc(row.file) + '</span></div><h4>Message as typed</h4><div class="message">' + esc(row.message) + '</div><h4>Clean candidates</h4>' + (cands || '<p class="muted">No clean candidate.</p>') +
      ((c.clean_ro ?? []).length ? '<h4>Romanian reference</h4>' + c.clean_ro.map(text => '<div class="message">' + esc(text) + '</div>').join('') : '') +
      (c.gold_sop ? '<details class="fold"><summary>Gold SOP supplied by the writer</summary><pre>' + esc(c.gold_sop) + '</pre></details>' : '') + '</section>';
    $('detail').innerHTML = commonHead(c) + fields + body + commonTail(c, 'parses the message and each candidate, and compares with the gold SOP when one is given');
  }

  function symbolicCell(title, check) {
    if (!check) return '<div><b>' + esc(title) + '</b><p class="muted">no text</p></div>';
    if (!check.ok) return '<div><b>' + esc(title) + '</b><p class="bad">' + esc(check.error) + '</p></div>';
    return '<div><b>' + esc(title) + '</b> <span class="badge ' + (check.valid && !check.unparsed ? 'good' : 'warning') + '">' + (check.valid && !check.unparsed ? 'clean parse' : 'check') + '</span>' +
      '<div class="muted" style="font-size:12px">outcome ' + esc(check.outcome) + ' · route ' + esc(check.route) + ' · ' + esc(check.unparsed) + ' unparsed · ' + esc(check.ms) + ' ms' + (check.uncertain ? ' · uncertain: ' + esc(check.reasons.join(', ')) : '') + '</div><pre>' + esc(check.sop || '(empty)') + '</pre></div>';
  }

  function renderSymbolic(data) {
    const verdictOf = entry => entry.improved === true ? '<span class="match ok">rewrite parses cleanly where the message did not</span>' : entry.same_sop === true ? '<span class="muted">same SOP for both</span>' : entry.same_sop === false ? '<span class="muted">different SOP</span>' : '';
    const note = data.truncated ? '<p class="muted">Only the first surfaces were checked.</p>' : '';
    if (data.type === 'proofreading') return note + data.rows.map(row => '<h4>' + esc(row.id) + '</h4><div class="symres">' + symbolicCell('message', row.input) + symbolicCell('rewrite', row.target) + '</div><p>' + verdictOf(row) + '</p>').join('');
    return data.rows.map(row => '<div class="symres">' + symbolicCell('message', row.message.check) + row.candidates.map((cand, index) => symbolicCell('candidate ' + (index + 1), cand.check)).join('') + '</div>' +
      row.candidates.map((cand, index) => '<p>candidate ' + (index + 1) + ': ' + verdictOf(cand) + (cand.matches_gold === true ? ' <span class="match ok">matches the gold SOP</span>' : cand.matches_gold === false ? ' <span class="match bad">differs from the gold SOP</span>' : '') + '</p>').join('')).join('');
  }

  const CLASS_NOTE = {same: ['ok', 'same analysis and same SOP: no regression'], analysis_changed_sop_same: ['ok', 'the parse changed but the SOP is the same'], sop_changed_equivalent: ['ok', 'the SOP text changed but still matches the gold'], sop_changed: ['bad', 'the SOP changed and nothing verifies the new one'], now_failing: ['bad', 'the row is no longer handled: invalid SOP, crash, new unparsed span or lost gold match']};
  const goldNote = value => (value === true ? ' <span class="match ok">text-identical to the gold SOP</span>' : value === false ? ' <span class="match bad">differs from the gold SOP text (may still be equivalent; the dataset build uses the strict oracle)</span>' : '');

  function renderDatasetCheck(data) {
    if (data.available === false) return '<p class="bad">SymbolicLM is not available: ' + esc(data.error) + '</p>';
    if (data.type === 'symbolic_english') {
      const [tone, note] = CLASS_NOTE[data.class] ?? ['bad', ''];
      return '<p class="match ' + tone + '">' + esc(data.class) + ': ' + esc(note) + '</p>' + kv([['same grammatical analysis', yesNo(data.same_analysis)], ['same SOP', yesNo(data.same_sop)], ['outcome', esc(data.outcome)], ['time', esc(data.ms) + ' ms']]) +
        (data.same_sop ? '' : '<div class="symres"><div><b>stored SOP</b>' + codeBlock(data.stored_sop, 'stored') + '</div><div><b>current SOP</b>' + codeBlock(data.current_sop, 'current') + '</div></div>') +
        (data.same_analysis ? '' : '<h4>Current analysis</h4>' + analysisHtml(data.current_sentences)) + '<p class="muted">' + esc(data.note) + '</p>';
    }
    if (data.type === 'neuro_english') {
      return '<div class="symres">' + symbolicCell('message', data.message.check) + data.targets.map((target, index) => symbolicCell('target ' + (index + 1), target.check)).join('') + '</div>' +
        '<p>message: ' + (data.message.same_as_stored === true ? '<span class="muted">same output as stored</span>' : data.message.same_as_stored === false ? '<span class="match bad">output changed since the dataset was built</span>' : '') + goldNote(data.message.matches_gold) + '</p>' +
        data.targets.map((target, index) => '<p>target ' + (index + 1) + ': ' + (target.improved === true ? '<span class="match ok">parses cleanly where the message did not</span>' : target.same_sop === true ? '<span class="muted">same SOP as the message</span>' : '<span class="muted">different SOP</span>') + goldNote(target.matches_gold) + '</p>').join('') +
        (data.targets.length ? '' : '<p class="muted">No target to check.</p>');
    }
    const partition = entry => '<span class="badge ' + (entry.partition === 'clean_en' ? 'good' : 'warning') + '">' + esc(entry.partition) + '</span>' + (entry.reasons.length ? ' <span class="muted">' + esc(entry.reasons.join('; ')) + '</span>' : '');
    return '<p>message classified as ' + partition(data.message) + '</p>' + data.targets.map((target, index) => '<h4>target ' + (index + 1) + '</h4><p>' + (target.clean_english ? '<span class="match ok">clean English</span>' : '<span class="match bad">not clean English</span>') + ' ' + partition(target.classifier) + '</p><div class="symres">' + symbolicCell('target parse', target.check) + '</div>').join('') +
      (data.targets.length ? '' : '<p class="muted">No target to check.</p>');
  }

  function auditSummary(audit) {
    if (audit.coverage === 'none' && ['bad_english', 'symbolic_english', 'neuro_english'].includes(corpusInfo().type)) return '<p class="muted" style="margin:0">No machine-audit report for this dataset.</p>';
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
      if (data.type === 'proofreading' || data.type === 'cleanText') {
        out.innerHTML = renderSymbolic(data);
        return;
      }
      if (data.type === 'symbolic_english' || data.type === 'neuro_english' || data.type === 'bad_english') {
        out.innerHTML = renderDatasetCheck(data);
        return;
      }
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
    const text = name === 'sop' ? c.sop : name === 'gold_sop' ? c.gold_sop : name === 'target' ? c.target : name === 'setup' ? c.setup : name === 'ontology' ? c.ontology : c.rows.find(row => 'row:' + row.id === name)?.target;
    window.ChatSopPane.copyText(text, button);
  }

  // ---- Events ----

  function bind() {
    $('tree').addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]');
      if (tab) return switchTab(tab.dataset.tab);
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
    if (state.corpus) state.tab = state.corpora.find(entry => entry.corpus === state.corpus).tab;
    // Land on the first corpus of the selected tab, so a dataset tab shows its cases at once.
    else state.corpus = state.corpora.find(entry => entry.tab === state.tab)?.corpus ?? null;
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

/** The `/audit` page; the server only serves it to a signed-in administrator. `tabs` = [{id, label, purpose}]. */
export const auditPage = ({signedIn = true, tabs = []} = {}) => {
  const config = JSON.stringify({tabs}).replace(/</g, '\\u003c');
  return layout({title: 'Corpus audit · ChatSOP', active: 'audit', signedIn, body, style: THREE_PANE_STYLE + style + SOP_CODE_STYLE, script: `window.CHATSOP_AUDIT=${config};\n${sopCodeScript}\n${paneKitScript}\n(${client})();`});
};
