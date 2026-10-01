/** Diversity keys for the corpus audit: masked input templates, target skeletons and MinHash near-duplicates. */
import {fnv1a, normalize} from './text.mjs';

const ENTITY = ' qentq ';
const IDENT = ' qidq ';
const NAME = 'qnameq';

const WORD_CHAR = /[\p{L}\d]/u;
/** Case-insensitive whole-word replacement by plain substring search (much faster than per-row regexes). */
function replaceWords(text, needles, replacement) {
  for (const needle of needles.sort((a, b) => b.length - a.length)) {
    const lowerNeedle = needle.toLowerCase();
    let lower = text.toLowerCase();
    if (lower.length !== text.length) continue;
    let from = 0;
    let index;
    while ((index = lower.indexOf(lowerNeedle, from)) !== -1) {
      const end = index + lowerNeedle.length;
      if ((index > 0 && WORD_CHAR.test(text[index - 1])) || (end < text.length && WORD_CHAR.test(text[end]))) {
        from = index + 1;
        continue;
      }
      text = text.slice(0, index) + replacement + text.slice(end);
      lower = text.toLowerCase();
      from = index + replacement.length;
    }
  }
  return text;
}

/**
 * Mask everything that varies between instances of one template: entity labels/heads/aliases, identifiers,
 * capitalized names (except sentence-initial words), mixed letter-digit names and digits. What remains is the
 * wording the generator reused.
 */
export function maskTemplate(message, row, vocabulary) {
  const surfaces = new Set();
  for (const entity of vocabulary.entities.values()) {
    for (const text of [entity.label, ...entity.surfaces.map(surface => surface.text)]) {
      if (!text) continue;
      surfaces.add(String(text));
      surfaces.add(String(text).split(',')[0]);
    }
  }
  const ids = [row.id, row.split_group_id, row.semantic_case_id, row.surface_group_id, ...vocabulary.entities.keys(), ...vocabulary.predicates.keys()]
    .filter(id => typeof id === 'string' && id.length > 2)
    .flatMap(id => [id, id.replace(/_/g, '-'), id.replace(/_/g, ' ')]);
  let text = replaceWords(String(message), [...surfaces].map(value => value.trim()).filter(value => value.length > 1), ENTITY);
  text = replaceWords(text, [...new Set(ids)], IDENT);
  text = text.replace(/\b[a-z]{1,5}[-_][a-z]{2,8}[-_]\d{2,}\b/gi, IDENT);
  const words = text.split(/(\s+)/);
  let sentenceStart = true;
  const masked = words.map(word => {
    if (/^\s+$/.test(word) || !word) {
      if (word.includes('\n')) sentenceStart = true;
      return word;
    }
    const core = word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
    let out = word;
    if (/(?=.*\p{L})(?=.*\d)/u.test(core)) out = word.replace(core, NAME);
    else if (!sentenceStart && /^\p{Lu}/u.test(core)) out = word.replace(core, NAME);
    sentenceStart = /[.?!:;]["'»”]?$/.test(word);
    return out;
  }).join('');
  return normalize(masked.replace(/\d+/g, '0')).replace(/\b(qentq|qidq|qnameq)(?: \1)+\b/g, '$1');
}

/** Abstract a target to its structure: wire names, entities, predicates, variables, literals, numbers, dates. */
export function targetSkeleton(target, vocabulary) {
  return String(target ?? '')
    .replace(/"(?:\\.|[^"\\])*"/g, '"S"')
    .split('\n')
    .map(line => line.replace(/@[A-Za-z0-9_:.-]+/g, '@w').replace(/[^\s"]+/g, term => {
      if (vocabulary.entities.has(term)) return 'E';
      if (vocabulary.predicates.has(term)) return 'P';
      if (term.startsWith('?')) return '?v';
      if (/^\d{4}-\d{2}(?:-\d{2})?(?:T[\d:.]+Z?)?$/.test(term)) return 'D';
      if (/^-?\d+(?:\.\d+)?$/.test(term)) return '0';
      if (/\d/.test(term) && /[_:]/.test(term)) return 'X';
      return term;
    }).trimEnd())
    .filter(line => line.trim())
    .join('\n');
}

const HASHES = 24;
const BANDS = 6;
const ROWS_PER_BAND = HASHES / BANDS;
const SEEDS = Array.from({length: HASHES}, (_, index) => [fnv1a(`a${index}`) | 1, fnv1a(`b${index}`)]);

/** MinHash signature over word 3-shingles of the normalized message. */
export function minhash(message) {
  const words = normalize(message).split(' ').filter(Boolean);
  const shingles = new Set();
  if (words.length < 3) shingles.add(fnv1a(words.join(' ')));
  for (let index = 0; index + 3 <= words.length; index++) shingles.add(fnv1a(words.slice(index, index + 3).join(' ')));
  const signature = new Uint32Array(HASHES).fill(0xffffffff);
  for (const shingle of shingles) {
    for (let index = 0; index < HASHES; index++) {
      const value = (Math.imul(shingle, SEEDS[index][0]) + SEEDS[index][1]) >>> 0;
      if (value < signature[index]) signature[index] = value;
    }
  }
  return signature;
}

export const similarity = (a, b) => {
  let equal = 0;
  for (let index = 0; index < a.length; index++) if (a[index] === b[index]) equal++;
  return equal / a.length;
};

/**
 * Locality-sensitive index for near-duplicate detection. Rows of one split group (paraphrases and linked
 * contrasts, which are near-identical by design) are never counted as each other's near-duplicates.
 * Bucket sizes are capped so a heavily templated corpus stays linear in time.
 */
export class NearDuplicateIndex {
  constructor({threshold = 0.8, bucketCap = 12} = {}) {
    this.threshold = threshold;
    this.bucketCap = bucketCap;
    this.buckets = new Map();
    this.signatures = [];
    this.meta = [];
  }

  /** Returns the earlier rows (indices) this row nearly duplicates, outside its own group. */
  add(signature, meta) {
    const index = this.signatures.length;
    const matches = new Set();
    for (let band = 0; band < BANDS; band++) {
      const key = `${band}:${Array.from(signature.subarray(band * ROWS_PER_BAND, (band + 1) * ROWS_PER_BAND)).join('.')}`;
      let bucket = this.buckets.get(key);
      if (!bucket) this.buckets.set(key, bucket = []);
      for (const other of bucket) {
        if (matches.has(other) || this.meta[other].group === meta.group) continue;
        if (similarity(signature, this.signatures[other]) >= this.threshold) matches.add(other);
      }
      if (bucket.length < this.bucketCap) bucket.push(index);
    }
    this.signatures.push(signature);
    this.meta.push(meta);
    return [...matches];
  }
}

/** Distribution summary for a Map of key -> count. */
export function distribution(counts, rows, top = 10) {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const topCount = sorted.slice(0, top).reduce((sum, [, count]) => sum + count, 0);
  return {
    distinct: counts.size,
    distinct_ratio: rows ? counts.size / rows : 0,
    top_share: rows ? topCount / rows : 0,
    top: sorted.slice(0, top).map(([key, count]) => ({key, count, share: rows ? count / rows : 0})),
  };
}
