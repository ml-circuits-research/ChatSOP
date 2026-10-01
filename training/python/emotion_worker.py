"""Batch / line-server worker for the EmotionDetectionSystem neural strategy (DS029).

Reads JSON lines {"id": ..., "texts": [...]} on stdin and writes one JSON line {"id": ..., "scores": [{model: {label: p}}]}
per request (one entry per text). Models are given as --model NAME=DIR (a local Hugging Face sequence-classification
directory); nothing is downloaded (HF_HUB_OFFLINE=1). Multi-label heads (go_emotions, toxic-bert) use a sigmoid, the
others a softmax. CPU only; --threads sets torch's thread count. Run with ~/emotion-venv/bin/python.
"""
import argparse
import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import torch  # noqa: E402
from transformers import AutoModelForSequenceClassification, AutoTokenizer  # noqa: E402


def load(models):
    loaded = {}
    for spec in models:
        name, path = spec.split("=", 1)
        tok = AutoTokenizer.from_pretrained(path)
        model = AutoModelForSequenceClassification.from_pretrained(path).eval()
        multi = getattr(model.config, "problem_type", None) == "multi_label_classification" or name in ("go_emotions", "toxic_bert")
        loaded[name] = (tok, model, multi)
    return loaded


def score(loaded, texts, batch=16):
    out = [{} for _ in texts]
    for name, (tok, model, multi) in loaded.items():
        labels = model.config.id2label
        for i in range(0, len(texts), batch):
            chunk = texts[i:i + batch]
            enc = tok(chunk, return_tensors="pt", padding=True, truncation=True, max_length=128)
            with torch.inference_mode():
                logits = model(**enc).logits
            probs = torch.sigmoid(logits) if multi else torch.softmax(logits, dim=-1)
            for j, row in enumerate(probs.tolist()):
                out[i + j][name] = {labels[k]: round(p, 5) for k, p in enumerate(row)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", action="append", required=True)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--batch", type=int, default=16)
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    loaded = load(args.model)
    print(json.dumps({"ready": True, "models": list(loaded), "threads": args.threads}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        print(json.dumps({"id": req.get("id"), "scores": score(loaded, req["texts"], args.batch)}), flush=True)


if __name__ == "__main__":
    main()
