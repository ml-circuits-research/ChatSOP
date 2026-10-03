# Structure model and formalizer model (PSM, LFM): facts, setup, zero-shot probe, fine-tune plan

Status (2026-10-03): models set up and probed; training deferred and NOT approved (Q-TRAIN-1); D1 teacher data stopped after its pilot; the perturbation check dropped (§8). §6 is kept as the plan should training be reconsidered. The A/B of §8 shows the role-prompted `tiny` ahead of every off-the-shelf small model. Probe numbers come from `state/structure-formalizer/` (regenerable, gitignored). The book text stays local (`datasets_sources/`, DS011); no problem text is quoted here.

## 1. The architecture (owner decision 2026-10-03)

The 4B model is weak when it must find the decomposition and the formalization at the same time. So it stays at the edges, and two small specialised models do the formalization:

1. **`tiny`** (Qwen3-4B): clean English, simple disambiguation, classification, and the wording of the answer.
2. **PSM, the Problem Structure Model** (tier `structure`):
   - extracts the problem's structure: entities, events, states, quantities, conditions, rules, constraints, goals, assumptions;
   - writes no logic;
   - outputs its native GLiNER schema JSON.
3. **LFM, the Logic Formalizer Model** (tier `formalizer`):
   - writes first-order logic, its native output;
   - adds a small agreed extension (§5) only where FOL cannot say something.
4. **Deterministic translation, written by us** (no LLM):
   - PSM JSON plus FOL become SOP-IR, then SOP Lang;
   - the engines execute the result;
   - a statement that cannot be converted is reported with its reason;
   - other LFM candidates are tried in its place.

## 2. Facts verified (2026-10-03)

Sources: the Hugging Face API (`/api/models/<id>`, model cards), arXiv and OpenReview. Paper details came through a summarising web fetch and were not re-read from the PDFs.

### Models

| model | exists | size | licence | input → output | ONNX / JS |
|---|---|---|---|---|---|
| GLiNER2 (fastino/gliner2-base-v1) | yes; arXiv 2507.18546 (Fastino, 2025-07) | 208.5M parameters (HF API; "205M" is the rounded figure) | Apache-2.0 | text plus a schema (entity labels with descriptions, relation types, classification, structured fields) → JSON with spans | no official ONNX or JS runtime; community exports exist (lion-ai, lmo3, DanKau, onnx-community) |
| **GLiNER2.5** (fastino/gliner2.5-{small,base,multi}-v1) | yes; released 2026-08/09, "boundary" architecture (start/end, any span length, 4,096 words), joint entity–relation graph, records, span attributes | small 74M, **base 193.6M** (DeBERTa-v3-base), multi 287M | Apache-2.0 | as GLiNER2; Python loader `AutoExtractor` | **nicolasembleton/gliner2.5-base-v1-onnx** (export v5: entities, classifier, relation heads, records), with an MIT JS host (Pastel-Org/gliner2.5-onnx-webgpu); DanKau/gliner2.5-base-v1-onnx (entities and classification only) |
| GLiNER2.5-Decide | yes (2026-09), 340M, DeBERTa-v3-large; onnx-community/GLiNER2.5-Decide-ONNX for transformers.js | 340M | Apache-2.0 | a classification and decision model, not the structure extractor | yes |
| **fvossel/t5-base-nl-to-fol** | yes (Vossel et al., Osnabrück; arXiv 2509.22338 is the likely paper, the card does not link it) | 222.9M (T5-base encoder-decoder) | Apache-2.0 on the card; trained on WillowNLtoFOL (CC BY-NC-ND 4.0) and MALLS-v0 (CC BY-NC 4.0, OpenAI terms), so a derived model is safe for internal use only | prefix `translate English natural language statements into first-order logic (FOL): ` plus one statement → FOL with `FORALLx`, `EXISTSx`, `AND`, `OR`, `NOT`, `IMPLIES` | safetensors only; exported to ONNX here (§3) |
| alternatives for the LFM | fvossel/t5-base-nl-to-fol_gt_predicates (takes a predicate list; no card, no licence metadata, input format unverified), fvossel/t5-3b-nl-to-fol (3B), mrm8488/t5-small-finetuned-text2log (60.5M, Apache-2.0), several Qwen3.5-0.8B/2B and SmolLM3-3B NL-to-FOL fine-tunes (nawax0x1) | | | | |

No well-documented model under 1B that turns a word problem into an equation or a program was found. The GSM8K Flan-T5 fine-tunes emit worked solutions, not programs.

### Papers

| citation | verified? | what it is |
|---|---|---|
| **DNA, "Divide and Abstract"** | **Yes.** Min, Gao, Sy, Li, Si, Bastani, *Divide and Abstract: Autoformalization via Decomposition and Abstraction Learning*, ICLR 2026 (OpenReview NjgaeXNit3; code github.com/marcusm117/DNA, Apache-2.0). No arXiv id was found. It is a different paper from CLOVER ("Divide and Translate", ICLR 2025). | Two training-free phases: (1) abstraction learning extracts concepts shared by the corpus and formalizes them as reusable abstractions; (2) decomposition learning splits each statement into quantifier, premise and conclusion clauses, translates and recomposes them, then refines with a symbolic validator. Targets are Lean and Z3, not NL to FOL. Benchmarks: LeanEuclidPlus and ProofNet-Hard. Reported: up to 8.6x over the baselines; Qwen3-14B goes from 1.0% to 9.6% on LeanEuclidPlus; GPT-4.1-mini approaches GPT-4.1. Absolute rates are low, and "small approaches large" means with DNA versus without it. |
| **MathForm** | **Yes, but the owner's description is partly wrong.** *MathForm: Scaling Mathematical Autoformalization with Knowledge Retrieval and Verification-Guided Refinement*, arXiv 2608.14221 (OpenBMB, 2026-08). | The retrieval (Mathlib), generation, verification (compiler plus an LLM consistency judge) and up-to-3-round refinement loop is used **only to build data**: FormalVerse, about 367K verified Lean 4 statements. The teacher is **gpt-oss-120b**. The **8B (Qwen3-8B) is the student**, trained with SFT and then RL, not the teacher. MathForm-8B Pass@8: syntax 88.1%, consistency 72.4%, above 32B baselines. Its lesson matches our plan: a large teacher with a verifier makes the data, and a small student serves. |
| arXiv 2509.22338 (*Advancing NL formalization to FOL with fine-tuned LLMs*) | Yes. | Flan-T5-XXL reaches 70% with predicate lists, ahead of GPT-4o. Predicate lists add 15–20 points; predicate extraction is the main difficulty. |

### Not verified

- DNA's exact tables, read from the PDF.
- The MathForm-8B Hugging Face id and licence.
- Whether fvossel's `_gt_predicates` variants are the paper's predicate-list models, and their input format.
- The ONNX export's parity with the PyTorch GLiNER2.5. This is the exporter's claim and was not tested here.
- Whether Fastino's `gliner2` package can train GLiNER2.5 checkpoints. The cards mention fine-tuning through Fastino's service, and the repository has training code for GLiNER2. Check this before T-PSM-1 (§6).

## 3. What was set up

### Weights

Downloaded into the gitignored `models/`, each folder with a `PROVENANCE.json` (source, revision, licence, sha256 of every file); also recorded in `dependencies.md`:

| folder | content |
|---|---|
| `models/gliner2.5-base-v1-onnx/` | export v5 @ b29dcb3c, 751 MB |
| `models/t5-base-nl-to-fol/` | source safetensors @ a9f09f27, 852 MB |
| `models/t5-base-nl-to-fol-onnx/` | the encoder and merged decoder, exported once with `optimum` in a temporary Python venv (deleted afterwards); script `LLMAPIProvider/local-services/small-models/convert/export-t5-onnx.sh`; max abs diff ≤ 7.3e-05 |

### Serving

A managed upstream of LLMAPIProvider, without Python (owner, 2026-10-03: everything that serves models lives in LLMAPIProvider).

- **Service:** `LLMAPIProvider/local-services/small-models/`, Node with transformers.js 4.3.0 and onnxruntime-node 1.30.0.
  - GLiNER runs through the vendored MIT JS host.
  - Endpoints: `POST /v1/structure` and `POST /v1/fol`, JSON, documented in its README.
- **Proxy integration:**
  - Upstream `smallmodels` is a script upstream.
  - The proxy starts it with itself (`startAtBoot`) and restarts it on demand, as it does the llama-server of `tiny`. Verified: after the service was killed, the next request restarted it.
  - Tiers `structure` and `formalizer`. Requests are forwarded, logged, tagged and cached; a JSON 200 without `error` is cached, and the weights' size and mtime enter the cache key.
  - Proxy tests: a fake service script (`proxy.test.mjs`, "json tiers") and fake backends (`server.test.mjs`).
  - The proxy was restarted once. It was not running when this work began; its last request was at 06:45Z.
- **Hardware: CPU only.**
  - onnxruntime-node ships no CUDA provider for linux-arm64; `listSupportedBackends()` returns only `cpu`.
  - Threads are capped at 4 intra-op and 1 inter-op per model, with no spin-waiting.
  - CPU use during a run: about 300% median and 510% peak, against about 1,000% before the cap.
  - GPU speed was not measured. It would need a CUDA build of onnxruntime for aarch64 (not available as an npm binary) or Python with CUDA torch; neither is installed. The GPU also holds the always-on `tiny` llama-server (21 GB).

| speed (CPU, 4 threads per model) | value |
|---|---|
| GLiNER2.5 base, one book problem (entities plus relations) | median 0.35 s (0.23 s with 8 threads) |
| T5-base greedy generation | about 87 tokens/s; median 3.0 s per problem (about 7 statements) |
| first load | about 1.5 s per model |

### Deterministic translation

New modules `lib/formalize/fol/` and `lib/formalize/structure/`, with tests in `tests/structure-formalizer.test.mjs`. They reuse `registry.mjs`, `expression-program.mjs` (analysis and lowering), `dual-check.mjs` (perturbation), `equivalence.mjs` (scoring) and the engines.

- **`fol/parse.mjs`:**
  - reads the LFM's FOL, including glued keywords (`NOTPenguin`, `FORALLxFORALLy`) and the Unicode connectives;
  - follows the usual precedence;
  - treats a free one-letter variable as universal;
  - makes one structural repair: unbalanced closing parentheses at the end.
- **`fol/to-ir.mjs`:** classical Horn clausification.
  - A conjunction is split.
  - `∀(B→H)` becomes one rule per head literal and per disjunct of B; a nested implication is curried.
  - `↔` gives both directions.
  - `¬∃(L1…Ln)` becomes the constraint `L1…Ln-1 → ¬Ln`.
  - A top-level `∃` becomes a Skolem constant.
  - These are rejected with a reason: a disjunction or existential in a head, `∃` inside `∀`, an unsafe rule, an unconditioned universal.
  - Questions (a unit ending with `?`): a ground literal is yes/no; `∃x φ` asks "is there" and "which"; the §5 extension adds `Ask` and comparisons.
- **`fol/to-sop.mjs`:**
  - logic becomes session predicates (closed world: the problem states its own data), `stated` facts, rules, and transitivity for `Before`/`After`;
  - values become numbered program lines over the registry v1..vn, so a perturbation moves them, then go through the expression program's analysis and lowering.
- **`structure/to-ir.mjs`:** the PSM inventory.
  - registry numbers with the quantity span that covers them;
  - entity names, linked to the FOL constants by slug;
  - goal spans, with whether they lie in the question;
  - the other labels;
  - de-duplicated relations.
- **`structure/schema.mjs`:**
  - holds the PSM schema (`config/formalize/psm-schema-v1.json`: nine entity labels with descriptions, four relation types);
  - renders the PSM-based sketch for the LFM: the sentences that contain a logic-bearing span, plus one statement per relation.

## 4. Zero-shot probe (30 book problems)

### Design

- 30 scorable problems, stratified by book: math 4, decompose 4, commonsense 4, world 5, adult 4, science 5, logic 4.
- Seed `psm-lfm-1`. Items never seen before; they are marked seen now.
- `node tools/eval/structure-formalizer/probe.mjs fetch|score|speed --run probe-1`.
- PSM scoring: against the registry (digits found deterministically), the question units, and the numbers and names of the worked solution.
- LFM scoring: sentence by sentence, 3 candidates per sentence (greedy plus 2 samples). The first candidate that parses and converts is used (the validator filters the N candidates). The result is converted, executed and compared with the book answer.

### PSM (GLiNER2.5 base, schema v1, threshold 0.4)

| measure | result |
|---|---|
| quantity recall (registry numbers inside a quantity span) | 86/139 = **62%** |
| … of the numbers the worked solution uses | 64/94 = **68%** |
| quantity precision (digit spans on a registry number) | 84/88 = **95%**; plus 21 spans without digits |
| goal recall (a goal span inside the question) | 7/30 = **23%**; goal precision 9/13 = 69% |
| entity spans named in the worked solution | 25/146 = 17% (many spans are pronouns, generic nouns or duplicates) |
| other labels over 30 problems | event 40, state 29, condition 13, rule 6, constraint 3, assumption 5; relations 93 (many repeated or meaningless, e.g. "code –before→ messages") |

| book | n | goal found | quantity recall |
|---|---|---|---|
| math | 4 | 0 | 11/12 |
| decompose | 4 | 1 | 18/20 |
| commonsense | 4 | 4 | 10/23 |
| world | 5 | 1 | 7/12 |
| adult | 4 | 0 | 23/42 |
| science | 5 | 1 | 13/26 |
| logic | 4 | 0 | 4/4 |

One variant was run on the same 30 items: a more explicit goal description and threshold 0.3 (`probe-1-goal`). Goal recall went to 5/30 and quantity recall stayed at 62%, so the variant was stopped (no gain).

PSM verdict:
- Quantities are precise but miss a third of the numbers. The registry already finds every digit deterministically, so the PSM's value there is only the unit and count words.
- Goals and logic-bearing parts are mostly missed. The schema as zero-shot labels does not carry the problem's structure.

### LFM (T5-base NL-to-FOL)

| measure | clean text, sentence by sentence, 3 candidates | PSM-based sketch, 1 candidate |
|---|---|---|
| units with a candidate that parses | 203/205 (99%) | 221/224 (99%) |
| units that convert to SOP-IR | 162/205 (79%) | 187/224 (83%) |
| question units that convert to a query | **4/32** (28 of 32 are written as universal rules `∀x (… → …)`) | 0/11 |
| problems with a compiled circuit | 3/30 | 0/25 |
| executed / answered | 3 / 2 | 0 / 0 |
| correct / wrong | **1 / 1** | 0 / 0 |
| FOL constants linked to a PSM entity | 6 (21 unlinked) | 14 (12 unlinked) |

- The one correct answer is a closed-world "no": "is there X?" with no X stated. It is right for a weak reason.
- The wrong one is an empty "which" answer to a numeric question.
- How the 139 registry numbers appear in the greedy FOL: 40 as a term, 50 only glued into a predicate name (`StartsAt3`, `Sells24Muffins`), 49 not at all.
- Each sentence invents its own predicates. One world problem states facts with `In(cedar, northland)` and the transitivity rule with `ContainedIn`, so nothing links.
- Constants are often garbled (`republicdd`).
- The most frequent reasons a unit is rejected:
  - a question of the form `∀`: 26;
  - a disjunctive head: 3;
  - an unsafe rule: 3;
  - parse errors: 3;
  - in the sketch arm, `∃` inside `∀`: 12.

LFM verdict: the model writes well-formed FOL, and our converter turns 79% of the statement units into Horn IR. But zero-shot it cannot formalize these problems:
- no questions as queries;
- numbers are not terms;
- no shared vocabulary across sentences;
- no arithmetic.

**Fine-tuning is needed for both models.** This answers the owner's "if needed" (§6).

### Converter check

The converters were tested on invented FOL in the agreed form (`tests/structure-formalizer.test.mjs`, 6 tests). All of the following executed correctly on the engines:
- yes/no, which, a negated-existential constraint, the `Before`/`After` order, transitivity;
- a value program (24 muffins, 5 unsold, 3 dollars → 57);
- the same circuit on perturbed numbers;
- a comparison.

The deterministic half works; the missing half is the models.

## 5. Target schemas

### PSM target: GLiNER schema v1

`config/formalize/psm-schema-v1.json`, the owner's labels:
- **entity labels:** `entity`, `event`, `state`, `quantity`, `condition`, `rule`, `constraint`, `goal`, `assumption`;
- **relations:**
  - `has_quantity` (entity/event → quantity);
  - `before` (event → event);
  - `causes` (event/state/condition → event/state);
  - `applies_to` (rule/condition/constraint → entity/event).

A training example is the problem text with gold spans and relations, in the `gliner2` training JSONL format. Its spans are verbatim substrings and are checked by offset.

### LFM target: FOL plus the agreed extension

- **Plain FOL** in the model's existing syntax: `FORALLx`, `EXISTSx`, `AND`, `OR`, `NOT`, `IMPLIES`, `IFF`, predicates `CamelCase`, constants lowercase.
- **Extension, exact reserved names only:**
  - `Value(q, t)`: the quantity `q` is the term `t`. `t` is a number, a quantity, or `add`, `sub`, `mul`, `div`, `mod`, `min`, `max`, `ceil`, `floor`, `round` or `abs` of terms.
  - `Ask(q)`: the asked value.
  - `Lt`, `Le`, `Gt`, `Ge`, `Eq(a, b)`: an asked comparison.
  - `Before(a, b)`, `After(a, b)`: event order (`At(e, t)` can be added if the data needs it).
  - Questions: a ground literal (yes/no) or `EXISTSx (…)` ("is there" or "which").
- **Input of one example:**
  - one sentence of the problem;
  - the problem's inventory, rendered deterministically from the PSM: names, quantities as `q1 = 24 muffins …`, and the predicates written so far in the problem.
  - The inventory gives the sentences a shared vocabulary. 2509.22338 measured +15–20 points from predicate lists.
- **Output:** the FOL lines of that sentence.

## 6. Path to fine-tuning (for the owner's approval; not run)

**Needed?** Yes for both models (§4):
- PSM goal recall 23% and quantity recall 62%;
- LFM 4/32 questions as queries, numbers glued into names, 1/30 correct, for a weak reason.

### D1. Data generation (teacher LLMs; an LLMJobs job; no training)

- **Pool:**
  - the scorable book items not seen before: 3,436 (math 860, commonsense 686, adult 579, world 547, science 351, logic 227, decompose 186);
  - minus the held-out test sections (below);
  - leaves about 2,750 items.
- **Teacher:**
  - Each problem is formalized by `small` (Qwen3.8 27b) and, independently, by `medium` (deepseek-v4-flash). These are two families.
  - The output is one JSON: PSM spans and relations (verbatim substrings), and FOL lines per sentence in the §5 target.
  - The inventory constraint: predicates and quantity names are reused across sentences.
  - The prompt shows the schema and three invented examples, never book text from the test sections.
- **Kept only if all of these hold (deterministic):**
  1. Every span is verbatim.
  2. The FOL compiles through our converters with no rejected unit that carries a number or the question.
  3. The circuit executes to the book answer (`equivalence.mjs`).
  4. The perturbation check passes: the two teachers' circuits agree on the original and on 3 perturbed registries (`dual-check.mjs` `profilesAgree`). For a problem without numbers, both teachers must reach the gold.
  5. Both teachers' PSM goal and quantity spans overlap.
  6. Every number the verified program uses lies inside a quantity span.
- **Repair:** one round per teacher, naming the converter's rejection or the validator's message.
- **Size target:**
  - at least 600 verified problems (the go gate); about 1,100 expected at a 40% yield;
  - that gives about 7,500 LFM sentence pairs and about 1,100 PSM documents;
  - no book section above 10% of the data.
- **Pilot first:** 50 problems measure yield and format compliance. At most 2 prompt-fix rounds, then the full pool.
- **Cost:**
  - about 2,750 `small` calls (about 275 plan credits, about 3 h at 15/min);
  - about 5,500 `medium` calls (about 14M tokens, under 2 USD on OpenRouter);
  - registered with an LLMJobs budget: `calls` 9,000, `usd` 5.

### Training runs

The owner approved fine-tuning these two small models "if needed" in principle (2026-10-03: "facem fine tuning la modelele alea două mici, dacă e cazul"). Each run below is written into the preregistration `status/preregistrations/train-psm-lfm-v1.json` and the journal before it starts.

- **T-PSM-1:**
  - full fine-tune of fastino/gliner2.5-base-v1 (PyTorch, `gliner2` training code) on the D1 PSM documents;
  - 90/10 train/dev by section;
  - AdamW, lr 1e-5 for the encoder and 5e-5 for the heads, batch 8, at most 10 epochs, early stopping on dev span F1 (goal, quantity, condition, rule) with patience 2, seed 1;
  - then an ONNX export with the exporter's published script, served as a new checkpoint folder.
- **T-LFM-1:**
  - full fine-tune continuing from fvossel/t5-base-nl-to-fol on the D1 sentence pairs;
  - AdamW, lr 3e-4, batch 16, max input 512 and output 256 tokens, at most 10 epochs, early stopping on dev execution accuracy (per problem, through the converters and engines) with patience 2, seed 1;
  - then an ONNX export with the existing script.
- **GPU time on the GB10 (estimate):** 6 × parameters × tokens at about 30 TFLOP/s effective.
  - PSM: about 6M tokens, about 5–20 minutes.
  - LFM: about 20M tokens, about 20–60 minutes.
  - Under 2 h in total including evaluation.
- **Environment:** training needs Python with CUDA PyTorch for aarch64 (sbsa wheels). The proposal is to reuse the frozen branch's rootless Podman CUDA image (`probably_obsolete/tinyLLMExperiments/dependencies.md`). The models directory gets `.training.lock`, which keeps the llama-server from starting during training.
- **Rules:**
  - one GPU-intensive job at a time;
  - at most one rerun per run;
  - training data never enters git (it is book-derived, DS011);
  - checkpoints stay local and are not published: the books' rights are not cleared, and fvossel's training data is non-commercial.

### E1. Evaluation

- **Test set:**
  - held-out book sections: 20% of the sections of each book, chosen by a seeded hash and frozen before D1;
  - scorable items only, never seen;
  - about 690 items.
- **Staging:**
  - stages of 50, then 100, then the rest;
  - paired bootstrap after each stage against the current pipeline on the same items: the product formalizer of `config/runtime.json` `queryParser` (LocalLLMStepByStep on `tiny`) and the expression path on `tiny`.
- **Reported:**
  - correct, wrong and unknown per 100, with a wrong circuit counted apart from an honest unknown;
  - PSM span F1 on the verified test labels;
  - LFM unit conversion and execution rates;
  - latency;
  - the three levels of AGENTS.md: (a) known forms with new words (overlap tool), (b) held-out sections, (c) a small set of free questions.
- **Gates:**
  - **success:** correct ≥ current + 10 points with wrong ≤ current, PSM goal recall ≥ 80%, quantity recall ≥ 90%;
  - **futility:** at stage 50, executed < 30% or correct < current − 5;
  - **broken:** more than 20% unparsable or empty outputs in the first 50.

## 7. Risks and open points

- **GLiNER2.5 training:** GLiNER2.5 checkpoints may need Fastino's code to train. If the open `gliner2` trainer cannot, the fallback is GLiNER2 base (208M, open training code) and an export of our own.
- **Teacher compliance with the FOL extension:** D1's pilot measures it. The converters reject anything off-form, so bad data cannot enter silently.
- **Per-sentence translation loses cross-sentence context:** the inventory in the input is the mitigation. If dev execution stays low, a problem-level input (all sentences, ≤ 512 tokens) is the alternative, decided on dev only.
- **GPU serving:** a CUDA onnxruntime for aarch64 would need a source build. CPU is enough for throughput at these sizes.

## 8. Owner decisions of 2026-10-03 (afternoon) and what followed

### Decisions

- **Training deferred, not approved** (Q-TRAIN-1, answered in chat). First test `tiny` with role prompts and off-the-shelf base models on this pattern.
- **D1 stopped after its pilot.** Training is deferred, so teacher data is not needed.
- **Perturbation check dropped** from scoring and acceptance. Invented variants can be invalid problems (fractional people, infeasible constraints, broken puzzles), and the check caught only a handful of lucky circuits. What replaces it:
  - **evaluation:** a pipeline is right when its executed SOP gives the book answer on the problem's own numbers;
  - **static check:** a circuit whose answer does not reach the problem's numbers through its dataflow is refused (`lib/formalize/fol/to-sop.mjs`, as the expression path already did);
  - **verification without gold:** two formalizations must agree on the original numbers, and a yes/no answer needs three (`lib/formalize/dual-check.mjs`: perturbation optional, off by default).
- These are recorded as deviations in `status/preregistrations/train-psm-lfm-v1.json`.

### D1 pilot (stopped; kept as reference)

`state/structure-formalizer/d1/d1-pilot/summary.md`.

- **Strict held-out split:** frozen before the pilot. 222 section units, 1,374 items; sha256 `6a473341…`; held in `datasets_sources/books/eval/heldout-train-psm-lfm-v1.json`, local.
- **Teacher `small` (Qwen3.8 27b):**
  - 50 problems; 27 accepted by the converters' format checks;
  - 84 calls, 8.4 plan credits.
- **Teacher `medium` (deepseek-v4-flash, low reasoning):**
  - 40 of 50 settled when stopped;
  - 68 calls, 1.24M output tokens (11 replies ran away to the 32k cap), 1.58 USD.
- **On the 40 problems both teachers settled:**

| measure | small | medium | both |
|---|---|---|---|
| accepted by the converters' format checks | 22 | 20 | |
| executed to the book answer | 14 | 12 | 9 |
| book answer, agreeing on the original numbers, PSM criteria met | | | **7 (18%)** |

- **Main format failures:**
  - constraint-search problems ("find the number between 45 and 53 that …") written as unknowns with bare comparisons, which the FOL extension cannot express;
  - prefix connectives such as `IMPLIES(a, b)` and `AND(…)`;
  - `Value` misuse.
- **Process note:** `medium` with reasoning is a poor teacher for this format. Its replies are long and costly.

### A/B before any training (owner)

Setup:
- **Same 30 problems** as probe-1, same converters, scored against the book answer (no perturbation).
- **Command:** `node tools/eval/structure-formalizer/ab.mjs fetch|score --run ab-1`.
- **Backends are swappable proxy tiers:**
  - `structure-gliner`, `structure-tiny` (Qwen3-4B with `LLMAPIProvider/prompts/psm-v1.md`);
  - `formalizer-t5`, `formalizer-t5-3b`;
  - `formalizer-tiny` (Qwen3-4B with `prompts/fol-v1.md`, the FOL extension, `? ` queries, a shared vocabulary);
  - `formalizer-llama-fol` (Llama-3.2-1B NL2FOL GGUF with `prompts/fol-plain-v1.md`).
- **Prompted tiers** validate the reply and re-ask once, under the same JSON contract (`LLMAPIProvider/prompted.mjs`).
- **Timing:** median seconds per problem, uncached. GLiNER, T5 and T5-3B run on the CPU (4 threads); Qwen3-4B and Llama run on the GPU (llama-server).
- **Not probed (no licence):** the nawax0x1 Qwen3.5-0.8B/2B NL-to-FOL models and teaislife/Qwen3-4B-nl2fol carry no licence and no documented prompt, so they were not downloaded.

**Structure (PSM)**

| arm | quantity recall | quantity precision | goal found | s/problem |
|---|---|---|---|---|
| GLiNER2.5 base | 86/139 (62%) | 84/88 (95%) | 7/30 | 0.4 |
| **`tiny` + psm-v1** | 82/139 (59%) | 83/86 (97%) | **23/30** | 12.1 |

**Logic (LFM): converted to SOP, executed, compared with the book answer**

| arm | units converted | problems with a query | compiled = executed | correct | of which a real answer* | wrong | s/problem |
|---|---|---|---|---|---|---|---|
| T5-base, 3 candidates | 162/205 | 3/30 | 3 | 1 | 0 | 1 | 9.3 |
| T5-base, greedy | 141/205 | 2/30 | 2 | 1 | 0 | 0 | 3.0 |
| T5-3B, greedy | 125/205 | 1/30 | 1 | 1 | 0 | 0 | 28.3 |
| Llama-3.2-1B NL2FOL | 28/179 | 0/30 | 0 | 0 | 0 | 0 | 1.3 |
| **`tiny` + fol-v1** | 114/205 | **21/30** | **15** | **6** | **5** | 2 | 2.9 |
| `tiny` PSM → `tiny` LFM (inventory) | 90/205 | 17/30 | 10 | 3 | 2 | 1 | 17.6 |
| GLiNER PSM → `tiny` LFM (inventory) | 107/205 | 20/30 | 15 | 6 | 4 | 1 | 5.1 |

\* A "real answer" excludes the closed-world "no" given by an empty `∃x` query to a yes/no gold (logic:757, world:232). Those are right for a weak reason.

### Reading

- **Role-prompted `tiny` clearly beats every off-the-shelf small model.**
  - As PSM: it finds the goal in 23 of 30 problems (GLiNER: 7), with the same quantity precision.
  - As LFM: it writes queries in 21 of 30 problems and gives 6 correct answers (5 real), against 1 weak answer for T5-base, T5-3B or Llama.
  - The off-the-shelf NL→FOL models never write questions as queries, and they glue numbers into names. The Llama 1B degenerates.
- **Adding an inventory from the PSM does not help `tiny`'s LFM.**
  - From GLiNER: same count, one wrong answer fewer.
  - From `tiny`: fewer, 3, and three times slower.
- **Remaining failures of `tiny` + fol-v1 (by reason):**
  - infix comparisons (`x <= 88`, `=`) and constraint-search problems with an unknown, which the extension cannot express (the largest group);
  - parse errors from prose inside formulas;
  - `Value` misuse;
  - universally quantified questions.
- **Two generic fixes are open:**
  - a constraint construct for "find x such that …", lowered to SOP's `constraint` wire;
  - infix comparisons read as `Lt/Le/Gt/Ge/Eq`.

Both are language and converter changes, not training.

**Training:** nothing in this A/B beats the role-prompted `tiny`, so fine-tuning GLiNER or T5 is not indicated by these numbers. Q-TRAIN-1 stays open for the owner.
