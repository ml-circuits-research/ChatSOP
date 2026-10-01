#!/usr/bin/env node
/**
 * Decomposition scoring (experiment eval-decomposition-v1, DS016 "Decomposition and detectability"): runs arms over the sealed decomposition suite
 * (eval/suites/decomposition/test.jsonl) and grades what the user would be told, with the graded severity grader (lib/severity) as primary.
 *
 *   node tools/eval/decomposition-score.mjs arms   --endpoint URL [--arms none,it2-always,it2-gated,it2-partial] [--suite F]   run the arms (CPU Stanza), write arms/<arm>.jsonl
 *   node tools/eval/decomposition-score.mjs pairs                                                     severity pairs (message vs summary, message vs rewrite), local layers, omp residue folders
 *   node tools/eval/decomposition-score.mjs report                                                    merge the judges, write summary.json and summary.md
 *
 * Arms (every arm sends each host-split sentence unit to SymbolicProofingLLM iteration 2, the GGUF behind --endpoint; greedy, message-only prompt):
 *   none         no rewrite (the message as it is)
 *   it2-always   every unit sent, every output accepted (the chat's "send everything")
 *   it2-gated    gate `trees` (only an uncertified unit is sent), acceptance `certified` (the output is certified AND the mechanical meaning checks hold)
 *   it2-partial  gate `trees`; an output whose sentences are not all certified is not thrown away: the certified output sentences are kept and the original unit
 *                follows, marked not represented (the proposed partial-acceptance rule; host-side here, no change in lib/)
 * The interpretation is the one the chat shows (lib/symbolic-lm/interpretation.mjs) for the final text. `S` ("I understood") is the CNL of every verified sentence
 * and the original wording of a sentence shown as uncertain. Detectability: the interpretation marks a not-represented span, an uncertain sentence, or a partial leftover.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {runRewritePipeline, mechanicalMeaning} from '../../lib/symbolic-lm/rewrite-gate.mjs';
import {interpretResult} from '../../lib/symbolic-lm/interpretation.mjs';
import {endpointRewriter, cachedRewriter} from './composed/rewriters.mjs';
import {localGrade, readJsonl, writeJsonl} from './severity-local.mjs';
import {folderFromPairs, loadVerdicts} from './severity-judge.mjs';
import {pairId} from './severity-apply.mjs';
import {rank, SEVERITIES} from '../../lib/severity/scale.mjs';
import {fmt} from '../../lib/severity/metrics.mjs';
import {markers, understoodText, maxSeverity, failureStats, shapeStats, paired} from './decomposition/metrics.mjs';
import {TANGLE_TYPES} from './decomposition/tangle.mjs';

export const WORK = path.join(ROOT, process.env.DECOMP_WORK ?? 'eval/reports/current/decomposition');
export const SUITE_FILE = path.join(ROOT, 'eval/suites/decomposition/test.jsonl');
export const ARMS = ['none', 'it2-always', 'it2-gated', 'it2-partial', 'it3-always', 'it3-gated', 'it3f16-always', 'it3f16-gated'];
/** An arm name is `<model>-<mode>` (it2, it3, it3f16 = the F16 GGUF of it3) with the mode always, gated or partial; the model picks the endpoint and the raw-output cache. */
const armParts = arm => { const m = /^(it\d+(?:f16)?)-(always|gated|partial)$/.exec(arm); return m ? {model: m[1], mode: m[2]} : {model: null, mode: arm}; };
const same = (a, b) => String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim();
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

/** The partial-acceptance pipeline: like runRewritePipeline (gate `trees`) but an output with some certified sentences is kept in part. */
export async function runPartialPipeline(text, {split, inspect, rewrite}) {
  const parts = [], leftovers = [], units = [];
  for (const u of split(text)) {
    const facts = await inspect(u.text);
    const rec = {text: u.text, sent: false, accepted: false, partial: false, reasons: [], output: null, certified: facts.certified};
    let final = u.text;
    if (!facts.certified) {
      rec.sent = true;
      const out = String(await rewrite(u.text) ?? '').trim();
      rec.output = out;
      if (out && !same(out, u.text)) {
        const m = mechanicalMeaning(u.text, out);
        const outSentences = split(out).map(x => x.text);
        const cert = [];
        for (const s of outSentences) cert.push((await inspect(s)).certified);
        if (!m.ok) rec.reasons.push(...['nonempty', 'names', 'numbers', 'negation', 'quantifiers', 'question'].filter(k => !m[k]).map(k => `meaning_${k}`));
        else if (cert.every(Boolean)) { final = out; rec.accepted = true; }
        else if (cert.some(Boolean)) { final = [...outSentences.filter((_, i) => cert[i]), u.text].join(' '); rec.accepted = true; rec.partial = true; leftovers.push(u.text); }
        else rec.reasons.push('not_certified');
      }
    }
    parts.push(final);
    units.push(rec);
  }
  return {text: parts.join(' ').trim(), units, leftovers, applied: units.some(u => u.accepted)};
}

async function runArm(arm, rows, {lm, rewrite}) {
  const inspect = unit => lm.inspectUnit(unit);
  const out = [];
  for (const [n, row] of rows.entries()) {
    let text = row.message, units = [], leftovers = [];
    const {mode} = armParts(arm);
    if (mode === 'always') { const r = await runRewritePipeline(row.message, {split: splitSentences, inspect, rewrite, gate: 'always', acceptance: 'off'}); text = r.text; units = r.units; }
    else if (mode === 'gated') { const r = await runRewritePipeline(row.message, {split: splitSentences, inspect, rewrite, gate: 'trees', acceptance: 'certified'}); text = r.text; units = r.units; }
    else if (mode === 'partial') { const r = await runPartialPipeline(row.message, {split: splitSentences, inspect, rewrite}); text = r.text; units = r.units; leftovers = r.leftovers; }
    let result, interp;
    try { result = await lm.analyze(text, {route: 'direct', language: 'auto'}); interp = await interpretResult(lm, result, {certify: true}); }
    catch (error) { interp = {available: false, reason: String(error.message).slice(0, 120), sentences: [], not_represented: []}; }
    const mk = markers(interp, {leftovers});
    out.push({id: row.id, arm, type: row.type, message: row.message, output: text, changed: !same(text, row.message), units: units.map(u => ({text: u.text, sent: u.sent, accepted: u.accepted, partial: u.partial ?? false, reasons: u.reasons, output: u.output, certified: u.certified})),
      leftovers, sentences: interp.sentences?.length ?? 0, input_sentences: splitSentences(row.message).length, certified_sentences: (interp.sentences ?? []).filter(s => s.certified === true).length, all_certified: interp.certified === true, expected: row.expected.length,
      status: (interp.sentences ?? []).map(s => s.status), not_represented: interp.not_represented ?? [], marked: mk.marked, marker_reasons: mk.reasons, summary: understoodText(interp), available: Boolean(interp.available)});
    if ((n + 1) % 25 === 0) console.log(`${arm}: ${n + 1}/${rows.length}`);
  }
  return out;
}

async function arms(o) {
  const rows = readJsonl(o.suite ?? SUITE_FILE);
  const names = o.arms ? String(o.arms).split(',') : ARMS.filter(a => ['none', 'it2-always', 'it2-gated', 'it2-partial'].includes(a));
  const rewriters = {};
  const rewriterFor = model => {
    if (rewriters[model]) return rewriters[model];
    const endpoint = o[`endpoint-${model}`] ?? (model === 'it2' ? o.endpoint : null);
    return (rewriters[model] = endpoint ? cachedRewriter(endpointRewriter(endpoint), path.join(WORK, `cache/raw-${model}.jsonl`)) : async () => { throw Error(`--endpoint-${model} URL is needed for the ${model} arms`); });
  };
  const lm = await createSymbolicLM({device: process.env.CHATSOP_UD_DEVICE ?? 'cpu'});
  try { for (const arm of names) { const {model} = armParts(arm); const res = await runArm(arm, rows, {lm, rewrite: model ? rewriterFor(model) : async () => { throw Error('no rewriting arm'); }}); writeJsonl(path.join(WORK, 'arms', `${arm}.jsonl`), res); console.log(JSON.stringify({arm, rows: res.length, changed: res.filter(r => r.changed).length, marked: res.filter(r => r.marked).length})); } }
  finally { await lm.stop(); }
}

/** Judge folders: DECOMP_GRADE is the prefix written by `pairs` (default decomp_eval_grade); DECOMP_GRADE_REUSE is an earlier prefix whose verdicts are reused (a pair already judged is not judged again). */
const GRADE = process.env.DECOMP_GRADE ?? 'decomp_eval_grade', REUSE = process.env.DECOMP_GRADE_REUSE ?? null;
const loadJudge = (prefix, j) => { const n = `${prefix}_${j}`; return fs.existsSync(path.join(ROOT, 'datasets_sources', n, 'output/verdicts.jsonl')) ? loadVerdicts(n) : new Map(); };
const judgeMaps = j => new Map([...(REUSE ? loadJudge(REUSE, j) : new Map()), ...(GRADE === REUSE ? new Map() : loadJudge(GRADE, j))]);

const armRows = arm => readJsonl(path.join(WORK, 'arms', `${arm}.jsonl`));
const allPairs = () => {
  const m = new Map();
  for (const arm of ARMS.filter(a => fs.existsSync(path.join(WORK, 'arms', `${a}.jsonl`)))) for (const r of armRows(arm)) {
    const add = (a, b) => { const p = {a, b}; m.set(pairId(p), {id: pairId(p), a, b}); };
    add(r.message, r.summary || ' ');   // what the user is shown against what they wrote
    if (r.changed) add(r.message, r.output);   // the rewritten text itself
  }
  return [...m.values()];
}

async function pairs(o) {
  const list = allPairs().filter(p => p.b.trim());
  writeJsonl(path.join(WORK, 'grade/pairs.jsonl'), list);
  const have = new Map(readJsonl(path.join(WORK, 'grade/local.jsonl')).map(r => [r.id, r]));
  const todo = list.filter(p => !have.has(p.id));
  const res = todo.length ? await localGrade(todo, {device: process.env.CHATSOP_UD_DEVICE ?? 'cpu'}) : [];
  const local = [...have.values(), ...res];
  writeJsonl(path.join(WORK, 'grade/local.jsonl'), local);
  const byId = new Map(list.map(p => [p.id, p]));
  const judged = new Set([...judgeMaps('grok').keys()].filter(id => judgeMaps('glm').has(id)));
  const residue = local.filter(r => !r.local.decided && !judged.has(r.id)).map(r => byId.get(r.id)).filter(Boolean);
  writeJsonl(path.join(WORK, 'grade/residue.jsonl'), residue);
  const folders = o['no-folders'] ? [] : ['grok', 'glm'].map(j => folderFromPairs(`${GRADE}_${j}`, residue));
  const c = {};
  for (const r of local) { const k = `${r.local.layer}:${r.local.severity ?? '-'}`; c[k] = (c[k] ?? 0) + 1; }
  console.log(JSON.stringify({pairs: list.length, new_local: todo.length, residue: residue.length, layers: c, folders}));
}

/** Severity of a pair: local layers, else the judges (upper = the worse of Grok and GLM, lower = the milder). */
export function pairSeverity(id, local, judges) {
  const l = local.get(id);
  if (l?.decided) return {upper: l.severity, lower: l.severity, layer: l.layer};
  const g = judges.grok.get(id) ?? null, z = judges.glm.get(id) ?? null;
  const up = g && z ? (rank(g) >= rank(z) ? g : z) : g ?? z, lo = g && z ? (rank(g) <= rank(z) ? g : z) : g ?? z;
  return {upper: up ?? null, lower: lo ?? null, layer: 'judge'};
}

function gradeArm(arm, local, judges) {
  return armRows(arm).map(r => {
    const empty = !r.summary?.trim();
    const sU = empty ? {upper: 'NONE', lower: 'NONE', layer: 'empty'} : pairSeverity(pairId({a: r.message, b: r.summary}), local, judges);
    const sR = r.changed ? pairSeverity(pairId({a: r.message, b: r.output}), local, judges) : {upper: 'S0', lower: 'S0', layer: 'exact'};
    return {...r, severity: sU.upper, severity_lower: sU.lower, severity_rewrite: sR.upper, severity_rewrite_lower: sR.lower, layer: sU.layer};
  });
}

const pct = w => (w.rate === null ? 'n/a' : `${(w.rate * 100).toFixed(1)}%`);
const row = (label, st, keys) => `| ${label} | ${keys.map(k => fmt(st[k])).join(' | ')} |`;

function report() {
  const local = new Map(readJsonl(path.join(WORK, 'grade/local.jsonl')).map(r => [r.id, r.local]));
  const judges = {grok: judgeMaps('grok'), glm: judgeMaps('glm')};
  const out = {generated_at: new Date().toISOString(), experiment: 'eval-decomposition-v1', arms: {}};
  const graded = {};
  for (const arm of ARMS) if (fs.existsSync(path.join(WORK, 'arms', `${arm}.jsonl`))) {
    const g = gradeArm(arm, local, judges);
    graded[arm] = g;
    writeJsonl(path.join(WORK, 'grade', `${arm}.graded.jsonl`), g);
    const byType = {};
    for (const t of TANGLE_TYPES) { const rs = g.filter(r => r.type === t); byType[t] = {n: rs.length, upper: failureStats(rs, 'severity'), lower: failureStats(rs, 'severity_lower'), shape: shapeStats(rs)}; }
    const dist = which => Object.fromEntries(SEVERITIES.map(s => [s, g.filter(r => r[which] === s).length]));
    out.arms[arm] = {n: g.length, upper: failureStats(g, 'severity'), lower: failureStats(g, 'severity_lower'), rewrite_upper: failureStats(g.map(r => ({...r, severity: r.severity_rewrite})), 'severity'), shape: shapeStats(g), by_type: byType,
      distribution_upper: dist('severity'), distribution_lower: dist('severity_lower'), marked: g.filter(r => r.marked).length, rewrite_applied: g.filter(r => r.changed).length,
      mean_severity_worst_of: maxSeverity};
    delete out.arms[arm].mean_severity_worst_of;
  }
  fs.writeFileSync(path.join(WORK, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
  const arms = Object.keys(out.arms);
  const md = [];
  md.push('## Primary: what the user is told against what they wrote (summary of the interpretation, graded severity)', '', 'Upper estimate = the worse of the two judges (Grok, GLM) where the local layers do not decide; lower = the milder. The true rate lies between.', '');
  md.push(`| metric | ${arms.join(' | ')} |`, `| --- | ${arms.map(() => '---').join(' | ')} |`);
  const line = (label, f) => md.push(`| ${label} | ${arms.map(a => f(out.arms[a])).join(' | ')} |`);
  line('cases', a => a.n);
  line('catastrophic S4 (upper)', a => fmt(a.upper.catastrophic));
  line('catastrophic S4 (lower)', a => fmt(a.lower.catastrophic));
  line('S4 that is silent (no marker, upper)', a => fmt(a.upper.catastrophic_silent));
  line('failure S3 or S4 (upper)', a => fmt(a.upper.failure_s3plus));
  line('failure that is detectable (marker present, upper)', a => fmt(a.upper.failure_detectable));
  // owner rule (2026-10-01): where the two judges disagree on S3/S4 the case is excusable ambiguity, reported apart, not a model failure
  const amb = a => { const g = graded[a] ?? [], up = r => r.severity && rank(r.severity) >= 3, lo = r => r.severity_lower && rank(r.severity_lower) >= 3; return {n: g.length, firm4: g.filter(r => r.severity === 'S4' && r.severity_lower === 'S4').length, ambiguous4: g.filter(r => r.severity === 'S4' && r.severity_lower !== 'S4').length, firm3p: g.filter(r => up(r) && lo(r)).length, ambiguous3p: g.filter(r => up(r) && !lo(r)).length, firm_silent: g.filter(r => up(r) && lo(r) && !r.marked).length, ambiguous_silent: g.filter(r => up(r) && !lo(r) && !r.marked).length}; };
  out.ambiguity = Object.fromEntries(arms.map(a => [a, amb(a)]));
  const lineA = (label, f) => md.push(`| ${label} | ${arms.map(a => f(a)).join(' | ')} |`);
  const cnt = (k, n) => `${k}/${n} = ${(100 * k / n).toFixed(1)}%`;
  lineA('FIRM S4 (both judges S4)', a => { const x = out.ambiguity[a]; return cnt(x.firm4, x.n); });
  lineA('excusable ambiguity on S4 (upper S4, lower below S4)', a => { const x = out.ambiguity[a]; return cnt(x.ambiguous4, x.n); });
  lineA('FIRM failure S3+ (both judges S3+)', a => { const x = out.ambiguity[a]; return cnt(x.firm3p, x.n); });
  lineA('excusable ambiguity on S3+ (upper S3+, lower below S3)', a => { const x = out.ambiguity[a]; return cnt(x.ambiguous3p, x.n); });
  lineA('FIRM silent meaning change (both judges S3+, no marker)', a => { const x = out.ambiguity[a]; return cnt(x.firm_silent, x.n); });
  lineA('silent change that is only excusable ambiguity', a => { const x = out.ambiguity[a]; return cnt(x.ambiguous_silent, x.n); });
  line('**silent meaning change** (S3+ with no marker, upper)', a => fmt(a.upper.silent_meaning_change));
  line('silent meaning change (lower)', a => fmt(a.lower.silent_meaning_change));
  line('acceptable (good enough or detectable failure, upper)', a => fmt(a.upper.acceptable));
  line('good enough S0 to S2 (upper)', a => fmt(a.upper.good_enough));
  line('no interpretation (NONE)', a => fmt(a.upper.none));
  line('rewritten text itself catastrophic S4 (upper)', a => fmt(a.rewrite_upper.catastrophic));
  md.push('', '## Detectability and shape', '', `| metric | ${arms.join(' | ')} |`, `| --- | ${arms.map(() => '---').join(' | ')} |`);
  line('interpretation marks something (not represented, uncertain, partial leftover)', a => `${a.marked}/${a.n} = ${pct({rate: a.marked / a.n})}`);
  line('output sentences certified (per sentence)', a => fmt(a.shape.certified_sentences));
  line('cases with every output sentence certified', a => fmt(a.shape.all_certified_cases));
  line('mean output sentences (expected mean ' + (out.arms[arms[0]]?.shape.mean_expected?.toFixed(2) ?? '?') + ')', a => a.shape.mean_sentences?.toFixed(2));
  line('output sentence count equals the expected', a => fmt(a.shape.count_equals_expected));
  line('output sentence count at least the expected', a => fmt(a.shape.at_least_expected));
  line('case decomposed (more sentences than the message)', a => fmt(a.shape.decomposed));
  line('text changed by the arm', a => fmt(a.shape.changed));
  md.push('', '## By tangle type (upper estimate): catastrophic S4 / silent meaning change / sentence count equals expected', '', `| type | n | ${arms.join(' | ')} |`, `| --- | ---: | ${arms.map(() => '---').join(' | ')} |`);
  for (const t of TANGLE_TYPES) md.push(`| ${t} | ${out.arms[arms[0]]?.by_type[t].n ?? 0} | ${arms.map(a => { const b = out.arms[a].by_type[t]; return `${pct(b.upper.catastrophic)} / ${pct(b.upper.silent_meaning_change)} / ${pct(b.shape.count_equals_expected)}`; }).join(' | ')} |`);
  md.push('', '## Severity distribution of the summary (upper)', '', `| arm | ${SEVERITIES.join(' | ')} |`, `| --- | ${SEVERITIES.map(() => '---:').join(' | ')} |`);
  for (const a of arms) md.push(`| ${a} | ${SEVERITIES.map(s => out.arms[a].distribution_upper[s]).join(' | ')} |`);
  // paired comparisons on the same cases (exact sign test on the discordant pairs; upper estimate)
  const flags = {
    'catastrophic S4': r => r.severity === 'S4',
    'silent meaning change (S3+ with no marker)': r => r.severity && rank(r.severity) >= 3 && !r.marked,
    'failure S3 or S4': r => r.severity && rank(r.severity) >= 3,
    'firm silent meaning change (both judges S3+, no marker)': r => r.severity && r.severity_lower && rank(r.severity) >= 3 && rank(r.severity_lower) >= 3 && !r.marked,
    'every output sentence certified': r => r.all_certified,
    'sentence count equals expected': r => r.sentences === r.expected,
    'case decomposed': r => r.sentences > r.input_sentences,
  };
  const comparisons = [['it2-always', 'none'], ['it2-gated', 'it2-always'], ['it2-gated', 'none'], ['it2-partial', 'it2-gated'], ['it2-partial', 'none'], ['it3-always', 'none'], ['it3-gated', 'none'], ['it3-always', 'it2-always'], ['it3-gated', 'it2-gated'], ['it3-gated', 'it3-always'], ['it3f16-gated', 'it3-gated'], ['it3f16-always', 'it3-always']].filter(([a, b]) => graded[a] && graded[b]);
  md.push('', '## Paired comparisons (A minus B on the same cases; discordant counts, exact sign test)', '', '| A vs B | measure | A | B | only A | only B | A minus B (points) | p |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  out.paired = [];
  for (const [a, b] of comparisons) for (const [label, fn] of Object.entries(flags)) {
    const r = paired(graded[a], graded[b], fn);
    out.paired.push({a: a, b: b, measure: label, ...r});
    md.push(`| ${a} vs ${b} | ${label} | ${r.a} | ${r.b} | ${r.only_a} | ${r.only_b} | ${r.diff_pp.toFixed(1)} | ${r.p < 0.001 ? '<0.001' : r.p.toFixed(3)} |`);
  }
  fs.writeFileSync(path.join(WORK, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync(path.join(WORK, 'tables.md'), md.join('\n') + '\n');
  // the failures this evaluation exists to find: S3 or S4 with no marker (silent), per arm, every case with its message, the rewrite and the summary
  const ex = ['# Silent failures (S3 or S4 of the summary, upper estimate, with no marker in the interpretation)', ''];
  for (const a of arms) {
    const silent = graded[a].filter(r => r.severity && rank(r.severity) >= 3 && !r.marked);
    ex.push(`## ${a} (${silent.length})`, '');
    for (const r of silent) ex.push(`- ${r.severity} [${r.type}] ${r.id}`, `  - message: ${JSON.stringify(r.message)}`, ...(r.changed ? [`  - text after the arm: ${JSON.stringify(r.output)}`] : []), `  - I understood: ${JSON.stringify(r.summary)}`);
    ex.push('');
  }
  fs.writeFileSync(path.join(WORK, 'silent-failures.md'), ex.join('\n') + '\n');
  console.log(md.join('\n'));
  return graded;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [cmd, ...rest] = process.argv.slice(2), o = args(rest);
  const fn = {arms, pairs, report}[cmd];
  if (!fn) { console.error('usage: arms --endpoint URL | pairs | report'); process.exit(2); }
  await fn(o);
  process.exit(0);
}
