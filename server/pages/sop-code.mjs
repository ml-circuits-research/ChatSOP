/** Shared SOP code rendering for the browser pages: lightweight syntax
 * highlighting that links every wire type and wire field to its help page.
 *
 *   @q query                 -> `query` links to /docs/wire_typs/query.html
 *     where parent ?x ?y     -> `where` links to /docs/wire_typs/query.html#field-where
 *
 * The known types and fields come from the parser contract (`SPEC` and, when
 * the parser exports it, `ONTOLOGY_SPEC` in sop/parser.mjs), never from a list
 * kept here. A type or field that the
 * contract does not know is not linked; it is marked "undocumented", which is
 * a visible hallucination signal in model-authored or generated SOP.
 *
 * The renderer is one self-contained function, so the same code runs on the
 * server (`renderSopHtml`) and in the browser (`sopCodeScript` defines
 * `window.ChatSopCode.render`). Pages add `SOP_CODE_STYLE` to their styles.
 */
import * as parser from '../../sop/parser.mjs';

/** `{type: [field, ...]}` from the parser contract: executable wires plus host ontology declarations. */
export const SOP_CONTRACT = Object.fromEntries(Object.entries({...(parser.ONTOLOGY_SPEC ?? {}), ...parser.SPEC}).map(([type, spec]) => [type, [...new Set([...(spec.one ?? []), ...(spec.many ?? [])])].sort()]));
export const SOP_DOCS_BASE = '/docs/wire_typs/';

/**
 * Builds the renderer. Must not reference module scope: it is serialised into
 * the browser script with `Function.prototype.toString`.
 * `render(source, {allowTypes})`: `allowTypes` lists extra types the caller
 * parses on purpose although the contract has no page for them; they are shown
 * neutrally, neither linked nor flagged.
 */
function createSopRenderer(contract, docsBase) {
  const BOOLEAN = new Set(['not', 'all', 'any', 'end']);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);
  const span = (cls, text, title) => '<span class="' + cls + '"' + (title ? ' title="' + escape(title) + '"' : '') + '>' + escape(text) + '</span>';
  const link = (cls, text, href, title) => '<a class="' + cls + '" href="' + escape(href) + '" target="_blank" rel="noopener" title="' + escape(title) + '">' + escape(text) + '</a>';
  const known = type => Object.prototype.hasOwnProperty.call(contract, type);
  const TOKEN = /("(?:\\.|[^"\\])*")|(#.*$)|(\$[A-Za-z][\w]*)|(\?[A-Za-z][\w]*)|(-?\b\d[\d.:TZ+-]*\b)|([A-Za-z_][\w:-]*)/g;

  /** Terms after a field keyword: strings, $refs, ?vars, numbers, boolean group words. */
  function terms(text) {
    let out = '';
    let last = 0;
    for (const match of text.matchAll(TOKEN)) {
      const [whole, string, comment, ref, variable, number, word] = match;
      out += escape(text.slice(last, match.index));
      if (string) out += span('sop-str', string);
      else if (comment) out += span('sop-com', comment);
      else if (ref) out += span('sop-ref', ref);
      else if (variable) out += span('sop-var', variable);
      else if (number) out += span('sop-num', number);
      else if (word && BOOLEAN.has(word)) out += span('sop-kw', word);
      else out += escape(whole);
      last = match.index + whole.length;
    }
    return out + escape(text.slice(last));
  }

  function typeHtml(type, allow) {
    if (known(type)) return link('sop-type', type, docsBase + encodeURIComponent(type) + '.html', 'wire type ' + type + ' (opens its documentation)');
    if (allow.has(type)) return span('sop-type', type);
    return span('sop-undoc', type, 'undocumented wire type: "' + type + '" is not in the SOP contract');
  }

  function fieldHtml(type, field, allow) {
    if (known(type)) {
      if (contract[type].includes(field)) return link('sop-field', field, docsBase + encodeURIComponent(type) + '.html#field-' + encodeURIComponent(field), type + '.' + field + ' (opens its documentation)');
      return span('sop-undoc', field, 'undocumented field: "' + field + '" is not a field of ' + type + ' in the SOP contract');
    }
    return span(allow.has(type) ? 'sop-kw' : 'sop-field-unknown', field);
  }

  return {
    contract,
    render(source, {allowTypes = []} = {}) {
      const allow = new Set(allowTypes);
      let type = null;
      let block = false;
      let group = 0;
      return String(source ?? '').replace(/\r\n/g, '\n').split('\n').map(line => {
        if (!line.trim()) return escape(line);
        if (line.trimStart().startsWith('#')) return span('sop-com', line);
        const header = line.match(/^@([A-Za-z][\w]*)(\s+)([A-Za-z][\w]*)?(.*)$/);
        if (header) {
          type = header[3] ?? null;
          block = false;
          group = 0;
          return span('sop-head', '@' + header[1]) + header[2] + (header[3] ? typeHtml(header[3], allow) : '') + terms(header[4]);
        }
        // A `|` block keeps its 4-space-indented lines verbatim.
        if (block && line.startsWith('    ')) return span('sop-block', line);
        block = false;
        // Inside an all/any condition group, lines are atoms or nested all/any/end.
        if (group > 0) {
          const word = line.trim();
          if (word === 'all' || word === 'any') group++;
          if (word === 'end') group--;
          return terms(line);
        }
        const field = line.match(/^( {2})([^\s]+)(.*)$/);
        if (field && type !== null) {
          const value = field[3].trim();
          block = value === '|';
          if (value === 'all' || value === 'any') group = 1;
          return field[1] + fieldHtml(type, field[2], allow) + terms(field[3]);
        }
        // Nested condition-group lines (all / any / end, atoms) and stray text.
        return terms(line);
      }).join('\n');
    },
  };
}

const renderer = createSopRenderer(SOP_CONTRACT, SOP_DOCS_BASE);

/** Server-side: highlighted, linked HTML for an SOP source (no surrounding <pre>). */
export const renderSopHtml = (source, options) => renderer.render(source, options);

/** Browser-side: defines `window.ChatSopCode = {contract, render(source, options)}`. */
export const sopCodeScript = `window.ChatSopCode=(${createSopRenderer})(${JSON.stringify(SOP_CONTRACT)},${JSON.stringify(SOP_DOCS_BASE)});`;

export const SOP_CODE_STYLE = `
.sop-head{color:#8250df;font-weight:600}
.sop-type,.sop-field{color:#0a7d6f;font-weight:600;text-decoration:underline dotted;text-underline-offset:3px}
.sop-field{color:#1f6f9f}
a.sop-type:hover,a.sop-field:hover{text-decoration-style:solid}
.sop-kw{color:#1f6f9f;font-weight:600}
.sop-field-unknown{font-weight:600}
.sop-ref{color:#b35900}
.sop-var{color:#b3261e}
.sop-str,.sop-block{color:#1d7f4e}
.sop-num{color:#6a5acd}
.sop-com{color:var(--muted,#667);font-style:italic}
.sop-undoc{color:#b3261e;font-weight:700;background:#b3261e1f;border-radius:3px;text-decoration:underline wavy #b3261e;text-underline-offset:3px;cursor:help}
.sop-undoc::after{content:" ⚠ undocumented";font-size:11px;font-weight:600;font-family:system-ui,sans-serif;text-decoration:none;display:inline-block;margin-left:2px}
@media (prefers-color-scheme:dark){.sop-head{color:#c297ff}.sop-type{color:#56d4c2}.sop-field,.sop-kw{color:#6cb6ff}.sop-ref{color:#ffab70}.sop-var{color:#ff8b80}.sop-str,.sop-block{color:#7ee2a8}.sop-num{color:#b4a7ff}.sop-undoc{color:#ff8b80;background:#ff8b8022;text-decoration-color:#ff8b80}}
`;

/** ES module served publicly at `/assets/sop-code.mjs` for the documentation
 * pages (docs/partials-loader.mjs): `render(source, options)`, `contract` and
 * `style`, built from the same renderer and parser contract as the server pages. */
export const sopCodeModule = `const renderer=(${createSopRenderer})(${JSON.stringify(SOP_CONTRACT)},${JSON.stringify(SOP_DOCS_BASE)});
export const render=(source,options)=>renderer.render(source,options);
export const contract=renderer.contract;
export const style=${JSON.stringify(SOP_CODE_STYLE)};
`;
