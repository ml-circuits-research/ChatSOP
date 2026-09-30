#!/usr/bin/env node
/** Experiment eval-symbolic-lm-v1: SymbolicLM components and the Romanian direct-versus-translate comparison.
 *
 *   node tools/research/symbolic-lm-eval.mjs sets                                   # writes sets.json (A/B halves, stages)
 *   node tools/research/symbolic-lm-eval.mjs run   --set <name> --arms direct,translate [--stage 100|300|full] [--spell on|off] [--values source|english]
 *   node tools/research/symbolic-lm-eval.mjs score --set <name> --arms direct,translate [--stage ...] [--tag <suffix>]
 *   node tools/research/symbolic-lm-eval.mjs langid [--set <name>]                  # component (a) on dev token labels
 *   node tools/research/symbolic-lm-eval.mjs spelling                                # component (b) change audit on dev
 *
 * Every prediction is made from the row's message (`question`) alone (DS021). Sets: `roA`/`roB` are the two halves
 * of the monolingual clean Romanian rows of datasets_archive/formalizer-v1/dev.jsonl (split by a hash of split_group_id;
 * roA for development, roB held out), `mixed` the code-switched dev rows (exploratory), `noisyEn`/`noisyRo` the dev
 * rows with typing noise, `cleanEn` a sample of clean English dev rows, `oodRo` the clean monolingual Romanian rows
 * of the sealed OOD suite (final numbers only). Stages are nested stratified prefixes (question_type) of 100, 300
 * and the full set. Scoring uses eval/run.mjs `evaluate` (strict and tolerant execution equivalence, DS016) and a
 * paired cluster bootstrap over semantic cases (10,000 resamples, seed 7). Outputs: eval/reports/current/symbolic-lm/.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {evaluate} from '../../eval/run.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {bootstrap, mcnemar} from './spellfix-eval.mjs';
import {stages} from './ud-baseline-eval.mjs';
import {diffCategories, classesOf} from './symbolic-layers-diff.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/symbolic-lm');
const DEV = 'datasets_archive/formalizer-v1/dev.jsonl';
const OOD = 'eval/suites/formalizer-ood-v1/test.jsonl';
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function argumentsOf(argv) {
  const [command, ...rest] = argv;
  const args = {command};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) throw Error('Unexpected argument ' + rest[i]);
    const key = rest[i].slice(2);
    if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) args[key] = true; else args[key] = rest[++i];
  }
  return args;
}

const devRows = (() => { let cache; return () => (cache ??= readJsonlShardedSync(path.join(ROOT, DEV))); })();
const oodRows = (() => { let cache; return () => (cache ??= readJsonlShardedSync(path.join(ROOT, OOD))); })();
const mono = r => !r.code_switch && !(r.noise?.length);
const half = r => (parseInt(sha('symbolic-lm-v1:' + r.split_group_id).slice(0, 8), 16) % 2 === 0 ? 'A' : 'B');

/** The row sets of the experiment (ids and nested stages). */
function setsCommand() {
  const dev = devRows();
  const def = {
    roA: {suite: DEV, rows: dev.filter(r => r.language === 'ro' && mono(r) && half(r) === 'A')},
    roB: {suite: DEV, rows: dev.filter(r => r.language === 'ro' && mono(r) && half(r) === 'B')},
    mixed: {suite: DEV, rows: dev.filter(r => r.code_switch)},
    noisyRo: {suite: DEV, rows: dev.filter(r => r.language === 'ro' && !r.code_switch && r.noise?.length)},
    noisyEn: {suite: DEV, rows: dev.filter(r => r.language === 'en' && !r.code_switch && r.noise?.length)},
    cleanEn: {suite: DEV, rows: dev.filter(r => r.language === 'en' && mono(r))},
    cleanRoSpell: {suite: DEV, rows: dev.filter(r => r.language === 'ro' && mono(r))},
    oodRo: {suite: OOD, rows: oodRows().filter(r => r.language === 'ro' && mono(r))},
  };
  const out = {method: 'Halves A/B of the clean monolingual Romanian dev rows by sha256("symbolic-lm-v1:" + split_group_id) parity (A even); nested stratified stages by question_type (tools/research/ud-baseline-eval.mjs stages, seed 42).', dev_sha256: sha(fs.readFileSync(path.join(ROOT, DEV))), sets: {}};
  for (const [name, {suite, rows}] of Object.entries(def)) {
    const staged = stages(rows, r => r.question_type ?? 'unspecified', [100, 300].filter(n => n < rows.length));
    out.sets[name] = {suite, rows: rows.length, stages: Object.fromEntries(Object.entries(staged).map(([k, ids]) => [k, ids]))};
    console.log(name, rows.length);
  }
  writeJson(path.join(OUT, 'sets.json'), out);
}

function setRows(name, stage = 'full') {
  const sets = JSON.parse(fs.readFileSync(path.join(OUT, 'sets.json'), 'utf8'));
  const set = sets.sets[name];
  if (!set) throw Error('unknown set ' + name);
  const ids = new Set(set.stages[stage] ?? set.stages.full);
  const all = set.suite === DEV ? devRows() : oodRows();
  return all.filter(r => ids.has(r.id));
}

const ARMS = {
  direct: {route: 'direct', language: 'auto'},
  'direct-ro': {route: 'direct', language: 'ro'},
  translate: {route: 'translate', language: 'auto', keepConstraints: false},
  hybrid: {route: 'translate', language: 'auto', keepConstraints: true},
  'translate-ro': {route: 'translate', language: 'ro'},
  legacy: {legacy: true},
};

/** Runs the arms on a set; writes predictions and compact traces per arm. */
async function runCommand(args) {
  const rows = setRows(args.set, args.stage ?? 'full');
  const arms = String(args.arms ?? 'direct,translate').split(',');
  const spell = args.spell === 'on';
  const values = args.values ?? 'source';
  const tag = args.tag ? '-' + args.tag : '';
  // The code of this process is loaded once at start; its hashes are the run's identity (the rules may change on disk
  // while a run is in progress, but not inside this process).
  const manifest = {set: args.set, stage: args.stage ?? 'full', arms, spell, values, started_at: new Date().toISOString(), code_sha256: codeHashes()};
  const lm = await createSymbolicLM({device: 'cpu', secondParser: args.second === 'on'});
  for (const arm of arms) {
    const options = ARMS[arm];
    if (!options) throw Error('unknown arm ' + arm);
    const predictions = [], traces = [];
    const started = performance.now();
    // --reuse: rows already predicted by the same arm in an earlier stage of this set (same code, checked by the
    // caller through the manifests) are kept, and only the new rows of the stage are run.
    const dir0 = path.join(OUT, 'runs', args.set);
    const file0 = path.join(dir0, `${arm}${spell ? '-spell' : ''}${tag}.predictions.jsonl`);
    const previous = args.reuse && fs.existsSync(file0) ? new Map(readJsonl(file0).map(p => [p.id, p])) : new Map();
    const previousTraces = previous.size ? new Map(readJsonl(file0.replace('.predictions.', '.traces.')).map(t => [t.id, t])) : new Map();
    for (const row of rows) {
      if (previous.has(row.id)) { predictions.push(previous.get(row.id)); traces.push(previousTraces.get(row.id)); continue; }
      const t = performance.now();
      let result;
      try {
        if (options.legacy) {
          const {formalize} = await import('../eval/ud-baseline.mjs');
          const r = await formalize(lm.worker, row.question);
          result = {sop: r.sop, valid: r.valid, route: 'legacy', language: r.language, outcome: r.outcome, trace: {}};
        } else result = await lm.analyze(row.question, {route: options.route, language: options.language, spell, values, keepConstraints: options.keepConstraints});
      } catch (error) {
        result = {sop: '', valid: false, route: arm, outcome: 'crash', trace: {error: error.message}};
      }
      predictions.push({id: row.id, sop: result.sop, ms: performance.now() - t, valid: result.valid, route: result.route, outcome: result.outcome});
      const tr = result.trace ?? {};
      traces.push({id: row.id, message: row.question, route: result.route, language: result.language, outcome: result.outcome,
        spelling: tr.spelling?.changes ?? [], translation: tr.translation ? {text: tr.translation.text, untranslated: tr.translation.untranslated} : null,
        value_mapping: tr.value_mapping ?? [], unparsed: tr.unparsed ?? [], uncertainty: result.uncertainty ? {kinds: result.uncertainty.kinds, reasons: result.uncertainty.reasons} : null, rules: tr.rules ? {outcome: tr.rules.outcome, notes: tr.rules.notes} : null, error: tr.error ?? null});
      if (predictions.length % 25 === 0) process.stderr.write(`\r${arm} ${predictions.length}/${rows.length}`);
    }
    const dir = path.join(OUT, 'runs', args.set);
    writeJsonl(path.join(dir, `${arm}${spell ? '-spell' : ''}${tag}.predictions.jsonl`), predictions);
    writeJsonl(path.join(dir, `${arm}${spell ? '-spell' : ''}${tag}.traces.jsonl`), traces);
    console.error(`\n${args.set} ${arm}${spell ? ' +spell' : ''}: ${rows.length} rows in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  }
  await lm.stop();
  writeJson(path.join(OUT, 'runs', args.set, `manifest-${arms.join('+')}${spell ? '-spell' : ''}${tag}.json`), {...manifest, finished_at: new Date().toISOString()});
}

/** SHA-256 of every file that decides a SymbolicLM output (the freeze identity of eval-symbolic-lm-v1). */
export function codeHashes() {
  const out = {};
  for (const dir of ['lib/symbolic-lm', 'lib/translator-service', 'lib/translator-service/backends', 'lib/languages-util', 'lib/ud-to-sop', 'config/dictionary']) for (const name of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    const file = path.join(ROOT, dir, name);
    if (fs.statSync(file).isFile()) out[`${dir}/${name}`] = sha(fs.readFileSync(file));
  }
  for (const file of ['eval/relation-synonyms.json', 'lib/languages-util/spellfix.mjs', 'training/python/ud_parse_worker.py', 'sop/dictionary.mjs']) out[file] = sha(fs.readFileSync(path.join(ROOT, file)));
  return out;
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Paired comparison of two record lists: delta (b - a) with a cluster bootstrap CI over semantic cases. */
export function pairedDelta(rows, recordsA, recordsB, value) {
  const byA = new Map(recordsA.map(r => [r.id, r])), byB = new Map(recordsB.map(r => [r.id, r]));
  const clusters = new Map();
  let helped = 0, hurt = 0;
  const pairs = [];
  for (const row of rows) {
    const a = byA.get(row.id), b = byB.get(row.id);
    if (!a || !b) continue;
    const pair = [value(a), value(b)];
    pairs.push(pair);
    if (pair[1] > pair[0]) helped++; else if (pair[1] < pair[0]) hurt++;
    const key = row.semantic_case_id ?? row.id;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(pair);
  }
  const ci = bootstrap([...clusters.values()]);
  return {rows: pairs.length, a: mean(pairs.map(p => p[0])), b: mean(pairs.map(p => p[1])), delta: mean(pairs.map(p => p[1] - p[0])), ci95: ci, b_better: helped, a_better: hurt, mcnemar_p: mcnemar(hurt, helped)};
}

/** Wilson 95% interval of a proportion. */
export function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [c - h, c + h];
}

/**
 * D1-tolerant alignment for the blame diff: a predicted relation or value that means the same as a gold string by
 * the host dictionary (sameMeaning) is replaced by that gold string before sop/ structural diffing.
 */
function alignToGold(pred, gold, dictionary) {
  const strings = [...String(gold).matchAll(/^\s*(relation|role \w+|at|during|asof|valid \w+)\s+("(?:[^"\\]|\\.)*")/gm)].map(m => ({kind: m[1] === 'relation' ? 'relation' : 'value', value: JSON.parse(m[2])}));
  return String(pred).replace(/^(\s*)(relation|role \w+|at|during|asof|valid \w+)\s+("(?:[^"\\]|\\.)*")/gm, (line, indent, key, literal) => {
    let value;
    try { value = JSON.parse(literal); } catch { return line; }
    const kind = key === 'relation' ? 'relation' : 'value';
    const same = strings.find(s => s.kind === kind && s.value !== value && dictionary.sameMeaning(value, s.value, kind));
    return same ? `${indent}${key} ${JSON.stringify(same.value)}` : line;
  });
}

/** Scores arms of a set: metrics, paired deltas, blame classes; writes <set>/score[-stage].json. */
async function scoreCommand(args) {
  const stage = args.stage ?? 'full';
  const rows = setRows(args.set, stage);
  const arms = String(args.arms ?? 'direct,translate').split(',');
  const dir = path.join(OUT, 'runs', args.set);
  const dictionary = defaultDictionary();
  const records = {};
  const traces = {};
  for (const arm of arms) {
    let predictions = new Map(readJsonl(path.join(dir, `${arm}.predictions.jsonl`)).map(p => [p.id, p.sop]));
    // --frames: the host frame/synonym normalization (sop/frames.mjs, owner answer Q-SYM-2) applied to the output
    // before scoring; reported beside the strict score, never instead of it.
    if (args.frames) {
      const {loadFrames, normalizeProgram} = await import('../../sop/frames.mjs');
      const frames = loadFrames();
      predictions = new Map([...predictions].map(([id, sop]) => [id, normalizeProgram(sop, frames).sop]));
    }
    traces[arm] = new Map(readJsonl(path.join(dir, `${arm}.traces.jsonl`)).map(t => [t.id, t]));
    const subset = rows.filter(r => predictions.has(r.id));
    if (subset.length !== rows.length) throw Error(`${arm}: ${rows.length - subset.length} rows of stage ${stage} have no prediction`);
    const report = await evaluate(subset, {predictor: ({id}) => predictions.get(id), config: {}, source: 'predictions'});
    records[arm] = report.records.map(r => ({id: r.id, strict: r.execution_equivalent ? 1 : 0, tolerant: r.execution_equivalent_tolerant ? 1 : 0, canonical_tolerant: r.canonical_match_tolerant ? 1 : 0, syntax: r.syntax_valid ? 1 : 0, runtime: r.runtime_valid ? 1 : 0, error: r.error?.message ?? null, prediction: r.prediction}));
    process.stderr.write(`scored ${arm}\n`);
  }
  const rowById = new Map(rows.map(r => [r.id, r]));
  const summary = {set: args.set, stage, rows: rows.length, arms: {}, paired: {}, blame: {}};
  for (const arm of arms) {
    const rs = records[arm];
    const k = key => rs.filter(r => r[key]).length;
    const tr = [...traces[arm].values()].filter(t => rowById.has(t.id));
    summary.arms[arm] = {
      tolerant: k('tolerant') / rs.length, tolerant_ci95: wilson(k('tolerant'), rs.length), strict: k('strict') / rs.length, strict_ci95: wilson(k('strict'), rs.length),
      canonical_tolerant: k('canonical_tolerant') / rs.length, syntax: k('syntax') / rs.length, runtime: k('runtime') / rs.length,
      empty_or_invalid: rs.filter(r => !r.syntax || !String(r.prediction ?? '').trim()).length / rs.length,
      with_unparsed: tr.filter(t => t.unparsed?.length).length / Math.max(1, tr.length),
      with_untranslated: tr.filter(t => t.translation?.untranslated?.length).length / Math.max(1, tr.length),
      untranslated_words: tr.reduce((a, t) => a + (t.translation?.untranslated?.length ?? 0), 0),
      values_mapped: tr.reduce((a, t) => a + (t.value_mapping ?? []).filter(m => m.source).length, 0),
      values_kept_english: tr.reduce((a, t) => a + (t.value_mapping ?? []).filter(m => !m.source && m.english !== undefined).length, 0),
    };
    // Automatic blame of misses (tolerant): T = translation (an untranslated word), then the Layer-2 diff classes of
    // eval-symbolic-layers-en-v1 after dictionary-tolerant alignment (P input typo, R rules, C gold convention, L, E).
    const blame = {correct: 0};
    const byCategory = {};
    for (const r of rs) {
      if (r.tolerant) { blame.correct++; continue; }
      const row = rowById.get(r.id), t = traces[arm].get(r.id);
      let cls;
      if (!r.syntax) cls = 'invalid';
      else if (t?.translation?.untranslated?.length) cls = 'T';
      else {
        const cats = diffCategories(alignToGold(r.prediction, row.sop_target, dictionary), row.sop_target, {executed: true, message: row.question});
        for (const c of cats) byCategory[c.cat] = (byCategory[c.cat] ?? 0) + 1;
        const classes = classesOf(cats);
        cls = classes.length ? classes.join('+') : 'no_structural_diff';
      }
      blame[cls] = (blame[cls] ?? 0) + 1;
    }
    summary.blame[arm] = {messages: blame, categories: Object.fromEntries(Object.entries(byCategory).sort((a, b) => b[1] - a[1]))};
  }
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
    const [a, b] = [arms[i], arms[j]];
    summary.paired[`${b} - ${a}`] = {
      tolerant: pairedDelta(rows, records[a], records[b], r => r.tolerant),
      strict: pairedDelta(rows, records[a], records[b], r => r.strict),
      canonical_tolerant: pairedDelta(rows, records[a], records[b], r => r.canonical_tolerant),
    };
  }
  // Per question type (tolerant), for the two first arms.
  const types = {};
  for (const row of rows) (types[row.question_type ?? 'unspecified'] ??= []).push(row);
  summary.by_question_type = Object.fromEntries(Object.entries(types).map(([type, list]) => [type, Object.fromEntries(arms.map(arm => {
    const ids = new Set(list.map(r => r.id));
    const rs = records[arm].filter(r => ids.has(r.id));
    return [arm, {rows: rs.length, tolerant: rs.filter(r => r.tolerant).length}];
  }))]));
  const tag = args.tag ? '-' + args.tag : '';
  writeJson(path.join(dir, `score-${stage}${tag}.json`), summary);
  writeJsonl(path.join(dir, `records-${stage}${tag}.jsonl`), rows.map(row => ({id: row.id, question_type: row.question_type, message: row.question, gold: row.sop_target, ...Object.fromEntries(arms.map(arm => {
    const r = records[arm].find(x => x.id === row.id);
    return [arm, {tolerant: r.tolerant, strict: r.strict, sop: r.prediction, translation: traces[arm].get(row.id)?.translation?.text ?? null, untranslated: (traces[arm].get(row.id)?.translation?.untranslated ?? []).map(u => u.word)}];
  }))})));
  console.log(JSON.stringify({set: summary.set, stage, rows: summary.rows, arms: Object.fromEntries(Object.entries(summary.arms).map(([k, v]) => [k, {tolerant: +v.tolerant.toFixed(4), strict: +v.strict.toFixed(4), invalid: +v.empty_or_invalid.toFixed(4), untranslated_msgs: +v.with_untranslated.toFixed(3)}])), paired: Object.fromEntries(Object.entries(summary.paired).map(([k, v]) => [k, {tolerant: [+(v.tolerant.delta * 100).toFixed(1), v.tolerant.ci95?.map(x => +(x * 100).toFixed(1)), v.tolerant.b_better, v.tolerant.a_better], strict: [+(v.strict.delta * 100).toFixed(1), v.strict.ci95?.map(x => +(x * 100).toFixed(1))]}]))}, null, 1));
}

// ------------------------------------------------------------------ component (a): language identification

/**
 * Token-level gold from the rows: every word of a monolingual row is in the row's language; in a code-switched row
 * with insertions, tags or values, the words of the inserted strings are in the embedded language and the rest in
 * the matrix language. Names (a capitalized word inside a sentence or a known name run), numbers and punctuation
 * are not scored. Clause-switch rows have no token gold and are skipped.
 */
function tokenGold(row) {
  const cs = row.code_switch;
  if (cs?.kind === 'clause_switch') return null;
  const spans = [];
  if (cs) for (const inserted of cs.inserted ?? []) {
    let from = 0;
    for (;;) { const at = row.question.indexOf(inserted, from); if (at < 0) break; spans.push([at, at + inserted.length]); from = at + 1; }
  }
  return (start, end) => {
    if (!cs) return row.language;
    return spans.some(([a, b]) => start >= a && end <= b) ? cs.embedded : cs.matrix;
  };
}

async function langidCommand(args = {}) {
  const {loadSpellfix, identify, lexiconsFromSpellfix} = await import('../../lib/languages-util/index.mjs');
  const spell = loadSpellfix();
  const lexicons = lexiconsFromSpellfix(spell);
  const dictionary = defaultDictionary();
  const source = args.suite === 'ood' ? oodRows() : devRows();
  const rows = source.filter(r => !(r.noise?.length));
  const noisy = source.filter(r => r.noise?.length);
  const tally = () => ({tokens: 0, correct: 0, confusion: {}, messages: 0, message_correct: 0, errors: {}});
  const groups = {mono_en: tally(), mono_ro: tally(), switched: tally(), noisy: tally()};
  const started = performance.now();
  for (const [list, noisyFlag] of [[rows, false], [noisy, true]]) for (const row of list) {
    const gold = tokenGold(row);
    if (!gold) continue;
    const g = noisyFlag ? groups.noisy : row.code_switch ? groups.switched : row.language === 'en' ? groups.mono_en : groups.mono_ro;
    const result = identify(row.question, {lexicons, dictionary});
    for (const t of result.tokens) {
      if (t.kind !== 'word' || !['ro', 'en'].includes(t.label)) continue;
      const truth = gold(t.start, t.end);
      g.tokens++;
      if (t.label === truth) g.correct++;
      else { const key = `${truth}->${t.label}: ${t.text.toLowerCase()}`; g.errors[key] = (g.errors[key] ?? 0) + 1; }
      const c = `${truth}->${t.label}`;
      g.confusion[c] = (g.confusion[c] ?? 0) + 1;
    }
    // Message language: a code-switched row is `mixed`, else its language.
    const truthMessage = row.code_switch ? 'mixed' : row.language;
    g.messages++;
    if (result.language === truthMessage) g.message_correct++;
    // Proper names: a capitalized word the row's gold names as an entity must not be labelled ro/en.
  }
  const ms = (performance.now() - started) / (rows.length + noisy.length);
  const out = {method: 'Token gold: the row language for monolingual rows; the embedded language for the words of code_switch.inserted strings and the matrix language elsewhere (clause_switch rows skipped). Scored tokens: words the identifier labels ro or en (names, numbers and punctuation are excluded by the identifier itself). Message language gold: mixed for code-switched rows.', ms_per_message: ms, groups: {}};
  for (const [name, g] of Object.entries(groups)) {
    out.groups[name] = {tokens: g.tokens, accuracy: g.correct / g.tokens, accuracy_ci95: wilson(g.correct, g.tokens), confusion: g.confusion, messages: g.messages,
      message_accuracy: g.message_correct / g.messages, top_errors: Object.entries(g.errors).sort((a, b) => b[1] - a[1]).slice(0, 25)};
  }
  // Names: share of gold entity labels (verification_context.entities) whose capitalized words are labelled `name`.
  let nameWords = 0, nameKept = 0;
  for (const row of rows.slice(0, 1500)) {
    const labels = (row.verification_context?.entities ?? []).map(e => e.label).filter(l => /^\p{Lu}/u.test(l));
    const result = identify(row.question, {lexicons, dictionary});
    for (const label of labels) {
      const at = row.question.indexOf(label);
      if (at < 0) continue;
      for (const t of result.tokens.filter(t => t.kind === 'word' && t.start >= at && t.end <= at + label.length && /^\p{Lu}/u.test(t.text))) { nameWords++; if (t.label === 'name') nameKept++; }
    }
  }
  out.names = {capitalized_entity_words: nameWords, labelled_name: nameKept, share: nameKept / nameWords};
  out.suite = args.suite === 'ood' ? OOD : DEV;
  writeJson(path.join(OUT, args.suite === 'ood' ? 'langid-ood.json' : 'langid.json'), out);
  console.log(JSON.stringify({ms_per_message: +ms.toFixed(2), names: out.names, ...Object.fromEntries(Object.entries(out.groups).map(([k, v]) => [k, {tokens: v.tokens, accuracy: +v.accuracy.toFixed(4), message_accuracy: +v.message_accuracy.toFixed(4)}]))}, null, 1));
}

// ------------------------------------------------------------------ uncertainty gate quality

/** Does `uncertain` predict a miss (tolerant execution) of the arm on the set? Per reason kind as well. */
async function gateCommand(args) {
  const stage = args.stage ?? 'full';
  const arm = args.arm ?? 'translate';
  const dir = path.join(OUT, 'runs', args.set);
  const records = readJsonl(path.join(dir, `records-${stage}${args.tag ? '-' + args.tag : ''}.jsonl`));
  const traces = new Map(readJsonl(path.join(dir, `${arm}.traces.jsonl`)).map(t => [t.id, t]));
  const rows = records.map(r => ({fail: r[arm].tolerant ? 0 : 1, kinds: traces.get(r.id)?.uncertainty?.kinds ?? []}));
  const n = rows.length, fails = rows.filter(r => r.fail).length;
  const summarize = pred => {
    const flagged = rows.filter(pred), tp = flagged.filter(r => r.fail).length;
    const unflagged = rows.filter(r => !pred(r)), fn = unflagged.filter(r => r.fail).length;
    return {flagged: flagged.length, flagged_share: flagged.length / n, fail_rate_flagged: flagged.length ? tp / flagged.length : null, fail_rate_unflagged: unflagged.length ? fn / unflagged.length : null,
      precision: flagged.length ? tp / flagged.length : null, recall: fails ? tp / fails : null, fail_rate_flagged_ci95: wilson(tp, flagged.length), fail_rate_unflagged_ci95: wilson(fn, unflagged.length)};
  };
  const kinds = [...new Set(rows.flatMap(r => r.kinds))];
  const out = {set: args.set, arm, stage, rows: n, base_fail_rate: fails / n, any: summarize(r => r.kinds.length > 0),
    by_kind: Object.fromEntries(kinds.map(k => [k, summarize(r => r.kinds.includes(k))])),
    by_score: Object.fromEntries([1, 2, 3].map(k => [`>=${k}`, summarize(r => r.kinds.length >= k)]))};
  writeJson(path.join(dir, `gate-${arm}-${stage}.json`), out);
  console.log(JSON.stringify({set: out.set, arm, rows: n, base_fail: +out.base_fail_rate.toFixed(3), any: {flagged: out.any.flagged, precision: +(out.any.precision ?? 0).toFixed(3), recall: +(out.any.recall ?? 0).toFixed(3), fail_unflagged: +(out.any.fail_rate_unflagged ?? 0).toFixed(3)},
    by_kind: Object.fromEntries(Object.entries(out.by_kind).map(([k, v]) => [k, [v.flagged, +(v.precision ?? 0).toFixed(3)]]))}, null, 1));
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command === 'sets') return setsCommand();
  if (args.command === 'run') return runCommand(args);
  if (args.command === 'score') return scoreCommand(args);
  if (args.command === 'langid') return langidCommand(args);
  if (args.command === 'gate') return gateCommand(args);
  if (args.command === 'hashes') return console.log(JSON.stringify(codeHashes(), null, 1));
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
