#!/usr/bin/env node
/**
 * unified-ft evaluation (preregistration status/preregistrations/train-unified-qwen3-4b.json): the two-step chain against the unified model, CPU llama-server endpoints,
 * judged by Grok and GLM (the worse is "upper", the milder "lower"; a disagreement on S3/S4 is excusable ambiguity, reported apart).
 *
 *   node tools/eval/unified-ft/run.mjs gen    --set natural|decomp|neuro --arm chain|u2|u1 [--url URL] [--prod1-url URL] [--limit N]   raw outputs -> <WORK>/arms/<set>.<arm>.raw.jsonl
 *   node tools/eval/unified-ft/run.mjs final  --set S --arm A --rewrite-url URL [--limit N]    gated rewrite (chain), SymbolicLM certification, interpretation markers -> <set>.<arm>.final.jsonl
 *   node tools/eval/unified-ft/run.mjs pairs  --set S --stage NAME --arms a,b [--limit N]      judge folders (Grok, GLM x2 sessions) for the pairs no earlier verdict covers + run.sh
 *   node tools/eval/unified-ft/run.mjs report --set S --arms a,b [--limit N] [--out FILE]      merged metrics (JSON) and a markdown table
 *
 * Sets: natural = the 425 sentences of the 226 owner messages (translate-compare/sentences.jsonl; one model call per sentence, as the chat does); decomp = the 275 sealed
 * decomposition cases (eval/suites/decomposition/test.jsonl, whole message); neuro = a seeded sample of the sealed neuro_english pair test (eval/suites/neuro_english/proofing-test.jsonl).
 * Arms: chain = first layer (natural: Qwen3-4B Q4_K_M arm of translate-compare; decomp/neuro: LanguageProofingLLM prod1 through textToCleanEnglish) -> the gated, certified
 * SymbolicProofingLLM it3 rewrite (the chat's pipeline); u2 = unified model, two outputs (faithful, limited); u1 = unified model, limited only. The unified arms' final text is the limited English.
 * Verdicts: natural pairs use the translate-compare study prompt (SYSTEM_V2: project terms kept are not errors, a correct pronoun is not an error) and its tc_* verdicts; the English sets
 * use the default severity prompt, the local cascade of lib/severity and the decomp_eval_grade verdicts. A pair is judged once.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {splitSentences} from '../../../lib/sentence-split.mjs';
import {textToCleanEnglish} from '../../../lib/text-to-clean-english/index.mjs';
import {createSymbolicLM} from '../../../lib/symbolic-lm/index.mjs';
import {runRewritePipeline} from '../../../lib/symbolic-lm/rewrite-gate.mjs';
import {interpretResult} from '../../../lib/symbolic-lm/interpretation.mjs';
import {endpointRewriter, cachedRewriter} from '../composed/rewriters.mjs';
import {localGrade, readJsonl, writeJsonl} from '../severity-local.mjs';
import {folder} from '../severity-calibration.mjs';
import {loadVerdicts} from '../severity-judge.mjs';
import {pairId} from '../severity-apply.mjs';
import {rank} from '../../../lib/severity/scale.mjs';
import {wilson} from '../../../lib/severity/metrics.mjs';
import {markers} from '../decomposition/metrics.mjs';
import {SYSTEM_V2} from '../translate-compare/judge.mjs';
import {sentences as tcSentences, readArm} from '../translate-compare/lib.mjs';

export const WORK = path.join(ROOT, process.env.UFT_WORK ?? 'eval/reports/current/unified-ft');
const [cmd, ...rest] = process.argv[1] === new URL(import.meta.url).pathname ? process.argv.slice(2) : [];
const val = (k, d = null) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d);
const SET = val('--set'), ARM = val('--arm'), LIMIT = val('--limit') ? Number(val('--limit')) : Infinity;
const armFile = (set, arm, kind) => path.join(WORK, 'arms', `${set}.${arm}.${kind}.jsonl`);
const key = id => crypto.createHash('sha256').update('unified-ft-neuro-sample|' + id).digest('hex');
const wordCount = t => (String(t).match(/[\p{L}\p{N}']+/gu) ?? []).length;
const norm = s => String(s).replace(/\s+/g, ' ').trim();

/** Items of a set: {id, text, group, mi, words, ...}; `mi` orders the staged evaluation (message index or case index). */
export function items(set, limit = Infinity) {
  let rows;
  if (set === 'natural') rows = tcSentences().map(s => ({id: s.id, text: s.text, group: s.msg, mi: s.mi, words: s.words}));
  else if (set === 'decomp') rows = readJsonl(path.join(ROOT, 'eval/suites/decomposition/test.jsonl')).map((r, i) => ({id: r.id, text: r.message, group: r.id, mi: i, words: wordCount(r.message), type: r.type}));
  else if (set === 'neuro') rows = readJsonl(path.join(ROOT, 'eval/suites/neuro_english/proofing-test.jsonl')).filter(r => r.kind === 'repair' && r.language === 'en').sort((a, b) => (key(a.id) < key(b.id) ? -1 : 1)).slice(0, 300).map((r, i) => ({id: r.id, text: r.prompt, group: r.id, mi: i, words: wordCount(r.prompt), type: r.failure_kind}));
  else throw Error('--set natural|decomp|neuro');
  return rows.filter(r => r.mi < limit);
}
const English = set => set !== 'natural';

/** The two-output target of u2: `faithful: ...` then `limited: ...`; anything else is a format failure (the raw text is then taken as the limited text). */
export function parseUnified(raw, two) {
  const text = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!two) return {first: null, limited: text, format_ok: Boolean(text)};
  const m = /^\s*faithful:\s*([\s\S]*?)\n\s*limited:\s*([\s\S]*)$/i.exec(text);
  if (m) return {first: m[1].trim(), limited: m[2].trim(), format_ok: Boolean(m[2].trim())};
  return {first: null, limited: text.replace(/^\s*(faithful|limited):\s*/i, '').trim(), format_ok: false};
}

async function chat(url, text, {system = null, maxTokens = 400} = {}) {
  const t0 = performance.now();
  const res = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({messages: [...(system ? [{role: 'system', content: system}] : []), {role: 'user', content: text}], temperature: 0, top_k: 1, seed: 0, max_tokens: maxTokens, chat_template_kwargs: {enable_thinking: false}})});
  if (!res.ok) throw Error(`endpoint ${res.status}`);
  const j = await res.json();
  return {out: String(j.choices?.[0]?.message?.content ?? ''), ms: performance.now() - t0, tokens: j.usage?.completion_tokens ?? 0};
}

async function gen() {
  const list = items(SET, LIMIT), file = armFile(SET, ARM, 'raw');
  const done = new Map(readJsonl(file).map(r => [r.id, r]));
  if (ARM === 'chain' && SET === 'natural') {
    const arm = readArm('qwen3-4b-q4');
    writeJsonl(file, list.map(s => ({id: s.id, first: arm.get(s.id)?.out ?? '', ms_first: arm.get(s.id)?.ms ?? null, source: 'translate-compare arms/qwen3-4b-q4.jsonl (Qwen3-4B-Instruct-2507 Q4_K_M, plain translate instruction)'})));
    return console.log(JSON.stringify({arm: 'chain', set: SET, rows: list.length}));
  }
  const url = val('--url'), p1 = val('--prod1-url');
  let n = 0;
  for (const s of list) {
    if (done.has(s.id)) continue;
    const t0 = performance.now();
    let row;
    try {
      if (ARM === 'chain') { const r = await textToCleanEnglish(s.text, {backendOptions: {endpoint: p1}, partial: true}); row = {id: s.id, first: r.clean, ms_first: performance.now() - t0, source: 'LanguageProofingLLM prod1 through textToCleanEnglish (sendAll)'}; }
      else { const r = await chat(url, s.text, {maxTokens: Math.min(700, wordCount(s.text) * 6 + 80)}); row = {id: s.id, raw: r.out, ...parseUnified(r.out, ARM === 'u2'), ms_first: r.ms, tokens: r.tokens}; }
    } catch (e) { row = {id: s.id, error: String(e.message).slice(0, 120)}; }
    done.set(s.id, row);
    if (++n % 25 === 0) { writeJsonl(file, [...done.values()]); console.log(`${SET}/${ARM} ${done.size}/${list.length}`); }
  }
  writeJsonl(file, list.map(s => done.get(s.id)).filter(Boolean));
  console.log(JSON.stringify({arm: ARM, set: SET, rows: done.size, errors: [...done.values()].filter(r => r.error).length, format_failures: [...done.values()].filter(r => r.format_ok === false).length}));
}

async function final() {
  const list = items(SET, LIMIT), raw = new Map(readJsonl(armFile(SET, ARM, 'raw')).map(r => [r.id, r]));
  const rewriteUrl = val('--rewrite-url');
  if (ARM === 'chain' && !rewriteUrl) throw Error('--rewrite-url (SymbolicProofingLLM it3) is needed for the chain');
  const rewrite = rewriteUrl ? cachedRewriter(endpointRewriter(rewriteUrl), path.join(WORK, 'cache/raw-rewrite-it3.jsonl')) : async () => { throw Error('no rewrite'); };
  const lm = await createSymbolicLM({device: process.env.CHATSOP_UD_DEVICE ?? 'cpu'});
  const inspect = u => lm.inspectUnit(u);
  const out = [];
  try {
    for (const s of list) {
      const r = raw.get(s.id);
      if (!r || r.error) { out.push({id: s.id, group: s.group, mi: s.mi, text: s.text, error: r?.error ?? 'missing'}); continue; }
      let finalText, first = r.first ?? null, rewriteInfo = {sent: 0, accepted: 0};
      if (ARM === 'chain') {
        const rw = await runRewritePipeline(first, {split: splitSentences, inspect, rewrite, gate: 'trees', acceptance: 'certified'});
        finalText = rw.text; rewriteInfo = {sent: rw.units.filter(u => u.sent).length, accepted: rw.units.filter(u => u.accepted).length};
      } else finalText = r.limited;
      let interp;
      try { interp = await interpretResult(lm, await lm.analyze(finalText, {route: 'direct', language: 'auto'}), {certify: true}); }
      catch (e) { interp = {available: false, sentences: [], not_represented: []}; }
      const mk = markers(interp);
      out.push({id: s.id, group: s.group, mi: s.mi, words: s.words, type: s.type, text: s.text, first, final: finalText, format_ok: r.format_ok ?? true, ms_first: r.ms_first ?? null, rewrite: rewriteInfo,
        sentences: interp.sentences?.length ?? 0, all_certified: interp.certified === true, available: Boolean(interp.available), marked: mk.marked, marker_reasons: mk.reasons, not_represented: interp.not_represented ?? []});
      if (out.length % 25 === 0) console.log(`${SET}/${ARM} final ${out.length}/${list.length}`);
    }
  } finally { await lm.stop(); }
  writeJsonl(armFile(SET, ARM, 'final'), out);
  console.log(JSON.stringify({arm: ARM, set: SET, rows: out.length, certified: out.filter(r => r.all_certified).length, errors: out.filter(r => r.error).length}));
}

const finalRows = (set, arm, limit = Infinity) => readJsonl(armFile(set, arm, 'final')).filter(r => r.mi < limit);
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
/** Pairs of one arm: every item (original, first layer) when the arm has one, (original, final), and for natural the message pairs (originals joined, outputs joined). */
function armPairs(set, arm, limit) {
  const rows = finalRows(set, arm, limit), out = [];
  const add = (level, a, b, extra) => { if (b?.trim() && !same(a, b)) out.push({a, b, id: pairId({a, b}), level, ...extra}); };
  for (const r of rows) { if (r.error) continue; add('item', r.text, r.first); add('item', r.text, r.final); }
  if (set === 'natural') {
    const g = new Map();
    for (const r of rows) { if (r.error) continue; (g.get(r.group) ?? g.set(r.group, []).get(r.group)).push(r); }
    for (const rs of g.values()) { const a = rs.map(r => r.text).join(' '); add('message', a, rs.map(r => r.first ?? '').join(' ').trim()); add('message', a, rs.map(r => r.final).join(' ')); }
  }
  return out;
}

const judgeDirs = (prefixes, judge) => fs.readdirSync(path.join(ROOT, 'datasets_sources')).filter(n => prefixes.some(p => n.startsWith(p)) && (judge === 'grok' ? /_grok$/.test(n) : /_glm\d*$/.test(n)));
const prefixesFor = set => (English(set) ? ['decomp_eval_grade', 'uft_en_'] : ['tc_s', 'uft_nat_']);
const verdictMap = (set, judge) => new Map(judgeDirs(prefixesFor(set), judge).filter(n => fs.existsSync(path.join(ROOT, 'datasets_sources', n, 'output/verdicts.jsonl'))).flatMap(n => [...loadVerdicts(n)]));
const localFile = set => path.join(WORK, `grade/local-${set}.jsonl`);

async function pairs() {
  const arms = val('--arms').split(','), stage = val('--stage');
  const all = new Map();
  for (const arm of arms) for (const p of armPairs(SET, arm, LIMIT)) all.set(p.id, p);
  let list = [...all.values()];
  let residue = list;
  if (English(SET)) {
    const have = new Map(readJsonl(localFile(SET)).map(r => [r.id, r]));
    const todo = list.filter(p => !have.has(p.id));
    // the baseline arms of the decomposition study were graded by the same cascade: its local file is reused first
    const old = new Map(readJsonl(path.join(ROOT, 'eval/reports/current/decomposition/grade/local.jsonl')).map(r => [r.id, r]));
    const fromOld = todo.filter(p => old.has(p.id)).map(p => old.get(p.id));
    const rest = todo.filter(p => !old.has(p.id));
    const res = rest.length ? await localGrade(rest.map(p => ({id: p.id, a: p.a, b: p.b})), {device: process.env.CHATSOP_UD_DEVICE ?? 'cpu'}) : [];
    const local = [...have.values(), ...fromOld, ...res];
    writeJsonl(localFile(SET), local);
    const decided = new Set(local.filter(r => r.local.decided).map(r => r.id));
    residue = list.filter(p => !decided.has(p.id));
  }
  const g = verdictMap(SET, 'grok'), z = verdictMap(SET, 'glm');
  residue = residue.filter(p => !(g.has(p.id) && z.has(p.id)));
  const sessions = Number(val('--glm-sessions', 3));
  const system = English(SET) ? undefined : SYSTEM_V2, tag = English(SET) ? 'uft_en' : 'uft_nat';
  const rows = residue.map(p => ({id: p.id, message: p.a, candidate: p.b}));
  const made = [];
  const mk = (name, r) => { if (!r.length) return; const f = folder(name, r, system ? {system} : {}); fs.writeFileSync(path.join(f.dir, 'run.sh'), `cd ${ROOT}\nomp -p --model "${name.endsWith('grok') ? 'xai-oauth/grok-4.20-0309-non-reasoning' : 'zai/glm-5.3-flash'}" --auto-approve --no-title @datasets_sources/${name}/TASK.md "Do the task in TASK.md" </dev/null > datasets_sources/${name}/logs/omp-run.log 2>&1\n`); made.push(name); };
  mk(`${tag}_${stage}_grok`, rows);
  for (let k = 0; k < sessions; k++) mk(`${tag}_${stage}_glm${k + 1}`, rows.filter((_, i) => i % sessions === k));
  console.log(JSON.stringify({set: SET, stage, pairs: list.length, residue: residue.length, folders: made}));
}

const sevOf = (id, g, z, local) => {
  const l = local?.get(id);
  if (l?.decided) return {upper: l.severity, lower: l.severity, grok: null, glm: null, layer: l.layer};
  const a = g.get(id) ?? null, b = z.get(id) ?? null;
  const up = a && b ? (rank(a) >= rank(b) ? a : b) : a ?? b, lo = a && b ? (rank(a) <= rank(b) ? a : b) : a ?? b;
  return {upper: up, lower: lo, grok: a, glm: b, layer: 'judge'};
};
const bad = (s, w) => s && s[w] && rank(s[w]) >= 3;
const ok = (s, w) => s && s[w] && rank(s[w]) <= 2;
const share = (k, n) => ({k, n, rate: n ? k / n : null, ci: n ? wilson(k, n) : null});
const pct = s => (s.rate === null ? 'n/a' : `${s.k}/${s.n} = ${(100 * s.rate).toFixed(1)}%`);

/** Per item records of one arm with severities of the final text (and first layer) against the original; natural also gets message records (originals joined against outputs joined). */
function graded(set, arm, limit, maps) {
  const {g, z, local} = maps;
  const rows = finalRows(set, arm, limit).filter(r => !r.error);
  const sev = (a, b) => (!b?.trim() ? {upper: null, lower: null} : same(a, b) ? {upper: 'S0', lower: 'S0', layer: 'exact'} : sevOf(pairId({a, b}), g, z, local));
  const recs = rows.map(r => ({...r, sevFinal: sev(r.text, r.final), sevFirst: r.first ? sev(r.text, r.first) : null}));
  if (set === 'natural') {
    const by = new Map();
    for (const r of recs) (by.get(r.group) ?? by.set(r.group, []).get(r.group)).push(r);
    recs.messages = [...by.entries()].map(([group, rs]) => ({id: group, group, a: rs.map(r => r.text).join(' '), all_certified: rs.every(r => r.all_certified), marked: rs.some(r => r.marked), sevFinal: sev(rs.map(r => r.text).join(' '), rs.map(r => r.final).join(' ')), sevFirst: rs.every(r => r.first) ? sev(rs.map(r => r.text).join(' '), rs.map(r => r.first).join(' ')) : null}));
  }
  return recs;
}

/** Metrics over graded item records: certified, meaning kept, both, silent, S4; per level `item` (sentence or case) and, for natural, `message`. */
export function metrics(recs) {
  const j = recs.filter(r => r.sevFinal.upper);
  const m = (list, kept, certified) => ({n: list.length,
    certified: share(list.filter(certified).length, list.length),
    kept_upper: share(list.filter(r => ok(r.sev, 'upper')).length, list.length), kept_lower: share(list.filter(r => ok(r.sev, 'lower')).length, list.length),
    certified_and_kept_upper: share(list.filter(r => certified(r) && ok(r.sev, 'upper')).length, list.length), certified_and_kept_lower: share(list.filter(r => certified(r) && ok(r.sev, 'lower')).length, list.length),
    s4_upper: share(list.filter(r => r.sev.upper === 'S4').length, list.length), firm_s4: share(list.filter(r => r.sev.upper === 'S4' && r.sev.lower === 'S4').length, list.length),
    firm_s3p: share(list.filter(r => bad(r.sev, 'upper') && bad(r.sev, 'lower')).length, list.length), excusable_s3p: share(list.filter(r => bad(r.sev, 'upper') && !bad(r.sev, 'lower')).length, list.length),
    silent_upper: share(list.filter(r => bad(r.sev, 'upper') && !r.marked).length, list.length), firm_silent: share(list.filter(r => bad(r.sev, 'upper') && bad(r.sev, 'lower') && !r.marked).length, list.length),
    marked: share(list.filter(r => r.marked).length, list.length)});
  const asItem = r => ({...r, sev: r.sevFinal});
  const out = {item: m(j.map(asItem), null, r => r.all_certified)};
  if (recs.messages) out.message = m(recs.messages.filter(r => r.sevFinal.upper).map(asItem), null, r => r.all_certified);
  const f = recs.filter(r => r.sevFirst?.upper);
  if (f.length) out.first_layer = {n: f.length, kept_upper: share(f.filter(r => ok(r.sevFirst, 'upper')).length, f.length), kept_lower: share(f.filter(r => ok(r.sevFirst, 'lower')).length, f.length), s4_upper: share(f.filter(r => r.sevFirst.upper === 'S4').length, f.length)};
  out.judged = j.length; out.items = recs.length;
  out.format_failures = recs.filter(r => r.format_ok === false).length;
  const ms = recs.map(r => r.ms_first).filter(x => typeof x === 'number').sort((a, b) => a - b);
  out.ms_first_median = ms.length ? Math.round(ms[Math.floor(ms.length / 2)]) : null;
  out.judge_agreement_exact = share(j.filter(r => r.sevFinal.grok && r.sevFinal.glm && r.sevFinal.grok === r.sevFinal.glm).length, j.filter(r => r.sevFinal.grok && r.sevFinal.glm).length);
  return out;
}

/** Paired bootstrap (2000 resamples, seeded) of the difference A - B in a 0/1 flag over the items both arms have. */
export function pairedBootstrap(a, b, flag, seed = 7) {
  const bm = new Map(b.map(r => [r.id, r]));
  const xs = a.filter(r => bm.has(r.id) && r.sevFinal.upper && bm.get(r.id).sevFinal.upper).map(r => [flag(r) ? 1 : 0, flag(bm.get(r.id)) ? 1 : 0]);
  if (!xs.length) return null;
  let s = seed >>> 0; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const diffs = [];
  for (let i = 0; i < 2000; i++) { let d = 0; for (let k = 0; k < xs.length; k++) { const x = xs[Math.floor(rnd() * xs.length)]; d += x[0] - x[1]; } diffs.push(100 * d / xs.length); }
  diffs.sort((p, q) => p - q);
  const mean = 100 * xs.reduce((t, x) => t + x[0] - x[1], 0) / xs.length;
  return {n: xs.length, a: xs.reduce((t, x) => t + x[0], 0), b: xs.reduce((t, x) => t + x[1], 0), delta_pp: Number(mean.toFixed(1)), ci_pp: [Number(diffs[49].toFixed(1)), Number(diffs[1949].toFixed(1))]};
}

export const FLAGS = {
  certified_and_kept_upper: r => r.all_certified && ok(r.sevFinal, 'upper'),
  certified_and_kept_lower: r => r.all_certified && ok(r.sevFinal, 'lower'),
  kept_upper: r => ok(r.sevFinal, 'upper'),
  firm_silent: r => bad(r.sevFinal, 'upper') && bad(r.sevFinal, 'lower') && !r.marked,
  silent_upper: r => bad(r.sevFinal, 'upper') && !r.marked,
  s4_upper: r => r.sevFinal.upper === 'S4',
  firm_s4: r => r.sevFinal.upper === 'S4' && r.sevFinal.lower === 'S4',
  certified: r => r.all_certified,
};

function report() {
  const arms = val('--arms').split(',');
  const maps = {g: verdictMap(SET, 'grok'), z: verdictMap(SET, 'glm'), local: English(SET) ? new Map(readJsonl(localFile(SET)).map(r => [r.id, r.local])) : null};
  const out = {generated_at: new Date().toISOString(), set: SET, limit: Number.isFinite(LIMIT) ? LIMIT : 'all', judges: {grok: 'xai-oauth/grok-4.20-0309-non-reasoning', glm: 'zai/glm-5.3-flash'}, prompt: English(SET) ? 'severity-judge-v1 + local cascade' : 'severity-judge-v1 + study rules (SYSTEM_V2)', arms: {}, paired: {}};
  const recs = {};
  for (const arm of arms) { recs[arm] = graded(SET, arm, LIMIT, maps); out.arms[arm] = metrics(recs[arm]); }
  const base = arms.find(a => a === 'chain') ?? arms[0];
  for (const arm of arms) if (arm !== base) out.paired[`${arm} - ${base}`] = Object.fromEntries(Object.entries(FLAGS).map(([k, f]) => [k, pairedBootstrap(recs[arm], recs[base], f)]));
  const file = val('--out') ?? path.join(WORK, `report-${SET}-${Number.isFinite(LIMIT) ? LIMIT : 'all'}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  writeJsonl(path.join(WORK, `grade/${SET}-${Number.isFinite(LIMIT) ? LIMIT : 'all'}.graded.jsonl`), arms.flatMap(a => recs[a].map(r => ({arm: a, ...r}))));
  const L = ['item', ...(arms.some(a => out.arms[a].message) ? ['message'] : [])];
  const md = [];
  for (const level of L) {
    md.push(`#### ${SET}, per ${level === 'item' ? (SET === 'natural' ? 'sentence' : 'case') : 'message'}`, '', `| arm | n | certified | meaning kept (upper) | certified and kept (upper) | certified and kept (lower) | S4 (upper) | firm S4 | silent S3+ (upper) | firm silent | excusable S3+ | marked |`, '| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const a of arms) { const x = out.arms[a][level]; if (x) md.push(`| ${a} | ${x.n} | ${pct(x.certified)} | ${pct(x.kept_upper)} | ${pct(x.certified_and_kept_upper)} | ${pct(x.certified_and_kept_lower)} | ${pct(x.s4_upper)} | ${pct(x.firm_s4)} | ${pct(x.silent_upper)} | ${pct(x.firm_silent)} | ${pct(x.excusable_s3p)} | ${pct(x.marked)} |`); }
    md.push('');
  }
  md.push('Paired bootstrap, A minus B in percentage points over the items both arms were judged on (95% interval):', '', '| A - B | measure | n | A | B | delta pp | 95% interval |', '| --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const [k, v] of Object.entries(out.paired)) for (const [m, r] of Object.entries(v)) if (r) md.push(`| ${k} | ${m} | ${r.n} | ${r.a} | ${r.b} | ${r.delta_pp} | [${r.ci_pp[0]}, ${r.ci_pp[1]}] |`);
  fs.writeFileSync(file.replace(/\.json$/, '.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const fn = {gen, final, pairs, report}[cmd];
  if (!fn) { console.error('usage: gen | final | pairs | report (see the header)'); process.exit(2); }
  await fn();
  process.exit(0);
}
