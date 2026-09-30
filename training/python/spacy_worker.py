#!/usr/bin/env python3
"""spaCy second-parser worker of SymbolicLM (lib/symbolic-lm/spacy.mjs): the uncertainty signal "Stanza and spaCy
disagree on the core arcs of an English sentence" (experiment eval-symbolic-lm-v1).

Reads one JSON line per request {"id", "text"} on stdin and answers one line {"id", "tokens": [{"i", "text", "pos",
"dep", "head", "start", "end"}]} (offsets relative to the text). A first line {"ready": true, "model": ...} is
written once the model is loaded. Model: en_core_web_lg 3.8.0 (MIT) in the separate venv ~/spacy-venv (spaCy 3.8,
MIT; dependencies.md, DS014 "Model weights"). CPU only; the worker never sees anything but the text it is given.
Usage: ~/spacy-venv/bin/python training/python/spacy_worker.py
"""
import json
import sys

import spacy

nlp = spacy.load('en_core_web_lg', disable=['ner', 'lemmatizer'])
print(json.dumps({'ready': True, 'model': nlp.meta['name'] + '-' + nlp.meta['version']}), flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        request = json.loads(line)
        doc = nlp(str(request.get('text', '')))
        tokens = [{'i': t.i, 'text': t.text, 'pos': t.pos_, 'dep': t.dep_, 'head': t.head.i, 'start': t.idx,
                   'end': t.idx + len(t.text)} for t in doc]
        print(json.dumps({'id': request.get('id'), 'tokens': tokens}, ensure_ascii=False), flush=True)
    except Exception as error:  # report, never crash the worker
        print(json.dumps({'id': None, 'error': type(error).__name__ + ': ' + str(error)}), flush=True)
