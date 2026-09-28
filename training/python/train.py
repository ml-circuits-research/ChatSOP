#!/usr/bin/env python3
"""Response-only supervised fine-tuning with two separate LoRA runs.

Uses PyTorch already supplied by the DGX Spark container. No bitsandbytes,
FlashAttention, TRL, datasets, or custom CUDA kernel is required by this script.
"""
from __future__ import annotations
import argparse, json, math, random, time, shutil, subprocess, os
from pathlib import Path
from common import read_training_rows,sha_file,write_json,encode_row

def arguments():
    p=argparse.ArgumentParser()
    p.add_argument('--role',choices=['formalizer','verbalizer','shared'],required=True)
    p.add_argument('--config',required=True)
    p.add_argument('--data',required=True);p.add_argument('--output',required=True)
    p.add_argument('--base',required=True)
    p.add_argument('--identity',required=True)
    p.add_argument('--max-steps',type=int,default=0);p.add_argument('--resume',action='store_true')
    p.add_argument('--full',action='store_true');p.add_argument('--cpu',action='store_true')
    return p.parse_args()

def main():
    a=arguments();cfg=json.loads(Path(a.config).read_text());roles=['formalizer','verbalizer'] if a.role=='shared' else [a.role]
    files={split:[Path(a.data)/r/(split+'.jsonl') for r in roles] for split in ['train','dev']}
    data={s:[row for r in roles for row in read_training_rows(a.data,r,s)] for s in files}
    if not data['train'] or not data['dev']: raise ValueError('Nonempty train and dev data required')
    hashes={str(f):sha_file(f) for fs in files.values() for f in fs}
    out=Path(a.output)
    import torch
    from torch.utils.data import DataLoader
    from transformers import AutoModelForCausalLM,AutoTokenizer
    from peft import LoraConfig,get_peft_model,PeftModel
    seed=cfg.get('seed',42);random.seed(seed);torch.manual_seed(seed)
    device='cpu' if a.cpu else 'cuda'
    if device=='cuda' and not torch.cuda.is_available():raise RuntimeError('CUDA unavailable. Run node training/cli.mjs preflight, or explicitly request --cpu.')
    dtype=torch.bfloat16 if device=='cuda' else torch.float32
    if device=='cuda' and not torch.cuda.is_bf16_supported(): raise RuntimeError('This recipe expects BF16 on the GPU.')
    resume_file=out/'latest'/'state.json'
    prior=json.loads(resume_file.read_text()) if a.resume else None
    pinned=json.loads((Path(a.base)/'recall-model-lock.json').read_text())
    model_id,revision=pinned['model_id'],pinned['revision']
    identity=json.loads(Path(a.identity).read_text())
    if (identity['dataset_sha256']!=hashes or identity['recipe_sha256']!=sha_file(a.config)
        or identity['model_id']!=model_id or identity['revision']!=revision
        or identity['role']!=a.role or identity['full']!=a.full
        or identity['max_steps']!=a.max_steps or identity['device']!=device):
        raise ValueError('Run identity differs from recipe, dataset, base, mode or role; do not write artifacts')
    if prior and (prior['dataset_sha256']!=hashes or prior['role']!=a.role or prior['model_id']!=model_id or prior['revision']!=revision or prior['full']!=a.full):raise ValueError('Resume identity mismatch')
    thresholds=identity['resource_thresholds']
    warned_disk=False
    def resource_guard(initial=False):
        nonlocal warned_disk
        disk=os.statvfs(out);free_disk=disk.f_bavail*disk.f_frsize/2**30
        required_disk=thresholds['min_disk_gib'] if initial else thresholds['stop_disk_gib']
        if free_disk<required_disk:raise RuntimeError(f'Disk {free_disk:.1f} GiB below floor {required_disk} GiB; stopping this owned run')
        if free_disk<thresholds['warn_disk_gib'] and not warned_disk:
            print(json.dumps({'warning':'disk headroom','free_gib':round(free_disk,1),'floor_gib':thresholds['stop_disk_gib']}),flush=True)
            warned_disk=True
        available_line=next((line for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')),None)
        if available_line is None:raise RuntimeError('Cannot measure host MemAvailable; stopping this owned run')
        available=int(available_line.split()[1])/2**20
        required_host=thresholds['min_host_gib'] if initial else thresholds['stop_host_gib']
        if available<required_host:raise RuntimeError(f'Host available {available:.1f} GiB below floor {required_host} GiB')
        if device=='cuda':
            free_cuda,_=torch.cuda.mem_get_info()
            if free_cuda<thresholds['min_cuda_gib']*2**30:
                raise RuntimeError(f'CUDA driver free {free_cuda/2**30:.1f} GiB below floor {thresholds["min_cuda_gib"]} GiB; no automatic cache pressure')
        return {'disk_gib':round(free_disk,1),'host_available_gib':round(available,1),'cuda_driver_free_gib':round(free_cuda/2**30,1) if device=='cuda' else None}
    resource_guard(initial=True)
    kwargs={'local_files_only':True,'trust_remote_code':False}
    tok=AutoTokenizer.from_pretrained(a.base,**kwargs)
    if tok.pad_token_id is None: tok.pad_token=tok.eos_token
    encoded={s:[encode_row(tok,row,cfg['max_length']) for row in rows] for s,rows in data.items()}
    write_json(out/'tokenization.json',{s:{'rows':len(rows),'max_tokens':max(len(x['input_ids']) for x in rows),'supervised_tokens':sum(sum(v!=-100 for v in x['labels']) for x in rows)} for s,rows in encoded.items()})
    source=out/'latest'/'model' if a.full and a.resume else a.base
    base=AutoModelForCausalLM.from_pretrained(source,torch_dtype=dtype,attn_implementation=cfg.get('attention','sdpa'),**kwargs)
    if a.full:
        model=base
    else:
        if a.resume:model=PeftModel.from_pretrained(base,out/'latest'/'adapter',is_trainable=True)
        else:model=get_peft_model(base,LoraConfig(r=cfg.get('rank',16),lora_alpha=cfg.get('alpha',32),lora_dropout=cfg.get('dropout',0.05),target_modules='all-linear',bias='none',task_type='CAUSAL_LM'))
    resource_guard()
    model.to(device);model.config.use_cache=False
    if cfg.get('gradient_checkpointing',True):
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant':False})
        if hasattr(model,'enable_input_require_grads'):model.enable_input_require_grads()
    params=[p for p in model.parameters() if p.requires_grad]
    optimizer=torch.optim.AdamW(params,lr=cfg['full_lr'] if a.full else cfg['lr'],weight_decay=cfg.get('weight_decay',0.01))
    if a.resume:optimizer.load_state_dict(torch.load(out/'latest'/'optimizer.pt',map_location=device,weights_only=True))
    if a.resume:
        rng=torch.load(out/'latest'/'rng.pt',map_location='cpu',weights_only=True)
        torch.set_rng_state(rng['cpu'])
        if device=='cuda':
            if len(rng['cuda'])!=torch.cuda.device_count():raise ValueError('Resume CUDA device count mismatch')
            torch.cuda.set_rng_state_all(rng['cuda'])
    def collate(batch):
        length=max(len(x['input_ids']) for x in batch)
        return {k:torch.tensor([x[k]+([tok.pad_token_id] if k=='input_ids' else [-100] if k=='labels' else [0])*(length-len(x[k])) for x in batch],dtype=torch.long) for k in ['input_ids','attention_mask','labels']}
    batch=cfg.get('batch_size',2);accum=cfg.get('gradient_accumulation',8);epochs=cfg.get('epochs',3)
    devloader=DataLoader(encoded['dev'],batch_size=batch,collate_fn=collate,shuffle=False)
    batches=math.ceil(len(encoded['train'])/batch);total=math.ceil(batches/accum)*epochs
    if a.max_steps:total=min(total,a.max_steps)
    state={'role':a.role,'model_id':model_id,'revision':revision,'dataset_sha256':hashes,'step':0,'epoch':0,'next_batch':0,'best_dev_loss':None,'best_semantic_score':None,'last_semantic_step':None,'full':a.full}
    if prior:
        if prior.get('full')!=a.full:raise ValueError('Cannot resume LoRA as full tuning, or vice versa')
        state.update(prior)
    write_json(out/'run.json',{'config':cfg,'role':a.role,'model_id':model_id,'revision':revision,'torch':torch.__version__,'cuda':torch.version.cuda,'device':device,'trainable_parameters':sum(p.numel() for p in params),'total_parameters':sum(p.numel() for p in model.parameters()),'dataset_sha256':hashes,'notice':'Semantic acceptance is assessed separately; loss is not conversational accuracy.'})
    def checkpoint(name):
        resource_guard()
        folder=out/name;tmp=out/(name+'.partial');old=out/(name+'.previous')
        if tmp.exists():shutil.rmtree(tmp)
        tmp.mkdir(parents=True)
        model.save_pretrained(tmp/('model' if a.full else 'adapter'),safe_serialization=True)
        tok.save_pretrained(tmp/'tokenizer')
        if name=='latest':torch.save(optimizer.state_dict(),tmp/'optimizer.pt')
        torch.save({'cpu':torch.get_rng_state(),'cuda':torch.cuda.get_rng_state_all() if device=='cuda' else []},tmp/'rng.pt')
        write_json(tmp/'state.json',state)
        artifacts={str(p.relative_to(tmp)):sha_file(p) for p in tmp.rglob('*') if p.is_file()}
        write_json(tmp/'checkpoint.json',{'complete':True,'step':state['step'],'role':state['role'],'artifacts':artifacts})
        if old.exists():shutil.rmtree(old)
        if folder.exists():folder.rename(old)
        tmp.rename(folder)
        if old.exists():shutil.rmtree(old)
    def dev_loss():
        resource_guard()
        model.eval();total_loss=0.;tokens=0
        with torch.no_grad():
            for i,b in enumerate(devloader):
                if i%8==0:resource_guard()
                b={k:v.to(device) for k,v in b.items()};n=int((b['labels']!=-100).sum());loss=model(**b).loss
                if not torch.isfinite(loss):raise RuntimeError('Non-finite dev loss')
                total_loss+=float(loss)*n;tokens+=n
        model.train();return total_loss/max(tokens,1)
    def semantic_select():
        if a.role!='formalizer' or state['step']==state['last_semantic_step']:return
        resource_guard()
        model.eval()
        predictions=[]
        with torch.inference_mode():
            for i,row in enumerate(data['dev']):
                if i%16==0:resource_guard()
                ids=tok.apply_chat_template([{'role':'user','content':row['prompt']}],tokenize=True,add_generation_prompt=True,enable_thinking=False,return_tensors='pt',return_dict=False).to(device)
                budget=min(1024,cfg['max_length']-ids.shape[-1])
                if budget<1:raise ValueError(f"No generation space for dev row {row['id']}")
                generated=model.generate(input_ids=ids,attention_mask=torch.ones_like(ids),do_sample=False,max_new_tokens=budget,pad_token_id=tok.pad_token_id,use_cache=True)
                predictions.append({'id':row['id'],'sop':tok.decode(generated[0,ids.shape[-1]:],skip_special_tokens=True)})
        model.train()
        reports=out/'semantic';reports.mkdir(parents=True,exist_ok=True)
        stem=f"step-{state['step']:08d}"
        pred=reports/(stem+'.predictions.jsonl');tmp=reports/(stem+'.predictions.partial')
        tmp.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in predictions),encoding='utf-8')
        tmp.replace(pred)
        report=reports/(stem+'.json')
        subprocess.run(['node',str(Path(__file__).resolve().parents[2]/'eval'/'run.mjs'),'--file',str(Path(a.data)/'formalizer'/'dev.jsonl'),'--predictions',str(pred),'--out',str(report)],check=True)
        result=json.loads(report.read_text(encoding='utf-8'))
        if not result['evaluation_valid']:raise RuntimeError(f'Semantic dev evaluation invalid: {report}')
        equivalent=result['metrics']['execution_equivalence'];syntax=result['metrics']['syntax']
        if equivalent['denominator']!=len(predictions) or syntax['denominator']!=len(predictions):raise RuntimeError(f'Semantic dev denominator mismatch: {report}')
        score=[equivalent['numerator'],syntax['numerator']]
        previous=state['best_semantic_score']
        state['last_semantic_step']=state['step']
        if previous is None or score>previous:
            state['best_semantic_score']=score;checkpoint('best')
        print(json.dumps({'step':state['step'],'semantic_dev':score,'dev_rows':len(predictions),'report':str(report)}),flush=True)
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
                    torch.nn.utils.clip_grad_norm_(params,cfg.get('max_grad_norm',1.0),error_if_nonfinite=True)
                    warmup=max(1,int(total*cfg.get('warmup_fraction',0.05)));step=state['step']+1
                    factor=min(1.,step/warmup)*max(0.05,(total-step)/max(1,total-warmup))
                    for group in optimizer.param_groups:group['lr']=(cfg['full_lr'] if a.full else cfg['lr'])*factor
                    resource_guard()
                    optimizer.step();optimizer.zero_grad(set_to_none=True);state.update(step=step,epoch=epoch,next_batch=i+1)
                    if step%cfg.get('log_every',10)==0:print(json.dumps({'step':step,'loss':last_loss,'seconds':round(time.time()-start,2)}),flush=True)
                    if step%cfg.get('save_every',100)==0:
                        semantic_select();checkpoint('latest')
            val=dev_loss();print(json.dumps({'epoch':epoch,'dev_loss':val,'step':state['step']}),flush=True)
            if state['best_dev_loss'] is None or val<state['best_dev_loss']:
                state['best_dev_loss']=val
                if a.role!='formalizer':checkpoint('best')
            semantic_select()
            if state['step']>=total:checkpoint('latest');break
            state.update(epoch=epoch+1,next_batch=0);checkpoint('latest')
    except KeyboardInterrupt:
        # Do not snapshot partially accumulated gradients or partially updated optimizer state.
        print('Interrupted: resume from the last completed checkpoint; unsaved steps replay.')
        return
    write_json(out/'summary.json',{'optimizer_steps':state['step'],'best_dev_loss':state['best_dev_loss'],'best_semantic_score':state['best_semantic_score'],'seconds':time.time()-start,'training_finished_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'training_completed':True,'neural_test_accuracy':None,'selection':'dev execution equivalence; syntax tiebreak' if a.role=='formalizer' else 'dev loss diagnostic only','notice':'Sealed holdout and human review remain required before promotion; verbalizer has no automatic faithfulness selection.'})

if __name__=='__main__':main()
