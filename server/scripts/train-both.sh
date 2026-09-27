#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
CONFIG="${TRAIN_CONFIG:-config/train-gemma.json}"
DATA="${TRAIN_DATA:-data/generated}"
python training/preflight.py
python training/train.py --role formalizer --config "$CONFIG" --data "$DATA" --output outputs/formalizer
python training/train.py --role verbalizer --config "$CONFIG" --data "$DATA" --output outputs/verbalizer
