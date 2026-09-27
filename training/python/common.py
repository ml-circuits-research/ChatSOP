"""Tokenizer formatting and checkpoint-local data hashing for ML execution."""
from __future__ import annotations
import json, hashlib
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
    return tokenizer.apply_chat_template(messages,tokenize=True,add_generation_prompt=target is None,enable_thinking=False,return_dict=False)

def encode_row(tokenizer,row,max_length):
    prefix=chat_ids(tokenizer,row['prompt']); full=chat_ids(tokenizer,row['prompt'],row['target'])
    if full[:len(prefix)]!=prefix:
        raise ValueError(f"Chat template prefix mismatch in {row.get('id')}; inspect tokenizer template. Do not mask by a guessed token count.")
    if len(full)>max_length:
        raise ValueError(f"{row.get('id')}: {len(full)} tokens > max_length={max_length}. Shorten schema/prompt or increase context; no silent truncation.")
    if len(full)<=len(prefix): raise ValueError('Empty supervised target')
    return {'input_ids':full,'attention_mask':[1]*len(full),'labels':[-100]*len(prefix)+full[len(prefix):]}

