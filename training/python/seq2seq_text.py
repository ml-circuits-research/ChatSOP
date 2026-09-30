"""Reversible line encoding of the seq2seq source and target (formalizer-mt-v1, DS007).

SentencePiece normalization in translation tokenizers (Marian, mT5) turns newlines and runs of spaces into a single
space, but SOP wires are line-oriented and their field indentation is significant (sop/parser.mjs). The target is
therefore linearized: every line break followed by an indentation of 2*K spaces becomes the added token `<nK>`. The
decoding is exact for every canonical SOP program (indentation is always a multiple of two spaces, K <= 7). In the
source message a line break becomes `<n0>`, so list and paragraph structure survives tokenization; the source is
never decoded. Neither transform adds information: the model input is still exactly the user's message (DS021).
"""
import re

LINE_TOKENS=[f'<n{k}>' for k in range(8)]
_SPLIT=re.compile(r' ?<n([0-7])> ?')

def encode_target(sop):
    lines=sop.split('\n');out=lines[0]
    for line in lines[1:]:
        stripped=line.lstrip(' ');indent=len(line)-len(stripped)
        if indent%2 or indent>14 or (stripped=='' and indent): raise ValueError(f'Unencodable indentation in line {line!r}')
        out+=f' <n{indent//2}> '+stripped
    return out

def decode_target(text):
    parts=_SPLIT.split(text.strip())
    out=parts[0]
    for i in range(1,len(parts),2):out+='\n'+'  '*int(parts[i])+parts[i+1]
    return out

def encode_source(message):
    return re.sub(r'\r?\n',' <n0> ',message)
