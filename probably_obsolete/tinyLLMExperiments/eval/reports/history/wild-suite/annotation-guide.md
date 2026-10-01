# Annotation guide: formalizer-wild-v1

You are one of two independent annotators (or the adjudicator) of the sealed evaluation suite `formalizer-wild-v1`. The other annotator labels the same messages without seeing your work. Do not open any other annotator's files, any writer file, `datasets/`, `eval/suites/` or `tools/datasets/diversity/`. Label from the specification.

## Read first (in /home/salboaie/work/ChatSOP)
1. `docs/specs/DS021-model-surface.md` (the whole file, including "Canonical English output").
2. `docs/wire_typs/model-guide.html` and `docs/wire_typs/question-types.html`.
3. As needed: `docs/wire_typs/stated.html`, `assumed.html`, `unclear.html`, `query.html`, `constraint.html`.
4. From `docs/specs/DS022-diversity-generator.md`, only the section "Relation phrases". It lemmatizes the message's own predicate words and never substitutes synonyms. Its Romanian examples are superseded: every relation phrase is English.

## Output conventions

The pilot (150 double-annotated messages) showed where the specification leaves room for choice. Apply these conventions so that two annotators who follow them write the same program. When they do not decide a case, put your preferred program in `sop` and every other defensible program in `alt_sops`.

### C1 Language
- Output is canonical English for every message.
- Relation phrases, common nouns and time expressions are translated to English: "acum" → "now", "12 martie 2020" → "12 March 2020", "mâine dimineață" → "tomorrow morning".
- An English message's time expression is copied as written.
- Proper names stay exactly as written, including Romanian place, country and institution names ("Germania", "Londra", "Primăria Craiova", "Clujul").
- Use American spelling for translations ("neighbor", "city hall").
- `unclear` readings are written in English.

### C2 Relation phrase
- Lemmatize the message's own predicate words; keep particles and prepositions ("work at", "move from", "buy from", "be married to").
- An agentless passive keeps the passive with the patient as subject ("be repaired", "be founded").
- A passive with a by-agent keeps the passive, with the agent as `role object`.
- Modals stay inside the phrase ("be allowed to sign", "must register", "should negotiate").

### C3 Roles
Use the closed inventory as model-guide.html defines it:
- membership in or affiliation with an organization or group ("from the choir", "de la Vertex") → `object`;
- geographic origin → `source`;
- "because of X" → `topic`;
- "at a place", "in a place" → `location`;
- "with a card or a car" (means) → `instrument`.

### C4 Remarks
- Formalize every assertion about other people, things and the case.
- Leave out the user's own purpose, plans, feelings, apologies, self-description and chit-chat ("sorry for the typos", "I have a meeting at 3").
- When a fact about the user is needed to answer the question ("I work at Acme. Who else works there?"), state it with the value as written ("I", "my brother") and set `language_gap` to "first-person participant".

### C5 Coordination
- Coordinated subjects or objects of a distributive predicate are split into one proposition each ("Ana and Ion work at X" → two `stated`).
- An explicitly collective predicate ("together", "co-own", "amândoi pe acte", "share the van") keeps one conjoined value as written in English order ("Ioana and Sorin").

### C6 Question forms
Use the DS021 table exactly.
- Tag questions ("…, right?", "…, nu?") are yes/no queries, not statements.
- "Wh …, X right?" (an offered answer) is a yes/no query about the offered answer, with the wh query in `alt_sops`.
- Embedded or imperative questions ("can you tell me", "list all", "spune-mi") are the underlying query.
- Clause complements ("did anyone confirm whether Andrei received the draft") query the embedded proposition.
- Greetings and thanks around a question are ignored.

### C7 Alternative questions ("X or Y?")
- When the options differ only in one role value, write `select ?v` with `filter any` over the options, plus a match block.
- Otherwise write one yes/no query per option.
- Always set `language_gap` to "alternative question".

### C8 Constructs that DS021 does not have
Approximate these as below and name the gap in `language_gap`.
- **"most", "half", "few", "at least N" in a question:** two `mode count` queries (the restriction, then the restriction with the scope). The gap is "proportional quantifier".
- **The same quantifiers in a statement:** leave the statement out. The gap is "quantified statement".
- **"not all" / "not everyone" / "nu toți" as a question:** `mode every` with the positive scope. The existential `mode exists` with a negated block goes in `alt_sops`. The gap is "negated quantifier".
- **"it's not true that nobody …":** `mode exists` with the affirmed block, and `mode every` with a negated scope in `alt_sops`.
- **Comparison between two named things ("is X older than Y", "which is taller, X or Y"):** a yes/no query with relation "be older than" (subject X, object Y); for "which …", add the reversed query as a second `@q2`. The gap is "comparative".
- **Superlative ("the cheapest X"):** `select ?x` with a match on the superlative phrase ("be the cheapest") plus the restriction. The gap is "superlative".
- **Numeric attribute value ("how much does X cost", "how old", "what time does X open"):** `select ?v` with relation "cost" / "be old" / "open at" and `role object ?v` (`role time ?v` for clock times). The gap is "attribute value".
- **Numeric comparison of an attribute ("over 80", "more than 10 years"):** an integer object with the comparison in the relation ("be over" 80).
- **Arithmetic ("what is 15% of 3400"):**
  - use `constraint` with `var ?x int` and bounds (0..1000000000 when the message gives none);
  - scale the equation to integers with `require`;
  - add `claim ?x >= 0`, `task possible` and `select ?x`.

  The gap is "arithmetic".
- **Ordering between events ("before or after", "which happened first"):** one when-query per event (`role time ?t`, `select ?t`). The gap is "temporal ordering".
- **Advice or evaluation ("should I", "is it worth it"):** a yes/no query with the modal or evaluative words in the relation. The gap is "advice question".
- **A pure action or writing request (book, write, translate, remind) with no checkable question:** `unclear kind no_request`. If it also contains a checkable question ("book a table and check if they do gluten free"), formalize only that question. The gap is "action request".
- **Ellipsis that needs an earlier turn ("and Maria?", "și la ea?", "what about 2019?"), when no relation can be recovered from the message:** `unclear kind no_request`. The gap is "context-dependent ellipsis".
- **A question about the conversation itself ("what did I just say"):** `unclear kind no_request`. The gap is "meta question".
- **Definition questions ("what does X mean", "ce înseamnă X"):** `select ?m` with relation "mean", `role subject` the term as written, and `role object ?m`.

### C9 Relative clauses and long noun phrases
- A definite description that names one thing stays one value, translated to English ("the dental clinic on the ground floor of the tall glass building").
- When the question asks about an entity through a relative clause ("who approved the report that was sent by the new chief accountant"), decompose it into match blocks sharing a variable, with the undivided value in `alt_sops`.

### C10 Certainty and speaker
- "I think", "probably", "cred că" → hedged.
- "suppose", "if" in a supposition, "să zicem" → supposed.
- "X says that" → asserted plus `speaker "X"`.
- "X thinks that" → hedged plus `speaker "X"`.

### C11 Numbers
- Plain integers are integers.
- Amounts with separators, currency or decimals stay as written strings ("1.140 euro" → "1,140 euro" is NOT done; keep "1.140 euro").

### C12 Unclear
- `gibberish`: unintelligible text.
- `no_request`: as C8, plus greetings, thanks and small talk alone.
- `ambiguous`: only when the text itself has two readings with none preferable (DS021). When one reading is preferable, use `assumed … basis disambiguation`.

## Output format
JSONL, one object per input message, in the same order, UTF-8:
{"id","message","language","sop","alt_sops":[...],"language_gap":null|"<gap name from C8 or a short phrase>","spec_unclear":null|"<rule and rejected alternative>","confidence":"high"|"medium"|"low"}
Write the file incrementally.

## Validate
`cd /home/salboaie/work/ChatSOP && node <scratchpad>/wild/validate.mjs <your-output.jsonl>` must report 0 invalid. Also validate `alt_sops` by writing them to a temporary file with the same message. The anchoring guard is a warning for Romanian and mixed messages, because translated values cannot anchor literally; every other error fails.

Finish with a short report: row count, the validator line, the number of `language_gap` rows, and the 3 most unclear rules.
