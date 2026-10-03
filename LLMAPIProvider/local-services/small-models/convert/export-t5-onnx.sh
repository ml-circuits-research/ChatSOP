#!/usr/bin/env bash
# One-off conversion of fvossel/t5-base-nl-to-fol (safetensors) to the ONNX layout transformers.js reads (encoder_model.onnx,
# decoder_model_merged.onnx, tokenizer.json). Python is used here only to convert, never to serve; the venv lives in the gitignored
# models/ folder and is deleted after the export. Run from the ChatSOP repository root (models/ is there). Recorded in dependencies.md.
#   torch 2.14 exports with the dynamo exporter, which optimum 1.24 does not support: pin torch 2.5.1 (CPU wheel).
set -euo pipefail
python3 -m venv models/.convert-venv
models/.convert-venv/bin/pip install -q "torch==2.5.1" --index-url https://download.pytorch.org/whl/cpu
models/.convert-venv/bin/pip install -q "transformers<4.50" "optimum[onnxruntime]<1.25" sentencepiece onnx onnxscript protobuf
models/.convert-venv/bin/optimum-cli export onnx --model models/t5-base-nl-to-fol --task text2text-generation-with-past models/t5-base-nl-to-fol-onnx/onnx-raw
mkdir -p models/t5-base-nl-to-fol-onnx/onnx
mv models/t5-base-nl-to-fol-onnx/onnx-raw/encoder_model.onnx models/t5-base-nl-to-fol-onnx/onnx-raw/decoder_model_merged.onnx models/t5-base-nl-to-fol-onnx/onnx/
mv models/t5-base-nl-to-fol-onnx/onnx-raw/{config.json,generation_config.json,special_tokens_map.json,tokenizer_config.json,tokenizer.json,spiece.model} models/t5-base-nl-to-fol-onnx/
rm -rf models/t5-base-nl-to-fol-onnx/onnx-raw models/.convert-venv
