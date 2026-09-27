# ChatSOP agent guidance

## Scope

This is the single root instruction file for changes to ChatSOP. The product's checked `sop-agent-3` profile turns natural-language proposals or explicit `.sop` programs into results grounded in reviewed knowledge. Follow the current user request, this guidance, and the design specifications; track outstanding work in `TODO.md` and delivered work in `PAS_TASK.md` without presenting either as product documentation.

## Direction

1. Sequence work from this repository refactor through sourced datasets, ingestion skills and evaluation, then qualified training, API work and controlled comparisons, then an evidence-backed article. `TODO.md` tracks the actual gates; product documentation never asserts progress.
2. Coordinate all training and GPU inference/evaluation under a single GPU-intensive worker per machine. Do not add concurrent GPU jobs, kill unrelated work, or clean unknown checkpoints. A preflight and an import alone do not establish a valid training run.
3. The current user explicitly prohibits training until **new explicit approval**. Image build, dependency setup, CUDA infrastructure preflight, safe stop and dataset qualification are allowed; no `train`, `--resume`, fine-tuning, optimizer step or training smoke run is authorized. Approval is never inferred from a passing preflight or qualification report.
4. Keep two learning flows distinct: the small formalizer maps questions and supplied assertions to SOP; material ingestion extracts quoted source claims and requires independent host approval before knowledge accumulates. New knowledge need not retrain a model.
5. Keep the small model's authored language to `premise`, `query`, and `constraint`. The host generates inspectable execution circuits for resolution, collection, solving, rendering, and clarification. Do not teach the model to emit plumbing operations. Contextual premises are attributed model interpretations, used conditionally and retained only in caller-owned conversation context; they are not sourced facts or implicit repository writes. `remember` is a trusted runtime operation, not a TDD assertion or model instruction.
6. SOP relations use whitespace-separated terms and JSON-quoted text, not parentheses or commas. Boolean conditions use explicit `all`/`any`/`end` groups. Preserve genuine JavaScript, solver syntax, and exact source quotations separately from SOP grammar.

The normative contracts behind these rules live in the DS set; where this file and a DS disagree, the DS is the source of truth for documented behavior.

Write persistent documentation, specifications, instructions, and code comments in clear English. Keep intentional linguistic data and exact quoted source material in their original language.

## Mandatory Reading Order

1. `README.md`, then `docs/index.html`, `docs/runtime.html`, `docs/training.html`, and canonical terminology at `docs/wiki.html`.
2. `docs/specs/matrix.md` and the relevant DS files: `DS001-coding-style.md` is authoritative for style, module structure, size guidance, and test organization; `DS002` architecture; `DS003` main behavior; `DS004` SOP language; `DS005` memory; `DS006` reasoning; `DS007` training; `DS008` data and evaluation; `DS009` query curriculum; `DS010` common contracts; `DS011` experiment preregistration; `DS012` strategy/backend routes. Design specifications are the source of truth for documented behavior and structure; keep them declarative, gap-free in numbering, and synchronized with the HTML pages.
3. `vision/SOP_dataset.docx` and `vision/SOP_CommonSense_v2.docx` for corpus and ingestion direction; `article/direction/*.docx` for publication direction. These establish direction, not measured outcomes.
4. Preserved requirements under `docs/legacy/requirements/` (start at its `README.md`, `00-arhitectura.md`, `01-sop.md`, then chapters 13–30) and the affected implementation and tests; check current executable behavior against historical text.
5. Task skills: `skills/training-rules/SKILL.md`, `skills/training-runbook/SKILL.md`, `skills/night-orchestration/SKILL.md` for training; otherwise the owning `skills/<name>/SKILL.md`. The two matching `.agents/skills/training-*` entries point to the corresponding local skill folders; other `.agents/skills/` entries point to an external task-skill catalog and do not supersede this root file or the DS contracts. Product workflows under `skills/` are task procedures, not independent runtimes; `material-to-sop` keeps drafts and candidate rules unapproved until scoped probes and host authorization. The catalog is listed in `skills/README.md`; update it when implemented product skills change.

## Runtime Defaults

Node.js >=22.13 with `.mjs` modules, explicit imports, `node:` built-ins, async/await, and module-relative resources. Prefer built-ins and small auditable local code; record any necessary dependency in root `dependencies.md` or the owning skill's record. Keep Python only for indispensable model training and inference under `training/python/`; never install solvers, models, or packages, and never run GPU work merely to start the symbolic runtime. `docs/specs/DS001-coding-style.md` holds the full effective contract.

## Key Paths

`docs/index.html` is the HTML entry, `docs/runtime.html` explains execution, `docs/training.html` covers model/data boundaries, `docs/wiki.html` defines terminology, `docs/specs/` holds the authoritative DS set, and `docs/specsLoader.html?spec=matrix.md` opens its matrix. `lib/`, `sop/`, `memory/`, `reasoning/`, and `server/` separate runtime concerns; `config/` contains profiles; `tools/` owns conversion, validation and review tooling (`tools/datasets/` for data pipelines); `datasets/` holds data artifacts only, with the raw source cache at `datasets_sources/`; `models/<model>/<run>/`, `eval/`, `examples/`, and `tests/` own their respective artifacts (demo/fixture SOP lives under `tests/fixtures/`). `docs/legacy/` preserves original requirement evidence; `eval/reports/history/` preserves historical observations and `eval/reports/current/` fresh ones. Verify changed paths through executable behavior before reporting results.
