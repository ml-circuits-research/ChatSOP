#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${SPARK_IMAGE:-nvcr.io/nvidia/pytorch:25.11-py3}"
command -v docker >/dev/null || { echo 'Docker is required on the DGX Spark host.' >&2; exit 1; }
mkdir -p "$ROOT/reports" "$HOME/.cache/huggingface"
docker pull "$IMAGE"
docker image inspect "$IMAGE" --format '{{json .RepoDigests}}' > "$ROOT/reports/spark-container-digest.json"
# This Linux host network mapping permits Node.js on the host to access loopback
# inference inside the container. No model server binds to public interfaces.
exec docker run --rm -it --gpus all --network host --ipc=host \
 --ulimit memlock=-1 --ulimit stack=67108864 \
 -v "$ROOT:/workspace" -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
 -e HF_TOKEN -w /workspace --entrypoint /bin/bash "$IMAGE"
