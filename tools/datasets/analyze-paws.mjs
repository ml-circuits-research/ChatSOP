import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cache = path.join(root, 'datasets_sources/paws');
const output = path.join(root, 'eval/reports/current/rights/paws-structure.json');
const provenance = JSON.parse(fs.readFileSync(path.join(cache, 'provenance.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
for (const entry of provenance.files) {
  const bytes = fs.readFileSync(path.join(cache, entry.path));
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
    throw Error(`PAWS source cache mismatch: ${entry.path}`);
}
const license = fs.readFileSync(path.join(cache, 'LICENSE'), 'utf8');
if (!license.includes('freely used for any purpose') || !license.includes('acknowledgement of\nGoogle LLC'))
  throw Error('PAWS license text no longer matches recorded rights');

// Detection is lexical and non-exclusive. It never asserts that a pattern
// causes (non-)equivalence or that every linguistic role swap was recovered.
const tokenize = text => (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []);
const punctuation = text => (text.match(/[^\p{L}\p{N}\s]/gu) ?? []).join('');
const frequencies = tokens => {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
};
const multisetEqual = (left, right) => left.size === right.size &&
  [...left].every(([token, count]) => right.get(token) === count);
const cueChange = (left, right, cues) => !multisetEqual(
  frequencies(left.filter(token => cues.has(token))),
  frequencies(right.filter(token => cues.has(token))),
);
const negation = new Set(['not', 'no', 'never', 'neither', 'nor', "n't", 'cannot', 'without']);
const quantifier = new Set(['all', 'any', 'both', 'each', 'every', 'few', 'many', 'most', 'several', 'some', 'none', 'one', 'two']);
const markerPairs = [['from', 'to'], ['by', 'for'], ['before', 'after'], ['over', 'under']];
const following = (tokens, marker) => tokens.flatMap((token, index) => token === marker && tokens[index + 1] ? [tokens[index + 1]] : []);
const roleSwap = (left, right) => markerPairs.some(([a, b]) => {
  const la = following(left, a), lb = following(left, b), ra = following(right, a), rb = following(right, b);
  return la.length === 1 && lb.length === 1 && ra.length === 1 && rb.length === 1 &&
    la[0] !== lb[0] && la[0] === rb[0] && lb[0] === ra[0];
});
const names = ['word_order_swap', 'negation_cue_change', 'quantifier_cue_change', 'role_marker_swap', 'punctuation_change'];
// Coarse topic proxies count only predeclared generic cues, not extracted
// source phrases. The primary bucket chooses most matching distinct cues;
// tied buckets follow this fixed order. This is not a topical annotation.
const topicCues = {
  geography_places: 'city cities town towns village villages country countries province provinces river rivers island islands mountain mountains lake lakes region regions',
  physical_earth_sciences: 'planet planets star stars asteroid asteroids earthquake earthquakes geology geological mineral minerals physics chemical chemistry',
  life_sciences_health: 'animal animals species plant plants bird birds fish trees forest forests medical medicine disease diseases hospital hospitals patient patients',
  history_society: 'century centuries war wars dynasty dynasties empire empires ancient medieval historical history revolution revolutions',
  arts_books_language: 'film films movie movies music musical album albums song songs book books novel novels writer writers artist artists painting paintings language languages',
  sports_leisure: 'football baseball basketball tennis cricket soccer league leagues match matches tournament tournaments championship championships olympic olympics',
  travel_transport: 'airport airports airline airlines aircraft airplane airplanes train trains railway railways ship ships vessel vessels flight flights road roads',
  commerce_services: 'company companies business businesses market markets bank banks financial finance money trade trading purchase purchases',
  education_research: 'school schools university universities college colleges professor professors student students research researcher researchers laboratory laboratories',
  agriculture_food: 'farm farms farmer farmers crop crops wheat rice food foods fruit fruits cattle agriculture agricultural',
  weather_climate: 'climate weather storm storms hurricane hurricanes rain rainfall snow temperature temperatures drought droughts',
  technology_infrastructure: 'computer computers software internet network networks engine engines machine machines bridge bridges station stations',
  law_administration: 'court courts judge judges legal law laws government governments election elections president presidents parliament parliaments',
  everyday_household: 'house houses home homes room rooms door doors kitchen kitchens family families child children',
};
const topicLexicons = Object.fromEntries(Object.entries(topicCues).map(([name, cues]) => [name, new Set(cues.split(' '))]));
const topicCounts = Object.fromEntries(Object.keys(topicLexicons).map(name => [name, 0]));
const multiTopicCounts = { ...topicCounts };
topicCounts.unclassified = 0;
const ties = { count: 0 };
const overlapBands = ['0-<0.1', '0.1-<0.2', '0.2-<0.3', '0.3-<0.4', '0.4-<0.5', '0.5-<0.6', '0.6-<0.7', '0.7-<0.8', '0.8-<0.9', '0.9-<1', '1'];
const tally = () => ({ pairs: 0, overlap_buckets: Object.fromEntries(overlapBands.map(key => [key, 0])),
  overlap_sum: 0, pattern_counts: Object.fromEntries(names.map(name => [name, 0])) });
const classes = { non_paraphrase: tally(), paraphrase: tally() };
const lines = fs.readFileSync(path.join(cache, 'validation.jsonl'), 'utf8').trimEnd().split('\n');
for (const [index, line] of lines.entries()) {
  const row = JSON.parse(line);
  if (!Number.isInteger(row.id) || typeof row.sentence1 !== 'string' || typeof row.sentence2 !== 'string' || ![0, 1].includes(row.label))
    throw Error(`Malformed PAWS sample record at line ${index + 1}`);
  const bucket = classes[row.label === 1 ? 'paraphrase' : 'non_paraphrase'];
  const left = tokenize(row.sentence1), right = tokenize(row.sentence2);
  const pairWords = new Set([...left, ...right]);
  const topicScores = Object.entries(topicLexicons).map(([name, cues]) =>
    [name, [...pairWords].filter(token => cues.has(token)).length]);
  const maxScore = Math.max(...topicScores.map(([, score]) => score));
  const matchingTopics = topicScores.filter(([, score]) => score > 0);
  for (const [name] of matchingTopics) multiTopicCounts[name]++;
  if (!maxScore) topicCounts.unclassified++;
  else {
    const best = topicScores.filter(([, score]) => score === maxScore);
    topicCounts[best[0][0]]++;
    if (best.length > 1) ties.count++;
  }
  const a = frequencies(left), b = frequencies(right);
  const intersection = [...a].reduce((sum, [token, count]) => sum + Math.min(count, b.get(token) ?? 0), 0);
  const union = left.length + right.length - intersection;
  const overlap = union ? intersection / union : 1;
  const band = overlap === 1 ? '1' : overlapBands[Math.min(Math.floor(overlap * 10), 9)];
  bucket.pairs++;
  bucket.overlap_buckets[band]++;
  bucket.overlap_sum += overlap;
  const detected = {
    word_order_swap: multisetEqual(a, b) && left.some((token, i) => token !== right[i]),
    negation_cue_change: cueChange(left, right, negation),
    quantifier_cue_change: cueChange(left, right, quantifier),
    role_marker_swap: roleSwap(left, right),
    punctuation_change: punctuation(row.sentence1) !== punctuation(row.sentence2),
  };
  for (const name of names) if (detected[name]) bucket.pattern_counts[name]++;
}
for (const bucket of Object.values(classes)) {
  bucket.mean_multiset_jaccard = Number((bucket.overlap_sum / bucket.pairs).toFixed(4));
  delete bucket.overlap_sum;
}
const report = {
  sample: 'PAWS-Wiki labeled_final validation only (not PAWS-QQP)',
  source_sha256: provenance.files.find(file => file.path === 'validation-00000-of-00001.parquet').sha256,
  derived_jsonl_sha256: provenance.files.find(file => file.path === 'validation.jsonl').sha256,
  pair_counts: { total: lines.length, non_paraphrase: classes.non_paraphrase.pairs, paraphrase: classes.paraphrase.pairs },
  overlap_metric: 'Lowercase Unicode alphanumeric/apostrophe token multiset Jaccard: sum of minimum token frequencies / sum of maximum token frequencies. Buckets are left-closed, right-open, except 1.',
  pattern_definitions: {
    word_order_swap: 'Identical lowercased token multisets, but a different token sequence.',
    negation_cue_change: 'Different token counts for a fixed negation-cue lexicon; does not prove logical negation.',
    quantifier_cue_change: 'Different token counts for a fixed quantifier-cue lexicon; does not prove scope change.',
    role_marker_swap: 'For one from/to, by/for, before/after, or over/under marker pair, the unique following tokens exchange markers.',
    punctuation_change: 'Punctuation-character sequences differ; not a semantic punctuation analysis.',
  },
  classes,
  topical_distribution: {
    method: 'Keyword-only coarse proxy on both sentences (distinct cue matches). Exclusive primary bucket uses highest distinct-cue count with fixed-order ties; multi-label buckets overlap. Unclassified means no cue matched. Not human domain labels.',
    cue_lexicons: topicCues,
    primary_bucket_pairs: topicCounts,
    multi_label_bucket_pairs: multiTopicCounts,
    primary_bucket_ties: ties.count,
  },
  limitations: ['Lexical heuristics overlap and may miss or misclassify linguistic patterns and domains.', 'Only the pinned Wikipedia-derived validation split was measured.', 'No sentence, source pair, source id, or source answer is exported to this aggregate report.'],
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Wrote ${path.relative(root, output)}: ${lines.length} pairs`);
