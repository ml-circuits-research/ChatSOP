#!/usr/bin/env node
/** Extends the reference of eval-parse-judge-haiku-v1 with a random sample of clean sentences from the strata the first
 * Haiku screen called CORRECT or MINOR (only 34 of 505 of them had a stronger verdict). Each gets a stronger-judge
 * verdict from claude-fable-5-1 through `claude -p`, rubric v1, blind, the same rendering as the original adjudication.
 * The unbiased population estimate then weights each stratum by its size (parse-judge-report.mjs).
 *   node tools/research/parse-judge-extend.mjs [--n 45] [--seed 20260930]  -> eval/reports/current/parse-judge/extension.jsonl
 */
import fs from 'node:fs';
import {judgeRows, Ledger} from './parse-judge.mjs';
import {mulberry} from './parse-judge-report.mjs';
const OUT = 'eval/reports/current/parse-judge';
const SL = 'eval/reports/current/symbolic-layers/';
const rl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(x => x.trim()).map(JSON.parse) : []);
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
const clean = new Set(rl('eval/suites/clean-english/test.jsonl').map(r => r.source_id));
const ref = new Set(rl(`${OUT}/reference.jsonl`).map(r => r.id));
const prior = new Map(rl(SL + 'judgments.jsonl').map(j => [j.key, j.judge?.verdict ?? 'unusable']));
const parses = new Map(rl(SL + 'parses.jsonl').map(p => [p.id, p.parse]));
const pool = rl(SL + 'sentences.jsonl').filter(s => clean.has(s.id) && !s.empty && s.language === 'en' && !ref.has(s.key) && ['CORRECT', 'MINOR'].includes(prior.get(s.key)));
const rand = mulberry(Number(args.seed ?? 20260930) + 1);
const n = Number(args.n ?? 45);
const shuffle = list => { const l = [...list]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
const byStratum = {CORRECT: shuffle(pool.filter(s => prior.get(s.key) === 'CORRECT')), MINOR: shuffle(pool.filter(s => prior.get(s.key) === 'MINOR'))};
const nc = Math.round(n * byStratum.CORRECT.length / pool.length);
const picked = [...byStratum.CORRECT.slice(0, nc), ...byStratum.MINOR.slice(0, n - nc)];
const rows = picked.map(s => ({id: s.key, message: s.text, analysis: {text: s.text, words: parses.get(s.id).sentences[s.index].words}}));
const ledger = new Ledger(`${OUT}/ledger.json`, 15);
const out = await judgeRows(rows, {condition: 'a', model: 'claude-fable-5-1', thinking: 0, parallel: 4, dir: `${OUT}/cache`, ledger});
const meta = new Map(picked.map(s => [s.key, s]));
const result = out.map(r => ({id: r.id, message_id: meta.get(r.id).id, source: meta.get(r.id).source, qgroup: meta.get(r.id).qgroup, clean_en: true, message: meta.get(r.id).text,
  analysis: rows.find(x => x.id === r.id).analysis, ref: r.verdict, ref_batch: 'extension-fable-cli', ref_note: r.sentences[0].note, prior_haiku_final: prior.get(r.id), extension: true, cost_usd: r.cost_usd}));
fs.writeFileSync(`${OUT}/extension.jsonl`, result.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(result.length, result.reduce((a, r) => ({...a, [r.ref]: (a[r.ref] ?? 0) + 1}), {}), 'ledger', ledger.data.total_usd);
