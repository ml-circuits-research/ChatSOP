/**
 * The real model backends of the small-model service, loaded on first use and kept in memory:
 *   structure   GLiNER2.5 base (fastino/gliner2.5-base-v1, ONNX export nicolasembleton/gliner2.5-base-v1-onnx) through onnxruntime-node
 *               and the vendored MIT JS host (vendor/gliner25, Pastel-Org/gliner2.5-onnx-webgpu): entities, relations, field records;
 *   formalizer  T5-base NL-to-FOL (fvossel/t5-base-nl-to-fol, exported to ONNX by convert/export-t5-onnx.sh) through transformers.js:
 *               the first candidate is greedy, further candidates are sampled (transformers.js ignores num_beams > 1 and
 *               num_return_sequences, so each sample is its own generate call).
 * Each backend runs one request at a time (a promise chain). CPU only: onnxruntime-node 1.30 ships no CUDA provider for linux-arm64
 * (`listSupportedBackends()` is cpu only on this machine). Each model's ONNX sessions use at most `threads` intra-op threads and one
 * inter-op thread, so the two models together use at most 2 × threads cores and the machine stays usable.
 * The npm packages are imported lazily, so the HTTP layer and its tests need no node_modules.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const abs = p => (path.isAbsolute(p) ? p : path.join(HERE, p));
// At most `threads` intra-op threads, one inter-op thread, and no spin-waiting of idle threads (spinning keeps cores busy between calls).
const sessionLimits = threads => ({intraOpNumThreads: threads, interOpNumThreads: 1, extra: {session: {intra_op: {allow_spinning: '0'}, inter_op: {allow_spinning: '0'}}}});

/** Serializes async calls of one backend. */
function serial() {
  let last = Promise.resolve();
  return fn => { const run = last.then(fn, fn); last = run.catch(() => {}); return run; };
}

export function structureBackend(cfg, {threads = 4} = {}) {
  let state = null;
  const queue = serial();
  async function load() {
    if (state) return state;
    const t0 = Date.now();
    const ort = await import('onnxruntime-node');
    const {AutoTokenizer, env} = await import('@huggingface/transformers');
    const {Gliner25} = await import('./vendor/gliner25/api.mjs');
    const dir = abs(cfg.dir);
    env.allowRemoteModels = false; env.localModelPath = path.dirname(dir) + path.sep;
    const tok = await AutoTokenizer.from_pretrained(path.basename(dir));
    const tokenize = s => tok.encode(s, {add_special_tokens: false});
    const opt = {executionProviders: ['cpu'], ...sessionLimits(threads)};
    const session = await ort.InferenceSession.create(path.join(dir, cfg.graphs.model), opt);
    const headsSession = cfg.graphs.heads ? await ort.InferenceSession.create(path.join(dir, cfg.graphs.heads), opt) : null;
    const recordsSession = cfg.graphs.records ? await ort.InferenceSession.create(path.join(dir, cfg.graphs.records), opt) : null;
    state = {g: new Gliner25({ort, session, tokenize, headsSession, recordsSession}), loadMs: Date.now() - t0};
    return state;
  }
  return {
    id: cfg.id,
    status: () => ({id: cfg.id, loaded: Boolean(state), load_ms: state?.loadMs ?? null, dir: cfg.dir}),
    /** {text, entities, relations, structures, threshold} → {entities, relations, structures}. */
    run: req => queue(async () => {
      const {g} = await load();
      const threshold = req.threshold ?? cfg.threshold ?? 0.5;
      const out = {entities: {}, relations: [], structures: {}};
      const labels = Array.isArray(req.entities) ? req.entities : Object.keys(req.entities ?? {});
      const descriptions = Array.isArray(req.entities) ? undefined : req.entities;
      if (labels.length) out.entities = (await g.extract_entities(req.text, labels, {threshold, include_confidence: true, include_spans: true, descriptions, maxWords: cfg.maxWords})).entities;
      if (req.relations && Object.keys(req.relations).length) {
        const r = await g.extract_relations(req.text, req.relations, {threshold});
        out.relations = (r.relations ?? []).map(x => ({type: x.type, head: {text: x.head.text, start: x.head.start, end: x.head.end}, tail: {text: x.tail.text, start: x.tail.start, end: x.tail.end}, confidence: x.score}));
      }
      if (req.structures && Object.keys(req.structures).length) out.structures = await g.extract_json(req.text, req.structures, {threshold, include_confidence: true, include_spans: true, records: Boolean(req.records)});
      return out;
    }),
  };
}

export function formalizerBackend(cfg, {threads = 4} = {}) {
  let state = null;
  const queue = serial();
  async function load() {
    if (state) return state;
    const t0 = Date.now();
    const {AutoTokenizer, AutoModelForSeq2SeqLM, env} = await import('@huggingface/transformers');
    const dir = abs(cfg.dir);
    env.allowRemoteModels = false; env.localModelPath = path.dirname(dir) + path.sep;
    const tok = await AutoTokenizer.from_pretrained(path.basename(dir));
    const model = await AutoModelForSeq2SeqLM.from_pretrained(path.basename(dir), {dtype: 'fp32', device: 'cpu', session_options: sessionLimits(threads), ...(cfg.externalData ? {use_external_data_format: true} : {})});
    state = {tok, model, loadMs: Date.now() - t0};
    return state;
  }
  return {
    id: cfg.id,
    status: () => ({id: cfg.id, loaded: Boolean(state), load_ms: state?.loadMs ?? null, dir: cfg.dir}),
    /** {inputs: [string], candidates, temperature, top_k, max_new_tokens, prefix} → {results: [{input, candidates: [string], tokens}]}. */
    run: req => queue(async () => {
      const {tok, model} = await load();
      const prefix = req.prefix ?? cfg.prefix ?? '';
      const n = Math.max(1, Math.min(req.candidates ?? 1, cfg.maxCandidates ?? 8));
      const results = [];
      for (const input of req.inputs) {
        const enc = await tok(prefix + input);
        const cands = [], seen = new Set();
        let tokens = 0;
        for (let k = 0; k < n; k++) {
          const opts = k === 0 ? {max_new_tokens: req.max_new_tokens ?? cfg.maxNewTokens, do_sample: false}
            : {max_new_tokens: req.max_new_tokens ?? cfg.maxNewTokens, do_sample: true, temperature: req.temperature ?? 0.8, top_k: req.top_k ?? 20};
          const out = await model.generate({...enc, ...opts});
          tokens += out.dims.at(-1);
          const text = tok.batch_decode(out, {skip_special_tokens: true})[0].trim();
          // Distinct candidates only; a repeated sample is not a new reading.
          if (!seen.has(text)) { seen.add(text); cands.push(text); }
        }
        results.push({input, candidates: cands, tokens});
      }
      return {results};
    }),
  };
}
