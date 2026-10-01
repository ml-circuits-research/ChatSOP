#!/usr/bin/env node
/** The independent eval-only suite `formalizer-wild-v1` (DS016 "Independent wild suite").
 *
 *   node tools/eval/wild-suite.mjs --assemble <work-dir>   # build eval/suites/formalizer-wild-v1/ from the annotation work
 *   node tools/eval/wild-suite.mjs --check                 # re-validate the sealed suite in place
 *   node tools/eval/wild-suite.mjs --score <predictions.jsonl> [--out report.json]   # score {id, sop} predictions
 *
 * The messages were written by independent writer agents and every message was annotated twice and adjudicated;
 * no generator produced or reads this suite (eval/leakage.mjs INDEPENDENT_SUITES). `--assemble` reads from the
 * work directory: `messages.jsonl` (id, writer, language, gaps, message), `annot-1-b*.jsonl` and `annot-2-b*.jsonl`
 * (sop, alt_sops, language_gap, spec_unclear, confidence), `adj-b*.jsonl` (gold_sop, alt_sops, decision,
 * categories, rule_issue, language_gap, note), `pairs.jsonl` (per-row agreement from agree.mjs), `agreement.json`
 * and `no-copy.json`. Rows carry no verification world, so they are scored against every accepted gold and with
 * reference-free metrics; `scoring.mode` records this for each row.
 *
 * `--check` fails closed when a row has no message, a gold or accepted target that does not parse, a model-surface
 * violation (non-model wire, `unclear` not alone, `span`, a missing constraint task, a compile error such as
 * `assumed_duplicates_stated`), an English row whose stated
 * value is not in the message, or a manifest checksum that does not match.
 *
 * `--score` compares each prediction with EVERY accepted target of its row (`sop_targets_accepted`) and keeps the
 * best: `accepted_match` (same program after folding case and accents, renaming variables and ignoring `basis`),
 * `accepted_match_tolerant` (the strict match, or the same wires with relation phrases and quoted values compared by
 * the host dictionary's `sameMeaning`, so a normalized Romanian or English content word or a dictionary synonym
 * counts; wire ids never matter), `accepted_match_without_assumed`, `shape_match` (same wire types, roles, polarity and query modes; relation words
 * and values ignored), `decision_match` (query / constraint / statements / unclear kind), and proposition and
 * query-block F1. Rows are also sliced by language, by gap and by whether the gold approximates a construct the
 * language lacks (`language_gap`). The reference-free metrics come from `node eval/run.mjs --messages` (DS016).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parse, one, many, parseMatch} from '../../sop/parser.mjs';
import {checkModelProgram, compileDeclarative} from '../../sop/declarative.mjs';
import {propositionOf} from '../../sop/propositions.mjs';
import {mentionedIn} from '../../sop/linking.mjs';
import {wireItems, matchItems} from '../../eval/propositions.mjs';

export const SUITE = 'formalizer-wild-v1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const suiteDir = path.join(root, 'eval/suites', SUITE);
const testFile = path.join(suiteDir, 'test.jsonl');
const manifestFile = path.join(suiteDir, 'manifest.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const tally = values => Object.fromEntries([...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]));

/** The DS021 question type of a gold program (the eighteen corpus labels). */
export function questionType(sop) {
  const program = parse(sop);
  const unclear = program.wires.find(wire => wire.type === 'unclear');
  if (unclear) return one(unclear, 'kind') === 'ambiguous' ? 'ambiguous' : 'unclear';
  const queries = program.wires.filter(wire => wire.type === 'query');
  if (!queries.length) return program.wires.some(wire => wire.type === 'constraint') ? 'numeric' : 'none';
  if (queries.length > 1) return 'multi';
  const query = queries[0], mode = one(query, 'mode'), measure = one(query, 'measure');
  const text = [...many(query, 'where'), ...many(query, 'scope')].join('\n');
  const asksTime = /role time \?/.test(text) && /^\?/.test(one(query, 'select') ?? '') && text.includes('role time ' + one(query, 'select'));
  if (mode === 'every') return 'universal';
  if (mode === 'explain') return 'why';
  if (measure) return {start: 'since_when', end: 'until_when', duration: 'how_long'}[measure] ?? 'when';
  if (mode === 'count') return asksTime ? 'how_many_times' : 'count';
  if (asksTime) return 'when';
  const selected = one(query, 'select');
  if (selected) {
    if (new RegExp(`role (location|destination|source) \\${selected}\\b`).test(text)) return 'where';
    if (new RegExp(`role instrument \\${selected}\\b`).test(text)) return 'how';
    return 'wh';
  }
  return 'yes_no';
}

/** Model-surface problems of one target for one message (empty when admissible). */
export function targetProblems(sop, message, language) {
  const problems = [];
  let program;
  // The sealed wild suite is archived and predates the English-only core (2026-10-01): its `unclear` targets may carry a `language ro` line, a
  // field that has no effect any more (the current parser accepts `en` only). The line is dropped before the target is checked.
  sop = sop.replace(/^(\s+)language (?!en\b)[a-z]{2,3}[ \t]*$/gm, (line, space, offset) => (/@\w+ unclear/.test(sop.slice(Math.max(0, sop.lastIndexOf('\n@', offset)), offset)) ? '' : line));
  try { program = checkModelProgram(parse(sop)); compileDeclarative(sop, {inputText: message}); } catch (error) { return [error.message.split('\n')[0]]; }
  for (const wire of program.wires) if (wire.type === 'stated' && language === 'en') {
    const proposition = propositionOf(wire);
    for (const {name, value} of proposition.roles) if (!mentionedIn(value, message)) problems.push(`stated_value_not_in_message: ${JSON.stringify(value)} (${name} of @${wire.id})`);
    if (proposition.speaker !== 'user' && !mentionedIn(proposition.speaker, message)) problems.push(`stated_value_not_in_message: speaker ${JSON.stringify(proposition.speaker)}`);
  }
  return problems;
}

const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const renameVariables = text => { const names = new Map(); return text.replace(/\?[A-Za-z][A-Za-z0-9_]*/g, name => { if (!names.has(name)) names.set(name, '?v' + names.size); return names.get(name); }); };
const roleValue = value => value && typeof value === 'object' ? '$' : fold(value);
const propositionIdentity = (p, withCertainty) => JSON.stringify([fold(p.relation), p.roles.map(role => role.name + '=' + roleValue(role.value)).sort(), p.polarity, p.valid ? JSON.stringify(p.valid) : '', withCertainty ? p.certainty ?? '' : '', withCertainty ? p.speaker ?? 'user' : '']);
const propositionShape = p => JSON.stringify([p.roles.map(role => role.name + (String(role.value).startsWith('?') ? '=?' : '')).sort(), p.polarity]);
const sorted = values => JSON.stringify([...values].sort());

/** A comparable summary of one program: wire types, proposition identities, query blocks and their shapes.
 * A program the parser accepts but whose blocks cannot be read (for example a `match` without a relation) counts
 * as unparsed, like a program the parser rejects. */
export function programSummary(sop) {
  try { return summarizeProgram(sop); } catch { return null; }
}

function summarizeProgram(sop) {
  const out = {types: [], propositions: [], assumedFree: [], queries: [], shapes: [], unclear: null, decision: null, items: []};
  let program;
  try { program = parse(sop); } catch { return null; }
  // Id-free wire items (eval/propositions.mjs) for the tolerant accepted match; certainty and speaker count, as above.
  out.items = wireItems(program.wires, {withCertainty: true}).filter(item => item.type !== 'unparsed');
  for (const wire of program.wires) {
    out.types.push(wire.type);
    if (wire.type === 'stated' || wire.type === 'assumed') {
      const p = propositionOf(wire);
      out.propositions.push(wire.type + propositionIdentity(p, wire.type === 'stated'));
      if (wire.type === 'stated') out.assumedFree.push(propositionIdentity(p, true));
      out.shapes.push(wire.type + propositionShape(p));
    } else if (wire.type === 'unclear') out.unclear = one(wire, 'kind');
    else if (wire.type === 'constraint') { const key = renameVariables(Object.entries(wire.fields).filter(([k]) => k !== 'unit').map(([k, v]) => k + ':' + v.join('|')).sort().join(';')).replace(/\s+/g, ' '); out.queries.push(key); out.assumedFree.push(key); out.shapes.push('constraint'); }
    else if (wire.type === 'query') {
      const blocks = [...many(wire, 'where'), ...many(wire, 'scope')].flatMap(text => [...text.matchAll(/match\n([\s\S]*?)\n\s*end/g)].map(m => parseMatch('match\n' + m[1])));
      const header = ['mode', 'measure', 'at', 'during', 'asof', 'limit'].map(k => k + '=' + fold(one(wire, k) ?? '')).join(',');
      const key = renameVariables([header, 'select=' + Boolean(one(wire, 'select')), ...blocks.map(p => propositionIdentity(p, false)).sort(), 'filter=' + many(wire, 'filter').map(fold).sort().join('|'), 'scope=' + many(wire, 'scope').length].join('\n'));
      out.queries.push(key);
      out.assumedFree.push(key);
      out.shapes.push(renameVariables([one(wire, 'mode') ?? '', one(wire, 'measure') ?? '', one(wire, 'select') ? 'select' : '', many(wire, 'scope').length, ...blocks.map(propositionShape).sort()].join('|')));
    }
  }
  out.types.sort();
  out.decision = out.unclear ? 'unclear:' + out.unclear : out.types.includes('query') ? 'query' : out.types.includes('constraint') ? 'constraint' : 'statements';
  return out;
}
const f1 = (gold, predicted) => { if (!gold.length && !predicted.length) return 1; const pool = [...predicted]; let hits = 0; for (const key of gold) { const at = pool.indexOf(key); if (at >= 0) { hits++; pool.splice(at, 1); } } return 2 * hits / (gold.length + predicted.length); };

/** Best comparison of one prediction against a row's accepted targets. */
export function scoreAgainstAccepted(predictedSop, accepted) {
  const predicted = typeof predictedSop === 'string' ? programSummary(predictedSop) : null;
  const zero = {parsed: false, accepted_match: 0, accepted_match_tolerant: 0, accepted_match_without_assumed: 0, shape_match: 0, decision_match: 0, proposition_f1: 0, query_f1: 0};
  if (!predicted) return zero;
  let best = {...zero, parsed: true};
  for (const gold of accepted.map(programSummary).filter(Boolean)) {
    const score = {
      parsed: true,
      accepted_match: +(sorted(gold.types) === sorted(predicted.types) && sorted(gold.propositions) === sorted(predicted.propositions) && sorted(gold.queries) === sorted(predicted.queries) && gold.unclear === predicted.unclear),
      accepted_match_tolerant: 0,
      accepted_match_without_assumed: +(sorted(gold.assumedFree) === sorted(predicted.assumedFree) && gold.unclear === predicted.unclear),
      shape_match: +(sorted(gold.shapes) === sorted(predicted.shapes) && gold.unclear === predicted.unclear),
      decision_match: +(gold.decision === predicted.decision),
      proposition_f1: f1(gold.propositions, predicted.propositions),
      query_f1: f1(gold.queries, predicted.queries),
    };
    // Tolerant: the strict match, or the same wire types and unclear kind with every wire paired both ways when
    // relation phrases and quoted values are compared by the dictionary (Dictionary.sameMeaning, DS016).
    score.accepted_match_tolerant = +(score.accepted_match === 1 || (sorted(gold.types) === sorted(predicted.types) && gold.unclear === predicted.unclear
      && gold.items.length === predicted.items.length && matchItems(gold.items, predicted.items, {tolerant: true}).matched === gold.items.length));
    const rank = value => value.accepted_match * 16 + value.accepted_match_tolerant * 8 + value.accepted_match_without_assumed * 4 + value.shape_match * 2 + value.decision_match + (value.proposition_f1 + value.query_f1) / 4;
    if (rank(score) > rank(best)) best = score;
  }
  return best;
}

function score(predictionsFile, out) {
  const rows = readJsonl(testFile);
  const predictions = new Map(readJsonl(predictionsFile).map(row => [row.id, row.sop]));
  const missing = rows.filter(row => !predictions.has(row.id)).map(row => row.id);
  if (missing.length) throw new Error(`Prediction coverage must match the suite: ${missing.length} rows missing (first ${missing[0]})`);
  const records = rows.map(row => ({id: row.id, language: row.language, gaps: row.gaps, language_gap: Boolean(row.language_gap), ...scoreAgainstAccepted(predictions.get(row.id), row.sop_targets_accepted)}));
  const keys = ['parsed', 'accepted_match', 'accepted_match_tolerant', 'accepted_match_without_assumed', 'shape_match', 'decision_match', 'proposition_f1', 'query_f1'];
  const summarize = list => ({rows: list.length, ...Object.fromEntries(keys.map(key => [key, list.length ? +(list.reduce((sum, r) => sum + Number(r[key]), 0) / list.length).toFixed(4) : null]))});
  const groups = by => { const map = new Map(); for (const r of records) for (const key of [by(r)].flat()) { if (!map.has(key)) map.set(key, []); map.get(key).push(r); } return Object.fromEntries([...map].sort().map(([key, list]) => [key, summarize(list)])); };
  const report = {format: 'chatsop-wild-suite-score-v1', suite: SUITE, predictions: path.relative(root, path.resolve(predictionsFile)), scoring: 'best match against every accepted target; no execution (the suite has no verification worlds)', overall: summarize(records),
    by_language: groups(r => r.language), by_language_gap: groups(r => r.language_gap ? 'gold approximates a missing construct' : 'covered by the language'), by_gap: groups(r => r.gaps), records};
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true}); fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n'); }
  console.log(JSON.stringify({overall: report.overall, by_language: report.by_language, by_language_gap: report.by_language_gap}, null, 1));
}

function assemble(work) {
  const messages = readJsonl(path.join(work, 'messages.jsonl'));
  const byBatch = prefix => new Map(fs.readdirSync(work).filter(name => name.startsWith(prefix) && name.endsWith('.jsonl')).sort().flatMap(name => readJsonl(path.join(work, name))).map(row => [row.id, row]));
  const first = byBatch('annot-1-b'), second = byBatch('annot-2-b'), adjudicated = byBatch('adj-b');
  const pairs = new Map(readJsonl(path.join(work, 'pairs.jsonl')).map(row => [row.id, row]));
  const agreement = JSON.parse(fs.readFileSync(path.join(work, 'agreement.json'), 'utf8'));
  const noCopy = JSON.parse(fs.readFileSync(path.join(work, 'no-copy.json'), 'utf8'));
  const rows = [];
  for (const message of messages) {
    const a = first.get(message.id), b = second.get(message.id), gold = adjudicated.get(message.id), pair = pairs.get(message.id);
    if (!a || !b || !gold || !pair) throw new Error(`${message.id}: missing annotation, adjudication or agreement`);
    const accepted = [...new Set([gold.gold_sop, ...(gold.alt_sops ?? [])])];
    rows.push({
      id: `wild_${message.id.replace('-', '_')}`,
      split: 'test',
      question: message.message,
      language: message.language,
      sop_target: gold.gold_sop,
      sop_targets_accepted: accepted,
      target_format: 'strings',
      evaluation_track: 'formalization',
      family: 'wild',
      variant: message.gaps[0] ?? 'G00',
      gaps: message.gaps,
      question_type: questionType(gold.gold_sop),
      language_gap: gold.language_gap ?? null,
      expected: gold.gold_sop.includes(' unclear') ? {status: 'unclear', unclear_kind: /kind (\w+)/.exec(gold.gold_sop)[1]} : {status: null},
      scoring: {mode: 'accepted_match_and_reference_free', executed: false, reason: 'no verification world: the row is scored against every accepted gold, by proposition F1, shape and top-level decision (DS016)'},
      annotations: {
        annotator_1: {sop: a.sop, alt_sops: a.alt_sops ?? [], language_gap: a.language_gap ?? null, spec_unclear: a.spec_unclear ?? null, confidence: a.confidence ?? null},
        annotator_2: {sop: b.sop, alt_sops: b.alt_sops ?? [], language_gap: b.language_gap ?? null, spec_unclear: b.spec_unclear ?? null, confidence: b.confidence ?? null},
      },
      adjudication: {decision: gold.decision, categories: gold.categories ?? [], rule_issue: gold.rule_issue ?? null, note: gold.note ?? null},
      agreement: {exact_any: pair.exact_any, exact: pair.exact, shape: pair.shape, type_profile: pair.type_profile, decision: pair.decision},
      writer: message.writer,
      review_status: 'model-written, double-annotated, adjudicated; not human-reviewed',
      quality_flags: ['independent_writers', 'no_generator_constructions', 'not_human_reviewed', 'eval_only_never_training'],
      rights: {license: 'MIT (repository LICENSE); original ChatSOP authored text', text_copied: false, inspired_by: []},
    });
  }
  fs.mkdirSync(suiteDir, {recursive: true});
  const body = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  fs.writeFileSync(testFile, body);
  const manifest = {
    format: 'chatsop-independent-suite-manifest-v1',
    corpus: SUITE,
    purpose: 'Eval-only sealed suite of independently written messages (EN, RO, EN-RO code-switching, real-looking noise) that measures whether the formalizer handles any text, not only the generator\'s constructions (DS016).',
    process: {
      writers: 'eight independent writer agents with distinct personas (EN consumers, EN professionals, EN tech teams, RO regional voices, RO young urban, RO formal and administrative, Romglish and diaspora, structurally hard cases); they saw only a list of 34 message phenomena, never the generator, the corpora or the repository',
      annotation: 'two independent annotators per message following the annotation guide eval/reports/history/wild-suite/annotation-guide.md (DS021 plus conventions C1-C12), then one adjudicator who records every accepted reading in sop_targets_accepted',
      validation: 'parser, model-wire admission, anchoring for English rows (cross-lingual values are reported, not failed), vocabulary, relation-word and corpus-audit row checks during annotation; tools/eval/wild-suite.mjs --check; tools/datasets/no-copy.mjs',
    },
    independence: 'Never feeds the generator or any training data: listed in eval/leakage.mjs INDEPENDENT_SUITES (no generator or training source may name it; no datasets/<name> split may exist); no generator family may be designed from its rows.',
    model_input: 'question (the user message only); every other field is evaluation-only',
    training_authorized: false,
    human_reviewed: false,
    synthetic: true,
    rows: rows.length,
    languages: tally(rows.map(row => row.language)),
    writers: tally(rows.map(row => row.writer)),
    question_types: tally(rows.map(row => row.question_type)),
    gaps: tally(rows.flatMap(row => row.gaps)),
    rows_with_language_gap: rows.filter(row => row.language_gap).length,
    rows_with_several_accepted_targets: rows.filter(row => row.sop_targets_accepted.length > 1).length,
    executed_rows: 0,
    agreement: agreement.metrics,
    agreement_by_phenomenon: agreement.by_phenomenon,
    adjudication: {decisions: tally(rows.map(row => row.adjudication.decision)), categories: tally(rows.flatMap(row => row.adjudication.categories))},
    no_copy: {pass_except: 'identifier check flags a real product name (Log4j) as hash-like; reviewed and kept', paired_distinctive_4grams: noCopy.paired?.distinctive_shared_4grams ?? null, rows_with_shared_8gram: noCopy.long_span?.rows_with_shared_8gram ?? null, identifiers: noCopy.identifiers ?? null, global_4gram: noCopy.global_4gram ?? null},
    rights: {license: 'MIT (repository LICENSE); original ChatSOP authored text', text_copied: false, inspired_by: [], note: 'Written from a phenomenon list; no source text, structure or row of any dataset was used.'},
    files: {'test.jsonl': sha256(body)},
    sha256: {[`eval/suites/${SUITE}/test.jsonl`]: sha256(body)},
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${SUITE}: ${rows.length} rows written`);
}

function check() {
  const problems = [];
  const bytes = fs.readFileSync(testFile);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.files?.['test.jsonl'] !== sha256(bytes)) problems.push('manifest checksum does not match test.jsonl');
  const rows = readJsonl(testFile), ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) problems.push(`${row.id}: duplicate id`);
    ids.add(row.id);
    if (typeof row.question !== 'string' || !row.question.trim()) problems.push(`${row.id}: empty question`);
    if (!row.sop_targets_accepted?.includes(row.sop_target)) problems.push(`${row.id}: the gold is not among the accepted targets`);
    for (const target of row.sop_targets_accepted ?? []) for (const problem of targetProblems(target, row.question, row.language)) problems.push(`${row.id}: ${problem}`);
  }
  if (rows.length !== manifest.rows) problems.push(`manifest rows ${manifest.rows} != ${rows.length}`);
  for (const problem of problems.slice(0, 40)) console.error(problem);
  console.log(`${SUITE}: ${rows.length} rows, ${rows.reduce((sum, row) => sum + row.sop_targets_accepted.length, 0)} accepted targets, ${problems.length} problems`);
  return problems.length === 0;
}

const args = process.argv.slice(2);
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (!isMain) { /* imported for questionType / targetProblems */ }
else if (args[0] === '--assemble' && args[1]) { assemble(path.resolve(args[1])); process.exitCode = check() ? 0 : 1; }
else if (args[0] === '--check') process.exitCode = check() ? 0 : 1;
else if (args[0] === '--score' && args[1]) score(args[1], args.includes('--out') ? args[args.indexOf('--out') + 1] : null);
else { console.error('usage: node tools/eval/wild-suite.mjs --assemble <work-dir> | --check | --score <predictions.jsonl> [--out report.json]'); process.exitCode = 2; }
