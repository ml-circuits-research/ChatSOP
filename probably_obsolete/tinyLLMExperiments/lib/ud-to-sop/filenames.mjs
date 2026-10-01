/**
 * File names and paths as one name token (v2.6). Stanza splits `@questions.md` or `docs/wire_types.html` at the dot, the slash and the `@`;
 * the pieces then become separate words and the rules or the interpretation report a piece such as `md` as "not represented".
 * `mergeFileNames(parse)` joins the words that overlap a file-name span of the parsed text into one `PROPN` word whose text is the span
 * itself; the merged word takes the dependency of the word that attached the span to the rest of the sentence, and the children of the
 * other pieces move to it. Word ids are renumbered. The input is not modified.
 */
const EXTENSIONS = 'md|mjs|cjs|js|jsx|ts|tsx|json|jsonl|html|htm|css|txt|py|sh|csv|tsv|yaml|yml|toml|xml|sop|log|pdf|docx|xlsx|pptx|png|jpg|jpeg|gif|svg|zip|gguf|ipynb|sql|ini|cfg|lock';
/** `@name`, `name.ext` (known extension) or `dir/path-like` (at least one slash, no spaces). */
const FILE = new RegExp(`(?<![\\p{L}\\p{N}_./@-])(?:@[\\w][\\w./-]*|[\\w][\\w-]*(?:[./][\\w-]+)*\\.(?:${EXTENSIONS})(?![\\p{L}\\p{N}_])|[\\w.-]+(?:/[\\w.-]+)+)`, 'gu');
const TRAIL = /[.,;:!?)\]]+$/;

export function fileNameSpans(text) {
  const spans = [];
  for (const m of String(text).matchAll(FILE)) {
    let value = m[0].replace(TRAIL, '');
    if (!/[A-Za-z]/.test(value) || /^[\d./-]+$/.test(value)) continue; // dates, versions, fractions
    if (/^(?:and|or|he|she|his|her|him|they|yes|no|[a-z])\/\w+$|\/(?:or|and|she|he|her|his|him|they)$/i.test(value) && !/\.\w+$/.test(value)) continue; // "and/or", "he/she"
    spans.push({start: m.index, end: m.index + value.length});
  }
  return spans;
}

export function mergeFileNames(parse) {
  const text = parse?.text;
  if (typeof text !== 'string') return parse;
  const spans = fileNameSpans(text);
  if (!spans.length) return parse;
  const sentences = (parse.sentences ?? []).map(sentence => {
    const words = sentence.words ?? [];
    const groups = [];
    for (const span of spans) {
      const inside = words.filter(w => Number.isInteger(w.start) && w.start < span.end && w.end > span.start);
      if (inside.length >= 2 || (inside.length === 1 && (inside[0].end - inside[0].start) !== span.end - span.start && (inside[0].upos === 'PUNCT' || /[./@]/.test(text.slice(span.start, span.end))))) groups.push({span, ids: new Set(inside.map(w => w.id)), words: inside});
    }
    if (!groups.length) return sentence;
    const remap = new Map(); // old id → id of the surviving word
    const merged = new Map(); // surviving old id → merged word
    for (const g of groups) {
      const outer = g.words.find(w => !g.ids.has(w.head)) ?? g.words[0];
      const from = Math.min(...g.words.map(w => w.start)), to = Math.max(...g.words.map(w => w.end));
      const start = Math.min(from, g.span.start), end = Math.max(to, g.span.end);
      const textOf = text.slice(start, end);
      merged.set(outer.id, {...outer, text: textOf, token: textOf, lemma: textOf, upos: 'PROPN', xpos: 'NNP', feats: {}, start, end, ner: 'O', head: outer.head});
      for (const w of g.words) remap.set(w.id, outer.id);
    }
    const kept = words.filter(w => !remap.has(w.id) || merged.has(w.id)).map(w => merged.get(w.id) ?? w);
    const fresh = new Map(kept.map((w, i) => [w.id, i + 1]));
    const out = kept.map(w => {
      let head = remap.get(w.head) ?? w.head;
      if (head === w.id) head = remap.get(words.find(x => x.id === w.head)?.head) ?? 0; // a piece that headed the merged word
      return {...w, id: fresh.get(w.id), head: head ? fresh.get(head) ?? 0 : 0};
    });
    return {...sentence, words: out};
  });
  return {...parse, sentences};
}
