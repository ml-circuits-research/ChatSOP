#!/usr/bin/env node
/** Training data of LanguageProofingLLM iteration 2 (experiment train-language-proofing-gemma270m-it2), role id `proofreader`.
 *
 *   node tools/datasets/build-language-proofing-v2.mjs candidates [--parts 000,001,...]   # mechanical filters, writes the meaning-judge items
 *   node tools/datasets/build-language-proofing-v2.mjs build      [--parts ...]          # after the judge: assemble train/dev/held-out sets
 *
 * Sources: (1) the iteration-1 projection datasets/bad_english/proofing (unchanged pairs), (2) the DeepSeek back-generated pairs of
 * datasets_sources/language_backgen/output (complete parts only), (3) identity pairs (clean English to itself), (4) keyboard-mash
 * identity pairs. See docs/specs/DS008 and eval/reports/current/language-proofing-it2/summary.md for the rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {hashText, norm} from './language-proofing/pairs.mjs';
import {harmonize, promptIsGateClean, entriesOf, pairsOfEntry} from './language-proofing/backgen-v2.mjs';
import {textKey} from './neuro-oracle/common.mjs';

export const WORK = path.join(ROOT, 'eval/reports/current/language-proofing-it2');
export const BACKGEN = path.join(ROOT, 'datasets_sources/language_backgen');
export const JUDGE = path.join(ROOT, 'datasets_sources/language_proofing_it2_backgen_judge');
export const USED = path.join(JUDGE, 'used');
const SRC_JUDGE = path.join(ROOT, 'datasets_sources/language_proofing_meaning_judge');
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
export const meaningUser = (input, output) => `ORIGINAL: ${input}\n\nREWRITE: ${output}`;

/** Parts whose output line count equals their input line count. */
export function completeParts() {
  const out = [];
  for (const f of fs.readdirSync(path.join(BACKGEN, 'output')).filter(f => /^part-\d+\.jsonl$/.test(f)).sort()) {
    const n = readJsonl(path.join(BACKGEN, 'output', f)).length, m = readJsonl(path.join(BACKGEN, 'input', f)).length;
    if (n === m && m > 0) out.push(f.slice(5, 8));
  }
  return out;
}
const sealedData = () => { const j = JSON.parse(fs.readFileSync(path.join(WORK, 'sealed-hashes.json'), 'utf8')); return {hashes: new Set(j.hashes), signatures: new Set(j.signatures)}; };

let CAND = 'candidates.jsonl', EVID = WORK;
function candidates(o) {
  if (o.cand) CAND = o.cand;
  const parts = o.parts ? String(o.parts).split(',') : completeParts();
  const sealed = sealedData(), stats = {parts, rows: 0, null_rows: 0}, cands = [], seenPrompt = new Set(), items = new Map();
  // snapshot of the parts used (the generator rewrote its output files after finishing; the snapshot is what is built, judged and qualified)
  for (const d of ['input', 'output']) fs.mkdirSync(path.join(USED, d), {recursive: true});
  for (const part of parts) for (const d of ['input', 'output']) fs.copyFileSync(path.join(BACKGEN, d, `part-${part}.jsonl`), path.join(USED, d, `part-${part}.jsonl`));
  for (const part of parts) {
    const inputs = readJsonl(path.join(USED, 'input', `part-${part}.jsonl`)), lines = readJsonl(path.join(USED, 'output', `part-${part}.jsonl`));
    if (inputs.length !== lines.length) throw Error(`part ${part} incomplete`);
    lines.forEach((line, i) => {
      if (line.id !== inputs[i].id) throw Error(`id mismatch in part ${part} line ${i + 1}`);
      stats.rows++;
      for (const entry of entriesOf(line, inputs[i].message, sealed, stats)) {
        const ps = pairsOfEntry(entry, stats).filter(p => {
          const hp = hashText(p.prompt);
          if (sealed.hashes.has(hp) || sealed.hashes.has(hashText(p.target))) { stats.sealed_match = (stats.sealed_match ?? 0) + 1; return false; }
          if (seenPrompt.has(hp)) { stats.duplicate_prompt = (stats.duplicate_prompt ?? 0) + 1; return false; }
          seenPrompt.add(hp); return true;
        });
        if (!ps.length) continue;
        const user = meaningUser(entry.bad, entry.clean), jid = textKey(user);
        const cand = {row_id: line.id, part, src: entry.src, lang: entry.lang, bad: entry.bad, clean: entry.clean, judge_id: jid, pairs: ps};
        cands.push(cand);
        if (norm(entry.bad) !== norm(entry.clean)) for (const condition of ['m1', 'm2']) items.set(`${jid}|${condition}`, {id: jid, condition, user});
      }
    });
  }
  fs.mkdirSync(WORK, {recursive: true});
  fs.writeFileSync(path.join(WORK, CAND), cands.map(c => JSON.stringify(c)).join('\n') + '\n');
  // the judge folder (same frozen SYSTEM prompts as every other meaning-judge run)
  for (const d of ['input', 'output', 'scripts', 'logs']) fs.mkdirSync(path.join(JUDGE, d), {recursive: true});
  for (const f of ['SYSTEM_m1.txt', 'SYSTEM_m2.txt', 'scripts/judge.py']) if (!fs.existsSync(path.join(JUDGE, f))) fs.copyFileSync(path.join(SRC_JUDGE, f), path.join(JUDGE, f));
  const task = path.join(JUDGE, 'TASK.md');
  if (!fs.existsSync(task)) fs.writeFileSync(task, fs.readFileSync(path.join(SRC_JUDGE, 'TASK.md'), 'utf8').replaceAll('language_proofing_meaning_judge', 'language_proofing_it2_backgen_judge').replace('(LanguageProofingLLM evaluation)', '(back-generated pairs of LanguageProofingLLM iteration 2)').replace(/`"m1" \| "m2" \| "m1r"`/, '`"m1" | "m2"`'));
  const file = path.join(JUDGE, 'input/items.jsonl'), have = new Set(readJsonl(file).map(i => `${i.id}|${i.condition}`));
  const add = [...items.values()].filter(i => !have.has(`${i.id}|${i.condition}`));
  if (add.length) fs.appendFileSync(file, add.map(i => JSON.stringify(i)).join('\n') + '\n');
  const by = {};
  for (const c of cands) { const k = `${c.src}/${c.lang}`; by[k] = (by[k] ?? 0) + c.pairs.length; }
  const out = {...stats, candidates: cands.length, sentence_pairs: cands.reduce((a, c) => a + c.pairs.length, 0), pairs_by_src_lang: by, judge_items_added: add.length, judge_items_total: have.size + add.length};
  fs.writeFileSync(path.join(WORK, CAND.replace('.jsonl', '-summary.json')), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out, null, 1));
}


// ---- build ----------------------------------------------------------------------------------------------------------------------------------
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {spawnSync} from 'node:child_process';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {gateClean} from './language-proofing/backgen-v2.mjs';
import {countBy, pairProblems} from './language-proofing/pairs.mjs';
import {familyPairs} from './language-proofing/family-templates.mjs';

let OUT = path.join(ROOT, 'datasets/bad_english/proofing-v2');
const IT1 = path.join(ROOT, 'datasets/bad_english/proofing-it2-projection/proofreader');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fold = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffled = (list, random) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Held-out vocabulary (owner brief: a few items held out of train entirely; they feed the held-out vocabulary dev). Applied to the English side of every pair. */
export const HELD_OUT = ['cousin', 'niece', 'uncle', 'tenant', 'supervisor', 'tutor', 'owe', 'adopt', 'audit', 'boatyard'];
const HELD_RE = /\b(cousins?|nieces?|uncles?|tenants?|supervisors?|tutors?|tutored|tutoring|owes?|owed|owing|adopts?|adopted|adopting|adoption|audits?|audited|auditing|boatyards?)\b/i;
/** Family terms: a Romanian source word must come out as its English counterpart (the iteration-1 hole turned "copilul" into "parent"). */
const FAMILY = [[/\b(copil|copilul|copilului|copii|copiii|copiilor|copila|copilei)\b/, /\b(child|children|kid|kids)\b/i], [/\b(fiul|fiului|fiu)\b/, /\b(son|sons)\b/i], [/\b(fiica|fiicei|fiice)\b/, /\b(daughters?)\b/i],
  [/\b(mama|mamei|mame)\b/, /\b(mother|mom|mum)\b/i], [/\b(tatal|tatalui|tata|tatei)\b/, /\b(father|dad)\b/i]];
export const familyProblem = (prompt, target) => FAMILY.some(([ro, en]) => ro.test(fold(prompt)) && !en.test(target));
const OVERSAMPLE = [[/\b(child|children)\b/i, 3], [/\b(son|daughter|mother|father|husband|wife|stepchild|grandchild|grandparent|twin)s?\b/i, 2]];

import {GIVEN_NAMES} from './diversity/names.mjs';
const NAMES = new Set(GIVEN_NAMES.map(n => n.name));
const LOWER_OK = new Set('is does do did can could would who what where when why how which are was were has have will should the my her his our their a an this that these those it he she we they you'.split(' '));
const AUX_START = new Set('is does do did can could would are was were has have will should'.split(' '));
const WH_START = new Set('who what where when why how which'.split(' '));
/** A clean sentence with a lead-in or a tag ("Quick question:", "Also,", "Any chance", ", right?"), or null when no natural variant exists. Only sentences whose first word can be lowercased or is a given name. */
function withLeadIn(sentence, random) {
  const words = sentence.split(/\s+/), first = words[0].replace(/[^\p{L}']/gu, ''), lower = first.toLowerCase();
  const isQ = sentence.trim().endsWith('?'), lowerable = LOWER_OK.has(lower) && first !== 'I', usable = lowerable || first === 'I' || NAMES.has(first);
  if (!usable) return null;
  const body = lowerable ? sentence[0].toLowerCase() + sentence.slice(1) : sentence;
  const variants = ['Quick question: ', 'Also, ', 'Honestly, ', 'Just checking: ', 'By the way, ', 'So, '].map(l => l + body);
  if (isQ && WH_START.has(lower)) variants.push('Any idea ' + body);
  if (!isQ && sentence.endsWith('.')) { variants.push('Any chance ' + body.slice(0, -1) + '?'); variants.push(sentence.slice(0, -1) + ', right?'); }
  return variants[Math.floor(random() * variants.length)];
}

const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz', '1234567890'];
function mash(random, used, sealedHashes) {
  for (let tries = 0; tries < 50; tries++) {
    const parts = [], n = 1 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) {
      const kind = random();
      let w = '';
      if (kind < 0.55) { const row = KEYS[Math.floor(random() * KEYS.length)], len = 4 + Math.floor(random() * 10), start = Math.floor(random() * row.length); for (let k = 0; k < len; k++) w += row[(start + k) % row.length]; }
      else if (kind < 0.8) { const cs = 'bcdfghjklmnpqrstvwxzqk', len = 5 + Math.floor(random() * 9); for (let k = 0; k < len; k++) w += cs[Math.floor(random() * cs.length)]; }
      else { const ch = 'abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 26)], len = 4 + Math.floor(random() * 8); w = ch.repeat(len); }
      if (random() < 0.15) w = w[0].toUpperCase() + w.slice(1);
      parts.push(w);
    }
    let text = parts.join(' ');
    if (random() < 0.25) text += ['?', '!', '.', '...'][Math.floor(random() * 4)];
    if (used.has(text) || gateClean(text).clean || sealedHashes.has(hashText(text))) continue;
    used.add(text);
    return text;
  }
  return null;
}

function readVerdicts() {
  const map = new Map();
  for (const r of readJsonl(path.join(JUDGE, 'output/verdicts.jsonl'))) map.set(`${r.id}|${r.condition}`, r.answer?.preserves ?? null);
  return map;
}

function build(o) {
  if (o.out) OUT = path.resolve(ROOT, o.out);
  const parts = o.parts ? String(o.parts).split(',') : completeParts();
  const random = rng(Number(o.seed ?? 20261001)), stats = {parts, filters: {}};
  const sealed = sealedData(), verdicts = readVerdicts();
  if (o.cand) CAND = o.cand;
  if (o.evidence) { EVID = path.resolve(ROOT, o.evidence); fs.mkdirSync(EVID, {recursive: true}); }
  const cands = readJsonl(path.join(WORK, CAND));
  const candParts = new Set(cands.map(c => c.part));
  if ([...candParts].some(p => !parts.includes(p))) throw Error(`${CAND} was built for other parts; run candidates first`);
  // --freeze-dev DIR (iteration 3): the dev sets of an earlier build stay exactly as they were, so that results stay comparable; the new data only goes to train, held-out vocabulary pairs to the reserve
  const frozen = o['freeze-dev'] ? (dir => { const d = path.resolve(ROOT, dir), rd = f => readJsonl(path.join(d, f)); const x = {dir: d, dev: rd('dev.jsonl'), devbg: rd('dev-backgen.jsonl'), heldout: rd('dev-heldout.jsonl'), mash: rd('mash-eval.jsonl'), audit: new Map(rd('audit.jsonl').map(a => [a.id, a]))}; x.prompts = new Set([...x.dev, ...x.devbg, ...x.heldout, ...x.mash].map(r => hashText(r.prompt))); return x; })(o['freeze-dev']) : null;
  const bump = (k, n = 1) => { stats.filters[k] = (stats.filters[k] ?? 0) + n; };
  // (d) the meaning judge, two votes; noisy_en needs both, ro and mixed (uncalibrated: the judge was calibrated on English) drop only when both vote no
  const judgeTable = {};
  const backgen = [], backgenDevRow = id => !frozen && parseInt(hashText(id).slice(0, 6), 16) % 100 < 8;
  for (const c of cands) {
    const m1 = verdicts.get(`${c.judge_id}|m1`), m2 = verdicts.get(`${c.judge_id}|m2`);
    if (norm(c.bad) !== norm(c.clean) && (m1 === undefined || m2 === undefined)) { if (o.partial) { bump('judge_pending_skipped', c.pairs.length); continue; } throw Error(`meaning verdict pending for ${c.judge_id}`); }
    const key = `${c.src}/${c.lang}`, vote = `${m1 === 'yes' ? 'y' : 'n'}${m2 === 'yes' ? 'y' : 'n'}`;
    (judgeTable[key] ??= {yy: 0, yn: 0, ny: 0, nn: 0})[vote]++;
    const keep = c.lang === 'noisy_en' ? vote === 'yy' : vote !== 'nn';
    if (!keep) { bump(`judge_dropped_${c.lang}`, c.pairs.length); continue; }
    c.judge = vote;
    backgen.push(c);
  }
  stats.judge_votes = judgeTable;
  // pairs
  const pairs = {train: [], dev: [], heldout: []}, reserve = [], seenPrompt = new Set();
  const flat = (id, p, extra = {}) => ({id, prompt: p.prompt, target: p.target, kind: p.kind ?? 'repair', language_kind: p.language_kind, target_source: p.target_source, ...extra});
  const audit = [];
  for (const c of backgen) {
    const devRow = backgenDevRow(c.row_id);
    c.pairs.forEach((p, i) => {
      if (FAMILY.length && c.lang !== 'noisy_en' && familyProblem(p.prompt, p.target)) { bump('family_term_misaligned'); return; }
      const tgt = harmonize(p.prompt, p.target);
      if (tgt === null || !tgt) { bump('harmonize_dropped'); return; }
      if (tgt !== p.target) { bump('harmonized_target'); p = {...p, target: tgt}; }
      const hp = hashText(p.prompt);
      if (seenPrompt.has(hp)) { bump('duplicate_prompt_after_judge'); return; }
      if (c.lang === 'noisy_en' && promptIsGateClean(p.prompt) && hashText(p.prompt) === hashText(p.target)) { bump('noisy_gate_clean_to_identity'); seenPrompt.add(hp); const id = `${c.row_id}::${c.src}:${c.lang}#${i + 1}`; audit.push({id, source: 'backgen', row_id: c.row_id, part: c.part, src: c.src, judge: c.judge, converted_to_identity: true}); const rec = {id, prompt: p.prompt, target: p.prompt, kind: 'identity', language_kind: 'clean', target_source: 'identity:gate-clean-noisy'}; if (HELD_RE.test(p.prompt)) return; (backgenDevRow(c.row_id) ? pairs.dev : pairs.train).push(rec); return; }
      seenPrompt.add(hp);
      const id = `${c.row_id}::${c.src}:${c.lang}#${i + 1}`;
      const rec = flat(id, {prompt: p.prompt, target: p.target, kind: 'repair', language_kind: c.lang, target_source: `llm:deepseek-flash:backgen-${c.src}`}, {});
      audit.push({id, source: 'backgen', row_id: c.row_id, part: c.part, src: c.src, judge: c.judge, langid_kind: p.langid_kind, gate_clean_prompt: p.gate_clean_prompt});
      if (HELD_RE.test(p.target) || HELD_RE.test(p.prompt)) { pairs.heldout.push(rec); return; }
      (devRow ? pairs.dev : pairs.train).push(rec);
    });
  }
  stats.backgen_pairs = {train: pairs.train.length, dev: pairs.dev.length, heldout_all: pairs.heldout.length};
  const backgenDevIds = new Set(pairs.dev.map(p => p.id));
  // held-out dev: a stratified cap, the rest kept as reserve for iteration 3
  const byKind = {};
  for (const p of shuffled(pairs.heldout.slice().sort((a, b) => a.id.localeCompare(b.id)), random)) { const k = p.language_kind; (byKind[k] ??= []).push(p); }
  const capPerKind = Number(o['heldout-per-kind'] ?? 200); let heldout = [];
  if (frozen) { const ids = new Set(frozen.heldout.map(r => r.id)); heldout = frozen.heldout; for (const list of Object.values(byKind)) for (const p of list) if (!ids.has(p.id)) reserve.push(p); }
  else for (const [k, list] of Object.entries(byKind)) { heldout.push(...list.slice(0, capPerKind)); reserve.push(...list.slice(capPerKind)); }
  // iteration-1 projection pairs: unchanged, minus sealed exact matches and held-out vocabulary
  const it1 = {train: readJsonl(path.join(IT1, 'train.jsonl')), dev: readJsonl(path.join(IT1, 'dev.jsonl'))};
  const keepIt1 = (split, list) => list.map(p => {
    if (p.kind !== 'repair') return p;
    if (p.language_kind === 'noisy_en' && promptIsGateClean(p.prompt) && hashText(p.prompt) === hashText(p.target)) { bump(`it1_${split}_noisy_gate_clean_to_identity`); return {...p, kind: 'identity', target: p.prompt, language_kind: 'clean', target_source: 'identity:gate-clean-noisy'}; }
    const tgt = harmonize(p.prompt, p.target);
    if (tgt === null) { bump(`it1_${split}_harmonize_dropped`); return null; }
    if (tgt !== p.target) bump(`it1_${split}_harmonized_target`);
    return tgt === p.target ? p : {...p, target: tgt};
  }).filter(Boolean).filter(p => {
    if (sealed.hashes.has(hashText(p.prompt)) || sealed.hashes.has(hashText(p.target))) { bump(`it1_${split}_dropped_sealed_match`); return false; }
    if (HELD_RE.test(p.target) || HELD_RE.test(p.prompt)) { bump(`it1_${split}_dropped_held_out_vocabulary`); return false; }
    return true;
  });
  const fromIt1 = {train: keepIt1('train', it1.train), dev: keepIt1('dev', it1.dev)};
  for (const split of ['train', 'dev']) for (const p of fromIt1[split]) audit.push({id: p.id, source: 'it1', kind: p.kind, target_source: p.target_source});
  // train pairs first: it1 then backgen (dedupe on prompt)
  const train = [], trainPrompts = new Set();
  const addTrain = p => { const h = hashText(p.prompt); if (frozen?.prompts.has(h)) { bump('train_prompt_in_frozen_dev'); return false; } if (trainPrompts.has(h)) { bump('train_duplicate_prompt'); return false; } trainPrompts.add(h); train.push(p); return true; };
  for (const p of fromIt1.train) addTrain(p);
  for (const p of pairs.train) addTrain(p);
  // identity pairs
  const gateOk = t => gateClean(t).clean;
  const sentencesOf = text => splitSentences(text).map(u => u.text).filter(t => t.length >= 8 && t.length <= 300);
  const symbolic = {train: readJsonlShardedSync(path.join(ROOT, 'datasets/symbolic_english/train.jsonl')), dev: readJsonlShardedSync(path.join(ROOT, 'datasets/symbolic_english/dev.jsonl'))};
  const identityCand = {train: [], dev: []}, idSeen = new Set();
  const pushId = (split, text, source) => { const h = hashText(text); if (idSeen.has(h) || sealed.hashes.has(h) || HELD_RE.test(text) || !gateOk(text)) return; idSeen.add(h); identityCand[split].push({text, source}); };
  const natural = /^(quick question|also|honestly|just checking|by the way|so|any chance|any idea|one more thing|out of curiosity|i was wondering|quick one|check this)\b|, right\?$/i;
  for (const split of ['train', 'dev']) for (const r of symbolic[split]) if (r.message.length <= 300) for (const t of sentencesOf(r.message)) pushId(split, t, natural.test(t) ? 'identity:lead-in:natural' : 'identity:symbolic_english');
  for (const c of backgen) if (c.src === 'new') for (const t of sentencesOf(c.clean)) pushId(backgenDevRow(c.row_id) ? 'dev' : 'train', t, 'identity:new.en');
  stats.identity_pools = {train: countBy(identityCand.train, x => x.source), dev: countBy(identityCand.dev, x => x.source)};
  const synth = {train: [], dev: []};
  for (const split of ['train', 'dev']) for (const x of shuffled(identityCand[split].filter(y => y.source !== 'identity:lead-in:natural'), random)) {
    if (synth[split].length >= (split === 'train' ? 1100 : 120)) break;
    const v = withLeadIn(x.text, random);
    if (v && !idSeen.has(hashText(v)) && gateOk(v) && !sealed.hashes.has(hashText(v))) { idSeen.add(hashText(v)); synth[split].push({text: v, source: 'identity:lead-in:synthetic'}); }
  }
  stats.identity_synthetic = {train: synth.train.length, dev: synth.dev.length};
  // the iteration-1 identity pairs stay; fill up to the target share with the new pools (natural lead-ins and new.en first)
  const repairCount = train.filter(p => p.kind === 'repair').length;
  const existingIdentity = train.filter(p => p.kind === 'identity').length;
  const shareTarget = Number(o['identity-share'] ?? 0.22), mashTrain = Number(o['mash-train'] ?? 300);
  const wantTrain = Math.round((repairCount + mashTrain) * shareTarget / (1 - shareTarget)) - existingIdentity - mashTrain * 0;
  const priority = x => (x.source === 'identity:lead-in:natural' ? 0 : x.source === 'identity:lead-in:synthetic' ? 1 : x.source === 'identity:new.en' ? 2 : 3);
  const poolTrain = [...identityCand.train, ...synth.train].sort((a, b) => priority(a) - priority(b) || hashText(a.text).localeCompare(hashText(b.text)));
  let added = 0;
  for (const x of poolTrain) {
    if (added >= wantTrain) break;
    const id = `id2::${hashText(x.text)}`;
    if (addTrain({id, prompt: x.text, target: x.text, kind: 'identity', language_kind: 'clean', target_source: x.source})) { added++; audit.push({id, source: 'identity', target_source: x.source}); }
  }
  stats.identity_train = {existing_it1: existingIdentity, added, wanted: wantTrain};
  // keyboard mash: identity
  const usedMash = new Set(), mashRand = rng(11), evalRand = rng(97);
  const mashRows = (n, r, prefix) => Array.from({length: n}, (_, i) => mash(r, usedMash, sealed.hashes)).filter(Boolean).map((t, i) => ({id: `${prefix}${i}`, prompt: t, target: t, kind: 'identity', language_kind: 'mash', target_source: 'identity:keyboard-mash'}));
  const mashTr = mashRows(mashTrain, mashRand, 'mash2-train-'), mashDev = mashRows(60, mashRand, 'mash2-dev-'), mashEval = mashRows(150, evalRand, 'mash2-eval-');
  for (const p of mashTr) { addTrain(p); audit.push({id: p.id, source: 'mash'}); }
  // rule-written family-relation pairs (child, son, daughter, mother, father); mechanical checks, sealed check, not oversampled
  let templated = 0;
  familyPairs({seed: Number(o.seed ?? 20261001)}).forEach((p, i) => {
    p = {...p, target: harmonize(p.prompt, p.target) ?? p.target};
    if (pairProblems(p.prompt, p.target).length || sealed.hashes.has(hashText(p.prompt)) || sealed.hashes.has(hashText(p.target)) || familyProblem(p.prompt, p.target)) { bump('template_dropped'); return; }
    const id = `tpl2::${p.relation}::${String(i).padStart(4, '0')}`;
    if (addTrain({id, prompt: p.prompt, target: p.target, kind: 'repair', language_kind: p.language_kind, target_source: 'template:family-relations'})) { templated++; audit.push({id, source: 'template', relation: p.relation}); }
  });
  stats.template_pairs = templated;
  // oversampling of the vocabulary-hole words (documented dose, not new data)
  let dup = 0;
  for (const p of train.slice()) if (p.kind === 'repair' && p.target_source !== 'template:family-relations') {
    const f = Math.max(1, ...OVERSAMPLE.filter(([re]) => re.test(p.target)).map(([, n]) => n));
    for (let k = 1; k < f; k++) { train.push({...p, id: `${p.id}~dup${k}`}); audit.push({id: `${p.id}~dup${k}`, source: 'oversample', of: p.id}); dup++; }
  }
  stats.oversampled_copies = dup;
  // dev: it1 dev, back-generated dev (pairs + identity), mash dev; train prompts win over dev prompts
  let dev = [], devPrompts = new Set(), devBg = [], mashEvalRows = mashEval;
  if (frozen) {
    dev = frozen.dev; devBg = frozen.devbg; mashEvalRows = frozen.mash;
    { const have = new Set(audit.map(a => a.id)); for (const r of [...frozen.dev, ...frozen.devbg, ...frozen.heldout, ...frozen.mash]) { const a = frozen.audit.get(r.id); if (a && !have.has(r.id)) { have.add(r.id); audit.push(a); } } }
  } else {
  const addDev = (p, into = null) => { const h = hashText(p.prompt); if (trainPrompts.has(h) || devPrompts.has(h)) { bump('dev_prompt_also_in_train_or_dev'); return; } devPrompts.add(h); dev.push(p); if (into) into.push(p); };
  for (const p of fromIt1.dev) addDev(p);
  for (const p of pairs.dev) addDev(p, devBg);
  const devId = [...identityCand.dev, ...synth.dev].filter(x => !trainPrompts.has(hashText(x.text)));
  const wantDevId = Math.round(dev.filter(p => p.kind === 'repair').length * shareTarget / (1 - shareTarget)) - dev.filter(p => p.kind === 'identity').length;
  let ad = 0;
  for (const x of devId.sort((a, b) => priority(a) - priority(b) || hashText(a.text).localeCompare(hashText(b.text)))) { if (ad >= wantDevId) break; const id = `id2::${hashText(x.text)}`; const before = dev.length; addDev({id, prompt: x.text, target: x.text, kind: 'identity', language_kind: 'clean', target_source: x.source}, devBg); if (dev.length > before) { ad++; audit.push({id, source: 'identity', target_source: x.source}); } }
  for (const p of mashDev) { addDev(p); audit.push({id: p.id, source: 'mash'}); }
  }
  // tokens
  fs.mkdirSync(path.join(OUT, 'proofreader'), {recursive: true});
  const files = {train, dev, 'dev-backgen': devBg, 'dev-heldout': heldout, 'mash-eval': mashEvalRows};
  const tmp = {}, python = process.env.TRAIN_PYTHON ?? path.join(process.env.HOME, 'nlp-venv/bin/python'), tokOut = path.join(WORK, '.tmp-tokens.json');
  for (const [name, rows] of Object.entries(files)) { tmp[name] = path.join(WORK, `.tmp-${name}.jsonl`); fs.writeFileSync(tmp[name], rows.map(r => JSON.stringify(r)).join('\n') + '\n'); }
  const r = spawnSync(python, ['training/python/pair_token_lengths.py', '--base', 'models/gemma/bases/99073d6b6edb0e298d163f964ec2b9d970b3408d', '--out', tokOut, ...Object.values(tmp)], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PYTHONPATH: path.join(ROOT, 'training/python')}});
  if (r.status !== 0) throw Error(`token lengths failed: ${r.stderr.slice(-400)}`);
  const lengths = JSON.parse(fs.readFileSync(tokOut, 'utf8')), tokenStats = {};
  let over = 0;
  for (const name of Object.keys(files)) {
    const table = lengths[tmp[name]], totals = files[name].map(p => table[p.id][1]).sort((a, b) => a - b);
    const keep = files[name].filter(p => table[p.id][1] <= 2048); over += files[name].length - keep.length; files[name] = keep;
    tokenStats[name] = {n: totals.length, p50: totals[Math.floor(totals.length / 2)], p99: totals[Math.floor(totals.length * 0.99)], max: totals[totals.length - 1]};
    fs.unlinkSync(tmp[name]);
  }
  fs.unlinkSync(tokOut);
  const body = rows => rows.map(p => JSON.stringify(p)).join('\n') + '\n';
  const w = (rel, rows) => { fs.writeFileSync(path.join(OUT, rel), body(rows)); return {rows: rows.length, sha256: sha(path.join(OUT, rel))}; };
  const written = {'proofreader/train.jsonl': w('proofreader/train.jsonl', files.train), 'proofreader/dev.jsonl': w('proofreader/dev.jsonl', files.dev)};
  fs.writeFileSync(path.join(OUT, 'train.jsonl'), body(files.train)); fs.writeFileSync(path.join(OUT, 'dev.jsonl'), body(files.dev));
  const extra = {'dev-backgen.jsonl': w('dev-backgen.jsonl', files['dev-backgen']), 'dev-heldout.jsonl': w('dev-heldout.jsonl', files['dev-heldout']), 'mash-eval.jsonl': w('mash-eval.jsonl', files['mash-eval']), 'reserve-heldout.jsonl': w('reserve-heldout.jsonl', reserve)};
  fs.writeFileSync(path.join(OUT, 'audit.jsonl'), body(audit));
  // integrity
  const ids = new Map(), twice = [];
  for (const [split, rows] of [['train', files.train], ['dev', files.dev]]) for (const p of rows) { if (ids.has(p.id)) twice.push(p.id); ids.set(p.id, split); }
  const trainH = new Set(files.train.map(p => hashText(p.prompt))), devH = files.dev.map(p => hashText(p.prompt));
  let sealedExact = 0;
  for (const rows of [files.train, files.dev, files['dev-heldout'], files['dev-backgen']]) for (const p of rows) for (const t of [p.prompt, p.target]) if (sealed.hashes.has(hashText(t))) sealedExact++;
  const heldoutInTrain = files.train.filter(p => HELD_RE.test(p.prompt) || HELD_RE.test(p.target)).length;
  const integrity = {generated_at: new Date().toISOString(), pairs: {train: files.train.length, dev: files.dev.length, dev_backgen: files['dev-backgen'].length, dev_heldout: files['dev-heldout'].length, mash_eval: files['mash-eval'].length},
    ids_in_two_splits: twice.length, exact_matches: {train_dev_heldout_vs_sealed_texts: sealedExact}, train_prompts_also_in_dev: devH.filter(h => trainH.has(h)).length, heldout_vocabulary_words_in_train: heldoutInTrain, heldout_prompts_in_train: files['dev-heldout'].filter(p => trainH.has(hashText(p.prompt))).length,
    note: 'exact matches after case, diacritic, punctuation and spacing folding against eval/reports/current/language-proofing-it2/sealed-hashes.json (every eval/suites test, proofing test and composed text, messages and sentences)'};
  const tokenAudit = {generated_at: integrity.generated_at, tokenizer: 'Gemma 3 (models/gemma/bases/99073d6b..., chat template of training/python/common.py chat_ids)', over_2048: 0, dropped_over_2048: over, ...tokenStats};
  fs.writeFileSync(path.join(EVID, 'integrity.json'), JSON.stringify(integrity, null, 1) + '\n');
  fs.writeFileSync(path.join(EVID, 'token-audit.json'), JSON.stringify(tokenAudit, null, 1) + '\n');
  const mix = rows => ({pairs: rows.length, by_pair: countBy(rows, p => p.kind), by_kind: countBy(rows, p => p.language_kind), by_target_source: countBy(rows, p => p.target_source)});
  const buildSummary = {...stats, train: mix(files.train), dev: mix(files.dev), dev_backgen: mix(files['dev-backgen']), dev_heldout: mix(files['dev-heldout']), mash_eval: mix(files['mash-eval']), reserve_heldout: reserve.length, held_out_vocabulary: HELD_OUT};
  buildSummary.identity_share_train = Math.round(1000 * files.train.filter(p => p.kind === 'identity').length / files.train.length) / 10;
  buildSummary.identity_share_dev = Math.round(1000 * files.dev.filter(p => p.kind === 'identity').length / files.dev.length) / 10;
  fs.writeFileSync(path.join(EVID, 'build-summary.json'), JSON.stringify(buildSummary, null, 1) + '\n');
  const src = f => sha(path.join(ROOT, f));
  const judgeFile = path.join(JUDGE, 'output/verdicts.jsonl');
  const manifest = {format: 'chatsop-proofing-pairs-v1', dataset: 'bad_english', model: 'LanguageProofingLLM', role: 'proofreader', iteration: 2, prompt_profile: 'message-only',
    prompt: 'row.prompt verbatim: one sentence of a Romanian, mixed or badly written English message (or clean English, or keyboard mash) and nothing else (DS021 message-only input); training/python/common.py chat_ids()',
    target: 'row.target verbatim: the clean English sentence (repair) or the identical sentence (identity; also for unintelligible keyboard-mash input)',
    created: integrity.generated_at, training_authorized: false, review_status: 'not_reviewed', backgen_parts: parts, identity_share_target: shareTarget, seed: Number(o.seed ?? 20261001), held_out_vocabulary: HELD_OUT,
    source_sha256: {'datasets/bad_english/proofing-it2-projection/proofreader/train.jsonl': src('datasets/bad_english/proofing-it2-projection/proofreader/train.jsonl'), 'datasets/bad_english/proofing-it2-projection/proofreader/dev.jsonl': src('datasets/bad_english/proofing-it2-projection/proofreader/dev.jsonl'), 'datasets/bad_english/proofing-it2-projection/manifest.json': src('datasets/bad_english/proofing-it2-projection/manifest.json'), 'datasets/bad_english/manifest.json': src('datasets/bad_english/manifest.json'), 'datasets/bad_english/train.jsonl': src('datasets/bad_english/train.jsonl'), 'datasets/bad_english/dev.jsonl': src('datasets/bad_english/dev.jsonl'), [`eval/reports/current/language-proofing-it2/${CAND}`]: sha(path.join(WORK, CAND)), 'datasets_sources/language_proofing_it2_backgen_judge/output/verdicts.jsonl': sha(judgeFile), 'datasets_sources/language_proofing_it2_backgen_judge/used/output (parts, snapshot of datasets_sources/language_backgen/output)': Object.fromEntries(parts.map(p => [`part-${p}`, sha(path.join(USED, 'output', `part-${p}.jsonl`))]))},
    sealed_hashes_sha256: sha(path.join(WORK, 'sealed-hashes.json')), files: {...written, ...extra}, summary: buildSummary,
    note: 'Targets of llm:deepseek-flash pairs are DeepSeek-written, review pending; the back-generated pairs passed the mechanical checks and the two-vote meaning judge (noisy_en: both votes; ro and mixed: dropped only when both vote no). proofreader/{train,dev}.jsonl are byte-identical to ../{train,dev}.jsonl.'};
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'proofreader/manifest.json'), JSON.stringify({format: 'chatsop-proofreader-projection-v1', corpus: 'bad_english/proofing-v2', prompt_profile: 'message-only', created: integrity.generated_at, training_authorized: false, review_status: 'not_reviewed', files: written}, null, 1) + '\n');
  const version = {format: 'chatsop-dataset-version-v1', corpus: 'bad_english/proofing-v2', counter: 2, dataset: 'bad_english/proofing-v2', version: `${integrity.generated_at.slice(0, 10)}-${written['proofreader/train.jsonl'].sha256.slice(0, 8)}`, label: `bad_english/proofing-v2 ${integrity.generated_at.slice(0, 10)}-${written['proofreader/train.jsonl'].sha256.slice(0, 8)} (sentence pairs, ${files.train.length} train / ${files.dev.length} dev)`};
  fs.writeFileSync(path.join(OUT, 'VERSION'), JSON.stringify(version) + '\n');
  console.log(JSON.stringify({out: path.relative(ROOT, OUT), ...buildSummary, integrity: {...integrity}, tokens: tokenStats}, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), o = args(rest);
  if (command === 'candidates') candidates(o);
  else if (command === 'build') build(o);
  else { console.error('usage: build-language-proofing-v2.mjs candidates|build'); process.exitCode = 2; }
}
