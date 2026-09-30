#!/usr/bin/env python3
"""spaCy second-parser run for experiment eval-symbolic-layers-en-v1 (calibration b).

Reads JSON lines {"key", "text"} on stdin and writes {"key", "tokens": [{"i", "text", "lemma", "pos", "dep", "head",
"start", "end"}], "ents": [{"text", "label", "start", "end"}]} per line. Model: en_core_web_lg 3.8.0 (MIT), run
from the separate venv ~/spacy-venv (spaCy 3.8, MIT). Offsets are relative to the given text.
Usage: ~/spacy-venv/bin/python training/python/spacy_parse.py < sentences.jsonl > spacy.jsonl
"""
import json
import sys

import spacy

nlp = spacy.load('en_core_web_lg')
items = [json.loads(line) for line in sys.stdin if line.strip()]
for item, doc in zip(items, nlp.pipe([i['text'] for i in items], batch_size=64)):
    tokens = [{'i': t.i, 'text': t.text, 'lemma': t.lemma_, 'pos': t.pos_, 'dep': t.dep_, 'head': t.head.i,
               'start': t.idx, 'end': t.idx + len(t.text)} for t in doc]
    ents = [{'text': e.text, 'label': e.label_, 'start': e.start_char, 'end': e.end_char} for e in doc.ents]
    print(json.dumps({'key': item['key'], 'model': nlp.meta['name'] + '-' + nlp.meta['version'], 'tokens': tokens, 'ents': ents}, ensure_ascii=False))
