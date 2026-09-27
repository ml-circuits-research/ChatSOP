#!/usr/bin/env python3
import argparse,json,os
from pathlib import Path
from common import write_json

def main():
 p=argparse.ArgumentParser();p.add_argument('--checkpoint',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 import torch
 from transformers import AutoModelForCausalLM,AutoTokenizer
 from peft import PeftModel
 folder=Path(a.checkpoint);state=json.loads((folder/'state.json').read_text());out=Path(a.output)
 if out.exists() and any(out.iterdir()):raise ValueError('Output must be empty')
 if state.get('full'):model=AutoModelForCausalLM.from_pretrained(folder/'model',torch_dtype=torch.float32)
 else:
  base=AutoModelForCausalLM.from_pretrained(state['model_id'],revision=state['revision'],torch_dtype=torch.float32,trust_remote_code=False,token=os.getenv('HF_TOKEN'))
  model=PeftModel.from_pretrained(base,folder/'adapter').merge_and_unload(safe_merge=True)
 model.save_pretrained(out,safe_serialization=True)
 tok=AutoTokenizer.from_pretrained(folder/'tokenizer');tok.save_pretrained(out)
 write_json(out/'recall-export.json',{'source_checkpoint':str(folder.resolve()),'model_id':state['model_id'],'revision':state['revision'],'task':state['role']})
 print(out)
if __name__=='__main__':main()
