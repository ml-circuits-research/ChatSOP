#!/usr/bin/env bash
# One arm of experiment eval-local-judge-v1: serve a GGUF with llama-server, run the parse and meaning calibration sets
# through tools/research/local-judge.mjs, stop the server, score. Usage:
#   tools/research/local-judge-arm.sh NAME MODEL.gguf SLOTS THINKING(on|off) STAGE(1|full) [PORT]
# STAGE 1 judges every 3rd sentence of the parse set and every 6th pair of the meaning set (futility check); STAGE full judges everything (it resumes the stage-1 verdicts).
# Output: eval/reports/current/local-judge/NAME/{parse,meaning}/verdicts.jsonl (+ .stats.jsonl), power.log.
# The server uses a port in 18300-18320; the script stops only the server it started.
set -euo pipefail
NAME=$1; MODEL=$2; NP=$3; THINK=$4; STAGE=$5; PORT=${6:-18300}
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
BIN=${LLAMA_BIN:-$HOME/llama-cpp-venv/llama.cpp/build/bin}
SLOTCTX=$([ "$THINK" = on ] && echo 16384 || echo 8192)
OUT=eval/reports/current/local-judge/$NAME; mkdir -p "$OUT"
LOG=${LOCAL_JUDGE_LOGS:-$OUT}/server-$STAGE.log
export LD_LIBRARY_PATH=$BIN
"$BIN/llama-server" -m "$MODEL" -ngl 99 -fa on -c $((NP * SLOTCTX)) -np "$NP" --no-cache-prompt --cache-ram 0 --no-kv-unified \
  --host 127.0.0.1 --port "$PORT" > "$LOG" 2>&1 &
SERVER=$!
nvidia-smi --query-gpu=timestamp,power.draw,utilization.gpu --format=csv,noheader,nounits -l 2 >> "$OUT/power-$STAGE.log" 2>/dev/null &
POWER=$!
trap 'kill $SERVER $POWER 2>/dev/null || true' EXIT
until curl -s "localhost:$PORT/health" | grep -q '"ok"'; do kill -0 $SERVER 2>/dev/null || { echo "server died"; tail -5 "$LOG"; exit 1; }; sleep 2; done
EXTRA=${LOCAL_JUDGE_EXTRA:-}
for set in parse meaning; do
  STRIDE=""; if [ "$STAGE" = 1 ]; then STRIDE="--stride 6"; [ $set = parse ] && STRIDE="--stride 3"; fi
  if [ $set = parse ]; then F=datasets_sources/parse_judge_deepseek; C=a,c; else F=datasets_sources/meaning_judge_calibration_v2; C=m1,m2,m1r; fi
  [ "$set" = meaning ] && [ "$STAGE" = 1 ] && C=m1,m2
  node tools/research/local-judge.mjs run --endpoint "http://127.0.0.1:$PORT" --folder $F --conditions $C $STRIDE \
    --out "$OUT/$set/verdicts.jsonl" --parallel "$NP" --thinking "$THINK" --label "$NAME" $EXTRA
done
