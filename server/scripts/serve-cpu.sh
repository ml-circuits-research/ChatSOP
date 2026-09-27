#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROLE="${1:-formalizer}"
case "$ROLE" in formalizer) PORT=8081;; verbalizer) PORT=8082;; *) echo 'Use formalizer or verbalizer' >&2; exit 1;; esac
BIN="${LLAMA_SERVER:-$ROOT/vendor/llama.cpp/build/bin/llama-server}"
MODEL="${MODEL_FILE:-$ROOT/outputs/$ROLE-q4_k_m.gguf}"
exec "$BIN" -m "$MODEL" --alias "$ROLE" --host 127.0.0.1 --port "$PORT" \
 -c "${CONTEXT:-4096}" -t "${THREADS:-4}" -ngl 0 -np 1 --jinja
