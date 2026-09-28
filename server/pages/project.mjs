/** Fine-tuning & status page (`/project`): the owner's near-real-time view.
 *
 * The page polls `/project/api/status` every 15 seconds and whenever the tab
 * regains focus, and renders: the current phase and the gates (training is
 * PROHIBITED until the owner's new explicit approval), the live journal
 * timeline filterable by area, the data pipeline per corpus, the experiment
 * registry, the open owner questions from `questions.md`, and explanations of
 * what fine-tuning will do. The explanations are static text; everything else
 * comes from files on each poll (server/project.mjs).
 */
import {layout} from './layout.mjs';

const style = `
.status{max-width:1200px}
.banner{border:2px solid var(--bad);background:color-mix(in srgb,var(--bad) 10%,var(--panel));border-radius:10px;padding:12px 16px;margin:0 0 14px}
.banner b.big{font-size:1.2rem;color:var(--bad)}
.cols{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px}
@media (max-width:980px){.cols{grid-template-columns:1fr}}
.card h2{font-size:1.1rem;margin:0 0 8px}
table.t{border-collapse:collapse;width:100%;font-size:14px}
table.t td,table.t th{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
table.t th{color:var(--muted);font-weight:600;font-size:13px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.gate{font-weight:700;white-space:nowrap}
.gate.open{color:var(--ok)}.gate.closed{color:var(--bad)}.gate.prohibited{color:#fff;background:var(--bad);padding:1px 6px;border-radius:5px}
.tablewrap{overflow-x:auto}
.filters{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}
.filters button{padding:2px 10px;font-size:13px;border-radius:12px}
.filters button.on{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
ol.timeline{list-style:none;margin:0;padding:0;max-height:70vh;overflow:auto}
ol.timeline li{border-left:3px solid var(--line);padding:4px 0 10px 12px;margin-left:4px;position:relative}
ol.timeline li::before{content:'';position:absolute;left:-7px;top:9px;width:11px;height:11px;border-radius:50%;background:var(--line)}
ol.timeline li.s-done::before{background:var(--ok)}ol.timeline li.s-blocked::before{background:var(--bad)}ol.timeline li.s-decision::before{background:#8250df}ol.timeline li.s-started::before,ol.timeline li.s-progress::before{background:var(--accent)}
.meta{font-size:12px;color:var(--muted)}
.tag{font-size:11px;padding:0 6px;border-radius:8px;border:1px solid var(--line);background:var(--soft);margin-right:4px}
.tag.decision{border-color:#8250df;color:#8250df}.tag.blocked{border-color:var(--bad);color:var(--bad)}
.detailtext{white-space:pre-wrap;font-size:14px;margin:3px 0}
.links a,.links code{font-size:12px;margin-right:8px}
.md h1,.md h2,.md h3{font-size:1rem;margin:10px 0 4px}
.md p{margin:4px 0}
.explain p,.explain li{font-size:14px;line-height:1.6}
.flow{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:13px;margin:6px 0}
.flow span{padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:var(--soft)}
.flow span.future{border-style:dashed;color:var(--muted)}
.flow i{color:var(--muted);font-style:normal}
#stamp{font-size:12px}
`;

/** Browser code. Runs as `(${client})()`, so it must not close over module scope. */
function client() {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);
  const pct = value => (value === null || value === undefined ? '—' : (100 * value).toFixed(1) + '%');
  let area = new URLSearchParams(location.hash.slice(1)).get('area') || '';
  let data = null;

  /** A link to a repository path: docs pages are served under /docs/, other paths are shown as code. */
  const linkOf = target => {
    if (/^https?:\/\//.test(target)) return '<a href="' + esc(target) + '" target="_blank" rel="noopener">' + esc(target) + '</a>';
    const spec = /^docs\/specs\/(DS\d+[^/]*\.md)$/.exec(target);
    if (spec) return '<a href="/docs/specsLoader.html?spec=' + encodeURIComponent(spec[1]) + '">' + esc(target) + '</a>';
    if (/^docs\/.+\.html$/.test(target)) return '<a href="/' + esc(target) + '">' + esc(target) + '</a>';
    if (/^eval\/(suites|reports|predictions|registry)\//.test(target)) return '<a href="/eval">' + esc(target) + '</a>';
    return '<code>' + esc(target) + '</code>';
  };

  /** Minimal Markdown for questions.md: headings, lists, paragraphs, **bold**, `code`. */
  function markdown(text) {
    const inline = line => esc(line).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const out = [];
    let list = false;
    for (const line of text.split('\n')) {
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      const item = /^\s*[-*]\s+(.*)$/.exec(line);
      if (!item && list) out.push('</ul>'), list = false;
      if (heading) out.push('<h' + (heading[1].length + 1) + '>' + inline(heading[2]) + '</h' + (heading[1].length + 1) + '>');
      else if (item) {
        if (!list) out.push('<ul>'), list = true;
        out.push('<li>' + inline(item[1]) + '</li>');
      } else if (line.trim()) out.push('<p>' + inline(line) + '</p>');
    }
    if (list) out.push('</ul>');
    return out.join('');
  }

  function renderGates() {
    $('rule').textContent = data.phase.rule ?? 'AGENTS.md rule 3: training is prohibited until the owner gives a new explicit approval.';
    $('gates').innerHTML = '<table class="t"><thead><tr><th>gate</th><th>state</th><th>evidence (computed now)</th></tr></thead><tbody>' + data.gates.map(gate =>
      '<tr><td>' + esc(gate.title) + (gate.note ? '<div class="meta">' + esc(gate.note) + '</div>' : '') + '</td><td>' +
      (gate.prohibited ? '<span class="gate prohibited">PROHIBITED</span>' : '<span class="gate ' + (gate.open ? 'open">✓ open' : 'closed">✗ closed') + '</span>') +
      '</td><td>' + esc(gate.evidence) + '<div class="meta">' + esc(gate.source) + '</div></td></tr>').join('') + '</tbody></table>' +
      '<p class="meta" style="margin:6px 0 0">An open check is an observation, never an approval: only the owner opens the training gate.</p>';
  }

  function renderTimeline() {
    $('filters').innerHTML = ['', ...data.areas].map(name => '<button type="button" data-area="' + esc(name) + '"' + (name === area ? ' class="on"' : '') + '>' + esc(name || 'all') + '</button>').join('');
    if (data.journalError) {
      $('timeline').innerHTML = '<li class="bad">' + esc(data.journalError) + '</li>';
      return;
    }
    $('timeline').innerHTML = data.journal.map(event =>
      '<li class="s-' + esc(event.state) + '"><div class="meta">' + esc(new Date(event.ts).toLocaleString()) + ' · ' + esc(event.actor) + '</div>' +
      '<div><span class="tag">' + esc(event.area) + '</span><span class="tag ' + esc(event.state) + '">' + esc(event.state) + '</span><b>' + esc(event.title) + '</b></div>' +
      (event.detail ? '<div class="detailtext">' + esc(event.detail) + '</div>' : '') +
      (event.links.length ? '<div class="links">' + event.links.map(linkOf).join('') + '</div>' : '') + '</li>').join('') || '<li class="muted">No journal events for this filter.</li>';
  }

  function renderPipeline() {
    const rows = data.pipeline.map(entry => {
      const a = entry.audit;
      const verdict = a ? '<span class="gate ' + (a.verdict === 'pass' ? 'open' : 'closed') + '">' + esc(a.verdict) + '</span>' + (a.failed_checks.length ? '<div class="meta">' + esc(a.failed_checks.join(', ')) + '</div>' : '') : '<span class="muted">no audit</span>';
      const form = entry.form === 'current' ? '<span class="gate open">current</span>' : entry.form === 'legacy' ? '<span class="gate closed">legacy</span>' : esc(entry.form);
      return '<tr><td><code>' + esc(entry.corpus) + '</code></td><td class="num">' + (entry.splits.train ?? '—').toLocaleString() + '</td><td class="num">' + (entry.splits.dev ?? '—').toLocaleString() + '</td><td class="num">' + (entry.splits.test ?? '—').toLocaleString() + '</td><td>' + form + '</td><td>' + verdict + '</td>' +
        '<td class="num">' + (a ? pct(a.faithfulness_error_rate) : '—') + '</td><td class="num">' + (a ? pct(a.template_top_share) : '—') + '</td><td class="num">' + (a ? pct(a.test_template_overlap) : '—') + '</td></tr>';
    }).join('');
    $('pipeline').innerHTML = '<div class="tablewrap"><table class="t"><thead><tr><th>corpus</th><th class="num">train</th><th class="num">dev</th><th class="num">sealed test</th><th>target form</th><th>corpus audit</th><th class="num">faithfulness errors</th><th class="num">top template share</th><th class="num">test template overlap</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="meta">Target form is sampled from the first rows of each corpus: <b>legacy</b> = identifiers/premise/CONTEXT (stale; none should remain), <b>current</b> = message-only string targets. Audit metrics come from <code>eval/reports/current/corpus-audit/</code>; top template share and test template overlap are from the development splits and the sealed test against train+dev.</p>';
    const v = data.vocabulary;
    $('vocab').innerHTML = v ? 'Vocabulary check: <b class="' + (v.verdict === 'pass' ? 'ok' : 'bad') + '">' + esc(v.verdict) + '</b> · ' + esc(v.totals?.findings ?? '?') + ' findings, ' + esc(v.totals?.failing ?? '?') + ' failing (undocumented wire types or fields) · scope ' + esc(v.scope) + ' · <code>' + esc(v.file) + '</code> (' + esc(v.mtime.slice(0, 16).replace('T', ' ')) + ')' : 'No vocabulary report.';
  }

  function renderExperiments() {
    $('experiments').innerHTML = data.experimentsError ? '<p class="bad">' + esc(data.experimentsError) + '</p>' : data.experiments.length
      ? '<div class="tablewrap"><table class="t"><thead><tr><th>id</th><th>hypothesis</th><th>preregistration</th><th>data version</th><th>status</th><th>results</th><th>conclusions</th></tr></thead><tbody>' + data.experiments.map(x => '<tr><td><code>' + esc(x.id) + '</code></td><td>' + esc(x.hypothesis) + '</td><td>' + linkOf(x.preregistration) + '</td><td>' + esc(x.data_version) + '</td><td>' + esc(x.status) + '</td><td>' + esc(typeof x.results === 'object' ? JSON.stringify(x.results) : x.results ?? '') + '</td><td>' + esc(typeof x.conclusions === 'object' ? JSON.stringify(x.conclusions) : x.conclusions ?? '') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="muted">No experiments registered. There are no valid training runs; an experiment is preregistered here (DS010) before any holdout is touched.</p>';
  }

  function renderQuestions() {
    const q = data.questions;
    $('questions').innerHTML = q ? '<div class="md">' + markdown(q.text) + '</div><p class="meta">Edit <code>questions.md</code> at the repository root: write your answer on the <code>**Răspuns:**</code> line (<a href="vscode://file' + esc(q.path) + '">open in VS Code</a>). Updated ' + esc(q.mtime.slice(0, 16).replace('T', ' ')) + '.</p>' : '<p class="muted">questions.md not found.</p>';
  }

  async function refresh() {
    try {
      const response = await fetch('/project/api/status' + (area ? '?area=' + encodeURIComponent(area) : ''), {credentials: 'same-origin'});
      if (response.status === 401) {
        location.href = '/login?next=' + encodeURIComponent('/project' + location.hash);
        return;
      }
      data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'HTTP ' + response.status);
      renderGates();
      renderTimeline();
      renderPipeline();
      renderExperiments();
      renderQuestions();
      $('stamp').textContent = 'updated ' + new Date(data.generated).toLocaleTimeString() + ' · refreshes every 15 s and on focus';
    } catch (error) {
      $('stamp').textContent = 'refresh failed: ' + error.message;
    }
  }

  $('filters').addEventListener('click', event => {
    const button = event.target.closest('[data-area]');
    if (!button) return;
    area = button.dataset.area;
    history.replaceState(null, '', area ? '#area=' + encodeURIComponent(area) : '#');
    refresh();
  });
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  refresh();
}

const explanations = `<section class="card explain" id="explain"><h2>What fine-tuning will do, and what it will not</h2>
<p><b>What the small model learns.</b> One mapping: the user's message → SOP. Its input is the message only — no context, no list of identifiers, no knowledge, no clock. It writes quoted strings: <code>stated</code> for what the message surely says, <code>assumed</code> for what it adds, <code>unclear</code> only for gibberish, a message with no request, or a visible ambiguity with no preferable reading (listing the readings), and <code>query</code>/<code>constraint</code> for the problem. It never reasons, never refuses and never links strings to knowledge: the host links, retrieves, solves and renders the answer.</p>
<p><b>What fine-tuning will do.</b> Supervised fine-tuning of a small base model (Qwen3-0.6B class) on train pairs (message → target SOP), with the best checkpoint selected only on dev predictions scored by <code>eval/run.mjs</code> (execution equivalence first), then one evaluation of that checkpoint on the sealed test, reported with its template leakage. New knowledge never needs retraining: it goes into reviewed memory, not into the weights.</p>
<p><b>Data flow.</b></p>
<div class="flow"><span>sources (QQP, PAWS, ProofWriter, AmbigNQ, QA2D, SQuAD) — inspiration only</span><i>→</i><span>diversity inventory</span><i>→</i><span>generator (IR → string targets, worlds)</span><i>→</i><span>execution check + no-copy</span><i>→</i><span>corpus audit (faithfulness, diversity, leakage) + human audit</span><i>→</i><span>qualification</span><i>→</i><span class="future">owner approval</span><i>→</i><span class="future">training (future)</span><i>→</i><span class="future">dev selection → sealed test</span></div>
<p class="meta">Dashed steps have not happened. Journal entries, the corpus audit (<a href="/audit">/audit</a>) and the evaluation browser (<a href="/eval">/eval</a>, with <a href="/eval/guide">how evaluation works</a>) show each step's evidence.</p></section>`;

/** The `/project` page shell; data arrives from `/project/api/status`. */
export function projectPage({signedIn = true} = {}) {
  const body = `<main class="wrap status">
<h1>Fine-tuning &amp; status <span id="stamp" class="muted"></span></h1>
<div class="banner"><b class="big">Training: PROHIBITED</b> until the owner's new explicit approval. <span id="rule" class="muted"></span><div class="meta">Current phase: data preparation and owner review before training. No training, fine-tuning, resume, optimizer step or training smoke run is authorized.</div></div>
<section class="card"><h2>Gates</h2><div id="gates" class="muted">loading…</div></section>
<div class="cols">
<section class="card"><h2>Journal — newest first</h2><div class="filters" id="filters"></div><ol class="timeline" id="timeline"></ol><p class="meta">Agents append with <code>node tools/journal.mjs add --area … --title … --detail …</code>; the file is <code>status/journal.jsonl</code> (append-only).</p></section>
<div>
<section class="card"><h2>Open questions for the owner</h2><div id="questions" class="muted">loading…</div></section>
<section class="card"><h2>Experiments</h2><div id="experiments" class="muted">loading…</div><p class="meta"><code>status/experiments.json</code> · preregistration rules: <a href="/docs/specsLoader.html?spec=DS010-experiment-preregistration.md">DS010</a></p></section>
</div></div>
<section class="card"><h2>Data pipeline (computed live)</h2><div id="pipeline" class="muted">loading…</div><p id="vocab" class="meta"></p></section>
${explanations}
</main>`;
  return layout({title: 'Fine-tuning & status · ChatSOP', active: 'project', signedIn, body, style, script: `(${client})();`});
}
