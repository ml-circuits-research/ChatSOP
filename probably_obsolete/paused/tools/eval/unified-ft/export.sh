#!/usr/bin/env bash
# Merge the LoRA adapter of a unified-ft run into the pinned Qwen3-4B base (CPU, fp32), convert to F16 GGUF and quantize to Q4_K_M (llama.cpp of ~/llama-cpp-venv).
# usage: tools/eval/unified-ft/export.sh <run> [checkpoint=epoch-1]   (output: models/qwen3-4b/<run>/proofreader/{merged-<ckpt>,gguf})
set -euo pipefail
cd /home/salboaie/work/ChatSOP
RUN=${1:?run}; CK=${2:-epoch-1}
BASE=$(ls -d models/qwen3-4b/bases/*/ | head -1); BASE=${BASE%/}
OUT=models/qwen3-4b/$RUN/proofreader
PY=$HOME/proofreader-export-venv/bin/python; LL=$HOME/llama-cpp-venv/llama.cpp
[ -d "$OUT/merged-$CK" ] || CUDA_VISIBLE_DEVICES= $PY training/python/merge.py --checkpoint "$OUT/$CK" --output "$OUT/merged-$CK" --base "$BASE"
mkdir -p "$OUT/gguf"
[ -f "$OUT/gguf/$CK-f16.gguf" ] || CUDA_VISIBLE_DEVICES= $PY $LL/convert_hf_to_gguf.py "$OUT/merged-$CK" --outtype f16 --outfile "$OUT/gguf/$CK-f16.gguf"
[ -f "$OUT/gguf/$CK-q4_k_m.gguf" ] || $LL/build/bin/llama-quantize "$OUT/gguf/$CK-f16.gguf" "$OUT/gguf/$CK-q4_k_m.gguf" Q4_K_M
ls -la "$OUT/gguf"
