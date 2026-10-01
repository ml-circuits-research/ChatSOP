#!/usr/bin/env node
/** SymbolicProofingLLM iteration-2 pair set (experiment train-symbolic-proofing-gemma270m-it2): sentence units on the analysis-layer split.
 *
 * Inputs (all train/dev, never a sealed file; leakage against the sealed tests is judged by the auditor tools/datasets/audit/symbolic-proofing-overlap.mjs
 * whose per-unit verdict file this builder reads back):
 *   - datasets/neuro_english/proofing            rebuilt analysis-layer pairs (paragraph-level pairs are cut into sentence units)
 *   - datasets/neuro_english/proofing-backgen    back-generated pairs (complex paraphrase -> original), re-checked against the NEW split
 *   - datasets/symbolic_english train/dev        identity units (every sentence of a working message, gate-checked alone)
 *   - datasets_sources/decomp_backgen            tangled single sentences -> the original multi-sentence message (only when needed, DeepSeek omp task)
 *
 *   node tools/datasets/build-symbolic-proofing-v2.mjs collect     # units, mechanical filters -> eval/reports/history/symbolic-proofing-it2/data/candidates.jsonl
 *   node tools/datasets/build-symbolic-proofing-v2.mjs parse       # Stanza parses (GPU, light) and the parse-judge items of the texts still to be judged
 *   node tools/datasets/build-symbolic-proofing-v2.mjs meaning-items   # two-vote meaning items of the units whose pair was altered by the cut
 *   node tools/datasets/build-symbolic-proofing-v2.mjs build       # gate + meaning verdicts + leakage verdicts -> datasets/neuro_english/proofing-it2
 *
 * Rules (preregistered): a repair unit keeps every lead-in and tag of its prompt; no target replaces a pronoun by a name or adds a fact or a name;
 * the target sentences pass the analysis gate (Stanza default and accurate trees identical AND the DeepSeek judge conditions a and c good) unless the
 * source row is in the NEW symbolic_english train/dev of the same split; an identity unit passes the gate alone; identity is at least half of the rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT, readJsonl, writeJsonl, writeJson, sha256} from './neuro-oracle/common.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {AnalysisLayer, writeJudgeItems} from '../eval/analysis-layer.mjs';
import {alignUnits, mechanicalUnit, sentencesOf, hasFiller, fillersOf, fold, norm} from './symbolic-proofing-v2/units.mjs';
import {appendMeaningItems, meaningItemId, meaningVotes} from './neuro-oracle/judge.mjs';
import {tokenLengths, countBy, percentiles} from './neuro-oracle/build.mjs';
import {mainForm} from './three-datasets/forms.mjs';
const DEFAULT_TOKEN_CAP = 400;

/** Pair-set version: `it2` (the frozen iteration-2 set, rules v2) or `it3` (the same builder with the corrected rules v3, owner direction 2026-10-01: the filters must not throw away good data). */
export const VERSION = process.env.SYMPROOF_VERSION ?? 'it2';
export const RULES = process.env.SYMPROOF_RULES ?? (VERSION === 'it3' ? 'v3' : 'v2');
process.env.SYMPROOF_RULES = RULES;
export const WORK = path.join(ROOT, `eval/reports/current/symbolic-proofing-${VERSION}/data`);
export const OUT_DIR = path.join(ROOT, `datasets/neuro_english/proofing-${VERSION}`);
export const MEANING_DIR = path.join(ROOT, 'datasets_sources/symbolic_proofing_it2_meaning_judge');
const DECOMP_DIR = path.join(ROOT, 'datasets_sources/decomp_backgen');
const CAND = path.join(WORK, 'candidates.jsonl');
const LEAK = path.join(WORK, 'leak-verdicts.json');
const cmd = process.argv[2];
const args = process.argv.slice(3);
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const hash = s => crypto.createHash('sha1').update(s).digest('hex');
const rank = (seed, id) => hash(`${seed}|${id}`);

function loadSymbolic() {
  const byId = new Map();
  for (const split of ['train', 'dev']) for (const row of readJsonlShardedSync(path.join(ROOT, `datasets/symbolic_english/${split}.jsonl`))) byId.set(row.id, {split, row});
  return byId;
}
const loadPairs = set => {
  const out = [];
  const audit = new Map(readJsonl(path.join(ROOT, `datasets/neuro_english/${set}/audit.jsonl`)).map(a => [a.id, a]));
  for (const split of ['train', 'dev']) for (const r of readJsonl(path.join(ROOT, `datasets/neuro_english/${set}/${split}.jsonl`))) out.push({...r, split, audit: audit.get(r.id) ?? {}});
  return out;
};

// ------------------------------------------------------------------ collect
export function collect() {
  fs.mkdirSync(WORK, {recursive: true});
  const sym = loadSymbolic(), rejected = {}, cands = [], rejectedRows = [];
  const reject = (why) => { rejected[why] = (rejected[why] ?? 0) + 1; };
  const seen = new Set();
  const push = c => { const k = `${c.kind}|${norm(c.prompt)}|${norm(c.target)}`; if (seen.has(k)) { reject('duplicate_pair'); return; } seen.add(k); cands.push(c); };

  // repair units of the two pair sets
  for (const origin of ['proofing', 'backgen']) {
    const set = origin === 'proofing' ? 'proofing' : 'proofing-backgen';
    for (const p of loadPairs(set)) {
      if (p.kind === 'identity') {
        if (origin !== 'backgen') continue; // identity of the proofing set comes from the symbolic rows below (gate-checked alone)
        if (sentencesOf(p.prompt).length !== 1) { reject('identity_backgen_multi_sentence'); continue; }
        push({id: `${p.id}`, prompt: norm(p.prompt), target: norm(p.prompt), kind: 'identity', split: p.split, origin: 'backgen_identity', origin_id: p.id, paraphrase_kind: p.audit.paraphrase_kind ?? null,
          verification: p.audit.verification, meaning: 'two_vote', filler: hasFiller(p.prompt)});
        continue;
      }
      const source = origin === 'backgen' ? sym.get(p.audit.source_row) : null;
      const inSymbolic = Boolean(source && source.split === p.split);
      const {units, dropped, prompt_sentences, target_sentences} = alignUnits(p.prompt, p.target);
      if (dropped) reject(`${origin}_alignment_gap`);
      if (!units.length) { reject(`${origin}_no_unit`); continue; }
      const whole = units.length === 1 && prompt_sentences === 1;
      // how the meaning of the source pair was verified: the two-vote judge, the gold SOP (a target with the SOP of the gold row), or construction (composed pairs)
      const basis = p.audit.meaning_judge === 'yes' || p.audit.meaning_judge?.m2 === 'yes' || String(p.audit.verification).startsWith('MEANING_TWO_VOTE') ? 'two_vote' : /^VERIFIED_GOLD$/.test(p.audit.verification) ? 'gold_sop' : p.audit.verification === 'VERIFIED_COMPOSED' ? 'composed' : 'unknown';
      if (whole && basis === 'unknown') { reject(`${origin}_meaning_basis_unknown`); continue; }
      for (const u of units) {
        const mech = mechanicalUnit(u.prompt, u.target, {cut: !whole, rules: RULES});
        // the v2 verdict of the same unit: a unit that v2 rejected and the current rules accept is a recovered pair (counted per v2 category in the manifest)
        const v2 = RULES === 'v2' ? null : mechanicalUnit(u.prompt, u.target, {cut: !whole, rules: 'v2'});
        if (!mech.ok) { for (const r of mech.reasons) reject(`${origin}_${r.split(':')[0]}`); rejectedRows.push({origin, id: p.id, split: p.split, kind: p.audit.paraphrase_kind ?? p.audit.source ?? null, prompt: u.prompt, target: u.target, reasons: mech.reasons, v2_ok: v2 ? v2.ok : null}); continue; }
        const unitTargetSentences = sentencesOf(u.target).length;
        push({id: whole ? p.id : `${p.id}@u${u.index}`, prompt: u.prompt, target: u.target, kind: 'repair', split: p.split, origin, origin_id: p.id, paraphrase_kind: p.audit.paraphrase_kind ?? null,
          verification: p.audit.verification ?? null, meaning: whole ? basis : 'needs', target_in_symbolic: inSymbolic, source_row: p.audit.source_row ?? null, pair_prompt_sentences: prompt_sentences, target_sentences: unitTargetSentences,
          proofing_source: p.audit.source ?? null, decomposition_type: p.audit.decomposition_type ?? null, filler: hasFiller(u.prompt), v2_rejected: v2 && !v2.ok ? [...new Set(v2.reasons.map(r => r.split(':')[0]))] : null});
      }
    }
  }
  // identity units of the symbolic_english rows: every sentence of a working message
  for (const {split, row} of sym.values()) {
    const units = sentencesOf(row.message);
    units.forEach((s, i) => { if (s.length >= 8 && s.length <= 400) push({id: `sym::${row.id}@s${i}`, prompt: s, target: s, kind: 'identity', split, origin: 'symbolic', origin_id: row.id, form: mainForm(row.analysis), meaning: 'identity', filler: hasFiller(s), message_sentences: units.length}); });
  }
  writeJsonl(CAND, cands);
  writeJsonl(path.join(WORK, 'rejected.jsonl'), rejectedRows);
  const stats = {rules: RULES, candidates: cands.length, by_origin_kind: countBy(cands, c => `${c.origin}:${c.kind}:${c.split}`), rejected, recovered_candidates_by_v2_reason: countBy(cands.filter(c => c.v2_rejected).flatMap(c => c.v2_rejected.map(r => ({r}))), x => x.r), recovered_candidates: cands.filter(c => c.v2_rejected).length};
  writeJson(path.join(WORK, 'collect-stats.json'), stats);
  console.log(JSON.stringify(stats, null, 1));
}

// ------------------------------------------------------------------ decomposition top-up (datasets_sources/decomp_backgen)
/** Adds the pairs (tangled sentence -> the group's original short sentences) of the DeepSeek task to the candidates (idempotent: re-collects the whole task output). */
export function collectDecomp() {
  const groups = new Map(readJsonl(path.join(DECOMP_DIR, 'groups.jsonl')).map(g => [g.id, g]));
  const cands = readJsonl(CAND).filter(c => c.origin !== 'decomp'), seen = new Set(cands.map(c => `${c.kind}|${norm(c.prompt)}|${norm(c.target)}`));
  const rejected = {}, reject = why => { rejected[why] = (rejected[why] ?? 0) + 1; };
  let rows = 0, added = 0;
  for (const name of fs.existsSync(path.join(DECOMP_DIR, 'output')) ? fs.readdirSync(path.join(DECOMP_DIR, 'output')).filter(n => /^part-\d+\.jsonl$/.test(n)).sort() : []) {
    for (const line of fs.readFileSync(path.join(DECOMP_DIR, 'output', name), 'utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      const g = groups.get(r.id);
      if (!g) { reject('unknown_group'); continue; }
      rows++;
      for (const v of r.variants ?? []) {
        const prompt = norm(v.text), target = g.sentences.join(' ');
        if (sentencesOf(prompt).length !== 1) { reject('not_one_sentence'); continue; }
        const mech = mechanicalUnit(prompt, target, {cut: false, rules: RULES});
        if (!mech.ok) { for (const why of mech.reasons) reject(`decomp_${why.split(':')[0]}`); continue; }
        const key = `repair|${prompt}|${target}`;
        if (seen.has(key)) { reject('duplicate_pair'); continue; }
        seen.add(key); added++;
        // two variants of the same kind in one group: the second gets a numeric suffix (the first keeps `#kind`, so judge verdicts stay valid)
        let id = `decomp::${g.id}#${v.kind}`;
        for (let n = 2; cands.some(c => c.id === id); n++) id = `decomp::${g.id}#${v.kind}${n}`;
        const v2 = RULES === 'v2' ? null : mechanicalUnit(prompt, target, {cut: false, rules: 'v2'});
        cands.push({id, v2_rejected: v2 && !v2.ok ? [...new Set(v2.reasons.map(r => r.split(':')[0]))] : null, prompt, target, kind: 'repair', split: g.split, origin: 'decomp', origin_id: g.id, paraphrase_kind: v.kind, verification: 'DECOMP_GROUP', meaning: 'needs', target_in_symbolic: true,
          target_sentences: g.sentences.length, pair_prompt_sentences: 1, filler: false});
      }
    }
  }
  writeJsonl(CAND, cands);
  console.log(JSON.stringify({rows, added, rejected}));
}

// ------------------------------------------------------------------ parse
async function parse() {
  const cands = readJsonl(CAND), texts = [];
  for (const c of cands) { texts.push(c.prompt); if (c.kind === 'repair') for (const s of sentencesOf(c.target)) texts.push(s); }
  const layer = new AnalysisLayer();
  console.log(JSON.stringify({texts: new Set(texts).size}));
  const parses = await layer.ensure(texts);
  const items = layer.pendingItems(texts);
  console.log(JSON.stringify({parses, ...writeJudgeItems(items), pending_items: items.length}));
}

// ------------------------------------------------------------------ meaning items
function meaningItems() {
  const cands = readJsonl(CAND).filter(c => c.kind === 'repair' && c.meaning === 'needs');
  const pairs = cands.map(c => ({cid: c.id, message: c.prompt, candidate: c.target}));
  console.log(JSON.stringify({units: pairs.length, ...appendMeaningItems(pairs, MEANING_DIR)}));
}

// ------------------------------------------------------------------ build
const SEED = 'symbolic-proofing-it2-v1';
const DECOMP_TYPES = new Set(['relative_clause', 'coordination', 'embedded_question']);

/** Decomposition shape of a unit: the prompt has more than one finite clause and the target several sentences. */
export function isDecomposition(layer, c) {
  if (c.kind !== 'repair' || sentencesOf(c.target).length < 2) return false;
  const shape = layer.shape(c.prompt);
  return Boolean(shape && shape.clauses >= 2);
}

export async function build() {
  const cands = readJsonl(CAND), layer = new AnalysisLayer();
  layer.reloadVerdicts();
  const meaning = fs.existsSync(MEANING_DIR) ? meaningVotes(MEANING_DIR) : new Map();
  const leak = fs.existsSync(LEAK) ? JSON.parse(fs.readFileSync(LEAK, 'utf8')) : {flagged: {}};
  const flagged = new Set(Object.keys(leak.flagged));
  const dropped = {}, drop = why => { dropped[why] = (dropped[why] ?? 0) + 1; };
  const kept = [];
  for (const c of cands) {
    if (flagged.has(c.id)) { drop('sealed_overlap'); continue; }
    if (c.kind === 'identity') {
      const g = layer.gate(c.prompt);
      if (g.pending) { drop('gate_pending'); continue; }
      if (!g.pass) { drop(`identity_gate_fail:${c.origin}`); continue; }
      kept.push(c);
      continue;
    }
    // a repair prompt that already passes the gate is a working sentence (SymbolicLM handles it): it is never edited, so it is not a repair
    const gp = layer.gate(c.prompt);
    if (gp.pending) { drop('gate_pending'); continue; }
    if (gp.pass) { drop(`repair_prompt_already_passes:${c.origin}`); continue; }
    // repair: the target is in the new symbolic_english (same split) or passes the gate now
    if (!c.target_in_symbolic) {
      const g = layer.gate(c.target);
      if (g.pending) { drop('gate_pending'); continue; }
      if (!g.pass) { drop(`target_gate_fail:${c.origin}`); continue; }
    }
    if (c.meaning === 'needs') {
      const v = meaning.get(meaningItemId(c.id, c.prompt, c.target));
      if (v !== 'yes') { drop(v === 'no' ? 'meaning_no' : 'meaning_pending'); continue; }
    }
    // a repair whose prompt already passes the gate AND equals its target analysis is not a repair (kept only as identity): a prompt that passes the gate and whose target differs is a legitimate normalization
    kept.push(c);
  }
  return {kept, dropped, layer};
}

// ------------------------------------------------------------------ compose
/** Preregistered composition (status/preregistrations/train-symbolic-proofing-gemma270m-it2.json). */
export const POLICY = {
  identity_share_min: 0.5, identity_over_repair: 1.25,
  filler_identity_cap: 1200, // lead-in / tag sentences taken from symbolic_english (besides the backgen lead_in identity kind)
  max_total_tokens: 400, max_target_sentences: 8, max_prompt_chars: 400,
  origin_priority: ['proofing', 'decomp', 'backgen'], seed: SEED, rules: RULES, version: VERSION,
};

const stableSort = (list, key, seed = SEED) => [...list].sort((a, b) => rank(seed, key(a)).localeCompare(rank(seed, key(b))));

export function compose(kept, layer) {
  const dropped = {}, drop = why => { dropped[why] = (dropped[why] ?? 0) + 1; };
  // duplicates: one label per prompt. A prompt that is both a repair and an identity unit stays a repair; a prompt in train and dev stays in train;
  // among repairs of one prompt the first origin in priority order wins.
  const prio = o => { const i = POLICY.origin_priority.indexOf(o); return i < 0 ? 99 : i; };
  const byPrompt = new Map();
  for (const c of stableSort(kept, c => c.id)) {
    if (c.prompt.length > POLICY.max_prompt_chars || sentencesOf(c.target).length > POLICY.max_target_sentences) { drop('too_long'); continue; }
    const k = fold(c.prompt), cur = byPrompt.get(k);
    if (!cur) { byPrompt.set(k, c); continue; }
    const better = (a, b) => (a.kind !== b.kind ? a.kind === 'repair' : a.split !== b.split ? a.split === 'train' : prio(a.origin) < prio(b.origin));
    if (better(c, cur)) byPrompt.set(k, c);
    drop('duplicate_prompt');
  }
  const units = [...byPrompt.values()];
  const out = {train: [], dev: []}, report = {};
  for (const split of ['train', 'dev']) {
    const repair = units.filter(c => c.split === split && c.kind === 'repair');
    const identity = units.filter(c => c.split === split && c.kind === 'identity');
    const quota = Math.ceil(repair.length * POLICY.identity_over_repair);
    const backgenId = identity.filter(c => c.origin === 'backgen_identity');
    const sym = identity.filter(c => c.origin === 'symbolic');
    const fillerSym = stableSort(sym.filter(c => c.filler), c => c.id).slice(0, split === 'train' ? POLICY.filler_identity_cap : Math.ceil(POLICY.filler_identity_cap * 0.12));
    const taken = new Set([...backgenId, ...fillerSym].map(c => c.id));
    // the rest of the identity quota: sentences of single-sentence symbolic_english rows first (the chat's typical unit), round-robin over the forms
    const rest = sym.filter(c => !taken.has(c.id));
    const byForm = new Map();
    for (const c of stableSort(rest, c => c.id)) (byForm.get(c.form ?? 'none') ?? byForm.set(c.form ?? 'none', []).get(c.form ?? 'none')).push(c);
    const forms = [...byForm.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
    const filler = [];
    for (let round = 0; backgenId.length + fillerSym.length + filler.length < quota; round++) {
      let any = false;
      for (const [, list] of forms) { if (round < list.length && backgenId.length + fillerSym.length + filler.length < quota) { filler.push(list[round]); any = true; } }
      if (!any) break;
    }
    const chosenIdentity = [...backgenId, ...fillerSym, ...filler];
    out[split] = [...repair, ...chosenIdentity].sort((a, b) => a.id.localeCompare(b.id));
    report[split] = {repair: repair.length, identity: chosenIdentity.length, identity_share: Math.round(1000 * chosenIdentity.length / (repair.length + chosenIdentity.length)) / 10, identity_quota: quota,
      identity_by_origin: countBy(chosenIdentity, c => c.origin), identity_filler_or_tag: chosenIdentity.filter(c => c.filler).length, identity_available: identity.length};
  }
  return {out, report, dropped};
}

const flatRow = c => ({id: c.id, prompt: c.prompt, target: c.target, kind: c.kind, language: 'en', source_language: 'en', pipeline: 'direct', target_source: `${c.kind === 'identity' ? 'identity' : 'repair'}:${c.origin}`});

async function composeCommand() {
  const {kept, dropped, layer} = await build();
  const {out, report, dropped: composeDropped} = compose(kept, layer);
  fs.mkdirSync(path.join(OUT_DIR, 'proofreader'), {recursive: true});
  const files = {train: path.join(OUT_DIR, 'train.jsonl'), dev: path.join(OUT_DIR, 'dev.jsonl')};
  for (const split of ['train', 'dev']) writeJsonl(files[split], out[split].map(flatRow));
  const tokens = tokenLengths([files.train, files.dev]);
  // token budget: a unit above the cap is dropped before anything is trained on it
  let tooLong = 0;
  for (const split of ['train', 'dev']) {
    const t = tokens[files[split]];
    out[split] = out[split].filter(c => { const total = t[c.id]?.[1] ?? 0; if (total > POLICY.max_total_tokens) { tooLong++; return false; } return true; });
    writeJsonl(files[split], out[split].map(flatRow));
  }
  const audit = [];
  const tokenOf = {};
  const finalTokens = tokenLengths([files.train, files.dev]);
  for (const split of ['train', 'dev']) {
    for (const c of out[split]) {
      const [promptTokens, totalTokens] = finalTokens[files[split]][c.id] ?? [null, null];
      tokenOf[c.id] = totalTokens;
      const shapeP = c.kind === 'repair' ? layer.shape(c.prompt) : null, shapeT = layer.shape(c.target);
      const dec = isDecomposition(layer, c);
      audit.push({id: c.id, pair_split: split, kind: c.kind, origin: c.origin, origin_id: c.origin_id, source_row: c.source_row ?? null, paraphrase_kind: c.paraphrase_kind ?? null, proofing_source: c.proofing_source ?? null,
        verification: c.verification ?? null, meaning_basis: c.meaning, target_in_symbolic: c.target_in_symbolic ?? null, filler: c.filler, form: c.form ?? null,
        prompt_clauses: shapeP?.clauses ?? null, target_sentences: sentencesOf(c.target).length, target_one_clause_sentences: shapeT?.one_clause ?? null, decomposition: dec,
        decomposition_short_sentences: dec && shapeT ? shapeT.one_clause === shapeT.sentences : false, tokens: {prompt: promptTokens, total: totalTokens}});
    }
  }
  writeJsonl(path.join(OUT_DIR, 'audit.jsonl'), audit);
  for (const split of ['train', 'dev']) fs.copyFileSync(files[split], path.join(OUT_DIR, 'proofreader', `${split}.jsonl`));
  const fileInfo = file => ({rows: fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, sha256: sha256(fs.readFileSync(file))});
  const summary = {};
  for (const split of ['train', 'dev']) {
    const rows = audit.filter(a => a.pair_split === split), repair = rows.filter(a => a.kind === 'repair');
    summary[split] = {pairs: rows.length, by_kind: countBy(rows, a => a.kind), identity_share: Math.round(1000 * rows.filter(a => a.kind === 'identity').length / rows.length) / 10, by_origin: countBy(rows, a => `${a.kind}:${a.origin}`),
      repair_by_paraphrase_kind: countBy(repair, a => a.paraphrase_kind ?? a.proofing_source ?? 'none'), repair_by_target_sentences: countBy(repair, a => Math.min(a.target_sentences, 6)),
      decomposition_pairs: repair.filter(a => a.decomposition).length, decomposition_with_short_target_sentences: repair.filter(a => a.decomposition_short_sentences).length,
      repair_with_two_or_more_target_sentences: repair.filter(a => a.target_sentences >= 2).length, filler_or_tag_units: rows.filter(a => a.filler).length, filler_or_tag_identity: rows.filter(a => a.filler && a.kind === 'identity').length,
      tokens_total: percentiles(rows.map(a => a.tokens.total ?? 0))};
  }
  // pairs recovered by the corrected rules, per v2 rejection category: candidates passing the rules, kept after the gates and the meaning judge, in the final set
  const perCategory = list => { const m = {}; for (const c of list) for (const r of c.v2_rejected ?? []) m[r] = (m[r] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
  const recovered = RULES === 'v2' ? null : {candidates: perCategory(readJsonl(CAND)), kept_after_gates: perCategory(kept), in_final_set: perCategory([...out.train, ...out.dev]),
    totals: {candidates: readJsonl(CAND).filter(c => c.v2_rejected).length, kept_after_gates: kept.filter(c => c.v2_rejected).length, in_final_set: [...out.train, ...out.dev].filter(c => c.v2_rejected).length}};
  const sealed = path.join(ROOT, 'eval/suites/neuro_english/proofing-test.jsonl');
  const manifest = {
    format: 'chatsop-proofing-pairs-v1', dataset: 'neuro_english', model: 'SymbolicProofingLLM', role: 'proofreader', prompt_profile: 'message-only', iteration: VERSION === 'it3' ? 3 : 2, unit: 'one sentence (host splitter lib/sentence-split.mjs) in, one or several simple sentences out',
    prompt: 'row.prompt verbatim: one clean-English sentence and nothing else (DS021 message-only input, no instruction wrapper, no system role); training/python/common.py chat_ids()',
    target: 'row.target verbatim: the verified limited-English rewrite (repair, one or several sentences) or the identical sentence (identity)',
    created: new Date().toISOString(), training_authorized: false, review_status: 'not_reviewed', policy: POLICY,
    sources: {'datasets/neuro_english/proofing': 'rebuilt analysis-layer pairs, cut into sentence units', 'datasets/neuro_english/proofing-backgen': 'back-generated pairs re-checked against the new symbolic_english split', 'datasets/symbolic_english': 'identity sentences', 'datasets_sources/decomp_backgen': 'tangled sentence -> original short sentences (DeepSeek omp task)'},
    files: {'train.jsonl': fileInfo(files.train), 'dev.jsonl': fileInfo(files.dev), 'audit.jsonl': fileInfo(path.join(OUT_DIR, 'audit.jsonl')), 'proofreader/train.jsonl': fileInfo(path.join(OUT_DIR, 'proofreader/train.jsonl')), 'proofreader/dev.jsonl': fileInfo(path.join(OUT_DIR, 'proofreader/dev.jsonl'))},
    sealed_test: {path: 'eval/suites/neuro_english/proofing-test.jsonl', rows: fileInfo(sealed).rows, sha256: fileInfo(sealed).sha256},
    summary, selection: report, dropped: {gates: dropped, composition: composeDropped, token_budget: tooLong}, recovered_vs_v2: recovered,
  };
  writeJson(path.join(OUT_DIR, 'manifest.json'), manifest);
  writeJson(path.join(OUT_DIR, 'proofreader/manifest.json'), {format: 'chatsop-proofreader-projection-v1', corpus: `neuro_english/proofing-${VERSION}`, prompt_profile: 'message-only', created: manifest.created, training_authorized: false, review_status: 'not_reviewed',
    note: 'Byte-identical copies of ../train.jsonl and ../dev.jsonl in the layout training/cli.mjs expects for the role proofreader.', files: {'proofreader/train.jsonl': manifest.files['proofreader/train.jsonl'], 'proofreader/dev.jsonl': manifest.files['proofreader/dev.jsonl']}});
  const version = `${new Date().toISOString().slice(0, 10)}-${manifest.files['train.jsonl'].sha256.slice(0, 8)}`;
  fs.writeFileSync(path.join(OUT_DIR, 'VERSION'), JSON.stringify({format: 'chatsop-dataset-version-v1', corpus: `neuro_english/proofing-${VERSION}`, counter: 1, label: `neuro_english/proofing-${VERSION} ${version} (sentence units, analysis-layer gate, pair rules ${RULES})`, dataset: `neuro_english/proofing-${VERSION}`, version, rules: 'ud-rules-v2.5'}) + '\n');
  writeJson(path.join(WORK, 'token-audit.json'), {generated_at: manifest.created, tokenizer: 'Gemma 3 (models/gemma/bases/99073d6b..., chat template of training/python/common.py chat_ids)', train: summary.train.tokens_total, dev: summary.dev.tokens_total, over_2048: Object.values(tokenOf).filter(t => t > 2048).length, over_cap: Object.values(tokenOf).filter(t => t > POLICY.max_total_tokens).length});
  console.log(JSON.stringify({summary, selection: report, dropped: manifest.dropped, recovered_vs_v2: recovered}, null, 1));
}

async function buildCommand() {
  const {kept, dropped, layer} = await build();
  const decomposition = kept.filter(c => isDecomposition(layer, c));
  console.log(JSON.stringify({kept: kept.length, dropped, repair: kept.filter(c => c.kind === 'repair').length, identity: kept.filter(c => c.kind === 'identity').length, decomposition: decomposition.length, decomposition_train: decomposition.filter(c => c.split === 'train').length, decomposition_by_origin: countBy(decomposition, c => c.origin)}, null, 1));
  writeJsonl(path.join(WORK, 'kept.jsonl'), kept);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const run = {collect: () => collect(), 'collect-decomp': () => collectDecomp(), parse, 'meaning-items': () => meaningItems(), build: buildCommand, compose: composeCommand}[cmd];
  if (!run) { console.error('usage: build-symbolic-proofing-v2.mjs collect|parse|meaning-items|build'); process.exit(2); }
  Promise.resolve(run()).then(() => process.exit(0), e => { console.error(e); process.exit(1); });
}
