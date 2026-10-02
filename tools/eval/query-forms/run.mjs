#!/usr/bin/env node
/**
 * Runs the query-forms dev set (experiment eval-query-forms-v1) through the product chain and scores it against the oracle gold:
 *   question -> step-by-step formalizer (questions on --tier, default the product ladder) -> Agent (admission, KnowledgeLinker, circuit rules, reference route) over world-v1.
 *   node tools/eval/query-forms/run.mjs --dev dev.jsonl --out records.jsonl [--tier tiny|small|medium|good] [--only form] [--limit N]
 * Each record keeps the SOP, the packet status, the answer, the linked relations and the layer that failed. The summary (per form: correct,
 * wrong, unknown, clarification, incomplete; Wilson 95%) is printed and written next to the records as `<out>.summary.json`.
 * The slice budget is the dev one (QF_LIMITS, default maxLookups 300000 ... retrievalMs 60000). The private chat data root is
 * QF_CHAT_ROOT (default datasets_sources/query-forms/chat_data). A different circuit author plugs in as `--formalizer module.mjs`
 * exporting `default({row})` -> SOP text; the gold is the same.
 */
import fs from 'node:fs';
import {openSession, agentClient} from '../query-forms-probe.mjs';
import {answerOfPacket} from '../kbqa/run.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const rows = fs.readFileSync(opt('--dev'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !opt('--only') || r.form === opt('--only')).slice(0, opt('--limit') ? Number(opt('--limit')) : undefined);
process.env.QF_LIMITS ??= JSON.stringify({maxLookups: 300000, maxProbes: 600000, maxFacts: 60000, retrievalMs: 60000});
const custom = opt('--formalizer') ? (await import(new URL(opt('--formalizer'), `file://${process.cwd()}/`))).default : null;
const s = openSession({base: 'world-v1', id: 'qf-run'});
const agent = agentClient({config: s.config, lexicon: s.lexicon, tier: opt('--tier', null)});

const norm = v => (typeof v === 'number' ? v : /^-?\d+$/.test(String(v)) ? Number(v) : String(v).toLowerCase());
function judge(gold, answer) {
  if (answer.kind === 'none') return 'unknown';
  if (typeof gold === 'boolean') return answer.kind === 'boolean' ? (answer.value === gold ? 'correct' : 'wrong') : 'wrong';
  if (typeof gold === 'number') return answer.kind === 'number' ? (answer.value === gold ? 'correct' : 'wrong') : answer.kind === 'values' && answer.values.length === 1 && Number(answer.values[0]) === gold ? 'correct' : 'wrong';
  const got = (answer.values ?? []).map(norm), want = gold.map(norm);
  return got.length && want.every(w => got.includes(w)) && got.every(g => want.includes(g)) ? 'correct' : 'wrong';
}
const layerOf = rec => {
  if (rec.error) return rec.error_layer ?? 'chain';
  if (rec.status === 'clarify') return /unparsed|partly/.test(rec.clarification ?? '') ? 'author' : 'linker';
  if (rec.status === 'incomplete') return 'slice';
  if (rec.status === 'budget_exhausted') return 'engine';
  return rec.verdict === 'correct' ? null : (rec.status === 'unknown' ? 'knowledge_or_link' : 'wrong_answer');
};

const records = [];
for (const row of rows) {
  const rec = {id: row.id, form: row.form, question: row.question, gold: row.gold};
  try {
    const formalizer = custom ? {id: 'custom', formalize: async () => custom({row})} : agent;
    const entry = s.store.get('qf', 'c' + row.id, 'main');
    const res = await entry.agent.turn(row.question, {formalizer});
    const p = res.packet ?? {};
    const answer = answerOfPacket(p);
    Object.assign(rec, {sop: res.sop, status: p.status, answer, linked: (p.linking ?? []).filter(l => l.kind === 'relation').map(l => `${l.surface}->${l.symbol}`), clarification: p.status === 'clarify' ? String(res.text).slice(0, 200) : null, reason: p.reason ?? null});
    rec.verdict = judge(row.gold, answer);
  } catch (error) { Object.assign(rec, {error: String(error.message).slice(0, 200), verdict: 'unknown'}); }
  rec.layer = layerOf(rec);
  records.push(rec);
}
s.close();
if (opt('--out')) fs.writeFileSync(opt('--out'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
const wilson = (k, n) => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)].map(x => Math.round(x * 1000) / 10); };
const summary = {n: records.length, forms: {}};
for (const form of [...new Set(records.map(r => r.form))]) {
  const rs = records.filter(r => r.form === form), c = v => rs.filter(r => r.verdict === v).length;
  summary.forms[form] = {n: rs.length, correct: c('correct'), wrong: c('wrong'), unknown: c('unknown'), accuracy: Math.round(1000 * c('correct') / rs.length) / 10, ci95: wilson(c('correct'), rs.length), layers: Object.fromEntries([...new Set(rs.filter(r => r.layer).map(r => r.layer))].map(l => [l, rs.filter(r => r.layer === l).length]))};
}
const total = records.filter(r => r.verdict === 'correct').length;
summary.accuracy = Math.round(1000 * total / records.length) / 10;
summary.wrong = records.filter(r => r.verdict === 'wrong').length;
if (opt('--out')) fs.writeFileSync(opt('--out').replace(/\.jsonl$/, '') + '.summary.json', JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
