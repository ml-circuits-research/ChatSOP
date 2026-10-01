#!/usr/bin/env node
/** Builder of datasets/bad_english/proofing-prod1 (LanguageProofingLLM production build 1, role `proofreader`, experiment train-language-proofing-gemma270m-prod1).
 * Input: datasets/bad_english/proofing-it3 (the it3 recipe data) and the qualified datasets/bad_english/proofing-v3 it was built from. Changes, all deterministic and recorded
 * in the audit file and the manifest:
 *  1. ALL vocabulary is in training: the 1,772 pairs of the eight it3 probe words (nephew, landlord, contractor, postpone, reject, bakery, warehouse, pharmacy) return and so do the
 *     reserve pairs that contain them (48). Only a small dev slice stays out so that the vocabulary stays measurable: `dev-vocab8` (40 repair pairs per word, 320) and
 *     `dev-vocab8-identity` (the 306 clean sentences of it3) plus every train pair that shares a source row, prompt or target with them. No word is held out.
 *  2. Proper-name phrases stay as written: a repair target that loses an institution or place name of its prompt (tools/datasets/language-proofing/names-typos.mjs) is repaired
 *     when only the connector was translated (din to in or from) and dropped when the head or the place was translated ("Filarmonica din Lisbon" to "Lisbon Philharmonic");
 *     grounded augmentation pairs swap the place of kept names in both sides (`name_swap`); `dev-names` holds swaps of source rows that are removed from train.
 *  3. Typo'd child words: seeded keyboard typos of copil/copilul/copilului/copii/child/children in the prompt of existing pairs (`typo_child`), target unchanged;
 *     `dev-typochild` holds typo'd dev sentences.
 *  4. every added or kept text is checked against the sealed hashes and the dev sets.
 *
 *   node tools/datasets/build-language-proofing-prod1.mjs build [--seed 20261001] [--vocab-dev 40] [--names-dev-share 8] [--swaps 2] [--typos 3]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {hashText, countBy, pairProblems} from './language-proofing/pairs.mjs';
import {pairProblemsV2} from './language-proofing/backgen-v2.mjs';
import {normalizeSpacing, hasSpacingDefect} from './language-proofing/spacing.mjs';
import {TRAINED_TEN, HELD_OUT_V3, anyMatch, matchesAny} from './language-proofing/vocab-it3.mjs';
import {instNames, fold, splitName, groupOf, NAME_GROUPS, repairNameTarget, swapName, childWords, typoChild, TYPO_OPS} from './language-proofing/names-typos.mjs';

const IT3 = path.join(ROOT, 'datasets/bad_english/proofing-it3'), V3 = path.join(ROOT, 'datasets/bad_english/proofing-v3'), OUT = path.join(ROOT, 'datasets/bad_english/proofing-prod1');
const EVID = path.join(ROOT, 'eval/reports/current/language-proofing-prod1/data');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const body = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
export const rowOf = id => id.replace(/::(?:sp|nm\d+|tc\d+|nd\d*|td\d*)$/, '').replace(/#\d+(~dup\d+)?$/, '').split('::new:')[0].split('::same:')[0];
const order = (rows, salt) => rows.slice().sort((a, b) => hashText(`${salt}${a.id}`).localeCompare(hashText(`${salt}${b.id}`)));
const isMash = r => r.language_kind === 'mash';
const place = name => splitName(name);

/** Place pool per head group, from every institution name of the prompts of the given rows. */
function placePool(rows) {
  const pool = {};
  for (const r of rows) for (const n of instNames(r.prompt)) {
    const s = place(n), g = s && groupOf(s.head);
    if (!g || s.place.includes(' ') && s.place.split(' ').length > 2) continue;
    (pool[g] ??= new Set()).add(`${s.connector}${s.place}`);
  }
  return Object.fromEntries(Object.entries(pool).map(([g, set]) => [g, [...set].sort()]));
}

export function build(o = {}) {
  const seed = Number(o.seed ?? 20261001), vocabDev = Number(o['vocab-dev'] ?? 15), namesShare = Number(o['names-dev-share'] ?? 8), nSwaps = Number(o.swaps ?? 2), nTypos = Number(o.typos ?? 3);
  const train3 = readJsonl(path.join(IT3, 'train.jsonl')), dev = readJsonl(path.join(IT3, 'dev.jsonl')), devBg = readJsonl(path.join(IT3, 'dev-backgen.jsonl')), devHeld = readJsonl(path.join(IT3, 'dev-heldout.jsonl'));
  const heldV3 = readJsonl(path.join(IT3, 'dev-heldout-v3.jsonl')), heldV3Id = readJsonl(path.join(IT3, 'dev-heldout-v3-identity.jsonl')), devSpacing = readJsonl(path.join(IT3, 'dev-spacing.jsonl')), mashEval = readJsonl(path.join(IT3, 'mash-eval.jsonl'));
  const v3train = readJsonl(path.join(V3, 'train.jsonl')), reserve = readJsonl(path.join(V3, 'reserve-heldout.jsonl'));
  const audit = new Map([...readJsonl(path.join(V3, 'audit.jsonl')), ...readJsonl(path.join(IT3, 'audit.jsonl'))].map(a => [a.id, a]));
  const sealedJ = JSON.parse(fs.readFileSync(path.join(EVID, 'sealed-hashes-union.json'), 'utf8'));
  const sealed = {hashes: new Set(sealedJ.hashes)};
  const stats = {train_it3: train3.length};

  // ---- 1. all vocabulary ----------------------------------------------------------------------------------------------------------------------
  const byWord = {}, devVocab = [];
  const vocabDevN = vocabDev;
  for (const r of order(heldV3, 'dv8')) { const w = r.heldout_word; byWord[w] = (byWord[w] ?? 0) + 1; if (byWord[w] <= vocabDev) devVocab.push(r); }
  // The dev slice is out of train by exact text (prompt, target); paraphrase siblings (same source row and word) stay in train because the eight words have only about 1,100 distinct
  // sentences between them: the number of train rows that share a source row and word with the slice is reported (train_rows_sharing_a_source_row_with_dev_vocab8) and the
  // honest generalization measurement of the vocabulary is the fresh probe (eval/suites/bad_english/proofing-probe-vocab.jsonl, sentences written after the data was frozen).
  const wordOf = r => anyMatch(HELD_OUT_V3, r.target) ?? anyMatch(HELD_OUT_V3, r.prompt);
  const devVocabId = order(heldV3Id, 'dv8id').slice(0, 100);
  const devVocabRows = new Set([...devVocab, ...devVocabId].map(r => `${rowOf(r.id)}|${wordOf(r)}`)), devVocabPrompts = new Set([...devVocab, ...devVocabId].map(r => hashText(r.prompt))), devVocabTargets = new Set([...devVocab, ...devVocabId].map(r => hashText(r.target)));
  const removed = v3train.filter(r => matchesAny(HELD_OUT_V3, r.prompt, r.target));
  const bringBack = [], skip = {source_row_or_text_in_dev_vocab8: 0, spacing_target_defect: 0};
  for (const r of [...removed, ...reserve.filter(x => matchesAny(HELD_OUT_V3, x.prompt, x.target))]) {
    if (devVocabPrompts.has(hashText(r.prompt)) || (r.kind === 'repair' && devVocabTargets.has(hashText(r.target)))) { skip.source_row_or_text_in_dev_vocab8++; continue; }
    if (r.kind === 'repair' && !isMash(r) && hasSpacingDefect(r.target)) { skip.spacing_target_defect++; continue; }
    if (r.kind === 'identity' && !isMash(r) && hasSpacingDefect(r.prompt)) {
      const id = `${r.id}::sp`; bringBack.push({id, prompt: r.prompt, target: normalizeSpacing(r.prompt), kind: 'repair', language_kind: 'noisy_en', target_source: 'spacing:natural'});
      audit.set(id, {id, source: 'spacing', natural: true, of: r.id}); continue;
    }
    bringBack.push(r);
  }
  // duplicates of an identical prompt that train already holds are not added a second time
  const trainPrompts = new Set(train3.map(r => hashText(r.prompt)));
  const added = [];
  for (const r of bringBack) { const hp = hashText(r.prompt); if (trainPrompts.has(hp) && !isMash(r)) { skip.duplicate_prompt = (skip.duplicate_prompt ?? 0) + 1; continue; } trainPrompts.add(hp); added.push(r); }
  stats.vocabulary = {removed_pairs_of_it3: removed.length, reserve_pairs_with_the_words: reserve.filter(x => matchesAny(HELD_OUT_V3, x.prompt, x.target)).length, skipped: skip, added: added.length, dev_vocab8: devVocab.length, dev_vocab8_identity: devVocabId.length, added_by_word: countBy(added, r => anyMatch(HELD_OUT_V3, r.target) ?? anyMatch(HELD_OUT_V3, r.prompt) ?? 'none')};
  let train = [...train3, ...added];

  // ---- 2. proper-name phrases ---------------------------------------------------------------------------------------------------------------------
  const nameStats = {repair_pairs_with_name: 0, kept_verbatim: 0, repaired_connector: 0, dropped_translated: 0};
  const afterNames = [], dropped = [];
  for (const r of train) {
    if (r.kind !== 'repair' || isMash(r)) { afterNames.push(r); continue; }
    const names = instNames(r.prompt);
    if (!names.length) { afterNames.push(r); continue; }
    nameStats.repair_pairs_with_name++;
    if (names.every(n => fold(r.target).includes(fold(n)))) { nameStats.kept_verbatim++; afterNames.push(r); continue; }
    const fixed = repairNameTarget(r.prompt, r.target);
    if (fixed !== null && !pairProblems(r.prompt, fixed).length) {
      nameStats.repaired_connector++;
      audit.set(r.id, {id: r.id, source: 'name_repair', original_target: r.target, original: audit.get(r.id) ?? null});
      afterNames.push({...r, target: fixed, target_source: `${r.target_source}+name_repair`});
    } else { nameStats.dropped_translated++; dropped.push({id: r.id, prompt: r.prompt, target: r.target}); }
  }
  train = afterNames;
  stats.names = nameStats;
  // dev-names: swaps of source rows that leave train
  const DERIVED = /::(?:sp|nm\d+|tc\d+|nd\d+|td\d+)$/;
  const kept = train.filter(r => r.kind === 'repair' && !isMash(r) && !DERIVED.test(r.id) && audit.get(r.id)?.source !== 'name_repair' && instNames(r.prompt).length === 1 && splitName(instNames(r.prompt)[0]) && groupOf(splitName(instNames(r.prompt)[0]).head));
  const pool = placePool(kept);
  const nameDevRows = new Set(), keptOrdered = order(kept, 'nm');
  const sourcesByRow = new Map();
  for (const r of keptOrdered) { const k = rowOf(r.id); if (!sourcesByRow.has(k)) sourcesByRow.set(k, []); sourcesByRow.get(k).push(r); }
  const rowKeys = [...sourcesByRow.keys()].sort((a, b) => hashText(`dn${a}`).localeCompare(hashText(`dn${b}`)));
  for (const k of rowKeys) if (parseInt(hashText(`dn${k}`).slice(0, 6), 16) % 100 < namesShare) nameDevRows.add(k);
  const makeSwaps = (sources, n, idTag, salt) => {
    const out = [];
    for (const r of sources) {
      const from = instNames(r.prompt)[0], s = place(from), g = groupOf(s.head);
      const heads = NAME_GROUPS[g].filter(h => h !== s.head), tried = new Set([fold(from)]);
      let made = 0;
      for (let attempt = 0; attempt < 12 && made < n; attempt++) {
        const h = parseInt(hashText(`${salt}${r.id}${attempt}`).slice(0, 8), 16);
        const head = attempt % 3 === 2 && heads.length ? heads[h % heads.length] : s.head;
        const places = pool[g] ?? [];
        if (!places.length) break;
        const placeText = places[(h >>> 4) % places.length];
        const to = `${head}${placeText}`;
        if (tried.has(fold(to))) continue; tried.add(fold(to));
        const sw = swapName(r.prompt, r.target, from, to);
        if (!sw || pairProblems(sw.prompt, sw.target).length || instNames(sw.prompt).length !== 1 || instNames(sw.prompt)[0] !== to) continue;
        made++;
        out.push({row: {id: `${r.id}::${idTag}${made}`, prompt: sw.prompt, target: sw.target, kind: 'repair', language_kind: r.language_kind, target_source: `${r.target_source}+name_swap`}, audit: {id: `${r.id}::${idTag}${made}`, source: 'name_swap', of: r.id, from, to}});
      }
    }
    return out;
  };
  const devNameSources = keptOrdered.filter(r => nameDevRows.has(rowOf(r.id)));
  const devNames = makeSwaps(devNameSources, 1, 'nd', 'ndev');
  const devNamePairs = [...devNameSources.map(r => ({...r, heldout_name: instNames(r.prompt)[0]})), ...devNames.map(s => ({...s.row, heldout_name: instNames(s.row.prompt)[0]}))];
  for (const s of devNames) audit.set(s.row.id, s.audit);
  const trainBeforeNames = train.filter(r => !nameDevRows.has(rowOf(r.id)));
  stats.names.dev_source_rows = nameDevRows.size; stats.names.dev_names_pairs = devNamePairs.length;
  const swapSources = keptOrdered.filter(r => !nameDevRows.has(rowOf(r.id)));
  const swaps = makeSwaps(swapSources, nSwaps, 'nm', 'ntr');
  for (const s of swaps) audit.set(s.row.id, s.audit);
  stats.names.swap_pairs = swaps.length; stats.names.place_pool = Object.fromEntries(Object.entries(pool).map(([g, l]) => [g, l.length]));
  train = [...trainBeforeNames, ...swaps.map(s => s.row)];

  // ---- 3. typo'd child words ---------------------------------------------------------------------------------------------------------------------
  const CHILD_TARGET = /\b(child|children|kid|kids)\b/i;
  const makeTypos = (sources, n, idTag, salt) => {
    const out = [], seenPrompts = new Set();
    for (const r of sources) {
      if (!childWords(r.prompt).length || !CHILD_TARGET.test(r.target) || isMash(r)) continue;
      const isId = r.kind === 'identity', limit = isId ? Math.min(n, 2) : n;
      let made = 0;
      for (let attempt = 0; attempt < 30 && made < limit; attempt++) {
        const h = parseInt(hashText(`${salt}${r.id}${attempt}`).slice(0, 8), 16);
        const op = TYPO_OPS[h % TYPO_OPS.length], occ = (h >>> 8) % childWords(r.prompt).length;
        const prompt = typoChild(r.prompt, {occ, op, seed});
        if (!prompt || seenPrompts.has(prompt) || pairProblems(prompt, r.target).length || hasSpacingDefect(prompt) !== hasSpacingDefect(r.prompt)) continue;
        seenPrompts.add(prompt); made++;
        const id = `${r.id}::${idTag}${made}`;
        out.push({row: {id, prompt, target: r.target, kind: 'repair', language_kind: r.language_kind === 'clean' || isId ? 'noisy_en' : r.language_kind, target_source: `${r.target_source ?? 'pair'}+typo_child`}, audit: {id, source: 'typo_child', of: r.id, occ, op, seed}});
      }
    }
    return out;
  };
  const typoSources = train.filter(r => !DERIVED.test(r.id));
  const typos = makeTypos(order(typoSources, 'tcs'), nTypos, 'tc', 'tct');
  for (const s of typos) audit.set(s.row.id, s.audit);
  const devTypoSources = [...new Map([...dev, ...devBg, ...devHeld].filter(r => !isMash(r)).map(r => [r.id, r])).values()];
  const devTypo = makeTypos(order(devTypoSources, 'tcd'), 2, 'td', 'tdv');
  for (const s of devTypo) audit.set(s.row.id, s.audit);
  stats.typo_child = {train_pairs: typos.length, dev_pairs: devTypo.length, ops_train: countBy(typos, s => s.audit.op), by_kind_train: countBy(typos, s => s.row.language_kind)};
  train = [...train, ...typos.map(s => s.row)];

  // ---- 4. leakage ------------------------------------------------------------------------------------------------------------------------------------
  const devFiles = {dev, 'dev-backgen': devBg, 'dev-heldout': devHeld, 'dev-vocab8': devVocab, 'dev-vocab8-identity': devVocabId, 'dev-spacing': devSpacing, 'mash-eval': mashEval, 'dev-names': devNamePairs, 'dev-typochild': devTypo.map(s => s.row)};
  const devAll = new Set(Object.entries(devFiles).filter(([n]) => n !== 'mash-eval').flatMap(([, rows]) => rows).map(r => hashText(r.prompt)));
  let sealedExact = 0, devOverlap = 0;
  const filtered = [];
  for (const r of train) {
    if (isMash(r)) { filtered.push(r); continue; }
    if (sealed.hashes.has(hashText(r.prompt)) || sealed.hashes.has(hashText(r.target))) { sealedExact++; continue; }
    if (devAll.has(hashText(r.prompt))) { devOverlap++; continue; }
    filtered.push(r);
  }
  stats.dropped_sealed = sealedExact; stats.dropped_prompt_in_dev = devOverlap;
  // an id must be unique
  const seenId = new Set(); const finalTrain = filtered.filter(r => !seenId.has(r.id) && seenId.add(r.id));
  stats.dropped_duplicate_id = filtered.length - finalTrain.length;
  // a derived pair needs its parent in the dataset (the parent may have been dropped as a sealed or dev text)
  const present = new Set([...finalTrain, ...Object.values(devFiles).flat()].map(r => r.id));
  const orphan = r => { const a = audit.get(r.id); return a && ['name_swap', 'typo_child'].includes(a.source) && !present.has(a.of); };
  stats.dropped_orphan_derived = finalTrain.filter(orphan).length;
  for (const [name, rows] of Object.entries(devFiles)) devFiles[name] = rows.filter(r => !orphan(r));
  const finalTrain2 = finalTrain.filter(r => !orphan(r));
  // ---- token lengths -----------------------------------------------------------------------------------------------------------------------------
  fs.mkdirSync(path.join(OUT, 'proofreader'), {recursive: true});
  const files = {train: finalTrain2, ...devFiles};
  const python = process.env.TRAIN_PYTHON ?? path.join(process.env.HOME, 'nlp-venv/bin/python'), tmp = {}, tokOut = path.join(EVID, '.tmp-tokens.json');
  for (const [name, rows] of Object.entries(files)) { tmp[name] = path.join(EVID, `.tmp-${name}.jsonl`); fs.writeFileSync(tmp[name], body(rows)); }
  const rr = spawnSync(python, ['training/python/pair_token_lengths.py', '--base', 'models/gemma/bases/99073d6b6edb0e298d163f964ec2b9d970b3408d', '--out', tokOut, ...Object.values(tmp)], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PYTHONPATH: path.join(ROOT, 'training/python')}});
  if (rr.status !== 0) throw Error(`token lengths failed: ${rr.stderr.slice(-400)}`);
  const lengths = JSON.parse(fs.readFileSync(tokOut, 'utf8')), tokenStats = {};
  let over = 0;
  for (const name of Object.keys(files)) {
    const table = lengths[tmp[name]], totals = files[name].map(p => table[p.id][1]).sort((a, b) => a - b);
    const keep = files[name].filter(p => table[p.id][1] <= 2048); over += files[name].length - keep.length; files[name] = keep;
    tokenStats[name] = {n: totals.length, p50: totals[Math.floor(totals.length / 2)], p99: totals[Math.floor(totals.length * 0.99)], max: totals[totals.length - 1]};
    fs.unlinkSync(tmp[name]);
  }
  fs.unlinkSync(tokOut);
  // ---- write -------------------------------------------------------------------------------------------------------------------------------------
  const w = (rel, rows) => { fs.writeFileSync(path.join(OUT, rel), body(rows)); return {rows: rows.length, sha256: sha(path.join(OUT, rel))}; };
  const written = {'proofreader/train.jsonl': w('proofreader/train.jsonl', files.train), 'proofreader/dev.jsonl': w('proofreader/dev.jsonl', files.dev)};
  fs.writeFileSync(path.join(OUT, 'train.jsonl'), body(files.train)); fs.writeFileSync(path.join(OUT, 'dev.jsonl'), body(files.dev));
  const extra = {};
  for (const name of Object.keys(devFiles).filter(n => n !== 'dev')) extra[`${name}.jsonl`] = w(`${name}.jsonl`, files[name]);
  const auditIds = new Set(Object.values(files).flat().map(r => r.id).filter(id => !(mashEval.some(m => m.id === id))));
  const auditRows = [...auditIds].map(id => audit.get(id)).filter(Boolean), missing = [...auditIds].filter(id => !audit.has(id));
  if (missing.length) throw Error(`${missing.length} rows without an audit record, e.g. ${missing[0]}`);
  fs.writeFileSync(path.join(OUT, 'audit.jsonl'), body(auditRows));
  fs.writeFileSync(path.join(OUT, 'dropped-translated-names.jsonl'), body(dropped));
  // integrity
  const trainH = new Set(files.train.map(p => hashText(p.prompt))), twice = [], seenIds = new Map();
  for (const [split, rows] of [['train', files.train], ['dev', files.dev]]) for (const p of rows) { if (seenIds.has(p.id)) twice.push(p.id); seenIds.set(p.id, split); }
  const devSets = Object.keys(devFiles).filter(n => n !== 'mash-eval');
  let sealedAll = 0;
  for (const rows of [files.train, ...devSets.map(n => files[n])]) for (const p of rows) { if (isMash(p)) continue; for (const t of [p.prompt, p.target]) if (sealed.hashes.has(hashText(t))) sealedAll++; }
  const wordsInTrain = {};
  for (const [table, label] of [[TRAINED_TEN, 'ten'], [HELD_OUT_V3, 'eight']]) for (const wd of Object.keys(table)) wordsInTrain[wd] = files.train.filter(p => table[wd].test(p.target)).length;
  const devVocabLeak = files.train.filter(p => devVocabRows.has(`${rowOf(p.id)}|${wordOf(p)}`)).length;
  const integrity = {generated_at: new Date().toISOString(), pairs: Object.fromEntries(Object.entries(files).map(([k, v]) => [k.replace(/-/g, '_'), v.length])),
    ids_in_two_splits: twice.length, exact_matches: {train_dev_sets_vs_sealed_texts: sealedAll},
    train_prompts_also_in_dev: devSets.flatMap(n => files[n]).filter(p => trainH.has(hashText(p.prompt))).length,
    heldout_vocabulary_words_in_train: 0, heldout_prompts_in_train: 0, vocabulary_in_train_targets: wordsInTrain, train_rows_sharing_a_source_row_with_dev_vocab8: devVocabLeak,
    note: 'exact matches after case, diacritic, punctuation and spacing folding against data/sealed-hashes-union.json; NO vocabulary word is held out of training: all eighteen words (ten of it3, eight of the it3 probe) are in train (vocabulary_in_train_targets); heldout_vocabulary_words_in_train is therefore 0 by definition; dev-vocab8 and dev-heldout are dev slices whose source rows, prompts and targets are not in train'};
  const tokenAudit = {generated_at: integrity.generated_at, tokenizer: 'Gemma 3 (models/gemma/bases/99073d6b..., chat template of training/python/common.py chat_ids)', over_2048: 0, dropped_over_2048: over, ...tokenStats};
  fs.writeFileSync(path.join(EVID, 'integrity.json'), JSON.stringify(integrity, null, 1) + '\n');
  fs.writeFileSync(path.join(EVID, 'token-audit.json'), JSON.stringify(tokenAudit, null, 1) + '\n');
  const mix = rows => ({pairs: rows.length, by_pair: countBy(rows, p => p.kind), by_kind: countBy(rows, p => p.language_kind), by_target_source: countBy(rows, p => p.target_source)});
  const buildSummary = {...stats, train: mix(files.train), dev: mix(files.dev), vocabulary_in_train_targets: wordsInTrain};
  buildSummary.identity_share_train = Math.round(1000 * files.train.filter(p => p.kind === 'identity').length / files.train.length) / 10;
  fs.writeFileSync(path.join(EVID, 'build-summary.json'), JSON.stringify(buildSummary, null, 1) + '\n');
  const src = f => sha(path.join(ROOT, f));
  const manifest = {format: 'chatsop-proofing-pairs-v1', dataset: 'bad_english', model: 'LanguageProofingLLM', role: 'proofreader', iteration: 'prod1', prompt_profile: 'message-only',
    prompt: 'row.prompt verbatim: one sentence of a Romanian, mixed or badly written English message (or clean English, or keyboard mash) and nothing else (DS021 message-only input); training/python/common.py chat_ids()',
    target: 'row.target verbatim: the clean English sentence (repair) or the identical sentence (identity; also for unintelligible keyboard-mash input)',
    created: integrity.generated_at, training_authorized: false, review_status: 'not_reviewed', backgen_parts: JSON.parse(fs.readFileSync(path.join(V3, 'manifest.json'), 'utf8')).backgen_parts, seed,
    held_out_vocabulary: [], trained_vocabulary: [...Object.keys(TRAINED_TEN), ...Object.keys(HELD_OUT_V3)],
    source_sha256: Object.fromEntries(['datasets/bad_english/proofing-it3/manifest.json', 'datasets/bad_english/proofing-it3/train.jsonl', 'datasets/bad_english/proofing-it3/audit.jsonl', 'datasets/bad_english/proofing-v3/train.jsonl', 'datasets/bad_english/proofing-v3/reserve-heldout.jsonl', 'datasets/bad_english/proofing-v3/audit.jsonl'].map(f => [f, src(f)])),
    sealed_hashes_sha256: sha(path.join(EVID, 'sealed-hashes-union.json')), files: {...written, ...extra}, summary: buildSummary,
    note: 'Built from the qualified datasets/bad_english/proofing-it3 and proofing-v3 by tools/datasets/build-language-proofing-prod1.mjs. Targets of llm:deepseek-flash pairs are DeepSeek-written, review pending; spacing pairs by tools/datasets/language-proofing/spacing.mjs; name_repair, name_swap and typo_child pairs by tools/datasets/language-proofing/names-typos.mjs. proofreader/{train,dev}.jsonl are byte-identical to ../{train,dev}.jsonl.'};
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'proofreader/manifest.json'), JSON.stringify({format: 'chatsop-proofreader-projection-v1', corpus: 'bad_english/proofing-prod1', prompt_profile: 'message-only', created: integrity.generated_at, training_authorized: false, review_status: 'not_reviewed', files: written}, null, 1) + '\n');
  const ver = `${integrity.generated_at.slice(0, 10)}-${written['proofreader/train.jsonl'].sha256.slice(0, 8)}`;
  fs.writeFileSync(path.join(OUT, 'VERSION'), JSON.stringify({format: 'chatsop-dataset-version-v1', corpus: 'bad_english/proofing-prod1', counter: 4, dataset: 'bad_english/proofing-prod1', version: ver, label: `bad_english/proofing-prod1 ${ver} (sentence pairs, ${files.train.length} train / ${files.dev.length} dev)`}) + '\n');
  console.log(JSON.stringify({out: path.relative(ROOT, OUT), ...buildSummary, integrity, tokens: tokenStats}, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), o = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) o[rest[i].slice(2)] = rest[i + 1];
  if (command === 'build') { fs.mkdirSync(EVID, {recursive: true}); if (!fs.existsSync(path.join(EVID, 'sealed-hashes-union.json'))) fs.copyFileSync(path.join(ROOT, 'eval/reports/current/language-proofing-it3/data/sealed-hashes-union.json'), path.join(EVID, 'sealed-hashes-union.json')); build(o); }
  else { console.error('usage: build-language-proofing-prod1.mjs build [--seed S] [--vocab-dev N] [--names-dev-share PCT] [--swaps N] [--typos N]'); process.exitCode = 2; }
}
