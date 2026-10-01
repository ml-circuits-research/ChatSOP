#!/usr/bin/env python3
"""One base model, two independent adapters; all generation under one lock.
Loopback-only research server. Post-validation is used; this is NOT constrained decoding.
"""
from __future__ import annotations
import argparse,json,threading,time
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler

def main():
 p=argparse.ArgumentParser();p.add_argument('--formalizer',required=True);p.add_argument('--verbalizer',required=True);p.add_argument('--base',required=True);p.add_argument('--port',type=int,default=8080);p.add_argument('--cpu',action='store_true');p.add_argument('--max-context',type=int,default=4096);a=p.parse_args()
 import torch
 from transformers import AutoTokenizer,AutoModelForCausalLM
 from peft import PeftModel
 folders={r:Path(getattr(a,r)) for r in ['formalizer','verbalizer']};states={r:json.loads((d/'state.json').read_text()) for r,d in folders.items()}
 for field in ['model_id','revision']:
  if states['formalizer'][field]!=states['verbalizer'][field]:raise ValueError('Shared-base serving requires the exact same base model and revision')
 if any(s.get('full') for s in states.values()):raise ValueError('Use merged llama.cpp models for independently full-fine-tuned checkpoints')
 s=states['formalizer'];device='cpu' if a.cpu else 'cuda';dtype=torch.float32 if a.cpu else torch.bfloat16
 tok=AutoTokenizer.from_pretrained(folders['formalizer']/'tokenizer');base=AutoModelForCausalLM.from_pretrained(a.base,torch_dtype=dtype,attn_implementation='sdpa',trust_remote_code=False,local_files_only=True)
 model=PeftModel.from_pretrained(base,folders['formalizer']/'adapter',adapter_name='formalizer');model.load_adapter(folders['verbalizer']/'adapter',adapter_name='verbalizer');model.to(device).eval();lock=threading.Lock()
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def send_json(self,status,value):
   data=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  def do_GET(self):
   if self.path=='/health':self.send_json(200,{'status':'ok','models':list(folders),'device':device,'decoding':'unconstrained + downstream validation'})
   elif self.path=='/v1/models':self.send_json(200,{'data':[{'id':r,'object':'model'} for r in folders]})
   else:self.send_json(404,{'error':'not found'})
  def do_POST(self):
   try:
    if self.path!='/v1/chat/completions':return self.send_json(404,{'error':'not found'})
    n=int(self.headers.get('Content-Length','0'))
    if n<1 or n>128000:raise ValueError('Request too large or empty')
    req=json.loads(self.rfile.read(n));role=req.get('model');messages=req.get('messages');max_new=int(req.get('max_tokens',512))
    if role not in folders or not isinstance(messages,list) or not 1<=max_new<=2048:raise ValueError('Invalid model/messages/max_tokens')
    if req.get('stream'):raise ValueError('Streaming is not supported')
    # Roles match the training format. Untrusted clients cannot switch server policy.
    if len(messages)!=1 or messages[0].get('role')!='user':raise ValueError('Send one fully constructed user message, as in the training protocol')
    ids=tok.apply_chat_template(messages,tokenize=True,add_generation_prompt=True,enable_thinking=False,return_tensors='pt',return_dict=False)
    if ids.shape[-1]+max_new>a.max_context:raise ValueError('Context exceeds configured limit; no silent truncation')
    with lock,torch.inference_mode():
     model.set_adapter(role);ids=ids.to(device);result=model.generate(input_ids=ids,attention_mask=torch.ones_like(ids),do_sample=False,max_new_tokens=max_new,pad_token_id=tok.pad_token_id or tok.eos_token_id,use_cache=True)
     generated=result[0,ids.shape[-1]:]
     text=tok.decode(generated,skip_special_tokens=True)
     eos=tok.eos_token_id
     hit_end=bool(generated.numel() and eos is not None and int(generated[-1])==eos)
     finish='length' if generated.numel()>=max_new and not hit_end else 'stop'
    self.send_json(200,{'id':'local-'+str(time.time_ns()),'object':'chat.completion','choices':[{'index':0,'message':{'role':'assistant','content':text},'finish_reason':finish}]})
   except Exception as e:self.send_json(400,{'error':str(e)})
 print(f'Listening on http://127.0.0.1:{a.port}; no external interfaces exposed.',flush=True)
 ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
if __name__=='__main__':main()
