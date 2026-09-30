# Night orchestration: bounded ownership, observable recovery

Long-running work needs one accountable owner, a durable run identity, and a finite
stop/recovery procedure. This skill is methodology, not an alternative launcher.
ChatSOP's training authority is `node training/cli.mjs`; its optional container
entrypoint lives under `training/container/`. Do not copy old shell supervisors
into another project or launch by matching process names.

**Present approval gate:** build and preflight may be prepared, but no training,
resume, fine-tuning or optimizer steps (including smoke runs) until the user
provides a new explicit approval. A passing dataset or CUDA preflight does
not authorize the run.

## Before launch

1. Write a run hypothesis, model revision, recipe, immutable dataset manifest
   and output role. Review model/data rights, dataset quality and available disk.
   Use a new run identity for a changed dataset or recipe.
2. Check the one-GPU rule across native and container jobs, not merely within a
   terminal. The training controller takes an atomic exclusive lock under
   `models/.training.lock/` for its owned child lifetime. Inspect its `owner.json`
   and verify the PID/host before treating a lock as stale; never remove a live
   lock to force another worker.
3. Run the controller's preflight in the environment that will train. Inspect
   host `MemAvailable`, device-reported free memory, disk headroom, effective
   cgroup limits and existing GPU consumers. On GB10 unified memory, CUDA
   device free and Linux available memory describe overlapping pressure, not
   separate additive budgets. Neither `memory.max` nor an image by itself
   proves a bound on driver/device allocations or filesystem cache.
4. Choose a finite run budget and checkpoint cadence consistent with measured
   save size and free disk. Keep reports and incomplete checkpoints distinct.
   Never promise unattended progress from a detached session or an import check.

## During and after the run

Observe the owned launcher/container, GPU memory, `memory.current`,
`memory.events` (`oom`, `oom_kill`), disk and last complete checkpoint. A frozen
log is a diagnostic, not a reason for unbounded restarts. Stop only the
identified owned launcher PID or container ID/name; allow its child group to
exit and check GPU memory has been released. Do not use `pkill -f` or generic
worker names, restart the driver, invoke `drop_caches`, or allocate anonymous
memory to squeeze page cache. If memory is low, stop and inspect competing
consumers and cgroup events; reduce the next run's explicit resource demand
only after diagnosing the failure.

An exit line is not an artifact. Retain the run identity, logs, reports and
`best` winner; resume only from a complete `latest` checkpoint with verified
digests, optimizer and RNG state and matching dataset/recipe/model identity.
An interrupted checkpoint is not promotable. Prune only explicitly identified
closed runs after confirming their retained winners and reports. Never start
an automatic unlimited retry/restart loop.

## ChatSOP commands

Start at the root with `node training/cli.mjs --help`. For a reviewed native
Python environment, run `TRAIN_PYTHON=<venv>/bin/python node training/cli.mjs
preflight`, then `node training/cli.mjs train --model qwen --run <name>
--role formalizer --data <reviewed-dataset> --qualification <qualification.json> --authorization <new-user-approval.json>` with the same `TRAIN_PYTHON`, only after that new explicit user approval.
Use `--resume` only for a verified same-identity checkpoint. `--dry-run` checks
configuration without Python/GPU work and is not hardware qualification.
The run's `models/<model>/<run>/<role>/identity.json`, `latest/`, `best/`,
`semantic/` and `summary.json` are the records to inspect; a formalizer's
semantic best is chosen by full-development execution equivalence with syntax
as tiebreak. Verbalizer/shared dev-loss best does not certify faithfulness.
For the container variant follow `skills/spark-training/SKILL.md`; it still
executes this same controller, not a second ML training implementation.

## Project journal

Append an event to `status/journal.jsonl` with `node tools/journal.mjs add --area <area> --state <started|progress|done|blocked|decision> --title "…" --detail "…" [--link <path>]` whenever you start, finish or block a meaningful task or record an owner decision; the journal is append-only and the server's `/experiments` pages shows it to the owner in real time (AGENTS.md, "Project journal"). Log each owned run's start, checkpoint, stop, block and recovery with `tools/journal.mjs` so the owner sees it live on `/experiments`.

Also record what each run obtained, every failed or restarted attempt and every owner decision taken overnight as topic notes: `node tools/notes.mjs add --topic <training-experiments|evaluation|process-and-decisions|…> --kind <experiment|result|observation|correction|decision> --title "…" --body "…" --link <log or report>`. Notes are append-only; a correction is a new note with `--supersedes <note id>`. The morning report the owner reads is the `/experiments` index and the task pages.
