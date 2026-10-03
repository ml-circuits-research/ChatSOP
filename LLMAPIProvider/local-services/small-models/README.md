# Small-model local service (LLMAPIProvider)

A local JSON service of LLMAPIProvider for the two small non-chat models of the formalization architecture (owner decision 2026-10-03; design and probe in `experiments/proposal/structure-and-formalizer-models.md`):

| role | tier | model | endpoint |
|---|---|---|---|
| PSM, Problem Structure Model | `structure` | GLiNER2.5 base (fastino/gliner2.5-base-v1, 194M; ONNX export nicolasembleton/gliner2.5-base-v1-onnx) | `POST /v1/structure` |
| LFM, Logic Formalizer Model | `formalizer` | T5-base NL-to-FOL (fvossel/t5-base-nl-to-fol, 223M; ONNX exported locally) | `POST /v1/fol` |

Clients never call this port and nobody starts it by hand: it is the managed upstream `smallmodels` of LLMAPIProvider (owner decision 2026-10-03: everything that serves models lives in LLMAPIProvider), started with the proxy (`startAtBoot`) and restarted on demand like the llama-server of `tiny`. Clients name the tiers `structure` and `formalizer`; the proxy logs, tags (`x-llmapiprovider-purpose`) and caches every answer as for a chat model. ChatSOP's client is `lib/formalize/small-models.mjs`.

Node only at run time: `@huggingface/transformers` 4.3.0 (T5 generation) and `onnxruntime-node` 1.30.0 (GLiNER graphs). The GLiNER2.5 host code (schema packing, span decoding, relation beam, records) is vendored from Pastel-Org/gliner2.5-onnx-webgpu (MIT, `vendor/gliner25/`). Python was used once, to export T5 to ONNX (`convert/export-t5-onnx.sh`); nothing Python is served.

**Hardware: CPU.** onnxruntime-node 1.30 ships no CUDA execution provider for linux-arm64 (`listSupportedBackends()` lists only `cpu` on this GB10 machine; a CUDA session fails with "backend not found"), so both models run on the CPU. Each model uses at most `threads` (4) intra-op threads, one inter-op thread and no spin-waiting; measured during a 10-problem run: median about 300% CPU, peak about 510% (before the cap: about 1,000%).

## Install

```
cd LLMAPIProvider/local-services/small-models && npm install   # node_modules is gitignored
```

Models are read from `models/<name>/` of the repository (`config.json`, paths relative to this folder), each with a `PROVENANCE.json` (source, revision, licence, sha256). They load on the first request (about 1.5 s each) and stay in memory. The proxy refuses to start the service (and logs why) while a file of `start.requires` is missing.

## API

`POST /v1/structure`
```json
{"model": "structure", "text": "Ana has 12 apples and gives 5 to Ben. How many apples does Ana have left?",
 "entities": {"quantity": "a number with what it counts", "goal": "what the question asks"},
 "relations": {"has_quantity": {"head": ["entity"], "tail": ["quantity"]}}, "threshold": 0.4}
```
→ `{"object": "structure", "model": "gliner2.5-base-v1", "entities": {"quantity": [{"text": "12", "start": 8, "end": 10, "confidence": 0.98}], ...}, "relations": [{"type", "head": {text, start, end}, "tail": {...}, "confidence"}], "structures": {}, "ms": 230}`. `entities` is a label list or an object label → description; `structures` (`{"parent": ["field::str", ...]}`, with `records: true` for record mode) is passed to the host's `extract_json`.

`POST /v1/fol`
```json
{"model": "formalizer", "inputs": ["Every cat is a mammal.", "Tom is a cat."], "candidates": 3}
```
→ `{"object": "fol", "model": "t5-base-nl-to-fol", "results": [{"input": "Every cat is a mammal.", "candidates": ["FORALLx (Cat(x) IMPLIES Mammal(x))"], "tokens": 21}, ...], "ms": 700}`. One statement per input (the model was trained on single statements). The first candidate is greedy; the others are sampled (`temperature` 0.8, `top_k` 20 by default; transformers.js ignores beam search), and only distinct candidates are returned. The proxy's cache makes a repeated request return the same candidates.

`GET /health`, `GET /v1/models`. A bad request is a 400 naming the field; a backend failure is a 500 with its message.

## Measured (CPU, 4 threads per model, 2026-10-03)

GLiNER2.5 base: median 0.35 s per book problem (entities plus relations; 0.23 s with 8 threads). T5-base: about 87 generated tokens/s greedy, median 3.0 s per problem (about 7 statements).

## Tests

`node --test server.test.mjs` (also run by `npm test` of the proxy and of ChatSOP) uses fake backends; no model is loaded.
