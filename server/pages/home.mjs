/** Server home page: sign-in state, whether the administrator password exists,
 * formalizer readiness (the state of every registry model: stopped, starting, ready or error) and large links to the chat, the corpus audit, the admin
 * page and the documentation. */
import {escapeHtml, layout} from './layout.mjs';

export function homePage({signedIn, configured, passwordStore = true, ready, formalizers = null}) {
  const account = !passwordStore
    ? '<li>Browser sign-in is not enabled on this server instance (bearer tokens only).</li>'
    : signedIn
      ? '<li><b class="ok">Signed in</b> as administrator.</li>'
      : configured
        ? '<li><b class="bad">Not signed in.</b> <a href="/login?next=%2F">Sign in</a> to use the chat, the audit and the admin page.</li>'
        : '<li><b class="bad">No administrator password yet.</b> <a href="/login?next=%2F">Choose it now</a>; until then the chat API and the audit stay locked.</li>';
  const password = passwordStore ? `<li>Administrator password: ${configured ? '<span class="ok">set</span>' : '<span class="bad">not set</span>'}</li>` : '';
  const words = {stopped: 'stopped (starts on first use)', starting: 'starting…', ready: 'ready', error: 'error'};
  const models = formalizers
    ? `<li>Models (<code>config/formalizers.json</code>; SymbolicLM is the one formalizer of the chat):<ul>${formalizers.map(m => `<li>${escapeHtml(m.label)}${m.default ? ' (default formalizer)' : ''} <span class="muted">[${escapeHtml((m.capabilities ?? []).join(', '))}]</span>: <b class="${m.state === 'ready' ? 'ok' : m.state === 'error' ? 'bad' : ''}">${words[m.state] ?? escapeHtml(m.state)}</b>${m.state === 'error' && m.error && signedIn ? ' — ' + escapeHtml(m.error) : ''}</li>`).join('')}</ul></li>`
    : null;
  const model = models ?? (ready
    ? `<li>Formalizer: <b class="ok">ready</b>. Chat answers are available.</li>`
    : `<li>Formalizer: <b class="bad">not ready</b>. Chat answers need the SymbolicLM service of <code>config/formalizers.json</code>; until it runs, the chat returns "model unavailable" (HTTP 503). Documentation, admin and audit work regardless.</li>`);
  const tile = (href, title, text) => `<a class="tile" href="${href}"><b>${title}</b><span>${text}</span></a>`;
  const body = `<main class="wrap"><h1>ChatSOP server</h1>
<section class="card" aria-label="Status"><ul class="plain">${account}${password}${model}</ul></section>
<div class="grid">
${tile('/chat', 'Chat', 'Ask questions; every answer shows its SOP, execution circuit and status.')}
${tile('/audit', 'Corpus audit', 'Browse corpora, re-execute gold cases and record verdicts.')}
${tile('/eval', 'Evaluation', 'Sealed suites, predictions and reports step by step, and how evaluation works.')}
${tile('/experiments', 'Experiments', 'Project history: every task and experiment, topic notes, reports, the live journal and gates, open questions.')}
${tile('/admin', 'Admin', 'Server status, API tokens for scripts and SDKs.')}
${tile('/docs/', 'Documentation', 'Runtime, training, wiki and the design specifications.')}
</div></main>`;
  return layout({title: 'ChatSOP', active: 'home', signedIn, body});
}
