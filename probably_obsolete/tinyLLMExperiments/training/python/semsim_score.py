#!/usr/bin/env python3
"""Inference-only scoring of sentence pairs with small semantic-similarity models (evaluation of the analysis-compare
decision, DS016 "Analysis comparison"). Run with the separate venv ~/semsim-venv (never a shared venv); CPU, no training.

  ~/semsim-venv/bin/python training/python/semsim_score.py --pairs pairs.jsonl --out scores.jsonl --models nli-small,nli-base,nli-moritz,quora,stsb,minilm,bge [--threads 8] [--latency latency.json]

Input lines {k, a, b}; output lines {k, <model>: {...scores}}. NLI models give the probabilities of entailment, neutral
and contradiction for a->b and b->a; the cross-encoders a score in [0, 1]; the embedding models the cosine.
"""
import argparse, json, os, sys, time, hashlib

MODELS = {
    'nli-small': ('cross-encoder/nli-deberta-v3-small', 'nli'),
    'nli-base': ('cross-encoder/nli-deberta-v3-base', 'nli'),
    'nli-moritz': ('MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli', 'nli'),
    'quora': ('cross-encoder/quora-distilroberta-base', 'ce'),
    'stsb': ('cross-encoder/stsb-roberta-base', 'ce'),
    'minilm': ('sentence-transformers/all-MiniLM-L6-v2', 'emb'),
    'bge': ('BAAI/bge-small-en-v1.5', 'emb'),
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pairs', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--models', default=','.join(MODELS))
    ap.add_argument('--threads', type=int, default=4)
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--latency', default=None, help='write per-pair latency at batch 1 with --latency-threads threads on the first --latency-n pairs')
    ap.add_argument('--latency-threads', type=int, default=4)
    ap.add_argument('--latency-n', type=int, default=60)
    args = ap.parse_args()
    os.environ.setdefault('HF_HOME', os.path.expanduser('~/semsim-venv/hf'))
    os.environ['HF_HUB_OFFLINE'] = '1'
    for v in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ[v] = str(args.threads)
    import torch
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    torch.set_num_threads(args.threads)
    pairs = [json.loads(l) for l in open(args.pairs) if l.strip()]
    results = {p['k']: {} for p in pairs}
    latency = {}
    for name in args.models.split(','):
        repo, kind = MODELS[name]
        t0 = time.time()
        if kind == 'emb':
            from sentence_transformers import SentenceTransformer
            model = SentenceTransformer(repo, device='cpu')
            def emb_scores(batch):
                ea = model.encode([p['a'] for p in batch], convert_to_tensor=True, normalize_embeddings=True, batch_size=len(batch))
                eb = model.encode([p['b'] for p in batch], convert_to_tensor=True, normalize_embeddings=True, batch_size=len(batch))
                return [{'cos': float((x * y).sum())} for x, y in zip(ea, eb)]
            score = emb_scores
        else:
            tok = AutoTokenizer.from_pretrained(repo)
            model = AutoModelForSequenceClassification.from_pretrained(repo).eval()
            id2label = {int(i): l.lower() for i, l in model.config.id2label.items()}
            def ce_scores(batch):
                outs = []
                with torch.no_grad():
                    if kind == 'nli':
                        for first, second in (('a', 'b'), ('b', 'a')):
                            enc = tok([p[first] for p in batch], [p[second] for p in batch], padding=True, truncation=True, max_length=256, return_tensors='pt')
                            prob = torch.softmax(model(**enc).logits, dim=-1)
                            outs.append([{id2label[i]: float(prob[r, i]) for i in range(prob.shape[1])} for r in range(len(batch))])
                        return [{'ab': outs[0][r], 'ba': outs[1][r]} for r in range(len(batch))]
                    enc = tok([p['a'] for p in batch], [p['b'] for p in batch], padding=True, truncation=True, max_length=256, return_tensors='pt')
                    logits = model(**enc).logits
                    val = torch.sigmoid(logits[:, 0]) if logits.shape[1] == 1 else torch.softmax(logits, dim=-1)[:, 1]
                    # symmetric: average both orders
                    enc2 = tok([p['b'] for p in batch], [p['a'] for p in batch], padding=True, truncation=True, max_length=256, return_tensors='pt')
                    logits2 = model(**enc2).logits
                    val2 = torch.sigmoid(logits2[:, 0]) if logits2.shape[1] == 1 else torch.softmax(logits2, dim=-1)[:, 1]
                    return [{'score': float(val[r]), 'score_rev': float(val2[r])} for r in range(len(batch))]
            score = ce_scores
        load_s = time.time() - t0
        t0 = time.time()
        for i in range(0, len(pairs), args.batch):
            batch = pairs[i:i + args.batch]
            for p, s in zip(batch, score(batch)):
                results[p['k']][name] = s
        bulk_s = time.time() - t0
        info = {'repo': repo, 'load_s': round(load_s, 2), 'bulk_s': round(bulk_s, 2), 'pairs': len(pairs), 'params_m': round(sum(p.numel() for p in (model.parameters() if hasattr(model, 'parameters') else [])) / 1e6, 1)}
        if args.latency:
            torch.set_num_threads(args.latency_threads)
            sample = pairs[:args.latency_n]
            score(sample[:3])
            t0 = time.time()
            for p in sample:
                score([p])
            info['latency_ms_per_pair_4threads_batch1'] = round((time.time() - t0) * 1000 / len(sample), 1)
            torch.set_num_threads(args.threads)
        latency[name] = info
        print(name, info, file=sys.stderr, flush=True)
        # write after every model so a stopped run keeps what it finished
        with open(args.out, 'w') as f:
            for k, v in results.items():
                f.write(json.dumps({'k': k, **v}) + '\n')
        if args.latency:
            json.dump(latency, open(args.latency, 'w'), indent=1)

if __name__ == '__main__':
    main()
