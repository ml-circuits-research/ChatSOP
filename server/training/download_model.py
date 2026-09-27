#!/usr/bin/env python3
import argparse,json,os
from pathlib import Path
from common import write_json,resolve_revision

def main():
 p=argparse.ArgumentParser();p.add_argument('--config',default='config/train-gemma.json');p.add_argument('--output',default='models/base');a=p.parse_args()
 from huggingface_hub import snapshot_download
 cfg=json.loads(Path(a.config).read_text());model,rev=resolve_revision(cfg['model_id'],cfg.get('revision'))
 location=snapshot_download(model,revision=rev,local_dir=a.output,token=os.getenv('HF_TOKEN'),allow_patterns=['*.json','*.safetensors','*.model','*.txt','*.jinja','README.md','LICENSE*'])
 write_json(Path(a.output)/'recall-model-lock.json',{'model_id':model,'revision':rev,'location':str(location)})
 print('Downloaded a pinned upstream model revision to',location)
if __name__=='__main__':main()
