#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
python training/train.py --role formalizer --data data/seed --max-steps 20 --output outputs/smoke-formalizer
python training/train.py --role verbalizer --data data/seed --max-steps 20 --output outputs/smoke-verbalizer
