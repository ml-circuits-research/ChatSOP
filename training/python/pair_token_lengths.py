#!/usr/bin/env python3
"""Per-pair token lengths of flat {id, prompt, target} JSONL files with the pinned base model's own tokenizer and chat
template (training/python/common.py chat_ids(): user turn = prompt, assistant turn = target, no system role). Imports no
model weights and trains nothing. Sibling of token_budget_audit.py, which reports percentiles only; this one keeps the
length of each pair so a dataset builder can store it next to the pair.

Usage: ~/nlp-venv/bin/python training/python/pair_token_lengths.py --base BASE_DIR --out OUT.json FILE.jsonl [FILE.jsonl ...]
Output: {"<file>": {"<id>": [prompt_tokens, prompt_plus_target_tokens], ...}, ...}
"""
import argparse
import json
from pathlib import Path
from common import chat_ids, load_tokenizer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--config', default=None)
    ap.add_argument('files', nargs='+')
    a = ap.parse_args()
    cfg = json.loads(Path(a.config).read_text()) if a.config else {}
    tok = load_tokenizer(a.base, cfg)
    result = {}
    for file in a.files:
        lengths = {}
        for line in Path(file).read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            lengths[row['id']] = [len(chat_ids(tok, row['prompt'])), len(chat_ids(tok, row['prompt'], row['target']))]
        result[file] = lengths
    Path(a.out).write_text(json.dumps(result) + '\n', encoding='utf-8')
    print(json.dumps({file: len(v) for file, v in result.items()}))


if __name__ == '__main__':
    main()
