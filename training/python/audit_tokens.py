#!/usr/bin/env python3
"""Audit real tokenizer lengths; imports no model weights and performs no training."""
import argparse,json
from pathlib import Path
from common import read_training_rows,encode_row,write_json

def main():
 p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--data',required=True);p.add_argument('--role',choices=['formalizer','verbalizer'],required=True);p.add_argument('--out',required=True);p.add_argument('--base',required=True);a=p.parse_args()
 from transformers import AutoTokenizer
 cfg=json.loads(Path(a.config).read_text());pinned=json.loads((Path(a.base)/'recall-model-lock.json').read_text())
 tok=AutoTokenizer.from_pretrained(a.base,local_files_only=True,trust_remote_code=False)
 result={'role':a.role,'model':pinned['model_id'],'revision':pinned['revision'],'limit':cfg['max_length'],'splits':{},'errors':[],'modelWeightsLoaded':False}
 for split in ['train','dev']:
  lengths=[];supervised=[]
  for row in read_training_rows(a.data,a.role,split):
   try:
    r=encode_row(tok,row,cfg['max_length']);lengths.append(len(r['input_ids']));supervised.append(sum(x!=-100 for x in r['labels']))
   except ValueError as e:result['errors'].append({'id':row.get('id'),'error':str(e)})
  result['splits'][split]={'accepted':len(lengths),'maxTokens':max(lengths,default=0),'meanTokens':sum(lengths)/max(1,len(lengths)),'supervisedTokens':sum(supervised)}
 write_json(a.out,result);print(json.dumps(result,ensure_ascii=False,indent=2))
 if result['errors']:raise SystemExit(1)
if __name__=='__main__':main()
