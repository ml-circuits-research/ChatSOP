#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN="${1:?Usage: export-gguf.sh RUN ROLE [MODEL]}"
ROLE="${2:?Specify formalizer or verbalizer}"
MODEL="${3:-gemma}"
exec node "$ROOT/training/cli.mjs" export-gguf --model "$MODEL" --run "$RUN" --role "$ROLE" "${@:4}"
