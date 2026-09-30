/** Extra commands of tools/research/stanza-accurate-eval.mjs: spaCy uncertainty signal, pairwise stronger-model judgement, speed. */
import fs from 'node:fs';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {loadFrozenRules} from './proofing-oracle.mjs';
import {OUT, stageRows, parsesFor, Worker, mulberry, wilson} from './stanza-accurate-eval.mjs';
import {SpacyWorker} from '../../lib/symbolic-lm/spacy.mjs';
import {coreDisagreement, treeShape} from '../../lib/symbolic-lm/uncertainty.mjs';
import {RUBRIC, renderFull, judgeRows, Ledger} from './parse-judge.mjs';

const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };
const pct = x => (x == null ? 'n/a' : (100 * x).toFixed(1) + '%');

/** AUROC of a numeric score for a binary label. */
function auroc(items) {
  const pos = items.filter(i => i.y), neg = items.filter(i => !i.y);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p.x > n.x ? 1 : p.x === n.x ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

// ------------------------------------------------------------------ L2: spaCy disagreement as an uncertainty signal
async function spacyCommand(o) {
  const rules = await loadFrozenRules('v1.4');
  const rows = stageRows(o.set, o.stage);
  const spacy = new SpacyWorker({threads: 4});
  const out = {set: o.set, stage: o.stage, rows: rows.length, variants: {}};
  const flagsByVariant = {};
  for (const variant of ['default', 'accurate']) {
    const parses = await parsesFor(variant, rows, rules);
    const runs = new Map(readJsonl(path.join(OUT, 'runs', `${variant}-${o.set}-${o.stage}.jsonl`)).map(r => [r.id, r]));
    const recs = [];
    for (let i = 0; i < rows.length; i++) {
      const sents = parses[i].sentences.filter(s => s.language === 'en');
      let disagree = 0, shape = 0;
      const notes = [];
      for (const s of sents) {
        const toks = await spacy.parse(s.text);
        const d = coreDisagreement(s, toks, s.start);
        if (d) { disagree++; notes.push(d); }
        if (treeShape(s).length) shape++;
      }
      recs.push({id: rows[i].id, sentences: sents.length, disagree, shape, miss: !runs.get(rows[i].id).strict, note: notes[0] ?? null});
    }
    flagsByVariant[variant] = new Map(recs.map(r => [r.id, r]));
    const n = recs.length, misses = recs.filter(r => r.miss).length;
    const summarize = (label, flag) => {
      const f = recs.filter(flag), nf = recs.filter(r => !flag(r));
      const pf = f.filter(r => r.miss).length / (f.length || 1), pn = nf.filter(r => r.miss).length / (nf.length || 1);
      return {flagged: f.length, flagged_share: f.length / n, p_miss_flagged: pf, p_miss_unflagged: pn, lift: pf / (misses / n), precision: pf, recall: f.filter(r => r.miss).length / (misses || 1), wilson_flagged: f.length ? wilson(f.filter(r => r.miss).length, f.length) : null, label};
    };
    out.variants[variant] = {rows: n, strict_miss_rate: misses / n, spacy_disagree: summarize('spaCy core disagreement', r => r.disagree > 0), tree_shape: summarize('tree-shape anomaly', r => r.shape > 0),
      either: summarize('spaCy disagreement or tree-shape', r => r.disagree > 0 || r.shape > 0), auroc_disagree_count: auroc(recs.map(r => ({x: r.disagree, y: r.miss})))};
  }
  await spacy.stop();
  // agreement between default and accurate Stanza as a signal (core arcs)
  const diff = readJsonl(path.join(OUT, `diff-${o.set}-${o.stage}.jsonl`));
  const byMsg = new Map();
  for (const d of diff) { const m = byMsg.get(d.id) ?? {any: false, core: false}; m.any ||= d.any; m.core ||= d.core; byMsg.set(d.id, m); }
  const dv = readJsonl(path.join(OUT, 'runs', `default-${o.set}-${o.stage}.jsonl`));
  const n = dv.length, misses = dv.filter(r => !r.strict).length;
  const sig = flag => { const f = dv.filter(r => flag(byMsg.get(r.id) ?? {})); const mf = f.filter(r => !r.strict).length; return {flagged: f.length, share: f.length / n, p_miss_flagged: mf / (f.length || 1), lift: mf / (f.length || 1) / (misses / n), recall: mf / (misses || 1)}; };
  out.default_vs_accurate = {any_arc_differs: sig(m => m.any), core_arcs_differ: sig(m => m.core)};
  writeJson(path.join(OUT, `spacy-signal-${o.set}-${o.stage}.json`), out);
  for (const [v, s] of Object.entries(out.variants)) console.log(v, 'miss', pct(s.strict_miss_rate), 'spaCy flagged', pct(s.spacy_disagree.flagged_share), 'P(miss|flag)', pct(s.spacy_disagree.p_miss_flagged), 'P(miss|ok)', pct(s.spacy_disagree.p_miss_unflagged), 'lift', s.spacy_disagree.lift.toFixed(2), 'recall', pct(s.spacy_disagree.recall), 'AUROC', s.auroc_disagree_count?.toFixed(3));
  console.log('default vs accurate', JSON.stringify(out.default_vs_accurate));
}

// ------------------------------------------------------------------ pairwise judgement by the stronger model
const PAIR_SYSTEM = RUBRIC.split('\nAnswer with ONE JSON object')[0].replace('You check whether an automatic dependency parse of ONE English sentence gives the right analysis', 'You compare two automatic dependency parses (PARSE A and PARSE B) of ONE English sentence and decide which gives the right analysis') + `

TASK. Compare the two parses for the same sentence. For each parse decide whether it has a structure issue (DEEP) or none (CORRECT/MINOR) under the conventions above, then answer which is right. The order of A and B is random.

Answer with ONE JSON object and nothing else, no Markdown:
{"a": "CORRECT|MINOR|DEEP", "b": "CORRECT|MINOR|DEEP", "winner": "A|B|both_ok|both_wrong", "difference": "<the arcs that differ and which reading is right, one sentence>", "error_class": "<pp_attachment|coordination|name_as_common_word|copula|question_form|relative_clause|subordinate_clause|list|typo|other|none>"}
winner is A or B only when exactly one parse is free of structure issues or one is clearly better; both_ok when both are acceptable; both_wrong when both have structure issues.`;

async function pairsCommand(o) {
  const rules = await loadFrozenRules('v1.4');
  const rows = stageRows(o.set, o.stage);
  const byId = new Map(rows.map(r => [r.id, r]));
  const diff = readJsonl(path.join(OUT, `diff-${o.set}-${o.stage}.jsonl`)).filter(d => d.any && !d.tokens_differ);
  const n = Number(o.n ?? 48);
  const rand = mulberry(20260930 + 5);
  const shuffle = l => { const a = [...l]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const core = shuffle(diff.filter(d => d.core)), other = shuffle(diff.filter(d => !d.core));
  const picked = [...core.slice(0, Math.round(n * 2 / 3)), ...other.slice(0, n - Math.round(n * 2 / 3))];
  const pa = await parsesFor('default', rows, rules), pb = await parsesFor('accurate', rows, rules);
  const idx = new Map(rows.map((r, i) => [r.id, i]));
  const items = picked.map((d, k) => {
    const i = idx.get(d.id), sa = pa[i].sentences[d.index], sb = pb[i].sentences[d.index];
    const flip = rand() < 0.5;
    const [A, B] = flip ? [sb, sa] : [sa, sb];
    return {key: `${d.id}#${d.index}`, d, flip, message: sa.text, A, B};
  });
  const ledger = new Ledger(path.join(OUT, 'ledger.json'), 8);
  const dir = path.join(OUT, 'cache-judge');
  const {cachedCall, pool, parseVerdict} = await import('./parse-judge.mjs');
  const results = await pool(items, 4, async it => {
    const message = `SENTENCE: ${it.message}\n\nPARSE A:\n${renderFull(it.A)}\n\nPARSE B:\n${renderFull(it.B)}`;
    const r = await cachedCall({dir, system: PAIR_SYSTEM, message, model: 'claude-fable-5-1', thinking: 0, ledger});
    let j = null;
    try { const raw = String(r.text).replace(/^```(?:json)?\s*|```\s*$/g, '').trim(); j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { /* unusable */ }
    const winner = j?.winner === 'A' ? (it.flip ? 'accurate' : 'default') : j?.winner === 'B' ? (it.flip ? 'default' : 'accurate') : j?.winner ?? null;
    return {key: it.key, question_type: it.d.question_type, core: it.d.core, message: it.message, winner, default_verdict: j ? (it.flip ? j.b : j.a) : null, accurate_verdict: j ? (it.flip ? j.a : j.b) : null, difference: j?.difference ?? null, error_class: j?.error_class ?? null, arcs: it.d.arcs.slice(0, 6), cost_usd: r.cost_usd ?? 0};
  });
  fs.writeFileSync(path.join(OUT, `pairs-${o.set}-${o.stage}.jsonl`), results.map(r => JSON.stringify(r)).join('\n') + '\n');
  const tally = results.reduce((a, r) => ({...a, [r.winner ?? 'unusable']: (a[r.winner ?? 'unusable'] ?? 0) + 1}), {});
  const decisive = (tally.accurate ?? 0) + (tally.default ?? 0);
  console.log(JSON.stringify({n: results.length, tally, accurate_share_of_decisive: decisive ? (tally.accurate ?? 0) / decisive : null, cost: results.reduce((s, r) => s + r.cost_usd, 0), ledger: ledger.data.total_usd}));
}

// ------------------------------------------------------------------ speed
async function speedCommand(o) {
  const rules = await loadFrozenRules('v1.4');
  const rows = stageRows('dev', 300);
  const texts = rows.map(r => rules.maskMessage(r.question));
  const results = [];
  const configs = [{device: 'cuda', label: 'GPU (GB10)', batch: 64, warm: 2, batches: 4}, {device: 'cpu', label: 'CPU 4 threads (A725 cores 0-3)', taskset: '0-3', threads: 4, batch: 10, warm: 1, batches: 4}, {device: 'cpu', label: 'CPU 4 threads (X925 cores 5-8)', taskset: '5-8', threads: 4, batch: 10, warm: 1, batches: 4}];
  for (const variant of ['default', 'accurate']) for (const c of configs) {
    if (o.only && !c.label.startsWith(o.only)) continue;
    const w = new Worker({variant, device: c.device, threads: c.threads, taskset: c.taskset});
    const t0 = performance.now();
    await w.start();
    const load = w.loadMs;
    let pos = 0;
    const meas = [];
    for (let b = 0; b < c.warm + c.batches; b++) {
      const chunk = texts.slice(pos, pos + c.batch); pos += c.batch;
      const t = performance.now();
      const {parses, ms} = await w.parseMany(chunk);
      const wall = performance.now() - t;
      const sentences = parses.reduce((s, p) => s + p.sentences.length, 0), words = parses.reduce((s, p) => s + p.sentences.reduce((x, y) => x + y.words.length, 0), 0);
      if (b >= c.warm) meas.push({sentences, words, ms, wall});
    }
    const rssKb = Number(execSync(`ps -o rss= -p ${w.child.pid}`).toString().trim() || 0);
    await w.stop();
    const S = meas.reduce((s, m) => s + m.sentences, 0), W = meas.reduce((s, m) => s + m.words, 0), M = meas.reduce((s, m) => s + m.ms, 0);
    results.push({variant, config: c.label, sentences_measured: S, ms_per_sentence: M / S, ms_per_word: M / W, sentences_per_second: 1000 * S / M, load_seconds: load / 1000, rss_mb: rssKb / 1024});
    console.log(JSON.stringify(results.at(-1)));
  }
  const file = path.join(OUT, 'speed.json');
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const merged = [...prior.filter(p => !results.some(r => r.variant === p.variant && r.config === p.config)), ...results];
  writeJson(file, merged);
}


// ------------------------------------------------------------------ direct DEEP-rate on a random sample of dev sentences (deviation D2)
async function sampleCommand(o) {
  const rules = await loadFrozenRules('v1.4');
  const rows = stageRows(o.set, o.stage);
  const pa = await parsesFor('default', rows, rules), pb = await parsesFor('accurate', rows, rules);
  const all = [];
  rows.forEach((r, i) => pa[i].sentences.forEach((sa, j) => { const sb = pb[i].sentences[j]; if (sb && sa.language === 'en') all.push({id: r.id, j, question_type: r.question_type, sa, sb}); }));
  const rand = mulberry(20260930 + 9);
  for (let i = all.length - 1; i > 0; i--) { const k = Math.floor(rand() * (i + 1)); [all[i], all[k]] = [all[k], all[i]]; }
  const picked = all.slice(0, Number(o.n ?? 110));
  const ledger = new Ledger(path.join(OUT, 'ledger.json'), 9.5);
  const dir = path.join(OUT, 'cache-judge');
  const mk = (which) => picked.map(p => ({id: `${p.id}#${p.j}`, message: p[which === 'default' ? 'sa' : 'sb'].text, analysis: {text: p.sa.text, words: p[which === 'default' ? 'sa' : 'sb'].words}}));
  const out = {};
  for (const which of ['default', 'accurate']) out[which] = await judgeRows(mk(which), {condition: 'a', model: 'claude-fable-5-1', thinking: 0, parallel: 4, dir, ledger});
  const recs = picked.map((p, i) => {
    const d = out.default[i], a = out.accurate[i];
    const structure = r => (r.sentences[0].issues ?? []).filter(x => x.type === 'structure').map(x => x.trigger);
    return {key: d.id, question_type: p.question_type, text: p.sa.text, words: p.sa.words.length, identical: !treeDiffAny(p.sa, p.sb), default: d.verdict, accurate: a.verdict, default_triggers: structure(d), accurate_triggers: structure(a), default_note: d.sentences[0].note, accurate_note: a.sentences[0].note};
  });
  fs.writeFileSync(path.join(OUT, `sample-judge-${o.set}-${o.stage}.jsonl`), recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  const isBad = v => v === 'DEEP' || v === 'FAIL';
  const n = recs.length, bd = recs.filter(r => isBad(r.default)).length, ba = recs.filter(r => isBad(r.accurate)).length;
  console.log(JSON.stringify({n, default_bad: bd, accurate_bad: ba, default_only_bad: recs.filter(r => isBad(r.default) && !isBad(r.accurate)).length, accurate_only_bad: recs.filter(r => !isBad(r.default) && isBad(r.accurate)).length, identical: recs.filter(r => r.identical).length, ledger: ledger.data.total_usd}));
}
function treeDiffAny(sa, sb) { return sa.words.some((w, i) => w.head !== sb.words[i]?.head || w.deprel !== sb.words[i]?.deprel); }

export const COMMANDS = {spacy: spacyCommand, pairs: pairsCommand, speed: speedCommand, sample: sampleCommand};

import {fileURLToPath} from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, ...rest] = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) o[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  if (!COMMANDS[command]) { console.log('usage: node tools/research/stanza-accurate-extra.mjs spacy|pairs|speed --set dev --stage full'); process.exit(0); }
  await COMMANDS[command](o);
}
