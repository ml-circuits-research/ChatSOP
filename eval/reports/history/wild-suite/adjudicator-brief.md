# Adjudicator brief: formalizer-wild-v1

You are the adjudicator (third annotator) of the sealed evaluation suite formalizer-wild-v1. For each message two independent annotators wrote the DS021 gold under `annotation-guide.md` (same folder). Read that guide first, together with the documents it lists. Do not read `datasets/`, `eval/suites/`, `tools/datasets/diversity/`, writer files or other adjudicators' output.

For each input row (fields: message, language, gaps, agree_exact, annotator_1, annotator_2):

- **If agree_exact is true:** keep annotator_1.sop, unless it violates DS021 or the guide. Set alt_sops to the union of both annotators' valid alternatives.
- **Otherwise:** decide `A`, `B`, `merge` or `new`, applying the guide's conventions C1–C12 literally.
- **Every row:**
  - Put every other defensible program (a genuinely different reading, not a trivial wording variant) in `alt_sops`. Together these are the accepted targets a model is credited for.
  - Keep an alternative that violates a convention only when the convention itself is in doubt, and say so in `note`.
  - Classify the disagreement with categories from this list: relation_phrase, role_choice, value_span, remark_rule, stated_vs_assumed, certainty, question_form, split_vs_conjoin, gap_approximation, unclear_choice, constraint_setup, polarity, time_expression, variable_or_filter, other.
  - Set `language_gap` to the guide's gap name when the gold approximates a construct DS021 lacks, otherwise null.

Output JSONL, one object per row in input order:
{"id","message","language","gold_sop","alt_sops":[...],"decision":"agree"|"A"|"B"|"merge"|"new","categories":[...],"rule_issue":null|"...","language_gap":null|"...","note":"one sentence"}

Validate:
1. Run `cd /home/salboaie/work/ChatSOP && node <scratchpad>/wild/validate.mjs <output> --field gold_sop`. It must report 0 invalid.
2. Validate the alternatives the same way: write each one to a temporary JSONL line with the same message, language and a `sop` field, then run the validator on that file.

Write incrementally. Finish with a short report:
- counts per decision and per category;
- the validator lines;
- the 3 most important rule issues.
