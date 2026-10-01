/**
 * Generator of docs/architecture.html (`node tools/docs/build-architecture.mjs`). Every file:line is resolved from the working tree when it runs:
 * a citation is a `<code class="cite" data-re="...">file:line</code>` whose line is the first match of the stated pattern, a statement of the page that
 * the code must support is a `claim`, and `buildArchitecture()` returns the problems of the run (a pattern that no longer matches, a failed claim),
 * so the page can only state what the code showed at generation time. `tests/architecture-page.test.mjs` re-checks every citation of the committed page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS } from './architecture/css.mjs';
import * as D from './architecture/diagrams.mjs';
import { warnings } from './architecture/svg.mjs';
import { esc } from './architecture/svg.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** Builds the page from the working tree: `{html, problems, citations, reachable, total}`. */
export function buildArchitecture() {
  warnings.length = 0;
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const exists = f => fs.existsSync(path.join(ROOT, f));
  const problems = [];

  /** Citations of the page: every `E` call outside the sections that other agents are still changing. */
  const citations = [];
  /** file:line of the first line of `file` matching `re`, kept as a checkable `<code class="cite">`; `live` leaves it out of the test. */
  function E(file, re, live = false) {
    if (!exists(file)) { problems.push('missing file ' + file); return `<code>${esc(file)}:?</code>`; }
    const lines = read(file).split('\n');
    const i = lines.findIndex(l => re.test(l));
    if (i < 0) { problems.push(`no match ${re} in ${file}`); return `<code>${esc(file)}:?</code>`; }
    if (live) return `<code>${esc(file)}:${i + 1}</code>`;
    citations.push({ file, line: i + 1, re: re.source });
    return `<code class="cite" data-re="${esc(re.source).replace(/"/g, '&quot;')}">${esc(file)}:${i + 1}</code>`;
  }
  const code = s => `<code>${esc(s)}</code>`;
  const P = f => { if (!exists(f.replace(/\/$/, ''))) problems.push('missing path ' + f); return code(f); };
  const Ps = list => list.map(P).join(', ');

  // ------------------------------------------------------------ reachability from the product entry points (static + dynamic imports)
  const ENTRIES = ['tools/serve-local.mjs', 'server/http.mjs', 'server/cli.mjs', 'lib/symbolic-lm/serve.mjs'];
  const seen = new Set();
  const resolveImport = (f, spec) => { let t = path.resolve(path.dirname(f), spec); try { if (fs.statSync(t).isDirectory()) t = path.join(t, 'index.mjs'); } catch { return null; } return fs.existsSync(t) ? t : null; };
  const visit = f => {
    if (seen.has(f)) return; seen.add(f);
    let src; try { src = fs.readFileSync(f, 'utf8'); } catch { return; }
    const re = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g; let m;
    while ((m = re.exec(src))) { const t = resolveImport(f, m[1]); if (t && t.endsWith('.mjs')) visit(t); }
  };
  ENTRIES.forEach(e => visit(path.join(ROOT, e)));
  const allProduct = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (['vendor', 'node_modules'].includes(e.name)) continue; walk(p); } else if (p.endsWith('.mjs')) allProduct.push(p); } };
  ['lib', 'sop', 'memory', 'reasoning', 'server'].forEach(d => walk(path.join(ROOT, d)));
  const rel = f => path.relative(ROOT, f);
  const reachable = allProduct.filter(f => seen.has(f)), unreachable = allProduct.filter(f => !seen.has(f));
  const outsideReach = [...seen].map(rel).filter(f => !/^(lib|sop|memory|reasoning|server)\//.test(f));
  const groupCount = list => { const g = {}; for (const f of list) { const r = rel(f).split('/'); const k = r[0] === 'reasoning' && r[1] === 'strategies' ? r.slice(0, 3).join('/') : r.slice(0, 2).join('/').replace(/\.mjs$/, ''); g[k] = (g[k] ?? 0) + 1; } return g; };
  const unreachableGroups = Object.entries(groupCount(unreachable)).sort();
  const isReach = f => seen.has(path.join(ROOT, f));

  // ------------------------------------------------------------ module-level layering of the product (cycles and links to eval/ and tools/)
  const importsOf = f => {
    let src; try { src = fs.readFileSync(f, 'utf8'); } catch { return []; }
    const re = /(?:from\s+|(import)\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g; const out = []; let m;
    while ((m = re.exec(src))) { const t = resolveImport(f, m[2]); if (t && t.endsWith('.mjs')) out.push({ to: t, dynamic: Boolean(m[1]) }); }
    return out;
  };
  const insideProduct = f => /^(lib|sop|memory|reasoning|server)\//.test(rel(f));
  const moduleCycles = (() => {
    const index = new Map(), low = new Map(), stack = [], on = new Set(), found = []; let n = 0;
    const strong = v => {
      index.set(v, n); low.set(v, n); n++; stack.push(v); on.add(v);
      for (const { to } of importsOf(v)) {
        if (!seen.has(to)) continue;
        if (!index.has(to)) { strong(to); low.set(v, Math.min(low.get(v), low.get(to))); } else if (on.has(to)) low.set(v, Math.min(low.get(v), index.get(to)));
      }
      if (low.get(v) === index.get(v)) { const group = []; let w; do { w = stack.pop(); on.delete(w); group.push(rel(w)); } while (w !== v); if (group.length > 1) found.push(group); }
    };
    for (const v of seen) if (!index.has(v)) strong(v);
    return found;
  })();
  const productLinksOut = [...seen].filter(insideProduct).flatMap(f => importsOf(f).filter(e => !insideProduct(e.to)).map(e => ({ from: rel(f), to: rel(e.to), dynamic: e.dynamic })));

  // ------------------------------------------------------------ component-level import graph
  const comp = f => {
    const r = rel(f).split('/');
    if (r[0] === 'lib') return r.slice(0, 2).join('/').replace(/\.mjs$/, '');
    if (r[0] === 'reasoning' && r[1] === 'strategies') return r.slice(0, 3).join('/');
    if (['server', 'memory', 'reasoning'].includes(r[0]) && r.length > 2 && r[1] !== 'pages') return r.slice(0, 2).join('/');
    if (r[0] === 'sop' && r[1] === 'knowledge') return 'sop/knowledge';
    if (r[0] === 'server') return r[1] === 'pages' ? 'server/pages' : r.slice(0, 2).join('/').replace(/\.mjs$/, '');
    if (r[0] === 'sop') return 'sop';
    return r[0] === 'memory' || r[0] === 'reasoning' ? r[0] : r.slice(0, 2).join('/').replace(/\.mjs$/, '');
  };
  const edges = new Map();
  for (const f of reachable) {
    const src = fs.readFileSync(f, 'utf8'); const re = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g; let m;
    while ((m = re.exec(src))) { const t = resolveImport(f, m[1]); if (!t || !t.endsWith('.mjs')) continue; const a = comp(f), b = comp(t); if (a !== b) { if (!edges.has(a)) edges.set(a, new Set()); edges.get(a).add(b); } }
  }
  const graphRows = [...edges.entries()].sort().map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td>${[...b].sort().map(x => `<code>${esc(x)}</code>`).join(' ')}</td></tr>`).join('');

  // ------------------------------------------------------------ claims that must hold (build fails otherwise)
  const claim = (ok, text) => { if (!ok) problems.push('claim failed: ' + text); };
  const has = (file, re) => exists(file) && re.test(read(file));
  claim(has('lib/chat-data/memories.mjs', /STRATEGIES = Object\.freeze\(\['sqlite'\]\)/), 'product strategies are sqlite only');
  claim(has('server/formalizers.mjs', /CAPABILITIES = Object\.freeze\(\['formalize', 'proofread', 'proofread-symbolic', 'translate-clean'\]\)/), 'registry capabilities');
  claim(has('server/server-models.mjs', /CHAT_PIPELINE = Object\.freeze\(\['symbolic-lm', 'language-proofing-llm', 'translator-llm', 'symbolic-proofing-llm'\]\)/), 'chat pipeline models');
  claim(has('reasoning/registry.mjs', /EXTERNAL_STRATEGIES=\{'prolog-tabling':'prolog','z3-smt-bounded':'z3'\}/), 'external strategies');
  claim(has('reasoning/registry.mjs', /ROUTE_IDS=\['reference','js-reference','js-oracle'\]/), 'route ids');
  claim(has('sop/declarative.mjs', /MODEL_TYPES=Object\.freeze\(new Set\(\['stated','assumed','unclear','query','constraint','unparsed'\]\)\)/), 'model types');
  claim(has('config/formalizers.json', /"default": "symbolic-lm"/), 'default formalizer');
  claim(has('config/runtime.json', /"engine": "sqlite"/), 'runtime engine sqlite');
  claim(has('config/runtime.json', /"mode": "none"/), 'retention none');
  claim(has('lib/chat-data/index.mjs', /tmpTtlHours: 24, sessionTtlDays: 14/), 'ttls');
  claim(has('lib/omp/run.mjs', /read,write,edit|'read,write,edit'|read, write, edit/), 'omp tools');
  claim(ENTRIES.every(e => exists(e)), 'entry points exist');
  { const reg = JSON.parse(read('config/formalizers.json')); const f = reg.models.filter(m => m.capabilities.includes('formalize')); claim(f.length === 1 && f[0].id === 'symbolic-lm', 'exactly one formalize entry'); }
  claim(!/rewrite/.test(read('server/agent.mjs')), 'agent has no rewrite step');
  claim(has('lib/chat-data/sessions.mjs', /ingestFacts\(this\.repository\(id\)/), 'acceptDraft ingests facts');
  claim(!has('server/http.mjs', /chat-modes|promptProfile|plainTurn/), 'modes removed from http.mjs');
  claim(moduleCycles.length === 0, 'the product import graph has no module cycle: ' + JSON.stringify(moduleCycles));
  claim(productLinksOut.every(e => e.dynamic), 'a product module imports eval/ or tools/ statically: ' + JSON.stringify(productLinksOut.filter(e => !e.dynamic)));
  claim(JSON.stringify(productLinksOut.map(e => `${e.from} ${e.to}`).sort()) === JSON.stringify(['server/audit-datasets.mjs tools/datasets/three-datasets/sources.mjs', 'server/eval-browser.mjs eval/run.mjs']), 'the only product links to eval/ and tools/ are the two lazy imports of the owner pages: ' + JSON.stringify(productLinksOut));
  claim(!exists('server/prompts'), 'server/prompts is gone');
  claim(!has('server/http.mjs', /rewrite:false/), 'no dead rewrite option in http.mjs');
  claim(!has('server/product.mjs', /'exact'/) && !has('lib/chat-data/memories.mjs', /exact: Boolean/), 'the exact flag is not part of the product memory API');
  claim(!has('TODO.md', /LanguageTool is an operator-started dependency/), 'TODO no longer lists LanguageTool');
  claim(has('reasoning/bridge/solve.mjs', /if \(backend === 'auto'\) backend = 'js';  \/\/ never chosen by problem size/), 'constraint auto is the JS oracle');

  // ------------------------------------------------------------ journal status of the concurrent agents
  const journal = read('status/journal.jsonl').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const lastOf = actor => { const ev = journal.filter(e => e.actor === actor); return ev.at(-1) ?? null; };
  const doneOf = actor => journal.filter(e => e.actor === actor && e.state === 'done').at(-1) ?? null;
  const agentLine = actor => { const l = lastOf(actor), d = doneOf(actor); return l ? `journal: last event ${l.state} at ${l.ts.slice(11, 16)}Z ("${esc(l.title.slice(0, 90))}")${d ? '; done reported at ' + d.ts.slice(11, 16) + 'Z' : '; no done event yet'}` : 'no journal event'; };
  const sliceWired = /from '\.\/slice\/index\.mjs'/.test(read('reasoning/linker.mjs'));
  const sliceDone = Boolean(doneOf('slice-path-agent'));

  // ------------------------------------------------------------ diagrams
  const dg = { a: D.diagramA(), b: D.diagramB(), c: D.diagramC(), d: D.diagramD(), e: D.diagramE(), f: D.diagramF() };
  const svg = k => dg[k].render();
  if (warnings.length) problems.push('svg text overflow estimates:\n' + warnings.join('\n'));

  // ------------------------------------------------------------ cards
  const card = (name, purpose, rows) => `<article class="card" id="c-${esc(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}"><h3>${esc(name)}</h3><p>${purpose}</p><dl>` +
    rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('') + `</dl></article>`;
  const cards = [
    card('Server', 'The one Node process: static documentation, browser pages, the OpenAI-style chat facade, the capability and product APIs, and the owner pages. It authenticates every request before any route that needs a user.', [
      ['Modules', Ps(['server/http.mjs', 'server/auth.mjs', 'server/web.mjs', 'server/api.mjs', 'server/product.mjs', 'server/authoring.mjs', 'server/language.mjs', 'server/pages/'])],
      ['Entry points', `${code('npm start')} runs ${code('tools/serve-local.mjs')}, which calls ${code('startServer')} (${E('server/http.mjs', /export async function startServer/)}); ${code('createServer')} (${E('server/http.mjs', /export function createServer/)}) is what tests build.`],
      ['Configuration', `${code('config/runtime.json')} (root, memory, policy, chatData, omp), ${code('state/auth.json')}, environment ${code('CHATSOP_HOST')}, ${code('CHATSOP_PORT')}, ${code('CHATSOP_CONFIG')}, ${code('CHATSOP_API_KEY')}.`],
      ['Tests', Ps(['tests/server-http.test.mjs', 'tests/auth-server.test.mjs', 'tests/site-links.test.mjs', 'tests/product-api-docs.test.mjs'])],
      ['Specifications', 'DS012, DS030, DS031'],
    ]),
    card('ModelManager', 'Registry of the models the product uses and the on-demand processes behind them: it starts a CPU llama-server (or the SymbolicLM service) on a free loopback port, probes it, idles it and evicts the least recently used one when the count or memory budget is reached.', [
      ['Modules', Ps(['server/formalizers.mjs', 'server/server-models.mjs'])],
      ['Entry points', `${code('loadRegistry')} (${E('server/formalizers.mjs', /export function loadRegistry/)}), ${code('ModelManager')} (${E('server/formalizers.mjs', /export class ModelManager/)}), ${code('createServerModels')} (${E('server/server-models.mjs', /export function createServerModels/)}).`],
      ['Configuration', Ps(['config/formalizers.json', 'config/server-models.json']) + '; the chat pipeline is symbolic-lm, language-proofing-llm, translator-llm and symbolic-proofing-llm (all keep_open by default).'],
      ['Tests', Ps(['tests/formalizers.test.mjs', 'tests/model-lifecycle.test.mjs'])],
      ['Specifications', 'DS012 "Formalizer models", "Model lifecycle"'],
    ]),
    card('Capability APIs', 'Each capability has its own endpoint, cache and version stamp: proofread (textToCleanEnglish), understand, symbolic rewrite and analyze, emotion detect. The chat turn calls the same functions, so what the page already asked for is reused.', [
      ['Modules', Ps(['server/capabilities.mjs', 'server/api.mjs', 'lib/cache/lru.mjs', 'lib/llama-chat.mjs'])],
      ['Entry points', `${code('createCapabilities')} (${E('server/capabilities.mjs', /export function createCapabilities/)}); routes listed in ${code('API_ENDPOINTS')} (${E('server/api.mjs', /API_ENDPOINTS/)}).`],
      ['Configuration', 'none of its own; cache sizes come from the server limits; model choice from the registry'],
      ['Tests', Ps(['tests/capability-api.test.mjs', 'tests/cache-lru.test.mjs', 'tests/chat-understanding.test.mjs'])],
      ['Specifications', 'DS030, DS012 "Understanding in the chat"'],
    ]),
    card('textToCleanEnglish', 'The chat step, validated by the user, that turns Romanian, mixed or badly written text into acceptable English before anything is formalized. A cheap in-process gate skips clean English; flagged sentences go one by one to a model.', [
      ['Modules', Ps(['lib/text-to-clean-english/', 'lib/sentence-split.mjs'])],
      ['Entry points', `${code('textToCleanEnglish')} (${E('lib/text-to-clean-english/index.mjs', /export async function textToCleanEnglish/)}); reached through ${code('capabilities.proofread')} (${E('server/capabilities.mjs', /async function proofread/)}).`],
      ['Configuration', `${code('config/text-to-clean-english.json')}: English sentences use the ${code('llm')} backend (LanguageProofingLLM), Romanian and mixed use ${code('translator-llm')} with ${code('llm')} as the reported fallback.`],
      ['Tests', Ps(['tests/text-to-clean-english.test.mjs', 'tests/sentence-split.test.mjs'])],
      ['Specifications', 'DS012, DS021 "textToCleanEnglish"'],
    ]),
    card('LanguagesUtil', 'Per-token language identification and matrix-language detection, and a conservative symbolic spelling corrector. It knows nothing about UD, SOP or translation.', [
      ['Modules', Ps(['lib/languages-util/'])],
      ['Entry points', `${code('identify')}, ${code('loadSpellfix')}, ${code('detectFrame')} (${E('lib/languages-util/index.mjs', /export \{identify/)}). Called by SymbolicLM, TranslatorService and the cleaning gate.`],
      ['Configuration', `word lists under ${code('vendor/spellfix/')} (git-ignored data); spelling correction is off by default in SymbolicLM.`],
      ['Tests', Ps(['tests/symbolic-lm.test.mjs', 'tests/text-to-clean-english.test.mjs', 'tests/analysis-cnl.test.mjs'])],
      ['Specifications', 'DS021 "LanguagesUtil"'],
    ]),
    card('TranslatorService', 'Translation backends toward English that SymbolicLM calls on its translate route. Only the deterministic dictionary-and-rules backend and the gloss variant are registered.', [
      ['Modules', Ps(['lib/translator-service/index.mjs', 'lib/translator-service/backends/symbolic.mjs', 'lib/translator-service/backends/gloss.mjs', 'lib/translator-service/backends/english.mjs'])],
      ['Entry points', `${code('BACKENDS')} (${E('lib/translator-service/index.mjs', /export const BACKENDS/)}), ${code('translateParse')}.`],
      ['Configuration', `the reviewed dictionary ${code('config/dictionary/')} (read through ${code('sop/dictionary.mjs')})`],
      ['Tests', Ps(['tests/translator-service.test.mjs', 'tests/translator-gloss.test.mjs'])],
      ['Specifications', 'DS021 "TranslatorService"'],
    ]),
    card('SymbolicLM', 'The only formalizer. It reads the message alone: Stanza grammatical analysis (accurate package) plus the UD-to-SOP rules, an uncertainty signal and an optional gated SymbolicProofingLLM rewrite. It uses language data, never knowledge.', [
      ['Modules', Ps(['lib/symbolic-lm/', 'lib/ud-to-sop/', 'training/python/ud_parse_worker.py'])],
      ['Entry points', `service ${E('lib/symbolic-lm/serve.mjs', /export function runServe|export async function runServe|function runServe/)} (started by ModelManager as the registry entry ${code('symbolic-lm')}); library ${code('SymbolicLM.analyze')} (${E('lib/symbolic-lm/index.mjs', /async analyze\(/)}); command line ${code('tools/symbolic-lm.mjs')}.`],
      ['Configuration', `${code('config/symbolic-lm.json')} (Stanza package, uncertainty), the ${code('rewrite')} block of the registry entry (mode gated), environment ${code('CHATSOP_STANZA_PACKAGE')}.`],
      ['Tests', Ps(['tests/symbolic-lm.test.mjs', 'tests/ud-to-sop.test.mjs', 'tests/symbolic-lm-rewrite-gate.test.mjs', 'tests/symbolic-regression.test.mjs'])],
      ['Specifications', 'DS021 "SymbolicLM", "Uncertainty and the rewrite hook"'],
    ]),
    card('LanguageProofingLLM, SymbolicProofingLLM, translator-llm', 'Three CPU model processes that never see knowledge. LanguageProofingLLM and translator-llm serve textToCleanEnglish; SymbolicProofingLLM rewrites correct English into the limited English SymbolicLM understands, only through the gated rewrite.', [
      ['Modules', `served by ${code('server/formalizers.mjs')}; client ${code('lib/llama-chat.mjs')}; backends ${Ps(['lib/text-to-clean-english/backends/llm.mjs', 'lib/text-to-clean-english/backends/translator.mjs'])}; gate ${P('lib/symbolic-lm/rewrite-gate.mjs')}.`],
      ['Entry points', `registry ids ${code('language-proofing-llm')}, ${code('symbolic-proofing-llm')}, ${code('translator-llm')} in ${P('config/formalizers.json')} (GGUF files under the git-ignored ${code('models/')}).`],
      ['Configuration', `lifecycle in ${P('config/server-models.json')}; rewrite mode (off, gated, always) is a chat setting whose default is the registry entry.`],
      ['Tests', Ps(['tests/symbolic-lm-rewrite-gate.test.mjs', 'tests/symbolic-proofing-units.test.mjs'])],
      ['Specifications', 'DS021 "Names, roles and datasets"'],
    ]),
    card('EmotionDetectionSystem', 'Advisory pragmatic signals (greeting, thanks, apology, urgency, ...) from a symbolic strategy. A message that is only a courtesy gets a short reply without computation; signals never become evidence.', [
      ['Modules', Ps(['lib/emotion-detection/'])],
      ['Entry points', `${code('createDefaultEmotionDetectionSystem')} (${E('lib/emotion-detection/index.mjs', /export function createDefaultEmotionDetectionSystem/)}); ${code('adviceFor')} and ${code('courtesyReply')} in the Agent.`],
      ['Configuration', P('config/emotion-detection.json') + ' (only the symbolic strategy remains)'],
      ['Tests', P('tests/emotion-detection.test.mjs')],
      ['Specifications', 'DS029'],
    ]),
    card('Agent (one chat turn)', 'Runs one turn: asks the formalizer for SOP, handles courtesy-only messages, runs the declarative pipeline in the session runtime, and keeps the asserted statements as caller-owned conversation context.', [
      ['Modules', Ps(['server/agent.mjs', 'server/session-store.mjs', 'server/session-runtime.mjs', 'server/language.mjs'])],
      ['Entry points', `${code('Agent.turn')} (${E('server/agent.mjs', /async turn\(/)}); sessions are opened by ${code('SessionRuntimes.open')} (${E('server/session-runtime.mjs', /^  open\(/)}).`],
      ['Configuration', `${code('config.policy')} from ${code('config/runtime.json')}; answer language from the API ${code('language')} field.`],
      ['Tests', Ps(['tests/agent.test.mjs', 'tests/declarative-runtime.test.mjs', 'tests/stated-assumed.test.mjs'])],
      ['Specifications', 'DS003, DS021, DS012'],
    ]),
    card('DeclarativeCompiler and KnowledgeLinker', 'Turns the model language into an inspectable execution circuit: admits the wires, repairs unparsed spans, translates content words with the reviewed dictionary, and links relation phrases and entity strings to the predicates, lexemes and entities of the session lexicon. It asks one precise question instead of guessing.', [
      ['Modules', Ps(['sop/declarative.mjs', 'sop/clauses.mjs', 'sop/propositions.mjs', 'sop/unclear.mjs', 'sop/repair.mjs', 'sop/linking.mjs', 'sop/copula-linker.mjs', 'sop/lexicon.mjs', 'sop/relation-lexicon.mjs', 'sop/dictionary.mjs'])],
      ['Entry points', `${code('runDeclarative')} (${E('sop/declarative.mjs', /export async function runDeclarative/)}), ${code('compileDeclarative')} (${E('sop/declarative.mjs', /export function compileDeclarative/)}), ${code('Lexicon.fromCircuits')} (${E('sop/lexicon.mjs', /static fromCircuits|fromCircuits\(/)}).`],
      ['Configuration', `${P('config/dictionary/')}, ${P('config/relation-lexicon.json')}; the lexicon itself is knowledge in the base memory (circuits).`],
      ['Tests', Ps(['tests/lexicon.test.mjs', 'tests/linker.test.mjs', 'tests/linking-report.test.mjs', 'tests/knowledge-linker-copula.test.mjs', 'tests/clause-links.test.mjs', 'tests/dictionary.test.mjs'])],
      ['Specifications', 'DS021 "KnowledgeLinker", DS004 "Lexicon wires"'],
    ]),
    card('Runtime and the SOP language', 'Parses typed wires, schedules a circuit by dependencies, expands solve into link, reason and binding, applies the write policy, and renders with the controlled-language renderer. A model-origin wire can only be compiled, never run directly.', [
      ['Modules', Ps(['sop/runtime.mjs', 'sop/parser.mjs', 'sop/lower.mjs', 'sop/expression.mjs', 'sop/conditions.mjs', 'sop/outputs.mjs', 'sop/cnl.mjs', 'sop/enums.mjs', 'sop/contracts/wires.json'])],
      ['Entry points', `${code('Runtime.run')} (${E('sop/runtime.mjs', /async run\(source/)}), ${code('DEFAULT_POLICY')} (${E('sop/runtime.mjs', /export const DEFAULT_POLICY/)}); command line ${code('server/cli.mjs run|validate|chat')}.`],
      ['Configuration', `${code('policy')} block of ${P('config/runtime.json')}`],
      ['Tests', Ps(['tests/parser.test.mjs', 'tests/runtime.test.mjs', 'tests/expression.test.mjs', 'tests/outputs.test.mjs', 'tests/wire-help.test.mjs'])],
      ['Specifications', 'DS004, DS003'],
    ]),
    card('Knowledge validator', 'The single grammar and validator of the knowledge wires (predicate, lexeme, entity, fact, rule, default, integrity, aggregate, action, method, norm, procedure). Every circuit that becomes knowledge passes it.', [
      ['Modules', Ps(['sop/knowledge/'])],
      ['Entry points', `${code('parse')}, ${code('validateProgram')}, ${code('wireText')} (${E('sop/knowledge/index.mjs', /export \{validateWires, validateProgram\}/)}); used by base memories, the authoring loop and the oracle.`],
      ['Configuration', `contract tables ${P('sop/contracts/wires.json')}`],
      ['Tests', Ps(['tests/knowledge-grammar.test.mjs', 'tests/knowledge-docs.test.mjs', 'tests/wire-help.test.mjs'])],
      ['Specifications', 'DS004 "Knowledge wires"'],
    ]),
    card('Memory (Repository)', 'Copy-on-write, bitemporal repository of admitted claims and approved definitions. Layers are sharded generations over one bank engine; snapshots and shards are content-addressed; retention and garbage collection are explicit.', [
      ['Modules', Ps(['memory/repository.mjs', 'memory/sharded.mjs', 'memory/temporal.mjs', 'memory/strategies.mjs', 'memory/factory.mjs', 'memory/banks/sqlite.mjs'])],
      ['Entry points', `${code('Repository')} (${E('memory/repository.mjs', /export class Repository/)}); retrieval ${code('StrategyRegistry.retrieve')} (${E('memory/strategies.mjs', /retrieve\(name,request\)/)}).`],
      ['Configuration', `${code('memory')} block of ${P('config/runtime.json')} (engine sqlite, retention, sharding)`],
      ['Tests', Ps(['tests/repository.test.mjs', 'tests/shards.test.mjs', 'tests/memory-engines.test.mjs', 'tests/temporal.test.mjs', 'tests/memory-isolation.test.mjs'])],
      ['Specifications', 'DS005, DS025, DS028'],
    ]),
    card('Chat data (base memories and sessions)', 'The gitignored root that holds everything a chat produces: seeds become base memories, a session clones its base by hard links, accepted drafts become session circuits, and a commit forks the base. Also compiles and caches the lexicons.', [
      ['Modules', Ps(['lib/chat-data/', 'lib/knowledge-seeds.mjs', 'config/knowledge/'])],
      ['Entry points', `${code('BaseMemories')} (${E('lib/chat-data/memories.mjs', /export class BaseMemories/)}), ${code('Sessions')} (${E('lib/chat-data/sessions.mjs', /export class Sessions/)}), ${code('LexiconCache')} (${E('lib/chat-data/lexicons.mjs', /export class LexiconCache/)}); routes in ${P('server/product.mjs')}; maintenance ${P('tools/chat-data.mjs')}.`],
      ['Configuration', `${code('chatData')} block of ${P('config/runtime.json')} (root, tmpTtlHours 24, sessionTtlDays 14, cleanupIntervalMinutes); environment ${code('CHATSOP_CHAT_DATA')}.`],
      ['Tests', Ps(['tests/chat-data.test.mjs', 'tests/chat-memories.test.mjs', 'tests/chat-sessions.test.mjs'])],
      ['Specifications', 'DS031'],
    ]),
    card('Reasoning', 'Strategy registry and the runtime bridge to the js-reference oracle (the reference route), plus the explicit prolog-tabling and z3-smt-bounded strategies, the StrategyRouter v1 that chooses the engine of a knowledge-wire question when the caller names none (the oracle stays the verifier), the goal-directed linker and the shared JS search controllers (abduction, learning, worlds).', [
      ['Modules', Ps(['reasoning/registry.mjs', 'reasoning/bridge/', 'reasoning/router/', 'reasoning/linker.mjs', 'reasoning/strategies/js-reference/', 'reasoning/strategies/prolog-tabling/', 'reasoning/strategies/z3-smt-bounded/'])],
      ['Entry points', `${code('ReasoningRegistry.run')} (${E('reasoning/registry.mjs', /^ run\(name,request\)/)}), ${code('linkKnowledge')} (${E('reasoning/linker.mjs', /export function linkKnowledge/)}), ${code('ask')} of the oracle (${E('reasoning/strategies/js-reference/index.mjs', /export (async )?function ask/)}), ${code('routedAsk')} of the router (${E('reasoning/router/index.mjs', /export function routedAsk/)}).`],
      ['Configuration', `${code('policy.reasoningStrategy')} (default reference; auto asks the router), the request fields ${code('reasoning')} and ${code('verify')} of ${code('POST /v1/sessions/{id}/query')} (default auto), ${code('ROUTER_DEFAULTS')} (thresholds, engine order, verification), ${code('policy.retrievalStrategy')} (hybrid), environment ${code('SWIPL_BIN')}, ${code('Z3_BIN')}.`],
      ['Tests', Ps(['tests/js-oracle.test.mjs', 'tests/reasoning-bridge.test.mjs', 'tests/reasoning-external.test.mjs', 'tests/prolog.test.mjs', 'tests/z3-ast.test.mjs', 'tests/solver-qualification.test.mjs', 'tests/strategy-router.test.mjs'])],
      ['Specifications', 'DS006, DS013'],
    ]),
    card('Authoring path', 'The coding agent omp writes SOP knowledge circuits from attached files in a fenced temporary folder; the server validates and repairs them and stores them as proposed drafts. Only an explicit user act moves anything further.', [
      ['Modules', Ps(['lib/omp/', 'server/authoring.mjs', 'lib/symbolic-lm/scope-detect.mjs', 'skills/sop-wire-authoring/', 'skills/omp-run/'])],
      ['Entry points', `${code('decideRoute')} (${E('lib/omp/routing.mjs', /export function decideRoute/)}), ${code('POST /v1/author')} (${E('server/authoring.mjs', /path: '\/v1\/author'/)}), ${code('runOmp')} fence (${E('lib/omp/run.mjs', /export function/)}).`],
      ['Configuration', `${code('omp')} block of ${P('config/runtime.json')} (bin, timeoutSeconds 600, maxFixRounds 3, maxConcurrent 2); session settings authoring off|auto|always and scope_note ask|mark.`],
      ['Tests', Ps(['tests/omp.test.mjs', 'tests/omp-routing.test.mjs', 'tests/scope-detect.test.mjs'])],
      ['Specifications', 'DS031 "The authoring path", DS017'],
    ]),
    card('Owner pages', 'The browser pages of the owner, behind the administrator session: the corpus audit, the evaluation browser, the experiments index and the journal. They read datasets, reports and status files; they are tooling inside the server, not part of a chat turn.', [
      ['Modules', Ps(['server/audit.mjs', 'server/audit-datasets.mjs', 'server/eval-browser.mjs', 'server/project.mjs', 'server/history.mjs', 'server/pages/'])],
      ['Entry points', `routes in ${P('server/web.mjs')} and ${P('server/audit.mjs')}; journal writes ${code('node tools/journal.mjs add')}.`],
      ['Configuration', `${code('status/')} (journal.jsonl, experiments.json, tasks.json, topics.json), ${code('eval/reports/current/audit/')}.`],
      ['Tests', Ps(['tests/experiments-pages.test.mjs', 'tests/eval-project-server.test.mjs', 'tests/audit-corpus.test.mjs'])],
      ['Specifications', 'DS012, DS020'],
    ]),
    card('Data, evaluation and training tooling', 'Everything that builds the three datasets, evaluates SymbolicLM and the proofing models, and trains them. It is outside the running product; its gates are drawn in diagram f.', [
      ['Modules', Ps(['tools/datasets/', 'tools/eval/', 'eval/', 'training/', 'datasets/', 'status/preregistrations/'])],
      ['Entry points', `${code('node tools/verify.mjs')}, ${code('node check-datasets.mjs')}, ${code('node tools/symbolic-regression.mjs')}, ${code('node tools/datasets/add-case.mjs')}, ${code('node training/cli.mjs')}.`],
      ['Configuration', `${code('config/audit-corpora.json')}, ${code('config/train-*.json')}, ${code('eval/registry/')}`],
      ['Tests', Ps(['tests/three-datasets.test.mjs', 'tests/eval-registry.test.mjs', 'tests/check-datasets.test.mjs', 'tests/content-word-overlap.test.mjs'])],
      ['Specifications', 'DS007, DS008, DS010, DS016, DS020'],
    ]),
  ].join('\n');

  // ------------------------------------------------------------ the page
  const li = items => '<ul>' + items.map(x => `<li>${x}</li>`).join('') + '</ul>';
  const table = (head, rows) => `<div class="table-wrap"><table class="arch-table"><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  const html = `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChatSOP Architecture</title><link rel="stylesheet" href="styles.css"><style>
  ${CSS}
  .arch-lead{max-width:62rem}
  .legend{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;font-size:.9rem;margin:.6rem 0 1rem}
  .legend span{display:inline-flex;align-items:center;gap:.4rem}
  .legend i{display:inline-block;width:1.6rem;height:.9rem;border:1.5px solid #3d566b;border-radius:3px;background:#fff}
  .legend i.model{background:#fbf0e0}.legend i.fence{background:#fbe9e7;border-color:#a8480f;border-style:dashed}.legend i.disk{background:#eef6ee}.legend i.tool{background:#f3f0fa}
  .legend i.gate{border-color:#0f5f8a;border-width:3px}.legend i.wip{background:#fffdf0;border-color:#a8480f;border-style:dashed}.legend i.out{border-style:dotted}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,26rem),1fr));gap:1rem}
  .card{border:1px solid #cdd9e2;border-radius:.4rem;padding:.2rem 1rem .6rem;background:#fbfdfe}
  .card h3{margin:.7rem 0 .2rem}.card p{margin:.2rem 0 .5rem}
  .card dl{margin:0;display:grid;grid-template-columns:7.2rem 1fr;gap:.25rem .7rem;font-size:.92rem}
  .card dt{font-weight:650;color:#12324a}.card dd{margin:0;line-height:1.5}
  .arch-table td,.arch-table th{padding:.3rem .45rem;vertical-align:top}
  .arch-table{border-spacing:0;border-collapse:collapse}.arch-table td,.arch-table th{border-bottom:1px solid #dce6eb}
  .ev{font-size:.9rem;color:#33495c}
  details.graph{margin:.6rem 0}details.graph summary{cursor:pointer;font-weight:650}
  .status-wip{background:#fff6dd;border-left:4px solid #a8480f;padding:.5rem .8rem;margin:.8rem 0;border-radius:.2rem}
  @media (max-width:640px){.card dl{grid-template-columns:1fr}.card dt{margin-top:.3rem}}
  </style></head><body>
  <div data-include="partials/header.html"></div><main class="page"><article class="page__panel"><p class="breadcrumb"><a href="index.html">Overview</a> / Architecture</p><h1>Architecture</h1>
  <p class="arch-lead">This page documents the product as the code is today: which components exist, how they call each other, where the trust boundaries are, and what is deliberately not part of the product. It was written from the source tree on 2026-10-01 (static import scan of ${code('lib/')}, ${code('sop/')}, ${code('memory/')}, ${code('reasoning/')} and ${code('server/')}, then reading the call paths), not from the specifications. Where the code and a specification or this documentation disagree, the disagreement is listed in <a href="#discrepancies">Discrepancies</a> with a file and line. The contracts remain the specifications: <a href="specsLoader.html?spec=DS002-architecture.md">DS002</a>, <a href="specsLoader.html?spec=DS012-local-server.md">DS012</a>, <a href="specsLoader.html?spec=DS031-sessions-and-base-memories.md">DS031</a>; the execution walk-through is <a href="runtime.html">Runtime</a> and the names are in the <a href="wiki.html">Wiki</a>.</p>
  <nav aria-label="On this page"><p><a href="#diagram-a">a Components and boundaries</a> · <a href="#diagram-b">b A chat turn</a> · <a href="#diagram-c">c Memory</a> · <a href="#diagram-d">d Reasoning</a> · <a href="#diagram-e">e Authoring</a> · <a href="#diagram-f">f Data, eval, training</a> · <a href="#imports">Import graph</a> · <a href="#components">Component cards</a> · <a href="#not-in-product">Not in the product</a> · <a href="#suspects">Hygiene suspects</a> · <a href="#discrepancies">Discrepancies</a> · <a href="#in-progress">In progress</a></p></nav>
  <div class="legend" role="note" aria-label="Legend">
  <span><i></i>server component</span><span><i class="model"></i>model process (message only)</span><span><i class="fence"></i>fenced or explicit-request</span><span><i class="disk"></i>stored data</span><span><i class="tool"></i>owner tooling</span><span><i class="gate"></i>gate or boundary rule</span><span><i class="out"></i>outside the process</span><span><i class="wip"></i>in progress</span></div>

  <section id="diagram-a"><h2>a. Components and trust boundaries</h2>
  ${svg('a')}
  <p>Four boundaries matter. <b>B1</b> is authentication: every route needs a bearer token or the administrator session cookie, except the documentation, the health check, the home and login pages and the administrator setup and login calls (${E('server/http.mjs', /const sessionUser=auth/)}). <b>B2</b> is the model boundary of <a href="specsLoader.html?spec=DS021-model-surface.md">DS021</a>: the managed model processes receive the message alone and return text or SOP strings; the registry has exactly one entry with the ${code('formalize')} capability, the SymbolicLM service (${E('config/formalizers.json', /"default": "symbolic-lm"/)}). <b>B3</b> is the fence around the coding agent omp (${E('lib/omp/run.mjs', /'--tools'/)}). <b>B4</b> is that stored knowledge changes only through the few explicit writers of diagram c; a base memory grows only through a validated, recorded addition. <b>B5</b> is the solver rule: ${code('swipl')} and ${code('z3')} run only when a wire names the backend (diagram d).</p>
  <p class="ev">Static scan of the product entry points ${Ps(ENTRIES)}: ${reachable.length} of ${allProduct.length} modules under ${code('lib/')}, ${code('sop/')}, ${code('memory/')}, ${code('reasoning/')} and ${code('server/')} are reachable through static or dynamic imports; ${unreachable.length} are not (listed in <a href="#not-in-product">not in the product</a>; the findings that concerned them are in <a href="#suspects">hygiene findings</a>).</p>
  </section>

  <section id="diagram-b"><h2>b. One chat turn, end to end</h2>
  ${svg('b')}
  <p>The browser makes every call itself: it first cleans (step 2), then prefetches the understanding and the routing hint (step 3), then sends the final text (step 4). The chat call reuses the cached SymbolicLM answer (${E('server/http.mjs', /capabilities\.symbolicFormalize/)}), so the analysis shown to the user and the analysis executed are the same. The text is only rewritten inside the SymbolicLM service; ${code('Agent.turn')} has no rewrite step, and the server passes it no rewrite option. A courtesy-only message stops at ${E('server/agent.mjs', /advice\.courtesyOnly/)} without compiling anything.</p>
  <p>Steps 7 to 9 are one pipeline. ${code('compileDeclarative')} (${E('sop/declarative.mjs', /export function compileDeclarative/)}) never executes anything: it returns the authored SOP, the generated execution SOP and the reports (clause links, translations, untranslated words, copula readings, repairs, unresolved spans). ${code('runDeclarative')} (${E('sop/declarative.mjs', /export async function runDeclarative/)}) then runs the execution SOP through ${code('Runtime.run')} with origin ${code('generated')}; a relation or entity that does not link produces a ${code('clarify')} wire instead of a guess (${E('sop/declarative.mjs', /reason:'unresolved_link'/)}). In ${code('Runtime')} the ${code('solve')} wire expands into ${code('link')}, ${code('reason')} and ${code('binding')} wires (${E('sop/runtime.mjs', /case 'solve':/)}); ${code('link')} calls ${code('linkKnowledge')} (${E('sop/runtime.mjs', /output=linkKnowledge/)}), and ${code('reason')} picks the strategy with ${code('chooseReasoning')} (${E('sop/runtime.mjs', /const chooseReasoning/)}), by default the reference route (${E('sop/runtime.mjs', /reasoningStrategy:'reference'/)}).</p>
  <p>The chain stops being read-only in exactly one place: the proof-use reinforcement of an admitted, metadata-verified observed fact after a real, non-hypothetical proof, allowed only when ${code('policy.reinforce')} and the retention configuration both permit it (${E('sop/runtime.mjs', /this\.repo\.reinforce/)}).</p>
  </section>

  <section id="diagram-c"><h2>c. Memory: base memories, sessions, layers, SQLite, retention</h2>
  ${svg('c')}
  <p>A <b>base memory</b> is a folder whose circuits are the source of truth; its repository is derived from the ${code('fact')} wires (${E('lib/chat-data/memories.mjs', /export function ingestFacts/)}). The product creates SQLite memories only (${E('lib/chat-data/memories.mjs', /export const STRATEGIES/)}); the other engines of ${code('memory/banks/')} stay for research. A <b>session</b> copies the base circuits, clones the repository with hard links (${E('lib/chat-data/sessions.mjs', /cloneRepository\(path\.join/)}) and compiles its own lexicon from the base circuits followed by the circuits the user accepted (${E('lib/chat-data/sessions.mjs', /lexicon\(id\) \{/)}); the lexicon is cached by the hash of those circuits (${E('lib/chat-data/lexicons.mjs', /export const hashCircuits/)}).</p>
  <p>${code('Repository.visible')} (${E('memory/repository.mjs', /^ visible\(s\)/)}) lists the session's live layer, then the user chain, then the base chain, and retrieval reads across them. The shipped configuration keeps retention at ${code('mode: none')} with ${code('reinforceOnUse: true')}, and uses bounded sharding with a garbage collection every 32 writes (${E('config/runtime.json', /"gcEveryWrites"/)}). Temporary folders older than 24 hours and sessions idle for 14 days are removed by a scheduled cleanup (${E('lib/chat-data/index.mjs', /DEFAULT_CHAT_DATA/)}).</p>
  <p>There are two read paths with different inputs: a chat turn retrieves ${code('fact')} rows from the session repository through ${code('linkKnowledge')}, while ${code('POST /v1/sessions/{id}/query')} runs the oracle directly over the session theory, the circuits as text (${E('server/product.mjs', /js-reference\/index\.mjs/)}). The first sees only the facts stored in the repository; the second sees every wire of the circuits, rules and norms included, and answers a query circuit you send.</p>
  </section>

  <section id="diagram-d"><h2>d. Reasoning strategies and backends, with rule 8</h2>
  ${svg('d')}
  <p>The registry has five ids: ${code('reference')}, ${code('js-reference')} and ${code('js-oracle')} (the same oracle, ${E('reasoning/registry.mjs', /ROUTE_IDS/)}) and the two external strategies ${code('prolog-tabling')} and ${code('z3-smt-bounded')}, each pinned to one backend (${E('reasoning/registry.mjs', /EXTERNAL_STRATEGIES/)}). A wire that names ${code('backend prolog')} or ${code('backend z3')} is routed to its strategy (${E('sop/runtime.mjs', /STRATEGY_OF_BACKEND\[one/)}). Rule 8 shows as four rejections (${E('reasoning/registry.mjs', /reference_backend_mismatch/)}, ${E('reasoning/registry.mjs', /backend_strategy_mismatch/)}, ${E('reasoning/registry.mjs', /explicit_backend_not_available_for_query/)}, ${E('reasoning/registry.mjs', /finite_domain_required/)}) and as ${code('unsupported')} with ${code('fallback: null')} (${E('reasoning/common.mjs', /export function unsupported/)}) when a binary is missing (${E('reasoning/registry.mjs', /export function solverAvailable/)}). With Prolog, the oracle still answers first and the two results must agree (${E('reasoning/bridge/external.mjs', /backendAgreement: agree/)}).</p>
  <p>The 16 other directories under ${code('reasoning/strategies/')} are the comparison set. Nothing in the product imports them; they are exercised by ${code('eval/smoke-reasoning/')} and ${code('tests/strategy-*.test.mjs')} (owner decision H13: product reasoning is the oracle route until a router exists).</p>
  </section>

  <section id="diagram-e"><h2>e. The authoring path</h2>
  ${svg('e')}
  <p>Routing is a pure function (${E('lib/omp/routing.mjs', /export function decideRoute/)}) and its default setting is ${code('authoring: off')}: the coding agent runs only on an act of the user, and a scope detection only produces a suggestion. The agent has the ${code('read')}, ${code('write')} and ${code('edit')} tools and no shell (${E('lib/omp/run.mjs', /'--tools'/)}); the repair loop is bounded by ${code('maxFixRounds')} (${E('lib/omp/author.mjs', /for \(let round = 0; round <= maxFixRounds/)}). The result is a draft; accepting it (${E('lib/chat-data/sessions.mjs', /^  acceptDraft\(/)}) puts the circuit in the session layer and ${code('SessionRuntimes.refresh')} (${E('server/session-runtime.mjs', /refresh\(/)}) makes it visible to open agents, including through a new session lexicon. Committing is a separate action (${E('lib/chat-data/sessions.mjs', /^  commit\(/)}).</p>
  </section>

  <section id="diagram-f"><h2>f. Data, evaluation and training pipelines and their gates</h2>
  ${svg('f')}
  <p>Gates are drawn with a heavy outline. Training has three: a dataset qualification record (${E('training/cli.mjs', /Dataset qualification required/)}), a NEW explicit authorization receipt that names the model, run and qualification hash (${E('training/cli.mjs', /NEW explicit user authorization required/)}) and the single training lock (${E('training/cli.mjs', /function lockPath/)}). The leakage guard keeps generators and training code away from sealed tests (${E('eval/leakage.mjs', /forbidden = /)}). The offline verification entry point is ${E('tools/verify.mjs', /Offline verification of the current chain/)}. The training command line still accepts the roles ${code('formalizer')}, ${code('verbalizer')} and ${code('shared')} next to ${code('proofreader')} (${E('training/cli.mjs', /function role\(v\)/)}); they serve the archived FormalizerLLM evidence.</p>
  </section>

  <section id="imports"><h2>Import graph (generated)</h2>
  <p>Static and dynamic relative imports of the ${reachable.length} product-reachable modules, collapsed to components. Reading it: ${code('sop')} and ${code('reasoning')} import each other (${E('sop/runtime.mjs', /from '..\/reasoning\/registry\.mjs'/)} and ${E('reasoning/linker.mjs', /from '..\/sop\/parser\.mjs'/)}), the only cycle between top-level directories; ${code('memory')} does not import ${code('sop')} in the product (only the research baseline ${code('memory/sqlite-simple.mjs')} does); ${code('lib/symbolic-lm')} reaches ${code('lib/emotion-detection')}, ${code('lib/languages-util')}, ${code('lib/translator-service')} and ${code('lib/ud-to-sop')} but never ${code('server/')}. At module level the graph has no cycle, and the only links from these directories to ${code('eval/')} and ${code('tools/')} are two lazy imports of the owner pages (hygiene findings S1, S2, S15).</p>
  <details class="graph"><summary>Show the ${edges.size} importing components</summary><div class="table-wrap"><table class="arch-table"><thead><tr><th scope="col">Component</th><th scope="col">Imports</th></tr></thead><tbody>${graphRows}</tbody></table></div></details>
  <p class="ev">Modules outside the five product directories that the product reaches: ${outsideReach.map(code).join(', ')}.</p>
  </section>

  <section id="components"><h2>Component cards</h2>
  <p>Names follow the glossary in the <a href="wiki.html">Wiki</a>. Every path below was checked to exist when the page was generated.</p>
  <div class="cards">
  ${cards}
  </div></section>

  <section id="not-in-product"><h2>Not in the product</h2>
  <p>Everything here still exists in the repository as evidence, comparison or tooling, and is either unreachable from the product entry points or reachable only for the owner's tooling. The reason is given for each.</p>
  ${table(['What', 'Where', 'Why it is not in the product'], [
    ['FormalizerLLM (small fine-tuned models that wrote SOP directly)', `${Ps(['models/', 'datasets_archive/', 'eval/reports/history/'])}; training roles in ${code('training/cli.mjs')}`, 'Archived and removed by the owner decision of 2026-10-01: SymbolicLM is the only formalizer. Checkpoints, training code and results stay as evidence; the registry has no entry with a gguf formalize capability and the chat has no mode that serves one.'],
    ['The 16 comparison strategies', `${code('reasoning/strategies/')} (asp-clingo, closure-template, code-sandbox, conform, datalog-*, dreaming-session, golog-swi, htn-strips-planner, llm-agent, modes, sql-sqlite, vrc-compressed-planning, worlds-sopr, solver-common)`, `The comparison set of DS013 and DS006; ${unreachable.filter(f => rel(f).startsWith('reasoning/strategies/')).length} modules, none imported by the product. Product reasoning is the oracle route.`],
    ['Research memory engines', `${Ps(['memory/weaver.mjs', 'memory/banks/holo.mjs', 'memory/banks/holo-kernel.mjs', 'memory/banks/hybrid.mjs', 'memory/banks/scan.mjs', 'memory/sqlite-simple.mjs'])}`, 'RecallMemory, HoloMemory, scan, hybrid and the exact sidecar are research engines (DS023, DS024, DS026, DS027). The product offers SQLite only (hygiene H20); the banks are still loaded because the bank factory imports them, and old snapshots keep loading.'],
    ['Research translation backends', `${code('tools/research/translator-backends/')} (opus-mt, apertium)`, 'Moved out of ' + code('lib/') + ' on 2026-10-01; compared in eval-translator-compare-v1, Opus-MT was decisively worse than parsing Romanian directly, and no Apertium Romanian-to-English pair exists.'],
    ['Removed optional backends', 'spaCy second parser, LanguageTool, emotion neural and llm strategies', 'Removed by hygiene H19. The recorded spaCy agreement file is still read by the dataset assembly and a Python helper serves two research commands (hygiene finding S6).'],
    ['Base-model Chat and Translate modes, the advanced route, the LLM verbalizer, the endpoint and prompt-profile formalizer path', `${code('server/chat-modes.mjs')} (deleted), ${code('promptProfile')}`, 'Removed 2026-10-01 (H1 to H5). The chat has one path; the answer is the deterministic controlled-language rendering.'],
    ['Programming knowledge base and the LLM-agent strategy', `${Ps(['lib/programming/solve-instruction.mjs', 'eval/programming-kb/', 'reasoning/strategies/llm-agent/'])}`, 'Research on code-solving; used by tools and tests only.'],
    ['Evaluation harnesses', `${Ps(['eval/smoke-reasoning/', 'eval/reference-engines/', 'eval/world-kb/', 'eval/suites/'])}, ${code('tools/eval/')}, ${code('tools/research/')}`, 'Evidence and comparison; they import the product, the product must not import them.'],
    ['Archive', `${Ps(['probably_obsolete/', 'datasets_archive/'])}`, 'Historical material, never required reading.'],
  ])}
  </section>

  <section id="suspects"><h2>Hygiene findings</h2>
  <p>The first version of this page listed fifteen suspects (S1 to S15) and eleven discrepancies (D1 to D11). Each was fixed in code or documentation, or decided with a reason, on 2026-10-01; the evidence below is the corrected state, resolved from the working tree, and ${code('tests/architecture-page.test.mjs')} fails when a citation stops holding.</p>
  ${table(['#', 'Finding', 'Status and evidence'], [
    ['S1', 'Product code imported the evaluation layer: sentence merging needed one function of eval/metrics.mjs, which pulled tools and the wire help pages into the SymbolicLM process.', `Fixed. The id-free wire items and ${code('wireKey')} live with the language modules (${E('sop/wire-items.mjs', /export const wireKey/)}); ${E('lib/sentence-split.mjs', /from '..\/sop\/wire-items\.mjs'/)} and ${E('eval/propositions.mjs', /from '..\/sop\/wire-items\.mjs'/)} import it. A claim of this build fails if any product module imports ${code('eval/')} or ${code('tools/')} statically.`],
    ['S2', 'The server imports tools and evaluation code.', `Decided. Two owner pages load them lazily, when the owner opens the page: ${E('server/audit-datasets.mjs', /await import\('..\/tools\/datasets\/three-datasets\/sources\.mjs'\)/)} (the audit classifier) and ${E('server/eval-browser.mjs', /await import\('..\/eval\/run\.mjs'\)/)} (case re-execution). They are the only links, a claim of this build checks that, and DS002 "Dependency rules" states it.`],
    ['S3', 'A single-repository chat path remains in the server (one repository, one lexicon, SessionStore conversations).', `Decided. It is the documented mode of ${code('createServer')} without chat data, used by embedders, the evaluation harness ${code('tools/eval/kbqa/run.mjs')} and five test files; ${code('startServer')} always passes chat data. ${E('server/http.mjs', /single-repository mode/)}, ${E('server/http.mjs', /new SessionStore/)}.`],
    ['S4', 'The command-line chat uses another repository and lexicon than the server.', `Fixed in the documentation. README states that the CLI runs the same formalization and answering chain against one local repository and the seed lexicon, without sessions: ${E('README.md', /against one local repository/)}; code ${E('server/cli.mjs', /Repository\(args\.root/)}.`],
    ['S5', 'Dead, conflicting backend dispatch: constraint problems above a size went to Z3 under auto, which the registry never reached.', `Fixed. ${E('reasoning/bridge/solve.mjs', /backend === 'auto'\) backend = 'js'/)} makes ${code('auto')} the JS oracle, as ${E('reasoning/registry.mjs', /if\(backend==='auto'\)backend='js'/)} and the Horn dispatch do; Z3 runs only when it is requested (AGENTS.md rule 8).`],
    ['S6', 'Stale references to the removed spaCy code (importers of a deleted module, a dead command).', `Fixed. ${E('tools/datasets/three-datasets/spacy-agree.mjs', /export function loadAgreement/)} only reads the recorded agreement file; the ${code('spacy')} commands of ${code('build-three-datasets.mjs')} and ${E('tools/research/stanza-accurate-extra.mjs', /export const COMMANDS/)} are gone. ${P('training/python/spacy_parse.py')} stays as the script of two research commands that use their own virtual environment; no product code uses it.`],
    ['S7', 'Research import paths that do not resolve.', `Not a defect. The draft is copied into a scratch layout with ${code('sop/')} symlinked beside it (${E('tools/research/ud-rules-v14.mjs', /symlinkSync\(path\.join\(ROOT, 'sop'\)/)}), where the relative paths resolve; a comment says so (${E('tools/research/ud-rules-v15-draft/index.mjs', /scratch layout/)}).`],
    ['S8', 'An empty directory of a removed feature and its pointer in DS021.', `Fixed. ${code('server/prompts/')} no longer exists; ${E('docs/specs/DS021-model-surface.md', /formalizer\.txt` were removed/)}.`],
    ['S9', 'The training CLI still serves the removed formalizer and verbalizer roles.', `Decided and documented. The roles stay so archived checkpoints remain reproducible; the product serves models only through the registry. ${E('docs/specs/DS007-training.md', /Archived roles of the training CLI/)}, ${E('training/cli.mjs', /function role\(v\)/)}.`],
    ['S10', 'The Python Stanza worker lives under training/.', `Decided. Python inference belongs under ${code('training/python/')} (AGENTS.md "Runtime Defaults"); ${E('lib/ud-to-sop/stanza.mjs', /training\/python\/ud_parse_worker\.py/)} is the only link and DS002 says so.`],
    ['S11', 'A stale pointer in a shipped configuration.', `Fixed. ${E('config/emotion-detection.json', /kindPolicyNote/)} no longer names the deleted evaluator.`],
    ['S12', 'The exact sidecar was still creatable by name through the memory API.', `Fixed. The ${code('exact')} field is not accepted by create, import or fork (an unknown key is a 400) and not stored: ${E('lib/chat-data/memories.mjs', /export const memoryConfigFor/)}, ${E('server/product.mjs', /path: '\/v1\/memories', capability: 'memories\.create'/)}; DS031 and ${code('docs/api.html')} agree.`],
    ['S13', 'A stale header in the oracle (nothing routes to it, the advanced route).', `Fixed. ${E('reasoning/strategies/js-reference/index.mjs', /STATUS: the product's reference route/)}.`],
    ['S14', 'A dead option and a name that outlived its meaning.', `Fixed. The dead ${code('rewrite')} option was removed from ${code('server/http.mjs')}; the class is ${code('ModelManager')} (${E('server/formalizers.mjs', /export class ModelManager/)}). The file names ${code('server/formalizers.mjs')} and ${code('config/formalizers.json')} are kept as historical names, as the header says (${E('server/formalizers.mjs', /historical and kept/)}).`],
    ['S15', 'A sop and reasoning import cycle.', `Decided. The cycle exists between the directories only: ${E('sop/runtime.mjs', /from '..\/reasoning\/registry\.mjs'/)} and ${E('reasoning/linker.mjs', /from '..\/sop\/parser\.mjs'/)}. At module level the product graph has ${moduleCycles.length} cycles, a claim of this build checks it, and DS002 "Dependency rules" states the rule.`],
  ])}
  </section>

  <section id="discrepancies"><h2>Discrepancies between the documentation and the code</h2>
  <p>Each row names a place where the documentation and the code disagreed and where it now agrees. The documentation rows are ${code('docs/specs/')} unless another file is named.</p>
  ${table(['#', 'Finding', 'Status and evidence'], [
    ['D1', 'DS002 and DS003 listed five model-authored types; ' + code('unparsed') + ' is the sixth, and ' + code('unclear') + ' also has the kind ' + code('ambiguous') + '.', `Fixed: ${E('docs/specs/DS002-architecture.md', /`constraint` and `unparsed`/)}, ${E('docs/specs/DS003-main-behavior.md', /`constraint` or `unparsed`/)}; code ${E('sop/declarative.mjs', /export const MODEL_TYPES/)}.`],
    ['D2', 'DS012 spoke of a "Formalize-mode" message although no modes remain.', `Fixed: ${E('docs/specs/DS012-local-server.md', /Before a message reaches the formalizer/)}.`],
    ['D3', 'DS021 described the ' + code('formal') + ' prompt profile and ' + code('server/prompts/formalizer.txt') + '.', `Fixed: ${E('docs/specs/DS021-model-surface.md', /`formal` prompt profile and/)}.`],
    ['D4', 'DS021 specifies frame normalization after the rules; ' + code('sop/frames.mjs') + ' is not called by the product chain.', isReach('sop/frames.mjs') ? 'Fixed by linker-r2-agent: the KnowledgeLinker calls it before the dictionary tiers (' + code('sop/declarative.mjs') + ', tryLink), reports ' + code('frame_changes') + ' and the strict link does not use it.' : `Open, owned by linker-m3-agent (the wiring of frames into the linker): ${E('docs/specs/DS021-model-surface.md', /Host frame normalization/)}; ${code('sop/frames.mjs')} is not reachable from the entry points.`],
    ['D5', 'DS031 says the product offers SQLite base memories only; the request still carried ' + code('exact') + '.', `Fixed together with S12: ${E('docs/specs/DS031-sessions-and-base-memories.md', /The product offers SQLite base memories only/)}.`],
    ['D6', 'AGENTS.md rule 8 still mentioned the removed ' + code('advanced') + ' route.', `Fixed, the substance kept: ${E('AGENTS.md', /Routing \(`auto`\) chooses/)}; code ${E('reasoning/bridge/external.mjs', /former .advanced. route, removed/)}. DS006 and DS013 were aligned.`],
    ['D7', 'The js-reference header said nothing routes to it.', `Fixed together with S13.`],
    ['D8', 'TODO.md listed LanguageTool as an operator-started dependency.', `Fixed: the item is removed (the LanguageTool backend was removed on 2026-10-01).`],
    ['D9', 'The runtime page said ' + code('llm.sendAll') + ' defaults to false; the shipped configuration sets true.', `Fixed: the pages state the code default and the shipped value: ${E('docs/runtime.html', /the shipped <code>config\/text-to-clean-english\.json/)} against ${E('config/text-to-clean-english.json', /"sendAll"/)}.`],
    ['D10', 'README said the CLI chat runs the same chain as the chat page.', `Fixed together with S4.`],
    ['D11', 'The training CLI help was written for the formalizer and verbalizer roles only.', `Fixed: ${E('training/cli.mjs', /proofreader is the role of the LanguageProofingLLM/)}.`],
  ])}
  <p class="ev">Checked and consistent: the model registry capabilities and the chat pipeline of four models; SQLite-only creation in ${E('lib/chat-data/memories.mjs', /export const STRATEGIES/)}; per-session lexicons (DS031); the TTLs; the single formalizer; the textToCleanEnglish routing of English and non-English sentences; the rewrite default gated.</p>
  </section>

  <section id="in-progress"><h2>In progress (other agents were still changing these parts)</h2>
  <div class="status-wip"><p>Written as designed, to be re-checked once the owners report done. The code present when this page was generated is described; the decided design is marked as such.</p>
  ${li([
    `<b>KnowledgeLinker (linker-m0-agent, linker-m1-agent).</b> ${agentLine('linker-m0-agent')}. In the tree: the lexeme and entity grammar and its validator (${E('sop/knowledge/lexicon-checks.mjs', /args_disagree_with_roles/, true)}), ${code('Lexicon.fromCircuits')} (${E('sop/lexicon.mjs', /static fromCircuits/, true)}), per-session lexicons with imports, and the linking report in the packet. Decided design, not in the code yet (milestone M3 of the linking proposal): SymbolicLM stays knowledge-blind and the linker becomes a scored, per-base-memory joint linker that reads the stored analysis, the memory's lexemes, roles and types, reports every choice or asks a precise question; today candidate ranking is the lexicon's own match score (${E('sop/lexicon.mjs', /const score = /, true)}). ${code('core-en')} (${code('config/knowledge/core-en/')}) ${exists('config/knowledge/core-en/seed.json') ? 'has a seed.json and is a shipped seed' : 'has no seed.json yet, so it is not a shipped seed'}.`,
    `<b>Slice retrieval (slice-path-agent).</b> ${sliceWired ? `${code('reasoning/linker.mjs')} now imports ${code('reasoning/slice/')} (${E('reasoning/linker.mjs', /from '\.\/slice\/index\.mjs'/, true)}): demand-driven keyed lookups, widening and a completeness guard replace one all-variable lookup per goal, and the result reports the slice (size, predicates, bounds, complete and why not).` : `${code('reasoning/slice/')} exists but ${code('reasoning/linker.mjs')} does not import it yet.`} ${sliceDone ? 'The agent reported done.' : 'The agent has not reported done; treat the numbers and the packet fields as not final.'} ${agentLine('slice-path-agent')}.`,
    `<b>World knowledge base (worldkb-agent).</b> The base memory ${code('world-v1')} (about 53,000 entities and 349,000 facts, SQLite) was built and loaded into the product chat data root; its quest evaluation and the KBQA harness (${code('tools/eval/kbqa/')}, kbqa-eval-agent) are evaluation, not product code. ${agentLine('worldkb-agent')}; ${agentLine('kbqa-eval-agent')}.`,
    `<b>Archived corpus repairs (archive-fix-agent).</b> Data defects in the archived clean-English and proofing corpora; no product code. ${agentLine('archive-fix-agent')}.`,
  ])}</div>
  </section>
  </article></main><div data-include="partials/footer.html"></div><script type="module" src="partials-loader.mjs"></script></body></html>
  `;

  return {html, problems, citations, reachable: reachable.length, total: allProduct.length};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = buildArchitecture();
  if (result.problems.length) { console.error('BUILD PROBLEMS:\n' + result.problems.join('\n')); process.exitCode = 1; }
  fs.writeFileSync(path.join(ROOT, 'docs/architecture.html'), result.html);
  console.log('wrote docs/architecture.html', result.html.length, 'bytes; problems:', result.problems.length, '; reachable', result.reachable, 'of', result.total);
}
