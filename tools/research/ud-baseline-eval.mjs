#!/usr/bin/env node
/** Staged evaluation of the symbolic baseline `baseline-ud-rules-v1` against stored model predictions.
 *
 *   node tools/research/ud-baseline-eval.mjs stages                     # nested stratified stage ids (100, 300, full) per set
 *   node tools/research/ud-baseline-eval.mjs run --set wild|ood|test500|testhaiku --stage 100|300|full [--device cuda|cpu] [--label <run>]
 *   node tools/research/ud-baseline-eval.mjs latency [--n 60]            # sequential single-message GPU and CPU latency
 *
 * `run` parses and converts ONLY the stage's rows (Stanza worker + lib/ud-to-sop), scores the baseline and every
 * comparator on the same rows with the current harness (eval/run.mjs for suites with a verification world,
 * tools/eval/wild-suite.mjs --score for the wild suite), and adds metrics every system gets alike: the invention
 * rate (quoted role values not anchored in the message, strict and through the host dictionary), the unparsed
 * rate, and a D1-tolerant proposition F1 (unparsed wires and link lines ignored; relation phrases and values
 * compared by sop/dictionary.mjs sameMeaning in either language). Paired cluster bootstrap intervals (10,000
 * resamples, seed 7) of baseline minus comparator follow the preregistration
 * (status/preregistrations/baseline-ud-rules-v1.json). Output: eval/reports/current/baseline-ud-rules/<set>/.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {StanzaWorker} from '../../lib/ud-to-sop/stanza.mjs';
import {convertParse, maskMessage} from '../../lib/ud-to-sop/index.mjs';
import {parse, one, many, parseMatch, isMatch, words} from '../../sop/parser.mjs';
import {parseCondition} from '../../sop/conditions.mjs';
import {propositionOf} from '../../sop/propositions.mjs';
import {mentionedIn, mentionedThroughDictionary} from '../../sop/linking.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {bootstrap, mcnemar} from './spellfix-eval.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/baseline-ud-rules');
const CUR = 'eval/reports/current';
export const SETS = {
  wild: {suite: 'eval/suites/formalizer-wild-v1/test.jsonl', kind: 'wild', strata: row => row.language + '|' + (row.gaps?.[0] ?? '-'),
    comparators: {'smollm2-135m': `${CUR}/formalizer-size-v1/smollm2-135m/formalizer-wild-v1-q8_0.predictions.jsonl`, 'smollm2-360m': `${CUR}/formalizer-size-v1/smollm2-360m/formalizer-wild-v1-q8_0.predictions.jsonl`, 'haiku-nothink': `${CUR}/haiku-baseline/formalizer-wild-v1.nothink.predictions.jsonl`}},
  ood: {suite: `${CUR}/haiku-baseline/samples/formalizer-ood-v1-sample.suite.jsonl`, kind: 'executed', strata: row => row.language + '|' + row.question_type,
    comparators: {'smollm2-135m': `${CUR}/formalizer-size-v1/smollm2-135m/formalizer-ood-v1-q8_0.predictions.jsonl`, 'smollm2-360m': `${CUR}/formalizer-size-v1/smollm2-360m/formalizer-ood-v1-q8_0.predictions.jsonl`, 'haiku-nothink': `${CUR}/haiku-baseline/formalizer-ood-v1-sample.nothink.predictions.jsonl`}},
  test500: {suite: `${CUR}/formalizer-size-v1/sample500/formalizer-v1-sample500.suite.jsonl`, kind: 'executed', strata: row => row.language + '|' + row.question_type,
    comparators: {'smollm2-135m': `${CUR}/formalizer-size-v1/sample500/smollm2-135m.predictions.jsonl`, 'smollm2-360m': `${CUR}/formalizer-size-v1/smollm2-360m/formalizer-v1-sample500-q8_0.predictions.jsonl`}},
  testhaiku: {suite: `${CUR}/haiku-baseline/samples/formalizer-v1-sample.suite.jsonl`, kind: 'executed', strata: row => (row.question.length > 300 ? 'long' : 'short') + '|' + row.language,
    comparators: {'smollm2-135m': `${CUR}/formalizer-size-v1/smollm2-135m/formalizer-v1-q8_0.predictions.jsonl`, 'haiku-nothink': `${CUR}/haiku-baseline/formalizer-v1-sample.nothink.predictions.jsonl`}},
};
const BASELINE = 'ud-rules';

const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')); };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function argumentsOf(argv) {
  const [command, ...rest] = argv; const args = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); args[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return args;
}

// ------------------------------------------------------------------ stages

export function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Nested stratified stages: per-stratum seeded order, proportional largest-remainder allocation, monotone prefixes. */
export function stages(rows, strata, sizes = [100, 300], seed = 42) {
  const random = mulberry(seed);
  const groups = new Map();
  for (const row of rows) { const key = strata(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row.id); }
  for (const ids of groups.values()) for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const out = {}; let previous = new Map([...groups.keys()].map(key => [key, 0]));
  for (const size of sizes) {
    const quota = [...groups].map(([key, ids]) => { const exact = size * ids.length / rows.length; return {key, n: Math.floor(exact), frac: exact - Math.floor(exact), max: ids.length}; });
    let left = size - quota.reduce((a, q) => a + q.n, 0);
    for (const q of [...quota].sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key))) { if (left <= 0) break; if (q.n < q.max) { q.n++; left--; } }
    const alloc = new Map(quota.map(q => [q.key, Math.min(q.max, Math.max(q.n, previous.get(q.key)))]));
    out[size] = [...groups].flatMap(([key, ids]) => ids.slice(0, alloc.get(key)));
    previous = alloc;
  }
  out.full = rows.map(row => row.id);
  return out;
}

function stagesCommand() {
  const all = {};
  for (const [name, set] of Object.entries(SETS)) {
    const rows = readJsonlShardedSync(path.join(ROOT, set.suite));
    all[name] = stages(rows, set.strata);
    console.log(name, Object.fromEntries(Object.entries(all[name]).map(([k, v]) => [k, v.length])));
  }
  writeJson(path.join(OUT, 'stages.json'), {method: 'nested stratified stages (per-stratum mulberry32 order, seed 42, proportional largest remainder, monotone prefixes); strata: wild language x first gap, OOD and test500 language x question_type, testhaiku length x language', sets: all});
}

// ------------------------------------------------------------------ metrics every system gets alike

let dictionary = null;
const dict = () => (dictionary ??= defaultDictionary());
const isVar = value => typeof value === 'string' && /^[?$]/.test(value);

/** Quoted literal values of a program: stated/assumed roles, query match roles, except literals. */
function literals(program) {
  const out = [];
  for (const w of program.wires) {
    if (w.type === 'stated' || w.type === 'assumed') for (const r of propositionOf(w).roles) if (typeof r.value === 'string' && !isVar(r.value)) out.push({wire: w.type, value: r.value});
    if (w.type === 'query') {
      for (const text of [...many(w, 'where'), ...many(w, 'scope')]) parseCondition(text, leaf => { if (isMatch(leaf)) for (const r of parseMatch(leaf, 'm', {partial: true}).roles) if (typeof r.value === 'string' && !isVar(r.value)) out.push({wire: 'query', value: r.value}); return leaf; });
      for (const line of many(w, 'except')) { const [, value] = words(line); if (value?.startsWith('"')) out.push({wire: 'query', value: JSON.parse(value)}); }
    }
  }
  return out;
}

/** Invention and unparsed accounting of one output for one message. */
export function honesty(sop, message) {
  let program;
  try { program = parse(sop); } catch { return {parsed: false, values: 0, strict_unanchored: 0, dict_unanchored: 0, unparsed_wires: 0, unparsed_chars: 0}; }
  const values = literals(program);
  const strict = values.filter(v => !(v.value === 'the user' || mentionedIn(v.value, message))).length;
  const tolerant = values.filter(v => !mentionedThroughDictionary(v.value, message, dict()) && !mentionedIn(v.value, message)).length;
  const unparsed = program.wires.filter(w => w.type === 'unparsed');
  return {parsed: true, values: values.length, strict_unanchored: strict, dict_unanchored: tolerant, unparsed_wires: unparsed.length, unparsed_chars: unparsed.reduce((a, w) => a + String(JSON.parse(one(w, 'span'))).length, 0),
    unclear: program.wires.find(w => w.type === 'unclear') ? one(program.wires.find(w => w.type === 'unclear'), 'kind') : null};
}

/** Propositions of a program for the D1-tolerant comparison: [{kind, relation, roles: Map, polarity}]; unparsed and links ignored. */
function propositions(sop) {
  let program;
  try { program = parse(sop); } catch { return null; }
  const out = [];
  const add = (kind, p, polarity) => out.push({kind, relation: p.relation ?? '', roles: new Map(p.roles.map(r => [r.name, isVar(r.value) ? '?' : String(r.value)])), polarity: polarity ?? p.polarity ?? 'affirmed'});
  for (const w of program.wires) {
    // Like tools/eval/wild-suite.mjs propositionIdentity: a statement's certainty and speaker are part of it.
    if (w.type === 'stated') { const p = propositionOf(w); add('stated:' + (p.certainty ?? '') + ':' + (p.speaker ?? 'user'), p); }
    else if (w.type === 'assumed') add(w.type, propositionOf(w));
    else if (w.type === 'query') for (const text of [...many(w, 'where'), ...many(w, 'scope')]) parseCondition(text, leaf => { if (isMatch(leaf)) add('query', parseMatch(leaf, 'm', {partial: true})); return leaf; });
    else if (w.type === 'unclear') out.push({kind: 'unclear:' + one(w, 'kind'), relation: '', roles: new Map(), polarity: ''});
    else if (w.type === 'constraint') out.push({kind: 'constraint', relation: '', roles: new Map(), polarity: ''});
  }
  return out;
}
const sameValue = (a, b) => a === b || (a !== '?' && b !== '?' && dict().sameMeaning(a, b, 'value'));
const sameProp = (a, b) => a.kind === b.kind && a.polarity === b.polarity && a.roles.size === b.roles.size && [...a.roles].every(([name, value]) => b.roles.has(name) && sameValue(value, b.roles.get(name))) && (a.relation === b.relation || dict().sameMeaning(a.relation, b.relation, 'relation'));
const f1 = (gold, predicted) => {
  if (!gold.length && !predicted.length) return 1;
  const pool = [...predicted]; let hits = 0;
  for (const g of gold) { const i = pool.findIndex(p => sameProp(p, g)); if (i >= 0) { hits++; pool.splice(i, 1); } }
  return (2 * hits) / (gold.length + predicted.length);
};
const isStatement = p => /^(stated|assumed)/.test(p.kind);
/**
 * Best D1-tolerant scores of a prediction against the gold and its accepted alternatives: `props` is the F1 of
 * stated/assumed propositions (the wild scorer's proposition F1, empty vs empty = 1), `blocks` the F1 of query match
 * blocks, unclear kinds and constraints, `all` the F1 over both. Unparsed wires and link lines are ignored.
 */
export function tolerantScores(sop, golds) {
  const predicted = typeof sop === 'string' ? propositions(sop) : null;
  if (!predicted) return {props: 0, blocks: 0, all: 0};
  let best = {props: 0, blocks: 0, all: 0};
  for (const gold of golds.map(propositions).filter(Boolean)) {
    const score = {props: f1(gold.filter(isStatement), predicted.filter(isStatement)), blocks: f1(gold.filter(p => !isStatement(p)), predicted.filter(p => !isStatement(p))), all: f1(gold, predicted)};
    if (score.all > best.all || (score.all === best.all && score.props > best.props)) best = score;
  }
  return best;
}
export const tolerantPropositionF1 = (sop, golds) => tolerantScores(sop, golds).props;
export const goldsOf = row => [row.sop_target, ...(row.sop_targets_accepted ?? []).map(t => (typeof t === 'string' ? t : t?.sop ?? t?.text ?? ''))].filter(Boolean);

// ------------------------------------------------------------------ run

export function scoreExecuted(suiteFile, predictionsFile, outFile) {
  execFileSync(process.execPath, [path.join(ROOT, 'eval/run.mjs'), '--file', suiteFile, '--predictions', predictionsFile, '--out', outFile], {cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], maxBuffer: 1 << 28});
  const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  return {report, byId: new Map(report.records.map(r => [r.id, r]))};
}
export function scoreWild(predictionsFile, outFile) {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/eval/wild-suite.mjs'), '--score', predictionsFile, '--out', outFile], {cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], maxBuffer: 1 << 28});
  const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  return {report, byId: new Map(report.records.map(r => [r.id, r]))};
}

export function paired(ids, rowsById, a, b, value) {
  const clusters = new Map();
  let helped = 0, hurt = 0;
  for (const id of ids) {
    const x = value(a.get(id)), y = value(b.get(id));
    if (x === null || y === null) continue;
    if (y > x) helped++; else if (y < x) hurt++;
    const key = rowsById.get(id)?.semantic_case_id ?? id;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push([x, y]);
  }
  const pairs = [...clusters.values()].flat();
  if (!pairs.length) return null;
  return {rows: pairs.length, comparator: mean(pairs.map(p => p[0])), baseline: mean(pairs.map(p => p[1])), delta: mean(pairs.map(p => p[1] - p[0])), ci95: bootstrap([...clusters.values()]), baseline_better: helped, comparator_better: hurt, mcnemar_p: mcnemar(hurt, helped)};
}

async function runCommand(args) {
  const set = SETS[args.set];
  if (!set) throw Error('--set must be one of ' + Object.keys(SETS).join(', '));
  const stageKey = String(args.stage ?? 'full');
  const stagesFile = path.join(OUT, 'stages.json');
  if (!fs.existsSync(stagesFile)) throw Error('run the stages command first');
  const ids = JSON.parse(fs.readFileSync(stagesFile, 'utf8')).sets[args.set][stageKey];
  const allRows = readJsonlShardedSync(path.join(ROOT, set.suite));
  const rowsById = new Map(allRows.map(row => [row.id, row]));
  const rows = ids.map(id => rowsById.get(id));
  // `--label` keeps an exploratory rerun (a later rule version) apart from the preregistered outputs.
  const dir = path.join(OUT, ...(args.label ? ['runs', String(args.label)] : []), args.set, 'stage-' + stageKey);
  fs.mkdirSync(dir, {recursive: true});
  const suiteFile = path.join(dir, 'suite.jsonl');
  writeJsonl(suiteFile, rows);
  // 1. Baseline predictions for exactly these rows (parse in GPU batches, then convert).
  const worker = new StanzaWorker({device: args.device ?? 'cuda'});
  const info = await worker.start();
  const predictions = [], diagnostics = [];
  const started = performance.now();
  for (let i = 0; i < rows.length; i += 64) {
    const chunk = rows.slice(i, i + 64);
    const t = performance.now();
    const {parses} = await worker.parseMany(chunk.map(row => maskMessage(row.question)));
    const parseEach = (performance.now() - t) / chunk.length;
    chunk.forEach((row, j) => {
      const t2 = performance.now();
      let result;
      try { result = convertParse(parses[j], row.question); } catch (error) { result = {sop: '', valid: false, error: 'converter: ' + error.message, outcome: 'crash', wires: [], notes: [], repaired: []}; }
      const convertMs = performance.now() - t2;
      predictions.push({id: row.id, sop: result.sop, ms: parseEach + convertMs, parse_ms_amortized: parseEach, convert_ms: convertMs, device: info.device, outcome: result.outcome, valid: result.valid});
      diagnostics.push({id: row.id, language: row.language, message: row.question, outcome: result.outcome, valid: result.valid, error: result.error, repaired: result.repaired, notes: result.notes, unparsed: result.wires.filter(w => w.type === 'unparsed').map(({span, near, hint, why}) => ({span, near, hint, why}))});
    });
  }
  await worker.stop();
  const wall = (performance.now() - started) / 1000;
  const predFile = path.join(dir, BASELINE + '.predictions.jsonl');
  writeJsonl(predFile, predictions);
  writeJsonl(path.join(dir, BASELINE + '.diagnostics.jsonl'), diagnostics);
  // 2. Score every system on the same rows with the current harness.
  const idSet = new Set(ids);
  const systems = {[BASELINE]: predFile};
  for (const [name, file] of Object.entries(set.comparators)) {
    const subset = readJsonlShardedSync(path.join(ROOT, file)).filter(p => idSet.has(p.id));
    const f = path.join(dir, name + '.predictions.jsonl');
    writeJsonl(f, subset);
    systems[name] = f;
  }
  const scored = {};
  for (const [name, file] of Object.entries(systems)) {
    if (set.kind !== 'wild') { scored[name] = scoreExecuted(suiteFile, file, path.join(dir, name + '.evaluation.json')); continue; }
    // The wild scorer requires full coverage: rows outside the stage get an empty placeholder and are not read.
    const padded = path.join(dir, name + '.padded.jsonl');
    const have = new Set(readJsonl(file).map(p => p.id));
    writeJsonl(padded, [...readJsonl(file), ...allRows.filter(row => !have.has(row.id)).map(row => ({id: row.id, sop: ''}))]);
    scored[name] = scoreWild(padded, path.join(dir, name + '.wild.json'));
    fs.rmSync(padded);
  }
  // 3. Metrics every system gets alike, per row.
  const perRow = {};
  for (const [name, file] of Object.entries(systems)) {
    const bySop = new Map(readJsonl(file).map(p => [p.id, p.sop ?? p.prediction ?? '']));
    perRow[name] = new Map(rows.map(row => {
      const sop = bySop.get(row.id) ?? '';
      const h = honesty(sop, row.question);
      const rec = scored[name].byId.get(row.id) ?? {};
      const t = tolerantScores(sop, goldsOf(row));
      return [row.id, {...h, present: bySop.has(row.id), tolerant_prop_f1: t.props, tolerant_block_f1: t.blocks, tolerant_all_f1: t.all, language: row.language,
        exec: set.kind === 'wild' ? null : (rec.execution_equivalent_tolerant ? 1 : 0), syntax: set.kind === 'wild' ? (rec.parsed ? 1 : 0) : (rec.syntax_valid ? 1 : 0),
        accepted: set.kind === 'wild' ? rec.accepted_match ?? 0 : null, decision: set.kind === 'wild' ? rec.decision_match ?? 0 : null, prop_f1: set.kind === 'wild' ? rec.proposition_f1 ?? 0 : null}];
    }));
  }
  const summarize = (name, filter = () => true) => {
    const list = rows.filter(filter).map(row => perRow[name].get(row.id)).filter(r => r.present);
    const values = list.reduce((a, r) => a + r.values, 0);
    const report = scored[name].report;
    return {rows: list.length, parse_validity: mean(list.map(r => r.syntax)),
      ...(set.kind === 'wild' ? {accepted_match: mean(list.map(r => r.accepted)), decision_match: mean(list.map(r => r.decision)), proposition_f1: mean(list.map(r => r.prop_f1))} : {tolerant_execution_equivalence: mean(list.map(r => r.exec))}),
      d1_tolerant_proposition_f1: mean(list.map(r => r.tolerant_prop_f1)), d1_tolerant_query_block_f1: mean(list.map(r => r.tolerant_block_f1)), d1_tolerant_all_f1: mean(list.map(r => r.tolerant_all_f1)),
      invention_rate_strict: values ? list.reduce((a, r) => a + r.strict_unanchored, 0) / values : null,
      invention_rate_dictionary: values ? list.reduce((a, r) => a + r.dict_unanchored, 0) / values : null,
      rows_with_invented_value: mean(list.map(r => (r.dict_unanchored > 0 ? 1 : 0))),
      unparsed_rate: mean(list.map(r => (r.unparsed_wires > 0 ? 1 : 0))), unparsed_wires_per_output: mean(list.map(r => r.unparsed_wires)),
      unclear_rate: mean(list.map(r => (r.unclear ? 1 : 0))),
      ...(set.kind === 'wild' || filter !== undefined ? {} : {}),
      ...(set.kind !== 'wild' && filter === all ? {wire_f1: report.wire_match?.f1 ?? null} : {})};
  };
  const all = () => true;
  const result = {set: args.set, stage: stageKey, rows: rows.length, device: info.device, wall_seconds: wall, baseline_ms_per_message_amortized: mean(predictions.map(p => p.ms)),
    converter_admitted: mean(predictions.map(p => (p.valid ? 1 : 0))), outcomes: predictions.reduce((a, p) => ({...a, [p.outcome]: (a[p.outcome] ?? 0) + 1}), {}),
    systems: Object.fromEntries(Object.keys(systems).map(name => [name, {all: summarize(name, all), by_language: Object.fromEntries(['en', 'ro', 'mixed'].map(l => [l, summarize(name, row => row.language === l)]))}])),
    paired: {}};
  const key = set.kind === 'wild' ? ['accepted', 'decision', 'prop_f1', 'tolerant_prop_f1', 'tolerant_all_f1'] : ['exec', 'tolerant_all_f1'];
  for (const name of Object.keys(set.comparators)) {
    result.paired[name] = {};
    for (const k of key) for (const [slice, filter] of [['all', () => true], ['en', row => row.language === 'en'], ['ro', row => row.language === 'ro'], ['mixed', row => row.language === 'mixed']]) {
      const subset = rows.filter(filter).map(row => row.id).filter(id => perRow[name].get(id).present);
      result.paired[name][k + ':' + slice] = paired(subset, rowsById, perRow[name], perRow[BASELINE], r => (r ? r[k] : null));
    }
  }
  // 4. Stop rules: broken condition at stage 100.
  const empty = predictions.filter(p => !p.sop || !p.valid).length / predictions.length;
  result.stop_check = {invalid_or_empty_share: empty, broken: stageKey === '100' && empty > 0.2};
  writeJson(path.join(dir, 'result.json'), result);
  // 5. Short console summary.
  const b = result.systems[BASELINE].all;
  console.log(`${args.set} stage ${stageKey}: rows ${rows.length}, device ${info.device}, ${wall.toFixed(1)} s; admitted ${(result.converter_admitted * 100).toFixed(1)}%`);
  for (const [name, s] of Object.entries(result.systems)) {
    const a = s.all;
    console.log(name.padEnd(14), set.kind === 'wild' ? `acc ${(a.accepted_match * 100).toFixed(1)} dec ${(a.decision_match * 100).toFixed(1)} propF1 ${a.proposition_f1.toFixed(3)}` : `exec ${(a.tolerant_execution_equivalence * 100).toFixed(1)}`, `d1 prop ${a.d1_tolerant_proposition_f1.toFixed(3)} blocks ${a.d1_tolerant_query_block_f1.toFixed(3)} all ${a.d1_tolerant_all_f1.toFixed(3)} parse ${(a.parse_validity * 100).toFixed(1)} invent ${((a.invention_rate_dictionary ?? 0) * 100).toFixed(1)}% unparsed ${((a.unparsed_rate ?? 0) * 100).toFixed(1)}%`);
  }
  for (const [name, p] of Object.entries(result.paired)) {
    const main = p[(set.kind === 'wild' ? 'prop_f1' : 'exec') + ':all'];
    if (main) console.log(`  vs ${name}: delta ${(main.delta * 100).toFixed(1)} [${(main.ci95[0] * 100).toFixed(1)}, ${(main.ci95[1] * 100).toFixed(1)}] (${main.rows} rows)`);
  }
  void b;
}

// ------------------------------------------------------------------ latency

async function latencyCommand(args) {
  const n = Number(args.n ?? 60);
  const rows = readJsonlShardedSync(path.join(ROOT, SETS.wild.suite));
  const random = mulberry(11);
  const sample = [...rows].sort(() => random() - 0.5).slice(0, n);
  const out = {};
  for (const device of ['cuda', 'cpu']) {
    const worker = new StanzaWorker({device});
    const t0 = performance.now();
    const info = await worker.start();
    const load = (performance.now() - t0) / 1000;
    await worker.parse('warm up message.');
    const times = [];
    for (const row of sample) {
      const t = performance.now();
      const {parse: p} = await worker.parse(maskMessage(row.question));
      convertParse(p, row.question);
      times.push(performance.now() - t);
    }
    await worker.stop();
    times.sort((a, b) => a - b);
    const pct = q => times[Math.min(times.length - 1, Math.floor(q * times.length))];
    out[info.device] = {messages: n, model_load_seconds: load, p50_ms: pct(0.5), p90_ms: pct(0.9), max_ms: times.at(-1), mean_ms: mean(times), mean_chars: mean(sample.map(r => r.question.length))};
    console.log(info.device, JSON.stringify(out[info.device]));
  }
  writeJson(path.join(OUT, 'latency.json'), {method: 'sequential single-message parse+convert (masking, Stanza EN/RO, rules), after a warm-up; wild-suite sample seed 11; CPU run hides the GPU (CUDA_VISIBLE_DEVICES empty); torch default CPU threads', ...out});
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command === 'stages') return stagesCommand();
  if (args.command === 'run') return runCommand(args);
  if (args.command === 'latency') return latencyCommand(args);
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 6).join('\n'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
