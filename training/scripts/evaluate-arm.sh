#!/usr/bin/env bash
# Evaluates one trained formalizer arm on the CPU, as preregistered in status/preregistrations/formalizer-size-v1.json:
# merge the best checkpoint (training image), convert it to GGUF f16 (training image, CPU only, no network),
# quantize to Q8_0 and Q4_K_M, predict every sealed suite through llama-server with the message as the only input
# (tools/research/predict-endpoint.mjs), score, and benchmark CPU speed. The GPU is hidden from every llama.cpp tool.
#
#   training/scripts/evaluate-arm.sh MODEL RUN
# Environment: LLAMA_CPP_DIR (default ~/llama-cpp-venv/llama.cpp), BULK_THREADS (16), PORT (18741).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="${1:?Usage: evaluate-arm.sh MODEL RUN}"; RUN="${2:?Usage: evaluate-arm.sh MODEL RUN}"
LLAMA="${LLAMA_CPP_DIR:-$HOME/llama-cpp-venv/llama.cpp}"; BIN="$LLAMA/build/bin"
IMAGE="$(podman image inspect localhost/chatsop-spark-training:cu130-20260927 --format '{{.Id}}')"
ARM="$ROOT/models/$MODEL/$RUN/formalizer"; MERGED="$ARM/merged-best"; GGUF="$MERGED/gguf"
OUT="$ROOT/eval/reports/current/formalizer-size-v1/$MODEL"; mkdir -p "$OUT"
BULK_THREADS="${BULK_THREADS:-16}"; PORT="${PORT:-18741}"
export CUDA_VISIBLE_DEVICES=
cd "$ROOT"
log() { echo "[$(date -u +%H:%M:%SZ)] $*"; }

if [ ! -d "$MERGED" ]; then
  if grep -q '"full": true' "$ARM/best/state.json"; then
    # A full fine-tuning checkpoint already holds complete weights: merged-best is its model plus its tokenizer
    # (with the recipe's chat template), so no GPU container or training lock is needed while another arm trains.
    log "assemble merged-best from the full fine-tuning checkpoint"
    mkdir -p "$MERGED.partial" && cp "$ARM/best/model/"* "$ARM/best/tokenizer/"* "$MERGED.partial/"
    # The fine-tune never changes the vocabulary. Without a recipe chat_template override, the tokenizer files come
    # unchanged from the pinned base: the transformers 5 checkpoint save omits added_tokens.json, special_tokens_map.json
    # and the full tokenizer_config.json, and without them the GGUF converter turned Gemma's <start_of_turn> and
    # <end_of_turn> into plain text (observed 2026-09-29; the checkpoint's tokenizer.json is otherwise identical).
    BASE_DIR="$(ls -d "$ROOT/models/$MODEL/bases/"*/ | head -1)"
    if ! grep -q '"chat_template":' "$ROOT/config/train-$MODEL.json"; then
      for f in tokenizer.json tokenizer.model tokenizer_config.json special_tokens_map.json added_tokens.json chat_template.jinja vocab.json merges.txt; do
        [ -f "$BASE_DIR/$f" ] && cp "$BASE_DIR/$f" "$MERGED.partial/"
      done
    fi
    printf '{"source_checkpoint": "%s", "task": "formalizer", "method": "copy of best/model and best/tokenizer"}\n' "$ARM/best" > "$MERGED.partial/recall-export.json"
    mv "$MERGED.partial" "$MERGED"
  else
    log "merge best LoRA checkpoint"
    node training/container/podman.mjs run --job "merge-$MODEL-$RUN" --wall-minutes 30 -- merge --model "$MODEL" --run "$RUN" --role formalizer --checkpoint best
  fi
fi
mkdir -p "$GGUF"
if [ ! -f "$GGUF/f16.gguf" ]; then
  log "convert to GGUF f16 (training image, CPU only)"
  podman run --rm --pull=never --network=none --read-only --cap-drop=all --security-opt=no-new-privileges --cpus=4 --memory=16g --memory-swap=16g \
    --pids-limit=256 --tmpfs /tmp:rw,nosuid,size=2g --mount "type=bind,src=$LLAMA,dst=/llama,ro=true" --mount "type=bind,src=$MERGED,dst=/merged,ro=true" \
    --mount "type=bind,src=$GGUF,dst=/out" --env HOME=/tmp --entrypoint /opt/trainer/bin/python "$IMAGE" /llama/convert_hf_to_gguf.py /merged --outfile /out/f16.gguf --outtype f16
fi
for q in Q8_0 Q4_K_M; do
  f="$GGUF/$(echo "$q" | tr 'A-Z' 'a-z').gguf"
  [ -f "$f" ] || "$BIN/llama-quantize" "$GGUF/f16.gguf" "$f" "$q" > "$OUT/quantize-$q.log" 2>&1
done

server_pid=""
start_server() { # model threads slots
  "$BIN/llama-server" -m "$1" --host 127.0.0.1 --port "$PORT" -ngl 0 -t "$2" -np "$3" -c $((8192 * $3)) --jinja > "$OUT/server.log" 2>&1 &
  server_pid=$!
  for _ in $(seq 1 120); do curl -sf "http://127.0.0.1:$PORT/health" > /dev/null && return 0; sleep 1; done
  echo "llama-server did not start" >&2; return 1
}
stop_server() { if [ -n "$server_pid" ]; then kill "$server_pid" 2> /dev/null || true; wait "$server_pid" 2> /dev/null || true; server_pid=""; fi; }
trap stop_server EXIT

SPLIT=300 # characters: sealed-test messages up to SPLIT are "short" (about 94% of rows) and are evaluated first
predict() { # suite quant out-stem [extra predict-endpoint options]
  local suite=$1 q=$2 stem=$3; shift 3
  # Resumable: a finished prediction (predictions and timing written together at the end) is not redone.
  if [ -f "$OUT/$stem.predictions.jsonl" ] && [ -f "$OUT/$stem.timing.json" ]; then log "skip $stem (done)"; return 0; fi
  log "predict $stem"
  node tools/research/predict-endpoint.mjs --suite "eval/suites/$suite/test.jsonl" --url "http://127.0.0.1:$PORT" --parallel 4 --max-tokens 6144 \
    --label "$MODEL/$RUN $q bulk" --out "$OUT/$stem.predictions.jsonl" --timing "$OUT/$stem.timing.json" "$@"
}
subset() { # suite min max out: the suite rows whose message length is in [min, max] (evaluation-only copy)
  node -e "const fs=require('fs');const [f,min,max,o]=process.argv.slice(1);fs.writeFileSync(o,fs.readFileSync(f,'utf8').split('\n').filter(Boolean).filter(l=>{const n=JSON.parse(l).question.length;return n>=+min&&n<=+max}).join('\n')+'\n')" \
    "eval/suites/$1/test.jsonl" "$2" "$3" "$4"
}
score() { # suite-file predictions out-dir part-label
  if [ -f "$3/metrics.json" ] && [ "$3/metrics.json" -nt "$2" ]; then log "skip score $4 (done)"; return 0; fi
  log "score $4"
  node tools/metrics/run.mjs --file "$1" --predictions "$2" --out "$3" > "$3.score.log" 2>&1 || true
  [ -f "$3/metrics.json" ] && node tools/research/record-result.mjs --model "$MODEL" --part "$4" --metrics "$3/metrics.json" || true
}

# Q8_0: short sealed-test rows, OOD, wild, then the long sealed-test rows (each reported as soon as it is scored).
start_server "$GGUF/q8_0.gguf" "$BULK_THREADS" 4
predict formalizer-v1 q8_0 formalizer-v1-short-q8_0 --max-chars "$SPLIT"
subset formalizer-v1 0 "$SPLIT" "$OUT/formalizer-v1-short.suite.jsonl"
score "$OUT/formalizer-v1-short.suite.jsonl" "$OUT/formalizer-v1-short-q8_0.predictions.jsonl" "$OUT/formalizer-v1-short-q8_0" "formalizer-v1 test, short messages (<= $SPLIT chars), Q8_0"
predict formalizer-ood-v1 q8_0 formalizer-ood-v1-q8_0
score eval/suites/formalizer-ood-v1/test.jsonl "$OUT/formalizer-ood-v1-q8_0.predictions.jsonl" "$OUT/formalizer-ood-v1-q8_0" "formalizer-ood-v1, Q8_0"
predict formalizer-wild-v1 q8_0 formalizer-wild-v1-q8_0
log "score wild"
node tools/eval/wild-suite.mjs --score "$OUT/formalizer-wild-v1-q8_0.predictions.jsonl" --out "$OUT/formalizer-wild-v1-q8_0.wild.json" > "$OUT/wild-score.log" 2>&1 || true
node eval/run.mjs --messages eval/suites/formalizer-wild-v1/test.jsonl --predictions "$OUT/formalizer-wild-v1-q8_0.predictions.jsonl" \
  --out "$OUT/formalizer-wild-v1-q8_0.reference-free.json" > "$OUT/wild-reference-free.log" 2>&1 || true
[ -f "$OUT/formalizer-wild-v1-q8_0.wild.json" ] && node tools/research/record-result.mjs --model "$MODEL" --part "formalizer-wild-v1 accepted golds, Q8_0" --metrics "$OUT/formalizer-wild-v1-q8_0.wild.json" || true
[ -f "$OUT/formalizer-wild-v1-q8_0.reference-free.json" ] && node tools/research/record-result.mjs --model "$MODEL" --part "formalizer-wild-v1 reference-free, Q8_0" --metrics "$OUT/formalizer-wild-v1-q8_0.reference-free.json" || true
predict formalizer-v1 q8_0 formalizer-v1-long-q8_0 --min-chars $((SPLIT + 1))
cat "$OUT/formalizer-v1-short-q8_0.predictions.jsonl" "$OUT/formalizer-v1-long-q8_0.predictions.jsonl" > "$OUT/formalizer-v1-q8_0.predictions.jsonl"
score eval/suites/formalizer-v1/test.jsonl "$OUT/formalizer-v1-q8_0.predictions.jsonl" "$OUT/formalizer-v1-q8_0" "formalizer-v1 test, all rows, Q8_0"
stop_server

# Q4_K_M on the two executed suites (quantization invariance).
start_server "$GGUF/q4_k_m.gguf" "$BULK_THREADS" 4
for suite in formalizer-v1 formalizer-ood-v1; do
  predict "$suite" q4_k_m "$suite-q4_k_m"
  score "eval/suites/$suite/test.jsonl" "$OUT/$suite-q4_k_m.predictions.jsonl" "$OUT/$suite-q4_k_m" "$suite, all rows, Q4_K_M"
done
stop_server

log "CPU speed"
uptime > "$OUT/load-before-bench.txt"
for q in q8_0 q4_k_m; do
  [ -s "$OUT/bench-$q.jsonl" ] || "$BIN/llama-bench" -m "$GGUF/$q.gguf" -ngl 0 -t 1,4,10 -p 64,512 -n 128 -r 3 -o jsonl > "$OUT/bench-$q.jsonl" 2> /dev/null
  for t in 4 10; do
    [ -f "$OUT/latency-$q-t$t.timing.json" ] && continue
    start_server "$GGUF/$q.gguf" "$t" 1
    node tools/research/predict-endpoint.mjs --suite eval/suites/formalizer-v1/test.jsonl --url "http://127.0.0.1:$PORT" --parallel 1 --sample 300 --seed 42 \
      --max-tokens 6144 --label "$MODEL/$RUN $q latency t=$t" --out "$OUT/latency-$q-t$t.predictions.jsonl" --timing "$OUT/latency-$q-t$t.timing.json"
    stop_server
  done
done
uptime > "$OUT/load-after-bench.txt"
ls -la "$GGUF" > "$OUT/gguf-files.txt"
log "done: $OUT"
