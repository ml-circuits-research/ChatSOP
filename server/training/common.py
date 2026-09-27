"""Shared training/inference formatting. No role-dependent hidden prompt changes."""
from __future__ import annotations
import json, hashlib, random, os
from pathlib import Path

def read_jsonl(path):
    with open(path, encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]

def sha_file(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def write_json(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); tmp.replace(path)

def chat_ids(tokenizer,prompt,target=None):
    messages=[{'role':'user','content':prompt}]
    if target is not None: messages.append({'role':'assistant','content':target})
    # Gemma does not need a separate system role. Qwen thinking is explicitly disabled.
    return tokenizer.apply_chat_template(messages,tokenize=True,add_generation_prompt=target is None,enable_thinking=False)

def encode_row(tokenizer,row,max_length):
    prefix=chat_ids(tokenizer,row['prompt']); full=chat_ids(tokenizer,row['prompt'],row['target'])
    if full[:len(prefix)]!=prefix:
        raise ValueError(f"Chat template prefix mismatch in {row.get('id')}; inspect tokenizer template. Do not mask by a guessed token count.")
    if len(full)>max_length:
        raise ValueError(f"{row.get('id')}: {len(full)} tokens > max_length={max_length}. Shorten schema/prompt or increase context; no silent truncation.")
    if len(full)<=len(prefix): raise ValueError('Empty supervised target')
    return {'input_ids':full,'attention_mask':[1]*len(full),'labels':[-100]*len(prefix)+full[len(prefix):]}

def resolve_revision(model, revision, offline=False):
    if Path(model).exists(): return str(Path(model).resolve()),None
    if offline:
        if not revision or len(revision)!=40: raise ValueError('Offline training requires a cached 40-character commit revision.')
        return model,revision
    from huggingface_hub import HfApi
    info=HfApi().model_info(model,revision=revision or 'main',token=os.getenv('HF_TOKEN'))
    return model,info.sha
