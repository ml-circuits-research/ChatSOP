#!/usr/bin/env python3
"""Token-budget audit for a plain-text role (for example `proofreader`): percentile prompt and prompt+target
token counts via the pinned base model's own tokenizer and chat template (DS021 message-only input, no system
role, no instruction wrapper -- training/python/common.py chat_ids()). Imports no model weights, performs no
training. This is the checked-in generator of eval/reports/current/<corpus>/gemma3-270m-token-audit.json-style
reports consumed by tools/research/qualify-proofing.mjs's hard-coded over_2048 gate.

Usage: ~/nlp-venv/bin/python training/python/token_budget_audit.py --data DIR --role proofreader --base BASE_DIR
       --out OUT.json [--config config/train-gemma.json]
"""
import argparse
import json
from pathlib import Path
from common import read_training_rows, chat_ids, load_tokenizer, write_json


def percentiles(values):
    if not values:
        return {'n': 0, 'min': 0, 'p50': 0, 'p90': 0, 'p99': 0, 'max': 0}
    xs = sorted(values)
    def pct(p):
        idx = min(len(xs) - 1, int(p * len(xs)))
        return xs[idx]
    return {'n': len(xs), 'min': xs[0], 'p50': pct(0.50), 'p90': pct(0.90), 'p99': pct(0.99), 'max': xs[-1]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--role', required=True)
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--config', default=None)
    a = ap.parse_args()
    cfg = json.loads(Path(a.config).read_text()) if a.config else {}
    tok = load_tokenizer(a.base, cfg)
    gen_cfg_file = Path(a.base) / 'config.json'
    max_pos = json.loads(gen_cfg_file.read_text()).get('max_position_embeddings') if gen_cfg_file.exists() else None

    result = {'model_max_position_embeddings': max_pos,
              'format': "matches training/python/common.py chat_ids(): user turn = row['prompt'] verbatim, assistant turn = row['target']; no system role, no added instruction (DS021 message-only input)"}
    for split in ['train', 'dev']:
        prompt_tok, total_tok = [], []
        for row in read_training_rows(a.data, a.role, split):
            p = len(chat_ids(tok, row['prompt']))
            full = len(chat_ids(tok, row['prompt'], row['target']))
            prompt_tok.append(p)
            total_tok.append(full)
        result[split] = {
            'rows': len(total_tok),
            'prompt_tokens': percentiles(prompt_tok),
            'total_tokens_prompt_plus_target': percentiles(total_tok),
            'over_1024': sum(1 for x in total_tok if x > 1024),
            'over_2048': sum(1 for x in total_tok if x > 2048),
        }
    write_json(a.out, result)
    print(json.dumps(result, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
