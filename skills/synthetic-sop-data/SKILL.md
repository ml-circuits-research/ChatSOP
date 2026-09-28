---
name: synthetic-sop-data
description: Generate reviewed NL-to-SOP examples for the small formalizer through the DS022 generator
---

# Generate reviewed NL-to-SOP examples

The small formalizer's training and evaluation data is generated, not hand-written: the DS022 diversity generator builds the corpora from an intermediate representation, prints each target in the model language, executes it against an evaluation-only verification world and keeps only rows whose result matches the intended one. This skill is the procedure for changing that data. It never authorizes training (AGENTS.md rule 3).

## 1. Read first

1. [DS021](../../docs/specs/DS021-model-surface.md), the model surface, and the wire help pages for `stated`, `assumed`, `unclear`, `query` and `constraint` (`docs/wire_typs/`, index `docs/wire_types.html`), including the question-types page.
2. [DS022](../../docs/specs/DS022-diversity-generator.md), the generator, and [DS014](../../docs/specs/DS014-source-rights.md), source rights.
3. `tools/datasets/build-corpora.mjs` and its modules under `tools/datasets/diversity/` (families, question frames, realization, noise, printers, quotas).

## 2. What a model target may contain

- **The prompt is the user's message only.** No context, entity or predicate list, identifiers, lexicon, background knowledge or clock reaches the model. A message must never presuppose that the model can see records ("according to the registry", "from the vocabulary", "record 12").
- **Five wire types:** `stated`, `assumed`, `unclear`, `query` and `constraint`. No `fact`, `resolve`, `solve`, `cnl`, `remember`, `clarify`, `expand`, `value` or `jsEval`; no retired `premise` or `holds` atoms.
- **Strings, one keyword per line.** `relation "works at"`; `role NAME VALUE` with NAME from `subject`, `object`, `recipient`, `location`, `source`, `destination`, `instrument`, `time`, `topic`; VALUE a JSON-quoted string as written in the message (typos and missing diacritics included), an integer, or a `?variable` in a query `match` block; `polarity affirmed|negated`; temporal expressions quoted as written (`valid on "3 March 2025"`, `at "June 2025"`).
- **`stated` versus `assumed`.** `stated` only for what surely comes from the message, with `certainty asserted|hedged|supposed` and an optional `speaker` for reported speech; every stated value must occur in the message. Anything the model adds (a closure, a default, a presupposition such as "still", a chosen reading of an ambiguous word or pronoun) is `assumed`, with an optional descriptive `basis`.
- **`unclear`** only as `gibberish`, `no_request`, or `ambiguous` with two to four `reading` lines, and always alone. The model never refuses and never judges sense, contradiction or relevance.
- **Question forms** follow DS021 "Question forms": `mode every` + `scope` for universals, `role time ?t` + `measure start|end|duration` for since when, until when and how long, `mode count` for how many (times), `mode explain` for why, `role location`/`role instrument` for where and how.

A valid target for "Ana works at Acme. Who else works at Acme?":

```sop
@s1 stated
  relation "works at"
  role subject "Ana"
  role object "Acme"
  polarity affirmed
  certainty asserted
@q query
  where match
    relation "work at"
    role subject ?who
    role object "Acme"
    polarity affirmed
  end
  filter ?who != "Ana"
  select ?who
```

The row's `setup_sop`, `ontology_sop`, `verification_context` (marked `model_visible: false`; formerly `context`), `verification` and `expected` fields are verification scaffolding for host linking and execution. They are never model input and never appear in a prompt.

## 3. Procedure

1. Change the generator, never the rows. A hand-edited row breaks the manifest checksums and disappears at the next build.
2. Rebuild: `node tools/datasets/build-corpora.mjs` (writes `datasets/formalizer-v1/{train,dev}.jsonl`, the sealed `eval/suites/formalizer-v1/test.jsonl` and `eval/suites/formalizer-ood-v1/test.jsonl`, plus manifests and reports). Splits over the size limit are written as `<split>.part-NNN.jsonl` shards through `lib/jsonl-shards.mjs`; no repository file may exceed 50 MB (`node tools/shard-large-files.mjs --check`).
3. Check, in this order: `node tools/datasets/verify-corpus.mjs --corpus formalizer-v1 --all` and `--suite formalizer-ood-v1` (every target reproduces its stored result), `node tools/datasets/audit-corpus.mjs --corpus formalizer-v1` (skill `corpus-audit`), `node tools/verify-vocabulary.mjs --scope all`, and `npm run test:data`. The build already runs the no-copy check in memory; `node tools/datasets/no-copy.mjs` reports it standalone.
4. Project the training view with `node tools/research/prepare-experiment.mjs`; it refuses to write any prompt that is not exactly the message.
5. Ask for human review in the visual audit (`/audit` on the server, DS020). Parsing and execution alone do not approve a target, and programmatic Romanian is not "validated natural Romanian" until a reviewer says so.
6. Log the build and its verdicts with `node tools/journal.mjs add --area data …`.

## 4. Sources and splits

Sources are inspiration only (`inspired-by-released`, DS014): the generator may take structure, label types, phenomena and statistics from the cached QQP, PAWS, ProofWriter, AmbigNQ, QA2D and SQuAD material, never text. Keep paraphrases, language variants and contrasts of one semantic case in one split group; the sealed tests use held-out resources and, for `formalizer-ood-v1`, held-out domains. Never read a sealed test for generation or selection.

## 5. What stays outside

Coding-agent programs, `jsEval`, templates and procedures belong to trusted circuits and the system evaluation track; their existence does not enlarge the model language. Host clarification (`clarify`) is generated by the host after linking and is never a model target.
