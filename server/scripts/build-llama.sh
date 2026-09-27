#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${LLAMA_CPP_DIR:-$ROOT/vendor/llama.cpp}"
mkdir -p "$(dirname "$DIR")"
if [[ ! -d "$DIR/.git" ]]; then git clone https://github.com/ggml-org/llama.cpp.git "$DIR"; fi
# Set an exact commit for repeated experiments. The initial checkout is recorded.
if [[ -n "${LLAMA_CPP_REF:-}" ]]; then git -C "$DIR" checkout "$LLAMA_CPP_REF"; fi
mkdir -p "$ROOT/reports"
git -C "$DIR" rev-parse HEAD > "$ROOT/reports/llama-cpp-commit.txt"
cmake -S "$DIR" -B "$DIR/build" -DGGML_CUDA=OFF -DLLAMA_CURL=OFF
cmake --build "$DIR/build" --config Release -j "${BUILD_JOBS:-4}"
