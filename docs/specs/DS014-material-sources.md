---
title: DS014-material-sources
summary: Rights-gated multi-source extraction, exact passage citations, and isolated knowledge states.
---

## Scope

`skills/material-to-sop/scripts/material.mjs prepare-sources` accepts a manifest of local files from any working directory. Each source must declare its own ID, absolute or cwd-resolved file path, revision, `rights:{status:"authorized",basis:"..."}`, nonempty scope, and positive `budget:{maxBytes,maxPassages}`. A rights declaration is supplied by the host, not independently authenticated by the extractor; an unresolved grant must not be presented as authorized. Raw input is capped at 20 MB, extracted UTF-8 at 2 MB. Input bytes and extracted text have separate SHA-256 digests. The manifest is checked before files are copied. No network fetch or active content execution occurs.

Supported in this environment: canonical UTF-8 TXT/MD, DOCX main-document paragraphs via Python 3 standard-library ZIP/XML extraction, PDF text pages via local `pdftotext -enc UTF-8`, and static UTF-8 HTML text blocks via Python 3 `HTMLParser`. PDF text extraction is **not OCR**. Unsupported: scans without a text layer (no OCR), encrypted PDFs/DOCX, DOCX footnotes/endnotes/comments/header/footer/drawings/fields/tracked changes (lossless extraction is not established), non-UTF-8 HTML, and other formats lacking an adapter. DOCX has no reliable physical-page numbers: its page is `null`. HTML layout and scripts are not interpreted. On a host without Python 3 or `pdftotext`, the corresponding adapter fails rather than pretending conversion succeeded. Source owners must compare potentially ambiguous PDF reading order, tables and layout with the original before approving any meaning.

The workspace's `datasets/knowledge/source/` contains immutable raw copies and one metadata JSON per source (raw digest, extraction digest, extractor, passage text and coordinates). `datasets/knowledge/implicit/facts.json` contains **unapproved drafts**, not runtime knowledge. `temporary/` is reserved for disposable state and never treated as a source or accepted library. Passage `offset` and `quoteOffset` are UTF-8 **byte offsets in the extracted text**, not byte offsets into compressed DOCX/PDF/HTML containers; for TXT/MD the extracted text is the original byte-identical file. `page` is one-based for PDF and `null` otherwise; `paragraph` is one-based within each page or document. A cited quote must equal the exact bytes at `quoteOffset` within its identified passage. Whitespace and spelling cannot be normalized at review time. An exact quotation confirms presence, **not** entailment or rights.

`review-sources` validates source copies against raw and extraction hashes, resolves the page/paragraph/offset, verifies the quote byte-for-byte, parses each single sourced `fact` with the project's SOP parser and `prepareKnowledge`, and writes only the unapproved draft. It does **not** call `publishKnowledge`, create a runtime repository, or turn model-authored SOP into a fact. Explicit independent integrator/human assessment and the existing accepted-candidate, probe, decision, freeze, publication-authorization workflow remain necessary for executable library rules. The older `prepare`/`review` single-TXT workflow remains for its existing candidate registry; a multi-source draft is not automatically promotable by that single-source registry. Exporting reviewed content to runtime requires the trusted, explicitly accepted publication path, not copying `implicit/` files.

## Local command shape

```sh
node /absolute/ChatSOP/skills/material-to-sop/scripts/material.mjs prepare-sources --workspace /private/work --manifest /private/manifest.json
node /absolute/ChatSOP/skills/material-to-sop/scripts/material.mjs review-sources --workspace /private/work --input /private/claims.json --project-root /absolute/ChatSOP
```

Manifest example: `{"sources":[{"id":"manual","file":"/private/manual.pdf","revision":"rev1","rights":{"status":"authorized","basis":"Document owner's explicit local-use permission"},"scope":"Local operations at site A","budget":{"maxBytes":1000000,"maxPassages":100}}]}`. Review input: `{"facts":[{"sourceId":"manual","sourceSha256":"<raw SHA-256>","passage":{"page":1,"paragraph":1,"offset":0},"quoteOffset":0,"quote":"Exact source span","sop":"@f fact\n  holds operation site_a\n  valid timeless\n  source manual\n  quote \"Exact source span\""}]}`. Coordinates must come from the generated source metadata; no example coordinate or quoted claim constitutes source evidence.
