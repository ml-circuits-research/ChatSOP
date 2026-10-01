#!/usr/bin/env python3
"""Full fine-tuning of a MarianMT translation model on {source, target} pairs (experiment translate-distill-v1, 2026-10-01).

Not the formalizer path of train.py: the target is plain English and the interim checks are the dev loss, a greedy decode of a dev
sample (jargon-span retention and exact-match share) and a decode of a small stratified natural sample (read-only, evaluation
only; nothing of it is ever trained on or used to select a checkpoint except through the preregistered stopping rules).
It refuses to start without a qualification record (status `qualified`) and an owner authorization receipt (`approved: true`).

    python train_translator_marian.py --base DIR --data DIR --out DIR --qualification F --authorization F --natural F [--epochs 3]
"""
import argparse, json, math, random, time, os, shutil
from pathlib import Path
import torch
from torch.utils.data import DataLoader
from transformers import MarianMTModel, MarianTokenizer


def read(p): return [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    for k in ['base', 'data', 'out', 'qualification', 'authorization', 'natural']: ap.add_argument('--' + k, required=True)
    ap.add_argument('--epochs', type=int, default=3); ap.add_argument('--lr', type=float, default=3e-5)
    ap.add_argument('--batch', type=int, default=32); ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--checks-per-epoch', type=int, default=2); ap.add_argument('--max-steps', type=int, default=0)
    a = ap.parse_args()
    q = json.load(open(a.qualification)); au = json.load(open(a.authorization))
    if q.get('status') != 'qualified' or au.get('approved') is not True or au.get('format') != 'chatsop-training-authorization-v1':
        raise SystemExit('refusing: qualification not qualified or authorization receipt missing')
    random.seed(a.seed); torch.manual_seed(a.seed)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    tok = MarianTokenizer.from_pretrained(a.base)
    model = MarianMTModel.from_pretrained(a.base, dtype=torch.float32).cuda()
    train, dev = read(Path(a.data) / 'train.jsonl'), read(Path(a.data) / 'dev.jsonl')
    nat = read(a.natural)

    def enc(r):
        return {'input_ids': tok(r['source'], truncation=True, max_length=400)['input_ids'], 'labels': tok(text_target=r['target'], truncation=True, max_length=400)['input_ids']}
    et, ed = [enc(r) for r in train], [enc(r) for r in dev]
    pad = tok.pad_token_id

    def collate(b):
        s = max(len(x['input_ids']) for x in b); t = max(len(x['labels']) for x in b)
        return {'input_ids': torch.tensor([x['input_ids'] + [pad] * (s - len(x['input_ids'])) for x in b]),
                'attention_mask': torch.tensor([[1] * len(x['input_ids']) + [0] * (s - len(x['input_ids'])) for x in b]),
                'labels': torch.tensor([x['labels'] + [-100] * (t - len(x['labels'])) for x in b])}
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr, weight_decay=0.01)
    steps_ep = math.ceil(len(et) / a.batch); total = steps_ep * a.epochs
    if a.max_steps: total = min(total, a.max_steps)
    warm = max(1, int(0.05 * total))
    check_at = {round(steps_ep * q_ / a.checks_per_epoch) + steps_ep * e for e in range(a.epochs) for q_ in range(1, a.checks_per_epoch + 1)}

    def dev_loss():
        model.eval(); tl = 0.; n = 0
        with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16):
            for b in DataLoader(ed, batch_size=64, collate_fn=collate):
                b = {k: v.cuda() for k, v in b.items()}; m = int((b['labels'] != -100).sum())
                tl += float(model(**b).loss) * m; n += m
        model.train(); return tl / n

    def decode(texts):
        model.eval(); res = [None] * len(texts); order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
        with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16):
            for k in range(0, len(order), 32):
                idx = order[k:k + 32]
                e = tok([texts[i] for i in idx], return_tensors='pt', padding=True, truncation=True, max_length=400).to('cuda')
                g = model.generate(**e, num_beams=1, do_sample=False, max_new_tokens=400)
                for i, o in zip(idx, tok.batch_decode(g, skip_special_tokens=True)): res[i] = o
        model.train(); return res

    def has(out, t):
        import re
        return re.search(r'(?<![\w])' + re.escape(t) + r'(?![\w])', out, re.I) is not None
    rs = random.Random(7); dsample = rs.sample(dev, min(200, len(dev)))
    jd = [r for r in dsample if r.get('terms')]
    checks = []; best = None; bad = 0; log = open(out / 'train-log.jsonl', 'a')

    def check(step, label):
        nonlocal best, bad
        dl = dev_loss(); outs = decode([r['source'] for r in dsample]); omap = dict(zip([r['id'] for r in dsample], outs))
        kept = sum(has(omap[r['id']], t) for r in jd for t in r['terms']); tot = sum(len(r['terms']) for r in jd)
        exact = sum(omap[r['id']].strip() == r['target'].strip() for r in dsample)
        clean_same = [r for r in dsample if r.get('clean')]
        nout = decode([r['text'] for r in nat])
        rec = {'step': step, 'label': label, 'dev_loss': dl, 'dev_jargon_kept': kept, 'dev_jargon_total': tot, 'dev_exact': exact, 'dev_sample': len(dsample), 'natural_nonempty': sum(bool(o.strip()) for o in nout), 'natural_n': len(nat), 'seconds': round(time.time() - t0, 1)}
        checks.append(rec); log.write(json.dumps(rec) + '\n'); log.flush(); print(json.dumps(rec), flush=True)
        (out / f'natural-check-{step:06d}.jsonl').write_text(''.join(json.dumps({'id': r['id'], 'out': o}, ensure_ascii=False) + '\n' for r, o in zip(nat, nout)))
        if best is None or dl < best:
            best = dl; bad = 0
            tmp = out / 'best.partial'; shutil.rmtree(tmp, ignore_errors=True); model.save_pretrained(tmp, safe_serialization=True); tok.save_pretrained(tmp)
            shutil.rmtree(out / 'best', ignore_errors=True); tmp.rename(out / 'best'); (out / 'best.json').write_text(json.dumps(rec))
        else: bad += 1
        # stopping rules (preregistered): fail if after epoch 1 the jargon retention is below 50% or the natural sample is mostly empty; plateau if dev loss rose at 2 consecutive checks
        if step >= steps_ep and (tot and kept < 0.5 * tot or rec['natural_nonempty'] < 0.5 * len(nat)): return 'failing'
        if bad >= 2: return 'plateau'
        return None
    t0 = time.time(); step = 0; model.train(); stop = None
    check(0, 'base (step 0)')
    for ep in range(a.epochs):
        g = torch.Generator().manual_seed(a.seed + ep)
        for b in DataLoader(et, batch_size=a.batch, shuffle=True, generator=g, collate_fn=collate):
            if step >= total: break
            b = {k: v.cuda() for k, v in b.items()}
            with torch.autocast('cuda', dtype=torch.bfloat16): loss = model(**b).loss
            if not torch.isfinite(loss): raise RuntimeError('non-finite loss')
            loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            step += 1
            f = min(1., step / warm) * max(0.05, (total - step) / max(1, total - warm))
            for gr in opt.param_groups: gr['lr'] = a.lr * f
            opt.step(); opt.zero_grad(set_to_none=True)
            if step % 50 == 0: print(json.dumps({'step': step, 'loss': float(loss), 'seconds': round(time.time() - t0)}), flush=True)
            if step in check_at:
                stop = check(step, f'epoch {ep + 1}'); 
                if stop: break
        if stop or step >= total: break
    if not stop and step not in check_at: check(step, 'final')
    json.dump({'steps': step, 'total_steps': total, 'stopped': stop, 'best_dev_loss': best, 'checks': checks, 'seconds': time.time() - t0, 'finished_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, open(out / 'summary.json', 'w'), indent=1)


if __name__ == '__main__': main()
