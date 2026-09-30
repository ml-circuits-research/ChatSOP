#!/usr/bin/env bash
# CPU speed of one trained formalizer arm (status/preregistrations/formalizer-size-v1.json, "cpu_speed"): llama-bench for
# each given quantization and end-to-end latency on a fixed sample of 300 formalizer-v1 test messages (seed 42), one
# slot, at 4 and 10 threads, for the first quantization. Run it on an otherwise quiet CPU; the load is recorded.
#
#   training/scripts/bench-cpu.sh MODEL RUN [QUANT ...]      (default q8_0)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="${1:?Usage: bench-cpu.sh MODEL RUN [QUANT ...]}"; RUN="${2:?}"; shift 2
QUANTS=("${@:-q8_0}"); [ ${#QUANTS[@]} -eq 0 ] && QUANTS=(q8_0)
BIN="${LLAMA_CPP_DIR:-$HOME/llama-cpp-venv/llama.cpp}/build/bin"
GGUF="$ROOT/models/$MODEL/$RUN/formalizer/merged-best/gguf"
OUT="$ROOT/eval/reports/current/formalizer-size-v1/$MODEL"; mkdir -p "$OUT"
PORT="${PORT:-18781}"
export CUDA_VISIBLE_DEVICES=
cd "$ROOT"
server_pid=""
stop_server() { if [ -n "$server_pid" ]; then kill "$server_pid" 2> /dev/null || true; wait "$server_pid" 2> /dev/null || true; server_pid=""; fi; }
trap stop_server EXIT
uptime > "$OUT/load-before-bench.txt"
for q in "${QUANTS[@]}"; do
  [ -s "$OUT/bench-$q.jsonl" ] || "$BIN/llama-bench" -m "$GGUF/$q.gguf" -ngl 0 -t 1,4,10 -p 64,512 -n 128 -r 3 -o jsonl > "$OUT/bench-$q.jsonl" 2> /dev/null
done
q="${QUANTS[0]}"
for t in 4 10; do
  [ -f "$OUT/latency-$q-t$t.timing.json" ] && continue
  "$BIN/llama-server" -m "$GGUF/$q.gguf" --host 127.0.0.1 --port "$PORT" -ngl 0 -t "$t" -np 1 -c 8192 --jinja > "$OUT/bench-server.log" 2>&1 &
  server_pid=$!
  for _ in $(seq 1 120); do curl -sf "http://127.0.0.1:$PORT/health" > /dev/null && break; sleep 1; done
  node tools/research/predict-endpoint.mjs --suite eval/suites/formalizer-v1/test.jsonl --url "http://127.0.0.1:$PORT" --parallel 1 --sample 300 --seed 42 \
    --max-tokens 6144 --label "$MODEL/$RUN $q latency t=$t" --out "$OUT/latency-$q-t$t.predictions.jsonl" --timing "$OUT/latency-$q-t$t.timing.json"
  stop_server
done
uptime > "$OUT/load-after-bench.txt"
ls -la "$GGUF" > "$OUT/gguf-files.txt"
echo "bench done: $MODEL"
