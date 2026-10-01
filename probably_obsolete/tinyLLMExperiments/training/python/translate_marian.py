"""Batch RO->EN translation with a MarianMT (Opus-MT) model for experiment eval-translate-then-formalize-v1.

Reads suite rows (JSONL with `id` and `question`), splits each message into sentences, translates every sentence
with greedy decoding (num_beams 1), joins the sentences with one space and writes the row with `question` replaced
(`question_raw` kept) plus per-row timing. The message is the only input; no gold field is read.

    python translate_marian.py --model DIR --suite rows.jsonl --out translated.jsonl --timing timing.json [--device cuda] [--batch 32]
"""
import argparse, json, re, time, statistics

import torch
from transformers import MarianMTModel, MarianTokenizer

SPLIT = re.compile(r'(?<=[.!?])\s+(?=\S)')


def sentences(text):
    parts = [p for p in SPLIT.split(text.strip()) if p]
    return parts or [text]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--suite', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--timing', required=True)
    ap.add_argument('--device', default='cuda')
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--threads', type=int, default=8)
    ap.add_argument('--per-row', action='store_true', help='translate one message at a time (latency measurement)')
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    rows = [json.loads(l) for l in open(a.suite, encoding='utf-8') if l.strip()]
    load_start = time.perf_counter()
    tok = MarianTokenizer.from_pretrained(a.model)
    model = MarianMTModel.from_pretrained(a.model).to(a.device).eval()
    load_s = time.perf_counter() - load_start

    def run(batch_sents):
        enc = tok(batch_sents, return_tensors='pt', padding=True, truncation=True, max_length=512).to(a.device)
        with torch.inference_mode():
            out = model.generate(**enc, num_beams=1, do_sample=False, max_new_tokens=512)
        return tok.batch_decode(out, skip_special_tokens=True)

    run(['Salut.'])  # warm-up
    if a.device.startswith('cuda'):
        torch.cuda.synchronize()
    per_row_ms = [None] * len(rows)
    translated = [None] * len(rows)
    started = time.perf_counter()
    if a.per_row:
        for i, row in enumerate(rows):
            t0 = time.perf_counter()
            translated[i] = ' '.join(run(sentences(row['question'])))
            if a.device.startswith('cuda'):
                torch.cuda.synchronize()
            per_row_ms[i] = (time.perf_counter() - t0) * 1000
    else:
        flat = [(i, s) for i, row in enumerate(rows) for s in sentences(row['question'])]
        order = sorted(range(len(flat)), key=lambda k: len(flat[k][1]))
        outs = [None] * len(flat)
        for b in range(0, len(order), a.batch):
            idx = order[b:b + a.batch]
            for k, text in zip(idx, run([flat[k][1] for k in idx])):
                outs[k] = text
        pieces = {}
        for (i, _), text in zip(flat, outs):
            pieces.setdefault(i, []).append(text)
        for i in range(len(rows)):
            translated[i] = ' '.join(pieces[i]).strip() or rows[i]['question']
    wall = time.perf_counter() - started
    with open(a.out, 'w', encoding='utf-8') as f:
        for row, text, ms in zip(rows, translated, per_row_ms):
            f.write(json.dumps({**row, 'question': text, 'question_raw': row['question'], 'translation_ms': ms}, ensure_ascii=False) + '\n')
    ms = [m for m in per_row_ms if m is not None]
    q = lambda p: sorted(ms)[min(len(ms) - 1, int(p * len(ms)))] if ms else None
    timing = {'format': 'chatsop-translation-timing-v1', 'translator': f'marian {a.model}', 'suite': a.suite, 'rows': len(rows), 'device': a.device,
              'device_name': torch.cuda.get_device_name(0) if a.device.startswith('cuda') else f'cpu ({a.threads} threads)',
              'mode': 'per-row' if a.per_row else f'batched ({a.batch} sentences)', 'load_seconds': load_s, 'wall_seconds': wall,
              'messages_per_second': len(rows) / wall, 'unchanged_after_cleanup': sum(t == r['question'] for t, r in zip(translated, rows)),
              'latency_ms': {'count': len(ms), 'mean': statistics.mean(ms) if ms else None, 'p50': q(0.5), 'p95': q(0.95), 'max': max(ms) if ms else None},
              'decoding': 'greedy, num_beams 1, max_new_tokens 512, sentence split on [.!?] + space'}
    json.dump(timing, open(a.timing, 'w'), indent=2)
    print(json.dumps({k: timing[k] for k in ('rows', 'device', 'wall_seconds', 'unchanged_after_cleanup')}))


if __name__ == '__main__':
    main()
