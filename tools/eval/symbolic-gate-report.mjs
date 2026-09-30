/** Reports of the symbolic_english gate: numbers (symbolic-gate-report.md/json) and the forms inventory.
 * The numbers describe the state after the adoption of the Stanza accurate package (experiment
 * eval-symbolic-accurate-adopt-v1): coverage before and after, the gate over the no-gold rows with reuse of the stored
 * verdicts, what remains in neuro_english, and the API spend. Everything is a regenerable observation. */
import fs from 'node:fs';
import path from 'node:path';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {loadCache, textKey} from '../datasets/three-datasets/analysis.mjs';
import {compareAnalyses} from '../datasets/three-datasets/accurate.mjs';
import {JUDGE_DIR, loadVerdicts, isGood, GATE_MODE} from '../datasets/three-datasets/gate.mjs';
import {symbolicRows} from './symbolic-gate.mjs';

const OUT = path.join(ROOT, 'eval/reports/current/three-datasets');
const BEFORE = path.join(ROOT, 'eval/reports/current/symbolic-accurate/before');
const rowsOf = rel => readJsonlShardedSync(path.join(ROOT, rel));
const NEURO = ['datasets/neuro_english/train.jsonl', 'datasets/neuro_english/dev.jsonl', 'eval/suites/neuro_english/test.jsonl'];
const count = (rows, key) => { const out = {}; for (const r of rows) { const v = key(r) ?? 'none'; out[v] = (out[v] ?? 0) + 1; } return Object.fromEntries(Object.entries(out).sort()); };
const pct = (x, d = 1) => (x === null || x === undefined ? 'n/a' : (100 * x).toFixed(d) + '%');
const SPLITS = ['train', 'dev', 'test'];

/** Coverage (symbolic / (symbolic + neuro)) per split and source from two manifests, before or after the adoption. */
function coverageOf(sym, neu) {
  const out = {};
  for (const split of [...SPLITS, 'all']) {
    const parts = split === 'all' ? SPLITS : [split];
    const get = (m, key) => parts.reduce((a, sp) => a + (m.counts[sp]?.[key] ?? 0), 0);
    const bySource = (m, src) => parts.reduce((a, sp) => a + (m.counts[sp]?.by_source?.[src] ?? 0), 0);
    const sources = [...new Set([...Object.keys(sym.counts.train?.by_source ?? {}), ...Object.keys(sym.counts.test?.by_source ?? {}), ...Object.keys(neu.counts.train?.by_source ?? {}), ...Object.keys(neu.counts.test?.by_source ?? {})])].sort();
    out[split] = {all: {symbolic: get(sym, 'rows'), neuro: get(neu, 'rows')}, ...Object.fromEntries(sources.map(src => [src, {symbolic: bySource(sym, src), neuro: bySource(neu, src)}]))};
    for (const v of Object.values(out[split])) v.coverage = v.symbolic + v.neuro ? v.symbolic / (v.symbolic + v.neuro) : null;
  }
  return out;
}

export async function report() {
  const sym = symbolicRows();
  const neuro = NEURO.flatMap(rowsOf);
  const defaults = loadCache(path.join(OUT, 'analysis-default-v1.6'));
  const manifest = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'datasets', name, 'manifest.json'), 'utf8'));
  const before = name => JSON.parse(fs.readFileSync(path.join(BEFORE, `manifest-${name}.json`), 'utf8'));
  const out = {generated_at: new Date().toISOString(), gate_mode: GATE_MODE};
  const bySplit = rows => count(rows, r => r.split);
  out.final_counts = {symbolic_english: {total: sym.length, by_split: bySplit(sym), by_analysis_verified: count(sym, r => r.analysis_verified)}, neuro_english: {total: neuro.length, by_split: bySplit(neuro), by_failure_kind: count(neuro, r => r.failure_kind), by_split_failure_kind: count(neuro, r => `${r.split}/${r.failure_kind}`)}};
  out.coverage = {before: coverageOf(before('symbolic_english'), before('neuro_english')), after: coverageOf(manifest('symbolic_english'), manifest('neuro_english'))};
  // gate over the rows without a gold SOP
  const nogold = sym.filter(r => r.analysis_verified !== 'gold_sop_match');
  const neuroNoGold = neuro.filter(r => ['analysis_rejected_by_gate', 'analysis_pending_judge', 'analysis_failed_no_gold'].includes(r.analysis_verified));
  const classOf = r => compareAnalyses(defaults.get(textKey(r.message))?.analysis, r.analysis)?.row ?? 'none';
  out.gate = {mode: GATE_MODE, rows_reached: nogold.length + neuroNoGold.length, accepted: nogold.length, accepted_by_route: count(nogold, r => r.analysis_verified), accepted_by_tree_class: count(nogold, classOf),
    neuro_by_state: count(neuroNoGold, r => r.analysis_verified), pending_judge: neuroNoGold.filter(r => r.analysis_verified === 'analysis_pending_judge').length, rejected: neuroNoGold.filter(r => r.analysis_verified === 'analysis_rejected_by_gate').length,
    failed_before_gate: neuroNoGold.filter(r => r.analysis_verified === 'analysis_failed_no_gold').length};
  const stores = {old: loadVerdicts('gate-verdicts.jsonl'), acc: loadVerdicts('gate-verdicts-accurate.jsonl')};
  const tally = map => { const c = {}; for (const [key, v] of map) { const k = `${key.split('|')[2]}:${v ?? 'unusable'}`; c[k] = (c[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(c).sort()); };
  out.verdicts = {stored_default_tree: tally(stores.old), current_tree: tally(stores.acc)};
  // agreement of the default and the current trees over the no-gold and the gold rows
  const sentencesOf = rows => { const c = {identical: 0, noncore_diff: 0, core_diff: 0, none: 0}; for (const r of rows) { const cmp = compareAnalyses(defaults.get(textKey(r.message))?.analysis, r.analysis); if (!cmp) { c.none++; continue; } for (const x of cmp.sentences) c[x]++; } return c; };
  out.agreement = {symbolic_gold: {rows: count(sym.filter(r => r.analysis_verified === 'gold_sop_match'), r => r.verification?.stanza_default_accurate), sentences: sentencesOf(sym.filter(r => r.analysis_verified === 'gold_sop_match'))},
    symbolic_no_gold: {rows: count(nogold, r => r.verification?.stanza_default_accurate), sentences: sentencesOf(nogold)}};
  // what remains in neuro_english
  const gold = neuro.filter(r => r.analysis_verified === 'gold_sop_mismatch');
  out.neuro = {rows: neuro.length, gold_verified_misses: gold.length, by_failure_kind: count(gold, r => r.failure_kind), with_verified_target: count(gold, r => (r.target ? 'yes' : 'no')), with_verified_target_by_kind: count(gold, r => `${r.failure_kind}/${r.target ? 'target' : 'no_target'}`),
    no_gold_rows: neuroNoGold.length, no_gold_by_state: count(neuroNoGold, r => r.analysis_verified), no_gold_with_target: neuroNoGold.filter(r => r.target).length, rewrite_targets: neuro.filter(r => r.rewrite_target).length, by_split_failure_kind: out.final_counts.neuro_english.by_split_failure_kind};
  const ledgerFile = path.join(JUDGE_DIR, 'ledger-accurate.json'), oldLedger = path.join(JUDGE_DIR, 'ledger.json');
  out.ledger = {accurate_gate: fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : null, previous_gate: fs.existsSync(oldLedger) ? JSON.parse(fs.readFileSync(oldLedger, 'utf8')) : null};
  fs.writeFileSync(path.join(OUT, 'symbolic-gate-report.json'), JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'symbolic-gate-report.md'), markdown(out));
  console.log(JSON.stringify({final: out.final_counts.symbolic_english.by_split, gate: out.gate, neuro: out.neuro}, null, 1));
}

function markdown(o) {
  const L = [];
  const table = (head, rows) => { L.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`); for (const r of rows) L.push(`| ${r.join(' | ')} |`); L.push(''); };
  L.push('# symbolic_english gate report (accurate package)', '', `Generated ${o.generated_at}. Experiments \`eval-symbolic-gate-v1\` and \`eval-symbolic-accurate-adopt-v1\` (\`status/preregistrations/\`). Regenerate with \`node tools/eval/symbolic-gate.mjs report\`. A regenerable observation, not documentation of progress; no number here is a human-review result.`, '');
  const f = o.final_counts;
  L.push('## Final counts', '');
  table(['dataset', 'train', 'dev', 'test', 'total'], [['symbolic_english', ...SPLITS.map(s => f.symbolic_english.by_split[s] ?? 0), f.symbolic_english.total], ['neuro_english', ...SPLITS.map(s => f.neuro_english.by_split[s] ?? 0), f.neuro_english.total]]);
  table(['analysis_verified', 'rows'], Object.entries(f.symbolic_english.by_analysis_verified));
  L.push('## Coverage before and after the adoption', '', 'Coverage = symbolic_english / (symbolic_english + neuro_english) of the clean-English rows that are not noisy, per source corpus and split.', '');
  const rows = [];
  for (const split of [...SPLITS, 'all']) for (const src of Object.keys(o.coverage.after[split])) { const b = o.coverage.before[split][src], a = o.coverage.after[split][src]; if (b || a) rows.push([split, src, `${b?.symbolic ?? 0} / ${b?.neuro ?? 0}`, pct(b?.coverage), `${a?.symbolic ?? 0} / ${a?.neuro ?? 0}`, pct(a?.coverage)]); }
  table(['split', 'source', 'before symbolic / neuro', 'before', 'after symbolic / neuro', 'after'], rows);
  const g = o.gate;
  L.push('## Gate for the rows without a gold SOP', '', `Mode \`${g.mode}\`: condition c on every sentence, condition b as well on a sentence whose tree differs from the default package's; identical sentences reuse the stored default-tree verdict. Rows that reached the gate: ${g.rows_reached}. Accepted ${g.accepted} (${JSON.stringify(g.accepted_by_route)}; tree class of the default and the current tree ${JSON.stringify(g.accepted_by_tree_class)}). Not accepted: rejected by a verdict ${g.rejected}, pending for lack of a verdict (budget) ${g.pending_judge}, failed before the gate (invalid SOP, unparsed span) ${g.failed_before_gate}.`, '');
  L.push(`Verdicts: stored default-tree ${JSON.stringify(o.verdicts.stored_default_tree)}; current-tree ${JSON.stringify(o.verdicts.current_tree)}.`, '');
  L.push('## Agreement of the default and the current trees', '');
  const ag = (name, x) => [name, ...['identical', 'noncore_diff', 'core_diff'].map(c => `${x.rows[c] ?? 0} / ${x.sentences[c] ?? 0}`)];
  table(['group', 'identical (rows / sentences)', 'noncore_diff', 'core_diff'], [ag('gold_sop_match', o.agreement.symbolic_gold), ag('no gold, accepted', o.agreement.symbolic_no_gold)]);
  const n = o.neuro;
  L.push('## What remains in neuro_english', '', `Rows ${n.rows}: gold-verified misses ${n.gold_verified_misses}, no-gold rows ${n.no_gold_rows} (${JSON.stringify(n.no_gold_by_state)}). Gold-verified misses by failure_kind ${JSON.stringify(n.by_failure_kind)}; with a verified rewrite target ${JSON.stringify(n.with_verified_target)} (by kind ${JSON.stringify(n.with_verified_target_by_kind)}); no-gold rows with a target ${n.no_gold_with_target}; rewrite targets ${n.rewrite_targets}.`, '');
  if (o.ledger?.accurate_gate) L.push('## API spend', '', `Accurate gate: ${o.ledger.accurate_gate.total_usd} USD of a ${o.ledger.accurate_gate.cap_usd} USD cap, ${o.ledger.accurate_gate.calls} calls: ${JSON.stringify(o.ledger.accurate_gate.by_label)}. Previous gate: ${o.ledger.previous_gate?.total_usd} USD.`, '');
  return L.join('\n');
}

// ------------------------------------------------------------------ forms inventory
const WH = new Set(['who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how']);
const CLAUSE_RELS = ['ccomp', 'xcomp', 'advcl', 'acl', 'acl:relcl', 'parataxis'];
/** Analysis skeleton of a sentence (compact tokens): question type, root pattern, root frame, subordinate clauses. */
export function skeleton(tokens) {
  const words = tokens.map(([id, form, lemma, upos, head, deprel]) => ({id, form, lemma, upos, head, deprel}));
  const content = words.filter(w => w.upos !== 'PUNCT');
  const root = words.find(w => w.deprel === 'root');
  if (!root) return 'no root';
  const kids = words.filter(w => w.head === root.id);
  const has = re => kids.some(k => re.test(k.deprel));
  const first = content[0]?.form.toLowerCase();
  const question = words.some(w => w.form === '?') || WH.has(first);
  const whWord = content.find(w => WH.has(w.form.toLowerCase()) && (w.id <= 3));
  const inverted = content[0] && content[0].head && (content[0].upos === 'AUX' || content[0].deprel === 'cop' || content[0].deprel.startsWith('aux')) && question;
  const kind = whWord ? `wh-question(${whWord.form.toLowerCase()})` : question ? (inverted ? 'yes-no question' : 'question') : (root.upos === 'VERB' && !has(/^(nsubj|csubj|expl)/) ? 'imperative/fragment' : 'statement');
  const copula = kids.some(k => k.deprel === 'cop');
  const rootType = copula ? `copular ${root.upos}` : root.upos;
  const frame = ['nsubj:pass', 'nsubj', 'csubj', 'expl', 'obj', 'iobj', 'obl', 'ccomp', 'xcomp', 'advcl', 'conj', 'parataxis'].filter(rel => kids.some(k => k.deprel === rel || (rel === 'obl' && k.deprel.startsWith('obl:')))).join(' ');
  const clauses = CLAUSE_RELS.map(rel => [rel, words.filter(w => w.deprel === rel).length]).filter(([, n]) => n).map(([rel, n]) => (n > 1 ? `${rel}x${n}` : rel)).join('+');
  const neg = words.some(w => w.deprel === 'advmod' && /^(not|n't|never)$/i.test(w.form)) ? ' neg' : '';
  return `${kind} | root ${rootType}${neg} | ${frame || 'no arguments'} | ${clauses ? 'subordination ' + clauses : 'single clause'}`;
}

export async function inventory() {
  const sym = symbolicRows();
  const patterns = new Map();
  let multi = 0;
  for (const r of sym) {
    const sentences = r.analysis?.sentences ?? [];
    if (!sentences.length) continue;
    if (sentences.length > 1) multi++;
    const main = sentences.slice().sort((a, b) => b.tokens.length - a.tokens.length)[0];
    const key = skeleton(main.tokens);
    const p = patterns.get(key) ?? {n: 0, rows: []};
    p.n++;
    if (p.rows.length < 40) p.rows.push(main.text.trim());
    patterns.set(key, p);
  }
  const sorted = [...patterns.entries()].sort((a, b) => b[1].n - a[1].n);
  const total = sym.filter(r => r.analysis?.sentences?.length).length;
  const kinds = count(sym.filter(r => r.analysis?.sentences?.length), r => skeleton(r.analysis.sentences.slice().sort((a, b) => b.tokens.length - a.tokens.length)[0].tokens).split(' | ')[0].replace(/\(.*\)/, ''));
  const L = ['# symbolic_english forms inventory', '', `Generated ${new Date().toISOString()} from ${sym.length} rows (${total} with a grammatical analysis; ${multi} have more than one sentence, the longest sentence is clustered). Regenerate with \`node tools/eval/symbolic-gate.mjs inventory\`. This lists what English SymbolicLM analyses correctly and is used as the regression suite; it is an inventory of forms, not a coverage claim.`, '',
    'The example is the clustered sentence. A pattern is the analysis skeleton of the sentence: `question type | root part of speech (copular when the root has a cop dependent; neg when negated) | dependents of the root (nsubj, obj, obl, ccomp ...) | subordinate clauses (ccomp, xcomp, advcl, acl, acl:relcl, parataxis)`.', '',
    `Distinct patterns: ${sorted.length}. Sentence types (rows): ${JSON.stringify(kinds)}. The top 40 patterns cover ${sorted.slice(0, 40).reduce((s, [, p]) => s + p.n, 0)} of ${total} rows.`, '',
    '| # | rows | share | pattern | example |', '| --- | --- | --- | --- | --- |'];
  sorted.slice(0, 40).forEach(([key, p], i) => {
    const example = p.rows.slice().sort((a, b) => a.length - b.length)[Math.floor(p.rows.length / 3)].replace(/\|/g, '\\|').replace(/\s+/g, ' ');
    L.push(`| ${i + 1} | ${p.n} | ${pct(p.n / total)} | ${key.replace(/\|/g, '/')} | ${example} |`);
  });
  L.push('');
  fs.writeFileSync(path.join(OUT, 'symbolic-forms-inventory.md'), L.join('\n'));
  console.log(`wrote symbolic-forms-inventory.md: ${sorted.length} patterns over ${total} rows`);
}
