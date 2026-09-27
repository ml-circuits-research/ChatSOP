---
title: DS007-training
summary: Model roles, indispensable Python ML boundary, run artifacts, and preflight obligations.
---

## Introduction

A [formalizer](wiki.html#definition-formalizer) is trained to map a user question and supplied context into declarative `premise`, `query`, or `constraint` SOP, not execution-session plumbing, sourced facts, or clarification text; an optional [verbalizer](wiki.html#definition-verbalizer) rewrites an already determined CNL result without changing its meaning. Training is distinct from operating the local symbolic CLI, publishing reviewed facts, and proving semantic accuracy.

## Core Content

### Roles and input contracts

The model target is declarative `.sop`, not an executable host circuit, a JSON fact database, or free-form Prolog/SMT-LIB. A model `premise` carries conditional context (`holds` and optional `valid`, default `timeless`) without `source`, `quote`, or permission to store it. The host keeps original text and model-interpretation origin apart from admitted facts; separate approved operations assemble an inspectable circuit with identity lookup, assumptions, solving, CNL and, when identity or required scalar is missing/nonunique, generated `clarify`. Missing evidence alone does not require clarification. `fact`, `remember`, `pack`, `resolve`, `solve`, `cnl`, `clarify`, `value`, `jsEval`, and `expand` are not small-model target wire types. The formalizer receives allowed symbols and relevant definitions rather than authority to install new ones; no metaprogram may guess an ambiguous identity or turn a conditional premise into a stored fact. The verbalizer must preserve truth status, explicit negation, hypotheses, time, quantities, evidence and incompleteness. Deterministic CNL is the baseline for evaluating the formalizer; fluent rewriting does not fix invalid declarations or mistaken knowledge. A model artifact is not established by a training script or config alone.

### Runtime and artifact boundary

Node `.mjs` owns orchestration and portable checks; Python under `training/python/` is retained for indispensable ML libraries such as model loading, tokenization, optimization, adapter serving, and export that cannot be replaced responsibly by built-ins. The training controller lists its commands via `node training/cli.mjs --help`. Pinned base caches belong at `models/<model>/bases/<40-character-revision>/`; run-owned `identity.json` and `latest`/`best` checkpoint records belong at `models/<model>/<run>/<role>/`, preserving dataset and recipe identity. Source model identifiers and exact revisions must accompany actual artifacts. `server/` consumes an explicitly configured local model inference endpoint and may use CNL without a verbalizer. A locally running inference adapter is not the ChatSOP client-facing OpenAI service and does not establish `/v1/models` or `/v1/chat/completions` support.

### Startup and experimental constraints

Before any GPU-intensive launch, check exclusive ownership/lock, disk, host and device memory, Python and ML package compatibility, model revision, immutable dataset, resumable checkpoint, and writable run directory. A missing prerequisite must fail before substantive GPU or artifact work; the explicit `download` command must not be confused with implicit startup installation. `node training/cli.mjs` is the sole trainer/controller in both reviewed native Python and rootless Podman modes, and only one GPU-intensive worker may run per machine across those modes; concurrent GPU jobs, unrelated process kills, and cleaning unknown checkpoints are outside this contract. The retired orchestration shell scripts are not an alternative execution path. A successful Python import or dry-run does not establish hardware readiness or an accurate model. For the formalizer, `best` is selected using generated full-development-set predictions evaluated by `eval/run.mjs`, with execution-equivalence numerator primary and syntax numerator breaking ties; invalid reference or denominator mismatch must fail closed. Verbalizer and shared dev-…loss selection is only diagnostic, not a faithfulness criterion. Recovered checkpoints and claims must belong to the recorded run; holdout and independent human review remain necessary for model comparison and promotion under [DS008](specsLoader.html?spec=DS008-data-evaluation.md). External weight and corpus redistribution permissions remain independently reviewable.

The current operator has withheld authorization for training pending a new
explicit approval. Image build/dependency setup, CUDA infrastructure probes,
safe stop, dataset qualification and evaluation of existing artifacts may
proceed; neither those activities nor a successful preflight authorizes a
`train`, resume, fine-tuning, optimizer step or training smoke run. This is
an execution gate independent of dataset quality and hardware readiness.

### Rootless Podman boundary

The optional ARM64 training image is built explicitly from the reviewed
`training/container/` definition with pinned source and package versions.
Runtime uses an already present local image (`--pull=never`), NVIDIA CDI
`nvidia.com/gpu=all`, a repository code/dataset mount and narrowly writable
models/reports/cache mounts; it invokes the same Node controller rather than
an independent trainer. No privileged container, host-wide home mount,
implicit package/model download, driver mutation or cross-project cache
sharing is part of this contract. Verify rootless cgroup v2 CPU, memory and
PID limits on the actual host, not from configuration alone; preserve
inspection artifacts for any cgroup OOM or termination. On GB10 unified
memory the host and CUDA budgets overlap, and cgroup memory limits may not
bound all driver/device allocations. Check both available host RAM and
reported device free memory before/after GPU work. Never force page-cache
reclamation with memory allocation or `drop_caches`, restart the driver,
kill workers by generic process name or automatically restart without a
finite operator-approved budget. Stop only the owned container/launcher;
validate checkpoint digests, optimizer and RNG state before resuming, and
retain the semantic best and run reports. The concrete documented commands
and host-specific observations are in `skills/spark-training/SKILL.md`.
The 2026-09-27 local image build and `spark-preflight-1` CDI probe passed:
the latter recorded effective six-CPU/32-GiB/zero-swap/256-PID/1-GiB-shm
limits and a small BF16 forward/backward on NVIDIA GB10, exit 0 with no
reported OOM kill. Provenance and raw evidence live under
`models/.container-runs/`. This is infrastructure qualification only,
not training, a controlled stop, a GPU allocation bound, a cache-pressure
test or model-quality evidence; explicit user approval remains required.
