#!/usr/bin/env python3
"""Audit real tokenizer lengths; imports no model weights and performs no training."""
import argparse,json
from pathlib import Path
from common import read_training_rows,encode_row,write_json,load_tokenizer,is_seq2seq,load_seq2seq_tokenizer,encode_seq2seq_row

def main():
 p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--data',required=True);p.add_argument('--role',choices=['formalizer','verbalizer','proofreader'],required=True);p.add_argument('--out',required=True);p.add_argument('--base',required=True);a=p.parse_args()
 cfg=json.loads(Path(a.config).read_text());pinned=json.loads((Path(a.base)/'recall-model-lock.json').read_text())
 if is_seq2seq(cfg):return seq2seq(a,cfg,pinned)
 tok=load_tokenizer(a.base,cfg)
 result={'role':a.role,'model':pinned['model_id'],'revision':pinned['revision'],'limit':cfg['max_length'],'splits':{},'errors':[],'modelWeightsLoaded':False,'chatTemplateOverride':bool(cfg.get('chat_template')),'eos_token':tok.eos_token,'pad_token':tok.pad_token}
 gen=Path(a.base)/'generation_config.json'
 stops=json.loads(gen.read_text()).get('eos_token_id') if gen.exists() else None
 stops=set(stops if isinstance(stops,list) else [stops] if stops is not None else [tok.eos_token_id])
 result['stopTokenIds']=sorted(stops)
 for split in ['train','dev']:
  lengths=[];supervised=[]
  for row in read_training_rows(a.data,a.role,split):
   try:
    r=encode_row(tok,row,cfg['max_length']);lengths.append(len(r['input_ids']));supervised.append(sum(x!=-100 for x in r['labels']))
    if not stops.intersection(x for x in r['labels'] if x!=-100):raise ValueError(f"{row.get('id')}: supervised target has no generation stop token {sorted(stops)}")
   except ValueError as e:result['errors'].append({'id':row.get('id'),'error':str(e)})
  result['splits'][split]={'accepted':len(lengths),'maxTokens':max(lengths,default=0),'meanTokens':sum(lengths)/max(1,len(lengths)),'supervisedTokens':sum(supervised)}
 write_json(a.out,result);print(json.dumps(result,ensure_ascii=False,indent=2))
 if result['errors']:raise SystemExit(1)
def seq2seq(a,cfg,pinned):
 # Encoder-decoder recipe: source and label lengths, and the exact reproduction of every target (common.encode_seq2seq_row).
 tok=load_seq2seq_tokenizer(a.base,cfg)
 result={'role':a.role,'model':pinned['model_id'],'revision':pinned['revision'],'architecture':'seq2seq','limits':{k:cfg[k] for k in ['max_source_length','max_target_length','max_position_embeddings']},'splits':{},'errors':[],'modelWeightsLoaded':False,'unk_token':tok.unk_token,'eos_token':tok.eos_token}
 for split in ['train','dev']:
  src=[];tgt=[];unk_src=0;unk_tgt=0
  for row in read_training_rows(a.data,a.role,split):
   try:
    r=encode_seq2seq_row(tok,row,cfg);src.append(len(r['input_ids']));tgt.append(len(r['labels']))
    unk_src+=r['input_ids'].count(tok.unk_token_id);unk_tgt+=r['labels'].count(tok.unk_token_id)
    if r['labels'][-1]!=tok.eos_token_id:raise ValueError(f"{row.get('id')}: label does not end with the eos token")
   except ValueError as e:result['errors'].append({'id':row.get('id'),'error':str(e)})
  result['splits'][split]={'accepted':len(src),'maxSourceTokens':max(src,default=0),'maxTargetTokens':max(tgt,default=0),'sourceOver512':sum(x>512 for x in src),'targetOver512':sum(x>512 for x in tgt),'sourceUnkTokens':unk_src,'targetUnkTokens':unk_tgt,'targetTokens':sum(tgt)}
 write_json(a.out,result);print(json.dumps(result,ensure_ascii=False,indent=2))
 if result['errors']:raise SystemExit(1)
if __name__=='__main__':main()
