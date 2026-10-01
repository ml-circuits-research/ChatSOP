"""CPU inference of a MarianMT (Opus-MT) checkpoint over `{id, text}` rows (translate-compare study, 2026-10-01).

No training. Each row is translated on its own text (greedy decoding by default). `--single` runs one row per
generate call and records the latency of each (milliseconds, after a warm-up); otherwise rows are batched by length.

    python translate_sentences.py --model DIR --in rows.jsonl --out out.jsonl [--single] [--threads 8] [--beams 1]
"""
import argparse, json, time

import torch
from transformers import MarianMTModel, MarianTokenizer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--single', action='store_true')
    ap.add_argument('--threads', type=int, default=8)
    ap.add_argument('--beams', type=int, default=1)
    ap.add_argument('--batch', type=int, default=16)
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    rows = [json.loads(l) for l in open(a.inp, encoding='utf-8') if l.strip()]
    tok = MarianTokenizer.from_pretrained(a.model)
    model = MarianMTModel.from_pretrained(a.model).eval()

    def run(texts):
        enc = tok(texts, return_tensors='pt', padding=True, truncation=True, max_length=512)
        with torch.inference_mode():
            out = model.generate(**enc, num_beams=a.beams, do_sample=False, max_new_tokens=400)
        return tok.batch_decode(out, skip_special_tokens=True)

    run(['Salut.'])
    res = [None] * len(rows)
    t0 = time.perf_counter()
    if a.single:
        for i, r in enumerate(rows):
            s = time.perf_counter()
            res[i] = {'id': r['id'], 'out': run([r['text']])[0], 'ms': (time.perf_counter() - s) * 1000}
    else:
        order = sorted(range(len(rows)), key=lambda i: len(rows[i]['text']))
        for k in range(0, len(order), a.batch):
            idx = order[k:k + a.batch]
            s = time.perf_counter()
            outs = run([rows[i]['text'] for i in idx])
            for i, o in zip(idx, outs):
                res[i] = {'id': rows[i]['id'], 'out': o, 'ms': (time.perf_counter() - s) * 1000 / len(idx)}
    with open(a.out, 'w', encoding='utf-8') as f:
        for r in res:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(json.dumps({'rows': len(rows), 'seconds': round(time.perf_counter() - t0, 1)}))


if __name__ == '__main__':
    main()
