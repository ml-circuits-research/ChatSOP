# Training runbook for small models on synthetic data

Read `training-rules` for experimental methodology and `night-orchestration`
for bounded ownership. This runbook distinguishes portable design from the
actual ChatSOP controller; imported project-specific queues, evaluation
chains, shell sentinels and process-name watchdogs are not ChatSOP commands.

**Present approval gate:** complete image build, CUDA infrastructure preflight
and dataset qualification, but do not run `train`, `--resume`, fine-tuning or
optimizer/smoke training until the user supplies a new explicit approval.
Preparing an arm does not grant that approval; sections 3–5 below describe
the later qualified workflow only.

## 0. Design the arm

One arm tests one recorded hypothesis. Record model ID and pinned revision,
recipe, role, data manifest/hash, rights and review status before training;
use a new run name for a changed identity. Inspect `node training/cli.mjs
--help` and `config/train-*.json`. Do not use an experiment name as a
substitute for an identity manifest.

## 1. Verify and freeze data

Keep semantic variants in the same split. Check provenance, rights, tokenizer
behavior, target truncation, independent answer reproduction and absence of
train/dev/test leakage. `node tools/datasets/verify-corpus.mjs --corpus
<corpus> --all` verifies generated fixture outcomes, not human truth or model
quality; `node tools/datasets/audit-corpus.mjs --corpus <corpus>` is the
machine audit (skill `corpus-audit`), `node tools/datasets/no-copy.mjs` the
source no-copy check, and the owner reviews rows at `/audit` on the server.
`node tools/research/prepare-experiment.mjs` writes the message-only
projection the trainer reads (`datasets/<corpus>/formalizer/{train,dev}.jsonl`,
manifest `prompt_profile: message-only`): every prompt is exactly the user's
message, with no context, identifiers, lexicon or clock. The current corpora
are `formalizer-v1` (train/dev; sealed test in `eval/suites/formalizer-v1/`)
and the out-of-distribution suite `formalizer-ood-v1` (sealed test only).
Large splits are stored as `<split>.part-NNN.jsonl` shards under 50 MB and
read through `lib/jsonl-shards.mjs` (Python: `training/python/common.py`).
Freeze the dataset before a GPU run. Preserve the sealed holdouts for
evaluation rather than selection.

## 2. Qualify the environment

Choose reviewed native Python or the explicit rootless Podman image procedure
in `skills/spark-training/SKILL.md`. Run `TRAIN_PYTHON=<reviewed-venv>/bin/python
node training/cli.mjs preflight` natively (or the container's documented
preflight). Check exclusive owner, disk, host/device memory, base revision,
ML packages, checkpoint identity, CUDA BF16 forward/backward and device
behavior. A successful `--dry-run` does not run Python or prove GPU readiness.
Do not install dependencies or download weights implicitly at startup.

## 3. Run a bounded arm

After a separate explicit approved base download, train from the root via
`TRAIN_PYTHON=<reviewed-venv>/bin/python node training/cli.mjs train
--model qwen --run <new-run> --role formalizer --data <reviewed-dataset>
--qualification <qualification.json> --authorization <new-user-approval.json>`.
The controller refuses to train without a `chatsop-dataset-qualification-v1`
record (status `qualified`, every check with evidence, a named reviewer) and a
`chatsop-training-authorization-v1` receipt of the owner's new explicit
approval; never write either receipt on the owner's behalf.
The corresponding Podman command must run the *same* Node controller with
CDI and an explicit existing image. Select a finite step budget in the
reviewed recipe and record resource limits and checkpoint cadence. One GPU
worker at a time across native and Podman. No unlimited auto-restart.

## 4. Monitor, stop, recover

Watch the owned process/container, its logs, `models/.training.lock/owner.json`,
disk and GPU/host memory, and any cgroup `memory.events` for OOM or OOM kills.
Stop by the confirmed launcher PID with SIGINT (which signals its owned child
group), or by the exact owned container ID/name through its documented stop
command; wait for exit. Never kill by Python/worker name or restart the GPU
driver. Inspect `models/<model>/<run>/<role>/identity.json`, `latest/`,
`best/`, `semantic/` and `summary.json`. The complete `latest` checkpoint
needs matching identity and digest-marked model, optimizer and RNG state
before `--resume`; keep incomplete artifacts for diagnosis, not promotion.
Keep the `best` winner and reports when removing only explicitly owned,
closed-run intermediates.

## 5. Evaluate independently

The formalizer's full-development predictions at saves are scored by
`eval/run.mjs` for execution equivalence, with syntax as tiebreak; those
development metrics select `best`, not the sealed test score. Evaluate
the selected winner once on each sealed holdout (`formalizer-v1` and
`formalizer-ood-v1`) and report counts by family, question type, language,
noise level, negative/UNKNOWN case, and reasoning outcome. The
verbalizer/shared dev-loss best is diagnostic, not proof of faithful
wording. A log completion line, a checkpoint directory and a generated
fixture are not evidence of general model quality. Explicitly label any
additional baselines, retry experiment, GGUF export or server benchmark
as separate qualified workflows, never automatic stages of training.

## Project journal

Append an event to `status/journal.jsonl` with `node tools/journal.mjs add --area <area> --state <started|progress|done|blocked|decision> --title "…" --detail "…" [--link <path>]` whenever you start, finish or block a meaningful task or record an owner decision; the journal is append-only and the server's `/project` page shows it to the owner in real time (AGENTS.md, "Project journal"). Log every preflight, qualification, approval request, start, stop and evaluation with `tools/journal.mjs` (area `training` or `eval`), and keep the arm's record in `status/experiments.json`. Training remains prohibited until the owner's new explicit approval.
