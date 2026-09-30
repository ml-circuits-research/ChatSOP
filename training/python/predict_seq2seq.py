#!/usr/bin/env python3
"""Greedy predictions of a seq2seq formalizer checkpoint (experiment formalizer-mt-v1, DS007).

Reads only each suite row's `id` and `question` (never a gold field): the encoder input is the message and nothing
else (DS021). Writes `{id, sop}` rows for `node eval/run.mjs --predictions` and a timing file. Two backends:
`transformers` (CUDA for bulk evaluation, or CPU) and `ctranslate2` (a converted int8 model, CPU speed only).
Bulk runs decode length-sorted batches; `--batch 1` decodes one message at a time for latency. The generation budget
is min(max_new_tokens, 4 x message tokens + 256), the preregistered cap; a row that reaches it is listed as capped.

  predict_seq2seq.py --checkpoint models/opus-mt/<run>/formalizer/best --suite SUITE.jsonl \\
    --out predictions.jsonl --timing timing.json [--device cuda|cpu] [--threads 8] [--sample 50 --seed 42] [--batch 1]
    [--backend ctranslate2 --ct2-model DIR]
"""
import argparse,json,time,statistics,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import iter_jsonl,load_seq2seq_tokenizer
from seq2seq_text import encode_source,decode_target

def mulberry32_sample(rows,count,seed):
    """Same deterministic sample as tools/research/predict-endpoint.mjs sampleRows (mulberry32 shuffle, suite order)."""
    if not count or count>=len(rows):return rows
    state=seed&0xFFFFFFFF
    def imul(a,b):return (a*b)&0xFFFFFFFF
    def rnd():
        nonlocal state
        state=(state+0x6D2B79F5)&0xFFFFFFFF;t=state
        t=imul(t^(t>>15),t|1)
        t=(t^((t+imul(t^(t>>7),t|61))&0xFFFFFFFF))&0xFFFFFFFF
        return ((t^(t>>14))&0xFFFFFFFF)/4294967296
    index=list(range(len(rows)))
    for i in range(len(index)-1,0,-1):
        j=int(rnd()*(i+1));index[i],index[j]=index[j],index[i]
    return [rows[i] for i in sorted(index[:count])]

def quantiles(values):
    s=sorted(values);at=lambda q:s[min(len(s)-1,int(q*len(s)))] if s else None
    return {'count':len(s),'mean':statistics.fmean(s) if s else None,'p50':at(.5),'p95':at(.95),'max':s[-1] if s else None}

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--checkpoint',required=True);p.add_argument('--suite',required=True);p.add_argument('--out',required=True);p.add_argument('--timing',required=True)
    p.add_argument('--device',choices=['cuda','cpu'],default='cuda');p.add_argument('--threads',type=int,default=8)
    p.add_argument('--sample',type=int,default=0);p.add_argument('--seed',type=int,default=42);p.add_argument('--ids')
    p.add_argument('--batch',type=int,default=64);p.add_argument('--token-budget',type=int,default=262144);p.add_argument('--max-new-tokens',type=int,default=4096)
    p.add_argument('--backend',choices=['transformers','ctranslate2'],default='transformers');p.add_argument('--ct2-model');p.add_argument('--label',default='')
    a=p.parse_args()
    folder=Path(a.checkpoint);cfg={'max_source_length':10**9}
    tok=load_seq2seq_tokenizer(folder/'tokenizer' if (folder/'tokenizer').exists() else folder,cfg)
    rows=[{'id':r['id'],'question':r['question']} for r in iter_jsonl(a.suite)]
    if a.ids:
        wanted=set(Path(a.ids).read_text().split());rows=[r for r in rows if r['id'] in wanted]
    rows=mulberry32_sample(rows,a.sample,a.seed)
    sources=[tok(encode_source(r['question']))['input_ids'] for r in rows]
    import torch
    torch.set_num_threads(a.threads)
    if a.backend=='transformers':
        from transformers import AutoModelForSeq2SeqLM
        model=AutoModelForSeq2SeqLM.from_pretrained(folder/'model' if (folder/'model').exists() else folder,local_files_only=True).to(a.device).eval()
        limit=model.config.max_position_embeddings
    else:
        import ctranslate2
        translator=ctranslate2.Translator(a.ct2_model,device='cpu',compute_type='int8',intra_threads=a.threads,inter_threads=1)
        limit=4096
    order=sorted(range(len(rows)),key=lambda i:len(sources[i]))
    out={};capped=[];latency=[];generated_tokens=[];start=time.perf_counter();pos=0
    while pos<len(order):
        size=1
        while size<a.batch and pos+size<len(order) and (size+1)*(4*len(sources[order[pos+size]])+256)<=a.token_budget:size+=1
        chunk=order[pos:pos+size];pos+=size;length=max(len(sources[i]) for i in chunk)
        budget=min(a.max_new_tokens,4*length+256,limit-1)
        t0=time.perf_counter()
        if a.backend=='transformers':
            ids=torch.tensor([sources[i]+[tok.pad_token_id]*(length-len(sources[i])) for i in chunk],device=a.device)
            mask=torch.tensor([[1]*len(sources[i])+[0]*(length-len(sources[i])) for i in chunk],device=a.device)
            with torch.inference_mode(),(torch.autocast('cuda',dtype=torch.bfloat16) if a.device=='cuda' else torch.autocast('cpu',enabled=False)):
                gen=model.generate(input_ids=ids,attention_mask=mask,do_sample=False,num_beams=1,max_new_tokens=budget,pad_token_id=tok.pad_token_id)
            seqs=[gen[k].tolist() for k in range(len(chunk))]
            texts=[tok.decode(s,skip_special_tokens=True) for s in seqs]
            counts=[sum(1 for x in s[1:] if x!=tok.pad_token_id) for s in seqs]
            hit=[tok.eos_token_id not in s[1:] for s in seqs]
        else:
            res=translator.translate_batch([tok.convert_ids_to_tokens(sources[i]) for i in chunk],beam_size=1,max_decoding_length=budget,return_end_token=True)
            toks=[r.hypotheses[0] for r in res]
            texts=[tok.convert_tokens_to_string([t for t in ts if t not in ('</s>','<pad>')]) for ts in toks]
            counts=[len(ts) for ts in toks];hit=[ts[-1:]!=['</s>'] for ts in toks]
        seconds=time.perf_counter()-t0
        for k,i in enumerate(chunk):
            out[i]=decode_target(texts[k]);generated_tokens.append(counts[k])
            if hit[k]:capped.append(rows[i]['id'])
        if len(chunk)==1:latency.append(seconds)
        print(json.dumps({'done':len(out),'of':len(rows),'batch':len(chunk),'seconds':round(seconds,2)}),flush=True)
    wall=time.perf_counter()-start
    Path(a.out).parent.mkdir(parents=True,exist_ok=True)
    Path(a.out).write_text(''.join(json.dumps({'id':r['id'],'sop':out[i]},ensure_ascii=False)+'\n' for i,r in enumerate(rows)),encoding='utf-8')
    Path(a.timing).write_text(json.dumps({'label':a.label,'backend':a.backend,'device':a.device,'threads':a.threads,'rows':len(rows),'batch':a.batch,
        'wall_seconds':wall,'generated_tokens':sum(generated_tokens),'generated_tokens_per_second':sum(generated_tokens)/wall if wall else None,
        'latency_seconds_single_stream':quantiles(latency) if latency else None,'capped':capped,'checkpoint':str(folder.resolve()),
        'torch':torch.__version__,'measured_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},indent=2)+'\n')
if __name__=='__main__':main()
