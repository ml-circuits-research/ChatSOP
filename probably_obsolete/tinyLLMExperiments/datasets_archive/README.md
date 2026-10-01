# datasets_archive

The legacy corpora that feed the three datasets of the owner decision of 2026-09-30 (`datasets/bad_english`, `datasets/symbolic_english`, `datasets/neuro_english`), moved here unchanged: `formalizer-v1` (gold SOP, verification worlds), `proofing` and `proofing-diverse-dev` (message to oracle-passing rewrite pairs, identity rows, hard cases), `clean-english` (the clean-English partition of formalizer-v1) and `diversity` (source inventory). They are provenance inputs and the gold-SOP arbiter, not the datasets to train or evaluate on today. Old paths (`datasets/<corpus>/...`) that frozen records still store are listed in `PATH_ALIASES.json` and resolved by `lib/dataset-paths.mjs`.

Sources, licences and what was and was not taken: `datasets/SOURCES.md`. Rules of the three datasets: `datasets/<name>/README.md` and `docs/specs/DS008-data-evaluation.md` "Three datasets".
