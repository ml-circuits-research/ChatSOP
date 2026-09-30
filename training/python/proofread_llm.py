#!/usr/bin/env python3
"""Small instruction LLMs as zero-shot proofreaders/rewriters for experiment proofing-candidates-v1 (inference only).

Reads JSON lines {"id", "text"} (the message with names, numbers and quotes already replaced by placeholders) and
writes {"id", "output", "in_tokens", "out_tokens", "ms"} per line, in input order. Greedy decoding (do_sample False,
num_beams 1), bf16 on CUDA, left padding, batches built from length-sorted inputs; the batch composition is fixed by
the input order, so a rerun with the same input and batch size is expected to be identical (checked by the tool's
`repro` command, not assumed). No training, no optimizer, no gradient.

The prompt is a user turn: an instruction, then the text after a line "Text:". Qwen3 runs with thinking disabled
(`enable_thinking=False` in its chat template). The model directory is a pinned local snapshot (models/proofing/...).

Usage: ~/nlp-venv/bin/python training/python/proofread_llm.py --model DIR --prompt-file P.txt --in in.jsonl --out out.jsonl
       [--batch 32] [--device cuda] [--max-new 384]
"""
import argparse
import json
import os
import time

os.environ.setdefault('TORCH_DISABLE_NATIVE_JIT', '1')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--prompt-file', required=True)
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--device', default='cuda')
    ap.add_argument('--max-new', type=int, default=384)
    args = ap.parse_args()
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    torch.manual_seed(0)
    device = 'cuda' if args.device == 'cuda' and torch.cuda.is_available() else 'cpu'
    instruction = open(args.prompt_file, encoding='utf-8').read().strip()
    tok = AutoTokenizer.from_pretrained(args.model)
    tok.padding_side = 'left'
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    dtype = torch.bfloat16 if device == 'cuda' else torch.float32
    model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=dtype).to(device).eval()
    rows = [json.loads(line) for line in open(args.inp, encoding='utf-8') if line.strip()]

    def prompt(text):
        messages = [{'role': 'user', 'content': instruction + '\n\nText:\n' + text}]
        kwargs = {}
        if 'qwen3' in (model.config.model_type or ''):
            kwargs['enable_thinking'] = False
        return tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, **kwargs)

    prompts = [prompt(r['text']) for r in rows]
    lengths = [len(tok(p, add_special_tokens=False)['input_ids']) for p in prompts]
    order = sorted(range(len(rows)), key=lambda i: (lengths[i], i))
    results = {}
    eos = [t for t in {tok.eos_token_id, tok.convert_tokens_to_ids('<end_of_turn>') if '<end_of_turn>' in tok.get_vocab() else None,
                       tok.convert_tokens_to_ids('<|im_end|>') if '<|im_end|>' in tok.get_vocab() else None} if t is not None]
    for start in range(0, len(order), args.batch):
        idx = order[start:start + args.batch]
        enc = tok([prompts[i] for i in idx], return_tensors='pt', padding=True, add_special_tokens=False).to(device)
        text_tokens = max(lengths[i] for i in idx)
        max_new = min(args.max_new, int(text_tokens * 1.2) + 48)
        if device == 'cuda':
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        with torch.no_grad():
            gen = model.generate(**enc, do_sample=False, num_beams=1, max_new_tokens=max_new, eos_token_id=eos, pad_token_id=tok.pad_token_id,
                                 temperature=None, top_p=None, top_k=None)
        if device == 'cuda':
            torch.cuda.synchronize()
        ms = (time.perf_counter() - t0) * 1000
        new = gen[:, enc['input_ids'].shape[1]:]
        outs = tok.batch_decode(new, skip_special_tokens=True)
        batch_out_tokens = 0
        for k, i in enumerate(idx):
            n_out = int((new[k] != tok.pad_token_id).sum().item())
            batch_out_tokens += n_out
            results[i] = {'id': rows[i]['id'], 'output': outs[k].strip(), 'in_tokens': lengths[i], 'out_tokens': n_out, 'truncated': n_out >= max_new}
        for i in idx:
            results[i]['ms'] = ms / len(idx)
            results[i]['batch_ms'] = ms
            results[i]['batch_out_tokens'] = batch_out_tokens
        print(json.dumps({'progress': min(start + args.batch, len(order)), 'of': len(order)}), flush=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        for i in range(len(rows)):
            f.write(json.dumps({**results[i], 'device': device}, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
