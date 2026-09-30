#!/usr/bin/env python3
"""Opus-MT ROMANCE-en (Helsinki-NLP, the model of eval-translator-compare-v1) on CPU for eval-cpu-speed-laptop-v1.

Run in ~/mt-venv, pinned with taskset to cores of one type (the caller does the pinning), OMP_NUM_THREADS = threads:
  taskset -c 5-8 ~/mt-venv/bin/python tools/research/opus-mt-cpu-bench.py --threads 4 --label x925x4
Measures, for 30 Romanian messages of about 30 source tokens (one message at a time, batch 1, warm):
CTranslate2 int8 (beam 1 and 4) and transformers fp32 greedy: ms per message and generated tokens per second.
"""
import argparse, json, os, sys, time, glob
ap = argparse.ArgumentParser()
ap.add_argument('--threads', type=int, default=4)
ap.add_argument('--label', default='cpu')
ap.add_argument('--n', type=int, default=30)
args = ap.parse_args()
os.environ['OMP_NUM_THREADS'] = str(args.threads)
root = '/home/salboaie/work/ChatSOP'
base = glob.glob(root + '/models/opus-mt/bases/*/')[0]
ct2_dir = os.path.expanduser('~/laptop-cpu-gguf/ct2/opus-mt-romance-en-int8')

# Romanian messages of roughly 30 tokens: clean monolingual Romanian rows of the corpus dev split (read only)
import sentencepiece as spm
sp = spm.SentencePieceProcessor(model_file=base + 'source.spm')
rows = []
for path in ['datasets_archive/formalizer-v1/dev.jsonl', 'datasets_archive/formalizer-v1/dev.jsonl']:
    if os.path.exists(os.path.join(root, path)):
        rows = [json.loads(l) for l in open(os.path.join(root, path))]
        break
texts = [r['question'] for r in rows if r.get('language') == 'ro' and not r.get('noise') and 22 <= len(sp.encode(r['question'])) <= 40][:args.n]
assert len(texts) >= 10, len(texts)
out = {'label': args.label, 'threads': args.threads, 'messages': len(texts), 'mean_source_tokens': sum(len(sp.encode(t)) for t in texts) / len(texts)}

import ctranslate2
tr = ctranslate2.Translator(ct2_dir, device='cpu', inter_threads=1, intra_threads=args.threads, compute_type='int8')
tsp = spm.SentencePieceProcessor(model_file=base + 'target.spm')
def ct2_run(beam):
    toks = [sp.encode(t, out_type=str) + ['</s>'] for t in texts]
    tr.translate_batch([toks[0]], beam_size=beam, max_decoding_length=64)  # warm-up
    t0 = time.perf_counter(); gen = 0; outs = []
    for tk in toks:
        r = tr.translate_batch([tk], beam_size=beam, max_decoding_length=64)[0]
        h = r.hypotheses[0]; gen += len(h) + 1; outs.append(tsp.decode(h))
    dt = time.perf_counter() - t0
    return {'ms_per_message': 1000 * dt / len(texts), 'generated_tokens_per_s': gen / dt, 'mean_output_tokens': gen / len(texts), 'sample': outs[:2]}
out['ctranslate2_int8_beam1'] = ct2_run(1)
out['ctranslate2_int8_beam4'] = ct2_run(4)

import torch
torch.set_num_threads(args.threads)
from transformers import MarianMTModel, MarianTokenizer
tok = MarianTokenizer.from_pretrained(base)
model = MarianMTModel.from_pretrained(base).eval()
def hf_run():
    with torch.inference_mode():
        enc = tok(texts[0], return_tensors='pt'); model.generate(**enc, num_beams=1, max_new_tokens=64)
        t0 = time.perf_counter(); gen = 0
        for t in texts:
            enc = tok(t, return_tensors='pt')
            o = model.generate(**enc, num_beams=1, max_new_tokens=64, do_sample=False)
            gen += o.shape[1] - 1
        dt = time.perf_counter() - t0
    return {'ms_per_message': 1000 * dt / len(texts), 'generated_tokens_per_s': gen / dt, 'mean_output_tokens': gen / len(texts)}
out['transformers_fp32_greedy'] = hf_run()
print(json.dumps(out))
