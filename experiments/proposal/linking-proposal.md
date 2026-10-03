# Linking words to knowledge: the KnowledgeLinker, the lexicalized ontology and a non-empty base memory

Proposal, 2026-10-01. Written for the owner's three questions of 2026-10-01 after the chat answered "I do not know the relation 'be'" for a copular question. It is an analysis of the repository as it is today and a design; nothing in it is implemented, and every number below was measured on the files named next to it (commands in Appendix B). It is self-contained: a reader needs the repository, not the conversation.

---

## 0. Direct answers to the owner's three questions

**1. "How current is the KnowledgeLinker? Can't a reasoning strategy do it instead?"**

It is current only in the sense that it is the only path a message takes; it is not mature. What the glossary calls the KnowledgeLinker is about 650 lines spread over five modules written in the last three days (`sop/linking.mjs`, `sop/copula-linker.mjs`, `sop/relation-lexicon.mjs`, the dictionary tiers inside `sop/declarative.mjs`, and `sop/lexicon.mjs` for entities), and it links by **exact phrase match**: a relation string links only if, after dropping articles and auxiliaries and light stemming, it equals a predicate id, a `label`/`alias`, or the `description`. There is no scoring, no use of argument types, no use of what the memory actually holds, no alternative segmentation of the sentence, and the sentence's grammatical analysis is thrown away before linking. `reasoning/linker.mjs` is a different thing with a confusing name: it is premise selection (which facts and rules to hand the engine) and it starts after the strings are already symbols.

A reasoning strategy cannot do linking by itself, for two reasons that are in the code: the engines have no strings (the bridge lowers positional atoms of symbols), and candidate generation is lexical work (phrase keys, dictionary tiers, aliases, segmentation) that no engine models. But the owner's intuition is right about the **last step**: once the lexical layer has produced two or three candidate readings, choosing the one that is consistent with the memory and answerable is a reasoning question, and the formal account of it is abductive interpretation (Hobbs et al. 1993). The recommendation (section 2.5) is a linker that produces scored candidates and uses the memory as evidence, with the reasoner as the arbiter among the survivors and never as the generator, and with every choice reported in the packet exactly as the copula readings are reported today.

**2. "The base memory has no reason to be empty. It should start with an ontology adapted to English. How do we populate it, at least from our tests?"**

Agreed, and the empty default is the direct cause of the failure the owner saw. Today the chat uses **one global lexicon**, `config/ontology.sop` (20 demo predicates and 11 demo entities), loaded once in `server/http.mjs:336` and handed to every session whatever base memory the session cloned (`server/session-runtime.mjs:35`). A base memory carries no lexicon of its own: its `predicate` wires (knowledge grammar) have `args`, `closed`, `reading` and `describe_rank` but no `label` or `alias`, and the world-v1 lexicon shards that `tools/world-kb/ontology.mjs` generates are loaded only by the evaluation script `tools/eval/chat/world-kb-chat.mjs`, never by the server. So the chat linked "be" against 20 kinship-and-work predicates, found no `reading`, and the text of the fallback question was "I do not know the relation". The fix is structural, not a word list: (i) the lexicon is **part of the base memory** and compiled from its circuits; (ii) a **core English base memory** (`core-en`, section 4) holds the classes, the core relations with their English and Romanian lexicalizations, the copula readings, time, quantity and units, part-of, located-in, kinship and organizations; (iii) every base memory, `default` included, imports it, so no session starts empty.

Populating it from our tests is realistic and mostly mechanical (section 5): the symbolic and neuro datasets (13,688 train and dev rows) use 2,557 distinct relation phrases, but 238 phrases cover 90.2% of the 40,040 relation mentions and the 167 English surfaces of the archived verification world already name 82.8% of them. A mined inventory, clustered through the dictionary and frames, authored into `predicate`, `lexeme`, `entity` and `rule` wires by the coding agent with the `sop-wire-authoring` skill, validated by the knowledge validator plus a lexicon lint, and reviewed in the audit UI, gives a core of roughly 250 predicates, 600 to 900 English forms, 100 to 150 Romanian forms, 30 classes and about a dozen rules. What tests will not give (section 5.4): real-world entities (that is world-v1), noun lexicalizations, event relations with more than two participants, units (the corpora have 32 bare numbers), and polysemy.

**3. "Can the grammatical analysis really be matched to the best identifier in the KB? Shouldn't the heuristics that generate the circuits rely on the KnowledgeLinker? Something is off."**

Something is off, and it is this: the UD-to-SOP rules **commit to one string early** ("be the chef at" + "the Bistrița Philharmonic", or "be the chef" + "at the Bistrița Philharmonic", chosen by a rule without knowing which one any memory declares), and the linker then has only that string and an exact-match table. The circuit the host executes is therefore generated from the rule's guess, not from a linking decision. The right division of labour is: the rules produce the **primary reading plus the structure needed to derive the alternatives** (the analysis is already stored on every dataset row), the linker scores the alternatives against the base memory's lexicon, types and evidence, and **the executed circuit is the linker's choice**. That answers "rely on the KnowledgeLinker": yes for the circuit, no for the rules. The rules must not consult the KB (section 2.6): SymbolicLM's output must stay one program per message for every base memory, because that is what makes `symbolic_english` a regression suite, what lets the rules be improved without a memory in hand, and what the small LLM will have to reproduce one day. "No context" for SymbolicLM means "the rules read language, never knowledge": function words, the dictionary and copula word lists are language; predicate ids, entity lists and facts are knowledge. The boundary does not change; only the pretence that SymbolicLM's string is final does.

---

## 1. Diagnosis: the gap between the string surface and the knowledge surface

### 1.1 What exists today, in the code

The pipeline for one chat message is:

1. `textToCleanEnglish` (optional) and **SymbolicLM** (`lib/symbolic-lm/index.mjs`, rules `lib/ud-to-sop/`, v2.7): Stanza parse, deterministic rules, one SOP program in the model language: `stated`/`assumed`/`query` wires with `relation "…"` and `role NAME "value"` lines; content words are strings, the relation phrase is the lemma of the predicate words with its particles and prepositions, and for the copula it is `be`, `be a`, `be in` or a longer copular phrase (`be the chef at`).
2. **Host linking** inside `compileDeclarative` (`sop/declarative.mjs:189-286`): for each proposition, `linkProposition` (`sop/propositions.mjs`) calls `linkRelation` (`sop/linking.mjs:44`), which computes `phraseKey(text)` (fold, drop a stopword list of auxiliaries and articles, stem `-s`/`-e`) and keeps the predicates whose id, aliases or description have the same key; the role set then decides (`bound`, `ambiguous`, `role_mismatch`, `unknown`). If it is not bound, `linkCopula` (`sop/copula-linker.mjs`) handles the plain copula with the six `COPULA_READINGS` declared on predicates. If still unbound, four **dictionary tiers** retry the phrase with its Romanian-to-English translation, other translations, English synonyms and the phrases of a nearby `unparsed` span (`declarative.mjs:195-214`). Entities are resolved by generated `resolve` wires (`normalizeAtom`, `declarative.mjs:257-286`): exact then accent-folded alias of the `Lexicon`, then the dictionary's English candidates, requiring exactly one hit. Times go through `normalizeTime`. Every failure becomes one `clarify` with `reason: unresolved_link`.
3. Retrieval and reasoning (`reasoning/linker.mjs`, `reasoning/bridge/`, `reasoning/strategies/js-reference`): positional atoms of symbols.

Three facts about this architecture are decisive.

**The lexicon is global and static.** `server/http.mjs:336` loads `config/ontology.sop` once; `SessionRuntimes` (`server/session-runtime.mjs:15, 35`) passes that one object to every session's `SessionStore` and `Agent`. DS022 makes the base memory the unit of knowledge, but the unit of *vocabulary* is still the repository-wide file. `config/ontology.sop` has 20 predicates (`parent`, `mother`, `works_at`, `located_in`, `costs`, `age`, `likes`, demo predicates such as `disk_full`) and 11 entities (`ana`, `lab_alpha`, `room_a`). A session on world-v1 therefore links against kinship and demo predicates.

**There are two grammars for one concept.** The host `Lexicon` (`sop/lexicon.mjs`) reads the *ontology* grammar, `ONTOLOGY_SPEC` in `sop/parser.mjs:56-60`: `predicate` with `role`, `label`, `alias`, `reading`, `describe_rank`, `args`, `description`, `domain`; `entity` with `kind`, `label`, `alias`; `concept` with `is_a`. The knowledge validator (`sop/knowledge/grammar.mjs:41`) reads the *knowledge* grammar: `predicate` with `args`, `closed`, `key`, `transitive`, `inverse`, `unit`, `description`, `reading`, `describe_rank`, and no `label`, `alias`, `entity` or `concept`. A base memory's circuits are in the knowledge grammar, so a base memory **cannot carry lexical forms at all**. world-v1 works around it by generating the ontology grammar separately (`tools/world-kb/ontology.mjs` writes `datasets_sources/world-kb/ontology/NNNN-*.sop`, loaded by `tools/world-kb/lexicon.mjs`) and by also emitting `label_en`/`label_ro` facts. Two generated artifacts for one vocabulary, read by different code, is how the chat and the evaluation script came to see different worlds.

**Linking is exact and single-reading.** `phraseKey` equality is the only relation match; `Lexicon.matching` exact or folded equality is the only entity match. The `frames.mjs` normalizer (synonym, role, boundary and time levels, owner answer Q-SYM-2) runs in evaluations only (`TODO.md:92`). The sentence's analysis (the UD tree that would say where the relation phrase ends and the object begins) is not available to the linker. Word lists that classify the copula's object (`occupations`, `attributes` in `config/relation-lexicon.json`, about 65 and 47 words in each language) are code-adjacent data rather than knowledge of a memory, so "Ana is a baker" works and "Ana is a sommelier" asks a question.

### 1.2 What linking must solve

The question "is a string the same thing as a symbol" has five parts, and each one appears in our data.

| Problem | What it is | Where it appears in ChatSOP | What exists |
| --- | --- | --- | --- |
| **Entity linking** | a mention ("Paris", "the Bistrița Philharmonic", "Alfa", "Anei") to an entity symbol; aliases, inflected names, definite descriptions; ambiguity (two Parises, two people called Maria) | 70,030 role values in the symbolic and neuro datasets: 4,863 distinct proper names, 5,454 distinct common-noun values, 440 "the user"; world-v1 has about 20k entities with English and Romanian labels and a name-collision policy by Wikipedia editions | `Lexicon.resolve`/`matching`: exact and accent-folded alias; `resolve` wires; the dictionary for Romanian common nouns; `mentionedIn` anchoring; the world-v1 rule that only the most notable namesake keeps the plain label |
| **Relation and predicate linking** | a verb phrase, a noun phrase or the copula to a predicate with a role order (direction); converses ("employ" vs "work at"); light verbs ("have an allergy to"); modals kept in the phrase | 2,557 distinct relation phrases, 544 head verbs; `be`-headed phrases are 12,998 of 40,040 mentions (32%), 644 distinct; world-v1 maps 54 Wikidata properties to about 45 predicates with English aliases, a few Romanian | `linkRelation` exact key; aliases; `relation-lexicon.json` `relations` list (empty); dictionary tiers; `frames.mjs` (not wired) |
| **Class and type linking** | a common noun to a class symbol ("city", "doctor", "painter"); the copula's object; type restrictions on arguments | "Is Paris a city?", "Was Leonardo da Vinci a painter?" (world-v1 q24, q25); the generator's roles are typed (`role subject person`) but types are never used to choose | the `class`/`occupation` readings decided by the word lists; `is_a` facts in world-v1 unused by the linker; `concept` wires unused |
| **Argument and role mapping** | the message's roles (`subject`, `object`, `location`, `source`, `destination`, `instrument`, `recipient`, `topic`, `time`) to the predicate's positions; converse direction; a role the predicate does not declare | role sets in the corpora: subject+object 26,630, subject only 4,287, +location 2,628, +destination 1,425, +topic 1,345, +time 948, +source 669, +instrument 549, +recipient 256; `PREP_ROLE` in `lib/ud-to-sop/lexicon.mjs` decides by preposition and NER, so "to the Bistrița Philharmonic" can be `destination`, `object` or `recipient` depending on a tag | `role NAME TYPE` on predicates; exact role-set equality for statements, subset for queries; `frames.mjs` role level (not wired) |
| **Literals and units** | numbers, amounts with units ("2380 lei"), dates and periods, ISO codes, strings of type `text` | 32 bare numerals in the corpora; `cost`, `age`, `duration` with `unit` in descriptions; world-v1 `population_of`, `area_km2_of`, years and ISO-date text | `normalizeTime`; a numeral string into an integer argument; `compare` reads a leading number; `unit` is documentation only |

### 1.3 Why per-relation heuristics and hardcoded lists do not scale

- **The long tail is real.** 1,631 of the 2,557 relation phrases occur once; 571 occur three or more times. Each new generator construction, each new base memory and each real user adds phrases. A rule per phrase in `analyze.mjs` or a list per reading in `relation-lexicon.json` grows without bound and is owned by code, not by the memory that knows the predicate.
- **The same phrase means different predicates in different memories.** "be in" is `located_in` in world-v1 and a membership relation in a team memory; "work at" is `works_at` for a company memory and nothing for the chemistry memory. A global list must either pick one or list all, and both are wrong. The predicate's own memory is the only place that knows the answer, which is DS014's own principle ("the linker names no predicate itself") applied consistently.
- **Word lists classify words, not things.** Whether "baker" is an occupation is a fact (`is_a baker occupation`), and a memory with bakers in it has it. When the list and the memory disagree (world-v1 has 28 occupation classes; the list has 65 nouns), the user gets a question about a word the memory understands.
- **Exact matching ignores the evidence that would decide.** When "be the chef at" fails, the memory may hold `occupation` with the object class `chef` and `works_at` with organizations; the sentence's tree says where the phrase could be cut; the types say which cut is well-formed. All of that is discarded today.
- **Agents collide on code.** The copula was implemented twice on 2026-10-01 by two agents in `sop/` (journal 14:50 to 14:54), because the only way to teach the linker a reading was to write code. Data in a base memory, validated by the knowledge validator and reviewed in the audit UI, does not collide this way.

---

## 2. Where linking should live

### 2.1 The four designs

**(a) A separate KnowledgeLinker after SymbolicLM.** Parsing is knowledge-independent; linking is a later host step over the parse's strings. This is the current architecture and the two-stage design of Kwiatkowski, Choi, Artzi and Zettlemoyer (2013), who parse to a domain-independent logical form and then do "on-the-fly ontology matching" to the KB; of Reddy, Lapata and Steedman (2014), who build *ungrounded* semantic graphs from CCG and then ground them to Freebase by graph matching; and of UDepLambda (Reddy et al. 2016, 2017), which derives language-independent logical forms from Universal Dependencies and grounds them afterwards. The lesson of those papers is that the matching stage needs **candidates and scores**, not a table lookup: Kwiatkowski et al. learn a matching model with lexical and structural features; Reddy et al. score grounded graphs by lexical similarity and by whether the grounded graph is answerable against the KB.

**(b) KB-aware parsing.** The grammar consults the KB while parsing, as in SEMPRE (Berant, Chou, Frostig and Liang 2013), whose lexicon is induced from ReVerb alignments and whose *bridging* operation inserts predicates the words do not mention, with the KB deciding; Yih et al. (2015) grow a query graph step by step with entity linking first; Krishnamurthy and Mitchell (2012) train the CCG lexicon against KB facts. Applied here, the UD-to-SOP rules would read the base memory's lexicon while segmenting the sentence and would emit the memory's predicates. Strength: segmentation and role choice are made where the information to make them is. Cost: the output depends on the memory, so one message has as many programs as there are memories; the regression suite `symbolic_english` (defined on the analysis and one SOP per message), the datasets, the gold convention and the small LLM's training target all break or multiply.

**(c) Linking as reasoning.** Each candidate link is a hypothesis (`link "work at" works_at`, `entity "Paris" paris`), and interpretation is abduction: find the cheapest set of hypotheses under which the message is consistent with the knowledge and the question has an answer (Hobbs, Stickel, Appelt and Martin 1993). ChatSOP already has the machinery: `hypothesis` wires, `mode abduce`, `reasoning/abduction.mjs` with cost-ordered subset enumeration and minimality, integrity constraints and typed predicates. The reasoner would prefer the reading under which the predicate exists, the entities have the declared types, no integrity constraint is violated and facts exist. Weaknesses: the engines have no strings and cannot generate candidates; costs are lexical (edit distance, synonymy, frequency) and must be computed outside; the choice must be explained in words; a joint abductive search over every mention is combinatorial without the lexical pruning first.

**(d) Joint approaches.** Entity and relation candidates are chosen together under constraints: DEANNA (Yahya et al. 2012) formulates question interpretation over a knowledge base as an ILP over phrase-to-entity, phrase-to-class and phrase-to-relation mappings with type and co-occurrence constraints; EARL (Dubey et al. 2018) does joint entity and relation linking by treating it as a generalized travelling salesman problem over candidate lists, using the KB graph's connectivity as evidence; Falcon (Sakor et al. 2019) and Falcon 2.0 (Sakor et al. 2020, for Wikidata) are **rule-based**, use English morphological and lexical rules with a knowledge-base-agnostic catalogue of relation surface forms, and verify a candidate pair by a query against the KB ("does any triple with this relation and this entity exist?"), which is exactly the kind of KB evidence our memories can provide cheaply. QALD systems (Unger et al. 2012, TBSL; Pythia) use lexicalized ontologies in **lemon** (McCrae et al. 2012) to map the grammar's words to the ontology's properties, and M-ATOLL (Walter, Unger and Cimiano 2014) induces such lexicons automatically from corpora. Entity linking systems such as DBpedia Spotlight (Mendes et al. 2011) and REL (van Hulst et al. 2020) separate mention detection, candidate generation from alias tables and disambiguation by context and prior; the surveys (Shen, Wang and Han 2015; Rao, McNamee and Dredze 2013) agree that alias tables plus a prior and a type constraint carry most of the accuracy, with coherence among the mentions of one text as the main refinement (Ratinov et al. 2011; Cucerzan 2007).

### 2.2 How the designs fare against ChatSOP's own rules

| Criterion | (a) separate linker | (b) KB-aware parsing | (c) linking as reasoning | (d) joint |
| --- | --- | --- | --- | --- |
| Model boundary (AGENTS.md) and one SOP per message | kept | broken for SymbolicLM; the small LLM could not reproduce it | kept (hypotheses are host wires) | kept if the joint step is on the host side after parsing |
| `symbolic_english` as a regression suite | kept | broken (the suite would need a memory) | kept | kept |
| "Never guesses": clarification instead of a pick | natural; today's behaviour | the grammar would pick | abduction *is* a pick unless reported and tied to evidence | a constrained joint choice is a pick unless reported; evidence can be shown |
| Uses argument types, `is_a`, integrity, facts | not today; possible | yes | yes, natively | yes |
| Uses the sentence's structure to re-segment | not today; possible if the analysis is passed | yes | no | yes if candidates include segmentations |
| Memory-specific knowledge lives in the memory | yes, if the lexicon is compiled from the memory | yes | yes | yes |
| Explainability (DS014 packet, readings) | good | poor (why did the grammar choose) | good (hypotheses, cost, used) | good (constraints violated, evidence found) |
| Engineering risk | low | high (rules v2.7 rewrite, datasets regenerate) | medium | medium |

### 2.3 Recommendation: a scored, memory-driven KnowledgeLinker after SymbolicLM, joint over the mentions of one message, with the reasoner as arbiter

Keep (a) as the architecture, make the linker a real linker in the sense of (d), and use (c) for the final choice among a few surviving readings. Concretely:

1. **SymbolicLM stays knowledge-blind** and emits the primary reading as today. The host additionally receives the grammatical `analysis` SymbolicLM already returns (DS014 "API": `analysis` with one `[id, form, lemma, upos, head, deprel]` row per token). The analysis is a host artifact of the current turn, not model input, so no boundary rule is touched.
2. **The lexicon is the base memory's**, compiled from its circuits (section 3) and layered over `core-en` (section 4). `SessionRuntimes.open` builds or fetches the lexicon of the session's base plus the accepted session circuits, cached by the circuits' hash.
3. **Candidate generation** per mention: relation phrase by phrase key over the memory's `lexeme` forms; dictionary tiers; **segmentation alternatives** derived from the analysis (move the boundary between the relation phrase and the object value along the UD tree: "be the chef at" + NP, "be the chef" + "at" NP, "be" + "the chef at" NP; this is the `boundary` level of `frames.mjs`, done on the tree rather than on strings); head-verb match with a preposition penalty; entities by alias, dictionary, class noun, "the user". No embeddings in the decision path (AGENTS.md: identity is never settled by similarity); an embedding or FTS index may **propose** candidates later (proposal 11.2 item 3) and is out of scope here.
4. **Constraints**: role-set compatibility (exact for statements, subset for queries, as today), argument types against the classes of the linked entities (`is_a` facts and the memory's class symbols), direction (a `converse` lexeme swaps subject and object), one reading per mention.
5. **Evidence**: for a query, whether the memory holds any fact or rule head of the candidate predicate (`rulesFor`, `count(pattern)` of the retrieval contract in proposal 11.3) and whether a fact of that predicate mentions the linked entity (Falcon's verification query). Evidence breaks ties; it never creates a link that no lexical candidate proposed.
6. **Joint choice**: the assignment that satisfies the constraints and maximizes the lexical score, with ties broken by evidence. If one assignment remains, it binds and the packet reports it (`linking` with the chosen candidate, its evidence and the rejected alternatives, like `copula_readings` today). If several remain with equal evidence, or none, the host asks the precise question (today's `linkQuestion` texts, extended by "did you mean … or …?" over the surviving readings).
7. **The reasoner as arbiter** (later milestone): when the memory has integrity constraints or typed rules, the surviving readings are written as `hypothesis` wires over a `link` predicate and `mode abduce` chooses the readings under which the query is answerable without violating an integrity constraint; the result is reported as a host assumption with `basis linking`, so the user sees "I read 'be a doctor' as the occupation relation". This is Hobbs's "interpretation as abduction" restricted to a handful of candidates, which is where it is tractable.

### 2.4 Why not (b), in the owner's terms

The owner asked whether the heuristics that generate the circuits should rely on the KnowledgeLinker. The executed circuit should; the rules should not. If the rules consulted the base memory: the same sentence would formalize differently in two sessions; every change in a memory could change a parse and break the regression suite; the gold SOP of 13,688 rows would be defined relative to a memory; and the small LLM, which must one day write the same surface from the message alone, could not learn it. The owner's own boundary ("the small formalizer has no context") was chosen for the LLM for exactly these reasons, and they hold for SymbolicLM. What the owner correctly senses as "off" is not that the rules are knowledge-blind; it is that their blind guess is treated as final and the linker is too weak to revise it. Giving the linker the analysis and the memory, and letting it choose among structurally licensed readings, removes the problem without moving knowledge into the rules.

### 2.5 Why not pure (c)

Linking by abduction alone would need candidate links as hypotheses for every mention, with costs; the cost model is lexical and lives outside the engine, the candidate space without lexical pruning is the product of all alias matches, and the engines never see a string. The abduction controller is the right **arbiter** and the right **formal account**; it is not the right **generator**. Keeping the generator deterministic and lexical also keeps the "never guesses" rule checkable: a candidate exists only if a reviewed form proposed it.

### 2.6 The model boundary: what must and must not apply to SymbolicLM

AGENTS.md "Model boundary" is written for the small LLM: the prompt is the message, no CONTEXT block, no entity or predicate list, no lexicon, no clock. DS014 "SymbolicLM" already extends it: "its only input is the message … it never reasons and never refuses" and the query rules "never [use] a lexicon of the knowledge". The proposal makes the extension explicit and precise:

- **Applies to SymbolicLM**: no predicate ids, no entity list, no facts, no base memory, no clock, no earlier turn at parse time. One message gives one program whatever memory is in use.
- **Does not apply** (and should be written down so that nobody treats it as a violation): SymbolicLM may read **language data** that is not knowledge of any memory: function-word lists, the copula's verb forms and articles, the bilingual dictionary (`sop/dictionary.mjs`), spelling lexicons. These are the resources of `lib/ud-to-sop/lexicon.mjs` and `config/dictionary/` today. The test is simple: a resource is language data if it would be the same for every base memory.
- **The host's new input**: the linker receives the analysis. Guards `tests/model-input-boundary.test.mjs` and `tests/no-context-lint.test.mjs` are unaffected (they guard the model's input, and the analysis is the model's output). DS014 "Host linking" should gain one sentence saying that the host linker may read the grammatical analysis of the current message.

---

## 3. The lexicon as knowledge

### 3.1 Principle

Every lexical form that links a word to a symbol is **knowledge of a base memory**, written in SOP Lang, validated by the knowledge validator, reviewed through the audit UI and recorded in provenance, exactly like a fact. The host code holds no predicate names and no word-to-predicate lists; `config/relation-lexicon.json` keeps only the copula's function words (verb forms, articles, locative prepositions), which are language data, and its `occupations`, `attributes` and `relations` lists move into `core-en` as entities and lexemes. `config/ontology.sop` becomes the circuits of a small demo base memory (`demo`), not a global file.

### 3.2 The wire design

Three changes to the knowledge grammar (`sop/knowledge/grammar.mjs`), one new wire, and the retirement of the separate ontology grammar in `sop/parser.mjs` (the `Lexicon` is then compiled from knowledge circuits).

**`predicate` (extended).** Keeps `args`, `closed`, `key`, `transitive`, `inverse`, `unit`, `description`, `reading`, `describe_rank`, and gains `label LANG "surface"` (one display form per language) and the existing `role NAME TYPE` form as an alternative spelling of `args` (both exist today in different grammars; one validator reads both and requires agreement). Lexical forms do **not** go on the predicate as `alias` lines: a form has its own role frame, direction and part of speech, and several predicates may share a form, which is information the linker needs and a flat alias list loses.

```
@works_at predicate
  args subject:person object:organization
  label en "works at"
  label ro "lucrează la"
  description "a person works at an organization; no employment status implied"
```

**`lexeme` (new, authoring surface).** One lexicalization of one predicate: the relation phrase in the model-language convention (the lemma with particles and prepositions, the copula included for copular phrases), its language, part of speech, the role frame it realizes and whether it is a converse.

```
@lx_works_at_en lexeme
  of works_at
  language en
  pos verb
  form "work at"
  form "work for"
  form "be employed by"
  form "have a job at"
  form "be on the payroll of"
  frame subject object
  source "mined from datasets/symbolic_english train, 998 mentions of 'work at'"

@lx_employ_en lexeme
  of works_at
  language en
  pos verb
  form "employ"
  frame object subject
  source "converse: the organization is the grammatical subject"

@lx_works_at_ro lexeme
  of works_at
  language ro
  pos verb
  form "lucra la"
  form "fi angajat la"
  form "munci la"
  frame subject object
```

Fields: `of` (required, a declared predicate), `language` (two or three letters), `pos` (`verb`, `noun`, `adj`, `prep`, `copula`), `form` (repeatable, one JSON-quoted phrase per line, compared by the linker's phrase key), `frame` (the predicate's roles in the order the surface realizes them: first the grammatical subject's role, then the object's, then optional obliques; `frame object subject` is a converse), optional `restrict ROLE CLASS` (repeatable: this form applies only when the role's value is of the class, which is how "be in" can mean `located_in` for places and `member_of` for teams in one memory), optional `weight N` (an integer priority among forms of different predicates that share a surface; the validator requires a `restrict` or a `weight` whenever two lexemes of different predicates share a form with the same frame, so ambiguity is always declared, never discovered), and `source`/`quote` as for every knowledge wire.

**`entity` (new to the knowledge grammar; exists in the ontology grammar).** `kind CLASS` (a class symbol of the memory), `label LANG "surface"`, `alias LANG "surface"` (repeatable; inflected forms such as "Anei" are aliases), optional `notability N` (an integer the memory supplies, for world-v1 the number of Wikipedia editions; used only to decide which namesake gets the **plain** label at build time, as world-v1 does today, never to pick at link time). Classes are entities whose `kind` is `class`, with `is_a` facts between classes, so "doctor", "city" and "occupation" are ordinary entities and type checking is `is_a` reasoning.

```
@doctor entity
  kind occupation
  label en "doctor"
  alias en "physician"
  label ro "medic"
  alias ro "doctor"
  alias ro "doctorul"
```

**`concept` is retired**: a class is an `entity` of kind `class`, and `is_a` facts replace `is_a` lines.

**Copula readings** stay on `predicate` as `reading` and `describe_rank` (DS014 "The copula"), unchanged; what changes is that the nouns and adjectives that select between `class`, `occupation` and `attribute` are no longer word lists but entities of `core-en` (members of `occupation`, `class`, `property`), so the choice is made by `is_a`.

**Units.** `unit` on a predicate names a unit symbol (`cents`, `minutes`, `years`, `km2`, `persons`); `core-en` holds `unit` entities with their lexemes ("lei", "RON", "euro", "minutes", "min") and `unit_factor` facts; the linker normalizes an amount string in a role whose predicate has a unit, and refuses (clarifies) when the unit is unknown or incompatible.

### 3.3 Compiling the lexicon of a base memory

`lib/chat-data/memories.mjs` gains `lexicon(id)`: parse the circuits of the memory and of its imports (section 4.3), collect `predicate`, `lexeme`, `entity` and `is_a` facts, build the indexes of today's `Lexicon` (exact, folded, token index, predicate forms by phrase key, class membership), and cache the compiled object on disk under `state/cache/lexicon/<sha256 of circuits>.json`, as `sop/dictionary.mjs` caches its compilation. A session's lexicon is the base's plus the session's accepted circuits (recompiled on `refresh`). For world-v1's size (about 20k entities, 50k aliases) the compiled index is a few megabytes and loads in well under a second; `tools/world-kb/lexicon.mjs` already merges shards this way.

### 3.4 How the linker scores a candidate

For each mention the linker builds candidates and scores them with integer scores (words, not floats, in the reports), in this order of evidence:

| Signal | Relation | Entity | Score |
| --- | --- | --- | --- |
| exact form (phrase key equal to a `lexeme` form / an alias) | yes | yes | 100 |
| exact form after the dictionary's canonical translation | yes | yes | 90 |
| other translation or listed synonym | yes | yes | 80 |
| form reached by a segmentation alternative licensed by the UD tree | yes | yes (the value changes with the cut) | 70 plus the form's own score minus 10 per moved token |
| head verb equal, preposition differs or missing | yes | no | 50 |
| role frame compatible (exact for `stated`, subset for queries) | required | — | constraint |
| argument types compatible with the linked entities' classes (`is_a`) | required when the predicate declares typed roles and the entity has a known class; a type clash removes the candidate | required | constraint |
| `restrict` of the lexeme satisfied | required | — | constraint |
| evidence: the memory holds facts or rules of the predicate; a fact mentions the linked entity | tie-break | tie-break (which namesake occurs with this predicate) | +5, +5 |
| coherence: the other mentions of the message link to the same domain or to entities connected by facts | tie-break | tie-break | +3 |

Decision rule: take the candidates within 10 of the best; if exactly one, bind and report; if several share the best score and the evidence does not separate them, clarify with the options named in words (the lexeme's `label`, the entity's label and class); if none, clarify as today ("I do not know the relation …", "Which entity do you mean by …?"). A `stated` proposition is bound only by an exact or translated form (scores 90 and above) so that a user's assertion is never recorded under a relation they did not say; a query may use the lower tiers because a wrong reading of a question yields a visible answer with the reading reported, not a stored fact (AGENTS.md rule 7 is untouched: nothing here writes).

### 3.5 When it asks

The linker asks a question, and does not guess, when:

1. no candidate exists for a relation or an entity (today's questions, kept);
2. two or more candidates tie after constraints and evidence (the question names them: "Do you mean that Ana works at the Bistrița Philharmonic, or that she is its chef?");
3. the only candidates come from the low tiers (head verb only) and the proposition is a `stated` wire;
4. an entity name matches several entities of the required type with no `plain` label policy deciding (world-v1's collision rule remains at build time);
5. an amount has no unit or a unit incompatible with the predicate's.

Everything else is bound and **reported**: the packet's `linking` field lists, per mention, the surface, the chosen symbol, the lexeme or alias that matched, the score tier, the evidence, and the alternatives not taken, in the answer language, so the "I understood" panel can show "I read 'be a painter' as occupation (alternative: class)".

---

## 4. A default English-adapted base memory: `core-en`

### 4.1 Candidates and what to take from each

Rights are per asset (DS011). Each source below needs its row in `docs/specs/DS011-source-rights.md` and `datasets/SOURCES.md` before anything from it is ingested; the licence notes are my reading and must be verified by the agent that records the row.

| Source | Licence (to verify) | Take | Do not take |
| --- | --- | --- | --- |
| Princeton WordNet 3.0 (already cached, `datasets_sources/wordnet-3.0/`, used by `frames-wordnet.tsv`) | WordNet licence: permissive with notice | verb and noun synonyms for the lexeme forms of core predicates; hypernym chains for the class skeleton (person, organization, location, artifact, event) | the whole hierarchy (too fine; 117k synsets) |
| Open English WordNet 2024 | CC BY 4.0 | the same, with current vocabulary; preferred over 3.0 for new entries | — |
| ConceptNet 5.7 | CC BY-SA 4.0 | relation names and surface templates (`IsA`, `PartOf`, `AtLocation`, `CapableOf`, `UsedFor`) for a handful of core predicates; a few thousand `IsA` facts for common nouns if the share-alike file is kept separate, as `wiktionary.tsv` is | the crowd assertions in bulk (noisy; SA) |
| schema.org | CC BY-SA 3.0 | the names and definitions of core types (`Person`, `Organization`, `Place`, `Event`, `Product`, `CreativeWork`) and properties (`worksFor`, `location`, `memberOf`, `founder`, `birthDate`) as the class skeleton and as English lexeme hints | text of definitions beyond short attributed quotes |
| Wikidata | CC0 | property labels and **aliases** in English and Romanian (P108 "employer": "works at", "employed by"; P19 "place of birth": "born in"), class labels, and instance data for world-v1; this is the richest licence-free source of relation lexicalizations | — |
| SUMO | GPL | the structure of the upper classes as inspiration (`inspired-by`), with no text copied | any text or axiom text (copyleft) |
| DOLCE-Lite, BFO 2020 | CC BY 4.0 (DOLCE-Lite-Plus; BFO) | the distinction endurant/perdurant (object vs event), qualities vs objects (attribute readings), roles (occupation as a role, not a class of person) | the formal axioms (not expressible; not needed) |
| FrameNet 1.7 | CC BY 3.0 (data) | frame elements for the role frames of core verbs (Employment: Employee, Employer; Residence: Resident, Location) | lexical units in bulk |
| VerbNet 3.4, PropBank frames | VerbNet licence (permissive, attribution); PropBank frame files CC BY-SA 4.0 | syntactic frames of the 544 head verbs (which argument is the subject, which prepositions license which role) for the `frame` lines and for the `PREP_ROLE` table of the rules | — |

### 4.2 What the minimal useful core contains

A core is useful when a chat on an otherwise empty memory can understand the sentences our tests ask, answer "I have no facts about that" rather than "I do not know the relation", and when every domain memory can reuse its predicates instead of inventing `works_at` again.

| Area | Classes (entities of kind class) | Predicates with lexemes | Rules and readings |
| --- | --- | --- | --- |
| **upper** | `entity`, `person`, `organization`, `place`, `event`, `artifact`, `document`, `product`, `service`, `class`, `occupation`, `property`, `unit`, `time` | `is_a` (reading class, describe 1), `same_as` (identity), `has_property` (attribute), `description` (describe 2), `label` | `is_a` transitive over classes |
| **copula** | the members of `occupation` (about 65 from `relation-lexicon.json`, plus world-v1's 28), the members of `property` (about 47 adjectives) | `occupation` (reading occupation, describe 3) | the five readings declared; no code list |
| **place and part** | `country`, `city`, `continent`, `region`, `address` | `located_in` (reading location; transitive), `part_of` (transitive), `near`, `capital_of`, `borders` | `located_in` transitive; `part_of` transitive; capital located in country |
| **people and kinship** | — | `parent_of`, `mother_of`, `father_of`, `child_of`, `sibling_of`, `married_to`, `grandparent_of`, `ancestor_of`, `born_in`, `birth_year`, `died_in`, `death_year`, `age`, `citizen_of`, `live_in` | grandparent and ancestor rules; sibling from shared parent; `age` from birth year (compute) |
| **organizations and work** | `company`, `university`, `school`, `team`, `department` | `works_at`, `employed_by`, `manages`, `reports_to`, `member_of`, `head_of`, `founded`, `headquartered_in`, `studies_at`, `teaches`, `responsible_for`, `coach_of` | none beyond converses |
| **events and participation** | `meeting`, `course`, `tournament`, `festival`, `exam` | `attends`, `takes_part_in`, `hosts`, `held_at`, `held_on` (time), `organizes` | — |
| **possession and commerce** | — | `owns`, `sells`, `buys_from`, `supplies`, `costs` (unit cents), `borrows`, `rents` | — |
| **movement** | — | `travels_to`, `goes_to`, `moves_from_to` (source, destination), `arrives_at`, `leaves` | — |
| **health and documents** | `certificate`, `permit`, `licence`, `medication`, `allergen` | `allergic_to`, `treated_by`, `vaccinated_against`, `holds_document`, `issued_by`, `valid_until` | — |
| **time, quantity, units** | `year`, `date`, `period`, units `cents`, `minutes`, `hours`, `days`, `years`, `km`, `km2`, `persons` | `duration` (unit minutes), `population_of`, `area_of`, `distance_between`, `unit_factor` | `compare` and `rank` need no rule; unit normalization in the linker |
| **communication and modality** (for `not_computable` answers that still link) | — | `says`, `asks_for`, `confirms`, `approves`, `needs`, `wants` | — |

Size: about 30 classes, 150 to 250 predicates, 600 to 900 English forms, 100 to 150 Romanian forms, 15 rules. It fits in a handful of circuits under the parser's 2,048-wire limit.

### 4.3 Composition with domain memories: imports and layering

DS022 gives a base memory a `parent` (fork). Add `imports`: a list of base memory ids with their circuit hash in `manifest.json`. The theory of a memory is the imports' circuits followed by its own; the lexicon is compiled over all layers; validation of `addKnowledge` runs over all layers, so a layer cannot redeclare a predicate with a different signature (`duplicate_id` / `type_mismatch`) and may add `lexeme` wires for an imported predicate (world-v1 adds "be the capital of"; the programming memory adds nothing to `works_at`). Two lexemes of different predicates that share a form with the same frame must declare `restrict` or `weight`, enforced across layers, so an import can never silently change the meaning of a word in the importing memory. `default` imports `core-en`; `world-v1` imports `core-en` and declares its 45 predicates as its own or, where they coincide (`located_in`, `born_in`, `is_a`, `occupation`, `capital_of`), as lexemes and facts of the core predicates (the `MAPPING` table of `tools/world-kb/mapping.mjs` decides per row); the programming memory of `programming-kb-plan.md` imports `core-en` for its persons, organizations and time, and adds its own vocabulary. Forks copy the `imports` list; a session clones the layered theory as today. The retrieval of DS005 is unchanged: imported circuits are ingested into the memory's repository at creation like the memory's own.

---

## 5. Populating `core-en` from our tests

### 5.1 What the data contains (measured)

Over `datasets/symbolic_english/{train,dev}.jsonl` and `datasets/neuro_english/{train,dev}.jsonl` (13,688 rows), reading `gold_sop` where present and `sop` otherwise:

- 40,040 relation mentions, 2,557 distinct phrases, 544 distinct head verbs. The 50 most frequent phrases cover 62.1% of mentions, the top 100 80.7%, the top 238 (those with 10 or more mentions) 90.2%, the top 571 (3 or more) 94.2%. 60.8% of the rows use only top-100 phrases, 74.0% only top-238 phrases.
- The copula heads 12,998 mentions (32%) in 644 distinct phrases: `be based in` 882, `be on` 661, `be a parent of` 619, `be allergic to` 545, `be the coach of` 537, `be responsible for` 525, `be enrolled at` 482, `be issued by` 471, `be the boss of` 436, `be held at` 428, `be in` 387, `be certified` 352, bare `be` 146.
- Role sets: subject+object 26,630; subject only 4,287 (states such as `be certified`, `be postponed`); subject+location 2,628; subject+destination 1,425; subject+topic 1,345; subject+object+time 948; subject+source 669; subject+instrument 549; subject+object+recipient 256.
- Values: 70,030 role values; 4,863 distinct proper names (synthetic people and companies: "Carpathia Energy" 342, "Oana" 150), 5,454 distinct common-noun values ("search index" 391, "driving licence" 257, "mathematics" 219, pronouns), 440 "the user", 32 bare numerals.
- The archived verification world `datasets_archive/formalizer-v1/world/predicates.sop` declares 78 predicates with typed roles and 167 English and about 60 Romanian surfaces; those English surfaces alone name 82.8% of the mentions, and together with `config/dictionary/frames-world.tsv` and `frames-train.tsv` (297 surfaces) 83.6%. The uncovered frequent phrases are mostly action verbs that no world needs as predicates (`check` 129, `need` 118, `arrive` 100, `leave` 65, `approve` 55, `sign` 43) and bare `be` 146.
- The smoke cases (`eval/smoke-reasoning/cases/`, 144 cases) declare 198 distinct predicate names; most are abstract or scenario-specific (`blocked`, `reach`, `flies`, `valve_a_open`), about 40 are general (`located_in`, `parent`, `grandparent`, `ancestor`, `works_at`, `employee_of`, `member_of`, `salary`, `age`, `budget_of`, `colleague`, `certified`).
- `datasets/natural/messages.jsonl` (226 owner messages, Romanian instructions to an assistant about this software) contributes almost no linkable entities or relations; it is a realism check for forms and register, not a vocabulary source.
- world-v1 (`tools/world-kb/MAPPING.md`): 54 property rows, about 45 predicates, 14 classes, English aliases on most predicates, Romanian on a few; its 30 chat questions (`eval/world-kb/questions.json`) are the first real-world linking test.

### 5.2 The pipeline

1. **Mine** (`tools/linking/mine-vocabulary.mjs`, new): read the four dataset splits, the smoke cases' `knowledge.sop`, the archive world, the frames TSVs and `relation-lexicon.json`; emit `eval/reports/current/linking/vocabulary-mined.json` with, per relation phrase, its count, role sets, head verb, preposition, the classes of its values (proper, common, number, pronoun, "the user"), three example messages with row ids, and the predicate the row world declares for it when a gold exists (`lib/row-world.mjs`). Per common-noun value: count and the relations it occurs with (its probable class). Per archive predicate: its surfaces and roles.
2. **Cluster**: group phrases by `phraseKey`, then by the dictionary's `sameMeaning` and the frames' surfaces, then by the row-world predicate; propose one predicate per cluster with the most frequent phrase as `label`, the others as `form` lines, the archive's Romanian surfaces as the `ro` lexeme, and the majority role set as `args`. Phrases with fewer than 3 mentions and no world predicate are listed, not proposed. Expected: about 250 clusters.
3. **Author** with the coding agent (`POST /v1/author`, DS022) under `skills/sop-wire-authoring/SKILL.md` plus a new addendum `skills/sop-wire-authoring/lexicon.md` (the `lexeme` and `entity` patterns, the rule that a `form` is written in the model-language convention, the rule that every predicate has at least one English lexeme and a `label`, the rule that occupations and properties are entities of the right class, and the rule that the `source` of a mined wire names the dataset and the row ids). One omp batch per area of section 4.2 (kinship, work, study, commerce, travel, events, health and documents, place, time and units, copula classes), each with its `queries.sop` test queries (every predicate asked once through a SymbolicLM-shaped `match` block, so the test is a linking test) and `report.md`.
4. **Validate**: the knowledge validator in authoring mode, extended with a **lexicon lint**: every predicate has a label and an English lexeme; frames agree with `args`; shared forms declare `restrict` or `weight`; every `form` links back to exactly its predicate through the linker (round trip); forms attested in the mined inventory are marked, unattested ones are warnings; the coverage of the mined mentions by the authored forms is printed (target: at least 90% of mentions, 75% of rows fully covered).
5. **Review and accept**: the drafts appear on the audit page under a `lexicon` view (the `archive / sources` tab gains the mined inventory and the proposed wires with their example sentences); the owner accepts a batch through `addKnowledge` into `core-en`, with provenance; the journal records the batch size.
6. **Verify on the datasets**: run the linker over every `symbolic_english` train and dev row against `core-en` layered with the archive world and compare the linked circuit with the gold's execution signature (`eval/signature.mjs`, the `execution_equivalence` metric of DS012 already does this per row world); regressions are rows that linked before and clarify now.

### 5.3 Expected counts

| Artifact | Expected | Basis |
| --- | --- | --- |
| core predicates | 200 to 250 | 238 phrases with 10 or more mentions; the archive's 78 typed predicates; world-v1's 45 (partly the same) |
| English lexeme forms | 600 to 900 | 571 phrases with 3 or more mentions, plus the archive's 167 and the frames' 297 surfaces, deduplicated |
| Romanian forms | 100 to 150 | the archive world's `ro` labels and aliases; `generator.tsv` (256 entries) |
| classes | 25 to 35 | section 4.2; the generator's role types (`person`, `organization`, `project`, `place`, `event`, `document`, `product`) |
| occupation and property entities | about 110 | 65 occupations and 47 attributes of `relation-lexicon.json`, plus world-v1's 28 occupations |
| rules | 10 to 15 | kinship, transitivity, capital-located-in |
| common-noun classes for the datasets' values | about 15 | "search index", "billing service" (service); "driving licence", "work permit" (document); "jazz evening", "charity run" (event); "olive oil", "winter tyres" (product); these are classes in core, instances in a domain memory |
| test queries | one per predicate plus one per copula reading plus one per clarification case | the authoring skill's rule |

### 5.4 What we will not get from tests

- **Real-world entities**: people, places, works. They come from world-v1 (Wikidata, CC0) and from domain memories, not from the generator's "Carpathia Energy".
- **Noun lexicalizations and possessives**: the gold convention writes "the employer of X" as a copular relation phrase (`be the employer of`), so forms such as "X's employer" or "the manager" as a noun phrase with a `role` are rare; Wikidata aliases and FrameNet fill this.
- **Event relations with more than two participants**: 948 mentions have a time role and 256 a recipient; the reified-event pattern of the authoring skill has almost no test coverage; the smoke cases `50` and `62` are the only ones.
- **Units and amounts**: 32 bare numerals and a few strings such as "2380 lei"; the unit table will be authored, not mined.
- **Romanian beyond the generator**: the Romanian surfaces come from the archive world's constructions; real Romanian phrasing of the same relations needs the `bad_english` targets or Wikidata's Romanian property aliases.
- **Polysemy and clarification cases**: the corpora were built unambiguous; the clarification policy needs a hand-made set of ambiguous messages (section 6.1).
- **Coverage of forms the system was not built for**: the evaluation policy (AGENTS.md rule 9) forbids claiming it, and the vocabulary inherits the limit.

---

## 6. Evaluation

### 6.1 The labelled linking set

`eval/suites/linking-v1/` with three parts, each row labelled per mention (`{surface, kind: relation|entity|class|literal, gold: {symbol, frame}, alternatives, memory}`):

1. **Dataset rows with a row world** (mechanical labels): the test split of `symbolic_english` (1,605 rows) and `neuro_english` where a gold SOP exists; the gold predicate and entities per mention come from the row world (`lib/row-world.mjs`) and the gold SOP, so no judge is needed; the memory is `core-en` layered with the archive world.
2. **world-v1 questions**: the 30 questions of `eval/world-kb/questions.json`, extended to about 300 by the form-variant generator (`tools/datasets/form-variants.mjs`: same form, other countries, people, works), labelled from `MAPPING.md` mechanically where the question is generated and by an LLM judge where it is hand-written; the memory is `core-en` layered with world-v1.
3. **Ambiguity and clarification cases** (hand-made, about 100): messages where two readings are genuinely plausible in the memory ("Is Ana in the choir?" membership vs location; "Who is the head of Alfa?" head_of vs describe), where an entity name collides, where a unit is missing; the expected outcome is a specific clarification or a reported reading.

Labelling where mechanical labels are impossible follows the project's judge routing (calibrated DeepSeek via omp task folders, 100 hand-checked rows for calibration, inter-judge agreement reported); labels are data under review (`review_status`), never model input. The datasets' content-word policy (lexically disjoint test variants) applies: a test row's forms must appear in train rows with other words.

### 6.2 Metrics

| Metric | Definition | Target (M3) |
| --- | --- | --- |
| entity linking accuracy | mentions whose chosen symbol equals the gold / labelled entity mentions (unknown-in-memory mentions count as correct when clarified) | at least 97% on part 1, 90% on part 2 |
| relation linking accuracy | mentions whose chosen predicate and frame equal the gold / labelled relation mentions | at least 95% on top-238 forms, 85% overall on part 1; 85% on part 2 |
| class linking accuracy | copula objects linked to the gold class or occupation entity | at least 90% |
| full-query linking | rows whose linked circuit has the gold's execution signature (`eval/signature.mjs`, DS012 `execution_equivalence` with the dictionary enabled) | at least 85% on part 1, 75% on part 2 |
| end-to-end answer accuracy | world-v1 questions whose packet contains the expected answer (`tools/eval/chat/world-kb-chat.mjs` already measures this) | at least 70% at M2, 85% at M4 |
| clarification rate | messages answered with `clarify` for linking reasons / messages; split into justified (part 3, gold says ask) and unjustified | unjustified at most 10% of part 1 rows at M2, 5% at M3; justified at least 90% of part 3 |
| wrong-link rate (safety) | messages where a wrong symbol was bound and an answer given without the alternative reported / messages | at most 1%; this is the number that must never grow |
| latency | linking time per message on four CPU cores with the world-v1 lexicon | median under 50 ms, 95th percentile under 200 ms |

Baselines, reported side by side: the current exact linker (today's code against `config/ontology.sop`), the same against the compiled per-memory lexicon (M1), plus dictionary tiers, plus frames (`sop/frames.mjs`), plus the scored linker (M3), plus the abductive arbiter (M4). The frames normalizer's numbers already exist in evaluation reports and give a lower bound of what synonym tables buy.

### 6.3 Early stopping and stages

Preregistered (DS007) as `eval-linking-v1`, staged on stratified samples of 100, 300 and the full set with a paired bootstrap interval after each stage. Stop rules: broken condition if the wrong-link rate exceeds 5% or more than 20% of the first 100 rows crash or produce no circuit; decisive if the interval of the gain over the previous baseline excludes zero by at least 5 points of full-query linking; futile if the upper bound of the gain is under 2 points. Every stop is recorded with its stage and numbers in the journal, the topic note and the experiment record.

---

## 7. A staged plan

| Milestone | Content | Size | Done when |
| --- | --- | --- | --- |
| **M0** (now) | Hotfix of the owner's failure: `SessionRuntimes` compiles a lexicon from the session's base memory circuits (predicate wires plus `label_en`/`label_ro` facts as entity aliases) and uses it instead of the global one; world-v1's `is_a`, `occupation`, `description_en`, `located_in` declare their readings (the worldkb-agent has started this in `tools/world-kb/ontology.mjs`); the packet reports `linking` (chosen predicate, matched form, alternatives) for every bound mention | 2 agent-days; about 200 lines in `lib/chat-data/memories.mjs`, `server/session-runtime.mjs`, `sop/declarative.mjs` | `tools/eval/chat/world-kb-chat.mjs` passes through the HTTP chat path with the same results as in process; "Who is Ada Lovelace?" on world-v1 answers from `description_en` |
| **M1** (first implementable spec, section 8) | The `lexeme` and `entity` wires in the knowledge grammar; `label`/`role` on knowledge `predicate`; one grammar (the ontology grammar retired, `config/ontology.sop` converted to the `demo` memory's circuits); `Lexicon` compiled and cached from circuits; `imports` in the manifest; the lexicon lint; the mined vocabulary report; linking suite part 1 with mechanical labels; the current linker's baseline numbers | 1 week; grammar, validator, lexicon compiler, mining tool, suite builder; DS004, DS014, DS022 and the wire help pages updated with executed examples | the validator accepts the new wires; the archive world rewritten as `lexeme`/`entity` circuits links the same rows as before (regression zero); the baseline table exists |
| **M2** | `core-en` authored from the mined inventory (10 omp batches), reviewed and accepted; `default` and `world-v1` import it; `relation-lexicon.json` reduced to function words, its lists moved into `core-en`; the clarification questions name the surviving options; world-v1 questions extended to 300 | 2 weeks; the authoring runs are data work (allowed) | coverage of mined mentions at least 90%; unjustified clarifications at most 10%; world-v1 end to end at least 70% |
| **M3** | The scored linker: segmentation alternatives from the analysis, type constraints through `is_a`, KB evidence, joint choice over the message's mentions, scores in the packet; `frames.mjs` retired into lexemes; linking suite parts 2 and 3 with judge labels; preregistered `eval-linking-v1` run with stages | 2 weeks | targets of section 6.2 at M3; wrong-link at most 1% |
| **M4** | The abductive arbiter (`hypothesis` wires over a `link` predicate, `mode abduce` among the survivors, reported as a host assumption with `basis linking`); integrity-aware linking; Romanian lexemes from Wikidata aliases and the `bad_english` targets; natural-seeded synthetic rows; units table; full report and article material | 2 to 3 weeks | world-v1 end to end at least 85%; the report in `eval/reports/current/linking/` |

**Risks.** (1) Two grammars drift again if the ontology grammar is kept "for now"; M1 must retire it. (2) Lexicon size: a memory with a million entities needs an on-disk index (SQLite FTS5 or the sqlite bank's own tables), not an in-memory map; the compile-and-cache design allows the swap, and the latency target is measured at M1 on world-v1. (3) Over-clarification: a joint linker with constraints can refuse more than the exact one accepted; the unjustified clarification rate is a gate, not a report. (4) Source licences: nothing is ingested before its DS011 row, and share-alike material stays in its own file. (5) The corpora's convention (nouns inside copular phrases) biases `core-en` toward verb forms; Wikidata and FrameNet forms correct it at M4. (6) Judge noise on parts 2 and 3; calibration is mandatory. (7) Agent collisions in `sop/`: the linker becomes one module folder (`sop/knowledge-linker/`) with one owner per milestone, and data changes go through `addKnowledge`, which cannot collide.

---

## 8. Summary and the first milestone as an implementable specification

### 8.1 Summary (twelve lines)

1. The chat failed on "be" because the lexicon is one global file (`config/ontology.sop`, 20 demo predicates) handed to every session, not the base memory's vocabulary.
2. A base memory cannot carry lexical forms today: the knowledge grammar's `predicate` has no `label`/`alias`, and the ontology grammar that has them is a second, separate grammar read only by the host `Lexicon`.
3. The KnowledgeLinker is five small modules doing exact phrase matching after dropping stopwords, plus dictionary tiers and six hardcoded copula readings selected by word lists; it never sees the sentence's analysis, the argument types or the memory's facts.
4. Linking is five problems (entities, relations with direction, classes, roles, literals and units); per-relation rules and word lists cannot cover a long tail of 2,557 phrases that mean different predicates in different memories.
5. Keep SymbolicLM knowledge-blind: one program per message is what makes the regression suite, the datasets and the future small LLM possible; "no context" for SymbolicLM means "language data yes, knowledge no".
6. Make the linker a real linker: candidates from reviewed forms, segmentation alternatives from the analysis, constraints from role frames and `is_a` types, evidence from the memory's facts, a joint choice over the message, and a reported decision or a precise question.
7. Use the reasoner as the arbiter among a few surviving readings (abductive interpretation), never as the generator; report the chosen reading as a host assumption.
8. The lexicon is knowledge: `lexeme` and `entity` wires in the base memory, `label` and `reading` on `predicate`, compiled into the memory's `Lexicon` and cached by circuit hash; word lists leave the code.
9. No session starts empty: `core-en`, an English-adapted core of about 30 classes, 200 to 250 predicates, 600 to 900 English and 100 to 150 Romanian forms, copula readings, time, units, part-of, located-in, kinship and organizations, imported by `default`, `world-v1` and the programming memory.
10. Populate it from our tests mechanically: 238 phrases cover 90% of the 40,040 relation mentions; the archive world already names 83%; the coding agent writes the wires, the validator plus a lexicon lint check them, the owner accepts them in the audit UI.
11. Tests will not give real entities, noun forms, event relations, units, Romanian beyond the generator or ambiguity cases; Wikidata (CC0), FrameNet/VerbNet and hand-made cases fill those.
12. Measure entity, relation, class and full-query linking, end-to-end world-v1 accuracy, the clarification rate split into justified and unjustified, and the wrong-link rate as the safety number, in preregistered stages with early stopping; M0 fixes the owner's failure in two days and M1 below is ready to start.

### 8.2 Milestone 1: the lexicon as knowledge, per-memory, with a baseline (implementable specification)

**Goal.** A base memory carries its own vocabulary in SOP Lang; the chat links against the vocabulary of the session's base memory; the current linker's accuracy is measured so later milestones have a baseline. No change to SymbolicLM, no change to the model surface, no training.

**Deliverables.**

1. **Grammar** (`sop/knowledge/grammar.mjs`, `sop/knowledge/validate.mjs`, `sop/knowledge/cross-checks.mjs`):
   - `predicate` gains `label` (many, `LANG "surface"`) and accepts `role NAME TYPE` (many) as an alternative to `args`, with the cross-check that both, when present, agree (`args_disagree_with_roles`).
   - New wire `lexeme`: `of*` (sym, a declared predicate; `unknown_predicate`), `language*` (two or three lowercase letters), `pos` (enum `verb noun adj prep copula`, default `verb`), `form*+` (text, one phrase per line, nonempty, no newline), `frame*` (role names in realization order; every name a declared role of the predicate; `frame_role_undeclared`), `restrict+` (`ROLE CLASS`, the role declared, the class an entity of kind `class` in the layered theory), `weight` (int), `source`, `quote`. Cross-checks: two lexemes of different predicates sharing a `form` (by phrase key) and the same frame length must both carry a `restrict` or distinct `weight` values (`ambiguous_form_undeclared`); a predicate with no `lexeme` in any language is a warning (`predicate_without_lexeme`); a `form` that does not round-trip through the linker to its own predicate is an error (`form_does_not_link`).
   - New wire `entity`: `kind*` (sym; an entity of kind `class`, or `class` itself), `label+` (`LANG "surface"`), `alias+` (`LANG "surface"`), `notability` (int), `source`. Cross-check: an entity with no label is an error; two entities with the same plain label in one language and no `notability` difference is a warning (`label_collision`).
   - `is_a` is an ordinary predicate of `core-en`; until `core-en` exists, M1 ships `config/knowledge/core-min/0001-upper.sop` with `is_a`, `class`, `entity`, `person`, `organization`, `place`, `occupation`, `property`, `unit` and nothing else, imported by `default`.
   - `node eval/smoke-reasoning/validator.mjs --grammar` regenerates the grammar block of DS004 (`tests/sop/knowledge-grammar.test.mjs` passes).
2. **One grammar**: `ONTOLOGY_SPEC` in `sop/parser.mjs` and the `allowTypes` path of `Lexicon` are removed; `sop/lexicon.mjs` gains `Lexicon.fromCircuits(circuits)` building the same indexes (`entities`, `predicates`, `exact`, `folded`, token index, plus `formsByKey` from lexemes and `classOf` from `is_a` facts and `kind` lines). `config/ontology.sop` is converted by `tools/convert-ontology.mjs` into `config/knowledge/demo/0001-vocabulary.sop` (predicates with labels, lexemes with the former aliases, entities), imported into a `demo` base memory at first start; tests that load `config/ontology.sop` load the converted circuits.
3. **Per-memory lexicon**: `BaseMemories.lexicon(id)` compiles the lexicon of a memory's layers (imports then own circuits) and caches it under `state/cache/lexicon/<sha256>.json`; `Sessions.lexicon(id)` adds the accepted session circuits; `SessionRuntimes.open` and `refresh` use it; `server/http.mjs` no longer loads a global ontology (the `ontology` key of `config/runtime.json` is retired; the single-repository path without chat data uses the `demo` circuits). `manifest.json` gains `imports: [{id, circuits_sha256}]`; `addKnowledge`, `fork`, `import` and `commit` validate over the layered theory; `tests/memory/memory-isolation.test.mjs` extends to imports (a change in an imported memory after creation does not reach the importer: the importer records the hash and the UI offers an explicit re-import).
4. **Linking report**: `compileDeclarative` returns `linking: [{wire, kind, surface, symbol, via: {lexeme|alias|dictionary|copula_reading|the_user}, tier, alternatives: [...]}]`; the packet and the HTTP trace carry it; the "I understood" panel shows it under the existing readings line.
5. **Mining and baseline**: `tools/linking/mine-vocabulary.mjs` writes `eval/reports/current/linking/vocabulary-mined.json` and `vocabulary-mined.md` (the tables of section 5.1, regenerated); `tools/eval/linking/suite.mjs build` writes `eval/suites/linking-v1/part1.jsonl` from the `symbolic_english` and `neuro_english` test splits with mechanical labels from their row worlds; `tools/eval/linking/suite.mjs run --linker current` runs the existing linker against the archive world converted to `lexeme`/`entity` circuits and writes `eval/reports/current/linking/baseline-current.json` with the metrics of section 6.2 (entity, relation, class, full-query, clarification split, wrong-link, latency); `eval/leakage.mjs` lists the suite as sealed.
6. **Documentation**: DS004 (the `lexeme` and `entity` wires, `label` on `predicate`, the retired ontology grammar), DS014 ("Host linking": the linker reads the memory's compiled lexicon and may read the analysis; the `linking` report), DS022 (`imports`, `lexicon(id)`), `docs/wire_types.html` and `docs/wire_typs/lexeme.html`, `entity.html`, `predicate.html` with executed examples (`tests/docs/wire-help.test.mjs`), `docs/wiki.html` (KnowledgeLinker definition updated: forms are knowledge of the memory), `skills/sop-wire-authoring/lexicon.md` and `skills/README.md`.

**Acceptance.**

- `node tools/verify.mjs` and the test suite pass; the archive world as circuits links the `symbolic_english` dev rows with the same execution signatures as before the change (a differential run, zero differences).
- On world-v1 with readings declared, `tools/eval/chat/world-kb-chat.mjs` and the HTTP chat give the same answers; "Who is Ada Lovelace?", "Is Paris a city?", "Where is Paris?" answer from the memory's declared readings.
- `baseline-current.json` exists with every metric of section 6.2 and the latency on four CPU cores; the `/experiments` page lists `eval-linking-v1` as preregistered with the stop rules of section 6.3.
- No wire of the model surface changed; `tests/model-input-boundary.test.mjs` and `tests/no-context-lint.test.mjs` unchanged and passing.

**Out of scope for M1** (and written so in the task record): the scored linker, segmentation alternatives, KB evidence, the abductive arbiter, `core-en` authoring beyond `core-min`, Romanian lexemes, units.

---

## Appendix A. References

- Berant, J., Chou, A., Frostig, R., Liang, P. (2013). Semantic Parsing on Freebase from Question-Answer Pairs. EMNLP. (SEMPRE; lexicon from ReVerb alignment; bridging.)
- Berant, J., Liang, P. (2014). Semantic Parsing via Paraphrasing. ACL.
- Cucerzan, S. (2007). Large-Scale Named Entity Disambiguation Based on Wikipedia Data. EMNLP-CoNLL.
- Dubey, M., Banerjee, D., Chaudhuri, D., Lehmann, J. (2018). EARL: Joint Entity and Relation Linking for Question Answering over Knowledge Graphs. ISWC.
- Hobbs, J. R., Stickel, M. E., Appelt, D. E., Martin, P. (1993). Interpretation as Abduction. Artificial Intelligence 63.
- Kipper Schuler, K. (2005). VerbNet: A Broad-Coverage, Comprehensive Verb Lexicon. PhD thesis, University of Pennsylvania.
- Krishnamurthy, J., Mitchell, T. (2012). Weakly Supervised Training of Semantic Parsers. EMNLP-CoNLL.
- Kwiatkowski, T., Choi, E., Artzi, Y., Zettlemoyer, L. (2013). Scaling Semantic Parsers with On-the-Fly Ontology Matching. EMNLP.
- McCrae, J., Aguado-de-Cea, G., Buitelaar, P., Cimiano, P., Declerck, T., Gómez-Pérez, A., Gracia, J., Hollink, L., Montiel-Ponsoda, E., Spohr, D., Wunner, T. (2012). Interchanging lexical resources on the Semantic Web. Language Resources and Evaluation 46. (lemon.) McCrae, J., Bosque-Gil, J., Gracia, J., Buitelaar, P., Cimiano, P. (2017). The OntoLex-Lemon Model. eLex.
- Mendes, P. N., Jakob, M., García-Silva, A., Bizer, C. (2011). DBpedia Spotlight: Shedding Light on the Web of Documents. I-SEMANTICS.
- Palmer, M., Gildea, D., Kingsbury, P. (2005). The Proposition Bank. Computational Linguistics 31. Baker, C. F., Fillmore, C. J., Lowe, J. B. (1998). The Berkeley FrameNet Project. COLING-ACL.
- Rao, D., McNamee, P., Dredze, M. (2013). Entity Linking: Finding Extracted Entities in a Knowledge Base. In Multi-source, Multilingual Information Extraction and Summarization. Springer.
- Ratinov, L., Roth, D., Downey, D., Anderson, M. (2011). Local and Global Algorithms for Disambiguation to Wikipedia. ACL.
- Reddy, S., Lapata, M., Steedman, M. (2014). Large-scale Semantic Parsing without Question-Answer Pairs. TACL 2.
- Reddy, S., Täckström, O., Collins, M., Kwiatkowski, T., Das, D., Steedman, M., Lapata, M. (2016). Transforming Dependency Structures to Logical Forms for Semantic Parsing. TACL 4. Reddy, S., Täckström, O., Petrov, S., Steedman, M., Lapata, M. (2017). Universal Semantic Parsing. EMNLP. (UDepLambda.)
- Sakor, A., Mulang', I. O., Singh, K., Shekarpour, S., Vidal, M. E., Lehmann, J., Auer, S. (2019). Old is Gold: Linguistic Driven Approach for Entity and Relation Linking of Short Text. NAACL. (Falcon.) Sakor, A., Singh, K., Patel, A., Vidal, M. E. (2020). Falcon 2.0: An Entity and Relation Linking Tool over Wikidata. CIKM.
- Shen, W., Wang, J., Han, J. (2015). Entity Linking with a Knowledge Base: Issues, Techniques, and Solutions. IEEE TKDE 27.
- Speer, R., Chin, J., Havasi, C. (2017). ConceptNet 5.5: An Open Multilingual Graph of General Knowledge. AAAI.
- Unger, C., Bühmann, L., Lehmann, J., Ngonga Ngomo, A.-C., Gerber, D., Cimiano, P. (2012). Template-based Question Answering over RDF Data. WWW. Unger, C., Cimiano, P. (2011). Pythia: Compositional Meaning Construction for Ontology-based Question Answering on the Semantic Web. NLDB. Lopez, V., Unger, C., Cimiano, P., Motta, E. (2013). Evaluating Question Answering over Linked Data. JWS. (QALD.)
- van Hulst, J. M., Hasibi, F., Dercksen, K., Balog, K., de Vries, A. P. (2020). REL: An Entity Linker Standing on the Shoulders of Giants. SIGIR.
- Walter, S., Unger, C., Cimiano, P. (2014). M-ATOLL: A Framework for the Lexicalization of Ontologies in Multiple Languages. ISWC.
- Yahya, M., Berberich, K., Elbassuoni, S., Ramanath, M., Tresp, V., Weikum, G. (2012). Natural Language Questions for the Web of Data. EMNLP-CoNLL. (DEANNA.)
- Yih, W., Chang, M.-W., He, X., Gao, J. (2015). Semantic Parsing via Staged Query Graph Generation: Question Answering with Knowledge Base. ACL.
- Zettlemoyer, L. S., Collins, M. (2005). Learning to Map Sentences to Logical Form: Structured Classification with Probabilistic Categorial Grammars. UAI.
- Niles, I., Pease, A. (2001). Towards a Standard Upper Ontology. FOIS. (SUMO.) Masolo, C., Borgo, S., Gangemi, A., Guarino, N., Oltramari, A. (2003). WonderWeb Deliverable D18: Ontology Library. (DOLCE.) Arp, R., Smith, B., Spear, A. D. (2015). Building Ontologies with Basic Formal Ontology. MIT Press. (BFO.)

## Appendix B. Where the numbers come from

All counts were taken on 2026-10-01 from the working tree:

- Relation phrases, head verbs, role sets, values: a Node script over `datasets/symbolic_english/{train,dev}.jsonl` and `datasets/neuro_english/{train,dev}.jsonl`, reading `gold_sop` when present, else `sop`, matching `relation "…"` and `role NAME VALUE` lines; cumulative coverage by sorting phrases by frequency; archive coverage by comparing phrases with the `label en`/`alias en` surfaces of `datasets_archive/formalizer-v1/world/predicates.sop` and the `relation`/`surfaces` columns of `config/dictionary/frames-world.tsv` and `frames-train.tsv`.
- Smoke predicates: `grep -h "^@[A-Za-z_0-9]* predicate" eval/smoke-reasoning/cases/*/knowledge.sop | sort -u` (198 names over 144 cases).
- The global lexicon: `server/http.mjs:336` (`Lexicon.load(... config.ontology ?? 'config/ontology.sop')`), `server/session-runtime.mjs:15,35`; `config/ontology.sop` (20 predicates, 11 entities).
- The two grammars: `sop/parser.mjs:56-60` (`ONTOLOGY_SPEC`) and `sop/knowledge/grammar.mjs:41-44` (`predicate`).
- The linker: `sop/linking.mjs` (`phraseKey`, `linkRelation`, `linkQuestion`), `sop/copula-linker.mjs`, `sop/relation-lexicon.mjs` with `config/relation-lexicon.json`, `sop/propositions.mjs` (`linkProposition`), `sop/declarative.mjs:189-286` (dictionary tiers, `normalizeAtom`), `sop/lexicon.mjs` (`matching`, `resolve`).
- world-v1: `tools/world-kb/mapping.mjs`, `MAPPING.md`, `build.mjs`, `ontology.mjs`, `lexicon.mjs`; `tools/eval/chat/world-kb-chat.mjs` and `questions.json`; the journal entries of `worldkb-agent` and `query-rules-agent` of 2026-10-01 (13:54 to 14:57).
- The dictionary: `config/dictionary/manifest.json` (`manual.tsv` 344 lines, `generator.tsv` 256, `wiktionary.tsv` 65,002, frames 80 + 4 + 58).
