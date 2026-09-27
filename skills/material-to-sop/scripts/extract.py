#!/usr/bin/env python3
"""Offline, bounded extraction of DOCX paragraphs and HTML text blocks."""
import json
import sys
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

LIMIT = 2_000_000
WORD = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def docx(file):
    with zipfile.ZipFile(file) as archive:
        members = archive.infolist()
        if any(member.file_size > LIMIT for member in members):
            raise ValueError('DOCX contains an oversized member')
        if sum(member.file_size for member in members) > 4 * LIMIT:
            raise ValueError('DOCX uncompressed size exceeds limit')
        if any(member.flag_bits & 1 for member in members):
            raise ValueError('Encrypted DOCX is unsupported')
        if not {'[Content_Types].xml', '_rels/.rels', 'word/document.xml'} <= set(archive.namelist()):
            raise ValueError('DOCX package is incomplete')
        if any(name.startswith(('word/footnotes', 'word/endnotes', 'word/comments',
                                'word/header', 'word/footer')) for name in archive.namelist()):
            raise ValueError('DOCX footnotes, comments and headers/footers are unsupported')
        root = ET.fromstring(archive.read('word/document.xml'))
    paragraphs = []
    for paragraph in root.iter(WORD + 'p'):
        # Reject drawings/field codes: flattening them would silently lose meaning.
        if any(el.tag in (WORD + 'drawing', WORD + 'instrText', WORD + 'fldChar',
                          WORD + 'ins', WORD + 'del', WORD + 'pict', WORD + 'object')
               for el in paragraph.iter()):
            raise ValueError('DOCX drawings, fields and tracked changes are unsupported')
        chunks = []
        for el in paragraph.iter():
            if el.tag == WORD + 't':
                chunks.append(el.text or '')
            elif el.tag == WORD + 'tab':
                chunks.append('\t')
            elif el.tag in (WORD + 'br', WORD + 'cr'):
                chunks.append('\n')
        if ''.join(chunks).strip():
            paragraphs.append(''.join(chunks))
    return paragraphs


class Blocks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.chunks = []
        self.blocks = []

    def flush(self):
        value = ''.join(self.chunks).strip()
        if value:
            self.blocks.append(value)
        self.chunks = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'template', 'noscript'):
            self.skip += 1
        if self.skip:
            return
        if tag in ('p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr'):
            self.flush()
        elif tag == 'br':
            self.chunks.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'template', 'noscript'):
            self.skip = max(0, self.skip - 1)
            return
        if not self.skip and tag in ('p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr'):
            self.flush()

    def handle_data(self, data):
        if not self.skip:
            self.chunks.append(data)


def html(file):
    with open(file, 'rb') as stream:
        raw = stream.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError('HTML input exceeds extraction limit')
    parser = Blocks()
    parser.feed(raw.decode('utf-8', errors='strict'))
    parser.close()
    parser.flush()
    return parser.blocks


if __name__ == '__main__':
    try:
        kind, file = sys.argv[1:]
        passages = docx(file) if kind == 'docx' else html(file) if kind == 'html' else None
        if passages is None or not passages:
            raise ValueError('No extractable text passages')
        print(json.dumps(passages, ensure_ascii=False))
    except (ValueError, OSError, zipfile.BadZipFile, ET.ParseError, UnicodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
