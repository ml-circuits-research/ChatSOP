#!/usr/bin/env python3
import argparse,os

def main():
 p=argparse.ArgumentParser();p.add_argument('--model-id',required=True);p.add_argument('--revision',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 from huggingface_hub import snapshot_download
 snapshot_download(a.model_id,revision=a.revision,local_dir=a.output,token=os.getenv('HF_TOKEN'),allow_patterns=['*.json','*.safetensors','*.model','*.txt','*.jinja','README.md','LICENSE*'])
if __name__=='__main__':main()
