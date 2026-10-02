# Sections removed from the product documentation

Text that only made sense for training the small models, moved here when the owner asked on 2026-10-02 to clean the small-model training rules out of the product documentation. Each entry names the file it came from.

## From `README.md` (removed 2026-10-02 by docs-sub)

Training is not planned; any run needs the owner's explicit approval.

## From `docs/index.html` (removed 2026-10-02 by docs-sub)

Training is not planned and needs the owner's explicit approval per run.

## From `docs/wiki.html` (removed 2026-10-02 by docs-sub)

<p>Corpus-building code uses these cases to produce training and evaluation records and to keep equivalent phrasings together when splitting training, development, and test data. Otherwise a model could see one phrasing during training and be credited for “unseen” understanding on its near-duplicate. Related contrast cases and duplicate meanings also require leakage checks.</p>

## From `docs/wiki.html` (removed 2026-10-02 by docs-sub)

It is never used for training or checkpoint selection, and connected case groups never cross into it from train or dev

## From `docs/wiki.html` (removed 2026-10-02 by docs-sub)

New knowledge therefore never requires retraining anything. (The learning flow that trained small formalizer models is frozen with the tiny-model branch.)


## From docs/wiki.html (removed 2026-10-02 by product-agent, owner: remove small-model training rules)

```html
<dt id="definition-model-policy">Policy: rules first, no fine-tuning yet, laptop speed</dt><dd>Frozen history (owner decision of 2026-10-01): part of the tiny-model branch archived in <code>probably_obsolete/tinyLLMExperiments/</code>; not part of the product.</dd>
```
