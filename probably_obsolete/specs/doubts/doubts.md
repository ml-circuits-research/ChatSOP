> ARCHIVED 2026-09-28 — superseded by questions.md (open owner decisions) at the repository root. Ids and paths inside this file use the numbering of the time.

# Open questions — decisions requested

Everything else raised by the archived `.docx` documents was resolved into the current specifications; these items need an author/operator decision or evidence that does not exist in the repository. Session decisions take precedence over any archived statement. Each item names the evidence, why it is unresolved, and the cheapest way to close it.

## From the vision documents (DS023)

1. **Ambiguous cases: review metadata or separate linked cases?**
   `probably_obsolete/vision/SOP_dataset.docx` (pipeline step 8) says to preserve genuine ambiguity instead of forcing a single SOP output, while the same document states each semantic case has one canonical target. Current contract: the model target stays singular, and a blocked dependency produces a host `clarify` with `pendingSop`/`required`/`next`; absence of evidence alone stays `unknown` (`docs/specs/DS009-query-curriculum.md`, `tools/datasets/schema.mjs`). **Decision needed:** record the alternative interpretations as non-exported adjudication metadata attached to the case, or as separate cases linked by `negative_of`/an ambiguity relation. **Cost to close:** one schema field plus a validator rule; no model change.

## From the reference documents (DS005/DS006)

2. **H7 evaluation target.** What measured task, metadata-inclusive memory ceiling and false-accepted-fact threshold would justify pursuing the still-unimplemented partial-cue two-plane architecture? Current adapters disclose growing metadata and no cue discovery (`memory/banks/holo.mjs`, `memory/banks/holo-wire.mjs`). **Decision needed:** accept the bounded fact-bank role as final, or preregister a measurement that includes total bytes and metadata.
3. **Archival pre-semantic traces.** Is long-term storage of original text traces and source documents wanted, and under which rights policy? The proposal asks for it; the current hybrid bank and `associate` only cover narrow fact/case roles, and `DS018-source-rights.md` leaves several corpora quarantined. **Decision needed:** approve a scoped archival store plus its rights policy, or declare it out of scope.
4. **Historical H7 numbers.** Keep the paper's five-seed table as a historical citation only, or rerun it with matched implementation, seeds, thresholds and total-byte accounting? Current scripts explicitly disavow reproduction. **Decision needed:** choose citation-only or a preregistered rerun (which needs the training-independent benchmark budget).

## From the direction and publication documents (DS025)

5. **Romanian manuscript role.** Independent draft, synchronized translation of the planned English paper, or historical v0.1 only? The editorial annex recommends English for international submission; `TODO.md` plans an English paper but does not decide synchronization. **Decision needed:** one of the three.
6. **First contribution category and venue.** Architecture/method paper, neuro-symbolic experiment paper, or a later JOSS software paper — and what minimum independent evaluation each requires. The annex lists options, not an accepted venue. **Decision needed:** pick the first target; recheck official calls and policies immediately before submission.
7. **Historical archive ownership and redistribution.** Who owns the A1–A3 local ZIP archives named in the manuscript, and where are their manifests, licence notices and immutable identifiers? They cannot be cited as current evidence until verified. **Decision needed:** name the owner and either verify rights or drop the citation.
8. **S4 teacher-reference protocol.** Which teacher permissions, model identity, knowledge access, and monetary/token budget make an S4 arm fair and legal relative to S0–S3? **Decision needed:** freeze the protocol in `DS011` before any run; no training is authorized meanwhile.
9. **Independent semantic adjudication of EN/RO holdouts and per-asset redistribution.** Who performs and records it, and which source-derived examples may be published? `DS018` leaves QA2D data, ProofWriter and AmbigQA unverified and QQP restricted; no review has occurred. **Decision needed:** name the reviewer and approve only rights-cleared examples.
10. **Project naming.** Keep the historical name `RecallSOP`, use `ChatSOP`, and how to distinguish `Recall Weaver` from either in the manuscript? No naming decision is documented. **Decision needed:** one naming convention for the paper and repository.

## Standing constraints (not open questions)

- No training, fine-tuning, optimizer step or training smoke is authorized until a new explicit user approval; no endpoint or checkpoint exists in this environment (verified: nothing listens on the configured formalizer port, no LLM credentials in the environment).
- `datasets/*/test.jsonl` are local execution corpora for validators; the authoritative sealed test exports live under `eval/suites/**` and training/selection reads train/dev only.
- Only assets recorded as cleared or permissive-attribution in `DS018` may be ingested or published.
