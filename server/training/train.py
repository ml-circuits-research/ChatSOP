#!/usr/bin/env python3
"""Response-only supervised fine-tuning with two separate LoRA runs.

Uses PyTorch already supplied by the DGX Spark container. No bitsandbytes,
FlashAttention, TRL, datasets, or custom CUDA kernel is required by this script.
"""
from __future__ import annotations
import argparse, json, math, random, time, os, sys
from pathlib import Path
from common import read_jsonl,sha_file,write_json,encode_row,resolve_revision

def arguments():
    p=argparse.ArgumentParser()
    p.add_argument('--role',choices=['formalizer','verbalizer','shared'],required=True)
    p.add_argument('--config',default='config/train-gemma.json')
    p.add_argument('--data',default='data/generated');p.add_argument('--output')
    p.add_argument('--max-steps',type=int,default=0);p.add_argument('--resume',action='store_true')
    p.add_argument('--full',action='store_true');p.add_argument('--cpu',action='store_true')
    p.add_argument('--offline',action='store_true');p.add_argument('--dry-run',action='store_true')
    return p.parse_args()

def main():
    a=arguments();cfg=json.loads(Path(a.config).read_text());roles=['formalizer','verbalizer'] if a.role=='shared' else [a.role]
    files={split:[Path(a.data)/r/(split+'.jsonl') for r in roles] for split in ['train','dev']}
    data={s:[row for f in fs for row in read_jsonl(f)] for s,fs in files.items()}
    if not data['train'] or not data['dev']: raise ValueError('Nonempty train and dev data required')
    hashes={str(f):sha_file(f) for fs in files.values() for f in fs}
    out=Path(a.output or 'outputs/'+a.role)
    if a.dry_run:
        print(json.dumps({'role':a.role,'rows':{s:len(r) for s,r in data.items()},'files':hashes,'config':cfg,'training_executed':False},indent=2));return
    import torch
    from torch.utils.data import DataLoader
    from transformers import AutoModelForCausalLM,AutoTokenizer
    from peft import LoraConfig,get_peft_model,PeftModel
    seed=cfg.get('seed',42);random.seed(seed);torch.manual_seed(seed)
    device='cpu' if a.cpu else 'cuda'
    if device=='cuda' and not torch.cuda.is_available():raise RuntimeError('CUDA unavailable. Run scripts/spark-shell.sh and training/preflight.py, or explicitly request --cpu.')
    dtype=torch.bfloat16 if device=='cuda' else torch.float32
    if device=='cuda' and not torch.cuda.is_bf16_supported(): raise RuntimeError('This recipe expects BF16 on the GPU.')
    resume_file=out/'latest'/'state.json'
    if out.exists() and not a.resume and any(out.iterdir()):raise ValueError('Output directory is not empty. Use a new directory or --resume.')
    prior=json.loads(resume_file.read_text()) if a.resume else None
    if a.resume and (prior['dataset_sha256']!=hashes or prior['role']!=a.role):raise ValueError('Resume dataset or role mismatch')
    if a.resume:
        model_id,revision=prior['model_id'],prior['revision']
    else:model_id,revision=resolve_revision(cfg['model_id'],cfg.get('revision','main'),a.offline)
    kwargs={'revision':revision,'token':os.getenv('HF_TOKEN'),'local_files_only':a.offline,'trust_remote_code':False}
    tok=AutoTokenizer.from_pretrained(model_id,**kwargs)
    if tok.pad_token_id is None: tok.pad_token=tok.eos_token
    encoded={s:[encode_row(tok,row,cfg['max_length']) for row in rows] for s,rows in data.items()}
    write_json(out/'tokenization.json',{s:{'rows':len(rows),'max_tokens':max(len(x['input_ids']) for x in rows),'supervised_tokens':sum(sum(v!=-100 for v in x['labels']) for x in rows)} for s,rows in encoded.items()})
    base=AutoModelForCausalLM.from_pretrained(model_id,torch_dtype=dtype,attn_implementation=cfg.get('attention','sdpa'),**kwargs)
    if a.full:
        if a.resume: base=AutoModelForCausalLM.from_pretrained(out/'latest'/'model',torch_dtype=dtype,attn_implementation=cfg.get('attention','sdpa'))
        model=base
    else:
        if a.resume:model=PeftModel.from_pretrained(base,out/'latest'/'adapter',is_trainable=True)
        else:model=get_peft_model(base,LoraConfig(r=cfg.get('rank',16),lora_alpha=cfg.get('alpha',32),lora_dropout=cfg.get('dropout',0.05),target_modules='all-linear',bias='none',task_type='CAUSAL_LM'))
    model.to(device);model.config.use_cache=False
    if cfg.get('gradient_checkpointing',True):
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant':False})
        if hasattr(model,'enable_input_require_grads'):model.enable_input_require_grads()
    params=[p for p in model.parameters() if p.requires_grad]
    optimizer=torch.optim.AdamW(params,lr=cfg['full_lr'] if a.full else cfg['lr'],weight_decay=cfg.get('weight_decay',0.01))
    if a.resume:optimizer.load_state_dict(torch.load(out/'latest'/'optimizer.pt',map_location=device,weights_only=True))
    def collate(batch):
        length=max(len(x['input_ids']) for x in batch)
        return {k:torch.tensor([x[k]+([tok.pad_token_id] if k=='input_ids' else [-100] if k=='labels' else [0])*(length-len(x[k])) for x in batch],dtype=torch.long) for k in ['input_ids','attention_mask','labels']}
    batch=cfg.get('batch_size',2);accum=cfg.get('gradient_accumulation',8);epochs=cfg.get('epochs',3)
    devloader=DataLoader(encoded['dev'],batch_size=batch,collate_fn=collate,shuffle=False)
    batches=math.ceil(len(encoded['train'])/batch);total=math.ceil(batches/accum)*epochs
    if a.max_steps:total=min(total,a.max_steps)
    state={'role':a.role,'model_id':model_id,'revision':revision,'dataset_sha256':hashes,'step':0,'epoch':0,'next_batch':0,'best_dev_loss':None,'full':a.full}
    if prior:
        if prior.get('full')!=a.full:raise ValueError('Cannot resume LoRA as full tuning, or vice versa')
        state.update(prior)
    write_json(out/'run.json',{'config':cfg,'role':a.role,'model_id':model_id,'revision':revision,'torch':torch.__version__,'cuda':torch.version.cuda,'device':device,'trainable_parameters':sum(p.numel() for p in params),'total_parameters':sum(p.numel() for p in model.parameters()),'dataset_sha256':hashes,'notice':'Semantic acceptance is assessed separately; loss is not conversational accuracy.'})
    def checkpoint(folder):
        folder=out/folder;folder.mkdir(parents=True,exist_ok=True)
        model.save_pretrained(folder/('model' if a.full else 'adapter'),safe_serialization=True);tok.save_pretrained(folder/'tokenizer')
        write_json(folder/'state.json',state)
        if folder.name=='latest':torch.save(optimizer.state_dict(),folder/'optimizer.pt')
    def dev_loss():
        model.eval();total_loss=0.;tokens=0
        with torch.no_grad():
            for b in devloader:
                b={k:v.to(device) for k,v in b.items()};n=int((b['labels']!=-100).sum());loss=model(**b).loss
                total_loss+=float(loss)*n;tokens+=n
        model.train();return total_loss/max(tokens,1)
    start=time.time();model.train();optimizer.zero_grad(set_to_none=True);last_loss=0.
    try:
        for epoch in range(state['epoch'],epochs):
            generator=torch.Generator().manual_seed(seed+epoch)
            loader=DataLoader(encoded['train'],batch_size=batch,shuffle=True,generator=generator,collate_fn=collate,num_workers=0)
            skip=state['next_batch'] if epoch==state['epoch'] else 0
            for i,b in enumerate(loader):
                if i<skip:continue
                if state['step']>=total:break
                b={k:v.to(device) for k,v in b.items()};group_start=(i//accum)*accum;group_size=min(accum,len(loader)-group_start)
                loss=model(**b).loss
                if not torch.isfinite(loss):raise RuntimeError('Non-finite loss; aborting without accepting a bad checkpoint')
                last_loss=float(loss.detach());(loss/group_size).backward()
                if (i+1)%accum==0 or i+1==len(loader):
                    torch.nn.utils.clip_grad_norm_(params,cfg.get('max_grad_norm',1.0))
                    warmup=max(1,int(total*cfg.get('warmup_fraction',0.05)));step=state['step']+1
                    factor=min(1.,step/warmup)*max(0.05,(total-step)/max(1,total-warmup))
                    for group in optimizer.param_groups:group['lr']=(cfg['full_lr'] if a.full else cfg['lr'])*factor
                    optimizer.step();optimizer.zero_grad(set_to_none=True);state.update(step=step,epoch=epoch,next_batch=i+1)
                    if step%cfg.get('log_every',10)==0:print(json.dumps({'step':step,'loss':last_loss,'seconds':round(time.time()-start,2)}),flush=True)
                    if step%cfg.get('save_every',100)==0:checkpoint('latest')
            val=dev_loss();print(json.dumps({'epoch':epoch,'dev_loss':val,'step':state['step']}),flush=True)
            if state['best_dev_loss'] is None or val<state['best_dev_loss']:state['best_dev_loss']=val;checkpoint('best')
            if state['step']>=total:checkpoint('latest');break
            state.update(epoch=epoch+1,next_batch=0);checkpoint('latest')
    except KeyboardInterrupt:
        # Do not save a partial accumulation as a completed optimizer step.
        checkpoint('latest');print('Saved latest completed-step metadata; resumed runs replay the interrupted accumulation.');return
    write_json(out/'summary.json',{'optimizer_steps':state['step'],'best_dev_loss':state['best_dev_loss'],'seconds':time.time()-start,'training_completed':True,'neural_test_accuracy':None,'note':'Run tools/evaluate-model.js on disjoint and human-reviewed tests before claiming success.'})

if __name__=='__main__':main()
