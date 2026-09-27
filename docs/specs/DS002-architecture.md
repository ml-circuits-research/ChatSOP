---
title: DS002-architecture
summary: Module ownership, runtime flow, and separation of knowledge, models, and evaluation.
---

## Introduction

ChatSOP accepts a checked [SOP](wiki.html#definition-sop) program from a file or a locally connected [formalizer](wiki.html#definition-formalizer), and executes it using explicit memory and reasoning components. The CLI is a local program; the limited inference adapter is not a public ChatSOP-compatible API server.

## Core Content

### Directory responsibilities

`lib/` holds utility, time, and shared type code; `sop/` owns parsing, typing, lowering, controlled language, lexicon, ingestion checks, and runtime orchestration. `sop/grammars/` carries grammar resources, `sop/contracts/` holds the generated capability catalog, `knowledge/` carries approved initial SOP knowledge, and `config/` contains runtime profiles and ontology. `memory/` owns [repository](wiki.html#definition-repository) snapshots, session isolation, retention, and interchangeable banks. `reasoning/` owns linking, solver selection, and external backend adapters. `server/` contains only the local conversational orchestration, model endpoint client, prompts, and CLI. The kernel must not depend on `server/`.

### Data and model isolation

`datasets/seed/` retains the original generated seed; `datasets/` carries subsequent sourced and reviewed corpora. `eval/` holds evaluation code and immutable historical reports at `eval/reports/history/`; fresh reports belong in `eval/reports/current/` with their own observed run metadata. `models/<model>/<run>/` separates model identity from the run's training artifacts; a directory layout does not establish that a checkpoint exists or works. `training/` owns Node orchestration and the indispensable Python ML operations at `training/python/`. Source requirements, contracts, and references remain available under `docs/legacy/` as historical evidence, not as an alternative current module layout.

### Trust and integration boundary

The CLI host initiates `init`, `run`, `validate`, `compile`, `chat`, and repository lifecycle commands. The parser and runtime reject unsupported fields or unauthorized effects before committing. [Linking](wiki.html#definition-linker) selects approved definitions and relevant premises; a solver receives explicit typed inputs, not unrestricted authority to search or publish. [CNL](wiki.html#definition-cnl) reports the result and supporting information. Any further OpenAI-compatible HTTP facade requires an implemented host contract; the limited local inference endpoint alone must not be represented as `GET /v1/models` plus `POST /v1/chat/completions` for ChatSOP clients.
