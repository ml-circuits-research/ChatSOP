#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN="${1:?Usage: train-both.sh RUN DATA MODEL QUALIFICATION FORMALIZER_AUTH VERBALIZER_AUTH [TRAIN_OPTIONS...]}"
DATA="${2:?Specify an explicit qualified dataset directory}"
MODEL="${3:?Specify a model}"
QUALIFICATION="${4:?Specify dataset qualification JSON}"
FORMALIZER_AUTH="${5:?Specify formalizer-specific NEW user authorization JSON}"
VERBALIZER_AUTH="${6:?Specify verbalizer-specific NEW user authorization JSON}"
node "$ROOT/training/cli.mjs" train --model "$MODEL" --run "$RUN" --role formalizer --data "$DATA" --qualification "$QUALIFICATION" --authorization "$FORMALIZER_AUTH" "${@:7}"
node "$ROOT/training/cli.mjs" train --model "$MODEL" --run "$RUN" --role verbalizer --data "$DATA" --qualification "$QUALIFICATION" --authorization "$VERBALIZER_AUTH" "${@:7}"
