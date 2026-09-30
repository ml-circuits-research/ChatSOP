"""Tokenizer formatting and checkpoint-local data hashing for ML execution."""
from __future__ import annotations
import json, hashlib, re
from pathlib import Path

def shard_paths(path):
    """Physical files of a logical JSONL path, mirroring lib/jsonl-shards.mjs.

    A large `<name>.jsonl` may be stored as `<name>.part-000.jsonl`, `<name>.part-001.jsonl`, ... (no repository file
    exceeds 50 MB). When both forms exist, the newer set by modification time is current. Returns [] when absent.
    """
    path=Path(path)
    if path.suffix!='.jsonl' or not path.parent.is_dir(): return [path] if path.is_file() else []
    stem=path.name[:-len('.jsonl')]
    pattern=re.compile(re.escape(stem)+r'\.part-(\d{3,})\.jsonl$')
    parts=sorted(((int(m.group(1)),path.parent/m.group(0)) for m in (pattern.match(p.name) for p in path.parent.iterdir()) if m),key=lambda x:x[0])
    if not parts: return [path] if path.is_file() else []
    if path.is_file() and path.stat().st_mtime>=max(p.stat().st_mtime for _,p in parts): return [path]
    for position,(index,part) in enumerate(parts):
        if index!=position: raise ValueError(f'{path}: shard sequence has a gap before {part.name}')
    return [p for _,p in parts]

def iter_jsonl(path):
    """Stream parsed rows of a single or sharded JSONL file; a malformed line raises with file:line."""
    files=shard_paths(path)
    if not files: raise FileNotFoundError(f'No such JSONL file or shards: {path}')
    for file in files:
        with open(file, encoding='utf-8') as f:
            for number,line in enumerate(f,1):
                if not line.strip(): continue
                try: yield json.loads(line)
                except json.JSONDecodeError as e: raise ValueError(f'{file}:{number}: {e}') from e

def read_jsonl(path):
    return list(iter_jsonl(path))

PROMPT_PROFILE='message-only'

def read_training_rows(data_dir, role, split):
    """Rows of a formalizer projection, fail closed unless the prompt is the user's message only (DS021, DS022).

    The projection manifest (<data>/<role>/manifest.json, written by tools/research/prepare-experiment.mjs) must
    declare prompt_profile 'message-only', and no prompt may carry the retired CONTEXT block or a MESSAGE header.
    """
    base=Path(data_dir)/role
    manifest=base/'manifest.json'
    if not manifest.exists(): raise ValueError(f'{manifest}: missing projection manifest; run node tools/research/prepare-experiment.mjs')
    profile=json.loads(manifest.read_text(encoding='utf-8')).get('prompt_profile')
    if profile!=PROMPT_PROFILE: raise ValueError(f'{manifest}: prompt_profile {profile!r} is not {PROMPT_PROFILE!r}')
    rows=read_jsonl(base/(split+'.jsonl'))
    for row in rows:
        prompt=row.get('prompt','')
        if prompt.startswith('CONTEXT') or '\nMESSAGE\n' in prompt:
            raise ValueError(f"{row.get('id')}: prompt carries context; the model input is the user's message only")
    return rows

def sha_file(path):
    """sha256 of a file; for a sharded JSONL path, of its concatenated parts (equal to the unsplit file's hash)."""
    h=hashlib.sha256()
    for file in (shard_paths(path) or [Path(path)]):
        with open(file,'rb') as f:
            for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def write_json(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); tmp.replace(path)

def load_tokenizer(path, cfg):
    """Tokenizer of a pinned base or checkpoint; a recipe `chat_template` replaces the shipped template.

    SmolLM2 Instruct's shipped template injects a persona system prompt when no system message is given, so the
    model input would not be the user's message only (DS021). The recipe override is saved with every checkpoint
    tokenizer and therefore travels into merged models and GGUF exports.
    """
    from transformers import AutoTokenizer
    tok=AutoTokenizer.from_pretrained(path,local_files_only=True,trust_remote_code=False)
    if cfg.get('chat_template'): tok.chat_template=cfg['chat_template']
    if tok.pad_token_id is None: tok.pad_token=tok.eos_token
    return tok

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


# Encoder-decoder (seq2seq) formalizer, experiment formalizer-mt-v1 (DS007). The recipe field `architecture: "seq2seq"`
# selects it; the encoder input is the user's message only (no template, no instruction, DS021) and the decoder
# label is the SOP target, both through the reversible line encoding of seq2seq_text.py.
def is_seq2seq(cfg):
    return cfg.get('architecture')=='seq2seq'

def load_seq2seq_tokenizer(path, cfg):
    """Translation tokenizer of a pinned base or checkpoint, with the line tokens <n0>..<n7> added once."""
    from transformers import AutoTokenizer, MarianTokenizer
    from seq2seq_text import LINE_TOKENS
    tok=MarianTokenizer.from_pretrained(path) if (Path(path)/'source.spm').exists() else AutoTokenizer.from_pretrained(path,local_files_only=True,trust_remote_code=False)
    missing=[t for t in LINE_TOKENS if t not in tok.get_vocab()]
    if missing: tok.add_tokens(missing,special_tokens=False)
    return tok

def seq2seq_source_ids(tokenizer, message, cfg):
    from seq2seq_text import encode_source
    ids=tokenizer(encode_source(message))['input_ids']
    if len(ids)>cfg['max_source_length']: raise ValueError(f"message of {len(ids)} tokens > max_source_length={cfg['max_source_length']}; no silent truncation")
    return ids

def encode_seq2seq_row(tokenizer, row, cfg):
    from seq2seq_text import encode_target, decode_target
    source=seq2seq_source_ids(tokenizer,row['prompt'],cfg)
    labels=tokenizer(text_target=encode_target(row['target']))['input_ids']
    if len(labels)>cfg['max_target_length']: raise ValueError(f"{row.get('id')}: target of {len(labels)} tokens > max_target_length={cfg['max_target_length']}")
    if decode_target(tokenizer.decode(labels,skip_special_tokens=True))!=row['target']:
        raise ValueError(f"{row.get('id')}: the tokenizer does not reproduce the SOP target exactly; refusing a lossy label")
    return {'input_ids':source,'attention_mask':[1]*len(source),'labels':labels}
