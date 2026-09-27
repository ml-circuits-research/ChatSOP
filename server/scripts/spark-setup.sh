#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Run INSIDE the NVIDIA container. Keep its CUDA-enabled PyTorch.
python -c 'import torch; assert torch.cuda.is_available(), "Expected CUDA-enabled NVIDIA container"; print(torch.__version__, torch.cuda.get_device_name(0))'
python -m venv --system-site-packages .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python - <<'PY' > /tmp/recall-torch-constraint.txt
import torch
print('torch=='+torch.__version__)
PY
python -m pip install -c /tmp/recall-torch-constraint.txt -r training/requirements.txt
mkdir -p reports
python training/preflight.py | tee reports/spark-preflight.json
python -m pip freeze > reports/spark-python-lock.txt
printf '\nEnvironment ready. In every new container shell: source .venv/bin/activate\n'
