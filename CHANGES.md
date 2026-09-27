# Explicit Boolean groups and concrete component documentation

Added native all/any/end groups to query where/filter and constraint require/claim fields, with bounded nesting and canonical round-tripping. Query execution preserves alternatives, correlated bindings, temporal intersections, explicit opposite evidence, and shared search limits. Selected/filter variables must be bound across alternatives or by shared conjuncts. Retrieval, abduction, diagnostics, context guards, and semantic fingerprints understand grouped conditions.

Expanded wire help with variable scope, explicit output materialization, structure/array intuition, and engine result-contract responsibilities. Rewrote the wiki around a concrete question, component call flow, model/code/data distinctions, and actual memory/reasoning implementation choices. Formalizer is an NL-to-SOP role, not a model size. Current explicit CNL requirements are distinguished from intended host-implicit rendering. Atom punctuation and arithmetic syntax remain unchanged; no training was run.

# Quoted-text authoring convention

Documented double-quoted free-text emission in DS004, wire help, and synthetic-data, ingestion, semantic-review, and lexical-curation skills. Whole-line text consumers can accept bare input; canonical authored text uses quotes consistently. The convention preserves name spelling, distinguishes a mention from a resolved identity, specifies JSON escaping and transport layers, and records the executable atom limitation for variable-shaped quoted strings. Parser behavior, datasets, and training are unchanged.

# Wire reference help

Replaced the flat wire inventory with a two-pane help browser and 41 English topic pages: 35 runtime types, three host-ontology declarations, and three shared authoring topics. Each wire page explains field grammar, cardinality, defaults, references, effects, valid examples, and rejected or unsafe uses. The executable profile and the simplified syntax proposal remain distinct. Small-formalizer education excludes JavaScript generation; system evaluation and coding-agent capabilities have separate boundaries.

Added shared-header support for nested documentation pages and linked Wire help from the documentation menu and map. Normalized the affected skill instructions to English and made the English-only authoring rule explicit in repository guidance. No parser, training data, or design-specification migration is included.

# Repository reorganization

Executable Node modules use `.mjs` with `sop/`, `memory/`, and `reasoning/` at the root; `server/` owns the local agent and CLI. Training orchestration lives under `training/` with indispensable Python ML code under `training/python/`; model caches and run outputs are organized under `models/<model>/`. Original requirements/references remain under `docs/legacy/`, and historical reports under `eval/reports/history/`. Root `README.md`, `AGENTS.md`, `dependencies.md`, and `docs/specs/` describe the current contracts. These moves do not establish a trained checkpoint, GPU qualification, externally verified solver availability, or a public OpenAI-compatible ChatSOP server.

# 0.7.0 — SOP agent 3

Independent reasoning registry (reference/advanced), real SQL+associative hybrid bank, typed epistemic objects, automatic finite abduction, diagnosis, induction, association, analogy, deterministic planning, causal-Horn interventions and finite optimization. Prolog/Z3 remain optional adapters with explicit route/fallback. Model sources cannot certify closed traces or install privileged definitions.

Added requirements 23–29, executable wire catalog, reviewed procedure examples, research skills, regenerated SOP/CNL seed datasets, semantic execution signatures and cross-strategy matrix. Fixed partial-premise Horn joins under budget cutoff and protected pinned/archive aging for nested hybrid Holo banks. Hypothetical inference does not reinforce observed facts.

Neural training and deployment validation are separate steps, not claimed results.

# 0.6 — comparable memory engines

Four engines share one contract: Weaver, H7/Holo, SQLite, and scan. The release includes an H7 core, an argument adapter, and an experiment reconstructing SOP from handles. SQLite uses parameterized queries and FTS, with a minimal single-file base, temporal data, and copy-based forks. The engines integrate with layers and shards. Weaver dictionaries use a membership cache to avoid quadratic scans when ingesting distinct identifiers. Rules, SOP data, and the fine-tuning pipeline are unchanged.

# RecallSOP 0.5.0 — local shards

The `sop-agent-2` language remains unchanged. The default organization is generational: a bounded cache or archive, separate pinned data, conservative predicate routing, proof-based promotion, explicit read limits, and private checkpoints without reattaching evicted data.

Persistence uses content-addressed shards, manifests, session isolation, and garbage collection of unreachable objects. Corrections, original validity on promotion, and library versions for `asof` are preserved. Migration from the old format is explicit.

The release's historical entry points were `StartSOP.md` and `docs/requirements/18-sharduri.md`; executed results were recorded under `reports/verification.json` and `reports/shards/`. Fine-tuning, model weights, and neural testing were outside that run.
