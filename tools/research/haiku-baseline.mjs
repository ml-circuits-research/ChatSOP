#!/usr/bin/env node
/** Prompted Claude Haiku REFERENCE BASELINE for the formalizer task (not a preregistered arm, not fine-tuned).
 *
 * The model sees the SOP Lang rules (server/prompts/formalizer.txt plus condensed DS021 conventions and 15 few-shot
 * examples taken only from datasets_archive/formalizer-v1/train.jsonl) as the system prompt and the user's message as the
 * only user turn. No knowledge, world, gold, identifier or shortlist is ever sent. Calls go through Claude Code
 * headless (`claude -p`, no tools, empty settings, a scratch working directory); every response is cached by row id.
 *
 *   node tools/research/haiku-baseline.mjs prompt                  # write prompt.txt and prompt.json (sha256)
 *   node tools/research/haiku-baseline.mjs sample                  # write the stratified sample suites and ids
 *   node tools/research/haiku-baseline.mjs predict --suite <file> --out <predictions.jsonl> [--parallel 4]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {sampleRows} from './predict-endpoint.mjs';
import {sliceFields} from '../../eval/slices.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'eval/reports/current/haiku-baseline');
// Conditions: `thinking` (the Claude Code default, extended thinking on; cache/) and `nothink` (MAX_THINKING_TOKENS=0;
// cache-nothink/). The prompt and every other flag are identical.
const argvCondition = process.argv.indexOf('--condition');
export const CONDITION = argvCondition > 0 ? process.argv[argvCondition + 1] : 'thinking';
if (!['thinking', 'nothink'].includes(CONDITION)) throw Error('--condition must be thinking or nothink');
const cacheDir = path.join(outDir, CONDITION === 'thinking' ? 'cache' : 'cache-nothink');
export const MODEL = 'claude-haiku-4-5-20251001';
const sha256 = text => createHash('sha256').update(text).digest('hex');

/** Few-shot rows: training split only, one per question form (chosen by type/language, never from dev/test/OOD/wild). */
export const FEW_SHOT_IDS = [
  'fv1_010447_0_0', // yes/no, pronoun resolved by convention (assumed refer to), EN
  'fv1_032453_0_0', // wh through a relative clause, RO, typo
  'fv1_020353_0_0', // count, mixed
  'fv1_028649_0_0', // universal, EN
  'fv1_031945_0_0', // since when, RO
  'fv1_006816_0_0', // why, EN
  'fv1_002293_0_0', // numeric constraint, RO
  'fv1_002289_0_0', // ambiguous, EN
  'fv1_026265_0_0', // two questions, RO
  'fv1_008607_0_0', // comparison, RO
  'fv1_000706_0_0', // follow-up fragment, RO
  'fv1_032501_0_0', // reported speech, EN
  'fv1_023799_0_0', // "still" presupposition, EN
  'fv1_004321_0',   // action request: no_request
  'fv1_026787_0_0', // supposition, mixed
];

const CONVENTIONS = `Conventions (DS021 C1-C12 and the model guide):
- Relation phrase: the message's predicate words in English, lemmatized, keeping particles and prepositions ("work at", "move from", "buy from"). An agentless passive keeps the passive with the patient as subject ("be repaired"); a by-agent passive keeps the passive with the agent as role object. Modals stay inside the phrase ("must register").
- Roles: membership in or affiliation with an organization or group ("from the choir", "de la Vertex") is object; geographic origin is source; "because of X" is topic; "at/in a place" after a noun is location; means ("with a card", "by car") is instrument; what something is about is topic.
- An English message's time expression is copied as written; translations use American spelling. Romanian place and institution names stay as written ("Germania", "Primăria Craiova").
- Coordination: split coordinated subjects or objects of a distributive predicate into one proposition each; an explicitly collective predicate ("together", "co-own") keeps one conjoined value ("Ioana and Sorin").
- Pronouns: a pronoun with a single possible antecedent is replaced by that antecedent without an assumption. With two candidates, the convention is the subject of the preceding asymmetric sentence ("Ana manages Irina. Does she live in Cluj?" -> assumed relation "refer to", role subject "she", role object "Ana", basis disambiguation; the query uses "Ana"). After two parallel clauses ("Ana works at Acme and Irina works at Zeta. Does she ...?") no reading is preferable: unclear kind ambiguous.
- A word used in an unusual sense: keep the user's word in the query and add assumed relation "mean" (role subject the word as written, role object the chosen sense, basis disambiguation).
- A list presented as complete ("Room A and room B are booked. Is room C free?"): the stated facts, plus an assumed negated proposition for the asked item with basis closure, plus the query.
- Question forms: tag questions ("..., right?", "..., nu?") are yes/no queries; an offered answer after a wh-question ("Where does she work, Acme right?") is a yes/no query on the offered answer; embedded or imperative questions ("can you tell me", "list all", "spune-mi") are the underlying query; a clause complement ("did anyone confirm whether ...") queries the embedded proposition; greetings and thanks around a question are ignored. A yes/no question with variables uses mode exists; "is anyone ... not ..." is mode exists with a negated match block. "Which groups have only ..." is mode every with select.
- A definition question ("what does X mean", "ce înseamnă X") is select ?m with relation "mean", role subject the term as written, role object ?m.
- A quantified statement ("most employees are certified") is stated literally with the quantified noun phrase as the value ("most employees").
- A pure action or writing request with no checkable question (book, write, translate, remind) is unclear kind no_request; one that also asks something checkable formalizes only that question. A question about the conversation itself is no_request.
- A definite description that names one thing stays one value, translated; a question about an entity through a relative clause becomes match blocks that share a variable.
- Certainty: "I think", "probably", "cred că" -> hedged; "suppose", "să zicem", "if" -> supposed; "X says that" -> asserted + speaker "X"; "X thinks that" -> hedged + speaker "X".
- Numbers: plain integers are integers; amounts with separators, currency, units or decimals stay as written strings ("1.140 euro"). In a constraint, scale decimals and percentages to integers.
- Advice ("should I negotiate") is formalized literally: relation "should negotiate", role subject "the user".
- Well-formedness (the parser rejects anything else): every stated, assumed and match block has exactly one relation line, 1 to 4 role lines and a polarity line (assumed included). \`valid\` lines belong only to stated and assumed; a query states its time with \`at "TEXT"\` or \`during "TEXT"\` on the query itself, never inside a match block. stated and assumed never contain a ?variable.
- Wire ids: @s1, @s2 ... for stated; @a1 ... for assumed; @q, @q2 ... for queries; @c for a constraint; @u for unclear. Separate wires with a blank line.`;

const HEADER = `Output only the SOP program: no Markdown code fences, no commentary, nothing before or after it.`;

export function buildPrompt() {
  const rules = fs.readFileSync(path.join(root, 'server/prompts/formalizer.txt'), 'utf8').trim();
  const train = new Map(readJsonlShardedSync(path.join(root, 'datasets_archive/formalizer-v1/train.jsonl')).map(row => [row.id, row]));
  const examples = FEW_SHOT_IDS.map(id => {
    const row = train.get(id);
    if (!row || row.split !== 'train') throw Error(`Few-shot row ${id} is not a train row`);
    return `MESSAGE: ${row.question}\nOUTPUT:\n${row.sop_target.trim()}`;
  });
  const system = `${rules}\n\n${CONVENTIONS}\n\n${HEADER}\n\nExamples (each MESSAGE is a whole user message; OUTPUT is the complete answer):\n\n${examples.join('\n\n')}\n\nThe next user turn is the message to formalize. ${HEADER}`;
  return {system, sha256: sha256(system), few_shot_ids: FEW_SHOT_IDS};
}

function writePrompt() {
  const prompt = buildPrompt();
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, 'prompt.txt'), prompt.system + '\n');
  fs.writeFileSync(path.join(outDir, 'prompt.json'), JSON.stringify({model: MODEL, system_prompt_sha256: prompt.sha256, user_turn: 'the row message (question) alone, verbatim',
    sources: ['server/prompts/formalizer.txt (verbatim)', 'DS021 Conventions C1-C12 and Question forms (condensed)', 'docs/wire_typs/model-guide.html', 'docs/wire_typs/question-types.html'],
    few_shot_ids: prompt.few_shot_ids, few_shot_source: 'datasets_archive/formalizer-v1/train.jsonl', chars: prompt.system.length}, null, 2) + '\n');
  console.log(JSON.stringify({sha256: prompt.sha256, chars: prompt.system.length}));
}

/** Stratified sample: `count` rows allocated over strata proportionally (at least `floor` per stratum), seeded. */
function stratified(rows, stratum, allocation, seed) {
  const groups = new Map();
  for (const row of rows) { const key = stratum(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  const picked = [];
  for (const [key, count] of Object.entries(allocation)) picked.push(...sampleRows(groups.get(key) ?? [], count, seed));
  const order = new Map(rows.map((row, i) => [row.id, i]));
  return picked.sort((a, b) => order.get(a.id) - order.get(b.id));
}

function allocate(rows, stratum, total, floor = 20) {
  const counts = {};
  for (const row of rows) counts[stratum(row)] = (counts[stratum(row)] ?? 0) + 1;
  const keys = Object.keys(counts).sort();
  const out = Object.fromEntries(keys.map(key => [key, Math.min(counts[key], floor)]));
  let left = total - Object.values(out).reduce((a, b) => a + b, 0);
  const rest = keys.reduce((n, key) => n + counts[key] - out[key], 0);
  for (const key of keys) out[key] += Math.floor(left * (counts[key] - out[key]) / rest);
  left = total - Object.values(out).reduce((a, b) => a + b, 0);
  for (const key of keys.sort((a, b) => counts[b] - counts[a])) if (left > 0 && out[key] < counts[key]) { out[key]++; left--; }
  return {population: counts, allocation: out};
}

function writeSamples() {
  const lang = row => sliceFields(row).language_slice;
  const v1 = readJsonlShardedSync(path.join(root, 'eval/suites/formalizer-v1/test.jsonl'));
  const ood = readJsonlShardedSync(path.join(root, 'eval/suites/formalizer-ood-v1/test.jsonl'));
  // formalizer-v1: 375 short (<= 300 chars, the rows SmolLM2-135M was scored on) and 125 long, by language within each.
  const lenLang = row => `${row.question.length <= 300 ? 'short' : 'long'}/${lang(row)}`;
  const short = v1.filter(row => row.question.length <= 300), long = v1.filter(row => row.question.length > 300);
  const a1 = allocate(short, lenLang, 375), a2 = allocate(long, lenLang, 125, 15);
  const v1Sample = [...stratified(short, lenLang, a1.allocation, 42), ...stratified(long, lenLang, a2.allocation, 42)];
  const a3 = allocate(ood, lang, 500);
  const oodSample = stratified(ood, lang, a3.allocation, 42);
  fs.mkdirSync(path.join(outDir, 'samples'), {recursive: true});
  const write = (name, rows) => fs.writeFileSync(path.join(outDir, 'samples', name), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  write('formalizer-v1-sample.suite.jsonl', v1Sample);
  write('formalizer-ood-v1-sample.suite.jsonl', oodSample);
  const ids = {
    seed: 42, method: 'per-stratum mulberry32 sample (tools/research/predict-endpoint.mjs sampleRows), proportional allocation with a per-stratum floor',
    'formalizer-v1': {strata: 'message length (short <= 300 chars / long) x language slice', short: a1, long: a2, ids: v1Sample.map(row => row.id)},
    'formalizer-ood-v1': {strata: 'language slice', ...a3, ids: oodSample.map(row => row.id)},
    'formalizer-wild-v1': {strata: 'full suite (796 rows)'},
  };
  fs.writeFileSync(path.join(outDir, 'sample-ids.json'), JSON.stringify(ids, null, 2) + '\n');
  console.log(JSON.stringify({v1: v1Sample.length, ood: oodSample.length, a1: a1.allocation, a2: a2.allocation, a3: a3.allocation}));
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-baseline-'));
let pauseUntil = 0;

function callClaude(system, message, timeoutMs = 240000) {
  return new Promise(resolve => {
    const args = ['-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--system-prompt', system,
      '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'];
    const env = CONDITION === 'nothink' ? {...process.env, MAX_THINKING_TOKENS: '0'} : process.env;
    const child = spawn('claude', args, {cwd: scratch, env, stdio: ['pipe', 'pipe', 'pipe']});
    child.stdin.end(message);
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('close', code => { clearTimeout(timer); resolve({code, out, err}); });
  });
}

export function cleanOutput(text) {
  let sop = String(text ?? '').trim();
  const fenced = sop.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fenced) sop = fenced[1].trim();
  const start = sop.search(/^@\S+\s+(stated|assumed|unclear|query|constraint)\b/m);
  if (start > 0) sop = sop.slice(start);
  return sop;
}

async function predictRow(prompt, row) {
  const file = path.join(cacheDir, `${row.id}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cached.prompt_sha256 === prompt.sha256 && cached.ok) return cached;
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    while (Date.now() < pauseUntil) await new Promise(r => setTimeout(r, 1000));
    const started = Date.now();
    const {code, out, err} = await callClaude(prompt.system, row.question);
    let data = null;
    try { data = JSON.parse(out); } catch {}
    const text = `${out}\n${err}`;
    if (code === 0 && data && !data.is_error && typeof data.result === 'string') {
      const record = {id: row.id, ok: true, model: MODEL, condition: CONDITION, prompt_sha256: prompt.sha256, date: new Date().toISOString(), raw: data.result, sop: cleanOutput(data.result),
        ms: Date.now() - started, usage: data.usage ? {input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens, thinking_tokens: data.usage.output_tokens_details?.thinking_tokens ?? null} : null, cost_usd: data.total_cost_usd ?? null};
      fs.writeFileSync(file, JSON.stringify(record) + '\n');
      return record;
    }
    const limited = /rate.?limit|429|overloaded|529|usage limit|too many/i.test(text);
    const wait = Math.min(300000, (limited ? 30000 : 5000) * 2 ** attempt);
    if (limited) pauseUntil = Math.max(pauseUntil, Date.now() + wait);
    console.error(`${row.id}: attempt ${attempt + 1} failed (${limited ? 'rate limit' : `code ${code}`}): ${text.slice(0, 200).replace(/\s+/g, ' ')}; waiting ${wait / 1000}s`);
    await new Promise(r => setTimeout(r, wait));
  }
  return {id: row.id, ok: false, sop: '', error: 'exhausted retries'};
}

async function predict(argv) {
  const opt = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
  const rows = readJsonlShardedSync(path.resolve(opt('suite')));
  const parallel = Number(opt('parallel') ?? 4);
  const prompt = buildPrompt();
  fs.mkdirSync(cacheDir, {recursive: true});
  const results = new Array(rows.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < rows.length) {
      const index = next++;
      results[index] = await predictRow(prompt, rows[index]);
      if (++done % 50 === 0) console.error(`${done}/${rows.length}`);
    }
  }
  await Promise.all(Array.from({length: parallel}, worker));
  fs.writeFileSync(path.resolve(opt('out')), results.map(r => JSON.stringify({id: r.id, sop: r.sop})).join('\n') + '\n');
  const ok = results.filter(r => r.ok);
  console.log(JSON.stringify({rows: rows.length, ok: ok.length, failed: rows.length - ok.length, cost_usd: +ok.reduce((n, r) => n + (r.cost_usd ?? 0), 0).toFixed(3)}));
}


// ---------------------------------------------------------------- comparison with the fine-tuned models on the same rows
const SMOL = 'eval/reports/current/formalizer-size-v1/smollm2-135m';
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const exists = file => fs.existsSync(path.join(root, file));
/** Wilson 95% interval. */
export function wilson(k, n) {
  if (!n) return [null, null];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [+((c - m) / d).toFixed(4), +((c + m) / d).toFixed(4)];
}
const rate = (records, key) => { const k = records.filter(r => r[key]).length; return {k, n: records.length, value: records.length ? +(k / records.length).toFixed(4) : null, ci95: wilson(k, records.length)}; };
const mean = (records, key) => records.length ? +(records.reduce((n, r) => n + (r[key] ?? 0), 0) / records.length).toFixed(4) : null;

function flatExec(record, row) {
  const rf = record.reference_free ?? {};
  return {id: record.id, language: record.language_slice, hard: record.hard_slice === 'hard', length: row.question.length <= 300 ? 'short' : 'long',
    question_type: record.question_type, family: record.family,
    parse: Boolean(record.syntax_valid), runtime: Boolean(record.runtime_valid), canonical: Boolean(record.canonical_match),
    exec_strict: Boolean(record.execution_equivalent), exec_tolerant: Boolean(record.execution_equivalent_tolerant),
    rf_compile: Boolean(rf.compile_valid), rf_anchored: rf.stated_values ? rf.stated_values_anchored === rf.stated_values : null,
    gold_status: record.gold_status ?? null, predicted_status: record.predicted_status ?? null, error: record.error?.message ?? record.tolerant_error ?? null,
    prediction: record.prediction ?? null};
}
function flatWild(record, rf) {
  return {id: record.id, language: record.language, hard: rf?.hard_slice === 'hard', language_gap: record.language_gap,
    parse: Boolean(record.parsed), accepted_match: Boolean(record.accepted_match), accepted_match_without_assumed: Boolean(record.accepted_match_without_assumed),
    shape_match: Boolean(record.shape_match), decision_match: Boolean(record.decision_match), proposition_f1: record.proposition_f1, query_f1: record.query_f1,
    rf_compile: Boolean(rf?.reference_free?.compile_valid), rf_anchored: rf?.reference_free?.stated_values ? rf.reference_free.stated_values_anchored === rf.reference_free.stated_values : null,
    prediction: rf?.prediction ?? null};
}
function summarizeExec(records) {
  const anchored = records.filter(r => r.rf_anchored !== null);
  return {rows: records.length, parse: rate(records, 'parse'), canonical: rate(records, 'canonical'), exec_strict: rate(records, 'exec_strict'), exec_tolerant: rate(records, 'exec_tolerant'),
    rf_compile: rate(records, 'rf_compile'), rf_fully_anchored: rate(anchored, 'rf_anchored')};
}
function summarizeWild(records) {
  const anchored = records.filter(r => r.rf_anchored !== null);
  return {rows: records.length, parse: rate(records, 'parse'), accepted_match: rate(records, 'accepted_match'), accepted_match_without_assumed: rate(records, 'accepted_match_without_assumed'),
    shape_match: rate(records, 'shape_match'), decision_match: rate(records, 'decision_match'), proposition_f1: mean(records, 'proposition_f1'), query_f1: mean(records, 'query_f1'),
    rf_compile: rate(records, 'rf_compile'), rf_fully_anchored: rate(anchored, 'rf_anchored')};
}
function sliced(records, summarize) {
  const by = key => Object.fromEntries([...new Set(records.map(r => String(r[key])))].sort().map(v => [v, summarize(records.filter(r => String(r[key]) === v))]));
  return {overall: summarize(records), by_language: by('language'), by_hard: by('hard'), ...(records[0]?.length ? {by_length: by('length')} : {})};
}
function paired(a, b, key) {
  const other = new Map(b.map(r => [r.id, r]));
  const out = {both: 0, only_a: 0, only_b: 0, neither: 0};
  for (const r of a) { const o = other.get(r.id); if (!o) continue; out[r[key] && o[key] ? 'both' : r[key] ? 'only_a' : o[key] ? 'only_b' : 'neither']++; }
  return out;
}


/** Speed from the cached calls: wall-clock latency per message (CLI start to JSON result, including network and
 * Claude Code overhead), output tokens from the headless usage (they include hidden thinking tokens) and the visible
 * SOP length in approximate tokens (characters / 4, as tools/datasets/build-corpora.mjs). */
function speedOf(ids, dir) {
  const calls = ids.map(id => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')); } catch { return null; } }).filter(r => r?.ok);
  const q = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  const ms = calls.map(c => c.ms), out = calls.map(c => c.usage?.output_tokens ?? 0), thinking = calls.map(c => c.usage?.thinking_tokens ?? 0);
  const visible = calls.map(c => Math.ceil(String(c.raw ?? '').length / 4));
  const tps = calls.map(c => (c.usage?.output_tokens ?? 0) / (c.ms / 1000));
  const times = calls.map(c => Date.parse(c.date));
  const sum = values => values.reduce((a, b) => a + b, 0);
  return {calls: calls.length, latency_ms: {p50: q(ms, 0.5), p90: q(ms, 0.9), p95: q(ms, 0.95), mean: Math.round(sum(ms) / calls.length), max: Math.max(...ms)},
    output_tokens_incl_thinking: {p50: q(out, 0.5), p90: q(out, 0.9), mean: Math.round(sum(out) / calls.length)}, thinking_tokens: {p50: q(thinking, 0.5), mean: Math.round(sum(thinking) / calls.length)},
    visible_sop_tokens_approx: {p50: q(visible, 0.5), p90: q(visible, 0.9), mean: Math.round(sum(visible) / calls.length)},
    output_tokens_per_second_per_call: {p50: +q(tps, 0.5).toFixed(1)}, visible_tokens_per_second_per_call: {p50: +q(visible.map((v, i) => v / (ms[i] / 1000)), 0.5).toFixed(2)},
    sum_of_latencies_s: Math.round(sum(ms) / 1000), wall_clock_s_first_to_last: Math.round((Math.max(...times) - Math.min(...times)) / 1000 + ms[times.indexOf(Math.min(...times))] / 1000),
    cost_usd: +sum(calls.map(c => c.cost_usd ?? 0)).toFixed(2)};
}
function smallModelSpeed() {
  const out = {};
  for (const name of ['formalizer-v1-short', 'formalizer-v1-long', 'formalizer-ood-v1', 'formalizer-wild-v1']) {
    const file = `${SMOL}/${name}-q8_0.timing.json`;
    if (!exists(file)) continue;
    const t = readJson(file);
    out[name] = {rows: t.rows, parallel: t.parallel, wall_seconds: Math.round(t.wall_seconds), latency_ms: t.latency_ms, completion_tokens: t.completion_tokens,
      server_generation_tokens_per_second: t.server_generation_tokens_per_second, messages_per_second: +t.messages_per_second.toFixed(2)};
  }
  const bench = 'eval/reports/current/training/cpu-bench-base.json';
  if (exists(bench)) { const b = readJson(bench); out.llama_bench_base_weights = {source: bench, label: b.label, host: b.host?.cpu, smollm2_135m_q8_0: b.results?.['smollm2-135m']?.q8_0?.runs?.filter(r => r.test === 'tg128')}; }
  return {model: 'SmolLM2-135M fine-tuned, Q8_0 GGUF, llama.cpp llama-server on CPU (GB10 Grace), 4 parallel slots', ...out};
}

/** Files of each Haiku condition; `thinking` covers the full wild suite and 150-row subsamples of the other two. */
const CONDITIONS = {
  'haiku-thinking': {cache: 'cache', wild: 'formalizer-wild-v1', 'formalizer-v1': 'formalizer-v1-thinking-sub', 'formalizer-ood-v1': 'formalizer-ood-v1-thinking-sub'},
  'haiku-nothink': {cache: 'cache-nothink', wild: 'formalizer-wild-v1.nothink', 'formalizer-v1': 'formalizer-v1-sample.nothink', 'formalizer-ood-v1': 'formalizer-ood-v1-sample.nothink'},
};

function compare() {
  const D = 'eval/reports/current/haiku-baseline';
  const report = {format: 'chatsop-haiku-reference-baseline-v1', label: 'REFERENCE BASELINE (prompted, not fine-tuned, not a preregistered arm)', model: MODEL,
    prompt: readJson(`${D}/prompt.json`), generated: new Date().toISOString(), conditions: {}, speed: {note: 'Haiku timings are wall-clock per headless `claude -p` call: process start, network, Claude Code overhead and hidden thinking are included, so they are not directly comparable with local CPU inference of the small models. Several suites and conditions ran concurrently, so per-suite wall time is shared.', smollm2_135m: smallModelSpeed()}};
  const pct = x => x?.value === null || x?.value === undefined ? 'n/a' : `${(x.value * 100).toFixed(1)}%`;
  const wildRows = new Map(readJsonlShardedSync(path.join(root, 'eval/suites/formalizer-wild-v1/test.jsonl')).map(row => [row.id, row]));
  const wildOf = (score, rf) => { const rfById = new Map(readJson(rf).records.map(r => [r.id, r])); return readJson(score).records.map(r => flatWild(r, rfById.get(r.id))); };
  const smolWild = wildOf(`${SMOL}/formalizer-wild-v1-q8_0.wild.json`, `${SMOL}/formalizer-wild-v1-q8_0.reference-free.json`);
  const smolWildById = new Map(smolWild.map(r => [r.id, r]));
  for (const [condition, files] of Object.entries(CONDITIONS)) {
    const out = report.conditions[condition] = {suites: {}};
    const speedIds = {};
    for (const suite of ['formalizer-v1', 'formalizer-ood-v1']) {
      const evaluation = `${D}/${files[suite]}.evaluation.json`;
      if (!exists(evaluation)) { out.suites[suite] = 'not scored yet'; continue; }
      const rows = new Map(readJsonlShardedSync(path.join(root, D, 'samples', `${suite}-sample.suite.jsonl`)).map(row => [row.id, row]));
      const haiku = readJson(evaluation).records.map(r => flatExec(r, rows.get(r.id)));
      speedIds[suite] = haiku.map(r => r.id);
      const ids = new Set(haiku.map(r => r.id));
      const smolFile = suite === 'formalizer-v1' ? [`${SMOL}/formalizer-v1-q8_0/evaluation.json`, `${SMOL}/formalizer-v1-short-q8_0/evaluation.json`].find(exists) : `${SMOL}/formalizer-ood-v1-q8_0/evaluation.json`;
      const smol = readJson(smolFile).records.filter(r => ids.has(r.id)).map(r => flatExec(r, rows.get(r.id)));
      const common = new Set(smol.map(r => r.id));
      const haikuCommon = haiku.filter(r => common.has(r.id));
      for (const r of haiku) { const row = rows.get(r.id); r.message = row.question; r.gold = row.sop_target; r.accepted = row.sop_targets_accepted ?? []; }
      const smolById = new Map(smol.map(r => [r.id, r]));
      fs.writeFileSync(path.join(root, D, `${files[suite]}.rows.json`), JSON.stringify(haiku.map(r => ({...r, smollm: smolById.has(r.id) ? {prediction: smolById.get(r.id).prediction, canonical: smolById.get(r.id).canonical, exec_strict: smolById.get(r.id).exec_strict, exec_tolerant: smolById.get(r.id).exec_tolerant, error: smolById.get(r.id).error} : null})), null, 1) + '\n');
      out.suites[suite] = {rows: haiku.length, haiku: sliced(haiku, summarizeExec), common_rows_with_smollm: common.size, haiku_on_common: sliced(haikuCommon, summarizeExec),
        smollm2_135m_on_common: sliced(smol, summarizeExec), paired_exec_tolerant: paired(haikuCommon, smol, 'exec_tolerant'), smollm_source: smolFile};
    }
    const score = `${D}/${files.wild}.wild.json`, rf = `${D}/${files.wild}.reference-free.json`;
    if (exists(score) && exists(rf)) {
      const haiku = wildOf(score, rf);
      speedIds.wild = haiku.map(r => r.id);
      fs.writeFileSync(path.join(root, D, `${files.wild}.rows.json`), JSON.stringify(haiku.map(r => ({...r, message: wildRows.get(r.id).question, accepted: wildRows.get(r.id).sop_targets_accepted,
        smollm: {prediction: smolWildById.get(r.id)?.prediction, accepted_match: smolWildById.get(r.id)?.accepted_match, decision_match: smolWildById.get(r.id)?.decision_match}})), null, 1) + '\n');
      out.suites['formalizer-wild-v1'] = {rows: haiku.length, haiku: sliced(haiku, summarizeWild), smollm2_135m: sliced(smolWild, summarizeWild),
        paired_accepted_match: paired(haiku, smolWild, 'accepted_match'), paired_decision_match: paired(haiku, smolWild, 'decision_match')};
    } else out.suites['formalizer-wild-v1'] = 'not scored yet';
    report.speed[condition] = Object.fromEntries(Object.entries(speedIds).map(([suite, ids]) => [suite, speedOf(ids, path.join(outDir, files.cache))]));
    for (const [suite, data] of Object.entries(out.suites)) {
      if (typeof data === 'string') continue;
      console.log(`\n## ${condition} ${suite}`);
      const tables = data.haiku_on_common ? [['haiku', data.haiku], ['haiku (common)', data.haiku_on_common], ['smollm (common)', data.smollm2_135m_on_common]] : [['haiku', data.haiku], ['smollm', data.smollm2_135m]];
      for (const [name, t] of tables) for (const [group, values] of [['overall', {all: t.overall}], ['language', t.by_language], ['hard', t.by_hard], ['length', t.by_length ?? {}]])
        for (const [k, m] of Object.entries(values)) console.log([name, group, k, m.rows, ...Object.entries(m).filter(([key]) => key !== 'rows').map(([key, v]) => `${key}=${typeof v === 'number' ? v : pct(v)}`)].join(' | '));
      console.log(JSON.stringify(data.paired_exec_tolerant ?? data.paired_accepted_match));
    }
  }
  const gemma = ['eval/reports/current/formalizer-size-v1/gemma-3-270m', 'eval/reports/current/formalizer-size-v1/gemma3-270m'].find(exists);
  report.gemma_270m = gemma ? `predictions directory found: ${gemma} (not yet compared)` : 'no Gemma 270M predictions existed when this report was generated';
  fs.writeFileSync(path.join(root, D, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('\n' + JSON.stringify(report.speed, null, 1));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'prompt') writePrompt();
else if (command === 'sample') writeSamples();
else if (command === 'predict') await predict(rest);
else if (command === 'compare') compare();
else if (command) { console.error('usage: haiku-baseline.mjs prompt | sample | predict --suite <file> --out <file> [--parallel 4]'); process.exitCode = 2; }
fs.rmSync(scratch, {recursive: true, force: true});
