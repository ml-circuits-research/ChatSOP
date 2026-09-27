#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
DIR="${LLAMA_CPP_DIR:-$ROOT/vendor/llama.cpp}"
[[ -f "$DIR/convert_hf_to_gguf.py" ]] || { echo 'Build llama.cpp first (scripts/build-llama.sh).' >&2; exit 1; }
# Install converter dependencies in a SEPARATE CPU venv; do not alter the Spark
# training environment's torch version just to perform conversion.
PYTHON="${CONVERTER_PYTHON:-python}"
for role in formalizer verbalizer; do
 python training/merge.py --checkpoint "outputs/$role/best" --output "outputs/merged-$role"
 "$PYTHON" "$DIR/convert_hf_to_gguf.py" "outputs/merged-$role" --outfile "outputs/$role-f16.gguf" --outtype f16
 "$DIR/build/bin/llama-quantize" "outputs/$role-f16.gguf" "outputs/$role-q4_k_m.gguf" Q4_K_M
 "$DIR/build/bin/llama-quantize" "outputs/$role-f16.gguf" "outputs/$role-q8_0.gguf" Q8_0
 done
sha256sum outputs/*.gguf > reports/gguf-sha256.txt
