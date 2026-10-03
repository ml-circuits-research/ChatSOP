# Structure model and formalizer model (PSM, LFM): facts, setup, zero-shot probe, fine-tune plan

Status (2026-10-03): models set up and probed; training deferred and NOT approved (Q-TRAIN-1); D1 teacher data stopped after its pilot; the perturbation check dropped (§8). §6 is kept as the plan should training be reconsidered. The A/B of §8 shows the role-prompted `tiny` ahead of every off-the-shelf small model; §9: no local MoE or small thinking model clears the owner's +5 bar (Qwen3.6-35B-A3B +4 on path B, much better structure), and the cloud control shows the logic role is limited by the method and converters. Probe numbers come from `state/structure-formalizer/` (regenerable, gitignored). The book text stays local (`datasets_sources/`, DS011); no problem text is quoted here.

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

## 9. Larger local MoE, small thinking models and a cloud control (owner, 2026-10-03)

**Question (owner).** Does a larger but still fast local MoE beat the 4B `tiny` on the role pattern of §8? The owner set the bar: at least **+5 correct of 30** on the logic role or on the compute path B, at **≥ 20 tokens/s**. Later additions: two small models with thinking (size × thinking), and the `good` tier as a control that separates "the model is too weak" from "the method or the converters are the limit".

### Setup

- **Problems and scoring:** the same 30 problems of probe-1 and the same converters as §8. A pipeline is right when its executed SOP gives the book answer on the problem's own numbers; the static data-dependency check stays on.
- **Harness:** `node tools/eval/structure-formalizer/ab.mjs fetch|score --run moe-ab --purpose job:moe-ab`.
  - Response cache on. The `tiny` rows of §8 are replayed from the cache.
  - The compute path B is a new arm, `expr:<tier>`: the closed question of `lib/formalize/expression-program.mjs`, prompt variant a, no exemplars (the same question for every model), static analysis, lowering to SOP, execution by the engines.
  - New options: `--concurrency`, `--parallel-arms` and `--limit`.
- **Serving.** Every candidate is a managed upstream of LLMAPIProvider, with tiers `tiny-<x>`, `structure-<x>` and `formalizer-<x>` under the same role prompts (`psm-v1`, `fol-v1`).
  - The local candidates run as llama-server on the GPU, started on demand and stopped after idle time.
  - New `start.exclusiveGroup` (`ondemand`): only one extra server runs next to the always-on `tiny`. Starting one stops the others and waits for their exit, escalating to SIGKILL after 30 s.
  - A proxy shutdown now stops the on-demand servers it started. Before this, a restart left them orphaned and holding GPU memory.
- **Budgets.** A prompted reply cut by its token budget is asked again with four times the budget, up to 32k tokens. The prompted answer reports its `usage`.
- **Scoring fix (applies to every arm).** A question that asks several values is answered by several queries. A numeric gold is now compared with all the answered numbers, unordered; a yes/no check written next to them is not counted as an asked value. Before, only the first query was compared.
  - Effect on the logic role: `tiny` unchanged (6 correct / 2 wrong), `good` 6 → 8.
  - Path B applies the same rule.
- **Candidates and sources** (licences and sha256 in `dependencies.md`):
  - **Qwen3.6-35B-A3B:** the newest Qwen of the 30B-A3B class on Hugging Face on 2026-10-03. It was released 2026-04-15; Qwen3.8 has only a dense 27B, a 125B-A6B Flash-Next and a 2.4T model. Served as unsloth UD-Q4_K_M.
  - **Nemotron-3-Nano-Omni 30B-A3B:** Q8_0, already on disk.
  - **Qwen3-4B-Thinking-2507:** Q4_K_M.
  - **Qwen3-1.7B, thinking mode:** Q8_0.
  - **`good`:** deepseek-v4.1-flash on OpenRouter, reasoning effort medium, 32k budget.
  - The thinking models use their recommended thinking sampling (temperature 0.6, top_p 0.95, top_k 20), because greedy decoding makes them repeat. Everything else runs greedy.

### Results

Generation speed is measured on a short single request. Seconds are the median per problem, uncached.

| model | logic: correct (real*) / wrong | path B: correct / wrong | structure: goal found | structure: quantity recall / precision | thinking tokens per call (structure / logic / B) | s/problem (structure / logic / B) | generation tok/s |
|---|---|---|---|---|---|---|---|
| `tiny` Qwen3-4B-Instruct (§8) | 6 (5) / 2 | 5 / 13 | 23/30 | 82/139 / 83/86 | 0 | 12.1 / 2.9 / 1.2 | ~76 |
| Qwen3-1.7B thinking, **5 problems, stopped: too slow** | 0 / 1 | 0 / 3 | 1/5 | 6/15 / 6/6 | ~3.3k / ~4.0k / 0 | 47 / 56 / 1.1 | ~115 |
| Qwen3-4B-Thinking-2507, **stopped by the owner** | no valid row** | no valid row** | 3/4 | 12/15 / 12/12 | ~6.6k / – / – | 101–300 / >300 / >300 | ~74 |
| Nemotron-3-Nano-Omni 30B-A3B | 4 (3) / 7 | 7 / 13 | 18/30 | 63/139 / 53/56 | 0 | 24.0 / 6.3 / 1.7 | ~57 |
| **Qwen3.6-35B-A3B** | 6 (4) / 8 | **9 / 7** | **28/30** | **121/139 / 110/111** | 0 | 11.1 / 5.6 / 2.3 | ~66 |
| control `good` (deepseek-v4.1-flash, reasoning) | 8 (7) / 8 | 16 / 8 | 27/30 | 120/139 / 102/102 | ~3.5k / ~3.3k / ~1.5k | 10.8 / 10.0 / 4.9 | cloud |

\* As in §8, a "real" answer excludes the closed-world "no" that an empty `∃x` query gives to a yes/no gold.

\*\* Every logic and B call of the 4B thinking model ran past the client's 300 s limit (Node's fetch header timeout). Its structure calls needed 6.5k–15k thinking tokens: 101–130 s alone, about 200–300 s under the A/B load.

**Paired comparison with `tiny`, Qwen3.6-35B-A3B:**

| role | both correct | only `tiny` | only the MoE | sign test |
|---|---|---|---|---|
| path B | 5 | 0 | 4 | one-sided p ≈ 0.06 |
| logic | 4 | 2 | 2 | |

### Throughput and memory of Qwen3.6-35B-A3B

Measured with llama-server alone on a fol-v1-sized prompt (about 900 prompt tokens, 300 generated, no prompt reuse), one client per slot. Each slot gets 16k tokens of context. The largest local request of 2026-10-02/03 was 8,192 tokens (p99 5,051, p50 1,355).

| slots | context | GPU memory | requests/s | generated tok/s (all slots) | tok/s per request | p50 s/request |
|---|---|---|---|---|---|---|
| 2 | 32k | 22.0 GB | 0.29 | 88 | 44 | 6.8 |
| 4 | 64k | 22.8 GB | 0.39 | 118 | 29 | 10.2 |
| 8 | 128k | 24.3 GB | 0.48 | 144 | 18 | 16.7 |

**What is resident next to it:**
- `tiny` Qwen3-4B with 32 slots and 131k context: 21.3 GB;
- the small-model service on the CPU: about 15.7 GB RSS;
- 119 GB of unified memory in all, 71 GB available with `tiny` and the service running.

Both the MoE and `tiny` fit together.

On the same benchmark, `tiny` at 32 slots serves 3.6 requests/s.

**Proposed slot count, if the MoE is adopted:** 4 slots. At 8 slots each request falls below the 20 tok/s floor.

### Verdict

**The owner's bar is not met.**
- Qwen3.6-35B-A3B gains **+4** on path B (9 vs 5; sign test p ≈ 0.06) and **0** on the logic role (6 vs 6).
- Nemotron gains +2 on B and loses on logic.
- The thinking models are far too slow for the role pattern and were stopped (owner): about 200–300 s per problem for the 4B, 47–56 s for the 1.7B. The 1.7B also solved nothing in its 5 problems.
- By the owner's bar alone, `tiny` would not be switched; see the adoption below.

**What the MoE does better, for the owner's decision:**
- **Structure role:** at the level of the cloud `good`. Goal found 28/30 against 23/30. It covers 121/139 of the problems' numbers against 82/139, with 99% precision.
- **Path B:** fewer wrong answers (7 against 13).
- **Logic role:** worse precision, 8 wrong against 2. A wrong circuit counts worse than an honest unknown.

**Cost:**
- one more resident model of 22–23 GB;
- about 10× fewer requests per second than `tiny` at full width;
- similar single-request latency (66 against 76 tok/s generation).

A cheaper option, if the owner wants the structure gain alone: point the alias `structure` at `structure-moe-qwen` and keep `tiny` as it is. The GGUF of Qwen3.6-35B-A3B is kept (adopted, see below). The thinking GGUFs are deleted. Nemotron lost; it was already on disk outside the repository before this test and was not deleted.

### Adoption (coordinator decision, 2026-10-03)

The coordinator adopted Qwen3.6-35B-A3B as `tiny` under the owner's standing rule: switch to a better model even with small margins. The trade-off on the logic role stays: equal correct answers but more wrong circuits (8 against 2).

| tier | model | serving | GPU memory | fallback |
|---|---|---|---|---|
| `tiny` | Qwen3.6-35B-A3B | always on, 4 slots | 22.8 GB | `medium`'s model |
| `supertiny` | Qwen3-4B | on demand, 32 slots, stops after 15 idle minutes | 21.3 GB while running | `tiny`, then `medium`'s model |

- `equivalence` names `supertiny`.
- `structure` and `formalizer` run on the MoE.

**Verified:**
- `tiny`, `supertiny` and `equivalence` were served by the right models.
- With both servers resident: 44 GB of GPU memory, 56 GB of RAM available.
- Offline regression replay: unchanged by the switch, since it calls no model.
- Live CLI chat, 3 messages: 2 answered correctly, 1 clarification question.

### Control: the cloud model on the same method

`good` writes far more of the method's language:
- 26/30 problems with a query, 20 compiled;
- 159/205 sentences converted, against 114 for `tiny`.

Yet it gets **only 8 correct, with 8 wrong**, on the logic role, in the same range as `tiny`'s 6. On path B it gets 16 against 5.

**The bottleneck of the logic role is therefore the method and the converters, not the model.** The dominant failure reasons for `good`:

1. **Full FOL beyond Horn**, which the FOL extension refuses:
   - disjunctive conclusions (a rule whose conclusion is a choice among several alternatives);
   - existentials in conclusions;
   - universals inside conditions (a thing qualifies when it has every required property);
   - `IFF` definitions.
2. **Constraint search with a free unknown** (find the number in a range that meets a divisibility and a capacity condition). It is written as ground facts about `x` and refused as "a statement about every thing without a condition". The constraint construct of §8 is still open.
3. **Quantities derived by rules:** a rule of the form `Value(a, x) AND Value(b, y) IMPLIES Value(c, add(x, y))` leaves "the quantity c is used but never given a Value".
4. **A parser gap:** multi-variable quantifiers `FORALLx,y` (6 sentences; a generic parser fix).
5. **Wrong answers** come mostly from list questions: the model queries steps or intermediate values beside the asked ones (science:544, 647, 656, 805).

For `tiny` the reasons were different: prose inside formulas (parse errors) and `Value` misuse. A stronger model removes those and runs into the converter's limits.

**Path B is model-limited:** `good` 16/30, the MoE 9, `tiny` 5. Six problems have no numbers, so path B does not apply to them.

### Files

All files are local and regenerable; the book text stays in `state/`.

- `state/structure-formalizer/moe-ab/{raw,results}.jsonl` and `summary.md`.
- One JSONL per model with every output, near misses included: `state/moe-ab/moe-ab/<model>.jsonl`.
  - raw structure JSON;
  - FOL per sentence;
  - the B program;
  - the SOP circuits;
  - the converter's reasons;
  - the executed answers;
  - the book answer;
  - timings and token usage;
  - partial credit.
- The side-by-side partial-credit table: `compare.md` and `compare.jsonl`, with these measures:
  - solution numbers found;
  - goal;
  - query;
  - sentences converted;
  - compiled;
  - executed;
  - relative error of the closest numeric answer.
- Regenerate them with `node tools/eval/structure-formalizer/compare.mjs --run moe-ab`.

## 10. Repair of the FOL path (owner decision, 2026-10-03)

**Why.** §9's control showed that the logic role was limited by the method and the converters, not by the model: `good` wrote the role's language well (26/30 queries) yet got 8 correct and 8 wrong. The owner decided to repair the FOL path generically and to measure on the same 30 problems and once on 50 fresh ones. A wrong circuit counts worse than an honest unknown.

### First cause of every non-correct problem (before the repair, fol-v1 outputs of §9)

| cause | `good` (22 non-correct) | MoE `tiny` (24 non-correct) |
|---|---|---|
| converter: non-Horn FOL, unknowns, value rules, `FORALLx,y`, prefix and infix syntax, n-ary `add`, rule-only constants | 7 | 4 |
| prompt (fol-v1 offered no construct: unknowns, objectives, `pow`) | 4 | 2 |
| model (wrong semantics, functions of things, prose in formulas) | 2 | 15 |
| no SOP construct for the question (does A prove B, argument evaluation; P-1/P-5) | 4 | 1 |
| gold or scorer (the gold list holds inputs or check values, a partial answer is scored wrong) | 5 | 2 |

### What changed (no new wire type; `experiments/proposal/wire-type-proposals.md` P-5)

- **Reader** (`lib/formalize/fol/parse.mjs`): several variables per quantifier (`FORALLx,y`, `FORALLx, FORALLy`, `Exists k`); prefix connectives `AND(…)`, `OR(…)`; infix comparisons (`=`, `!=`, `<=`, …) and arithmetic (`+ - * /`); quoted text; a quantifier followed by parentheses scopes over them only.
- **Clausification** (`to-ir.mjs`):
  - disjunctive conclusions → one rule per disjunct over the explicit negations of the others; their predicates are open;
  - `IFF` and `XOR` conclusions;
  - an existential conclusion under a universal keeps its part without the new thing;
  - a comparison conclusion → its contrapositive;
  - universals and negated compounds inside conditions → auxiliary predicates over the problem's own domain;
  - `Value` concluded under conditions → value rules; `Value(q, x)` in a condition binds or tests;
  - stated comparisons are conditions of the problem; `Integer`, `Maximize`, `Minimize`;
  - universal questions; `¬∃` questions; `FORALLx (C(x) IMPLIES Ask(x))` asks for an unknown.
- **Lowering** (`to-sop.mjs`):
  - comparisons in rule conditions over the quantities, through the program's predicates;
  - value rules as session rules, read by the expression program as external names;
  - unknowns → one model `constraint` wire: integer variables, sound bounds by interval propagation, `mod` as a fresh multiple, linear words, `task possible|prove|optimize`; an unknown bounded only by inequalities must be declared `Integer`;
  - universal questions → `mode every` with `quantifier all`;
  - a constant that only a rule or the question names is introduced through the domain fact, so it can be linked.
- **Soundness:**
  - a closed-world "no" (a refutation without proof, an empty list) is withheld when the asked predicate is defined nowhere in the problem, or depends on an open predicate or on one that an unparsed or rejected statement mentions;
  - an explicit negation (a refutation with a proof) is kept;
  - a quantity with two different values, and two value rules that both apply, give no answer.
- **Harness** (`tools/eval/structure-formalizer/score.mjs`): a sentence keeps its converted lines when one line fails; the failed lines are passed on as rejected units, so their predicates lose closed-world trust. `ab.mjs` gains `sample` (fresh problems outside the strict held-out split) and `score --into`. Weak answers (a yes/no gold decided by an empty list) are reported apart ("real").
- **Expression program:** `Math.pow` (lowered to `power`) and external names (`analyseProgram`/`lowerProgram` option `external`); path B's question is unchanged.
- **Proxy** (`LLMAPIProvider/prompted.mjs`): the re-ask keeps the better-formed reply (an unreadable reply never replaces a partly valid one) and fills the sentences it left empty from the other reply. The `structure` path does the same with its spans. Role prompt `fol-v2`: the constructs above, "query exactly what the question asks", same JSON format. The formalizer tiers name it in `config.json`.
- **Renderer fix:** `sop/cnl.mjs` no longer fails a turn on a strict universal packet without a member count.

### Results

Three stages, the same scorers throughout:
1. **before:** the converters of HEAD, fol-v1 outputs;
2. **converter:** the repaired converters, the same fol-v1 outputs;
3. **+ fol-v2:** the repaired converters and new outputs under `fol-v2` with the new re-ask, after the proxy restart.

The MoE `tiny` row of stages 1–2 on the 30 is §9's `formalizer-moe-qwen` arm (the same model).

**Scorers:**
- **old:** the A/B scorer of §8–9 (a numeric gold is compared with all answered numbers).
- **asked parts** (`tools/eval/structure-formalizer/asked.mjs`):
  - gold numbers that are the problem's own numbers (inputs, restated check values) leave the gold list;
  - clock and hours-minutes pairs are one value; a written fraction counts as its value;
  - **correct** = every asked number answered (extra values allowed);
  - **partial** = some asked numbers answered and nothing else;
  - **wrong** = no asked number answered, an asked part answered with another number, or no number answered;
  - **gold defect** = a gold value absent from its own answer text, a gold of two or more numbers that are all inputs, or a reviewed defect (local `datasets_sources/books/eval/gold-defects.jsonl`; one entry, math:23.3).

In "correct (real)", "real" excludes a yes/no gold decided by an empty list. Under the asked-parts scorer, "before" also counts those weak answers as correct: 1 for `good` and 2 for `tiny` on the 30, 0 on the fresh 50.

**Same 30 problems** (the development set):

| model | stage | compiled | old: correct (real) / wrong | asked parts: correct / partial / wrong / defect |
|---|---|---|---|---|
| `good` | before | 20 | 8 (7) / 8 | 12 / 1 / 3 / 1 |
| `good` | converter | 28 | 11 (11) / 7 | 15 / 1 / 1 / 1 |
| `good` | + fol-v2 | 28 | **14 (14) / 6** | **16 / 1 / 2 / 1** |
| MoE `tiny` | before | 14 | 6 (4) / 8 | 6 / 3 / 5 / 1 |
| MoE `tiny` | converter | 19 | 8 (8) / 7 | 9 / 2 / 4 / 1 |
| MoE `tiny` | + fol-v2 | 16 | **8 (8) / 5** | **8 / 3 / 2 / 1** |

**50 fresh problems** (stratified by book, outside the strict held-out split, drawn once):

| model | stage | compiled | old: correct / wrong | asked parts: correct / partial / wrong / defect |
|---|---|---|---|---|
| `good` | before | 32 | 16 / 13 | 21 / 0 / 6 / 3 |
| `good` | converter | 39 | 19 / 11 | 23 / 1 / 4 / 3 |
| `good` | + fol-v2 | 41 | 17 / 12 | 22 / 1 / 5 / 3 |
| MoE `tiny` | before | 24 | 8 / 14 | 11 / 2 / 8 / 3 |
| MoE `tiny` | converter | 31 | 10 / 10 | 13 / 2 / 5 / 3 |
| MoE `tiny` | + fol-v2 | 25 | **11 / 5** | **12 / 1 / 3 / 3** |

### Reading

- **On fresh data the gain comes from the converter repair.** Under the asked-parts scorer:
  - `good`: 21 → 23 correct, 6 → 4 wrong;
  - MoE `tiny`: 11 → 13 correct, 8 → 5 wrong.
- **fol-v2 mainly cuts `tiny`'s wrong answers.** On the fresh 50, MoE `tiny` falls from 10 to 5 wrong under the old scorer and from 5 to 3 under asked parts. Its correct answers stay about the same.
- **For `good`, fol-v2 is level on the fresh 50** (22 against 23 correct). It gains on the 30, but the 30 were used for development. With one sample per arm, differences of one or two problems are noise; `good` reasons and is not deterministic.
- **fol-v2 pushes the models toward constraint search.** Two converter limits this exposed were fixed during the stage:
  - the products were written constant-first, which the portable profile refuses;
  - decimals and divisions in constraints are now cleared exactly: cross-multiplied by a denominator of known sign and scaled to whole numbers.
- **Further generic fixes found from the fol-v2 outputs:**
  - only the rules a question rests on enter its circuit, so an unrelated non-stratifiable definition no longer breaks it;
  - an unknown that is minimised and bounded only below gets a sound bound;
  - each fact is stated once;
  - ordered or computed variables get numeric types;
  - an alias definition that loops back is dropped;
  - an answer that rests on `absent` of an undefined or untrusted predicate is withheld, a "yes" too;
  - a conjunction of `Ask`s is several questions;
  - `? Maximize(…)` is read as the objective.
- **Most remaining wrong answers are model formalizations.** Examples:
  - a norm written as a rule that derives facts (world:232);
  - the drip counted in the cost (adult:337);
  - a check answered instead of the asked sums (adult:152).

  Under the old scorer, gold lists that hold inputs and partial answers still count as wrong as well.

### Checks

- **`npm test`:** 1556 of 1557 pass (1 skipped), run after the last change. In an earlier run under the parallel load of the fetch and the battery, ten files timed out and one 50 ms timing test failed; rerun alone, all passed.
- **`node tools/capabilities/check.mjs`:** 1235/1235 L1 cases and 286 L2 programs, 0 losses.
- **Offline regression:** 104 of 360, unchanged.
- **Cost:** the fol-v2 fetches cost 0.56 USD on OpenRouter (`good`); MoE `tiny` ran locally.

### Files

- Results of the stages: `state/structure-formalizer/{fol-repair-30,fol-fresh-50,fol-v2-30,fol-v2-fresh-50}/`. Each folder holds `raw.jsonl`, `results.jsonl` (both scorers per problem) and `summary.md`.
- The fresh sample: `fol-fresh-50/ids.json`.

## 11. The jsEval route (owner decision, 2026-10-03; proposal P-6)

**Question (owner).** Let the formalizer write `jsEval` wires directly, only where it fits: a goal that asks for a value or a choice computed from given data, in a problem with registry quantities. Puzzles, deductions and rule questions stay on FOL.

### What was built

- **Routing** (`lib/formalize/structure/route.mjs`, deterministic): jsEval when the structure role (MoE `tiny` + `psm-v1`) marks a `goal` span inside a question unit and at least one registry number lies inside a `quantity` span; FOL otherwise. Labels, offsets and digits only.
- **Language** (`sop/expression.mjs`, P-6): `range`, `sum`, `count`, `min`/`max` over arrays, `map`, `filter`, `reduce`, `sort` (comparator), `includes`, with pure expression-body arrows that exist only as their arguments; every arrow call and array step is charged to the operation budget.
- **Authoring:** role prompt `LLMAPIProvider/prompts/js-v1.md` (loaded by the client, `lib/formalize/js-program.mjs`): `@name jsEval` wires over `$v1..$vn`, the last wire or `answer1..` the answers.
- **Admission:** only `jsEval` wires, earlier references only (no cycle), text copied from the message, the static data-dependency check, evaluation within budgets; one more ask on a violation.
- **Lowering:** fixed-shape arrays and records are unrolled into path B's arithmetic and lowered to `compute`/`compare` rules for every engine; the rest is run by the oracle (the trusted runtime's `jsEval`).
- **Harness:** `node tools/eval/structure-formalizer/js-route.mjs fetch|score --run js-30|js-fresh-50 [--fol fol-v2-30|fol-v2-fresh-50]`; the structure rows were fetched by `ab.mjs fetch --arms psm:structure-tiny` on the run's `ids.json` (the 30 of probe-1, the 50 of `fol-fresh-50`). Path B (unchanged question, no exemplars) was asked on the same routed problems. FOL v2 verdicts are read from the scored `fol-v2-*` runs.
- **Models:** MoE `tiny` (Qwen3.6-35B-A3B) and `good` = **DeepSeek-V4.1-flash on OpenRouter** with reasoning (every `good` row of this section and of the FOL v2 runs was served by it, per the proxy log; `good` has since become openference GLM-5.3).

### Results

Scorers: asked parts (`asked.mjs`: correct / partial / wrong / no answer / gold defect) and the old one (correct / wrong). Seconds: median per problem of the route call, uncached; the structure call is apart (MoE alone ~11 s, §9; 37 s under this run's load).

**Routed share:** 40/50 fresh, 23/30 development (FOL keeps 10 and 7: no goal in a question unit 2 + 2, no registry quantity 8 + 5).

**On the routed problems:**

| set | model | arm | asked parts | old | lowered / oracle-only | s/problem |
|---|---|---|---|---|---|---|
| fresh 50 (40 routed) | `good` | jsEval route | 26 / 0 / 3 / 9 / 2 | 23 / 7 | 27 / 3 | 3.3 |
| | | path B | **32** / 0 / 5 / 1 / 2 | 26 / 13 | all lowered | 5.0 |
| | | FOL v2 | 21 / 0 / 5 / 12 / 2 | 17 / 9 | – | – |
| | MoE `tiny` | jsEval route | 23 / 0 / **2** / 13 / 2 | 20 / 5 | 23 / 2 | 10.4 |
| | | path B | **30** / 1 / **2** / 5 / 2 | 25 / 8 | all lowered | 12.6 |
| | | FOL v2 | 12 / 0 / 2 / 24 / 2 | 11 / 3 | – | – |
| 30 (23 routed) | `good` | jsEval route | 17 / 1 / 2 / 2 / 1 | 12 / 9 | 17 / 4 | 3.0 |
| | | path B | **19** / 2 / 1 / 0 / 1 | 16 / 7 | all lowered | (cached; 4.9 in §9) |
| | | FOL v2 | 16 / 1 / 1 / 4 / 1 | 14 / 5 | – | – |
| | MoE `tiny` | jsEval route | 12 / 1 / 4 / 5 / 1 | 8 / 10 | 17 / 1 | 8.5 |
| | | path B | **14** / 1 / 4 / 3 / 1 | 10 / 9 | all lowered | 8.8 |
| | | FOL v2 | 8 / 3 / 2 / 9 / 1 | 8 / 5 | – | – |

All 84 lowered jsEval programs gave the oracle's answer on the engines. The 10 oracle-only programs: a `range` over data (6), a choice between values of different shapes, a list answer of data-dependent length, `max` over a filtered list, one outside the arithmetic subset.

**Paired, jsEval route against path B (asked-parts correct):** fresh 50: `tiny` both 21, only jsEval 2, only B 9; `good` both 24, only jsEval 2, only B 8. The 30: `tiny` 12 / 0 / 2, `good` 17 / 0 / 2.

**Combined system (all problems; asked parts):**

| set | model | jsEval routed + FOL v2 | path B routed + FOL v2 | FOL v2 alone |
|---|---|---|---|---|
| fresh 50 | `good` | 27 / 1 / 3 / 16 / 3 | **33** / 1 / 5 / 8 / 3 | 22 / 1 / 5 / 19 / 3 |
| fresh 50 | MoE `tiny` | 23 / 1 / 3 / 20 / 3 | **30** / 2 / 3 / 12 / 3 | 12 / 1 / 3 / 31 / 3 |
| 30 | `good` | 17 / 1 / 3 / 8 / 1 | **19** / 2 / 2 / 6 / 1 | 16 / 1 / 2 / 10 / 1 |
| 30 | MoE `tiny` | 12 / 1 / 4 / 12 / 1 | **14** / 1 / 4 / 10 / 1 | 8 / 3 / 2 / 16 / 1 |

### Reading

- **The routing works and pays:** sending the routed problems to a compute path roughly doubles MoE `tiny`'s correct answers on the fresh 50 against FOL v2 alone (12 → 23 with jsEval, 30 with path B) without more wrong answers (3).
- **Within the compute route, path B is better than jsEval** on every cell (paired 9:2 and 8:2 on the fresh 50). jsEval loses on refusals, not on wrong answers: after the second ask, 16 of its non-answers are prose written as an answer (`js_text_not_in_message`), 7 constant answers (`js_answer_not_from_data`), 8 cascades from an earlier refused wire, 5 record answers. Those are the admission doing its job: the model answered instead of computing. Path B's closed question with an `unused:` line leaves less room for that.
- **jsEval is slightly more precise** for `tiny` on the fresh 50 (2 wrong of 25 answered against 2 of 33) and its programs are shorter for lists and choices; the new operations were used and lowered (counts with a test, sums over filtered lists, the cheaper of two records).
- **Recommendation:** keep the route decision and make **path B the default compute path for routed problems**, with the jsEval route as a second, independent formalization of the same problem (its answers agree with the engines by construction, and agreement of two compute formalizations is a cheap verification). Not decided here; one sample per arm, differences of one or two problems are noise.

### Checks

- `npm test`, `node tools/capabilities/check.mjs` (0 losses; 83 new L1 cases for the `e.*` operations and `j.*` admission codes, ledger updated with the full tier), offline regression 104 of 360 (unchanged), `node tools/shard-large-files.mjs --check` ok, `node tools/check-spec-refs.mjs` 0 violations.

### Phase 2–3 (`codeEval`, `engineCode`): not run

Executing model-written programs was refused by the session's permission system when it was wired into the runtime; see P-7 and `questions.md` Q-CODE-1. No code route was measured.

## 12. ChatSOPAdapter: one backend for the chat and the evaluations (owner decision, 2026-10-03)

**What was built.** `lib/adapter` (`createChatSOPAdapter().answer({message, mode})`): the chat turn (`server/http.mjs`), the session query route, the books harness (`tools/eval/books/system.mjs`, `--mode`), the structure/formalizer harnesses (`ab.mjs`, `js-route.mjs`, `score.mjs`, `engines.mjs`, `chat.mjs`) and the engineCode harness now call the adapter's paths, executor and tier client instead of their own glue. Modes: `stepwise` (the default), `routed`, `direct-verified`; more register with `registerMode` (the evaluation mode `all-paths` of `tools/eval/adapter/run.mjs` is one). Every answer carries the mode, the answering path, a verification status with the agreeing paths, circuits, proofs, timings and tiers; the chat states the status through conversation-v1 reply wires (`0080-verification.sop`).

**Reproduction (fresh 50, MoE `tiny`, asked parts: correct / partial / wrong / no answer / gold defect).**

| measure | harness (§10–11, P-7) | rescored through the adapter (stored outputs) | live through `adapter.answer`, cache only |
|---|---|---|---|
| path B (40 routed) | 30 / 1 / 2 / 5 / 2 | 30 / 1 / 2 / 5 / 2 | 30 / 1 / 1 / 6 / 2 |
| jsEval (40 routed) | 23 / 0 / 2 / 13 / 2 | 23 / 0 / 2 / 13 / 2 | 22 / 0 / 2 / 14 / 2 |
| engineCode verified (4 languages) | 18 (15 correct, 2 wrong) | 19 (15 correct, 3 wrong) | 18 (15 correct, 2 wrong) |
| FOL v2 (50) | 12 / 1 / 3 / 31 / 3 | 12 / 1 / 3 / 31 / 3 | 12 / 1 / 4 / 30 / 3 |

Every deviation has a named cause:
- **Text agreement folds case.** The adapter compares text answers case-insensitively, so engineCode's JS "A" and Prolog's atom `a` agree on commonsense:5.4.2 (both wrong): one verified answer more.
- **Two routes swapped.** The structure request of world:383 and world:806 was fetched twice; the harness used the first row, the proxy cache holds the later reply. The adapter routes world:383 to FOL (harness: compute) and world:806 to compute (harness: FOL).
- **Calls the cache cannot replay.** commonsense:6.6.9's B and engineCode replies were first cut by their token budget, and a cut reply is never cached (by design), so a strict replay has no answer there; world:806's compute paths were never asked by the harness. Completed with local `tiny` calls: B 31 / 1 / 1 / 5 / 2.
- **One FOL recording replaced.** The cache holds a later recording of decompose:4.8.3's formalizer request (another reply), which answers 6 against the gold 4: one wrong instead of no answer. Its entity names (the structure role's against GLiNER's) do not change the answer.

**Routed mode** (shipped settings: B, then jsEval, then engineCode in JS and SMT-LIB until two agree; FOL v2 otherwise and as the fallback): 31 / 3 / 5 / 9 / 2 on the 50.

| status | n | correct / partial / wrong / no answer / defect |
|---|---|---|
| verified | 27 | 25 / 1 / 1 / 0 / 0 |
| unverified | 9 | 2 / 2 / 3 / 0 / 2 |
| unresolved | 14 | 4 / 0 / 1 / 9 / 0 (9 without an answer) |

**Direct-verified mode** (the direct `FINAL ANSWER` of `tiny`, then the routed formalizations with early stop):

- **Direct answer alone:** 37 / 0 / 10 / 0 / 3.
- **Verified:** 26 of 50, precision 25/26. The one wrong is adult:728, where the model and the SMT program both say 5 for a yes/no question: the errors are correlated.
- **Contradicted:** 0.
  - A first rule (contradicted when two symbolic paths agree on any other value) gave 3, and the model was right in all 3. In each, the equivalence catalog had returned `unknown`, not `different`: a list against one value, or 11:00 against 11.
  - The rule now needs a decided `different`. It was changed after seeing these 50 problems, so for this rule they are development data.
- **Unverified:** 24, of which 12 correct.
- **Against routed (paired, correct):** both 29, only direct-verified 8, only routed 2. Direct-verified answers 37 correct and 10 wrong; routed answers 31 correct and 5 wrong.

**Reading.**
- **The verified answers are precise in both modes:** 25/26 for direct-verified and 25/27 for routed.
- **Direct-verified answers more but is wrong twice as often.** Its unverified answers are right half the time (12/24); routed instead returns no answer for 9 problems.
- **A verified-only policy would answer about half the problems** (26–27 of 50) with one or two errors.
- **Gap in the equivalence catalog:** "11:00" against 11 is `unknown`, which cost one verification. Not changed here.
- **Sample size:** one sample per arm, so differences of one or two problems are noise.

**Files.** `state/adapter-eval/{repro-all-paths,repro-all-paths-strict,routed-fresh-50-tiny,direct-verified-fresh-50-tiny,direct-verified-fresh-50-tiny-r2}/` (rows, scored rows, summary; local), `state/structure-formalizer/adapter-rescore-fol-v2-fresh-50/`. Cost: local `tiny` only (≈ 70 new calls: direct answers, the engineCode JS+SMT question, two completed problems); no cloud call.
