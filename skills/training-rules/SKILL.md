# Training rules for small models on synthetic data

These are experimental design heuristics from earlier small-model runs, not
universal percentages, scaling laws or evidence of ChatSOP model accuracy.
Measure each claim again on this task with representative held-out examples.

## 1. Coverage is an empirical question

Count the composition and operator families in train, development and real
target data. Reserve whole compositions before rendering and report performance
on both seen and unseen shapes. Examples of one shape may help it without
establishing generalization to another. Grow operator vocabulary in measured
tranches; do not assert a sharp universal vocabulary boundary or a fixed
percentage for unseen operators, chains or model scales.

## 2. Structural splits, decided before rendering

Declare split groups before rendering; keep paraphrases, language variants
and semantic duplicates of each case together. Reserve whole compositions for
composition-generalization measurement when the study requires it. Verify
counts and leakage after every rebuild; do not choose the holdout after seeing
its results. A seen-shape held-out split measures a different question and can
coexist if it is labeled separately.

## 3. The assertion policy

An assertion must be a justified invariant the answer has to satisfy, not a
guess about the answer. False guards reject valid instances; generic
boilerplate duplicates the executor's own contract. Zero qualifying items,
absent targets, empty filters and ties need explicitly defined answers rather
than assumed errors. Validate emitted SOP against independent execution.

## 4. Target form: move generic and recurring text out of the model

Repeated fixed preambles and checks that the executor already guarantees
should not consume target tokens. A reviewed, typed declarative primitive can
replace recurring multi-line output where its semantics are independently
tested. Do not add a primitive merely to hide an unmeasured error class.

## 5. Retries are deployment, not measurement

If a deployment implements bounded retries with actionable failure feedback,
measure first-shot results separately from post-retry recovery, including
correctness rather than merely successful execution. Do not infer that ChatSOP
has a retry interface from this methodology.

## 6. Training economics

Use a fixed development selection protocol at each save, a finite step/epoch
budget and checkpoint cadence that fits the available disk. Consider early
stopping when measured selection scores plateau, not at a predeclared
universal fraction of steps or patience interval. Measure the effect of data
size, per-family dose and base scale rather than claiming a universal ceiling.

## 7. Base selection: controlled comparison

Compare eligible bases on the same held-out task items and emission quality.
Record revisions, licenses, compute and tokenizer constraints. A larger base
may help or not; neither size nor an earlier shootout proves that novel
operator families are solved. Change one variable at a time.

## 8. Reporting and model identity

Percentages always carry their counts; decomposed numbers beat aggregates (per family, per plan
cluster, per book); when comparing two numbers, name both sides and what changed between them.
Record each arm's hypothesis before running it. A trained model's identity
includes its size, pinned base revision, dataset manifest/version, recipe,
role and training finish time; name the actual run and checkpoint alongside
those facts rather than treating a checkpoint number as a model identity.
Keep the run identity consistent with ChatSOP's `identity.json`.

## 9. Operations discipline

Follow `night-orchestration` for the exclusive owner, preflight, bounded run,
checkpoint validity, explicit stop and closed-run retention. For ChatSOP use
its Node training controller and the `spark-training` Podman procedure, never
the obsolete imported shell launchers.
