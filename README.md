# ChatSOP

ChatSOP separates a small model's description of a problem from its symbolic execution. The small model sees only the user's message and emits only `stated`, `assumed`, `unclear`, `query`, and `constraint` declarations, written as context-free strings. The host validates them, links the strings to its reviewed lexicon, and generates the required resolution, collection, solving, rendering, and clarification operations. A person or approved tool can also supply a full trusted SOP circuit. Memory and reasoning remain separate from model weights. A local OpenAI-compatible HTTP server ships with the repository (see below). The chat has one formalizer, SymbolicLM, a local service that needs no GGUF; the proofing models (LanguageProofingLLM, SymbolicProofingLLM, translator-llm) are fine-tuned or standard GGUF files under the local `models/` directory, listed in `config/formalizers.json`, and run in CPU `llama-server` processes managed by the server (not in Git).

**Current plan (owner decisions of 2026-09-30).** The current formalizer is **SymbolicLM** (Stanza grammatical analysis plus the UD-to-SOP rules; it returns the grammatical `analysis` and, at a later stage, SOP Lang), evaluated on clean English; FormalizerLLM, the small model that wrote SOP directly from the message, is archived and removed from the product; its work with its results in the archive and history reports. **LanguagesUtil** identifies languages and spells symbolically, **TranslatorService** holds the translation backends, and **textToCleanEnglish** is the chat step, validated by the user, that turns bad input into acceptable English by sending English to **LanguageProofingLLM** (a standard or fine-tuned LLM; Gemma 3 270M is the base to try first; today the fine-tuned Gemma 3 270M production build `prod1`) and Romanian or mixed text to the translator-llm (Qwen3-4B). **SymbolicProofingLLM** (the fine-tuned Gemma 3 270M, iteration 3, formerly called the "proofreader") rewrites correct English into the limited English SymbolicLM understands, only for what rules cannot fix; improving SymbolicLM by rules and repairs comes first. The three datasets are `datasets/bad_english`, `datasets/symbolic_english` (the regression suite) and `datasets/neuro_english`; legacy corpora are in `datasets_archive/`. Training happens only with the owner's explicit approval per run, and base models must run at 30 to 40 tokens per second on an ordinary laptop CPU (the translator-llm is accepted at 15 to 20) (`eval/reports/current/cpu-speed/cpu-speed-table.json`). Names and rules: [glossary](docs/wiki.html#definition-symbolic-lm), DS021 "Names, roles and datasets".

SOP (properly *SOP Lang*) comes from *Standard Operating Procedure*: the language is an attempt to formalize standard operating procedures, and the facts, questions and constraints they rely on, as inspectable, executable text.

## Prerequisites

Use Node.js 22.13 or newer, including the built-in `node:sqlite` module. The symbolic CLI uses Node built-ins and the root `package.json` has no third-party npm dependencies. SWI-Prolog and Z3 are optional reasoning backends and are not needed for the reference route (the `js-reference` oracle in JavaScript). Python and ML packages are needed only for training/model inference operations; their declared requirements and unresolved version/license information are in [dependencies.md](dependencies.md). Do not download a model or install an optional solver to run a symbolic example.

On the prepared ARM64 host, explicitly select the private native solvers:

```sh
Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" \
SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs
```

Their local binaries and pinned provenance are separate from the source checkout.
Without them JS remains available; skipped/fallback checks are not external executions.

## Run a local circuit

From the repository root:

```sh
node server/cli.mjs help
node server/cli.mjs init
node server/cli.mjs run --file examples/query.sop
```

`init` publishes a reviewed fictional fixture into the configured local state directory; `run` executes the specified `.sop` file. Other checked commands include `validate --file <path>`, `compile-smt --file <path>`, `compile-prolog --file <path>`, `fork`, `commit`, `discard`, `stats`, `maintain`, and `gc` (a dry run without `--apply`). The path passed to `--file` is the caller's input path. A separate configuration can be selected with `--config <runtime.json>` (the shipped `config/runtime.json`, or one of your own); a runtime configuration chooses the physical memory engine and reasoning strategy independently. `node examples/reasoning-demo.mjs` exercises the bundled symbolic demonstrations; `npm test` and `npm run verify` invoke repository checks without claiming neural evaluation. Commands can write state or reports; inspect the selected configuration and target paths first.

Memory and reasoning are chosen by the runtime configuration under `config/`, independently of each other. `memory.engine` selects one of five banks: **RecallMemory** (`recall-memory`, several hashed views that must agree, inspired by the column voting of *A Thousand Brains*), **HoloMemory** (`holo-memory`, superposed codes in fixed signed-counter banks), `sqlite`, `scan` or `hybrid` (exact SQLite evidence plus associative hints). Their contracts, verified status and the experiments still needed before any claim are in `docs/specs/DS005-memory.md` and DS023–DS028.

## Local conversation

`node server/cli.mjs chat --config config/runtime.json` runs the formalization and answering chain of the chat page against one local repository (`state/`, or `--root`) and the seed lexicon (or `--ontology`), without chat sessions, base memories or per-session lexicons: the message goes to the SymbolicLM service (started as `config/formalizers.json` says), the KnowledgeLinker links and the runtime executes, and the answer is the deterministic controlled-language rendering; no LLM verbalizer is called. A formalization passes validation, policy guards and symbolic execution before the answer is returned. Model text and supplied documents cannot publish privileged definitions or choose their own user identity. See [Runtime](docs/runtime.html) for the local execution boundaries.

The model writes one keyword per line and quoted strings, never identifiers: "Who works at Acme?" becomes

```sop
@q query
  where match
    relation "work at"
    role subject ?who
    role object "Acme"
    polarity affirmed
  end
  select ?who
```

and the host links `"work at"` and `"Acme"` to its lexicon. Trusted circuits written by people or tools use positional atoms with whitespace-separated terms, for example `where temperature room_a ?degrees`; parentheses and commas are not SOP relation delimiters. Quote a multiword term, such as `"Maria Ionescu"`. Use explicit `all`/`any`/`end` blocks for Boolean grouping. Solver-internal Prolog/SMT and system-side expressions retain their own syntax.

A `stated` proposition reports what the user's message puts forward: an asserted statement becomes turn-local evidence (never a stored `fact`) and is carried in conversation-local context; a hedged, supposed or reported one is used only conditionally. An `assumed` proposition is something the model added: it is reported and, by default, never used by the answer. `unclear` marks an unintelligible message (`gibberish`), one with neither a statement nor a question (`no_request`), or one with two or more equally good readings (`ambiguous`, with one `reading` line each); when one reading is preferable the model resolves it with an `assumed` proposition instead. Nothing of this is written to the knowledge repository, and the model never refuses: an understood question without an engine is answered "I understood the question as …; I cannot compute this kind of answer yet". See [DS021](docs/specsLoader.html?spec=DS021-model-surface.md). There is one model language, with no versions or profiles. Sourced facts and explicit `remember` operations belong to trusted system/tool circuits; `remember` records information in a session and host `commit` remains separate. An unknown or ambiguous relation, identity or date, or a required nonunique scalar, triggers a generated clarification rather than a model-authored `clarify`. Lack of factual support remains an unknown reasoning result.

`Runtime.run(source, {origin: 'model', inputText, language, context})` enforces this boundary. It returns both `authoredSop` and the generated `executionSop`, the carried `contextStatements`, result packets with `user_statements` and `model_assumptions`, and traces. The caller owns `{statements: []}` for the conversation; unrelated conversations must use separate contexts. Full trusted circuits use the default runtime origin. This keeps the model's learning task small while symbolic orchestration can evolve independently.

## Start the local HTTP server

The server serves everything on one port: a **home page** at `/`, one **sign-in page** at `/login`, the **browser chat** at `/chat`, the **visual corpus audit** at `/audit`, the **evaluation page** at `/eval` (with a guide at `/eval/guide`), the **experiments and project history** at `/experiments`, the **administrator page** at `/admin` (these pages require the administrator session), the **documentation site** at `/docs/` (static, no authentication) and the **OpenAI-compatible chat API** (bearer token or the same session cookie).

```sh
npm start                 # home page, chat, audit, eval, project, admin, docs and chat API; prints the home URL first
npm start -- --port 3001  # extra flags go to the launcher
npm test                  # node --test over tests/*.test.mjs
npm run verify            # full symbolic verification (set Z3_BIN/SWIPL_BIN for the optional solvers)
npm run datasets:check    # dataset and sealed-suite checks
```

Under the hood, `npm start` runs `node tools/serve-local.mjs`, which binds all interfaces (`0.0.0.0:9999`) by default, prints every reachable URL. Open the printed home URL (for example `http://127.0.0.1:9999/`, or the LAN address it lists) in a browser. On the first run the sign-in page asks you to choose the administrator password (at least 8 characters) — it is stored only as a salted hash in `state/auth.json`, and the chat API stays blocked until it is set. Afterwards the same page signs you in and returns you to the page you asked for. `CHATSOP_API_KEY` (at least 16 characters) remains supported as an environment-provided bearer token and needs no password.

Environment variables: `CHATSOP_HOST` (default `0.0.0.0`, all interfaces; set `127.0.0.1` for loopback only), `CHATSOP_PORT` (default `9999`), `CHATSOP_API_KEY` (required unless the launcher generates it), `CHATSOP_CONFIG` (configuration path), `CHATSOP_AUDIT_LEDGER` (verdict ledger directory for the audit server).

The browser pages share one top bar (Home · Chat · Audit · Eval · Experiments ▾ · Admin · Docs ▾ · Logout):

- **Home** (`/`) shows whether you are signed in, whether the administrator password is set, and the state of every managed model (stopped, starting, ready or error), with large links to the other pages.
- **Sign in** (`/login?next=/chat`) chooses the first password or signs in, then redirects to `next`; only same-origin relative paths are accepted, cross-site form posts are refused, and wrong passwords, throttling (ten failures per minute) and too-short passwords are reported in plain words. A signed-out browser opening `/chat`, `/audit`, `/eval`, `/experiments` or `/admin` is redirected here; API calls (`/v1/*`, `/readyz`, `/audit/api/*`, any request with an `Authorization` header or without `Accept: text/html`) keep their JSON 401/403 answers.
- **Chat** (`/chat`) sends messages to `/v1/chat/completions` with the session cookie (Enter sends, Shift+Enter adds a line), keeps several `conversation_id`s selectable with a *New conversation* button, and shows under every answer a collapsible trace: status, backend and fallback, completeness, assumptions, reinforcement, the model SOP and the generated execution circuit. The trace also names the model that answered and how long the formalization took. Errors are explained: 503 means the selected model cannot run (with the reason), 422 that the model's SOP was refused (the trace shows it), 409 the conversation is still answering, 429 the server is busy, 504 the time limit was reached. The transcript shown in the page is a local browser copy; the server owns the conversation context.

### Choosing the model and the answer language

The chat page has one mode: the message goes through the product chain (optional *Clean text* step, SymbolicLM, host linking, execution) and the host answers. The **Model** list shows the formalizers of `config/formalizers.json` (SymbolicLM). The proofing models run before and inside the chain: LanguageProofingLLM corrects English, translator-llm translates Romanian and mixed text, and SymbolicProofingLLM rewrites a sentence only when SymbolicLM cannot analyse it (rewrite gated by default). Each model has a lifecycle in `config/server-models.json`: `keep_open` (started at server start and never evicted), `on_demand` (started when needed, stopped after `idleMinutes`, 60 by default) or `off`; at most `maxRunning` (6) run at once, within a memory budget (DS012 "Model lifecycle"). The server stops them all when it exits. It finds `llama-server` through `LLAMA_SERVER_BIN`, `LLAMA_SERVER`, `LLAMA_CPP_DIR`, `vendor/llama.cpp` or `~/llama-cpp-venv/llama.cpp/build/bin`. To add a model, add an entry with `id`, `label`, `gguf`, `capabilities` and `note` to the registry and restart the server; only entries with the `service` kind may formalize.

The **Answer language** list has English, Română and Any: English and Română always answer in that language, and Any answers in English unless the message itself asks for another language ("răspunde în română"). The trace under every answer shows the model and the latency. The API takes `"model": "symbolic-lm"` and `"language": "en" | "ro" | "auto"`; `GET /v1/models` lists the models with their capabilities and state.
- **Eval** (`/eval`) browses the regenerable observations under `eval/reports/current/`; `/eval/guide` explains how evaluation works, citing the owning specifications.
- **Experiments** (`/experiments`, formerly `/project`, which now redirects) is the living project history: an index of every major task and experiment (`status/tasks.json`, `status/experiments.json`, [DS010](docs/specsLoader.html?spec=DS010-experiment-preregistration.md)) with one page each that keeps the owner's requests and decisions apart from the agents' analyses and results, the append-only topic notes (`status/notes/<topic>.jsonl`, added with `node tools/notes.mjs add`), a read-only report viewer for `eval/reports/`, the journal timeline with the live gates (`/experiments/timeline`, `status/journal.jsonl`, added with `node tools/journal.mjs add`) and the open owner questions.
- **Admin** (`/admin`) shows the server status, mints and revokes bearer tokens for scripts, and links to the chat and the audit.

The documentation at `/docs/` is the same as the `docs/` directory (overview, runtime, training, wiki, wire reference, specification matrix and the DS files); its *Server* menu links back to these pages. Static serving is read-only and refuses any path that escapes `docs/`.

Chat endpoints: `GET /healthz`, `GET /readyz`, `GET /v1/models`, `POST /v1/models/<id>/start`, `POST /v1/chat/completions`. `/readyz` lists every model's state; a model that cannot start (no GGUF file or no `llama-server`) answers 503 with the reason; the documentation keeps working.

```sh
curl -H "Authorization: Bearer $CHATSOP_API_KEY" http://127.0.0.1:9999/readyz
curl -H "Authorization: Bearer $CHATSOP_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"symbolic-lm","language":"auto","messages":[{"role":"user","content":"Who works at Alpha Lab?"}]}' \
  http://127.0.0.1:9999/v1/chat/completions
```

The registry models need nothing else; the server starts them as `config/server-models.json` says. Provide a bearer credential for API calls:

```sh
CHATSOP_API_KEY='replace-with-a-long-private-token' node server/http.mjs
```

The server binds `0.0.0.0:9999` (all interfaces) by default, so set the administrator password promptly on first start or use `CHATSOP_HOST=127.0.0.1`; set `CHATSOP_PORT` to change the port, and stop the foreground process with Ctrl-C. `GET /healthz` checks process liveness; authenticated `GET /readyz` returns HTTP 503 with `model_available: false` until the SymbolicLM service is reachable. `GET /v1/models` and `POST /v1/chat/completions` are supported; non-streaming and verified-result SSE (`stream: true`) are available. Supply `Authorization: Bearer <token>`, a listed model (`symbolic-lm`, or `chatsop-local` for the registry default), one new user message, and optionally a stable `conversation_id`. The endpoint owns prior context and stores per-principal conversations under the repository root. For separate users, provide separate credentials through the programmatic `createServer({authTokens})` API; one shared token represents one user.

The server fails closed without a SymbolicLM service: there is no endpoint or prompt-profile fallback. The answer language is the API `language` field when it is `en` or `ro`; with `auto` or none, English unless an explicit request in the message asks for Romanian. The checkpoints are local files, not part of Git, so a fresh clone has registry models in the `error` state until the GGUF files are present. `chatSop.trustedSop` is the authenticated, explicit `fact`/`event`/`remember` circuit for session recording; model-authored SOP never records facts. Tools, Responses, and embeddings are not implemented. See [DS012](docs/specsLoader.html?spec=DS012-local-server.md) for limits, errors, security and trace fields.

## Audit the corpora

The corpora are JSONL-first: `datasets/<name>/{train,dev}.jsonl` (the three datasets) or `datasets_archive/<corpus>/{train,dev}.jsonl` (the legacy corpora) plus the sealed `eval/suites/<corpus>/test.jsonl`. The visual audit is not a separate process: it is mounted at `/audit` on the main server. Run `npm start`, open `http://127.0.0.1:9999/audit` (a signed-out browser is sent to the sign-in page first and returned afterwards); the audit page and its `/audit/api/*` endpoints require that administrator session.

The page has four tabs: `bad_english`, `symbolic_english` and `neuro_english` (each with a statement of purpose, row counts per split, filters and its own view: SymbolicLM's grammatical analysis as tree and table with a re-run button, failure kind and rewrite diff, clean-target check) and a secondary `archive / sources` tab for the legacy corpora. It lets you filter and open a case, shows the message, the target or analysis, the stored verification, re-runs SymbolicLM on demand (for the archive formalizer corpora it re-executes the gold against the runtime and shows the verification world, never model input), and records `approve` / `reject` / `needs_fix` verdicts in `eval/reports/current/audit/<corpus>.jsonl` (`CHATSOP_AUDIT_LEDGER` overrides that directory). The documentation path stays public, so prefer a private address when binding beyond localhost. The machine equivalent is `node tools/datasets/audit-corpus.mjs --corpus <name>`, which writes `eval/reports/current/corpus-audit/<corpus>.json`, fails closed on any structural invariant violation, and adds semantic-faithfulness, context-triviality, diversity and template-leakage checks selected by `--fail-on`; `node check-datasets.mjs` runs it in report mode (`--audit-strict` to enforce, `--no-audit` to skip). The procedure is [`skills/corpus-audit/SKILL.md`](skills/corpus-audit/SKILL.md). See [DS020](docs/specsLoader.html?spec=DS020-corpus-audit-tool.md).

`node training/cli.mjs --help` lists the model workflow. The controller owns explicit preflight, download, train, token audit, merge and serving operations; Python ML implementation lives under `training/python/`. Base weights belong under `models/<model>/bases/<pinned-revision>/`; run-specific roles belong under `models/<model>/<run>/<role>/`. `config/train-gemma.json` and `config/train-qwen.json` are recipes, not trained weights. Do not start training or serving without a qualified environment, an actual pinned model, reviewed corpus and appropriate permissions. Results in `eval/reports/history/` are historical, not a new run. The [Training](docs/training.html) chapter and [DS008](docs/specsLoader.html?spec=DS008-data-evaluation.md) set the evidence and data-rights boundaries.

For an explicit rootless Podman image build, GPU CDI preflight, bounded
run and owned-container stop/recovery on DGX Spark, follow
[`skills/spark-training/SKILL.md`](skills/spark-training/SKILL.md).
The image is optional; the same Node controller also supports a reviewed
native Python ML environment. Neither a preflight import nor a built image
demonstrates a completed GPU training run. On unified-memory hardware,
container RAM limits do not guarantee bounded device allocations; measure
both host and CUDA memory and retain verified checkpoint/winner artifacts.

The current operator has explicitly withheld approval for training: image
build, CUDA infrastructure probes and dataset qualification may proceed, but
no `train`, resume, optimizer/fine-tuning or training smoke runs may begin
without a **new explicit user approval**. A successful preflight does not
grant that approval.

Historical observation (recorded 2026-09-27, not a current run):
an explicit Podman build and a single CUDA CDI/BF16 infrastructure
preflight were reported as completed on the prepared host; the recorded evidence is in
`models/.container-runs/image-provenance.json` and
`models/.container-runs/spark-preflight-1/`. Owned-container stop and
concurrent-job refusal were also exercised in `spark-stop-probe-1`.
No optimizer/model training or GPU training-pressure qualification is implied.

The FormalizerLLM model-language corpora (archived since 2026-10-01) were built by the diversity generator under `tools/datasets/diversity/` ([DS022](docs/specsLoader.html?spec=DS022-diversity-generator.md)) with `node tools/datasets/build-corpora.mjs`: `formalizer-v1` (train/dev in `datasets_archive/formalizer-v1/`, sharded above 45 MB, sealed test in `eval/suites/formalizer-v1/test.jsonl`) and the out-of-distribution suite `eval/suites/formalizer-ood-v1/test.jsonl`; `node tools/research/prepare-experiment.mjs` projects them message-only for a future authorized experiment. The corpora are inspired by QQP, PAWS, ProofWriter, AmbigNQ, QA2D and SQuAD under the owner's release of 2026-09-28 ([DS014](docs/specsLoader.html?spec=DS014-source-rights.md)): they take structure, label types, phenomena and statistics, never text, and `node tools/datasets/no-copy.mjs` checks it. Dataset-conversion code lives under `tools/datasets/`. Since the owner decision of 2026-09-30 the first level of `datasets/` holds only three datasets, each with one purpose ([DS008](docs/specsLoader.html?spec=DS008-data-evaluation.md) "Three datasets"; rules in each `README.md`): `bad_english` (not clean English: Romanian, mixed, spelling and grammar problems, with a clean target where known; material for LanguageProofingLLM), `symbolic_english` (correct English that SymbolicLM analyses correctly, with its grammatical analysis and SOP; the regression suite, `node tools/symbolic-regression.mjs`) and `neuro_english` (correct English that SymbolicLM does not analyse correctly, with a rewrite that it does handle where known; material for SymbolicProofingLLM). Their sealed tests are `eval/suites/<name>/test.jsonl`; `node tools/datasets/build-three-datasets.mjs assemble` and `node tools/eval/three-datasets-suites.mjs assemble` rebuild them and `node tools/datasets/verify-three-datasets.mjs` checks them. The legacy corpora above (`formalizer-v1`, `proofing`, `proofing-diverse-dev`, `clean-english`, `diversity`) moved unchanged to `datasets_archive/` and remain the provenance inputs and the gold-SOP arbiter.

With independently supplied prediction rows containing `id` and `sop`, run `node eval/run.mjs --file <suite.jsonl> --predictions <predictions.jsonl> --out <report.json>` (a library and archive evaluation of saved predictions). Execution comparison on the finite verification worlds is not universal semantic equivalence or trained-model evidence.

The source-to-knowledge workflow is described by `skills/material-to-sop/SKILL.md`. Its Node CLI prepares UTF-8 TXT/MD material in a private workspace, checks quoted SOP drafts and runs isolated candidate-rule probes; it does not review source truth or authorize publication by itself. The host must approve a scoped HARD rule and its positive, negative and boundary probes before freezing or publishing. See the skill's bundled fixtures for its exact input format.

The corpus manifests report the actual rows by split, family, question type, language, noise level and code-switch kind. FormalizerLLM (archive) targets contain model-language declarations only; full-program cases belong to the separate system-evaluation track. The earlier query curriculum and research corpora (DS009, DS015, DS018, DS019) were deleted with the regeneration of 2026-09-28. These datasets are **not training-qualified**.

`skills/semantic-sop-review/SKILL.md` handles harmless syntax separately from
semantic differences: guarded discriminating worlds, an actual LLM review for
unresolved equivalence, and a separate principal decision. The worked review
and limited acceptance are in `eval/reports/current/semantic-review/`; they
are not human review or training authorization. `resolve` performs scoped
host-lexicon lookup; unknown or ambiguous names never become a fuzzy winner.

Current progress and blockers are maintained in [TODO.md](TODO.md); the dated project journal is `status/journal.jsonl` and the topic notes are `status/notes/`, both shown under `/experiments`.
The local evidence index is `eval/reports/current/review-readiness.json`;
the corpus is not qualified and training is not authorized.

## Documentation

Start with the [documentation overview](docs/index.html), read the [wire help](docs/wire_types.html) (every wire and keyword with executed examples, how the model writes, and the eighteen question types), consult the [canonical wiki](docs/wiki.html) for project terms, and use the [specification matrix](docs/specsLoader.html?spec=matrix.md) for the authoritative requirements. Root [AGENTS.md](AGENTS.md) is the only coding-agent guidance file. Original source requirements and references remain preserved under `probably_obsolete/legacy/`, separate from the current English explanations; [CHANGES.md](CHANGES.md) retains earlier history. Outstanding work belongs in `TODO.md`, not an asserted runtime guarantee.
