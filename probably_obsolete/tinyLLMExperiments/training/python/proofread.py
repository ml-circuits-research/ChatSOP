#!/usr/bin/env python3
"""Off-the-shelf English proofreader for experiment eval-rewrite-symbolic-v1 (condition P).

Reads JSON lines {"id", "units": [text, ...]} (the message cut into sentences by lib/sentence-split.mjs, with names,
quotes and numbers already replaced by placeholders) and writes {"id", "units": [corrected, ...], "ms"} per line.
Greedy decoding (num_beams 1, no sampling), so a rerun is identical. No training.

Models (pinned revisions; licences in DS014 "Model weights" and dependencies.md):
  coedit-small   jbochi/coedit-small @6ce9822b4ff6e4af86b70f979c890e9e41f04366  (flan-t5-small on CoEdIT, Apache-2.0)
                 prompt "Fix grammatical errors in this sentence: <text>"
  gec-t5-small   Unbabel/gec-t5_small @c958d53bfbce19c87342b69fc6bcaba7303d076f  (t5-small GEC, Apache-2.0), prefix "gec: "

Usage: ~/nlp-venv/bin/python training/python/proofread.py --model coedit-small --in units.jsonl --out out.jsonl [--device cuda]
"""
import argparse
import json
import os
import time

# torch 2.14 routes some matmuls to JIT-compiled Triton kernels, which need Python headers this host lacks.
os.environ.setdefault('TORCH_DISABLE_NATIVE_JIT', '1')

MODELS = {
    'coedit-small': ('jbochi/coedit-small', '6ce9822b4ff6e4af86b70f979c890e9e41f04366', 'Fix grammatical errors in this sentence: '),
    'gec-t5-small': ('Unbabel/gec-t5_small', 'c958d53bfbce19c87342b69fc6bcaba7303d076f', 'gec: '),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True, choices=sorted(MODELS))
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--device', default='cuda')
    ap.add_argument('--batch', type=int, default=32)
    args = ap.parse_args()
    import torch
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    repo, revision, prefix = MODELS[args.model]
    device = 'cuda' if args.device == 'cuda' and torch.cuda.is_available() else 'cpu'
    tokenizer = AutoTokenizer.from_pretrained(repo, revision=revision)
    model = AutoModelForSeq2SeqLM.from_pretrained(repo, revision=revision).to(device).eval()
    rows = [json.loads(line) for line in open(args.inp, encoding='utf-8') if line.strip()]
    flat = [(i, j, unit) for i, row in enumerate(rows) for j, unit in enumerate(row['units'])]
    outputs = {}
    timing = {}
    for start in range(0, len(flat), args.batch):
        chunk = flat[start:start + args.batch]
        texts = [prefix + unit for _, _, unit in chunk]
        t0 = time.perf_counter()
        enc = tokenizer(texts, return_tensors='pt', padding=True, truncation=True, max_length=512).to(device)
        with torch.no_grad():
            gen = model.generate(**enc, num_beams=1, do_sample=False, max_new_tokens=min(512, int(enc['input_ids'].shape[1] * 1.5) + 16))
        decoded = tokenizer.batch_decode(gen, skip_special_tokens=True)
        ms = (time.perf_counter() - t0) * 1000 / len(chunk)
        for (i, j, _), text in zip(chunk, decoded):
            outputs[(i, j)] = text.strip()
            timing[i] = timing.get(i, 0) + ms
    with open(args.out, 'w', encoding='utf-8') as f:
        for i, row in enumerate(rows):
            units = [outputs[(i, j)] for j in range(len(row['units']))]
            f.write(json.dumps({'id': row['id'], 'units': units, 'ms': timing.get(i, 0), 'device': device, 'model': repo, 'revision': revision}, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
