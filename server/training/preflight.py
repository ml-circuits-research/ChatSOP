#!/usr/bin/env python3
import argparse,json,platform,sys

def main():
 p=argparse.ArgumentParser();p.add_argument('--cpu',action='store_true');a=p.parse_args()
 import torch,transformers,peft,accelerate
 report={'python':sys.version,'machine':platform.machine(),'torch':torch.__version__,'cuda_build':torch.version.cuda,'transformers':transformers.__version__,'peft':peft.__version__,'accelerate':accelerate.__version__,'cuda_available':torch.cuda.is_available()}
 if not a.cpu:
  if not torch.cuda.is_available():raise RuntimeError('CUDA unavailable. Use the NVIDIA Spark container; do not replace its PyTorch with a generic wheel.')
  report.update(gpu=torch.cuda.get_device_name(0),capability=torch.cuda.get_device_capability(0),bf16=torch.cuda.is_bf16_supported())
  x=torch.randn(256,256,device='cuda',dtype=torch.bfloat16,requires_grad=True);loss=(x@x).float().square().mean();loss.backward();torch.cuda.synchronize();report['gpu_forward_backward']='passed'
  if platform.machine() not in ['aarch64','arm64']:report['warning']='This is not the expected ARM64 DGX Spark host. GPU test ran on the current host only.'
 print(json.dumps(report,indent=2))
if __name__=='__main__':main()
