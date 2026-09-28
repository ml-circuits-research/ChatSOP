> ARCHIVED 2026-09-28 — extracted from DS009-query-curriculum; superseded by the current DS009. Historical register, not a current contract.

# DS009 docx reconciliation (historical)

## Introduction paragraph (as it stood)

The query curriculum must teach a small formalizer to state a declarative SOP problem and genuine user claims, not to imitate an answer string or choose session, retrieval and rendering operations. A separate host-expanded circuit executes that declaration. Earlier executable corpus targets remain evidence about the low-level runtime, not proof that a declarative-target curriculum is already qualified. `probably_obsolete/vision/SOP_dataset.docx` makes the semantic case—not each paraphrase—the unit of knowledge; `probably_obsolete/vision/SOP_CommonSense_v2.docx` separates missing source knowledge, missing semantic structures and missing reasoning capability. Neither document authorizes a training run or makes an unsupported operator executable; the audited mapping to current specifications is in `DS023-nl-sop-dataset.md`.

## Reconciliation decisions (as they stood)

| Source requirement or apparent conflict | Decision in the current profile |
| --- | --- |
| Semantic cases with several EN surfaces and selected RO anchors | One canonical target per case; group translations, paraphrases and hard negatives before splitting. Count Romanian coverage by cases as well as rows. |
| Questions may include contextual claims or ambiguity | Distinguish `query_only`, `assertions_query` and historically named `clarification` input modes. In the model language ([DS041](specsLoader.html?spec=DS041-stated-assumed-unclear.md)) the model represents claims from the message as `stated` (asserted, hedged, supposed or reported) and its own additions as `assumed`, as context-free strings that the host links; never sourced `fact` or `remember`. The host retains original input text without publishing any statement or assumption. It generates `clarify` only from a valid declarative problem whose identity or required scalar is missing/nonunique; old standalone model-authored `clarify` targets belong in the system track unless genuinely reauthored. Source setup remains a separate host operation. |
| QA2D and ProofWriter are preferred starting sources | A preference is not a license or a validated SOP mapping. Quarantine unresolved sources; preserve source scaffolds without inventing gold. |
| Many reasoning families appear in the vision | An executable bounded operation, an approved theory and a missing capability are different states. Do not turn defaults, causal guesses, intentions or counterfactuals into hard Horn facts. |
| Historical documents mention other containers, graph paths or operators | The current parser is authoritative. Foreign dialects require an explicit compiler and reviewed semantics; they are not silently accepted aliases. |
| Equivalent programs can differ syntactically | Safe local alpha-renaming and parser normalization are automatic. Different structures with only finite agreement require LLM review and a separate principal decision. |
| The small model should not maintain a synonym dictionary | The host-approved lexicon resolves language, symbolic kind, entity type and optional domain. The `resolve` wire exposes the same exact lookup boundary. |
