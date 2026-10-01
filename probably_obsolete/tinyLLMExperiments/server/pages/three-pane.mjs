/** Shared three-pane browser used by the corpus audit (`/audit`) and the
 * evaluation browser (`/eval`):
 *
 *   left    — a collapsible category tree with counts and a search box;
 *   middle  — a server-paginated list, keyboard navigable;
 *   right   — the selected item in full.
 *
 * This module owns the layout CSS, the page skeleton and a small browser kit
 * (`window.ChatSopPane`: escaping, key/value lists, SOP code blocks rendered
 * by server/pages/sop-code.mjs, a resizable divider, the mobile drawer and
 * keyboard navigation). Each page keeps its own API calls and detail view.
 */

export const THREE_PANE_STYLE = `
body{height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.site-header{flex:none}
.panes{flex:1;min-height:0;display:grid;grid-template-columns:var(--tree-w,270px) var(--list-w,380px) 6px minmax(0,1fr)}
.pane{min-height:0;overflow:auto;background:var(--panel)}
.pane.tree{border-right:1px solid var(--line);padding:10px 10px 30px}
.pane.list{display:flex;flex-direction:column;overflow:hidden}
.pane.detail{background:var(--bg);padding:14px 20px 60px}
.divider{cursor:col-resize;background:var(--line);opacity:.6}
.divider:hover,.divider.drag{background:var(--accent);opacity:1}

.search{display:flex;gap:6px;margin-bottom:8px}
.search input{flex:1;min-width:0}
.tree details{margin:0}
.tree summary{cursor:pointer;padding:3px 4px;border-radius:5px;list-style-position:outside;display:flex;align-items:center;gap:6px}
.tree summary::-webkit-details-marker{display:none}
.tree summary::before{content:'▸';width:1em;flex:none;color:var(--muted);font-size:12px}
.tree details[open]>summary::before{content:'▾'}
.tree summary:hover{background:var(--soft)}
.tree .corpus>summary{font-weight:600}
.tree .corpus.active>summary{background:var(--soft)}
.tree .group{margin-left:14px}
.tree .group>summary{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.03em}
.tree .values{margin:0 0 4px 30px;padding:0;list-style:none}
.tree .values button{all:unset;box-sizing:border-box;display:flex;width:100%;gap:6px;padding:2px 6px;border-radius:5px;cursor:pointer;font-size:14px}
.tree .values button:hover{background:var(--soft)}
.tree .values button.on{background:var(--accent);color:var(--accent-text)}
.tree .values .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree h4.section{margin:14px 4px 4px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.count{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;margin-left:auto}
.on .count{color:inherit}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.chip{font-size:12px;padding:1px 8px;border-radius:10px;background:var(--soft);border:1px solid var(--line);cursor:pointer}

.listhead{flex:none;padding:8px 10px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:13px}
.listhead .total{flex:1;color:var(--muted)}
.listhead button{padding:3px 9px;font-size:13px}
.listhead input{width:4.2em;padding:3px 5px;font-size:13px}
.cases{flex:1;overflow:auto;list-style:none;margin:0;padding:0}
.cases li{padding:6px 10px;border-bottom:1px solid var(--line);cursor:pointer}
.cases li:hover{background:var(--soft)}
.cases li.sel{background:var(--soft);box-shadow:inset 3px 0 0 var(--accent)}
.cases .cid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.cases .cid b{font-weight:600;margin-right:auto;word-break:break-all}
.cases .msg{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
.badge{font-size:11px;padding:0 6px;border-radius:8px;background:var(--soft);border:1px solid var(--line);white-space:nowrap;font-family:system-ui,sans-serif}
.badge.good{background:var(--ok);border-color:var(--ok);color:var(--accent-text)}
.badge.error,.badge.fail{background:var(--bad);border-color:var(--bad);color:var(--accent-text)}
.badge.warning,.badge.historical{background:#c77d12;border-color:#c77d12;color:#fff}

.detail h2{margin:0 0 4px;font-size:1.25rem;word-break:break-all}
.detail h3{font-size:1rem;margin:0 0 8px}
.detail h4{margin:12px 0 4px;font-size:.95rem}
.detail section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 12px}
.kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 14px;margin:0;font-size:14px}
.kv dt{color:var(--muted)}
.kv dd{margin:0;word-break:break-word}
.message{white-space:pre-wrap;word-break:break-word;font-size:15px;margin:4px 0 10px;padding:8px 10px;background:var(--soft);border-radius:6px}
.rowhead{font-size:12px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
table.small{border-collapse:collapse;width:100%;font-size:13px}
table.small td,table.small th{border-bottom:1px solid var(--line);padding:3px 6px;text-align:left;vertical-align:top}
.tablewrap{overflow-x:auto}
.code{position:relative}
.code pre{max-height:none;margin:0;white-space:pre;font-size:13px;line-height:1.5}
.code .copy{position:absolute;top:6px;right:6px;padding:2px 9px;font-size:12px}
.match{font-weight:600}
.match.ok{color:var(--ok)}.match.bad{color:var(--bad)}
details.fold>summary{cursor:pointer;font-weight:600}
.empty{color:var(--muted);padding:30px 10px;text-align:center}
.drawer-toggle,.scrim{display:none}
kbd{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 4px;background:var(--soft)}

@media (max-width:900px){
  body{height:auto;overflow:auto}
  .panes{display:block}
  .pane.tree{border-right:0;border-bottom:1px solid var(--line);max-height:40vh}
  .divider{display:none}
  .pane.detail{padding:10px 10px 40px}
  .drawer-toggle{display:inline-block;position:fixed;right:12px;bottom:12px;z-index:20;box-shadow:0 2px 8px #0004}
  .pane.list{position:fixed;top:0;bottom:0;left:0;width:min(92vw,420px);z-index:30;transform:translateX(-105%);transition:transform .2s;box-shadow:2px 0 14px #0005}
  .panes.drawer .pane.list{transform:none}
  .scrim{display:none}
  .panes.drawer .scrim{display:block;position:fixed;inset:0;background:#0005;z-index:25}
}
`;

/** The page skeleton; the element ids are the contract of the browser kit and of each page's client. */
export const threePaneBody = ({search = 'Search', treeLabel = 'Categories', listLabel = 'Items', drawer = 'List', treeLoading = 'loading…'} = {}) => `<div class="panes" id="panes">
  <aside class="pane tree" aria-label="${treeLabel}">
    <div class="search"><input id="search" type="search" placeholder="${search}  ( / )" aria-label="${search}"></div>
    <div id="tree"><p class="muted">${treeLoading}</p></div>
  </aside>
  <section class="pane list" id="list" aria-label="${listLabel}">
    <div class="listhead" id="listhead"></div>
    <ul class="cases" id="cases" role="listbox" aria-label="${listLabel}"></ul>
  </section>
  <div class="divider" id="divider" role="separator" aria-orientation="vertical" title="drag to resize"></div>
  <main class="pane detail" id="detail" aria-live="polite"></main>
  <div class="scrim" id="scrim"></div>
  <button type="button" class="drawer-toggle primary" id="drawer">${drawer}</button>
</div>`;

/** Browser kit. Runs as `(${paneKit})()`; it must not close over module scope. */
function paneKit() {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);
  const json = value => JSON.stringify(value, null, 2);
  const kv = pairs => '<dl class="kv">' + pairs.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => '<dt>' + esc(key) + '</dt><dd>' + value + '</dd>').join('') + '</dl>';
  /** Objects as compact `key value` pairs; nested values stay JSON. */
  const inline = value => {
    if (!value || typeof value !== 'object') return esc(value);
    return Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '')
      .map(([key, item]) => '<span class="muted">' + esc(key) + '</span> ' + (typeof item === 'object' ? '<code>' + esc(JSON.stringify(item)) + '</code>' : esc(item)))
      .join(' <span class="muted">·</span> ') || '<span class="muted">—</span>';
  };
  /** Linked, highlighted SOP from the shared renderer (server/pages/sop-code.mjs). */
  const codeBlock = (source, name, options) => '<div class="code"><button type="button" class="copy" data-copy="' + esc(name) + '">copy</button><pre><code>' + window.ChatSopCode.render(source, options) + '</code></pre></div>';

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text ?? '');
    } catch {
      const area = document.createElement('textarea');
      area.value = text ?? '';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    button.textContent = 'copied';
    setTimeout(() => { button.textContent = 'copy'; }, 1200);
  }

  /** Drag the list/detail divider; the width is remembered per browser under `storageKey`. */
  function bindDivider(storageKey) {
    const root = $('panes');
    const divider = $('divider');
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) root.style.setProperty('--list-w', saved);
    } catch { /* storage unavailable */ }
    divider.addEventListener('pointerdown', event => {
      event.preventDefault();
      divider.setPointerCapture(event.pointerId);
      divider.classList.add('drag');
      const left = $('list').getBoundingClientRect().left;
      const onMove = moveEvent => {
        const width = Math.min(Math.max(240, moveEvent.clientX - left), window.innerWidth - left - 320);
        root.style.setProperty('--list-w', width + 'px');
      };
      const onUp = () => {
        divider.classList.remove('drag');
        divider.removeEventListener('pointermove', onMove);
        divider.removeEventListener('pointerup', onUp);
        try {
          localStorage.setItem(storageKey, root.style.getPropertyValue('--list-w'));
        } catch { /* storage unavailable */ }
      };
      divider.addEventListener('pointermove', onMove);
      divider.addEventListener('pointerup', onUp);
    });
  }

  function bindDrawer() {
    $('drawer').addEventListener('click', () => $('panes').classList.toggle('drawer'));
    $('scrim').addEventListener('click', () => $('panes').classList.remove('drawer'));
  }
  const closeDrawer = () => $('panes').classList.remove('drawer');

  /** Page-level keys (ignored while typing): `actions` maps a key name to a function. */
  function bindKeys(actions) {
    document.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
      if (typing) {
        if (event.key === 'Escape') document.activeElement.blur();
        return;
      }
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    });
  }

  /** Marks the selected list item and keeps it in view. */
  function markSelected(id) {
    for (const li of $('cases').querySelectorAll('li[data-id]')) {
      const on = li.dataset.id === id;
      li.classList.toggle('sel', on);
      if (on) {
        li.setAttribute('aria-selected', 'true');
        li.scrollIntoView({block: 'nearest'});
      } else li.removeAttribute('aria-selected');
    }
  }

  /** The list header: total, range and page controls (`data-page` prev/next, `#pagejump`). */
  const listHead = (list, noun) => {
    const first = list.total ? list.offset + 1 : 0;
    const last = Math.min(list.offset + list.limit, list.total);
    return '<span class="total"><b>' + list.total.toLocaleString() + '</b> ' + noun + ' · ' + first + '–' + last + '</span>' +
      '<button type="button" data-page="prev"' + (list.page <= 1 ? ' disabled' : '') + ' title="previous page (PageUp)">‹</button>' +
      '<label style="margin:0;font-weight:400">page <input id="pagejump" type="number" min="1" max="' + list.pages + '" value="' + list.page + '"> / ' + list.pages + '</label>' +
      '<button type="button" data-page="next"' + (list.page >= list.pages ? ' disabled' : '') + ' title="next page (PageDown)">›</button>';
  };

  window.ChatSopPane = {$, esc, json, kv, inline, codeBlock, copyText, bindDivider, bindDrawer, closeDrawer, bindKeys, markSelected, listHead};
}

export const paneKitScript = `(${paneKit})();`;
