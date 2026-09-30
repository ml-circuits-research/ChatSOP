#!/usr/bin/env node
/** Experiment eval-symbolic-layers-en-v1: final Layer-1 verdicts, calibration, Layer-2 classes, Layer-3 savability,
 * blame matrix and held-out rules gain. Reads the outputs of tools/research/symbolic-layers.mjs and writes
 * eval/reports/current/symbolic-layers/{layer1-final.jsonl, layer2-items.jsonl, results.json}.
 *
 *   node tools/research/symbolic-layers-report.mjs final     # merge Haiku screen + stronger-judge verdicts (D3)
 *   node tools/research/symbolic-layers-report.mjs results   # every table of the summary as JSON
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {OUT, readJsonl, writeJsonl, writeJson, loadItems} from './symbolic-layers.mjs';
import {diffCategories, CLASS_OF} from './symbolic-layers-diff.mjs';
import {mulberry} from './ud-baseline-eval.mjs';

const CAL = path.join(OUT, 'calibration');
const OK = new Set(['CORRECT', 'MINOR']);
const BAD = new Set(['DEEP', 'FAIL']);
const RANK = {CORRECT: 0, MINOR: 1, INPUT_TYPO: 2, DEEP: 3, FAIL: 4};

export function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const pct = (k, n) => ({k, n, rate: n ? k / n : null, ci95: wilson(k, n)});
function kappa(pairs, cats) {
  const n = pairs.length; if (!n) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  let pe = 0; for (const c of cats) pe += (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
function bootKappa(pairs, cats, B = 2000) {
  const r = mulberry(7); const vals = [];
  for (let b = 0; b < B; b++) { const s = pairs.map(() => pairs[Math.floor(r() * pairs.length)]); const k = kappa(s, cats); if (k !== null && Number.isFinite(k)) vals.push(k); }
  vals.sort((a, b) => a - b); return [vals[Math.floor(0.025 * vals.length)], vals[Math.floor(0.975 * vals.length)]];
}
function pairedBoot(xs, B = 10000) {
  const r = mulberry(7); const n = xs.length; const means = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += xs[Math.floor(r() * n)]; means.push(s / n); }
  means.sort((a, b) => a - b); return [means[Math.floor(0.025 * B)], means[Math.floor(0.975 * B)]];
}
const strongerFiles = () => fs.readdirSync(CAL).filter(f => /^(fable|adjudicate-\d+\.fable)\.jsonl$/.test(f)).map(f => path.join(CAL, f));

function finalCommand() {
  const sentences = readJsonl(path.join(OUT, 'sentences.jsonl')).filter(s => !s.empty && s.language === 'en');
  const haiku = new Map(readJsonl(path.join(OUT, 'judgments.jsonl')).map(j => [j.key, j]));
  const strong = new Map(strongerFiles().flatMap(f => readJsonl(f)).map(j => [j.key, j]));
  const rows = sentences.map(s => {
    const h = haiku.get(s.key)?.judge ?? null, f = strong.get(s.key) ?? null;
    const use = f ?? h;
    return {key: s.key, id: s.id, source: f ? 'stronger' : h ? 'haiku' : 'none', verdict: use?.verdict ?? 'UNJUDGED', haiku: h?.verdict ?? 'UNUSABLE', stronger: f?.verdict ?? null,
      error_type: use?.error_type ?? null, issues: use?.issues ?? use?.wrong_arcs ?? [], triggers: use?.triggers ?? [], note: use?.note ?? null};
  });
  writeJsonl(path.join(OUT, 'layer1-final.jsonl'), rows);
  const d = rows.reduce((a, r) => ({...a, [r.verdict]: (a[r.verdict] ?? 0) + 1}), {});
  console.log('final verdicts', d, 'stronger', rows.filter(r => r.source === 'stronger').length);
}

function resultsCommand() {
  const items = loadItems();
  const byItem = new Map(items.map(it => [it.id, it]));
  const sentences = readJsonl(path.join(OUT, 'sentences.jsonl'));
  const final = readJsonl(path.join(OUT, 'layer1-final.jsonl'));
  const fin = new Map(final.map(r => [r.key, r]));
  const res = {};
  // ---------------- Layer 1
  const en = final.filter(r => r.verdict !== 'UNJUDGED');
  const dist = (rows) => { const n = rows.length; const o = {n}; for (const v of ['CORRECT', 'MINOR', 'INPUT_TYPO', 'DEEP', 'FAIL']) o[v] = pct(rows.filter(r => r.verdict === v).length, n); o.OK = pct(rows.filter(r => OK.has(r.verdict)).length, n); o.BAD = pct(rows.filter(r => BAD.has(r.verdict)).length, n); return o; };
  const sOf = new Map(sentences.map(s => [s.key, s]));
  res.layer1 = {sentences: dist(en), unjudged: final.length - en.length, romanian_sentences_skipped: sentences.filter(s => s.language !== 'en').length,
    by_source: Object.fromEntries(['test', 'ood', 'wild'].map(x => [x, dist(en.filter(r => sOf.get(r.key).source === x))])),
    by_qgroup: Object.fromEntries([...new Set(items.map(i => i.qgroup))].map(g => [g, dist(en.filter(r => sOf.get(r.key).qgroup === g))])),
    by_message_length: Object.fromEntries(['short', 'medium', 'long'].map(g => [g, dist(en.filter(r => sOf.get(r.key).length === g))])),
    by_sentence_words: Object.fromEntries([['<=8', w => w <= 8], ['9-15', w => w > 8 && w <= 15], ['>15', w => w > 15]].map(([k, f]) => [k, dist(en.filter(r => f(sOf.get(r.key).words)))])),
    segmenter_boundary_mismatch: pct(sentences.filter(s => !s.segmenter_match).length, sentences.length)};
  // message-level worst verdict
  const worst = new Map();
  for (const r of en) { const w = worst.get(r.id); if (!w || RANK[r.verdict] > RANK[w]) worst.set(r.id, r.verdict); }
  res.layer1.messages = {n: items.length, ...Object.fromEntries(['CORRECT', 'MINOR', 'INPUT_TYPO', 'DEEP', 'FAIL'].map(v => [v, pct(items.filter(it => worst.get(it.id) === v).length, items.length)]))};
  // error patterns
  const bad = en.filter(r => BAD.has(r.verdict));
  const count = (xs) => Object.entries(xs.reduce((a, x) => ({...a, [x]: (a[x] ?? 0) + 1}), {})).sort((a, b) => b[1] - a[1]);
  const relOf = s => (String(s ?? '').match(/\b(nsubj(?::pass)?|obj|iobj|obl(?::\w+)?|nmod(?::\w+)?|advcl|acl(?::relcl)?|ccomp|xcomp|conj|parataxis|root|cop|aux(?::pass)?|case|mark|advmod|amod|compound(?::prt)?|appos|dep|flat|det)\b/) ?? [])[1] ?? 'other';
  res.layer1.patterns = {triggers: count(bad.flatMap(r => [...new Set(r.triggers.length ? r.triggers : r.issues.filter(i => i.type === 'structure').map(i => i.trigger).filter(Boolean))])).slice(0, 20),
    wrong_arc_got: count(bad.flatMap(r => r.issues.filter(i => i.type === 'structure').map(i => relOf(i.got)))).slice(0, 15),
    wrong_arc_expected: count(bad.flatMap(r => r.issues.filter(i => i.type === 'structure').map(i => relOf(i.expected)))).slice(0, 15),
    error_types: count(bad.map(r => String(r.error_type ?? '').toLowerCase().replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' '))).slice(0, 25),
    input_typo_sentences: en.filter(r => r.verdict === 'INPUT_TYPO').length};
  // ---------------- calibration
  const calKeys = new Set(JSON.parse(fs.readFileSync(path.join(CAL, 'design.json'), 'utf8')).calibration.keys);
  const calStrong = fs.existsSync(path.join(CAL, 'fable.jsonl')) ? readJsonl(path.join(CAL, 'fable.jsonl')) : [];
  const pairs = calStrong.map(f => [fin.get(f.key).haiku, f.verdict]);
  const bin = v => (BAD.has(v) ? 'BAD' : 'OK');
  const bpairs = pairs.map(([a, b]) => [bin(a), bin(b)]);
  const tp = bpairs.filter(([a, b]) => a === 'BAD' && b === 'BAD').length, fp = bpairs.filter(([a, b]) => a === 'BAD' && b === 'OK').length, fn = bpairs.filter(([a, b]) => a === 'OK' && b === 'BAD').length;
  // Recall of Haiku on DEEP/FAIL in the population: stratified by Haiku verdict; weight each stratum by its population size.
  const strata = {};
  for (const [h, f] of pairs) { strata[h] ??= {n: 0, bad: 0}; strata[h].n++; if (BAD.has(f)) strata[h].bad++; }
  const pop = en.reduce((a, r) => ({...a, [r.haiku]: (a[r.haiku] ?? 0) + 1}), {});
  const estBad = Object.entries(pop).reduce((a, [h, n]) => a + (strata[h] ? n * strata[h].bad / strata[h].n : 0), 0);
  const estHaikuOkButBad = ['CORRECT', 'MINOR'].reduce((a, h) => a + (strata[h] ? pop[h] * strata[h].bad / strata[h].n : 0), 0);
  const adjudicated = final.filter(r => r.source === 'stronger' && !calKeys.has(r.key));
  res.calibration = {rubric: 'v1', n: pairs.length, exact_agreement_5: pct(pairs.filter(([a, b]) => a === b).length, pairs.length), kappa_5: kappa(pairs, Object.keys(RANK)), kappa_5_ci95: pairs.length ? bootKappa(pairs, Object.keys(RANK)) : null,
    binary_agreement: pct(bpairs.filter(([a, b]) => a === b).length, bpairs.length), kappa_binary: kappa(bpairs, ['OK', 'BAD']), kappa_binary_ci95: bpairs.length ? bootKappa(bpairs, ['OK', 'BAD']) : null,
    haiku_deep_precision_sample: pct(tp, tp + fp), haiku_deep_recall_sample: pct(tp, tp + fn),
    confusion: count(pairs.map(([a, b]) => `${a}->${b}`)), strata,
    estimated_population_bad_rate_by_calibration: en.length ? estBad / en.length : null, estimated_missed_bad_among_haiku_ok: estHaikuOkButBad,
    adjudication: {n: adjudicated.length, confusion: count(adjudicated.map(r => `${r.haiku}->${r.stronger}`)), haiku_deep_confirmed: pct(adjudicated.filter(r => r.haiku === 'DEEP' && BAD.has(r.stronger)).length, adjudicated.filter(r => r.haiku === 'DEEP').length)},
    v0_rubric: (() => { const f = path.join(OUT, 'v0-judge/judgments-rubric-v0.jsonl'); if (!fs.existsSync(f)) return null; const v0 = readJsonl(f); return {distribution: count(v0.map(j => j.judge?.verdict ?? 'UNUSABLE')), vs_final: count(v0.filter(j => fin.get(j.key)?.source === 'stronger').map(j => `${j.judge?.verdict ?? 'UNUSABLE'}->${fin.get(j.key).verdict}`))}; })()};
  // spaCy and gold consistency by final verdict
  if (fs.existsSync(path.join(OUT, 'spacy-compare.jsonl'))) {
    const sp = readJsonl(path.join(OUT, 'spacy-compare.jsonl'));
    const g = {}; for (const r of sp) { const v = fin.get(r.key)?.verdict ?? 'UNJUDGED'; g[v] ??= {n: 0, core: 0, f1: 0}; g[v].n++; g[v].core += r.core_agree ? 1 : 0; g[v].f1 += r.f1; }
    for (const v of Object.values(g)) { v.core_agree = pct(v.core, v.n); v.mean_arc_f1 = v.f1 / v.n; delete v.core; delete v.f1; }
    const okA = sp.filter(r => OK.has(fin.get(r.key)?.verdict)), badA = sp.filter(r => BAD.has(fin.get(r.key)?.verdict));
    res.spacy = {...JSON.parse(fs.readFileSync(path.join(OUT, 'spacy-summary.json'), 'utf8')), by_final_verdict: g,
      disagreement_predicts_bad: {p_bad_given_disagree: pct(badA.filter(r => !r.core_agree).length, sp.filter(r => !r.core_agree && fin.get(r.key)).length), p_bad_given_agree: pct(badA.filter(r => r.core_agree).length, sp.filter(r => r.core_agree && fin.get(r.key)).length)}};
    delete res.spacy.by_verdict;
    void okA;
  }
  if (fs.existsSync(path.join(OUT, 'gold-consistency.jsonl'))) {
    const gc = readJsonl(path.join(OUT, 'gold-consistency.jsonl'));
    const g = {}; for (const r of gc) { const v = fin.get(r.key)?.verdict ?? 'UNJUDGED'; g[v] ??= {n: 0, c: 0}; g[v].n++; g[v].c += r.consistent ? 1 : 0; }
    res.gold_consistency = {sentences: gc.length, overall: pct(gc.filter(r => r.consistent).length, gc.length), by_final_verdict: Object.fromEntries(Object.entries(g).map(([v, x]) => [v, pct(x.c, x.n)]))};
  }
  // ---------------- Layer 2 and blame
  const rules = label => new Map(readJsonl(path.join(OUT, `rules-${label}.jsonl`)).map(r => [r.id, r]));
  const v12 = rules('v1.2'), v13 = rules('v1.3');
  const overrides = fs.existsSync(path.join(OUT, 'layer2-review.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'layer2-review.json'), 'utf8')) : {};
  const status = it => worst.get(it.id) ?? 'UNJUDGED';
  const layer2 = [];
  for (const it of items) {
    for (const [label, R] of [['v1.2', v12], ['v1.3', v13]]) {
      const p = R.get(it.id);
      const cats = p.match ? [] : diffCategories(p.sop, it.row.sop_target, {executed: it.source !== 'wild'});
      // An executed miss whose propositions all match (D1-tolerant all-F1 = 1) is an evaluation artifact candidate.
      if (!p.match && it.source !== 'wild' && p.d1_all_f1 === 1) cats.push({cat: 'E_structure_equal', detail: 'D1-tolerant all-proposition F1 = 1 but tolerant execution differs'});
      const auto = ['P', 'L', 'R', 'C', 'E'].filter(k => cats.some(c => CLASS_OF[c.cat] === k));
      const ov = overrides[`${label}:${it.id}`] ?? overrides[it.id];
      const classes = ['P', 'L', 'R', 'C', 'E'].filter(k => (ov?.classes ?? auto).includes(k));
      layer2.push({id: it.id, label, source: it.source, half: it.half, qgroup: it.qgroup, length: it.length, parse: status(it), match: p.match, d1_all_f1: p.d1_all_f1, categories: cats, auto_classes: auto, classes, primary: ov?.primary ?? null, note: ov?.note ?? null});
    }
  }
  const blameOf = r => {
    if (r.match) return BAD.has(r.parse) ? 'correct_despite_parser_error' : 'correct';
    if (BAD.has(r.parse)) return 'parser';
    if (r.parse === 'INPUT_TYPO' && (r.classes.includes('P') || !r.classes.length)) return 'input_typo';
    const c = r.classes.filter(x => x !== 'P' || r.parse === 'INPUT_TYPO');
    const cls = c.length ? c : r.classes;
    if (r.primary) return {R: 'rules', C: 'convention', L: 'language', E: 'eval', P: 'input_typo'}[r.primary];
    if (!cls.length) return 'unclassified';
    if (cls.length === 1) return {R: 'rules', C: 'convention', L: 'language', E: 'eval', P: 'input_typo'}[cls[0]];
    return 'mixed:' + cls.join('+');
  };
  for (const r of layer2) r.blame = blameOf(r);
  writeJsonl(path.join(OUT, 'layer2-items.jsonl'), layer2);
  const blame = label => { const rows = layer2.filter(r => r.label === label); return {n: rows.length, ...Object.fromEntries(count(rows.map(r => r.blame)).map(([k, v]) => [k, pct(v, rows.length)]))}; };
  res.blame = {'v1.3': blame('v1.3'), 'v1.2': blame('v1.2'),
    by_source_v13: Object.fromEntries(['test', 'ood', 'wild'].map(s => [s, Object.fromEntries(count(layer2.filter(r => r.label === 'v1.3' && r.source === s).map(r => r.blame)))]))};
  // Layer-2 population: every sentence CORRECT or MINOR.
  const l2 = label => layer2.filter(r => r.label === label && OK.has(r.parse));
  const l2miss = label => l2(label).filter(r => !r.match);
  const classCount = rows => Object.fromEntries(['R', 'C', 'L', 'E', 'P'].map(c => [c, {any: rows.filter(r => r.classes.includes(c)).length, sole: rows.filter(r => r.classes.length === 1 && r.classes[0] === c).length}]));
  res.layer2 = Object.fromEntries(['v1.2', 'v1.3'].map(label => [label, {population: l2(label).length, match: pct(l2(label).filter(r => r.match).length, l2(label).length), misses: l2miss(label).length,
    classes: classCount(l2miss(label)), combos: count(l2miss(label).map(r => r.classes.join('+') || '-')), categories: count(l2miss(label).flatMap(r => [...new Set(r.categories.map(c => c.cat))])),
    by_half: Object.fromEntries(['A', 'B'].map(h => [h, {population: l2(label).filter(r => r.half === h).length, match: pct(l2(label).filter(r => r.half === h && r.match).length, l2(label).filter(r => r.half === h).length), classes: classCount(l2miss(label).filter(r => r.half === h))}]))}]));
  // ---------------- held-out gain
  const gain = (filter) => {
    const ids = items.filter(filter).map(it => it.id);
    const d = ids.map(id => v13.get(id).match - v12.get(id).match);
    return {n: ids.length, v12: pct(ids.filter(id => v12.get(id).match).length, ids.length), v13: pct(ids.filter(id => v13.get(id).match).length, ids.length), delta: d.reduce((a, b) => a + b, 0) / ids.length, ci95: pairedBoot(d),
      gained: d.filter(x => x > 0).length, lost: d.filter(x => x < 0).length};
  };
  res.heldout = {B_all: gain(it => it.half === 'B'), B_layer2: gain(it => it.half === 'B' && OK.has(status(it))), A_all_dev: gain(it => it.half === 'A'),
    B_by_source: Object.fromEntries(['test', 'ood', 'wild'].map(s => [s, gain(it => it.half === 'B' && it.source === s)]))};
  // ---------------- Layer 3
  const rc = readJsonl(path.join(OUT, 'regularization-candidates.jsonl'));
  if (rc.length) {
    const by = (key) => { const g = {}; for (const r of rc) for (const k of [].concat(key(r))) { g[k] ??= {n: 0, saved: 0, partially_saved: 0, unsaved: 0}; g[k].n++; g[k][r.status]++; } return Object.fromEntries(Object.entries(g).sort((a, b) => b[1].n - a[1].n)); };
    const attempts = rc.flatMap(r => r.attempts.map(a => ({...a, verdict: r.verdict})));
    const strat = {}; for (const a of attempts) for (const s of a.strategies.length ? a.strategies : ['none']) { strat[s] ??= {n: 0, preserved: 0, parse_ok: 0, sop_match: 0}; strat[s].n++; strat[s].preserved += a.preserved ? 1 : 0; strat[s].parse_ok += a.preserved && a.parse_ok ? 1 : 0; strat[s].sop_match += a.preserved && a.sop_match ? 1 : 0; }
    res.layer3 = {records: rc.length, status: by(() => 'all'), by_verdict: by(r => r.verdict), by_trigger: by(r => (r.triggers.length ? [...new Set(r.triggers)] : ['none'])), by_source: by(r => r.source),
      attempts: attempts.length, preserved: pct(attempts.filter(a => a.preserved).length, attempts.length), strategies: Object.fromEntries(Object.entries(strat).sort((a, b) => b[1].n - a[1].n)),
      parse_fixed_rate: pct(rc.filter(r => r.status !== 'unsaved').length, rc.length), saved_rate: pct(rc.filter(r => r.status === 'saved').length, rc.length),
      message_improved: pct(rc.filter(r => r.attempts.some(a => a.preserved && a.parse_ok && a.d1_delta > 0)).length, rc.length)};
  }
  writeJson(path.join(OUT, 'results.json'), res);
  console.log(JSON.stringify({layer1: res.layer1.sentences, blame: res.blame['v1.3'], heldout: res.heldout.B_all, calibration: {n: res.calibration.n, kb: res.calibration.kappa_binary, p: res.calibration.haiku_deep_precision_sample, r: res.calibration.haiku_deep_recall_sample}}, null, 1));
}

/** Layer 3 with the stronger judge's verdicts of the rewritten sentences (rewrites-N.fable.jsonl) replacing Haiku's. */
function restatusCommand() {
  const file = path.join(OUT, 'regularization-candidates.jsonl');
  const strong = new Map(fs.readdirSync(CAL).filter(f => /^rewrites-\d+\.fable\.jsonl$/.test(f)).flatMap(f => readJsonl(path.join(CAL, f))).map(j => [j.key, j]));
  const rc = readJsonl(file);
  let judged = 0;
  for (const r of rc) {
    r.attempts.forEach((t, k) => {
      t.haiku_parse_verdict ??= t.parse_verdict;
      t.sentences.forEach((x, j) => { const f = strong.get(`${r.key}~a${k}s${j}`); if (f) { x.haiku_verdict ??= x.verdict; x.verdict = f.verdict; x.error_type = f.error_type; x.wrong_arcs = f.issues ?? []; x.verdict_source = 'stronger'; judged++; } });
      const worst = t.sentences.reduce((w, x) => (x.verdict && (w === null || RANK[x.verdict] > RANK[w]) ? x.verdict : w), null);
      t.parse_verdict = worst; t.parse_ok = OK.has(worst);
    });
    const saved = r.attempts.some(t => t.preserved && t.parse_ok && t.sop_match);
    const fixed = r.attempts.some(t => t.preserved && t.parse_ok);
    r.status = saved ? 'saved' : fixed ? 'partially_saved' : 'unsaved';
    r.attempt_verdicts_source = 'stronger judge (Claude fable, blind, rubric v1)';
  }
  writeJsonl(file, rc);
  console.log('re-judged sentences', judged, rc.reduce((a, r) => ({...a, [r.verdict + ':' + r.status]: (a[r.verdict + ':' + r.status] ?? 0) + 1}), {}));
}

const cmd = process.argv[2];
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (cmd === 'final') finalCommand(); else if (cmd === 'results') resultsCommand(); else if (cmd === 'restatus') restatusCommand(); else console.log('final | results | restatus');
}
