#!/usr/bin/env node
/** Experiment `eval-translate-then-formalize-v1` (status/preregistrations/eval-translate-then-formalize-v1.json):
 * a base (not fine-tuned) instruct model translates a Romanian or mixed message into English, and the fine-tuned
 * formalizer then sees only the translation. The formalizer's input stays one message (DS021); the translation is a
 * host pre-step, like spelling correction.
 *
 *   select    --out-dir D                 Row subsets: RO+mixed of formalizer-ood-v1 and formalizer-wild-v1 (all rows) and a
 *                                         400-row stratified sample of the formalizer-v1 sealed test (seed 42).
 *   stage     --suite S --n N --out rows.jsonl   Nested stratified stage sample (by language slice x base language, seed 42): the
 *                                         first N of a fixed per-stratum shuffle, so a larger stage contains every smaller one.
 *   detect    --suite S                   Accuracy of the simple language detector against the row labels.
 *   translate --suite S --url U --out translated-suite.jsonl --timing t.json [--parallel 4] [--label name]
 *                                         Writes each row with `question` replaced by the translation (`question_raw` kept).
 *   merge     --raw raw.predictions.jsonl --translated tr.predictions.jsonl --suite S --out P [--router label|detector]
 *                                         Routed rows take the translated prediction, the others keep the raw one.
 *   compare   --raw evaluation.json --translated evaluation.json --suite S --out comparison.json [--mode wild]
 *   names     --suite S --translated translated-suite.jsonl --raw raw.predictions.jsonl --pred tr.predictions.jsonl --out names.json
 *                                         Name fidelity: gold role values containing a capital letter that occur verbatim in the
 *                                         original message, looked up in the translation and in each prediction.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {sampleRows} from './predict-endpoint.mjs';
import {bootstrap, mcnemar} from './spellfix-eval.mjs';

export const PROMPTS = {
  p1: m => `Translate the following message into English. Keep proper names, numbers, dates and any text in quotation marks exactly as written. Output only the English translation, nothing else.\n\nMessage:\n${m}`,
  p2: m => `Translate this Romanian text to English. Keep names, numbers, dates and quoted text unchanged. Reply with the English text only.\n\n${m}`,
  p3: m => `${m}\n\nTranslate the text above into English. Keep proper names, numbers, dates and quoted text exactly as written. Write only the translation.`,
};
let promptId = 'p1';

const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
function args(argv) {
  const out = {_: argv[0]};
  for (let i = 1; i < argv.length; i++) {
    const name = argv[i].slice(2);
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw Error(`Bad option ${argv[i]}`);
    out[name] = argv[++i];
  }
  return out;
}
/** Language slice as the host would see it from the row label: code-switched rows are `mixed`. */
export const slice = row => (row.code_switch || row.language === 'mixed' ? 'mixed' : row.language);
export const routedByLabel = row => slice(row) !== 'en';

// Detector (tuned on the formalizer-v1 dev split only, fixed before any sealed-suite contact): Romanian evidence
// (closed-class words, +2 for a lower-case word with Romanian diacritics) >= 2 and >= half the English closed-class words. Word lists are closed-class words only.
const RO_WORDS = new Set('si și sau dar ca că ce cine unde cand când cat cât care este sunt esti ești nu da la de din pe cu în in pentru prin spre după dupa despre intre între mai foarte fost fi are au avea am ai al ale ai lui ei el ea eu tu noi voi lor meu mea mele mei tau tău ta sa să se ne va vor poate pot cum daca dacă iar acum inca încă deja aici acolo doar fara fără pana până toate toti toți fiecare niciun nicio nimeni nimic un o unei unui niste niște acest aceasta această acel acea asta ăsta ceva cineva'.split(' '));
const EN_WORDS = new Set('the a an and or but that what who where when which is are was were be been has have had do does did not no to of in on at for with from by about into after before this these those it its he she they we you i my your his her their our can could will would should may might if then than there here all every each some any'.split(' '));
export function detectRomanian(text) {
  // Diacritics count only inside lower-case words: Romanian place and person names are common in English messages.
  const words = text.match(/[\p{L}]+/gu) ?? [];
  let ro = 0, en = 0;
  for (const word of words) {
    const w = word.toLowerCase();
    if (word[0] === w[0] && /[ăâîșțşţ]/.test(w)) ro += 2;
    else if (RO_WORDS.has(w) && !EN_WORDS.has(w)) ro++;
    if (EN_WORDS.has(w) && !RO_WORDS.has(w)) en++;
  }
  return ro >= 2 && ro * 2 >= en;
}

/** Deterministic clean-up of a translator output (fixed in the preregistration). */
export function cleanTranslation(text, original) {
  let t = String(text ?? '').trim();
  t = t.replace(/^(here(?:'s| is) the english translation[^:\n]*|english translation|translation|english)\s*:\s*/i, '').trim();
  if (/^"[\s\S]*"$/.test(t) && !/^"[\s\S]*"$/.test(original.trim())) t = t.slice(1, -1).trim();
  return t || original;
}

async function translateOne(url, message) {
  const started = performance.now();
  const maxTokens = Math.min(2048, Math.ceil(message.length / 2) + 64);
  const body = {messages: [{role: 'user', content: PROMPTS[promptId](message)}], temperature: 0, top_k: 1, max_tokens: maxTokens, stream: false};
  const response = await fetch(new URL('/v1/chat/completions', url), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(300000)});
  if (!response.ok) throw Error(`Endpoint returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  const choice = data.choices?.[0];
  return {text: choice?.message?.content ?? '', finish: choice?.finish_reason, ms: performance.now() - started, usage: data.usage ?? null};
}

function quantiles(values) {
  const s = [...values].sort((a, b) => a - b), at = q => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null);
  return {count: s.length, mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null, p50: at(0.5), p95: at(0.95), max: s.at(-1) ?? null};
}

function select(outDir) {
  const ood = readJsonlShardedSync('eval/suites/formalizer-ood-v1/test.jsonl').filter(routedByLabel);
  const wild = readJsonlShardedSync('eval/suites/formalizer-wild-v1/test.jsonl').filter(routedByLabel);
  const v1 = readJsonlShardedSync('eval/suites/formalizer-v1/test.jsonl').filter(routedByLabel);
  // Stratified by language slice x base language (ro, ro code-switched, en code-switched), proportional allocation.
  const strata = new Map();
  for (const row of v1) { const key = `${slice(row)}|${row.language}`; if (!strata.has(key)) strata.set(key, []); strata.get(key).push(row); }
  const keys = [...strata.keys()].sort(), total = v1.length, want = 400;
  const alloc = keys.map(k => Math.floor(want * strata.get(k).length / total));
  for (let i = 0; alloc.reduce((a, b) => a + b, 0) < want; i++) alloc[i % keys.length]++;
  const chosen = new Set(keys.flatMap((k, i) => sampleRows(strata.get(k), alloc[i], 42).map(r => r.id)));
  const sample = v1.filter(r => chosen.has(r.id));
  writeJsonl(`${outDir}/formalizer-ood-v1.romixed.jsonl`, ood);
  writeJsonl(`${outDir}/formalizer-wild-v1.romixed.jsonl`, wild);
  writeJsonl(`${outDir}/formalizer-v1.romixed-sample400.jsonl`, sample);
  const count = rows => rows.reduce((m, r) => ({...m, [`${slice(r)}|${r.language}`]: (m[`${slice(r)}|${r.language}`] ?? 0) + 1}), {});
  const info = {ood: {rows: ood.length, strata: count(ood)}, wild: {rows: wild.length, strata: count(wild)}, v1_sample: {rows: sample.length, population: total, strata: count(sample), allocation: Object.fromEntries(keys.map((k, i) => [k, alloc[i]])), seed: 42}};
  writeJson(`${outDir}/selection.json`, info);
  console.log(JSON.stringify(info));
}

/** Deterministic mulberry32 Fisher-Yates shuffle (same generator as predict-endpoint.mjs sampleRows). */
function shuffled(list, seed) {
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function stage(a) {
  const rows = readJsonlShardedSync(a.suite), want = Number(a.n), strata = new Map();
  for (const row of rows) { const key = `${slice(row)}|${row.language}`; if (!strata.has(key)) strata.set(key, []); strata.get(key).push(row); }
  const keys = [...strata.keys()].sort(), alloc = keys.map(k => Math.floor(want * strata.get(k).length / rows.length));
  for (let i = 0; alloc.reduce((x, y) => x + y, 0) < Math.min(want, rows.length); i++) alloc[i % keys.length]++;
  const chosen = new Set(keys.flatMap((k, i) => shuffled(strata.get(k), 42).slice(0, alloc[i]).map(r => r.id)));
  writeJsonl(a.out, rows.filter(r => chosen.has(r.id)));
  console.log(JSON.stringify({suite: a.suite, rows: chosen.size, allocation: Object.fromEntries(keys.map((k, i) => [k, alloc[i]]))}));
}

function detect(suite) {
  const rows = readJsonlShardedSync(suite), out = {};
  for (const row of rows) {
    const key = slice(row), hit = detectRomanian(row.question);
    out[key] ??= {rows: 0, routed: 0};
    out[key].rows++; if (hit) out[key].routed++;
  }
  for (const v of Object.values(out)) v.share = v.routed / v.rows;
  return out;
}

async function translate(a) {
  promptId = a.prompt ?? 'p1';
  if (!PROMPTS[promptId]) throw Error(`Unknown prompt ${promptId}`);
  const rows = readJsonlShardedSync(a.suite), parallel = Number(a.parallel ?? 4), results = new Array(rows.length);
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({length: parallel}, async () => {
    while (next < rows.length) {
      const i = next++, row = rows[i];
      try { results[i] = await translateOne(a.url, row.question); }
      catch (error) { results[i] = {text: '', error: error.message, ms: null}; }
    }
  }));
  const wall = (performance.now() - started) / 1000;
  const out = rows.map((row, i) => ({...row, question: cleanTranslation(results[i].text, row.question), question_raw: row.question, translation_raw_output: results[i].text,
    translation_ms: results[i].ms, translation_finish: results[i].finish ?? null, translation_error: results[i].error ?? null}));
  writeJsonl(a.out, out);
  const ok = results.filter(r => r.ms !== null);
  const timing = {format: 'chatsop-translation-timing-v1', suite: a.suite, url: a.url, translator: a.label ?? null, rows: rows.length, parallel, wall_seconds: wall,
    prompt_id: promptId, prompt: PROMPTS[promptId]('{message}'), errors: results.filter(r => r.error).length, truncated: results.filter(r => r.finish === 'length').length,
    unchanged_after_cleanup: out.filter(r => r.question === r.question_raw).length,
    latency_ms: quantiles(ok.map(r => r.ms)), completion_tokens: quantiles(ok.map(r => r.usage?.completion_tokens).filter(Number.isFinite))};
  writeJson(a.timing, timing);
  console.log(JSON.stringify({rows: rows.length, wall_seconds: +wall.toFixed(1), errors: timing.errors, truncated: timing.truncated, p50_ms: timing.latency_ms.p50}));
}

function merge(a) {
  const translated = new Map(readJsonl(a.translated).map(r => [r.id, r]));
  const rows = new Map(readJsonlShardedSync(a.suite).map(r => [r.id, r]));
  const router = a.router ?? 'label';
  let replaced = 0;
  const merged = readJsonl(a.raw).filter(r => rows.has(r.id)).map(r => {
    const row = rows.get(r.id);
    const route = router === 'label' ? routedByLabel(row) : detectRomanian(row.question);
    if (route && translated.has(r.id)) { replaced++; return {id: r.id, sop: translated.get(r.id).sop}; }
    return {id: r.id, sop: r.sop};
  });
  writeJsonl(a.out, merged);
  console.log(JSON.stringify({rows: merged.length, replaced, router}));
}

function paired(rawRecords, trRecords, rows, value, keys, cluster) {
  const tr = new Map(trRecords.map(r => [r.id, r])), groups = {};
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const raw of rawRecords) {
    const t = tr.get(raw.id), row = byId.get(raw.id);
    if (!t || !row) continue;
    const pair = [Number(value(raw) ?? 0), Number(value(t) ?? 0)];
    for (const key of keys(row)) { const g = (groups[key] ??= new Map()), c = cluster(row); if (!g.has(c)) g.set(c, []); g.get(c).push(pair); }
  }
  const out = {};
  for (const [key, map] of Object.entries(groups).sort()) {
    const clusters = [...map.values()], pairs = clusters.flat();
    const raw = pairs.reduce((s, p) => s + p[0], 0), t = pairs.reduce((s, p) => s + p[1], 0);
    const hurt = pairs.filter(p => p[0] > p[1]).length, helped = pairs.filter(p => p[1] > p[0]).length;
    out[key] = {rows: pairs.length, clusters: clusters.length, direct: raw / pairs.length, translated: t / pairs.length, delta: (t - raw) / pairs.length, ci95: bootstrap(clusters), helped, hurt, mcnemar_p: mcnemar(hurt, helped)};
  }
  return out;
}

function compare(a) {
  const raw = JSON.parse(fs.readFileSync(a.raw, 'utf8')).records, tr = JSON.parse(fs.readFileSync(a.translated, 'utf8')).records;
  const rows = readJsonlShardedSync(a.suite), wild = a.mode === 'wild';
  const keys = row => ['all', `language:${slice(row)}`, `detector:${detectRomanian(row.question) ? 'routed' : 'missed'}`, ...(wild ? [] : [`length:${row.question.length > 300 ? 'long' : 'short'}`])];
  const bool = fn => r => { const v = fn(r); return typeof v === 'boolean' ? (v ? 1 : 0) : v; };
  const metrics = wild
    ? {accepted_match: r => r.accepted_match, decision_match: r => r.decision_match, shape_match: r => r.shape_match, proposition_f1: r => r.proposition_f1, parsed: r => r.parsed}
    : {tolerant_execution_equivalence: r => r.execution_equivalent_tolerant, canonical_match: r => r.canonical_match, parse: r => r.syntax_valid};
  const report = {format: 'chatsop-translate-comparison-v1', suite: a.suite, direct: a.raw, translated: a.translated, rows: rows.length,
    interval: 'paired cluster bootstrap by semantic_case_id (row id when absent), 10,000 resamples, seed 7; exact McNemar on rows',
    metrics: Object.fromEntries(Object.entries(metrics).map(([n, fn]) => [n, paired(raw, tr, rows, bool(fn), keys, row => row.semantic_case_id ?? row.id)]))};
  writeJson(a.out, report);
  const first = Object.values(report.metrics)[0];
  for (const [k, v] of Object.entries(first)) console.log(k.padEnd(20), String(v.rows).padStart(4), v.direct.toFixed(4), v.translated.toFixed(4), (v.delta >= 0 ? '+' : '') + v.delta.toFixed(4), v.ci95?.map(x => x.toFixed(4)).join('..'), `+${v.helped}/-${v.hurt}`, v.mcnemar_p.toFixed(4));
}

/** Gold role values that carry a capital letter and occur verbatim in the original message: the names the target keeps as written. */
function goldNames(row) {
  const targets = row.sop_targets_accepted?.length ? [row.sop_targets_accepted[0]].flat().map(t => (typeof t === 'string' ? t : t.sop ?? '')) : [row.sop_target ?? ''];
  const values = new Set();
  for (const t of targets) for (const m of String(t).matchAll(/^\s*role\s+\S+\s+("(?:[^"\\]|\\.)*")/gm)) {
    let v; try { v = JSON.parse(m[1]); } catch { continue; }
    if (/\p{Lu}/u.test(v) && row.question.includes(v)) values.add(v);
  }
  return [...values];
}
function names(a) {
  const rows = readJsonlShardedSync(a.suite), translated = new Map(readJsonl(a.translated).map(r => [r.id, r]));
  const rawPred = new Map(readJsonl(a.raw).map(r => [r.id, r.sop])), trPred = new Map(readJsonl(a.pred).map(r => [r.id, r.sop]));
  const inSop = (sop, v) => String(sop ?? '').includes(JSON.stringify(v));
  const tot = {rows_with_names: 0, names: 0, in_translation: 0, in_direct_sop: 0, in_translated_sop: 0, lost_by_translation: 0};
  const bySlice = {}, examples = [];
  for (const row of rows) {
    const list = goldNames(row), t = translated.get(row.id);
    if (!list.length || !t) continue;
    const s = (bySlice[slice(row)] ??= {names: 0, in_translation: 0, in_direct_sop: 0, in_translated_sop: 0});
    tot.rows_with_names++;
    for (const v of list) {
      const inT = t.question.includes(v), d = inSop(rawPred.get(row.id), v), p = inSop(trPred.get(row.id), v);
      tot.names++; s.names++;
      if (inT) { tot.in_translation++; s.in_translation++; } else { tot.lost_by_translation++; if (examples.length < 40) examples.push({id: row.id, name: v, message: row.question, translation: t.question}); }
      if (d) { tot.in_direct_sop++; s.in_direct_sop++; }
      if (p) { tot.in_translated_sop++; s.in_translated_sop++; }
    }
  }
  const share = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v])) ;
  const report = {format: 'chatsop-translate-names-v1', suite: a.suite, definition: 'gold role values with a capital letter occurring verbatim in the original message (first accepted target for wild)',
    totals: {...tot, translation_fidelity: tot.in_translation / tot.names, direct_sop_fidelity: tot.in_direct_sop / tot.names, translated_sop_fidelity: tot.in_translated_sop / tot.names},
    by_slice: share(bySlice), lost_examples: examples};
  writeJson(a.out, report);
  console.log(JSON.stringify(report.totals));
}

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  if (a._ === 'select') return select(a['out-dir']);
  if (a._ === 'stage') return stage(a);
  if (a._ === 'detect') return console.log(JSON.stringify(detect(a.suite)));
  if (a._ === 'translate') return translate(a);
  if (a._ === 'merge') return merge(a);
  if (a._ === 'compare') return compare(a);
  if (a._ === 'names') return names(a);
  throw Error('Usage: translate-eval.mjs select|detect|translate|merge|compare|names ...');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
