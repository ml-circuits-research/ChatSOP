import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashJsonlSharded, jsonlBytes, readJsonlSharded } from '../../lib/jsonl-shards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cache = name => path.join(root, 'datasets_sources', name);
const output = path.join(root, 'eval/reports/current/rights/source-themes.json');
const sources = {
  paws: { splits: { validation: { file: 'validation.jsonl', format: 'jsonl' }, train: { file: 'train.jsonl', format: 'jsonl' } } },
  qa2d: { splits: { dev: { file: 'dev.jsonl', format: 'jsonl' }, train: { file: 'train.jsonl', format: 'jsonl' } } },
  proofwriter_structured: { folder: 'proofwriter-structured', splits: { OWA_validation: { file: 'OWA-validation.jsonl', format: 'jsonl' }, OWA_train: { file: 'OWA-train.jsonl', format: 'jsonl' }, OWA_test: { file: 'OWA-test.jsonl', format: 'jsonl' } } },
  qqp: { splits: { validation: { file: 'validation.jsonl', format: 'jsonl' }, train: { file: 'train.jsonl', format: 'jsonl' } } },
  ambignq: { splits: { dev_light: { file: 'dev_light.json', format: 'json', duplicate_of: 'dev_full' }, train_full: { file: 'train.json', format: 'json' }, dev_full: { file: 'dev.json', format: 'json' } } },
};
const topicCues = {
  geography_places: 'city cities town towns village villages country countries river rivers island islands mountain mountains region regions',
  physical_earth_sciences: 'planet planets star stars physics chemical chemistry earthquake earthquakes geology mineral minerals',
  life_sciences_health: 'animal animals bird birds fish species plant plants medical medicine disease diseases hospital hospitals',
  history_society: 'century centuries war wars dynasty dynasties empire empires ancient medieval historical history revolution revolutions',
  arts_books_language: 'film films movie movies music musical album albums song songs book books novel novels artist artists language languages',
  sports_leisure: 'football baseball basketball tennis cricket soccer league leagues tournament tournaments olympic olympics',
  travel_transport: 'airport airports airline airlines aircraft airplane airplanes train trains railway railways ship ships road roads',
  commerce_services: 'company companies business businesses market markets bank banks financial finance money trade trading',
  education_research: 'school schools university universities college colleges professor professors student students research laboratory laboratories',
  agriculture_food: 'farm farms farmer farmers crop crops wheat rice food foods fruit fruits cattle agriculture agricultural',
  weather_climate: 'climate weather storm storms hurricane hurricanes rain rainfall snow temperature temperatures drought droughts',
  technology_infrastructure: 'computer computers software internet network networks engine engines machine machines bridge bridges',
  law_administration: 'court courts judge judges legal law laws government governments election elections president presidents',
  everyday_household: 'house houses home homes room rooms door doors kitchen kitchens family families child children',
};
const topics = Object.entries(topicCues).map(([name, words]) => [name, new Set(words.split(' '))]);
const contrastCues = {
  negation: new Set(['not', 'no', 'never', 'neither', 'nor', 'without', 'cannot', "n't"]),
  quantifier: new Set(['all', 'any', 'both', 'each', 'every', 'few', 'many', 'most', 'several', 'some', 'none']),
  temporal: new Set(['before', 'after', 'during', 'since', 'until', 'earlier', 'later', 'first', 'last', 'year', 'century']),
  comparison: new Set(['more', 'less', 'fewer', 'than', 'higher', 'lower', 'largest', 'smallest', 'best', 'worst']),
};
const tokenize = text => (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []);
const lengths = () => ({ count: 0, min: null, max: 0, sum: 0, bands: { '0-9': 0, '10-19': 0, '20-39': 0, '40-79': 0, '80+': 0 } });
function addLength(distribution, tokens) {
  const n = tokens.length;
  distribution.count++;
  distribution.sum += n;
  distribution.min = Math.min(distribution.min ?? n, n);
  distribution.max = Math.max(distribution.max, n);
  distribution.bands[n < 10 ? '0-9' : n < 20 ? '10-19' : n < 40 ? '20-39' : n < 80 ? '40-79' : '80+']++;
}
const tally = (object, key) => { object[key] = (object[key] ?? 0) + 1; };
const multisets = tokens => {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
};
const equal = (left, right) => left.size === right.size && [...left].every(([word, n]) => right.get(word) === n);
const cueCounts = (tokens, cues) => multisets(tokens.filter(token => cues.has(token)));
function category(text) {
  if (/^how many\b/i.test(text.trim())) return 'how_many';
  if (/^(?:is|are|was|were|do|does|did|can|could|will|would|has|have|had|should)\b/i.test(text.trim())) return 'is_it_true';
  if (/^what\b/i.test(text.trim())) return 'what';
  if (/^which\b/i.test(text.trim())) return 'which';
  if (/^who\b/i.test(text.trim())) return 'who';
  return /\?$/.test(text.trim()) ? 'other_question' : 'statement';
}
async function verify(folder) {
  const p = JSON.parse(fs.readFileSync(path.join(cache(folder), 'provenance.json'), 'utf8'));
  for (const file of p.files) {
    if (file.path.includes('/') || file.path.includes('..')) throw Error(`Unsafe provenance path: ${file.path}`);
    const filename = path.join(cache(folder), file.path);
    // A large JSONL cache may be sharded (lib/jsonl-shards.mjs); its concatenated parts carry the recorded size and hash.
    const sharded = filename.endsWith('.jsonl');
    if ((sharded ? jsonlBytes(filename) : fs.statSync(filename).size) !== file.bytes) throw Error(`Source cache size mismatch: ${folder}/${file.path}`);
    let digest;
    if (sharded) digest = await hashJsonlSharded(filename);
    else {
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
      digest = hash.digest('hex');
    }
    if (digest !== file.sha256) throw Error(`Source cache hash mismatch: ${folder}/${file.path}`);
  }
  return p;
}
async function* records(folder, config) {
  const filename = path.join(cache(folder), config.file);
  if (config.format === 'json') {
    const rows = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!Array.isArray(rows)) throw Error(`Expected array of records in ${filename}`);
    yield* rows;
  } else {
    yield* readJsonlSharded(filename);
  }
}
function inventory() {
  return {
    rows: 0,
    text_length_tokens: {},
    themes: { primary: { unclassified: 0 }, multi_label: {}, primary_ties: 0 },
    question_types: {},
    structural_cues: Object.fromEntries(Object.keys(contrastCues).map(name => [name, 0])),
    pair_contrasts: { argument_order_token_permutation: 0, negation_cue_change: 0, quantifier_cue_change: 0, temporal_cue_change: 0, comparison_cue_change: 0 },
  };
}
function observe(item, role, text) {
  if (typeof text !== 'string') throw Error(`Expected string in ${role}`);
  const words = tokenize(text);
  (item.text_length_tokens[role] ??= lengths());
  addLength(item.text_length_tokens[role], words);
  return words;
}
function observeRow(item, texts, question) {
  item.rows++;
  const tokenSets = texts.map(([role, text]) => observe(item, role, text));
  const all = new Set(tokenSets.flat());
  const ranked = topics.map(([name, lexicon]) => [name, [...all].filter(word => lexicon.has(word)).length]);
  const high = Math.max(...ranked.map(([, n]) => n));
  const matched = ranked.filter(([, n]) => n > 0);
  for (const [name] of matched) tally(item.themes.multi_label, name);
  if (!high) item.themes.primary.unclassified++;
  else {
    const winners = ranked.filter(([, n]) => n === high);
    tally(item.themes.primary, winners[0][0]);
    if (winners.length > 1) item.themes.primary_ties++;
  }
  if (question !== null) tally(item.question_types, category(question));
  for (const [name, cues] of Object.entries(contrastCues)) if (tokenSets.some(words => words.some(word => cues.has(word)))) item.structural_cues[name]++;
  if (tokenSets.length === 2) {
    const [a, b] = tokenSets;
    if (a.length === b.length && equal(multisets(a), multisets(b)) && a.some((word, i) => word !== b[i])) item.pair_contrasts.argument_order_token_permutation++;
    for (const [name, cues] of Object.entries(contrastCues)) {
      if (!equal(cueCounts(a, cues), cueCounts(b, cues))) item.pair_contrasts[`${name}_cue_change`]++;
    }
  }
}
function finish(item) {
  for (const distribution of Object.values(item.text_length_tokens)) {
    distribution.mean = distribution.count ? Number((distribution.sum / distribution.count).toFixed(2)) : null;
    delete distribution.sum;
  }
  item.themes.primary = Object.fromEntries([['unclassified', item.themes.primary.unclassified], ...topics.map(([name]) => [name, item.themes.primary[name] ?? 0])]);
  item.themes.multi_label = Object.fromEntries(topics.map(([name]) => [name, item.themes.multi_label[name] ?? 0]));
  item.question_types = Object.fromEntries(['what', 'which', 'who', 'how_many', 'is_it_true', 'other_question', 'statement'].map(name => [name, item.question_types[name] ?? 0]));
}
function mergeCounts(into, from) {
  for (const [key, value] of Object.entries(from)) {
    if (typeof value === 'number') into[key] = (into[key] ?? 0) + value;
    else mergeCounts(into[key] ??= {}, value);
  }
}
function rollup(summary, item) {
  summary.rows += item.rows;
  for (const [role, distribution] of Object.entries(item.text_length_tokens)) {
    const total = summary.text_length_tokens[role] ??= lengths();
    total.min = Math.min(total.min ?? distribution.min, distribution.min);
    total.max = Math.max(total.max, distribution.max);
    total.count += distribution.count;
    total.sum += distribution.sum;
    mergeCounts(total.bands, distribution.bands);
  }
  for (const [field, value] of Object.entries(item)) {
    if (['rows', 'sample', 'source_sha256', 'text_length_tokens'].includes(field)) continue;
    mergeCounts(summary[field] ??= {}, value);
  }
}
const report = {
  method: 'Deterministic source-only lexical inventory by split; source row totals count disjoint splits, excluding AmbigNQ light dev because it represents the same questions as full dev. Lengths count Unicode letter/number tokens; bands are inclusive integers. Topic primary uses most DISTINCT fixed lexicon cues, ties fixed lexicon order. All lexical shape buckets are proxies, not semantic annotations. Pair contrasts compare two text fields only; argument-order proxy is equal token multisets but unequal sequence. No original text, IDs, answers or proofs appear in this report.',
  topic_cues: topicCues,
  contrast_cues: Object.fromEntries(Object.entries(contrastCues).map(([key, set]) => [key, [...set]])),
  sources: {},
};
for (const [name, source] of Object.entries(sources)) {
  const folder = source.folder ?? name;
  const p = await verify(folder);
  const summary = { ...inventory(), splits: {} };
  for (const [split, config] of Object.entries(source.splits)) {
    const item = inventory();
    item.sample = config.file;
    item.source_sha256 = p.files.find(f => f.path === config.file)?.sha256;
    if (!item.source_sha256) throw Error(`Missing provenance for ${folder}/${config.file}`);
    if (name === 'proofwriter_structured') {
      item.rule_derivation_shapes = { theory_depth: {}, fact_count: {}, rule_count: {}, rule_body_size: {}, derivation_depth_qdep: {}, chain_nodes_qdep_plus_one: {}, question_leaf_count_qlen: {}, status: {}, strategy: {}, formal_polarity: {}, reversed_fact_argument_pairs: 0, total_rules: 0, total_questions: 0 };
    }
    if (name === 'ambignq') item.annotation_shapes = { single_answer_annotations: 0, multiple_qa_annotations: 0, multiple_qa_pair_count: {}, annotations_per_row: {} };
    if (name === 'qqp' || name === 'paws') item.pair_labels = {};
    if (name === 'qa2d') item.missing_text_fields = {};
    for await (const row of records(folder, config)) {
    if (name === 'paws') {
      observeRow(item, [['sentence1', row.sentence1], ['sentence2', row.sentence2]], null);
      tally(item.pair_labels, String(row.label));
    } else if (name === 'qa2d') {
      observeRow(item, [['question', row.question], ['declarative', row.turker_answer]], row.question);
      if (row.answer === null) tally(item.missing_text_fields, 'answer');
      else observe(item, 'answer', row.answer);
    } else if (name === 'qqp') {
      observeRow(item, [['question1', row.question1], ['question2', row.question2]], row.question1);
      tally(item.question_types, category(row.question2));
      tally(item.pair_labels, String(row.label));
    } else if (name === 'ambignq') {
      observeRow(item, [['question', row.question]], row.question);
      if (!Array.isArray(row.annotations)) throw Error('Malformed AmbigNQ annotations');
      tally(item.annotation_shapes.annotations_per_row, String(row.annotations.length));
      for (const annotation of row.annotations) {
        if (annotation.type === 'singleAnswer') item.annotation_shapes.single_answer_annotations++;
        else if (annotation.type === 'multipleQAs') {
          item.annotation_shapes.multiple_qa_annotations++;
          tally(item.annotation_shapes.multiple_qa_pair_count, String(annotation.qaPairs.length));
          for (const pair of annotation.qaPairs) {
            observe(item, 'disambiguated_question', pair.question);
            tally(item.question_types, category(pair.question));
          }
        } else throw Error('Unexpected AmbigNQ annotation type');
      }
    } else {
      observeRow(item, [['theory', row.theory_text]], null);
      const shape = item.rule_derivation_shapes;
      tally(shape.theory_depth, String(row.depth));
      tally(shape.fact_count, String(row.facts.length));
      tally(shape.rule_count, String(row.rules.length));
      const facts = new Set(row.facts.map(fact => JSON.stringify([fact.subject, fact.relation, fact.object])));
      for (const fact of row.facts) {
        tally(shape.formal_polarity, String(fact.polarity));
        if (fact.subject < fact.object && facts.has(JSON.stringify([fact.object, fact.relation, fact.subject])))
          shape.reversed_fact_argument_pairs++;
      }
      for (const rule of row.rules) {
        shape.total_rules++;
        tally(shape.rule_body_size, String(rule.premises.length));
        tally(shape.formal_polarity, String(rule.conclusion.polarity));
        for (const premise of rule.premises) tally(shape.formal_polarity, String(premise.polarity));
      }
      for (const q of row.questions) {
        shape.total_questions++;
        observe(item, 'question_statement', q.text);
        tally(item.question_types, category(q.text));
        tally(shape.status, String(q.answer));
        tally(shape.strategy, String(q.strategy));
        tally(shape.derivation_depth_qdep, String(q.qdep ?? 'unavailable'));
        tally(shape.chain_nodes_qdep_plus_one, Number.isInteger(q.qdep) ? String(q.qdep + 1) : 'unavailable');
        tally(shape.question_leaf_count_qlen, String(q.qlen ?? 'unavailable'));
      }
    }
  }
    if (!config.duplicate_of) rollup(summary, item);
    finish(item);
    if (config.duplicate_of) item.duplicate_of = config.duplicate_of;
    summary.splits[split] = item;
  }
  finish(summary);
  report.sources[name] = summary;
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Wrote ${path.relative(root, output)}; ${Object.entries(report.sources).map(([name, item]) => `${name}: ${item.rows} rows`).join(', ')}`);
