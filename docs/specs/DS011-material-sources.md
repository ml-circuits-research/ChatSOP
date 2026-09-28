---
title: DS011-material-sources
summary: Rights-gated multi-source extraction, exact passage citations, and isolated knowledge states.
---

## Scope

`skills/material-to-sop/scripts/material.mjs prepare-sources` accepts a manifest of local files from any working directory. Relative source paths resolve beside the manifest; absolute paths work unchanged. Each source declares its own ID, file, revision, `rights:{status:"authorized",basis:"..."}`, nonempty scope, and positive `budget:{maxBytes,maxPassages}`. Rights are host-supplied declarations, not independently authenticated grants; unresolved rights must not be presented as authorized. Raw input is capped at 20 MB, extracted UTF-8 at 2 MB. Input and extraction SHA-256 digests are separate. Sources are preflighted before copying. No network fetch or active content execution occurs.

Supported in this environment: canonical UTF-8 TXT/MD, DOCX main-document paragraphs via Python 3 standard-library ZIP/XML extraction, PDF text pages via local `pdftotext -enc UTF-8`, and static UTF-8 HTML text blocks via Python 3 `HTMLParser`. PDF text extraction is **not OCR**. Unsupported: scans without a text layer (no OCR), encrypted PDFs/DOCX, DOCX footnotes/endnotes/comments/header/footer/drawings/fields/tracked changes (lossless extraction is not established), non-UTF-8 HTML, and other formats lacking an adapter. DOCX has no reliable physical-page numbers: its page is `null`. HTML layout and scripts are not interpreted. On a host without Python 3 or `pdftotext`, the corresponding adapter fails rather than pretending conversion succeeded. Source owners must compare potentially ambiguous PDF reading order, tables and layout with the original before approving any meaning.

Paths in this section are relative to the private workspace root `W` passed as `--workspace`, not to the repository (the repository has no `datasets/knowledge/` directory). The workspace's `datasets/knowledge/source/` contains immutable raw copies and one metadata JSON per source (raw digest, extraction digest, extractor, passage text and coordinates). The workspace's `datasets/knowledge/implicit/facts.json` contains **unapproved drafts**, not runtime knowledge. `temporary/` is reserved for disposable state and never treated as a source or accepted library. Passage `offset` and `quoteOffset` are UTF-8 **byte offsets in the extracted text**, not byte offsets into compressed DOCX/PDF/HTML containers; for TXT/MD the extracted text is the original byte-identical file. `page` is one-based for PDF and `null` otherwise; `paragraph` is one-based within each page or document. A cited quote must equal the exact bytes at `quoteOffset` within its identified passage. Whitespace and spelling cannot be normalized at review time. An exact quotation confirms presence, **not** entailment or rights.

`review-sources` validates source copies against raw and extraction hashes, resolves the page/paragraph/offset, verifies the quote byte-for-byte, parses each single sourced `fact` with the project's SOP parser and `prepareKnowledge`, and writes only the unapproved draft. It does **not** call `publishKnowledge`, create a runtime repository, or turn model-authored SOP into a fact. Explicit independent integrator/human assessment and the existing accepted-candidate, probe, decision, freeze, publication-authorization workflow remain necessary for executable library rules. The older `prepare`/`review` single-TXT workflow remains for its existing candidate registry; a multi-source draft is not automatically promotable by that single-source registry. Exporting reviewed content to runtime requires the trusted, explicitly accepted publication path, not copying `implicit/` files.

## Exploration budgets and transfer evidence

`explore-sources --workspace W --input mode.json` searches **literal source needles**, not inferred answers. Each input states `mode`, `questions:[{id,question,needle,sourceId?}]`, and explicit positive integer `budget:{maxProbes,maxBytes,maxMs}`. One probe is one question-versus-passage comparison. Bytes count newly loaded metadata and raw source copies plus each compared passage, including repeated scans. Time is elapsed wall-clock milliseconds, checked before source loading and each comparison; a synchronous local parser can finish its current operation before the check observes the deadline. The output reports actual used probes/bytes/time, matched source coordinates and quotations, `completed` or `incomplete`, and a stop condition. A literal hit is not a semantic answer or a review.\n+
| Mode | Planned scope and normal stop | Budget-exhaustion stop |
| --- | --- | --- |
| `focused` | Each question needs `sourceId`; inspect that source in paragraph order and stop at its first hit or end of that source. | `probe_budget`, `byte_budget`, or `time_budget` → `incomplete`. |
| `broad-bounded` | Inspect prepared source IDs in sorted order, stop at first hit per question or after planned questions. | Same explicit incomplete budget stops. |
| `adaptive` | Search preferred `sourceId` first if supplied, expand to other sorted sources only when no hit; stop on first hit per question or all sources exhausted. | Same explicit incomplete budget stops. |
| `near-exhaustive` | Inspect every passage of every source for every question, retaining all literal matches; normal stop `all_passages_scanned`. | Same explicit incomplete budget stops, even if a hit already occurred. |

`propose-sources --workspace W --input candidate.json --project-root ROOT` requires one logical SOP rule, explicit scope/limits/rationale, and exactly five distinct question roles: `positive`, `negative`, `boundary`, `nontrigger`, `transfer`. Each role has an exact source citation (`sourceId`, raw `sourceSha256`, passage page/paragraph/start offset, byte-exact quote offset and quote), human-readable question/rationale, fact-only `setupSop`, query→recall→reason `querySop`, and expected status. The positive and transfer probes expect `supported`; negative, boundary and nontrigger expect `unknown`. The nontrigger asks a predicate **other than** the candidate conclusion. The transfer case must cite a second prepared source with a different ID **and different raw digest**, and actually execute the candidate on a different ground example in an isolated repository. The baseline without the rule and the result with it are both measured. Missing/mismatched second-source evidence or any failed probe rejects the proposal. Runtime probes test mechanical semantics, not textual entailment: an independent principal/human must judge whether both quotes support the proposed meaning. The output is `cross-source-proposal-unapproved` under `datasets/knowledge/implicit/`, never runtime knowledge and never a generality claim.

The older single-source `candidate`/`probe` publication path is intentionally closed to source-1-only rules: a candidate now needs an exact citation from a second prepared source **plus a non-trigger and a transfer probe**; acceptance requires five passing executed probes. Existing previously accepted registry entries without this evidence cannot newly freeze or publish. Do not represent a synthetic second document or passing hypothetical probes as field generalization. `propose-sources` itself has no `decide`/`publish` shortcut; independent review and authorized publication remain separate.

## Fresh-agent demonstration procedure (synthetic fixtures, no approvals)

Give a genuinely new agent only this skill directory, the project root, and these fixture paths: `fixtures/cold-chain.txt` (TXT primary), `fixtures/visitor-access.md` (MD nontrigger), `fixtures/transfer-checklist.html` (HTML second transfer source), plus `fixtures/three-sources.json` and `fixtures/build-demo.mjs`. The three documents are locally authored **synthetic examples**, not external reviews or dataset-rights evidence. From any cwd, run:

```sh
S=/absolute/path/to/ChatSOP/skills/material-to-sop
R=/absolute/path/to/ChatSOP
W=$(mktemp -d /tmp/material-agent-work-XXXXXX)
I=$(mktemp -d /tmp/material-agent-inputs-XXXXXX)
node "$S/scripts/material.mjs" prepare-sources --workspace "$W" --manifest "$S/fixtures/three-sources.json"
node "$S/fixtures/build-demo.mjs" "$W" "$I"
node "$S/scripts/material.mjs" explore-sources --workspace "$W" --input "$I/focused.json"
node "$S/scripts/material.mjs" explore-sources --workspace "$W" --input "$I/broad.json"
node "$S/scripts/material.mjs" explore-sources --workspace "$W" --input "$I/adaptive.json"
node "$S/scripts/material.mjs" explore-sources --workspace "$W" --input "$I/exhaustive.json"
node "$S/scripts/material.mjs" explore-sources --workspace "$W" --input "$I/incomplete.json"
node "$S/scripts/material.mjs" propose-sources --workspace "$W" --input "$I/rejected.json" --project-root "$R" # expected rejection
node "$S/scripts/material.mjs" propose-sources --workspace "$W" --input "$I/candidate.json" --project-root "$R"
```

The agent must read actual output, identify the cold-chain rule quote and receiving-desk transfer quote by source/hash/locator, report the positive baseline `unknown` versus with-rule `supported` as an **isolated-runtime rule-representation gap**, identify the rejected missing-transfer case, and justify visitor-entry `unknown` as abstention: the vaccine rule is not triggered and badge alone is not an archive-access grant. Incomplete near-exhaustive exploration under the deliberately one-probe budget must remain incomplete. The observed report below does not claim reviewed knowledge, real-world authority, or approved generality.

### Observed blank-agent run

Verbatim excerpts from the fresh agent's report after running the commands above from `/tmp/material-agent-cwd-yVmd6S` (workspace `/tmp/material-agent-work-JiyXyg`, generated inputs `/tmp/material-agent-inputs-qFyijL`). These are observations of synthetic fixtures, not independent semantic review:

> `prepare-sources` status `source-only-unapproved`: `cold_chain` `.txt`, 1 passage, raw SHA-256 `5679d4996088538ba2c5e728db86db79e210f16450779b3bb7f049e2ab307aae`; `visitor_access` `.md`, 2 passages, `cc30359650dbfc2055ef0cefa6af6b25ce7e131d43b094bf6d6f354dcb2b3dc9`; `receiving_desk` `.html`, 5 passages, `c84206a21715054b05941e04c4cc8fae953e8d52d5396e3af2a165fc5009d02c`. Builder listed `candidate`, `rejected`, and five modes.

> Exploration (budgets shown as maxProbes/maxBytes/maxMs; all normal modes 100/100000/3000): `focused` completed, `planned_questions_examined`, used 1 probe, matching `cold_chain` paragraph 1 offset 0, quoteOffset 123 `routine transfer`; `broad-bounded` completed, `planned_questions_examined`, 1 probe, same match; `adaptive` completed, `planned_questions_examined`, 6 probes, `receiving_desk` paragraph 3 offset 93, quoteOffset 184 `routine transfer eligibility`; `near-exhaustive` (exhaustive.json) completed, `all_passages_scanned`, 8 probes, matches `cold_chain` paragraph 1 offset 0 quoteOffset 123 `routine transfer` and `receiving_desk` paragraph 3 offset 93 quoteOffset 184 `routine transfer`; `near-exhaustive` (incomplete.json) **incomplete**, `probe_budget`, budget 1/100000/3000, used 1 probe, matching `cold_chain` paragraph 1 offset 0 quoteOffset 123 `routine transfer`. That single hit does not constitute a completed exhaustive scan.

> Rejected proposal: command exited code 1 with exact message `Positive, negative, boundary, nontrigger and transfer cases required`. Generated rejected input `missing_second_source` has positive, negative, boundary, and nontrigger cases, but no transfer case. I would reject that candidate for missing required second-source transfer evidence.

> Candidate `sealed_transfer_cross_source`: observed `cross-source-proposal-unapproved`, never approved. Its generated citations (all page `null`; offsets are passage offset, then quoteOffset):
> - positive — `cold_chain`, `5679d4996088538ba2c5e728db86db79e210f16450779b3bb7f049e2ab307aae`, paragraph 1, 0 / 38: “A sealed vaccine box with a complete temperature log and intact seal is eligible for routine transfer.” Baseline `unknown`, with rule `supported`.
> - negative — `cold_chain`, same hash, paragraph 1, 0 / 141: “A box with a broken seal must be held for inspection, even if its temperature log is complete.” Baseline `unknown`, with rule `unknown`.
> - boundary — `receiving_desk`, `c84206a21715054b05941e04c4cc8fae953e8d52d5396e3af2a165fc5009d02c`, paragraph 5, 318 / 318: “The checklist does not state whether a box with an unknown seal is eligible.” Baseline `unknown`, with rule `unknown`.
> - nontrigger — `visitor_access`, `cc30359650dbfc2055ef0cefa6af6b25ce7e131d43b094bf6d6f354dcb2b3dc9`, paragraph 2, 36 / 36: “A visitor may enter the archive only if the visitor has an active badge and an escort is present.” Baseline `unknown`, with rule `unknown`.
> - transfer — `receiving_desk`, `c84206a21715054b05941e04c4cc8fae953e8d52d5396e3af2a165fc5009d02c`, paragraph 3, 93 / 93: “For a sealed vaccine box, a complete temperature log and an intact seal together establish routine transfer eligibility at this desk.” Baseline `unknown`, with rule `supported`.

> Observed semantic gap: positive and transfer queries were `unknown` in the isolated baseline and `supported` with the proposed rule, a rule-representation gap in this isolated runtime, not evidence of an external model failure. Visitor-entry `unknown` is appropriate abstention: the vaccine-box rule does not address archive entry; the quoted visitor condition requires an active badge **and** escort, and does not grant entry on badge alone. Outputs do not establish independent review, approval, actual rights verification, authorization to operate, or generality beyond these synthetic fixtures.

## Local command shape

```sh
node /absolute/ChatSOP/skills/material-to-sop/scripts/material.mjs prepare-sources --workspace /private/work --manifest /private/manifest.json
node /absolute/ChatSOP/skills/material-to-sop/scripts/material.mjs review-sources --workspace /private/work --input /private/claims.json --project-root /absolute/ChatSOP
```

Manifest example: `{"sources":[{"id":"manual","file":"/private/manual.pdf","revision":"rev1","rights":{"status":"authorized","basis":"Document owner's explicit local-use permission"},"scope":"Local operations at site A","budget":{"maxBytes":1000000,"maxPassages":100}}]}`. Review input: `{"facts":[{"sourceId":"manual","sourceSha256":"<raw SHA-256>","passage":{"page":1,"paragraph":1,"offset":0},"quoteOffset":0,"quote":"Exact source span","sop":"@f fact\n  holds operation site_a\n  valid timeless\n  source manual\n  quote \"Exact source span\""}]}`. Coordinates must come from the generated source metadata; no example coordinate or quoted claim constitutes source evidence.
