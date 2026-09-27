#!/usr/bin/env python3
"""Audit real tokenizer lengths; imports no model weights and performs no training."""
import argparse,json,os
from pathlib import Path
from common import read_jsonl,encode_row,resolve_revision,write_json

def main():
 p=argparse.ArgumentParser();p.add_argument('--config',default='config/train-gemma.json');p.add_argument('--data',default='data/generated');p.add_argument('--role',choices=['formalizer','verbalizer'],default='formalizer');p.add_argument('--out',default='reports/token-audit.json');p.add_argument('--offline',action='store_true');a=p.parse_args()
 from transformers import AutoTokenizer
 cfg=json.loads(Path(a.config).read_text());model,revision=resolve_revision(cfg['model_id'],cfg.get('revision'),a.offline)
 tok=AutoTokenizer.from_pretrained(model,revision=revision,token=os.getenv('HF_TOKEN'),local_files_only=a.offline,trust_remote_code=False)
 result={'role':a.role,'model':model,'revision':revision,'limit':cfg['max_length'],'splits':{},'errors':[],'modelWeightsLoaded':False}
 for split in ['train','dev','test']:
  lengths=[];supervised=[]
  for row in read_jsonl(Path(a.data)/a.role/(split+'.jsonl')):
   try:
    r=encode_row(tok,row,cfg['max_length']);lengths.append(len(r['input_ids']));supervised.append(sum(x!=-100 for x in r['labels']))
   except ValueError as e:result['errors'].append({'id':row.get('id'),'error':str(e)})
  result['splits'][split]={'accepted':len(lengths),'maxTokens':max(lengths,default=0),'meanTokens':sum(lengths)/max(1,len(lengths)),'supervisedTokens':sum(supervised)}
 write_json(a.out,result);print(json.dumps(result,ensure_ascii=False,indent=2))
 if result['errors']:raise SystemExit(1)
if __name__=='__main__':main()
