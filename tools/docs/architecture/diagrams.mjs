import { Svg } from './svg.mjs';

/* ---------------------------------------------------------------- (a) components and trust boundaries */
export function diagramA() {
  const s = new Svg('dg-a', 1100, 'Components and trust boundaries of the running product',
    'Callers on the left cross the authentication boundary B1 into the server process; the server calls managed model processes across the model boundary B2, a fenced coding agent across B3 and solver binaries only on explicit request (B5); stored knowledge changes only through explicit writers (B4).');
  // Callers
  s.zone(10, 10, 224, 414, 'Callers', 'z-out');
  let y = 40;
  for (const [k, t, ls] of [
    ['c1', 'Browser chat', ['/chat page', 'server/pages/chat.mjs']],
    ['c2', 'API client', ['Bearer token; OpenAI-style', 'chat and capability APIs']],
    ['c3', 'Command line', ['server/cli.mjs chat, run', '~own state/ repository']],
    ['c4', 'Owner in a browser', ['/audit /eval /experiments', '/admin (administrator session)']],
  ]) { const g = s.node(k, 20, y, 204, t, ls, 'n-out'); y = g.b + 12; }
  s.boundary(242, 10, 242, 690, null);
  s.text(20, y + 14, 'B1 authentication boundary:', 'blabel');
  s.text(20, y + 28, 'bearer token or administrator', 'blabel');
  s.text(20, y + 42, 'session cookie (server/auth.mjs)', 'blabel');

  // Server
  s.zone(250, 10, 560, 680, 'Server process (Node 22.13+), one port: server/http.mjs', 'z-srv');
  const routes = s.node('routes', 262, 40, 536, 'Routes', [
    'pages: web.mjs, pages/*      capability API: api.mjs, capabilities.mjs',
    'product API: product.mjs, authoring.mjs      chat facade: http.mjs',
    'authentication: auth.mjs (session cookie, bearer tokens)'], 'n-srv');
  const LX = 262, RX = 536, W = 262;
  let ry = routes.b + 14;
  const rows = [
    [['agent', 'Agent (one chat turn)', ['server/agent.mjs, session-store.mjs,', 'session-runtime.mjs; caller-owned', 'conversation context']],
     ['caps', 'Capability APIs', ['server/capabilities.mjs, api.mjs:', 'proofread, understand, rewrite,', 'analyze, emotion; lib/cache/lru.mjs']]],
    [['comp', 'Compiler and KnowledgeLinker', ['sop/declarative.mjs, clauses.mjs,', 'repair.mjs, linking.mjs, dictionary,', 'copula-linker.mjs, lexicon.mjs']],
     ['t2c', 'textToCleanEnglish', ['lib/text-to-clean-english/: gate in', 'process (LanguagesUtil), then a', 'model call; lib/sentence-split.mjs']]],
    [['rt', 'Runtime (SOP circuits)', ['sop/runtime.mjs, parser.mjs, lower.mjs,', 'outputs.mjs, cnl.mjs: runs the', 'generated circuit']],
     ['mm', 'ModelManager', ['server/formalizers.mjs and', 'server-models.mjs: start, probe,', 'idle, evict llama-server + service']]],
    [['rs', 'Reasoning', ['reasoning/registry.mjs, bridge/, router/:', 'the js-reference oracle; prolog-tabling,', 'z3 and the routed engines on request']],
     ['auth', 'Authoring orchestrator', ['server/authoring.mjs, lib/omp/,', 'lib/symbolic-lm/scope-detect.mjs', '~suggests; the user decides']]],
    [['mem', 'Memory and chat data', ['memory/ (Repository, SQLite bank),', 'lib/chat-data/ (base memories,', 'sessions), sop/knowledge/ validator']],
     ['own', 'Owner pages', ['server/audit*.mjs, eval-browser.mjs,', 'project.mjs, history.mjs, pages/*', '~read datasets, reports, journal']]],
  ];
  for (const [l, r] of rows) {
    const a = s.node(l[0], LX, ry, W, l[1], l[2], 'n-srv');
    s.node(r[0], RX, ry, W, r[1], r[2], r[0] === 'own' ? 'n-tool' : 'n-srv');
    ry = a.b + 12;
  }
  const N = k => s.nodes[k];
  s.arrow([[234, 75], [262, 75]]);
  for (const [a, b] of [['routes', 'agent'], ['agent', 'comp'], ['comp', 'rt'], ['rt', 'rs'], ['rs', 'mem']])
    s.arrow([[N(a).x + 40, N(a).b], [N(b).x + 40, N(b).y]]);
  for (const [a, b] of [['caps', 't2c'], ['t2c', 'mm']])
    s.arrow([[N(a).x + 40, N(a).b], [N(b).x + 40, N(b).y]]);
  s.arrow([[N('routes').r - 60, N('routes').b], [N('caps').r - 60, N('caps').y]]);

  // Models
  s.boundary(822, 10, 822, 400, null);
  s.zone(834, 10, 256, 392, 'Managed model processes (CPU)', 'z-model');
  let my = 40;
  for (const [k, t, ls] of [
    ['m1', 'SymbolicLM service', ['lib/symbolic-lm/serve.mjs +', 'Python Stanza worker', '~message in, SOP text out']],
    ['m2', 'LanguageProofingLLM', ['llama-server, Gemma 3 270M F16', '~bad English to English']],
    ['m3', 'SymbolicProofingLLM', ['llama-server, Gemma 3 270M F16', '~gated rewrite, correct English']],
    ['m4', 'translator-llm', ['llama-server, Qwen3-4B Q4_K_M', '~Romanian or mixed to English']],
  ]) { const g = s.node(k, 844, my, 236, t, ls, 'n-model'); my = g.b + 10; }
  s.text(844, my + 10, 'B2 model boundary: the message is the only', 'blabel');
  s.text(844, my + 24, 'input; no knowledge, no context, no write', 'blabel');
  s.arrow([[N('mm').r, N('mm').cy], [834, N('mm').cy]]);
  // Fence + solvers
  s.zone(834, 414, 256, 186, 'B3 fence and B5 solvers', 'z-fence');
  const om = s.node('omp', 844, 444, 236, 'omp coding agent (fenced)', ['read, write, edit only; temp folder;', 'no shell; wall-clock limit', '~output: draft circuits, unapproved'], 'n-fence');
  s.node('sol', 844, om.b + 10, 236, 'Solver binaries (B5)', ['swipl, z3: only when a wire names', 'the backend; never a fallback'], 'n-fence');
  s.arrow([[N('auth').r, N('auth').cy], [834, N('auth').cy]]);
  s.arrow([[N('rs').r, N('rs').cy + 20], [530, N('rs').cy + 20], [530, 660], [814, 660], [814, N('sol').cy], [834, N('sol').cy]], { dashed: true });
  // Disk
  s.zone(10, 438, 224, 252, 'Disk and gates', 'z-out');
  const d1 = s.node('d1', 20, 468, 204, 'chat_data/ (gitignored)', ['base_memories/, sessions/,', 'cache/lexicon/, tmp/'], 'n-disk');
  const d2 = s.node('d2', 20, d1.b + 10, 204, 'config/ and state/', ['config/*.json, knowledge/', 'state/: auth.json, logs'], 'n-disk');
  s.node('d3', 20, d2.b + 10, 204, 'B4 knowledge writes', ['base memories grow by', 'recorded acts (diagram c)'], 'n-gate');
  s.arrow([[N('mem').x, N('mem').cy], [224, N('mem').cy]]);
  return s;
}

/* ---------------------------------------------------------------- (b) one chat turn */
export function diagramB() {
  const s = new Svg('dg-b', 1100, 'One chat turn, end to end',
    'Ten steps from the browser composer to the rendered answer: textToCleanEnglish validated by the user, the SymbolicLM service with the gated SymbolicProofingLLM rewrite, compilation and linking against the session lexicon, the generated circuit with retrieval, the reference reasoning route and the controlled-language rendering.');
  const X = 34, W = 700;
  let y = 12;
  const steps = [
    ['1', 'Browser composer', ['server/pages/chat.mjs: settings are the cleaning toggle, the rewrite mode (off, gated, always),', 'the answer language and the session; every call below is one fetch'], 'n-out'],
    ['2', 'textToCleanEnglish, validated by the user', [
      'POST /v1/language/proofread (alias /v1/text-to-clean-english) -> capabilities.proofread',
      'lib/sentence-split.mjs -> text-to-clean-english/gate.mjs (LanguagesUtil: language id, spelling, regexes)',
      'English sentence -> LanguageProofingLLM; Romanian or mixed -> translator-llm (fallback LanguageProofingLLM)',
      'the page shows a word diff: Accept, Edit or Send original; the text finally sent is the whole formalizer input'], 'n-srv'],
    ['3', 'Understanding and routing (read only)', [
      'POST /v1/understand -> SymbolicLM, cached (lib/cache/lru.mjs); POST /v1/route -> lib/omp/routing.mjs',
      'the default path is symbolic; a coding-agent hint is only a suggestion that the user may accept'], 'n-srv'],
    ['4', 'POST /v1/chat/completions', [
      'server/http.mjs: bearer or session cookie, checkBody (exactly one user message), session open',
      'server/session-runtime.mjs opens the session repository and lexicon; language.mjs picks the answer language'], 'n-srv'],
    ['5', 'SymbolicLM service (message only)', [
      'lib/symbolic-lm/serve.mjs -> SymbolicLM.analyze: LanguagesUtil identify, route direct (en, ro) or translate (mixed)',
      'Stanza parse (accurate package, Python worker) -> uncertainty signal -> rewrite gate (rewrite-gate.mjs)',
      'trees certified: skip; else SymbolicProofingLLM rewrite, accepted only when the new text is certified',
      'lib/ud-to-sop UD-to-SOP rules -> SOP text: stated, assumed, unclear, query, constraint, unparsed'], 'n-model'],
    ['6', 'Agent.turn (server/agent.mjs)', [
      'EmotionDetectionSystem signals (lib/emotion-detection); a bare greeting or thanks gets a short reply, no computation',
      'otherwise Runtime.run(sop, origin model) -> runDeclarative'], 'n-srv'],
    ['7', 'Compile and link: compileDeclarative (sop/declarative.mjs)', [
      'admit the wires (checkModelProgram, clause links) -> repair unparsed spans (repair.mjs) -> dictionary.mjs',
      'KnowledgeLinker: the session Lexicon (base + accepted session circuits) -> linking.mjs, copula-linker.mjs',
      'an unknown or ambiguous relation or entity becomes one precise clarify question; nothing is guessed',
      'output: the generated circuit: resolve wires, solve, cnl (plus a hypothetical branch for assumptions)'], 'n-srv'],
    ['8', 'Runtime runs the circuit (sop/runtime.mjs)', [
      'resolve -> Lexicon.resolve; solve expands to link + reason + binding',
      'link = linkKnowledge (reasoning/linker.mjs): planGoals picks the rules, reasoning/slice/ retrieves the slice of the',
      'session Repository by keyed lookups, widens within bounds and reports whether the slice is complete'], 'n-srv'],
    ['9', 'Reasoning: the reference route', [
      'ReasoningRegistry.run("reference") -> bridge/solve.mjs solveHorn -> bridge/reason.mjs -> js-reference ask',
      'packet: status, rows, proof, complete, route {backend js, fallback null}; reinforcement only if policy allows'], 'n-srv'],
    ['10', 'Render and respond', [
      'sop/cnl.mjs renders the packet (English by default, Romanian on request); no model rewrites the answer',
      'session-store.mjs keeps asserted statements as caller context; transcript appended; the response adds chatSop'], 'n-srv'],
  ];
  const geo = [];
  for (const [n, t, ls, cls] of steps) {
    const g = s.node('s' + n, X, y, W, t, ls, cls);
    s.badge(X - 16 + 2, g.y + 17, n);
    geo.push(g); y = g.b + 22;
  }
  for (let i = 0; i < geo.length - 1; i++) s.arrow([[X + 60, geo[i].b], [X + 60, geo[i + 1].y]]);
  // model column (zones first so the nodes are drawn on top)
  const MX = 786, MW2 = 300;
  s.zone(MX - 12, geo[1].y - 4, MW2 + 24, 98, 'Model processes', 'z-model');
  s.node('m2', MX, geo[1].y + 22, MW2, 'LanguageProofingLLM, translator-llm', ['llama-server, CPU; one sentence per call'], 'n-model');
  s.arrow([[X + W, geo[1].cy], [MX - 12, geo[1].cy]]);
  s.zone(MX - 12, geo[4].y - 4, MW2 + 24, 98, 'Model processes', 'z-model');
  s.node('m5', MX, geo[4].y + 22, MW2, 'SymbolicLM, SymbolicProofingLLM', ['service + llama-server, CPU; message only'], 'n-model');
  s.arrow([[X + W, geo[4].cy], [MX - 12, geo[4].cy]]);
  // in-progress slice box
  s.node('slice', MX - 12, geo[7].y - 6, MW2 + 24, 'Landing now: slice retrieval', ['reasoning/slice/ (demand, retrieval, guard)', 'behind linkKnowledge (slice-path-agent)', '~packet.retrieval: size, bound, complete'], 'n-wip');
  s.arrow([[MX - 12, geo[7].cy + 14], [X + W, geo[7].cy + 14]], { dashed: true });
  // memory column hint
  s.node('mem', MX - 12, geo[6].y + 30, MW2 + 24, 'Per-session Lexicon', ['sop/lexicon.mjs, LexiconCache', '~compiled from circuits, cached by hash'], 'n-disk');
  s.arrow([[MX - 12, geo[6].y + 62], [X + W, geo[6].y + 62]]);
  return s;
}

/* ---------------------------------------------------------------- (c) memory */
export function diagramC() {
  const s = new Svg('dg-c', 1100, 'Memory: base memories, sessions, layers, SQLite and retention',
    'Seeds create base memories; a session clones its base by hard links and adds its own accepted circuits and conversation context. The Repository reads the session layer, then the user chain, then the base chain, over sharded generations stored in a SQLite bank. Only validated, recorded acts write knowledge.');
  s.zone(10, 10, 230, 150, 'Shipped seeds', 'z-out');
  s.node('seed', 20, 40, 210, 'config/knowledge/', ['core-min (shared classes), demo,', 'core-en (content in progress)', '~ensureSeedMemories creates them'], 'n-disk');
  s.zone(270, 10, 380, 330, 'Base memory: chat_data/base_memories/<id>/', 'z-srv');
  const b1 = s.node('b1', 282, 40, 356, 'circuits/NNNN-*.sop  (source of truth)', ['predicate, lexeme, entity, fact, rule, default ...', 'the theory the exact oracle reads; the lexicon source'], 'n-srv');
  const b2 = s.node('b2', 282, b1.b + 10, 356, 'repo/  (Repository, one base named "main")', ['the fact wires, in the sqlite memory strategy only', 'content-addressed snapshots/ and shards/'], 'n-srv');
  const b3 = s.node('b3', 282, b2.b + 10, 356, 'manifest.json, imports/<id>/, provenance.jsonl', ['imports are snapshots of other memories (core-min first)', 'every addition records who approved it and why'], 'n-srv');
  s.node('b4', 282, b3.b + 10, 356, 'Lifecycle', ['fork: circuits copied, repo cloned by hard links;', 'session commit = fork; tmp 24 h, idle sessions 14 d'], 'n-srv');
  s.arrow([[240, 90], [270, 90]]);
  s.zone(680, 10, 410, 330, 'Session: chat_data/sessions/<id>/', 'z-srv');
  const c1 = s.node('c1', 692, 40, 386, 'repo/  (hard-link clone of the base repo)', ['accepted draft facts are added to its base', '"main"; the live layer gets trusted remember', 'and proof-use reinforcement only'], 'n-srv');
  const c2 = s.node('c2', 692, c1.b + 10, 386, 'base_circuits/  circuits/  drafts/', ['base circuits copied (self-contained); accepted', 'draft circuits; proposed drafts wait for the user'], 'n-srv');
  const c3 = s.node('c3', 692, c2.b + 10, 386, 'agent/  transcript.jsonl  provenance.jsonl', ['asserted statements and the last query stay here', 'as caller-owned conversation context, not facts'], 'n-srv');
  s.node('c4', 692, c3.b + 10, 386, 'Lexicon of the session', ['LexiconCache: sha256 of (base + session circuits)', 'in memory and chat_data/cache/lexicon/'], 'n-disk');
  s.arrow([[638, 120], [692, 120]], { label: 'create', lx: 642, ly: 112 });
  s.arrow([[692, 305], [638, 305]], { dashed: true });
  // Repository stack
  s.zone(10, 360, 1080, 230, 'Repository stack: memory/', 'z-srv');
  const r1 = s.node('r1', 22, 390, 340, 'Repository (memory/repository.mjs)', ['visible(session) = session live layer,', 'then the user head chain, then the base head', 'chain; sessions detect stale revisions'], 'n-srv');
  const r2 = s.node('r2', 376, 390, 340, 'ShardedLayer / TemporalLayer', ['hot and cold generations, pinned vs normal bank;', 'valid time and known time; corrections kept;', 'GC roots: pinned snapshots, bases, sessions'], 'n-srv');
  s.node('r3', 730, 390, 348, 'SQLiteBank (memory/banks/sqlite.mjs)', ['node:sqlite, exact atoms, indexed lookups', 'engine chosen by memory.engine; the product', 'offers sqlite only (DS031, hygiene H20)'], 'n-srv');
  s.arrow([[362, 440], [376, 440]]); s.arrow([[716, 440], [730, 440]]);
  s.node('cfg', 22, 480, 540, 'config/runtime.json: memory', ['engine sqlite; retention mode none, reinforceOnUse true;', 'sharding bounded, maxClaimsPerShard 1024, gcEveryWrites 32'], 'n-disk');
  s.node('wr', 578, 480, 500, 'The only writers of knowledge (a read never hides a write)', ['addKnowledge (validator + provenance) | acceptDraft (user act, validated)', 'commit (fork) | trusted remember (Runtime effect) | reinforce (real proof only)'], 'n-gate');
  s.arrow([[300, 340], [300, 360]]); s.arrow([[880, 340], [880, 360]]);
  s.text(560, 612, 'Readers: KnowledgeLinker (lexicon), linkKnowledge (retrieval per goal pattern), POST /v1/sessions/{id}/query (oracle over the circuits).', 'tl', 'middle');
  return s;
}

/* ---------------------------------------------------------------- (d) reasoning */
export function diagramD() {
  const s = new Svg('dg-d', 1100, 'Reasoning strategies and backends, with rule 8',
    'A solve or reason wire picks a strategy: its reasoning field, else the strategy of its backend, else the policy default reference. Reference is the js-reference oracle; prolog-tabling and z3-smt-bounded run only when named. A mismatch or a missing binary is unsupported with fallback null; nothing is substituted.');
  const w1 = s.node('w', 12, 20, 300, 'solve / reason wire', ['fields: reasoning, backend, mode, assume', 'sop/runtime.mjs chooseReasoning order:', '1 the wire\'s reasoning field', '2 the strategy of its backend (prolog, z3)', '3 policy default (reference)', 'allowedReasoningStrategies can forbid'], 'n-srv');
  s.node('pol', 12, w1.b + 14, 300, 'Retrieval is orthogonal', ['policy.retrievalStrategy (hybrid) decides how', 'facts are fetched from memory; it never', 'changes the reasoning strategy'], 'n-disk');
  s.zone(340, 10, 430, 332, 'ReasoningRegistry (reasoning/registry.mjs)', 'z-srv');
  const a = s.node('ref', 352, 40, 406, 'reference | js-reference | js-oracle', ['the js-reference oracle through reasoning/bridge', 'backend auto or js; route.backend js, fallback null', 'deduce, temporal, classify -> solveHorn (instant or', 'interval); constraint, optimize -> finite integer', 'enumeration; abduce, diagnose, associate, induce,', 'analogize, plan, simulate -> shared JS controllers'], 'n-srv');
  const b = s.node('pl', 352, a.b + 10, 406, 'prolog-tabling (backend prolog, SWI-Prolog)', ['Horn at a point in time; the oracle answers first and', 'the Prolog result must agree on status and rows'], 'n-fence');
  s.node('z3', 352, b.b + 10, 406, 'z3-smt-bounded (backend z3)', ['integer constraints and optimization, plus an', 'optimality check against the oracle'], 'n-fence');
  s.arrow([[312, 60], [340, 60]]);
  s.zone(800, 10, 290, 332, 'Rule 8: never substituted', 'z-fence');
  const rj = ['reference + backend prolog or z3:', 'reference_backend_mismatch', 'prolog-tabling + another backend:', 'backend_strategy_mismatch', 'swipl or z3 not installed:', 'unsupported, backend named, fallback null', 'interval query on prolog:', 'explicit_backend_not_available_for_query', 'infinite domain on js:', 'finite_domain_required'];
  s.node('rej', 810, 40, 270, 'Rejections (registry.mjs)', rj, 'n-gate');
  s.arrow([[758, 150], [810, 150]], { dashed: true });
  // comparison set
  s.zone(12, 360, 1078, 210, 'Comparison set: reasoning/strategies/ (only sql-sqlite, datalog-souffle and asp-clingo are reached, by the StrategyRouter)', 'z-out');
  const names = ['asp-clingo', 'closure-template', 'code-sandbox', 'conform', 'datalog-common', 'datalog-e10', 'datalog-souffle', 'dreaming-session', 'golog-swi', 'htn-strips-planner', 'llm-agent', 'modes', 'solver-common', 'sql-sqlite', 'vrc-compressed-planning', 'worlds-sopr'];
  let x = 24, yy = 392, col = 0;
  for (const nm of names) {
    s.node('c-' + nm, x, yy, 252, null, [nm], 'n-tool', { h: 28 });
    col++; x += 262; if (col === 4) { col = 0; x = 24; yy += 36; }
  }
  s.text(550, yy + 14, 'exercised by eval/smoke-reasoning and tests/strategy-*.test.mjs; routed: reasoning/router/ on the knowledge-wire path (oracle verifies); the former advanced route is removed (rule 8 stays).', 'tl', 'middle');
  return s;
}

/* ---------------------------------------------------------------- (e) authoring */
export function diagramE() {
  const s = new Svg('dg-e', 1100, 'The authoring path: from an attachment to a session circuit',
    'A user act sends files or a request to the coding agent omp, which runs fenced in a request folder; the server validates and repairs the circuits, stores them as proposed drafts, and only the user accepting a draft puts them in the session layer. A commit to a fork of the base memory is a separate explicit act.');
  const t = s.node('t', 12, 20, 300, '1  A user act', ['attach files, or set "Always use the', 'coding agent", or answer yes to the', 'scope note; decideRoute (routing.mjs):', 'a detection only suggests'], 'n-out');
  const a = s.node('a', 12, t.b + 22, 300, '2  POST /v1/author', ['server/authoring.mjs; session or temp folder;', 'wait false answers 202, then poll the request', '~rate: omp.maxConcurrent 2, timeout 600 s'], 'n-srv');
  s.arrow([[162, t.b], [162, a.y]]);
  const f = s.node('f', 12, a.b + 22, 300, '3  Request folder', ['sessions/<id>/requests/<req>/: input/', '(files, vocabulary), skill/ (sop-wire-', 'authoring), TASK.md (fence, outputs)'], 'n-srv');
  s.arrow([[162, a.b], [162, f.y]]);
  s.zone(340, 20, 330, 190, 'B3 fence', 'z-fence');
  const o = s.node('o', 352, 50, 306, '4  omp -p (lib/omp/run.mjs)', ['tools: read, write, edit; no shell, no', 'extensions, skills or rules; credentials', 'never passed; --max-time plus hard kill', '~writes knowledge.sop, queries.sop, report.md'], 'n-fence');
  s.arrow([[312, f.cy], [330, f.cy], [330, o.cy], [352, o.cy]]);
  const v = s.node('v', 340, 236, 330, '5  Validate and repair (server)', ['sop/knowledge validate with the session theory;', 'on problems the same omp session continues', 'with the validator output, up to maxFixRounds (3)'], 'n-srv');
  s.arrow([[505, o.b + 0], [505, v.y]]);
  const d = s.node('d', 700, 236, 390, '6  Draft (proposed)', ['sessions/<id>/drafts/<draft>.json: text, validation,', 'model, cost; nothing is knowledge yet; the page shows', 'it and the validator output'], 'n-srv');
  s.arrow([[670, v.cy], [700, v.cy]]);
  const g = s.node('g', 700, d.b + 24, 390, '7  The user decides', ['POST .../drafts/{draft}/accept  or  .../reject', 'accept: circuit copied to circuits/ (session layer only),', 'SessionRuntimes.refresh -> new lexicon and repository view'], 'n-gate');
  s.arrow([[895, d.b], [895, g.y]]);
  const c = s.node('c', 700, g.b + 24, 390, '8  Commit (separate, explicit)', ['POST .../commit: a new fork of the base memory,', 'validated again, provenance kind commit; the base the', 'session started from does not change'], 'n-gate');
  s.arrow([[895, g.b], [895, c.y]]);
  const k = s.node('k', 340, 400, 330, 'Alternative: prepare a base memory', ['POST /v1/memories/{id}/knowledge: circuits must', 'pass sop/knowledge; recorded with the acting user', '~skills/material-to-sop: drafts stay unapproved'], 'n-srv');
  return s;
}

/* ---------------------------------------------------------------- (f) data / eval / training */
export function diagramF() {
  const s = new Svg('dg-f', 1100, 'Data, evaluation and training pipelines and their gates',
    'Three lanes. Data: sources cleared by rights, builders, the analysis gate, the three datasets and the sealed tests, checked by verifiers and the owner audit. Evaluation: preregistration, staged runs with early stopping, current and history reports. Training: dataset qualification, a new explicit authorization, one GPU worker, evaluation, adoption and cleanup.');
  const lane = (y, label, h) => s.zone(10, y, 1080, h, label, 'z-srv');
  // Lane 1 data
  lane(10, 'Data (tools/datasets/, datasets/, eval/suites/)', 232);
  const d = [
    ['src', 'Sources', ['datasets_sources/ (cache)', 'rights: DS014, rights.mjs', 'no-copy.mjs'], 'n-disk'],
    ['bld', 'Builders', ['build-three-datasets.mjs:', 'collect, analyze, gate-stage,', 'assemble'], 'n-srv'],
    ['gate', 'Analysis gate', ['identical default and', 'accurate Stanza trees, and', 'DeepSeek judge a and c good'], 'n-gate'],
    ['ds', 'datasets/', ['bad_english, symbolic_english,', 'neuro_english, natural;', 'train and dev only'], 'n-disk'],
    ['seal', 'eval/suites/*/test.jsonl', ['sealed tests, written by', 'tools/eval/three-datasets-', 'suites.mjs; builders never read'], 'n-disk'],
  ];
  let x = 22; const dg = [];
  for (const [k, t, ls, c] of d) { dg.push(s.node(k, x, 40, 200, t, ls, c)); x += 214; }
  for (let i = 0; i < dg.length - 1; i++) s.arrow([[dg[i].r, dg[i].cy], [dg[i + 1].x, dg[i + 1].cy]]);
  s.node('ver', 22, 150, 330, 'Verifiers (fail closed)', ['verify-three-datasets.mjs, content-word-overlap,', 'natural-overlap, form variants, audit-corpus.mjs,', 'eval/leakage.mjs (generators never read tests)'], 'n-gate');
  s.node('aud', 366, 150, 320, 'Owner audit: /audit', ['server/audit*.mjs re-executes rows on demand;', 'verdicts appended to eval/reports/current/audit/'], 'n-tool');
  s.node('prod', 700, 150, 380, 'Production loop', ['add-case.mjs -> incoming.jsonl (pending) -> owner', 'review -> merge into train or dev; never into a sealed test'], 'n-tool');
  s.arrow([[dg[3].cx, dg[3].b], [dg[3].cx, 150]], { dashed: true });
  // Lane 2 eval
  lane(256, 'Evaluation (tools/eval/, eval/, status/)', 176);
  const e = [
    ['pre', 'Preregistration', ['status/preregistrations/*.json', 'written before the first', 'scored answer; stop rules'], 'n-gate'],
    ['reg', 'Regression', ['tools/symbolic-regression.mjs', 'replays recorded parses;', 'rules only, seconds'], 'n-srv'],
    ['stg', 'Staged runs', ['100, 300, then all rows;', 'paired bootstrap; stop on', 'decisive, futile or broken'], 'n-srv'],
    ['cur', 'Reports', ['eval/reports/current/', '(regenerable, gitignored)', 'then eval/reports/history/'], 'n-disk'],
    ['pg', 'Pages', ['/eval, /experiments', 'status/journal.jsonl,', 'experiments.json, topics'], 'n-tool'],
  ];
  x = 22; const eg = [];
  for (const [k, t, ls, c] of e) { eg.push(s.node(k, x, 286, 200, t, ls, c)); x += 214; }
  for (let i = 0; i < eg.length - 1; i++) s.arrow([[eg[i].r, eg[i].cy], [eg[i + 1].x, eg[i + 1].cy]]);
  s.text(550, 418, 'tools/verify.mjs runs the unit tests, the regression, the three datasets, the reasoning smoke suite, spec references and the model-surface lint.', 'tl', 'middle');
  // Lane 3 training
  lane(446, 'Training (training/, models/): only with the owner\'s explicit approval per run', 250);
  const t = [
    ['q', 'G1 Qualification', ['dataset-qualification-v1:', 'syntax, review, leakage,', 'coverage, rights, reference'], 'n-gate'],
    ['au', 'G2 Authorization', ['training-authorization-v1:', 'a NEW explicit approval that', 'names this run; never reused'], 'n-gate'],
    ['lock', 'G3 One GPU worker', ['models/.training.lock;', 'preflight; no concurrent GPU', 'job; no kill of other work'], 'n-gate'],
    ['run', 'training/cli.mjs train', ['python/train.py (wrapper:', 'training/container/);', 'interim checks, early stopping'], 'n-srv'],
    ['sel', 'Select and export', ['chosen epoch LoRA adapter,', 'merge, GGUF (F16), run.json,', 'identity.json, summary.json'], 'n-srv'],
  ];
  x = 22; const tg = [];
  for (const [k, tt, ls, c] of t) { tg.push(s.node(k, x, 476, 200, tt, ls, c)); x += 214; }
  for (let i = 0; i < tg.length - 1; i++) s.arrow([[tg[i].r, tg[i].cy], [tg[i + 1].x, tg[i + 1].cy]]);
  const t2 = [
    ['ev', 'Evaluation', ['staged, preregistered,', 'against the sealed tests;', 'CPU speed on a small sample'], 'n-srv'],
    ['ad', 'Adoption', ['config/formalizers.json entry;', 'auto-switch: better overall,', 'no new catastrophic class'], 'n-gate'],
    ['sv', 'Serving', ['ModelManager starts a CPU', 'llama-server on demand', '(server/formalizers.mjs)'], 'n-srv'],
    ['cl', 'Cleanup', ['delete merged-epoch-*,', 'gguf-src, unselected GGUF,', 'stopped runs; no model in git'], 'n-disk'],
  ];
  x = 22; const t2g = [];
  for (const [k, tt, ls, c] of t2) { t2g.push(s.node(k, x, 596, 200, tt, ls, c)); x += 214; }
  for (let i = 0; i < t2g.length - 1; i++) s.arrow([[t2g[i].r, t2g[i].cy], [t2g[i + 1].x, t2g[i + 1].cy]]);
  s.arrow([[tg[4].cx, tg[4].b], [tg[4].cx, 570], [t2g[0].cx, 570], [t2g[0].cx, t2g[0].y]]);
  return s;
}
