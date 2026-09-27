#!/usr/bin/env python3
import argparse,json,platform,sys,time

def main():
 p=argparse.ArgumentParser();p.add_argument('--cpu',action='store_true');p.add_argument('--limits',required=True);p.add_argument('--hold-seconds',type=int,default=0);a=p.parse_args()
 if not 0<=a.hold_seconds<=300:p.error('--hold-seconds must be in 0..300')
 import torch,transformers,peft,accelerate
 report={'python':sys.version,'machine':platform.machine(),'torch':torch.__version__,'cuda_build':torch.version.cuda,'transformers':transformers.__version__,'peft':peft.__version__,'accelerate':accelerate.__version__,'cuda_available':torch.cuda.is_available()}
 if not a.cpu:
  if not torch.cuda.is_available():raise RuntimeError('CUDA unavailable in selected TRAIN_PYTHON; use a reviewed native or GPU-enabled Podman environment.')
  limits=json.loads(a.limits);free,total=torch.cuda.mem_get_info()
  report['cuda_memory_before']={'free_gib':round(free/2**30,2),'total_gib':round(total/2**30,2),'measurement':'CUDA driver view, not a cgroup limit'}
  if free<limits['min_cuda_gib']*2**30:raise RuntimeError(f"CUDA free {free/2**30:.1f} GiB is below required {limits['min_cuda_gib']} GiB; do not squeeze cache automatically")
  report.update(gpu=torch.cuda.get_device_name(0),capability=torch.cuda.get_device_capability(0),bf16=torch.cuda.is_bf16_supported())
  if not report['bf16']:raise RuntimeError('CUDA BF16 unavailable for this recipe')
  torch.cuda.reset_peak_memory_stats()
  x=torch.randn(256,256,device='cuda',dtype=torch.bfloat16,requires_grad=True)
  loss=(x@x).float().square().mean();loss.backward();torch.cuda.synchronize()
  if not (torch.isfinite(loss).item() and torch.isfinite(x.grad).all().item()):raise RuntimeError('Non-finite GPU forward/backward result')
  free_after,total_after=torch.cuda.mem_get_info()
  report['cuda_memory_after']={'free_gib':round(free_after/2**30,2),'total_gib':round(total_after/2**30,2),'peak_allocated_bytes':torch.cuda.max_memory_allocated(),'measurement':'CUDA driver view; peak allocated is PyTorch process only'}
  report['gpu_forward_backward']='passed'
  if platform.machine() not in ['aarch64','arm64']:report['warning']='This is not the expected ARM64 DGX Spark host. GPU test ran on the current host only.'
 print(json.dumps(report,indent=2),flush=True)
 if a.hold_seconds:
  print(json.dumps({'preflight_hold_started':a.hold_seconds,'optimizer_steps':0}),flush=True)
  time.sleep(a.hold_seconds)
if __name__=='__main__':main()
