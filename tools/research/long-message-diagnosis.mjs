#!/usr/bin/env node
/** Why the formalizer fails on long messages: truncation, genuine errors, metric strictness, gold and harness checks.
 *
 * Reads existing predictions only (no model is run): SmolLM2-135M Q8_0 on the formalizer-v1 sealed test, its
 * training-time dev predictions (HF generation), the prompted Haiku no-thinking sample, and Gemma 3 270M where
 * predictions exist. A row is "long" when it belongs to the `long_message` family (DS022; every such test message
 * has more than 300 characters, the split used by training/scripts/evaluate-arm.sh). Partial credit uses the wire
 * comparison of eval/metrics.mjs (DS016 "Wire F1"). Writes eval/reports/current/long-messages/diagnosis.json.
 *
 *   node tools/research/long-message-diagnosis.mjs [--out eval/reports/current/long-messages/diagnosis.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {parse} from '../../sop/parser.mjs';
import {propositionOf} from '../../sop/propositions.mjs';
import {rowWireComparison, wireMetrics, wireKeys} from '../../eval/metrics.mjs';
import {sampleRows} from './predict-endpoint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = file => path.join(root, file);
const exists = file => fs.existsSync(at(file));
const readJson = file => JSON.parse(fs.readFileSync(at(file), 'utf8'));
const byId = rows => new Map(rows.map(row => [row.id, row]));
const fold = text => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const round = x => x === null || x === undefined ? null : Math.round(x * 10000) / 10000;
const pct = (n, d) => ({n, d, value: d ? round(n / d) : null});
const isLong = row => row.family === 'long_message';
const quantiles = values => {
  const s = [...values].sort((a, b) => a - b), q = p => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
  return {count: s.length, mean: s.length ? round(s.reduce((a, b) => a + b, 0) / s.length) : null, p10: q(0.1), p50: q(0.5), p90: q(0.9), max: s.at(-1) ?? null};
};

const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'eval/reports/current/long-messages/diagnosis.json';
const test = readJsonlShardedSync(at('eval/suites/formalizer-v1/test.jsonl'));
const dev = readJsonlShardedSync(at('datasets_archive/formalizer-v1/dev.jsonl'));
const testById = byId(test), devById = byId(dev);

/** One prediction set: its rows, predictions and, when an evaluator report exists, per-row tolerant execution. */
function arm(name, suiteById, predictionFiles, evaluationFiles = []) {
  const predictions = new Map();
  for (const file of predictionFiles) if (exists(file)) for (const row of readJsonlShardedSync(at(file))) predictions.set(row.id, row.sop ?? row.prediction);
  const exec = new Map();
  for (const file of evaluationFiles) if (exists(file)) for (const record of readJson(file).records) exec.set(record.id, !!(record.execution_equivalent_tolerant ?? record.execution_equivalent));
  const rows = [...predictions.keys()].filter(id => suiteById.has(id)).map(id => suiteById.get(id));
  return {name, rows, predictions, exec};
}

const S = 'eval/reports/current/formalizer-size-v1/smollm2-135m', H = 'eval/reports/current/haiku-baseline', G = 'eval/reports/current/formalizer-size-v1/gemma';
const arms = [
  arm('smollm2-135m q8_0 (llama.cpp), formalizer-v1 test', testById, [`${S}/formalizer-v1-q8_0.predictions.jsonl`], [`${S}/formalizer-v1-q8_0/evaluation.json`]),
  arm('smollm2-135m (HF, training-time selection), formalizer-v1 dev', devById, ['models/smollm2-135m/fv1-size-a4/formalizer/semantic/step-00004467.predictions.jsonl'], ['models/smollm2-135m/fv1-size-a4/formalizer/semantic/step-00004467.json']),
  arm('haiku-4.5 no-thinking (prompted), formalizer-v1 test sample', testById, [`${H}/formalizer-v1-sample.nothink.predictions.jsonl`], [`${H}/formalizer-v1-sample.nothink.evaluation.json`]),
  arm('gemma-3-270m q8_0 (llama.cpp), formalizer-v1 test', testById, [`${G}/formalizer-v1-short-q8_0.predictions.jsonl`, `${G}/formalizer-v1-long-q8_0.predictions.jsonl`, `${G}/formalizer-v1-q8_0.predictions.jsonl`],
    [`${G}/formalizer-v1-q8_0/evaluation.json`, `${G}/formalizer-v1-short-q8_0/evaluation.json`, `${G}/formalizer-v1-long-q8_0/evaluation.json`]),
];

// ---------- 3. partial credit, short versus long ----------
function partial(a, rows) {
  const comparisons = rows.map(row => rowWireComparison(row, a.predictions.get(row.id)));
  const m = wireMetrics(comparisons);
  const withExec = rows.filter(row => a.exec.has(row.id));
  return {
    rows: rows.length,
    execution_equivalence_tolerant: withExec.length ? pct(withExec.filter(row => a.exec.get(row.id)).length, withExec.length) : null,
    wire_precision: round(m.precision.value), wire_recall: round(m.recall.value), wire_f1_micro: round(m.f1), wire_f1_mean_row: round(m.mean_row_f1),
    rows_wire_f1_at_least_0_9: pct(m.rows_f1_at_least_0_9.numerator, m.rows_f1_at_least_0_9.denominator),
    rows_all_wires_exact: pct(comparisons.filter(c => c.f1 === 1).length, comparisons.length),
    statements: {precision: round(m.statements.precision.value), recall: round(m.statements.recall.value), f1: round(m.statements.f1)},
    queries: {precision: round(m.problems.precision.value), recall: round(m.problems.recall.value), f1: round(m.problems.f1)},
    query_part_correct: pct(m.problems_correct.numerator, m.problems_correct.denominator),
    statement_part_correct: pct(comparisons.filter(c => c.statements.gold > 0 && c.statements.matched === c.statements.gold && c.statements.predicted === c.statements.gold).length, comparisons.filter(c => c.statements.gold > 0).length),
    unparsable_wires: m.unparsable_wires,
  };
}

// ---------- 1. truncation ----------
function lastBlockParses(text) {
  const blocks = String(text ?? '').split(/\n(?=@)/).map(b => b.trim()).filter(Boolean);
  if (!blocks.length) return false;
  try { parse(blocks.at(-1)); return true; } catch { return false; }
}
function truncation(a, rows) {
  const lengths = rows.map(row => ({gold: (row.sop_target.length), pred: String(a.predictions.get(row.id) ?? '').length}));
  let wholeParse = 0;
  for (const row of rows) { try { parse(a.predictions.get(row.id)); wholeParse++; } catch { /* counted below */ } }
  return {
    rows: rows.length,
    whole_prediction_parses: pct(wholeParse, rows.length),
    last_wire_parses: pct(rows.filter(row => lastBlockParses(a.predictions.get(row.id))).length, rows.length),
    empty_predictions: rows.filter(row => !String(a.predictions.get(row.id) ?? '').trim()).length,
    gold_chars: quantiles(lengths.map(l => l.gold)), prediction_chars: quantiles(lengths.map(l => l.pred)),
    prediction_to_gold_char_ratio: quantiles(lengths.map(l => round(l.pred / l.gold))),
    predictions_shorter_than_half_gold: rows.filter((row, i) => lengths[i].pred < lengths[i].gold / 2).length,
    last_gold_query_present: pct(rows.filter(row => {
      const gold = wireKeys(row.sop_target).filter(w => w.group === 'problems').at(-1);
      return gold && wireKeys(a.predictions.get(row.id) ?? '', {lenient: true}).some(w => w.key === gold.key);
    }).length, rows.filter(row => wireKeys(row.sop_target).some(w => w.group === 'problems')).length),
  };
}

// ---------- 2. genuine errors on long rows ----------
const stringValues = p => p.roles.map(r => r.value).filter(v => typeof v === 'string' && !v.startsWith('?'));
function statementsOf(text, lenient) {
  const blocks = lenient ? String(text ?? '').split(/\n(?=@)/).map(b => b.trim()).filter(b => b.startsWith('@')) : [text];
  const out = [];
  for (const block of blocks) {
    let wires; try { wires = parse(block).wires; } catch { continue; }
    for (const w of wires) if (w.type === 'stated' || w.type === 'assumed') { try { out.push({type: w.type, p: propositionOf(w)}); } catch { /* malformed */ } }
  }
  return out;
}
const sKey = s => JSON.stringify([s.type, fold(s.p.relation), s.p.roles.map(r => [r.name, fold(r.value)]).sort(), s.p.polarity, s.p.valid ?? {}]);
const segments = message => String(message).split(/\n+/).flatMap(line => /^\s*[-*•]\s/.test(line) ? [{text: line, list: true}] : line.split(/(?<=[.!?])\s+/).map(text => ({text, list: false})));
function extraOrigin(s, row, goldStatements) {
  const values = stringValues(s.p).map(fold).filter(Boolean);
  const message = fold(row.question);
  if (!values.length) return 'no_string_values';
  if (!values.every(v => message.includes(v))) return 'value_not_in_message';
  const segs = segments(row.question).map(seg => ({...seg, f: fold(seg.text)}));
  const home = segs.find(seg => values.every(v => seg.f.includes(v))) ?? segs.find(seg => seg.f.includes(values[0]));
  if (home?.list) return 'errand_list_item';
  if (home && /\?\s*$/.test(home.text.trim())) return 'question_turned_into_statement';
  const goldValues = new Set(goldStatements.flatMap(g => stringValues(g.p).map(fold)));
  if (values.some(v => goldValues.has(v))) return 'variant_or_duplicate_of_gold_statement';
  if (home && goldStatements.length === 0) return 'chit_chat_or_other';
  return values.some(v => segs.some(seg => seg.f.includes(v) && /\?/.test(seg.text))) ? 'question_turned_into_statement' : 'chit_chat_or_other';
}
function missingKind(g, predicted) {
  const rel = fold(g.p.relation), vals = stringValues(g.p).map(fold).sort().join('|'), names = g.p.roles.map(r => r.name).sort().join('|');
  const sameRel = predicted.filter(p => fold(p.p.relation) === rel), sameVals = predicted.filter(p => stringValues(p.p).map(fold).sort().join('|') === vals);
  if (sameRel.some(p => stringValues(p.p).map(fold).sort().join('|') === vals && p.p.roles.map(r => r.name).sort().join('|') === names && p.p.polarity !== g.p.polarity)) return 'polarity';
  if (sameVals.some(p => p.type !== g.type && fold(p.p.relation) === rel)) return 'stated_vs_assumed_or_validity';
  if (sameVals.some(p => fold(p.p.relation) === rel)) return 'roles_or_validity';
  if (sameVals.length) return 'relation_phrase';
  if (sameRel.length) return 'role_values';
  const anyValue = predicted.some(p => stringValues(p.p).map(fold).some(v => stringValues(g.p).map(fold).includes(v)));
  return anyValue ? 'partly_matching_values' : 'absent';
}
function queryShapeOf(text, lenient) {
  const blocks = lenient ? String(text ?? '').split(/\n(?=@)/).map(b => b.trim()).filter(b => b.startsWith('@')) : [text];
  const out = [];
  for (const block of blocks) { let wires; try { wires = parse(block).wires; } catch { continue; } for (const w of wires) if (w.type === 'query' || w.type === 'constraint') out.push(w); }
  return out;
}
const relationsOf = w => (w.fields.where ?? []).join('\n').match(/relation\s+"(?:\\.|[^"\\])*"/g)?.map(x => fold(JSON.parse(x.replace(/^relation\s+/, '')))) ?? [];
function genuineErrors(a, rows) {
  const missing = {}, extra = {}, queryMiss = {};
  let goldS = 0, predS = 0, goldQ = 0, predQ = 0;
  const positionRecall = {};
  for (const row of rows) {
    const pred = a.predictions.get(row.id);
    const gold = statementsOf(row.sop_target, false), predicted = statementsOf(pred, true);
    goldS += gold.length; predS += predicted.length;
    const pool = new Map();
    for (const p of predicted) pool.set(sKey(p), [...(pool.get(sKey(p)) ?? []), p]);
    const unmatchedGold = [];
    gold.forEach((g, index) => {
      const list = pool.get(sKey(g));
      const bucket = index < 10 ? `statement_${index + 1}` : 'statement_11_plus';
      positionRecall[bucket] ??= [0, 0]; positionRecall[bucket][1]++;
      if (list?.length) { list.pop(); positionRecall[bucket][0]++; } else unmatchedGold.push(g);
    });
    const leftovers = [...pool.values()].flat();
    for (const g of unmatchedGold) { const k = missingKind(g, leftovers); missing[k] = (missing[k] ?? 0) + 1; }
    for (const p of leftovers) { const k = extraOrigin(p, row, gold); extra[k] = (extra[k] ?? 0) + 1; }
    const gq = queryShapeOf(row.sop_target, false), pq = queryShapeOf(pred, true);
    goldQ += gq.length; predQ += pq.length;
    const goldKeys = wireKeys(row.sop_target).filter(w => w.group === 'problems').map(w => w.key);
    const predKeys = wireKeys(pred ?? '', {lenient: true}).filter(w => w.group === 'problems').map(w => w.key);
    const predRelations = pq.map(relationsOf);
    gq.forEach((q, index) => {
      if (predKeys.includes(goldKeys[index])) return;
      const rel = relationsOf(q), same = predRelations.findIndex(r => r.join() === rel.join());
      let kind;
      if (same < 0) kind = pq.length <= index ? 'query_missing' : 'relation_phrase_or_other_query';
      else {
        const p = pq[same];
        kind = (p.fields.mode ?? []).join() !== (q.fields.mode ?? []).join() || (p.fields.measure ?? []).join() !== (q.fields.measure ?? []).join() ? 'mode_or_measure'
          : (p.fields.except ?? []).length !== (q.fields.except ?? []).length || (p.fields.select ?? []).length !== (q.fields.select ?? []).length ? 'select_or_except'
          : 'role_values_or_polarity';
      }
      queryMiss[kind] = (queryMiss[kind] ?? 0) + 1;
    });
  }
  return {
    gold_statements: goldS, predicted_statements: predS, gold_queries: goldQ, predicted_queries: predQ,
    unmatched_gold_statements_by_kind: missing, unmatched_predicted_statements_by_origin: extra, unmatched_gold_queries_by_kind: queryMiss,
    statement_recall_by_position: Object.fromEntries(Object.entries(positionRecall).map(([k, [n, d]]) => [k, pct(n, d)])),
  };
}

// ---------- 4. gold consistency (automated, all long rows) ----------
function goldChecks(rows) {
  let valuesInMessage = 0, valuesTotal = 0, rowsAllValuesInMessage = 0, orderOk = 0, listValues = 0, statedCount = [], queryCount = [], wireCount = [], chars = [];
  let firstPersonSentences = 0, rowsWithFirstPersonUnformalized = 0, userSubjects = 0, errandLists = 0;
  const partsVsWires = {agree: 0, disagree: 0};
  for (const row of rows) {
    const program = parse(row.sop_target);
    const statements = program.wires.filter(w => w.type === 'stated' || w.type === 'assumed').map(w => propositionOf(w));
    const queries = program.wires.filter(w => w.type === 'query' || w.type === 'constraint');
    statedCount.push(statements.length); queryCount.push(queries.length); wireCount.push(program.wires.length); chars.push(row.question.length);
    const message = fold(row.question);
    const values = statements.flatMap(stringValues).map(fold);
    valuesTotal += values.length; const inMsg = values.filter(v => message.includes(v)).length; valuesInMessage += inMsg;
    if (inMsg === values.length) rowsAllValuesInMessage++;
    const positions = statements.map(p => Math.min(...stringValues(p).map(fold).map(v => message.indexOf(v)).filter(i => i >= 0)));
    if (positions.every((p, i) => i === 0 || p >= positions[i - 1] || !Number.isFinite(p))) orderOk++;
    const listLines = row.question.split('\n').filter(line => /^\s*[-*•]\s/.test(line)).map(fold);
    if (listLines.length) errandLists++;
    listValues += values.filter(v => listLines.some(line => line.includes(v))).length;
    userSubjects += statements.filter(p => p.roles.some(r => fold(r.value) === 'the user' || fold(r.value).startsWith("the user's"))).length;
    const fp = segments(row.question).filter(seg => !seg.list && !/\?\s*$/.test(seg.text) && /\b(I|I'm|I've|we|We|my|My|our|Our|Eu|Am|Sunt|Noi)\b/.test(seg.text));
    firstPersonSentences += fp.length; if (fp.length) rowsWithFirstPersonUnformalized++;
    const parts = row.verification?.canonical_ir?.parts;
    if (Array.isArray(parts)) {
      const expectedS = parts.reduce((n, part) => n + (part.stated?.length ?? 0) + (part.assumed?.length ?? 0), 0), expectedQ = parts.filter(part => part.query).length;
      (expectedS === statements.length && expectedQ === queries.length ? partsVsWires.agree++ : partsVsWires.disagree++);
    }
  }
  return {
    rows: rows.length, message_chars: quantiles(chars), gold_wires_per_row: quantiles(wireCount), gold_statements_per_row: quantiles(statedCount), gold_queries_per_row: quantiles(queryCount),
    statement_values_found_in_message: pct(valuesInMessage, valuesTotal), rows_all_statement_values_in_message: pct(rowsAllValuesInMessage, rows.length),
    rows_statements_in_message_order: pct(orderOk, rows.length), statement_values_taken_from_errand_lists: listValues, rows_with_errand_list: errandLists,
    statements_about_the_user: userSubjects, first_person_non_question_sentences_left_unformalized: firstPersonSentences, rows_with_such_sentences: rowsWithFirstPersonUnformalized,
    canonical_ir_parts_vs_gold_wires: partsVsWires,
  };
}

// ---------- expected exact match if every wire were independent ----------
function independenceBound(a, longRows, shortRows) {
  const shortExec = shortRows.filter(row => a.exec.has(row.id));
  const pShort = shortExec.length ? shortExec.filter(row => a.exec.get(row.id)).length / shortExec.length : null;
  const longComparisons = longRows.map(row => rowWireComparison(row, a.predictions.get(row.id)));
  const recall = wireMetrics(longComparisons).recall.value;
  const partsPerRow = longRows.map(row => row.verification?.canonical_ir?.parts?.length ?? null).filter(Number.isFinite);
  const wiresPerRow = longRows.map(row => wireKeys(row.sop_target).length);
  const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  return {
    short_row_tolerant_execution: round(pShort),
    parts_per_long_row: quantiles(partsPerRow),
    expected_all_parts_right_if_parts_independent_at_short_rate: pShort === null ? null : round(mean(partsPerRow.map(k => pShort ** k))),
    long_wire_recall: round(recall),
    expected_all_wires_right_at_long_wire_recall: recall === null ? null : round(mean(wiresPerRow.map(n => recall ** n))),
  };
}

// ---------- 5. harness ----------
function harness() {
  const timing = exists(`${S}/formalizer-v1-long-q8_0.timing.json`) ? readJson(`${S}/formalizer-v1-long-q8_0.timing.json`) : null;
  const cfg = readJson('config/train-smollm2-135m.json'), tok = readJson('models/smollm2-135m/fv1-size-a4/formalizer/tokenization.json');
  const haikuTokens = [];
  const sample = exists(`${H}/formalizer-v1-sample.nothink.predictions.jsonl`) ? readJsonlShardedSync(at(`${H}/formalizer-v1-sample.nothink.predictions.jsonl`)) : [];
  for (const row of sample) {
    const file = at(`${H}/cache-nothink/${row.id}.json`);
    if (testById.get(row.id)?.family === 'long_message' && fs.existsSync(file)) haikuTokens.push(JSON.parse(fs.readFileSync(file, 'utf8')).usage?.output_tokens ?? null);
  }
  return {
    smollm_llama_server: {
      context_per_slot: 8192, source: 'training/scripts/evaluate-arm.sh: -c $((8192 * slots)) with -np 4 (server.log: n_ctx = 8192 per slot)',
      max_tokens: timing?.max_tokens ?? null, finish_length_truncated: timing?.truncated?.length ?? null, errors: timing?.errors?.length ?? null,
      raw_completion_fallback: timing?.raw_completion_fallback ?? null,
      prompt_tokens: timing?.prompt_tokens ?? null, completion_tokens: timing?.completion_tokens ?? null,
      largest_prompt_plus_completion: timing ? timing.prompt_tokens.max + timing.completion_tokens.max : null,
    },
    training: {max_length: cfg.max_length, max_new_tokens: cfg.max_new_tokens, longest_encoded_train_row_tokens: tok.train.max_tokens, longest_encoded_dev_row_tokens: tok.dev.max_tokens,
      truncation: 'none: training/python/common.py encode_row raises when a row exceeds max_length (no silent truncation)',
      selection_generation_budget: 'min(max_new_tokens, 4 * prompt_tokens + 256, max_length - prompt_tokens) (training/python/train.py)',
      chat_template: 'ChatML without the default persona system prompt; llama.cpp and HF agree on a 300-row short dev sample (293 vs 292 tolerant), no long-row parity check exists'},
    haiku: {output_tokens_long_rows: quantiles(haikuTokens.filter(Number.isFinite))},
    evaluator: 'eval/run.mjs executes the whole program; no length limit (parse maxWires 2048, maxBytes 1 MiB); one execution signature over all queries, so any single wrong wire fails the row',
  };
}

// ---------- hand-review sample ----------
const reviewSample = sampleRows(test.filter(isLong), 15, 7).map(row => ({id: row.id, language: row.language, noise_level: row.noise_level, chars: row.question.length, message: row.question, gold: row.sop_target}));

const report = {format: 'chatsop-long-message-diagnosis-v1', generated_at: new Date().toISOString(), definition_of_long: 'family long_message (every such formalizer-v1 test message is longer than 300 characters)', arms: {}};
for (const a of arms) {
  if (!a.rows.length) { report.arms[a.name] = {status: 'no predictions found'}; continue; }
  const long = a.rows.filter(isLong), short = a.rows.filter(row => !isLong(row));
  report.arms[a.name] = {
    rows: a.rows.length, long_rows: long.length, short_rows: short.length,
    partial_credit: {short: short.length ? partial(a, short) : null, long: long.length ? partial(a, long) : null},
    ...(long.length ? {truncation_long: truncation(a, long), errors_long: genuineErrors(a, long), independence: independenceBound(a, long, short)} : {status_long: 'no long-row predictions yet'}),
  };
}
report.gold_checks_long_test = goldChecks(test.filter(isLong));
report.harness = harness();
report.hand_review_sample_ids = reviewSample.map(row => row.id);
// Hand review of the 15 sampled long golds (2026-09-29, long-message-diagnosis-agent); qualitative, not recomputed.
report.hand_review_notes = [
  'Golds are faithful and consistent: every assertion about named entities becomes one stated wire, chit-chat, apologies, sign-offs and errand lists produce nothing (0 gold values come from errand lists; 0 statements about "the user"), and canonical_ir parts agree with the gold wire counts on 303/303 rows.',
  'Statements written inside the question section ("Context: ... Question: ...", suppositions before a question) are hoisted into the stated block before all queries, so only about 78% of English long golds list statements in message order; scoring is order-free, so this does not cost credit.',
  'Romanian and code-switched golds use canonical English values for common nouns and relation phrases (owner decision Q-DATA-6) while names stay as written; about 30% of Romanian gold values therefore do not occur in the message. This is the same convention as the short rows.',
  'Borderline: first-person chit-chat that states a fact ("We had a power cut this morning", "Am avut o saptamana foarte aglomerata") is omitted, as DS022 prescribes for chit-chat; DS021 C4 formalizes facts about the user as "the user" but exempts chit-chat. Consistent in the data and rarely emitted by the models (21 SmolLM2 extra statements of this origin), so not a cause.',
  'The golds are large: median 27 wires (23 statements and 4 queries), up to 79, from a median 19 composed parts; DS022 describes "two to six question cases" but not how many statement cases a message carries.',
];
report.gemma_note = 'eval/reports/current/formalizer-size-v1/gemma/ held only quantize and server logs when this diagnosis ran (its earlier short-row predictions were no longer present); rerun this script once its predictions exist.';
fs.mkdirSync(path.dirname(at(outFile)), {recursive: true});
fs.writeFileSync(at(outFile), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(at(path.join(path.dirname(outFile), 'hand-review-sample.json')), JSON.stringify(reviewSample, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.arms).map(([k, v]) => [k, v.partial_credit ? {short: v.partial_credit.short && {exec: v.partial_credit.short.execution_equivalence_tolerant?.value, f1: v.partial_credit.short.wire_f1_micro, q: v.partial_credit.short.query_part_correct.value, ge90: v.partial_credit.short.rows_wire_f1_at_least_0_9.value}, long: v.partial_credit.long && {exec: v.partial_credit.long.execution_equivalence_tolerant?.value, f1: v.partial_credit.long.wire_f1_micro, q: v.partial_credit.long.query_part_correct.value, ge90: v.partial_credit.long.rows_wire_f1_at_least_0_9.value}} : v])), null, 1));
