#!/usr/bin/env python3
"""Response-only supervised fine-tuning with two separate LoRA runs, or full fine-tuning.

A recipe with `architecture: "seq2seq"` fine-tunes an encoder-decoder translation model instead (experiment
formalizer-mt-v1): the encoder reads the message only and the decoder emits the line-encoded SOP target.

Uses PyTorch already supplied by the DGX Spark container. No bitsandbytes,
FlashAttention, TRL, datasets, or custom CUDA kernel is required by this script.
"""
from __future__ import annotations
import argparse, json, math, random, time, shutil, subprocess, os
from pathlib import Path
from common import read_training_rows,sha_file,write_json,encode_row,load_tokenizer,chat_ids,iter_jsonl,is_seq2seq,load_seq2seq_tokenizer,encode_seq2seq_row,seq2seq_source_ids
from seq2seq_text import decode_target
from contextlib import nullcontext

def arguments():
    p=argparse.ArgumentParser()
    p.add_argument('--role',choices=['formalizer','verbalizer','shared','proofreader'],required=True)
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
    # Semantic selection scores the development split only. The evaluator needs each row's setup and verification
    # context, which the projection 'formalizer'/'dev.jsonl' omits, so it reads the same split's corpus rows
    # <data>/dev.jsonl; fail closed unless both carry exactly the same row ids.
    selection_file=Path(a.data)/'dev.jsonl'
    if a.role=='formalizer':
        projected=sorted(row['id'] for row in iter_jsonl(Path(a.data)/'formalizer'/'dev.jsonl'))
        if projected!=sorted(row['id'] for row in iter_jsonl(selection_file)):
            raise ValueError(f'{selection_file} and the projection dev split differ; refusing semantic selection on other rows')
    out=Path(a.output)
    import torch
    from torch.utils.data import DataLoader
    from transformers import AutoModelForCausalLM,AutoModelForSeq2SeqLM,AutoConfig
    from peft import LoraConfig,get_peft_model,PeftModel
    seed=cfg.get('seed',42);random.seed(seed);torch.manual_seed(seed)
    device='cpu' if a.cpu else 'cuda'
    if device=='cuda' and not torch.cuda.is_available():raise RuntimeError('CUDA unavailable. Run node training/cli.mjs preflight, or explicitly request --cpu.')
    # Full fine-tuning keeps FP32 master weights and runs BF16 autocast on the GPU: pure BF16 weights would round away
    # small AdamW updates. LoRA keeps the BF16 base (its adapters are upcast by PEFT).
    dtype=torch.float32 if (a.full or device!='cuda') else torch.bfloat16
    amp=(lambda:torch.autocast('cuda',dtype=torch.bfloat16)) if (device=='cuda' and a.full) else nullcontext
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
            # TRAIN_CUDA_FREE_CHECK=host (explicit operator choice, recorded in run.json): on unified memory (GB10) the
            # driver's free figure excludes reclaimable page cache, so the run relies on the host MemAvailable floor above.
            if os.environ.get('TRAIN_CUDA_FREE_CHECK')!='host' and free_cuda<thresholds['min_cuda_gib']*2**30:
                raise RuntimeError(f'CUDA driver free {free_cuda/2**30:.1f} GiB below floor {thresholds["min_cuda_gib"]} GiB; no automatic cache pressure')
        return {'disk_gib':round(free_disk,1),'host_available_gib':round(available,1),'cuda_driver_free_gib':round(free_cuda/2**30,1) if device=='cuda' else None}
    resource_guard(initial=True)
    kwargs={'local_files_only':True,'trust_remote_code':False}
    s2s=is_seq2seq(cfg)
    if s2s and a.role!='formalizer':raise ValueError('The seq2seq recipe trains the formalizer role only')
    tok=load_seq2seq_tokenizer(a.base,cfg) if s2s else load_tokenizer(a.base,cfg)
    encoded={s:[encode_seq2seq_row(tok,row,cfg) if s2s else encode_row(tok,row,cfg['max_length']) for row in rows] for s,rows in data.items()}
    write_json(out/'tokenization.json',{s:{'rows':len(rows),'max_tokens':max(len(x['input_ids']) for x in rows),'max_label_tokens':max(sum(v!=-100 for v in x['labels']) for x in rows),'supervised_tokens':sum(sum(v!=-100 for v in x['labels']) for x in rows)} for s,rows in encoded.items()})
    source=out/'latest'/'model' if a.full and a.resume else a.base
    if s2s:
        # Marian's static sinusoidal position table is rebuilt at max_position_embeddings; its first rows must equal
        # the pinned base's table, so a longer message changes no position the base was trained on.
        config=AutoConfig.from_pretrained(source,local_files_only=True)
        extend=cfg.get('max_position_embeddings',config.max_position_embeddings)
        if extend<config.max_position_embeddings:raise ValueError('max_position_embeddings cannot shrink the base table')
        old=config.max_position_embeddings;config.max_position_embeddings=extend
        base=AutoModelForSeq2SeqLM.from_pretrained(source,config=config,dtype=dtype,ignore_mismatched_sizes=extend!=old,**kwargs)
        if extend!=old:
            from safetensors import safe_open
            with safe_open(str(Path(source)/'model.safetensors'),'pt') as f:
                for key in [k for k in f.keys() if k.endswith('embed_positions.weight')]:
                    new=base.get_parameter(key) if key in dict(base.named_parameters()) else base.state_dict()[key]
                    if not torch.equal(f.get_tensor(key).to(new.dtype),new[:old].detach().cpu()):raise ValueError(f'Extended {key} differs from the base table')
        if base.get_input_embeddings().weight.shape[0]!=len(tok):base.resize_token_embeddings(len(tok))
        base.generation_config.max_length=cfg['max_target_length'];base.generation_config.num_beams=1
        # The sinusoidal position tables are static in Marian: freeze them, so weight decay and updates never touch them.
        for name,parameter in base.named_parameters():
            if name.endswith('embed_positions.weight'):parameter.requires_grad_(False)
    else:
        base=AutoModelForCausalLM.from_pretrained(source,dtype=dtype,attn_implementation=cfg.get('attention','sdpa'),**kwargs)
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
        if s2s:
            # Encoder inputs and decoder labels are padded separately; the model shifts the labels into decoder inputs.
            src=max(len(x['input_ids']) for x in batch);tgt=max(len(x['labels']) for x in batch)
            return {'input_ids':torch.tensor([x['input_ids']+[tok.pad_token_id]*(src-len(x['input_ids'])) for x in batch],dtype=torch.long),
                'attention_mask':torch.tensor([[1]*len(x['input_ids'])+[0]*(src-len(x['input_ids'])) for x in batch],dtype=torch.long),
                'labels':torch.tensor([x['labels']+[-100]*(tgt-len(x['labels'])) for x in batch],dtype=torch.long)}
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
    write_json(out/'run.json',{'config':cfg,'role':a.role,'model_id':model_id,'revision':revision,'torch':torch.__version__,'cuda':torch.version.cuda,'device':device,'cuda_free_check':os.environ.get('TRAIN_CUDA_FREE_CHECK','cuda'),'precision':('fp32-master-bf16-autocast' if (a.full and device=='cuda') else str(dtype)),'transformers':__import__('transformers').__version__,'trainable_parameters':sum(p.numel() for p in params),'total_parameters':sum(p.numel() for p in model.parameters()),'dataset_sha256':hashes,'notice':'Semantic acceptance is assessed separately; loss is not conversational accuracy.'})
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
                b={k:v.to(device) for k,v in b.items()};n=int((b['labels']!=-100).sum())
                with amp():loss=model(**b).loss
                if not torch.isfinite(loss):raise RuntimeError('Non-finite dev loss')
                total_loss+=float(loss)*n;tokens+=n
        model.train();return total_loss/max(tokens,1)
    def greedy_decode(rows):
        """Greedy predictions {index: sop} for rows, in length-sorted batches with the capped generation budget."""
        prompts=[seq2seq_source_ids(tok,row['prompt'],cfg) if s2s else chat_ids(tok,row['prompt']) for row in rows]
        order=sorted(range(len(prompts)),key=lambda i:len(prompts[i]))
        width=cfg.get('generation_batch_size',1);decoded={};capped=set()
        model.config.use_cache=True
        with torch.inference_mode(),amp():
            # Batches grow while the rows are short: at most `width` rows and about `token_budget` tokens of prompt
            # plus an allowance of four times the prompt for the output, so long messages decode in small batches.
            token_budget=cfg.get('generation_token_budget',0);start=0
            while start<len(order):
                resource_guard()
                size=width
                if token_budget:
                    size=1
                    while size<width and start+size<len(order) and (size+1)*(4*len(prompts[order[start+size]])+256)<=token_budget:size+=1
                chunk=order[start:start+size];start+=size;length=max(len(prompts[i]) for i in chunk)
                # Selection caps each batch at four times its longest prompt plus 256 tokens (the same allowance as the
                # batch sizing; no gold target of the corpus is longer), so a row that never stops cannot hold a batch
                # for max_new_tokens steps. A capped row counts as a failure at every checkpoint alike.
                budget=min(cfg.get('max_new_tokens',1024),4*length+256,cfg['max_target_length'] if s2s else cfg['max_length']-length)
                if budget<1:raise ValueError(f"No generation space for dev row {rows[chunk[-1]]['id']}")
                if s2s:
                    # The encoder reads right-padded messages; the decoder output holds only the generated SOP.
                    ids=torch.tensor([prompts[i]+[tok.pad_token_id]*(length-len(prompts[i])) for i in chunk],dtype=torch.long,device=device)
                    mask=torch.tensor([[1]*len(prompts[i])+[0]*(length-len(prompts[i])) for i in chunk],dtype=torch.long,device=device)
                    generated=model.generate(input_ids=ids,attention_mask=mask,do_sample=False,num_beams=1,max_new_tokens=budget,pad_token_id=tok.pad_token_id,use_cache=True)
                    for row_index,i in enumerate(chunk):
                        decoded[i]=decode_target(tok.decode(generated[row_index],skip_special_tokens=True))
                        if tok.eos_token_id not in generated[row_index,1:].tolist():capped.add(i)
                else:
                    ids=torch.tensor([[tok.pad_token_id]*(length-len(prompts[i]))+prompts[i] for i in chunk],dtype=torch.long,device=device)
                    mask=torch.tensor([[0]*(length-len(prompts[i]))+[1]*len(prompts[i]) for i in chunk],dtype=torch.long,device=device)
                    generated=model.generate(input_ids=ids,attention_mask=mask,do_sample=False,max_new_tokens=budget,pad_token_id=tok.pad_token_id,use_cache=True)
                    for row_index,i in enumerate(chunk):decoded[i]=tok.decode(generated[row_index,length:],skip_special_tokens=True)
                print(json.dumps({'selection_rows_done':len(decoded),'of':len(order),'batch':len(chunk),'new_tokens':int(generated.shape[-1]-(0 if s2s else length))}),flush=True)
        model.config.use_cache=False
        model.train()
        greedy_decode.capped=capped
        return decoded
    def semantic_select():
        if a.role!='formalizer' or state['step']==state['last_semantic_step']:return
        resource_guard()
        model.eval()
        # Greedy decoding of the full development split in length-sorted batches; the output keeps the row order.
        decoded=greedy_decode(data['dev'])
        predictions=[{'id':row['id'],'sop':decoded[i]} for i,row in enumerate(data['dev'])]
        reports=out/'semantic';reports.mkdir(parents=True,exist_ok=True)
        stem=f"step-{state['step']:08d}"
        pred=reports/(stem+'.predictions.jsonl');tmp=reports/(stem+'.predictions.partial')
        tmp.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in predictions),encoding='utf-8')
        tmp.replace(pred)
        report=reports/(stem+'.json')
        subprocess.run(['node',str(Path(__file__).resolve().parents[2]/'eval'/'run.mjs'),'--file',str(selection_file),'--predictions',str(pred),'--out',str(report)],check=True)
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
    # Interim checks (owner rule of 2026-09-29, preregistered for formalizer-mt-v1): after each quarter of the first
    # epoch and at every epoch end, the development loss and a greedy decode of a fixed stratified development sample
    # (proportional by language x question type, seed-fixed) scored by eval/run.mjs for parse validity and tolerant
    # execution equivalence. The run stops early when, from the end of epoch 1 on, parse validity is below 50% or more
    # than half of the sample is empty or hits the generation cap (failing), or when a check improves neither the
    # tolerant count nor the development loss over the previous check (plateau: the current model is then selected).
    class EarlyStop(Exception):pass
    steps_per_epoch=math.ceil(batches/accum)
    check_rows=None;check_steps=set()
    if cfg.get('interim_check_rows') and a.role=='formalizer':
        strata={}
        for i,row in enumerate(data['dev']):strata.setdefault((str(row.get('language')),str(row.get('question_type'))),[]).append(i)
        n=min(cfg['interim_check_rows'],len(data['dev']));keys=sorted(strata)
        quota={k:n*len(strata[k])/len(data['dev']) for k in keys};take={k:int(quota[k]) for k in keys}
        for k in sorted(keys,key=lambda k:(-(quota[k]-take[k]),k))[:n-sum(take.values())]:take[k]+=1
        pick=random.Random(seed);check_rows=[]
        for k in keys:
            members=list(strata[k]);pick.shuffle(members);check_rows+=members[:take[k]]
        check_rows.sort()
        parts=cfg.get('interim_checks_first_epoch',4)
        check_steps={round(steps_per_epoch*q/parts) for q in range(1,parts)}
    state.setdefault('interim_checks',[])
    def interim_check(label):
        if check_rows is None:return
        resource_guard();val=dev_loss();model.eval()
        rows=[data['dev'][i] for i in check_rows];decoded=greedy_decode(rows);capped=greedy_decode.capped
        folder=out/'interim';folder.mkdir(parents=True,exist_ok=True)
        suite=folder/'sample.suite.jsonl'
        if not suite.exists():
            wanted={row['id'] for row in rows}
            suite.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in iter_jsonl(selection_file) if r['id'] in wanted),encoding='utf-8')
        stem=f"check-{state['step']:08d}";pred=folder/(stem+'.predictions.jsonl');report=folder/(stem+'.json')
        pred.write_text(''.join(json.dumps({'id':row['id'],'sop':decoded[i]},ensure_ascii=False)+'\n' for i,row in enumerate(rows)),encoding='utf-8')
        subprocess.run(['node',str(Path(__file__).resolve().parents[2]/'eval'/'run.mjs'),'--file',str(suite),'--predictions',str(pred),'--out',str(report)],check=True,stdout=subprocess.DEVNULL)
        m=json.loads(report.read_text(encoding='utf-8'))['metrics']
        epochs_done=state['step']/steps_per_epoch
        record={'label':label,'step':state['step'],'epochs_done':round(epochs_done,3),'dev_loss':val,'rows':len(rows),
            'parse':m['syntax']['numerator'],'tolerant':m['execution_equivalence_tolerant']['numerator'],
            'empty':sum(1 for i in range(len(rows)) if not decoded[i].strip()),'capped':len(capped),'seconds':round(time.time()-start,1)}
        previous=state['interim_checks'][-1] if state['interim_checks'] else None
        reason=None
        if epochs_done>=1-1e-9 and (record['parse']<0.5*len(rows) or record['empty']+record['capped']>0.5*len(rows)):
            reason=('failing',f"after {record['epochs_done']} epochs parse {record['parse']}/{len(rows)}, empty {record['empty']}, capped {record['capped']}")
        elif previous and record['tolerant']<=previous['tolerant'] and val>=previous['dev_loss']:
            reason=('plateau',f"tolerant {record['tolerant']} <= {previous['tolerant']} and dev loss {val:.5f} >= {previous['dev_loss']:.5f}")
        record['stop']=reason and {'kind':reason[0],'reason':reason[1]}
        state['interim_checks'].append(record)
        with open(out/'interim-checks.jsonl','a',encoding='utf-8') as f:f.write(json.dumps(record)+'\n')
        print(json.dumps({'interim_check':record}),flush=True)
        model.train()
        if reason:raise EarlyStop(*reason)
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
                with amp():loss=model(**b).loss
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
                    if epoch==0 and step in check_steps:interim_check(f'epoch 1, {step}/{steps_per_epoch} steps')
            interim_check(f'end of epoch {epoch+1}')
            val=dev_loss();print(json.dumps({'epoch':epoch,'dev_loss':val,'step':state['step']}),flush=True)
            if state['best_dev_loss'] is None or val<state['best_dev_loss']:
                state['best_dev_loss']=val
                if a.role!='formalizer':checkpoint('best')
            # a text-target role keeps one adapter snapshot per epoch so that an external development decode (scored by the oracle) can select among epochs
            if a.role=='proofreader':checkpoint(f'epoch-{epoch+1}')
            # `select_final_only` scores the development split once, after the last epoch, so `best` is the final
            # checkpoint and its development score is still computed and recorded.
            if not cfg.get('select_final_only') or epoch==epochs-1 or state['step']>=total:semantic_select()
            if state['step']>=total:checkpoint('latest');break
            state.update(epoch=epoch+1,next_batch=0);checkpoint('latest')
    except KeyboardInterrupt:
        # Do not snapshot partially accumulated gradients or partially updated optimizer state.
        print('Interrupted: resume from the last completed checkpoint; unsaved steps replay.')
        return
    except EarlyStop as stop:
        kind,reason=stop.args
        # A plateau selects the current model (full development score, then best); a failing run keeps no best.
        if kind=='plateau':semantic_select()
        checkpoint('latest')
        write_json(out/'summary.json',{'optimizer_steps':state['step'],'stopped_early':{'kind':kind,'reason':reason},'interim_checks':state['interim_checks'],
            'best_dev_loss':state['best_dev_loss'],'best_semantic_score':state['best_semantic_score'],'seconds':time.time()-start,
            'training_finished_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'training_completed':kind=='plateau','neural_test_accuracy':None,
            'selection':'dev execution equivalence of the model at the plateau stop' if kind=='plateau' else 'none: the run failed the interim rule'})
        print(json.dumps({'stopped_early':kind,'reason':reason}),flush=True)
        return
    write_json(out/'summary.json',{'interim_checks':state['interim_checks'],'optimizer_steps':state['step'],'best_dev_loss':state['best_dev_loss'],'best_semantic_score':state['best_semantic_score'],'seconds':time.time()-start,'training_finished_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'training_completed':True,'neural_test_accuracy':None,'selection':'dev execution equivalence; syntax tiebreak' if a.role=='formalizer' else 'dev loss diagnostic only','notice':'Sealed holdout and human review remain required before promotion; verbalizer has no automatic faithfulness selection.'})

if __name__=='__main__':main()
