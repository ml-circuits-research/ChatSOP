#!/usr/bin/env python3
"""Stanza Universal Dependencies worker for the symbolic formalizer baseline `baseline-ud-rules-v1`.

The worker reads JSON lines on stdin and writes one JSON line per request on stdout:

    request:  {"id": any, "text": "message"}            (or {"id": ..., "texts": [...]} for a batch)
              optional "language": "en"|"ro" (or "languages": [...] for a batch) forces the pipeline of every
              sentence of that text instead of the per-sentence detector (SymbolicLM, lib/symbolic-lm/)
    response: {"id": any, "parse": {...}} | {"id": any, "error": "..."}

`parse` is `{"text", "language", "sentences": [{"language", "text", "start", "end", "oov_rate",
"words": [{"id", "text", "lemma", "upos", "xpos", "feats", "head", "deprel", "start", "end", "ner", "oov"}]}]}`.

Pipelines: Stanza (Stanford NLP, Apache-2.0) English UD models with tokenize, mwt, pos, lemma, depparse and ner, and
Romanian (RRT) with tokenize, pos, lemma and depparse (Stanza ships no Romanian MWT or NER model). The message is first split into sentences with the English tokenizer; each sentence is labelled
`en` or `ro` by a small function-word and diacritic detector and parsed with the pipeline of its language, so a
mixed message is parsed per sentence. `oov` marks a word that is not in the POS tagger's pretrained vocabulary; the
converter uses the rate as its gibberish signal. The worker never sees any context beyond the message.

Stanza package (SymbolicLM configuration, lib/ud-to-sop/stanza.mjs and config/symbolic-lm.json): the English pipeline
comes from `--en-package` (`default`, the charlm models, or `default_accurate`, the transformer models with
electra-large POS, dependency parser and NER) and from the resources directory `--en-dir` (default `--models-dir`).
Romanian and the sentence splitter always use `--models-dir` and `--en-dir` as before, so a sentence the detector labels
Romanian is parsed the same way whatever the English package. `--lemma-model` replaces the English lemmatizer of the package
by a model file (the accurate package keeps the default package's `combined_nocharlm` lemmatizer: the charlm one returns
"leas" for "leases"). `--hf-home` is the Hugging Face cache that holds
google/electra-large-discriminator; the worker then runs offline (HF_HUB_OFFLINE=1) and never downloads.

Usage: ~/nlp-venv/bin/python training/python/ud_parse_worker.py [--device cuda|cpu] [--models-dir DIR]
           [--en-dir DIR] [--en-package default|default_accurate] [--hf-home DIR] [--lemma-model FILE]
A line {"cmd": "ping"} answers {"ok": true, "device": ...}.
"""
import argparse
import json
import os
import re
import sys
import time

PROCESSORS = {'en': 'tokenize,mwt,pos,lemma,depparse,ner', 'ro': 'tokenize,pos,lemma,depparse'}
RO_DIACRITICS = re.compile(r"[ăâîșşțţĂÂÎȘŞȚŢ]")
WORD = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", re.UNICODE)
RO_WORDS = set("""si și sa să nu de la din pe cu pentru care ce cine unde când cand cum este e sunt era fost a au am
ai ati ați lui unei unui ei lor mai foarte dacă daca că ca deși desi după dupa înainte inainte până pana acum azi
ieri mâine maine lucrează lucreaza locuiește locuieste mea meu tău tau ta vreau poți poti poate trebuie știi stii
ați iar sau dar însă insa nici niciodată niciodata ăsta asta acest această aceasta acel acea cel cea cei cele un o
niște niste fiindcă fiindca deoarece pentru că adică adica spune zice zis bine mersi mulțumesc multumesc salut
bună buna zi îmi imi mă ma îți iti își isi s-a s-au l-a""".split())
EN_WORDS = set("""the a an and or but not no is are was were be been being am do does did have has had will would
can could should may might must shall of in on at to for from by with about into over under between after before
until since because if unless although though while when where who what which why how that this these those i you
he she it we they my your his her its our their me him us them there here any anyone someone everyone all every each
please thanks thank hello hi yes ok okay know tell check""".split())


def detect(text, tie='en'):
    """'ro' or 'en' for one sentence, from diacritics and function words; a tie goes to `tie`."""
    raw = WORD.findall(text)
    words = [w.lower() for w in raw]
    # Diacritics count only in lower-case words: Romanian names occur in English messages as written.
    ro = sum(1 for w in words if w in RO_WORDS) + sum(1 for w in raw if w[:1].islower() and RO_DIACRITICS.search(w))
    en = sum(1 for w in words if w in EN_WORDS)
    return 'ro' if ro > en else 'en' if en > ro else tie


class Parser:
    def __init__(self, device, models_dir, en_dir=None, en_package='default', hf_home=None, lemma_model=None):
        if hf_home:
            os.environ['HF_HOME'] = hf_home
            os.environ['HF_HUB_OFFLINE'] = '1'
        import stanza
        import torch
        self.stanza = stanza
        use_gpu = device == 'cuda' and torch.cuda.is_available()
        self.device = 'cuda' if use_gpu else 'cpu'
        common = dict(use_gpu=use_gpu, verbose=False, download_method=None, pos_batch_size=1000, depparse_batch_size=1000)
        if models_dir:
            common['dir'] = models_dir
        # Stanza 1.10 has no Romanian MWT or NER model: Romanian runs tokenize, pos, lemma and depparse only.
        en_common = dict(common)
        if en_dir:
            en_common['dir'] = en_dir
        if lemma_model:
            # A lemmatizer file trained without the character language model: no charlm embedding may be configured for it.
            en_common.update(lemma_model_path=lemma_model, lemma_forward_charlm_path=None, lemma_backward_charlm_path=None)
        self.package = en_package
        self.nlp = {'en': stanza.Pipeline('en', processors=PROCESSORS['en'], package=en_package, **en_common),
                    'ro': stanza.Pipeline('ro', processors=PROCESSORS['ro'], **common)}
        splitter_dir = en_dir or models_dir
        self.splitter = stanza.Pipeline('en', processors='tokenize', use_gpu=use_gpu, verbose=False,
                                        download_method=None, **({'dir': splitter_dir} if splitter_dir else {}))
        self.vocab = {}
        for lang, nlp in self.nlp.items():
            try:
                self.vocab[lang] = nlp.processors['pos'].pretrain.vocab
            except Exception:  # pragma: no cover - vocabulary unavailable: no OOV signal
                self.vocab[lang] = None

    def oov(self, lang, word):
        vocab = self.vocab.get(lang)
        if vocab is None:
            return False
        w = word.lower()
        if not WORD.fullmatch(w):
            return False
        table = getattr(vocab, '_unit2id', None)
        if isinstance(table, dict):
            return w not in table
        try:
            return vocab.unit2id(w) == vocab.unit2id('<UNK>')
        except Exception:
            return False

    def sentences(self, text):
        doc = self.splitter(text)
        out = []
        for sentence in doc.sentences:
            start = sentence.tokens[0].start_char
            end = sentence.tokens[-1].end_char
            out.append((start, end))
        return out or [(0, len(text))]

    def parse_many(self, texts, languages=None):
        jobs = {'en': [], 'ro': []}
        layout = []
        for index, text in enumerate(texts):
            spans = self.sentences(text) if text.strip() else []
            forced = languages[index] if languages and index < len(languages) else None
            # A sentence without clear evidence takes the language of the whole message.
            whole = forced if forced in ('en', 'ro') else detect(text)
            langs = [whole if forced in ('en', 'ro') else detect(text[s:e], whole) for s, e in spans]
            layout.append((spans, langs))
            for (s, e), lang in zip(spans, langs):
                jobs[lang].append((index, s, text[s:e]))
        parsed = {}
        for lang, items in jobs.items():
            if not items:
                continue
            docs = [self.stanza.Document([], text=chunk) for _, _, chunk in items]
            docs = self.nlp[lang].bulk_process(docs)
            for (index, offset, _), doc in zip(items, docs):
                parsed.setdefault(index, []).extend(self.convert(doc, lang, offset))
        results = []
        for index, text in enumerate(texts):
            sentences = sorted(parsed.get(index, []), key=lambda s: s['start'])
            langs = [s['language'] for s in sentences]
            language = 'mixed' if len(set(langs)) > 1 else (langs[0] if langs else detect(text))
            results.append({'text': text, 'language': language, 'sentences': sentences})
        return results

    def convert(self, doc, lang, offset):
        out = []
        for sentence in doc.sentences:
            words = []
            for token in sentence.tokens:
                ner = getattr(token, 'ner', None) or 'O'
                for word in token.words:
                    feats = {}
                    if word.feats:
                        for pair in word.feats.split('|'):
                            if '=' in pair:
                                k, v = pair.split('=', 1)
                                feats[k] = v
                    words.append({'id': word.id, 'text': word.text, 'lemma': word.lemma or word.text,
                                  'upos': word.upos, 'xpos': word.xpos, 'feats': feats, 'head': word.head,
                                  'deprel': word.deprel, 'start': token.start_char + offset,
                                  'end': token.end_char + offset, 'token': token.text, 'ner': ner,
                                  'oov': self.oov(lang, word.text)})
            alpha = [w for w in words if WORD.fullmatch(w['text'].lower() or '')]
            rate = (sum(1 for w in alpha if w['oov']) / len(alpha)) if alpha else 1.0
            out.append({'language': lang, 'text': sentence.text,
                        'start': sentence.tokens[0].start_char + offset,
                        'end': sentence.tokens[-1].end_char + offset, 'oov_rate': rate, 'words': words})
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--device', default='cuda', choices=['cuda', 'cpu'])
    ap.add_argument('--models-dir', default=None)
    ap.add_argument('--en-dir', default=None)
    ap.add_argument('--en-package', default='default')
    ap.add_argument('--hf-home', default=None)
    ap.add_argument('--lemma-model', default=None)
    args = ap.parse_args()
    parser = Parser(args.device, args.models_dir, args.en_dir, args.en_package, args.hf_home, args.lemma_model)
    print(json.dumps({'ready': True, 'device': parser.device, 'package': parser.package}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            print(json.dumps({'error': 'bad json: ' + str(error)}), flush=True)
            continue
        if request.get('cmd') == 'ping':
            print(json.dumps({'id': request.get('id'), 'ok': True, 'device': parser.device}), flush=True)
            continue
        started = time.perf_counter()
        try:
            if 'texts' in request:
                result = {'id': request.get('id'), 'parses': parser.parse_many([str(t) for t in request['texts']], request.get('languages'))}
            else:
                result = {'id': request.get('id'), 'parse': parser.parse_many([str(request.get('text', ''))], [request.get('language')])[0]}
            result['ms'] = (time.perf_counter() - started) * 1000
            result['device'] = parser.device
        except Exception as error:  # report, never crash the worker
            result = {'id': request.get('id'), 'error': type(error).__name__ + ': ' + str(error)}
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
