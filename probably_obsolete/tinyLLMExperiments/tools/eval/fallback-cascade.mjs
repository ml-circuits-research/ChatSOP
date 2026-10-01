#!/usr/bin/env node
/**
 * "Never NONE" fallback cascade, prototype and evaluation (DS016 "Graded severity", DS021 "Never NONE"; owner direction 2026-10-01, Task C).
 * When SymbolicLM yields no certified interpretation of a message, try in order, stopping at the first accepted candidate:
 *   s1 SymbolicProofingLLM greedy rewrite (every sentence unit sent, outputs joined);
 *   s2 k sampled SymbolicProofingLLM rewrites (temperature 0.7), first accepted wins;
 *   s3 LanguageProofingLLM greedy rewrite as an alternative paraphraser;
 *   s4 symbolic simplifications (tools/eval/severity/simplify.mjs: drop lead-ins and tags, split a coordinated question, keep the certified sentences);
 *   s5 a clarification question to the user (not an interpretation: reported as CLARIFY, never as a rescue).
 * A candidate is accepted when SymbolicLM handles it without doubt (valid converted SOP, no unparsed span, not uncertain) AND the local severity layers find
 * nothing catastrophic (mechanical certain S4, analysis-comparison S4 flags: names, numbers, polarity, roles, quantifiers, conditions; tools/eval/severity/).
 *
 *   node tools/eval/fallback-cascade.mjs select [--n 300] [--seed 7]        # sealed neuro_english rows with gold SOP and no certified interpretation
 *   node tools/eval/fallback-cascade.mjs servers start|stop                 # own llama-servers on ports 18410 (SymbolicProofingLLM it2) and 18411 (LanguageProofingLLM it2), CPU
 *   node tools/eval/fallback-cascade.mjs run [--k 3] [--jobs 4]             # the cascade on the selected rows (cached generations and parses)
 *   node tools/eval/fallback-cascade.mjs report                             # per-step NONE drop, severity of rescued interpretations (vs gold SOP), examples
 * No training; llama-server on CPU only; only the processes this tool started are ever stopped.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {openLm, handled} from './composed/lm.mjs';
import {SEV_DIR} from './severity-calibration.mjs';
import {localGrade, readJsonl, writeJsonl} from './severity-local.mjs';
import {mechanicalSeverity} from './severity/mechanical.mjs';
import {severityFromComparison} from './severity/analysis-map.mjs';
import {compareAnalyses} from '../../lib/languages-util/analysis-compare.mjs';
import {sopSeverity} from './severity/sop-compare.mjs';
import {simplifications} from './severity/simplify.mjs';
import {distributionStats, fmt, wilson} from './severity/metrics.mjs';
import {SEVERITIES, rank, isGoodEnough} from './severity/scale.mjs';

export const DIR = path.join(SEV_DIR, 'fallback');
const ROWS = path.join(DIR, 'rows.jsonl'), RESULTS = path.join(DIR, 'results.jsonl'), GEN = path.join(DIR, 'gen-cache.jsonl'), PIDS = path.join(DIR, 'servers.json');
const LLAMA = '/home/salboaie/llama-cpp-venv/llama.cpp/build/bin/llama-server';
const SERVERS = {sp: {port: 18410, model: 'models/gemma/symbolic-proofing-gemma270m-it2/proofreader/gguf/ep3-q8_0.gguf'}, lp: {port: 18411, model: 'models/gemma/language-proofing-gemma270m-it2/proofreader/gguf/ep3-q8_0.gguf'}};
const args = (() => { const o = {_: []}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; else o._.push(a[i]); } return o; })();

// ---------- generation with a persistent cache ----------
const genCache = new Map();
if (fs.existsSync(GEN)) for (const l of fs.readFileSync(GEN, 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); genCache.set(r.key, r.out); }
async function generate(model, text, {temperature = 0, seed = 0} = {}) {
  const key = `${model}|${temperature}|${seed}|${text}`;
  if (genCache.has(key)) return genCache.get(key);
  const body = {model: 'proofreader', messages: [{role: 'user', content: text}], temperature, seed, max_tokens: Math.min(1024, Math.max(96, Math.ceil(text.length / 2) + 96)), ...(temperature > 0 ? {top_k: 40, top_p: 0.95} : {top_k: 1})};
  let out = null, lastError = null;
  for (let attempt = 0; attempt < 4 && out === null; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${SERVERS[model].port}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      if (!res.ok) throw Error(`${model} server ${res.status}`);
      out = String((await res.json()).choices?.[0]?.message?.content ?? '').trim();
    } catch (error) { lastError = error; await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
  }
  if (out === null) throw lastError;
  genCache.set(key, out);
  fs.appendFileSync(GEN, JSON.stringify({key, out}) + '\n');
  return out;
}
const unitsOf = message => splitSentences(message).map(u => u.text);
const rewriteMessage = async (model, message, opts) => { const out = []; for (const u of unitsOf(message)) out.push(await generate(model, u, opts)); return out.join(' ').replace(/\s+/g, ' ').trim(); };

// ---------- servers ----------
async function servers(cmd) {
  if (cmd === 'start') {
    const pids = {};
    for (const [name, s] of Object.entries(SERVERS)) {
      const child = spawn(LLAMA, ['-m', path.join(ROOT, s.model), '-ngl', '0', '-t', '4', '-c', '8192', '-np', '4', '--host', '127.0.0.1', '--port', String(s.port)], {detached: true, stdio: ['ignore', fs.openSync(path.join(DIR, `llama-${name}.log`), 'a'), 'ignore']});
      child.unref(); pids[name] = child.pid;
    }
    fs.writeFileSync(PIDS, JSON.stringify(pids));
    for (const s of Object.values(SERVERS)) for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${s.port}/health`)).ok) break; } catch { /* wait */ } await new Promise(r => setTimeout(r, 1000)); }
    console.log('started', JSON.stringify(pids));
  } else if (cmd === 'stop') {
    const pids = JSON.parse(fs.readFileSync(PIDS, 'utf8'));
    for (const pid of Object.values(pids)) { try { process.kill(pid); } catch { /* gone */ } }
    fs.unlinkSync(PIDS); console.log('stopped');
  }
}

// ---------- row selection ----------
async function select() {
  fs.mkdirSync(DIR, {recursive: true});
  const lm = await openLm({cacheDir: path.join(DIR, 'cache')});
  const rows = readJsonlShardedSync(path.join(ROOT, 'eval/suites/neuro_english/test.jsonl')).filter(r => r.gold_sop);
  const out = [];
  let i = 0;
  for (const r of rows) {
    const res = await lm.run(r.message);
    out.push({id: r.id, message: r.message, gold_sop: r.gold_sop, none: !handled(res), outcome: res.outcome, uncertain: res.uncertain, unparsed: res.unparsed, sop: res.sop, failure_kind: r.failure_kind});
    if (++i % 200 === 0) console.log(`lm ${i}/${rows.length}`);
  }
  await lm.close();
  const none = out.filter(r => r.none);
  let seed = Number(args.seed ?? 7); const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const n = Number(args.n ?? 300);
  const pick = none.length <= n ? none : [...none].sort(() => rnd() - 0.5).slice(0, n);
  writeJsonl(ROWS, pick);
  writeJsonl(path.join(DIR, 'baseline-all.jsonl'), out);
  console.log(JSON.stringify({graded_rows: rows.length, none: none.length, selected: pick.length, certified: out.length - none.length}));
}

// ---------- acceptance ----------
async function makeAcceptor(lm) {
  return async function accept(message, text) {
    if (!text || !text.trim()) return {accepted: false, reason: 'empty'};
    const res = await lm.run(text);
    if (!handled(res)) return {accepted: false, reason: res.unparsed?.length ? 'unparsed' : res.uncertain ? 'uncertain' : 'not_converted', res};
    const m = mechanicalSeverity(message, text);
    if (m.decided && m.severity !== 'S0') return {accepted: false, reason: 'catastrophic_flag:' + m.flags.filter(f => f.certain).map(f => f.kind).join(','), res};
    // analysis layer from the SymbolicLM parses already in hand (no extra Stanza worker): trusted S4 flags reject the candidate
    const orig = await lm.run(message);
    const cmp = compareAnalyses({sentences: orig.sentences}, {sentences: res.sentences}, {textA: message, textB: text});
    const g = severityFromComparison({verdict: cmp.verdict, reasons: cmp.reasons, failedChecks: cmp.failedChecks});
    if (g.decided && g.severity === 'S4') return {accepted: false, reason: 'catastrophic_flag:' + g.flags.filter(f => f.certain).map(f => f.kind).join(','), res};
    return {accepted: true, reason: 'certified', res, local: g.severity ?? 'residue'};
  };
}
const clarification = (message, row) => {
  const span = row.unparsed?.[0] ?? unitsOf(message)[0] ?? message;
  return `I could not interpret "${String(span).slice(0, 120)}". Could you rephrase it as one short question or statement?`;
};

async function runRow(row, {lm, accept, k}) {
  const steps = [];
  const record = (step, tried, hit) => steps.push({step, tried: tried.length, accepted: hit ? {text: hit.text, label: hit.label ?? null, local: hit.local} : null});
  const finish = (step, hit) => {
    const sev = sopSeverity(hit.res.sop, row.gold_sop, {message: row.message, outcome: hit.res.outcome});
    return {id: row.id, message: row.message, steps, final: {step, text: hit.text, sop: hit.res.sop, severity: sev.severity, findings: sev.findings.slice(0, 4)}};
  };
  const tryList = async (step, cands) => {
    const tried = [];
    for (const c of cands) { tried.push(c); const a = await accept(row.message, c.text); if (a.accepted) { record(step, tried, {...c, local: a.local}); return {...c, res: a.res}; } }
    record(step, tried, null);
    return null;
  };
  // s1
  let hit = await tryList('s1_sp_greedy', [{text: await rewriteMessage('sp', row.message)}]);
  if (hit) return finish('s1_sp_greedy', hit);
  // s2
  const samples = []; const seen = new Set();
  for (let seed = 1; seed <= k; seed++) { const t = await rewriteMessage('sp', row.message, {temperature: 0.7, seed}); if (!seen.has(t)) { seen.add(t); samples.push({text: t}); } }
  hit = await tryList('s2_sp_sampled', samples);
  if (hit) return finish('s2_sp_sampled', hit);
  // s3
  hit = await tryList('s3_lp_greedy', [{text: await rewriteMessage('lp', row.message)}]);
  if (hit) return finish('s3_lp_greedy', hit);
  // s4
  const units = unitsOf(row.message);
  const cands = simplifications(row.message, units);
  const partial = [];
  for (const u of units) { const r = await lm.run(u); if (handled(r)) partial.push(u); }
  if (partial.length && partial.length < units.length) cands.push({label: 'certified_sentences_only', text: partial.join(' ')});
  hit = await tryList('s4_symbolic', cands);
  if (hit) return finish('s4_symbolic', hit);
  return {id: row.id, message: row.message, steps, final: {step: 's5_clarify', text: clarification(row.message, row), sop: null, severity: 'CLARIFY'}};
}

async function run() {
  const rows = readJsonl(ROWS), done = new Map(readJsonl(RESULTS).map(r => [r.id, r]));
  const lm = await openLm({cacheDir: path.join(DIR, 'cache')});
  const accept = await makeAcceptor(lm);
  const k = Number(args.k ?? 3), jobs = Number(args.jobs ?? 4);
  const todo = rows.filter(r => !done.has(r.id));
  let i = 0;
  const worker = async () => { while (todo.length) { const row = todo.shift(); const r = await runRow(row, {lm, accept, k}); fs.appendFileSync(RESULTS, JSON.stringify(r) + '\n'); if (++i % 20 === 0) console.log(`rows ${i}/${rows.length - done.size}`); } };
  await Promise.all(Array.from({length: jobs}, worker));
  await lm.close();
  console.log('done', i);
}

function report() {
  const rows = new Map(readJsonl(ROWS).map(r => [r.id, r]));
  const results = readJsonl(RESULTS).filter(r => rows.has(r.id));
  const n = results.length;
  const baseline = [...rows.values()].filter(r => results.some(x => x.id === r.id));
  // reference: the uncertain SOP SymbolicLM already produced, as is (not a cascade step)
  const refSev = baseline.map(r => (r.sop?.trim() ? sopSeverity(r.sop, r.gold_sop, {message: r.message, outcome: r.outcome}).severity : 'NONE'));
  const order = ['s1_sp_greedy', 's2_sp_sampled', 's3_lp_greedy', 's4_symbolic', 's5_clarify'];
  const md = ['# Never-NONE fallback cascade (neuro_english sealed test, rows with gold SOP and no certified interpretation)', '', `Rows: ${n} (sample of the ${readJsonl(path.join(DIR, 'baseline-all.jsonl')).filter(r => r.none).length} rows without a certified interpretation among ${readJsonl(path.join(DIR, 'baseline-all.jsonl')).length} neuro_english rows with gold SOP). Interpretation severity is the SOP of the accepted rewrite against the gold SOP of the original message (tools/eval/severity/sop-compare.mjs).`, ''];
  const summary = {n, steps: {}, baseline_uncertain_sop: distributionStats(refSev.filter(s => s))};
  let remaining = n;
  md.push('| step | tried (rows reaching it) | rescued | rescued of reaching | NONE left | rescued S0 | S1 | S2 | S3 | S4 | S4 share of rescued | good enough (S0-S2) of rescued |', '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const step of order) {
    const here = results.filter(r => r.final.step === step);
    const reaching = remaining;
    const sev = here.filter(r => r.final.severity && r.final.severity !== 'CLARIFY').map(r => r.final.severity);
    const d = distributionStats(sev);
    remaining -= here.length;
    summary.steps[step] = {reaching, rescued: here.length, none_left: remaining, severity: d};
    if (step === 's5_clarify') md.push(`| ${step} (clarification question, not an interpretation) | ${reaching} | ${here.length} | - | ${remaining - here.length} | - | - | - | - | - | - | - |`.replace(`${remaining - here.length}`, '0'));
    else md.push(`| ${step} | ${reaching} | ${here.length} | ${fmt(wilson(here.length, reaching))} | ${remaining} | ${d.counts.S0} | ${d.counts.S1} | ${d.counts.S2} | ${d.counts.S3} | ${d.counts.S4} | ${fmt(wilson(d.counts.S4, sev.length))} | ${fmt(wilson(d.counts.S0 + d.counts.S1 + d.counts.S2, sev.length))} |`);
  }
  const rescued = results.filter(r => r.final.severity && r.final.severity !== 'CLARIFY');
  const all = distributionStats(rescued.map(r => r.final.severity));
  summary.rescued_total = {n: rescued.length, share: wilson(rescued.length, n), severity: all};
  md.push('', `Overall: ${rescued.length} of ${n} rows rescued (${fmt(wilson(rescued.length, n))}); NONE (no certified interpretation) drops from ${n} to ${n - rescued.length}; ${n - rescued.length} rows end at the clarification question. Rescued severity: ${JSON.stringify(all.counts)}; catastrophic S4 share of rescued ${fmt(all.catastrophic)}; good enough ${fmt(all.good_enough)}.`, '');
  const rd = distributionStats(refSev);
  md.push(`Reference (not a cascade step): the uncertain SOP that SymbolicLM already produced for these rows, taken as is, graded against gold: ${JSON.stringify(rd.counts)}; good enough ${fmt(rd.good_enough)}; S4 ${fmt(rd.catastrophic)}; NONE ${fmt(rd.none)}.`, '');
  // policies built from the same rows: which combination gives the best good-enough share at a low catastrophic share
  const refById = new Map(baseline.map((r, i) => [r.id, refSev[i]]));
  const sevOf = r => (r.final.severity === 'CLARIFY' ? null : r.final.severity);
  const policies = {
    'A  uncertain SOP as is (no rewrite)': results.map(r => refById.get(r.id)),
    'B  s1 greedy rewrite, else clarification question': results.map(r => (r.final.step === 's1_sp_greedy' ? sevOf(r) : 'CLARIFY')),
    'C  s1 greedy rewrite, else the uncertain SOP as is (NONE when it has none)': results.map(r => (r.final.step === 's1_sp_greedy' ? sevOf(r) : refById.get(r.id))),
    'D  s1 greedy rewrite, else the uncertain SOP as is, else clarification question': results.map(r => (r.final.step === 's1_sp_greedy' ? sevOf(r) : refById.get(r.id) === 'NONE' ? 'CLARIFY' : refById.get(r.id))),
    'E  full cascade s1-s4 (as run), else clarification question': results.map(r => (r.final.step === 's5_clarify' ? 'CLARIFY' : sevOf(r))),
  };
  summary.policies = {};
  md.push('## Policies compared on the same rows', '', '| policy | S0 | S1 | S2 | S3 | S4 | NONE | clarification | good enough | S4 | NONE or clarification |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |');
  for (const [name, list] of Object.entries(policies)) {
    const c = Object.fromEntries([...SEVERITIES, 'CLARIFY'].map(x => [x, list.filter(y => y === x).length]));
    summary.policies[name] = c;
    md.push(`| ${name} | ${c.S0} | ${c.S1} | ${c.S2} | ${c.S3} | ${c.S4} | ${c.NONE} | ${c.CLARIFY} | ${fmt(wilson(c.S0 + c.S1 + c.S2, list.length))} | ${fmt(wilson(c.S4, list.length))} | ${fmt(wilson(c.NONE + c.CLARIFY, list.length))} |`);
  }
  md.push('');
  // examples per severity
  md.push('## Examples of rescued interpretations', '');
  for (const s of ['S0', 'S1', 'S2', 'S3', 'S4']) {
    const ex = rescued.filter(r => r.final.severity === s).slice(0, 6);
    md.push(`### ${s} (${rescued.filter(r => r.final.severity === s).length})`, '');
    for (const r of ex) md.push(`- [${r.final.step}] "${r.message.slice(0, 140)}" => "${r.final.text.slice(0, 140)}" ${r.final.findings?.length ? '(' + r.final.findings.map(f => f.kind + ':' + f.detail).join('; ').slice(0, 160) + ')' : ''}`);
    md.push('');
  }
  md.push('### Clarification questions (examples)', '');
  for (const r of results.filter(r => r.final.step === 's5_clarify').slice(0, 6)) md.push(`- "${r.message.slice(0, 140)}" -> ${r.final.text}`);
  fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  fs.writeFileSync(path.join(DIR, 'fallback.md'), md.join('\n') + '\n');
  console.log(md.slice(0, 16).join('\n'));
}

const cmd = args._[0];
if (cmd === 'select') await select(); else if (cmd === 'servers') await servers(args._[1]); else if (cmd === 'run') await run(); else if (cmd === 'report') report();
else { console.error('usage: select | servers start|stop | run | report'); process.exit(2); }
