---
name: lexicon-curation
description: Curate multilingual aliases and canonical IDs
---

# Curate multilingual aliases and canonical IDs

Read `probably_obsolete/legacy/requirements/04-lexicon.md`, [DS004](../../docs/specs/DS004-sop.md), and the [shared quoted-text syntax](../../docs/wire_typs/syntax.html#quoted-text). Distinguish an alias from identity, contextual synonymy, implication, and subsumption. In particular, do not normalize `mother` away to `parent`. Two people sharing a name retain separate IDs. Preserve the natural spelling and capitalization of proper names, but capitalization does not prove an entity and a quoted mention is not an identity lookup. Use reviewed `resolve` and consume its `$ref` rather than automatically resolving names.

Propose changes to `config/ontology.sop` with a description, types, and examples in the target languages. Inflected name forms may be explicit aliases. Repetition of the same assumption is not evidence. Rest-of-line text fields may accept bare input, but canonical generated SOP and training free-text literals must be double-quoted, including single-word names; multiword strings in token-list fields require quotes to remain one argument. Escape embedded `"` and `\` with a JSON string encoder; never use single or smart quotes as delimiters. When SOP text is stored in JSONL, JSON-encode the entire SOP string as an outer layer, escaping its quotes and backslashes again. Verify exact quotation provenance against the decoded value, not the escaped transport bytes. `$ref`, `?var`, `~handle`, and enum values such as `source user` and `language en` are not free text to quote. Quoted sigils and keywords stay inert in text fields, but do not claim this universally for atom arguments: the current atom parser can lose the string-versus-variable distinction for `"?x"`.

For an alias, use a review with `canonicalId`, `language`, `surface`, `verdict:accept`, `reviewer`, and `evidence`; if the alias denotes several IDs, justify `keepAmbiguous:true`. Apply with `tools/review-alias.mjs --ontology ... --review ... --out ...`. Run collision tests with and without diacritics, word boundaries, and a restricted candidate set.
