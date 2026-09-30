#!/usr/bin/env python3
import argparse,hashlib,json,os
from pathlib import Path

def sha256(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()

def main():
 p=argparse.ArgumentParser();p.add_argument('--model-id',required=True);p.add_argument('--revision',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 from huggingface_hub import snapshot_download
 # '*.spm' carries the source/target SentencePiece models of Marian translation checkpoints.
 snapshot_download(a.model_id,revision=a.revision,local_dir=a.output,token=os.getenv('HF_TOKEN'),allow_patterns=['*.json','*.safetensors','*.model','*.spm','*.txt','*.jinja','README.md','LICENSE*'])
 out=Path(a.output)
 if not any(out.glob('*.safetensors')):
  # Some pinned bases (the Helsinki-NLP Marian checkpoints) publish only pytorch_model.bin at their main revision.
  # It is loaded as plain tensors (weights_only=True, no pickled code), written as model.safetensors, and both
  # digests are recorded; the .bin is then removed so every base loads through safetensors alone.
  snapshot_download(a.model_id,revision=a.revision,local_dir=a.output,token=os.getenv('HF_TOKEN'),allow_patterns=['pytorch_model.bin'])
  source=out/'pytorch_model.bin'
  if source.exists():
   import torch
   from safetensors.torch import save_file
   state=torch.load(source,map_location='cpu',weights_only=True)
   # Tied tensors (shared embeddings) are cloned: safetensors refuses aliased storage.
   save_file({k:v.detach().clone().contiguous() for k,v in state.items()},str(out/'model.safetensors'),metadata={'format':'pt'})
   (out/'weights-conversion.json').write_text(json.dumps({'source':'pytorch_model.bin','source_sha256':sha256(source),'converted':'model.safetensors','converted_sha256':sha256(out/'model.safetensors'),'tensors':len(state),'method':'torch.load(weights_only=True) -> safetensors.torch.save_file'},indent=2)+'\n')
   source.unlink()
if __name__=='__main__':main()
