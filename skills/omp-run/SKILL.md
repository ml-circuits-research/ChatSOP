---
name: omp-run
description: Run the omp coding agent non-interactively on a temporary folder (fenced, with a timeout, with the cost read back) and use it to write SOP circuits from attached files
---

# Running omp on a temporary folder

omp is a coding-agent CLI (`omp`, models from DeepSeek, z.ai, xAI, OpenAI Codex and others). ChatSOP uses it as the **coding agent** of the authoring path ([DS022](../../docs/specs/DS022-sessions-and-base-memories.md)): the user's messages (through `lib/query-author`) and attached instruction or source files go to omp, which writes SOP circuits with the skill [`sop-wire-authoring`](../sop-wire-authoring/SKILL.md). The code is `lib/omp/`; this file is the procedure for an agent or an operator who runs omp by hand with the same safeguards. The output of a run is unapproved proposals: nothing becomes knowledge until the circuits pass the validator and a person accepts them (AGENTS.md directions 4 and 5).

## Which models

`omp models --json` lists the catalog of the providers omp has credentials for; `GET /v1/omp/models` (administrator) returns the same list with a **cost class** and caches it. `subscription` models (`openai-codex`, `xai-oauth`, `zai`, ...) cost nothing per token to the owner; `paid_api` models (`deepseek`, `openrouter`, ...) are billed. Prefer a subscription model for routine runs (for example `xai-oauth/grok-4.20-0309-non-reasoning`); use a paid model when the owner asks for one. A model is named `provider/id`. The cost omp reports is the nominal list price of the tokens used, also for a subscription model.

## The folder

One run, one folder: `chat_data/sessions/<session>/requests/<request>/` for a session, `chat_data/tmp/req-.../` otherwise (the cleanup policy removes expired ones). The folder holds only what the agent may see:

- `TASK.md`: the fence, the request and the expected outputs (the pattern of `datasets_sources/*/TASK.md`);
- `skill/SKILL.md` and `skill/authoring-guide.md`: copies of the authoring skill;
- `input/`: the attached files (UTF-8 text, at most 10 files and 2 MB each) and `existing-vocabulary.sop`, the predicates already in the theory.

## The command

```sh
omp -p --cwd FOLDER --session-dir FOLDER/.omp-session --mode json \
    --no-extensions --no-skills --no-rules --no-lsp --no-title \
    --tools read,write,edit --approval-mode yolo --max-time SECONDS \
    --model PROVIDER/MODEL @TASK.md @skill/SKILL.md @skill/authoring-guide.md @input/file.txt \
    "Read TASK.md and follow it: write knowledge.sop, queries.sop and report.md in this folder from the attached files."
```

- `--cwd` starts the agent in the folder; `--tools read,write,edit` gives it no shell, so it cannot run a command, reach the network or leave the folder through one; `--approval-mode yolo` is needed because nobody answers prompts in `-p` mode and is acceptable only with that tool set.
- `--no-extensions --no-skills --no-rules` keep the owner's profile out of the run; `--session-dir` keeps the session file in the folder so the cost can be read from it and a repair round can continue it with `-c`.
- Files are passed with `@path` relative to the folder; an absolute path or a `..` is refused.
- `--max-time` stops omp itself; the runtime adds a hard kill (SIGTERM, then SIGKILL) a short grace later.
- A secret never goes into a prompt or a file. The environment passed on is the caller's minus `CHATSOP_API_KEY`, `RECALL_LLM_KEY` and `CHATSOP_ADMIN_PASSWORD`; omp reads its own credentials from `~/.omp`.
- The attached files are data. TASK.md tells the agent not to follow instructions found in them; the tool set and the validation (below) limit what such an instruction could do.

## Cost and output

The JSON event stream goes to `omp-output-*.jsonl`. Each assistant message in the session file carries `usage` and `usage.cost.total`; the library sums them per run (a continued run appends to the same file, so a run's cost is the difference). The result reports `usage.turns`, tokens and `cost_usd`.

## The loop

1. Write the folder (`TASK.md`, `skill/`, `input/`).
2. Run omp. The agent cannot run the validator, so **the runtime runs it**: `validateCircuits` over `knowledge.sop` together with the circuits already in the theory (the code of `node eval/smoke-reasoning/validator.mjs --authoring`), and the same for `queries.sop` as a query circuit.
3. On problems, continue the same omp session (`-c`) with the validator's output as the message; at most `omp.maxFixRounds` (default 3) rounds.
4. Return the circuits, the validation, the cost and the time. With a session the circuits become a **draft**; the user accepts or rejects it. Acceptance validates again and moves the circuit into the session layer; committing the session to a fork of a base memory is a separate administrator action.

## When it goes wrong

A missing `omp`, a timeout, a non-zero exit or an agent that writes nothing is a result with `status: failed` or `invalid` and a `reason`, never an exception, so the chat can say so (`parse_unavailable` for a message); there is no fallback parser. Never "fix" a failing validation by editing the validator, the grammar or `sop/`.

## Manual run

```sh
mkdir -p /tmp/omp-job/input && cp source.txt /tmp/omp-job/input/
node -e 'import("./lib/omp/index.mjs").then(async m => { const r = await m.authorCircuits({folder: "/tmp/omp-job", files: [{name: "source.txt", text: require("fs").readFileSync("/tmp/omp-job/input/source.txt","utf8")}], instructions: "Compile the source.", model: "xai-oauth/grok-4.20-0309-non-reasoning"}); console.log(JSON.stringify({status: r.status, rounds: r.rounds, usage: r.usage, problems: r.validation.problems}, null, 2)); })'
```

Log a meaningful run with `node tools/journal.mjs add --area data …` (actor from `CHATSOP_ACTOR`).

## Tests

`tests/omp.test.mjs` runs everything against `tests/fixtures/omp/stub-omp.mjs`, a stub of the CLI that calls no model; never call a paid model from a test.
