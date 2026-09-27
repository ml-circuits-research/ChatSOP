# ChatSOP

ChatSOP separates a small model's description of a problem from its symbolic execution. The model emits only `premise`, `query`, and `constraint` declarations. The host validates them and generates the required resolution, collection, solving, rendering, and clarification operations. A person or approved tool can also supply a full trusted SOP circuit. Memory and reasoning remain separate from model weights. This repository does not ship a ChatSOP-fine-tuned model or a complete OpenAI-compatible ChatSOP HTTP server.

## Prerequisites

Use Node.js 22.13 or newer, including the built-in `node:sqlite` module. The symbolic CLI uses Node built-ins and the root `package.json` has no third-party npm dependencies. SWI-Prolog and Z3 are optional reasoning backends and are not needed for the reference JavaScript route. Python and ML packages are needed only for training/model inference operations; their declared requirements and unresolved version/license information are in [dependencies.md](dependencies.md). Do not download a model or install an optional solver to run a symbolic example.

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

`init` publishes a reviewed fictional fixture into the configured local state directory; `run` executes the specified `.sop` file. Other checked commands include `validate --file <path>`, `compile-smt --file <path>`, `compile-prolog --file <path>`, `fork`, `commit`, `discard`, `stats`, `maintain`, and `gc` (a dry run without `--apply`). The path passed to `--file` is the caller's input path. A separate configuration can be selected with `--config config/runtime-reference.json`; profiles choose the physical memory engine and reasoning strategy independently. `node examples/reasoning-demo.mjs` exercises the bundled symbolic demonstrations; `npm test` and `npm run verify` invoke repository checks without claiming neural evaluation. Commands can write state or reports; inspect the selected profile and target paths first.

## Local conversation

`node server/cli.mjs chat --config config/runtime.json --cnl-only` uses the configured formalizer endpoint and deterministic controlled-language output; remove `--cnl-only` only when a separately qualified verbalizer endpoint is available. The default config names a local inference URL, not a bundled model or an automatically launched service. A model's SOP proposal passes validation, policy guards and symbolic execution before the answer is returned. Model text and supplied documents cannot publish privileged definitions or choose their own user identity. See [Runtime](docs/runtime.html) for the local execution boundaries.

Relations use whitespace-separated terms, for example `where temperature room_a ?degrees`; parentheses and commas are not SOP relation delimiters. Quote a multiword term, such as `"Maria Ionescu"`. Use explicit `all`/`any`/`end` blocks for Boolean grouping. Solver-internal Prolog/SMT and system-side expressions retain their own syntax.

The model's `premise` is a conditional interpretation of context, not a verified `fact`. The host retains these interpretations in conversation-local context with the original message and does not write them to the knowledge repository. Sourced facts and explicit `remember` operations belong to trusted system/tool circuits; `remember` records information in a session and host `commit` remains separate. A blocked identity or required nonunique scalar triggers a generated clarification rather than a model-authored `clarify`. Lack of factual support remains an unknown reasoning result.

`Runtime.run(source, {origin: 'model', inputText, language, context})` enforces this boundary. It returns both `authoredSop` and the generated `executionSop`, conditional `contextPremises`, result packets, and traces. The caller owns `{premises: []}` for the conversation; unrelated conversations must use separate contexts. Full trusted circuits use the default runtime origin. This keeps the model's learning task small while symbolic orchestration can evolve independently.

## Start the local HTTP server

Configure and start an independently qualified local formalizer endpoint at the `formalizer.url` in `config/runtime.json` first. For a base model, select its serving profile explicitly and provide a bearer credential:

```sh
CHATSOP_API_KEY='replace-with-a-long-private-token' CHATSOP_PROMPT_PROFILE=formal node server/http.mjs
```

The server binds `127.0.0.1:3000` by default; set `CHATSOP_PORT` to change the port, and stop the foreground process with Ctrl-C. `GET /healthz` checks process liveness; authenticated `GET /readyz` returns HTTP 503 with `model_available: false` until the configured formalizer model is reachable. `GET /v1/models` and `POST /v1/chat/completions` are supported; non-streaming and verified-result SSE (`stream: true`) are available. Supply `Authorization: Bearer <token>`, the listed model `chatsop-local`, one new user message, and optionally a stable `conversation_id`. The endpoint owns prior context and stores per-principal conversations under the repository root. For separate users, provide separate credentials through the programmatic `createServer({authTokens})` API; one shared token represents one user.

Fine-tuned models instead require an explicit `bare` profile and matching backend identity metadata; `bare` sends only CONTEXT + MESSAGE, while `formal` includes the base-model instruction prompt. Mixing these profiles invalidates evaluation. There is **no trained checkpoint included**, so a real model-backed smoke and successful readiness cannot be claimed from this checkout alone. `chatSop.trustedSop` is the authenticated, explicit `fact`/`event`/`remember` circuit for session recording; model-authored SOP never records facts. Tools, Responses, and embeddings are not implemented. See [DS016](docs/specsLoader.html?spec=DS016-local-server.md) for limits, errors, security and trace fields.

## Training and evaluation boundaries

`node training/cli.mjs --help` lists the model workflow. The controller owns explicit preflight, download, train, token audit, merge and serving operations; Python ML implementation lives under `training/python/`. Base weights belong under `models/<model>/bases/<pinned-revision>/`; run-specific roles belong under `models/<model>/<run>/<role>/`. `config/train-gemma.json` and `config/train-qwen.json` are recipes, not trained weights. Do not start training or serving without a qualified environment, an actual pinned model, reviewed corpus and appropriate permissions. The original seed is preserved in `datasets/seed/`; results in `eval/reports/history/` are historical, not a new run. The [Training](docs/training.html) chapter and [DS008](docs/specsLoader.html?spec=DS008-data-evaluation.md) set the evidence and data-rights boundaries.

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

On this host the explicit Podman build and a single CUDA CDI/BF16
infrastructure preflight completed successfully; evidence is in
`models/.container-runs/image-provenance.json` and
`models/.container-runs/spark-preflight-1/`. Owned-container stop and
concurrent-job refusal were also exercised in `spark-stop-probe-1`.
No optimizer/model training or GPU training-pressure qualification is implied.

For a deterministic synthetic pilot, run `node tools/datasets/build-pilot.mjs --out <new-train-dir> --eval-out <separate-new-eval-dir> --worlds 100 --seed 731`, then `node tools/datasets/validate.mjs --manifest <new-train-dir>/manifest.json --execute`. Dataset-conversion code lives under `tools/datasets/`; `datasets/` itself holds only data artifacts. The generator writes into its output directories, so choose new paths. The validator checks fixture consistency and isolated executable outcomes, not human source review or language-model accuracy; third-party corpora remain subject to separate rights review.

To export the authored EN/RO evaluation cases into a new file, use `node eval/suites/core.mjs --out <new-suite.jsonl>`; the command refuses to overwrite its target. With independently supplied prediction rows containing `id` and `sop`, run `node eval/run.mjs --file <suite.jsonl> --predictions <predictions.jsonl> --out <report.json>`; `--config <runtime.json>` selects a configured formalizer endpoint instead of saved predictions. The suite has six case families and twelve language rows, is separate from generated seed templates, and is not human-validated or statistically representative. Execution comparison on these finite worlds is not universal semantic equivalence or trained-model evidence.

The source-to-knowledge workflow is described by `skills/material-to-sop/SKILL.md`. Its Node CLI prepares UTF-8 TXT/MD material in a private workspace, checks quoted SOP drafts and runs isolated candidate-rule probes; it does not review source truth or authorize publication by itself. The host must approve a scoped HARD rule and its positive, negative and boundary probes before freezing or publishing. See the skill's bundled fixtures for its exact input format.

The reviewable query curriculum is `datasets/query-v1/`; its manifests report the actual semantic cases, surfaces, languages, and evaluation tracks. Formalizer targets contain declarative model input only. Full-program cases belong to the separate system-evaluation track, not the small model's training targets. The sealed source-reference suite remains excluded from training and selection. [DS009](docs/specsLoader.html?spec=DS009-query-curriculum.md) describes the source visions, full runtime inventory, input modes, compositions, and remaining coverage gaps. These datasets are **not training-qualified**.

`skills/semantic-sop-review/SKILL.md` handles harmless syntax separately from
semantic differences: guarded discriminating worlds, an actual LLM review for
unresolved equivalence, and a separate principal decision. The worked review
and limited acceptance are in `eval/reports/current/semantic-review/`; they
are not human review or training authorization. `resolve` performs scoped
host-lexicon lookup; unknown or ambiguous names never become a fuzzy winner.

Current progress and blockers are maintained in [TODO.md](TODO.md).
The local evidence index is `eval/reports/current/review-readiness.json`;
the corpus is not qualified and training is not authorized.

## Documentation

Start with the [documentation overview](docs/index.html), consult the [canonical wiki](docs/wiki.html) for project terms, and use the [specification matrix](docs/specsLoader.html?spec=matrix.md) for the authoritative requirements. Root [AGENTS.md](AGENTS.md) is the only coding-agent guidance file. Original source requirements and references remain preserved under `docs/legacy/`, separate from the current English explanations; [CHANGES.md](CHANGES.md) retains earlier history. Outstanding work belongs in `TODO.md`, not an asserted runtime guarantee.
