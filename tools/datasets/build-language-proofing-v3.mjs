#!/usr/bin/env node
/** Builder of datasets/bad_english/proofing-it3 (LanguageProofingLLM iteration 3, role `proofreader`, experiment train-language-proofing-gemma270m-it3).
 * Input: the qualified, judged datasets/bad_english/proofing-v3 (train 61,693 pairs; its dev files are kept byte-identical to proofing-v2, so results stay comparable).
 * Changes, all deterministic and recorded in the audit file and the manifest:
 *  1. the reserve of held-out-vocabulary pairs (cousin, niece, uncle, tenant, supervisor, tutor, owe, adopt, audit, boatyard) goes INTO train, except pairs whose source
 *     row or target text also feeds `dev-heldout` (that file stays as the "trained-vocabulary dev": same words, different source sentences);
 *  2. eight NEW words (nephew, landlord, contractor, postpone, reject, bakery, warehouse, pharmacy) are removed from train (every pair whose prompt or target contains one, copies
 *     included) and become `dev-heldout-v3` (repair pairs) and `dev-heldout-v3-identity` (clean sentences that contain them);
 *  3. spacing and doubled punctuation: identity pairs whose prompt has a spacing defect become repair pairs (target = normalized prompt), repair pairs whose TARGET has a defect are
 *     dropped, and deterministic perturbations of clean identity sentences are added (tools/datasets/language-proofing/spacing.mjs); `dev-spacing` holds perturbations of dev sentences.
 *  4. every added or kept text is checked against the sealed hashes (union of the iteration-2 file and a fresh scan) and the dev sets.
 *
 *   node tools/datasets/build-language-proofing-v3.mjs build [--spacing 1800] [--seed 20261001] [--cap-heldout 110]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {hashText, countBy} from './language-proofing/pairs.mjs';
import {gateClean} from './language-proofing/backgen-v2.mjs';
import {normalizeSpacing, hasSpacingDefect, perturb} from './language-proofing/spacing.mjs';
import {TRAINED_TEN, HELD_OUT_V3, anyMatch, matchesAny} from './language-proofing/vocab-it3.mjs';

const SRC = path.join(ROOT, 'datasets/bad_english/proofing-v3'), OUT = path.join(ROOT, 'datasets/bad_english/proofing-it3');
const EVID = path.join(ROOT, 'eval/reports/current/language-proofing-it3/data');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const body = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
const rowOf = id => id.replace(/#\d+(~dup\d+)?$/, '').split('::new:')[0].split('::same:')[0];
const order = (rows, salt) => rows.slice().sort((a, b) => hashText(`${salt}${a.id}`).localeCompare(hashText(`${salt}${b.id}`)));
const OPSETS = [['space-before-final'], ['space-before-final'], ['space-before-comma'], ['no-space-after-comma'], ['double-space'], ['double-final'], ['double-comma'], ['space-before-final', 'double-space'], ['space-before-comma', 'space-before-final'], ['no-space-after-comma', 'double-final']];

export function build(o = {}) {
  const seed = Number(o.seed ?? 20261001), nSpacing = Number(o.spacing ?? 1800), capHeld = Number(o['cap-heldout'] ?? 110);
  const train0 = readJsonl(path.join(SRC, 'train.jsonl')), dev = readJsonl(path.join(SRC, 'dev.jsonl')), devBg = readJsonl(path.join(SRC, 'dev-backgen.jsonl'));
  const devHeld = readJsonl(path.join(SRC, 'dev-heldout.jsonl')), reserve = readJsonl(path.join(SRC, 'reserve-heldout.jsonl')), mashEval = readJsonl(path.join(SRC, 'mash-eval.jsonl'));
  const audit0 = new Map(readJsonl(path.join(SRC, 'audit.jsonl')).map(a => [a.id, a]));
  // sealed hashes: union of the iteration-2 scan and a fresh scan of eval/suites (the suites changed since)
  const s2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/reports/current/language-proofing-it2/sealed-hashes.json'), 'utf8')), s3 = JSON.parse(fs.readFileSync(path.join(EVID, 'sealed-hashes.json'), 'utf8'));
  const sealed = {hashes: new Set([...s2.hashes, ...s3.hashes]), signatures: new Set([...s2.signatures, ...s3.signatures])};
  fs.writeFileSync(path.join(EVID, 'sealed-hashes-union.json'), JSON.stringify({generated_at: new Date().toISOString(), note: 'union of language-proofing-it2/sealed-hashes.json and the fresh scan data/sealed-hashes.json', files: s3.files, hashes: [...sealed.hashes].sort(), signatures: [...sealed.signatures].sort()}) + '\n');
  const stats = {train_v3: train0.length};
  const audit = new Map(audit0);
  const isMash = r => r.language_kind === 'mash';

  // 2. the new held-out words leave train
  const removed = [], kept = [];
  for (const r of train0) (matchesAny(HELD_OUT_V3, r.prompt, r.target) ? removed : kept).push(r);
  stats.removed_new_heldout = removed.length;
  stats.removed_by_word = countBy(removed, r => anyMatch(HELD_OUT_V3, r.target) ?? anyMatch(HELD_OUT_V3, r.prompt));
  // 3a. repair targets with a spacing defect are dropped (the target must be the repaired form)
  const clean = kept.filter(r => !(r.kind === 'repair' && !isMash(r) && hasSpacingDefect(r.target)));
  stats.dropped_repair_target_defect = kept.length - clean.length;
  // 3b. identity pairs with a defect in the prompt become repair pairs
  const train = [];
  let converted = 0;
  for (const r of clean) {
    if (r.kind === 'identity' && !isMash(r) && hasSpacingDefect(r.prompt)) {
      const target = normalizeSpacing(r.prompt), id = `${r.id}::sp`;
      train.push({id, prompt: r.prompt, target, kind: 'repair', language_kind: 'noisy_en', target_source: 'spacing:natural'});
      audit.set(id, {id, source: 'spacing', natural: true, of: r.id}); converted++;
    } else train.push(r);
  }
  stats.identity_converted_to_spacing_repair = converted;
  // devs that must stay unseen
  const devHashes = new Set([...dev, ...devBg, ...devHeld].map(r => hashText(r.prompt)));
  const devTargetHashes = new Set(devHeld.map(r => hashText(r.target)));
  const devHeldRows = new Set(devHeld.map(r => rowOf(r.id)));
  // 1. reserve into train
  const trainPromptHashes = new Set(train.map(r => hashText(r.prompt)));
  const rs = {offered: reserve.length, shared_source_row_with_dev_heldout: 0, target_in_dev_heldout: 0, new_heldout_word: 0, target_defect: 0, duplicate_prompt: 0, prompt_in_dev: 0, sealed: 0, added: 0};
  const addedReserve = [];
  for (const r of reserve) {
    if (devHeldRows.has(rowOf(r.id))) { rs.shared_source_row_with_dev_heldout++; continue; }
    if (devTargetHashes.has(hashText(r.target))) { rs.target_in_dev_heldout++; continue; }
    if (matchesAny(HELD_OUT_V3, r.prompt, r.target)) { rs.new_heldout_word++; continue; }
    if (hasSpacingDefect(r.target)) { rs.target_defect++; continue; }
    const hp = hashText(r.prompt);
    if (trainPromptHashes.has(hp)) { rs.duplicate_prompt++; continue; }
    if (devHashes.has(hp)) { rs.prompt_in_dev++; continue; }
    if (sealed.hashes.has(hp) || sealed.hashes.has(hashText(r.target))) { rs.sealed++; continue; }
    trainPromptHashes.add(hp); addedReserve.push(r); rs.added++;
  }
  train.push(...addedReserve);
  stats.reserve = rs;
  // dev-heldout-v3 (and its identity companion) from the removed pairs: originals only (no oversampled copy), one pair per prompt, capped per word
  const seen = new Set(), byWord = {}, heldV3 = [], heldV3Id = [];
  for (const r of order(removed, 'hv3')) {
    const a = audit0.get(r.id); if (a?.source === 'oversample') continue;
    const hp = hashText(r.prompt); if (seen.has(hp)) continue; seen.add(hp);
    if (isMash(r)) continue;
    const word = anyMatch(HELD_OUT_V3, r.target) ?? anyMatch(HELD_OUT_V3, r.prompt);
    if (r.kind === 'repair') { const k = (byWord[word] ??= {r: 0, i: 0}); if (k.r < capHeld) { k.r++; heldV3.push({...r, heldout_word: word}); } }
    else { const k = (byWord[word] ??= {r: 0, i: 0}); if (k.i < 40) { k.i++; heldV3Id.push({...r, heldout_word: word}); } }
  }
  stats.dev_heldout_v3 = {pairs: heldV3.length, identity: heldV3Id.length, by_word: byWord, by_kind: countBy(heldV3, r => r.language_kind)};
  // 3c. synthetic spacing perturbations of clean identity sentences (train) and of dev identity sentences (dev-spacing)
  const makeSpacing = (pool, n, salt, idPrefix, forbidden) => {
    const out = [], used = new Set();
    for (const r of order(pool, salt)) {
      if (out.length >= n) break;
      if (r.language_kind !== 'clean' || r.kind !== 'identity' || hasSpacingDefect(r.target) || !gateClean(r.target).clean) continue;
      const ops = OPSETS[parseInt(hashText(`${salt}${r.id}`).slice(0, 6), 16) % OPSETS.length];
      let prompt = perturb(r.target, ops, seed);
      let used_ops = ops;
      if (prompt === null) { for (const alt of OPSETS) { prompt = perturb(r.target, alt, seed); if (prompt !== null) { used_ops = alt; break; } } }
      if (prompt === null) continue;
      const key = hashText(r.target); if (used.has(key) || forbidden(r.target)) continue; used.add(key);
      const id = `${idPrefix}::${hashText(r.target)}`;
      out.push({row: {id, prompt, target: r.target, kind: 'repair', language_kind: 'noisy_en', target_source: 'spacing:perturb'}, audit: {id, source: 'spacing', natural: false, ops: used_ops, seed, of: r.id}});
    }
    return out;
  };
  const trainIdentity = train.filter(r => r.kind === 'identity');
  const synth = makeSpacing(trainIdentity, nSpacing, 'spt', 'sp3', t => sealed.hashes.has(hashText(t)) || devHashes.has(hashText(t)));
  for (const s of synth) { train.push(s.row); audit.set(s.row.id, s.audit); }
  const devIdentity = dev.filter(r => r.kind === 'identity');
  const devSpacing = makeSpacing(devIdentity, 240, 'spd', 'spd3', t => sealed.hashes.has(hashText(t)));
  for (const s of devSpacing) audit.set(s.row.id, s.audit);
  stats.spacing = {synthetic_train: synth.length, dev_spacing: devSpacing.length, ops_train: countBy(synth, s => s.audit.ops.join('+'))};
  // reserve rows keep their audit records; heldout-v3 rows keep theirs (copied from v3); dev-spacing gets its own
  // order: keep the v3 order, new pairs appended in hash order (the trainer shuffles with its fixed seed)
  // sealed / dev leakage of the whole new train
  let sealedExact = 0, devOverlap = 0;
  const devAll = new Set([...dev, ...devBg, ...devHeld, ...heldV3, ...heldV3Id, ...devSpacing.map(s => s.row)].map(r => hashText(r.prompt)));
  for (const r of train) { if (isMash(r)) continue; if (r.target_source?.startsWith('spacing')) { /* its folded text is a train identity sentence that passed the checks */ } if (sealed.hashes.has(hashText(r.prompt)) || sealed.hashes.has(hashText(r.target))) sealedExact++; if (devAll.has(hashText(r.prompt))) devOverlap++; }
  stats.sealed_exact_in_train = sealedExact; stats.train_prompts_in_dev_sets = devOverlap;
  // drop train rows that match sealed texts or any dev prompt (counted)
  const filtered = train.filter(r => isMash(r) || !(sealed.hashes.has(hashText(r.prompt)) || sealed.hashes.has(hashText(r.target)) || devAll.has(hashText(r.prompt))));
  stats.dropped_sealed_or_dev = train.length - filtered.length;
  // token lengths
  fs.mkdirSync(path.join(OUT, 'proofreader'), {recursive: true});
  const files = {train: filtered, dev, 'dev-backgen': devBg, 'dev-heldout': devHeld, 'dev-heldout-v3': heldV3, 'dev-heldout-v3-identity': heldV3Id, 'dev-spacing': devSpacing.map(s => s.row), 'mash-eval': mashEval};
  const python = process.env.TRAIN_PYTHON ?? path.join(process.env.HOME, 'nlp-venv/bin/python'), tmp = {}, tokOut = path.join(EVID, '.tmp-tokens.json');
  for (const [name, rows] of Object.entries(files)) { tmp[name] = path.join(EVID, `.tmp-${name}.jsonl`); fs.writeFileSync(tmp[name], body(rows)); }
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
  const w = (rel, rows) => { fs.writeFileSync(path.join(OUT, rel), body(rows)); return {rows: rows.length, sha256: sha(path.join(OUT, rel))}; };
  const written = {'proofreader/train.jsonl': w('proofreader/train.jsonl', files.train), 'proofreader/dev.jsonl': w('proofreader/dev.jsonl', files.dev)};
  fs.writeFileSync(path.join(OUT, 'train.jsonl'), body(files.train)); fs.writeFileSync(path.join(OUT, 'dev.jsonl'), body(files.dev));
  const extra = {};
  for (const name of ['dev-backgen', 'dev-heldout', 'dev-heldout-v3', 'dev-heldout-v3-identity', 'dev-spacing', 'mash-eval']) extra[`${name}.jsonl`] = w(`${name}.jsonl`, files[name]);
  // audit: every row of every file; heldout-v3 rows keep their v3 audit record
  const ids = new Set([...files.train, ...files.dev, ...files['dev-backgen'], ...files['dev-heldout'], ...files['dev-heldout-v3'], ...files['dev-heldout-v3-identity'], ...files['dev-spacing']].map(r => r.id));
  const auditRows = [...ids].map(id => audit.get(id)).filter(Boolean);
  const missing = [...ids].filter(id => !audit.has(id));
  if (missing.length) throw Error(`${missing.length} rows without an audit record, e.g. ${missing[0]}`);
  fs.writeFileSync(path.join(OUT, 'audit.jsonl'), body(auditRows));
  // integrity
  const trainH = new Set(files.train.map(p => hashText(p.prompt))), twice = [], seenIds = new Map();
  for (const [split, rows] of [['train', files.train], ['dev', files.dev]]) for (const p of rows) { if (seenIds.has(p.id)) twice.push(p.id); seenIds.set(p.id, split); }
  const devSets = ['dev', 'dev-backgen', 'dev-heldout', 'dev-heldout-v3', 'dev-heldout-v3-identity', 'dev-spacing'];
  let sealedAll = 0;
  for (const rows of [files.train, ...devSets.map(n => files[n])]) for (const p of rows) { if (isMash(p)) continue; for (const t of [p.prompt, p.target]) if (sealed.hashes.has(hashText(t))) sealedAll++; }
  const newWordsInTrain = files.train.filter(p => matchesAny(HELD_OUT_V3, p.prompt, p.target)).length;
  const trainedWordsInTrain = Object.fromEntries(Object.keys(TRAINED_TEN).map(wd => [wd, files.train.filter(p => TRAINED_TEN[wd].test(p.target)).length]));
  const devHeldTargets = new Set(files['dev-heldout'].map(p => hashText(p.target)));
  const integrity = {generated_at: new Date().toISOString(), pairs: {train: files.train.length, dev: files.dev.length, dev_backgen: files['dev-backgen'].length, dev_heldout_trained_vocabulary: files['dev-heldout'].length, dev_heldout_v3: files['dev-heldout-v3'].length, dev_heldout_v3_identity: files['dev-heldout-v3-identity'].length, dev_spacing: files['dev-spacing'].length, mash_eval: files['mash-eval'].length},
    ids_in_two_splits: twice.length, exact_matches: {train_dev_sets_vs_sealed_texts: sealedAll},
    train_prompts_also_in_dev: devSets.flatMap(n => files[n]).filter(p => trainH.has(hashText(p.prompt))).length,
    heldout_vocabulary_words_in_train: newWordsInTrain, heldout_prompts_in_train: 0,
    trained_vocabulary_words_in_train_targets: trainedWordsInTrain, train_targets_equal_to_dev_heldout_targets: files.train.filter(p => devHeldTargets.has(hashText(p.target)) && p.kind === 'repair').length,
    note: 'exact matches after case, diacritic, punctuation and spacing folding against data/sealed-hashes-union.json; heldout_vocabulary_words_in_train counts train pairs that contain one of the NEW held-out words (nephew, landlord, contractor, postpone, reject, bakery, warehouse, pharmacy); the ten earlier held-out words are in train on purpose (trained_vocabulary_words_in_train_targets)'};
  const tokenAudit = {generated_at: integrity.generated_at, tokenizer: 'Gemma 3 (models/gemma/bases/99073d6b..., chat template of training/python/common.py chat_ids)', over_2048: 0, dropped_over_2048: over, ...tokenStats};
  fs.writeFileSync(path.join(EVID, 'integrity.json'), JSON.stringify(integrity, null, 1) + '\n');
  fs.writeFileSync(path.join(EVID, 'token-audit.json'), JSON.stringify(tokenAudit, null, 1) + '\n');
  const mix = rows => ({pairs: rows.length, by_pair: countBy(rows, p => p.kind), by_kind: countBy(rows, p => p.language_kind), by_target_source: countBy(rows, p => p.target_source)});
  const buildSummary = {...stats, train: mix(files.train), dev: mix(files.dev), held_out_v3: Object.keys(HELD_OUT_V3), trained_ten: Object.keys(TRAINED_TEN)};
  buildSummary.identity_share_train = Math.round(1000 * files.train.filter(p => p.kind === 'identity').length / files.train.length) / 10;
  fs.writeFileSync(path.join(EVID, 'build-summary.json'), JSON.stringify(buildSummary, null, 1) + '\n');
  const src = f => sha(path.join(ROOT, f));
  const manifest = {format: 'chatsop-proofing-pairs-v1', dataset: 'bad_english', model: 'LanguageProofingLLM', role: 'proofreader', iteration: 3, prompt_profile: 'message-only',
    prompt: 'row.prompt verbatim: one sentence of a Romanian, mixed or badly written English message (or clean English, or keyboard mash) and nothing else (DS021 message-only input); training/python/common.py chat_ids()',
    target: 'row.target verbatim: the clean English sentence (repair) or the identical sentence (identity; also for unintelligible keyboard-mash input)',
    created: integrity.generated_at, training_authorized: false, review_status: 'not_reviewed', backgen_parts: JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).backgen_parts, seed,
    held_out_vocabulary: Object.keys(HELD_OUT_V3), trained_vocabulary: Object.keys(TRAINED_TEN),
    source_sha256: {'datasets/bad_english/proofing-v3/manifest.json': src('datasets/bad_english/proofing-v3/manifest.json'), 'datasets/bad_english/proofing-v3/train.jsonl': src('datasets/bad_english/proofing-v3/train.jsonl'), 'datasets/bad_english/proofing-v3/reserve-heldout.jsonl': src('datasets/bad_english/proofing-v3/reserve-heldout.jsonl'), 'datasets/bad_english/proofing-v3/audit.jsonl': src('datasets/bad_english/proofing-v3/audit.jsonl'), 'datasets/bad_english/proofing-v3/dev.jsonl': src('datasets/bad_english/proofing-v3/dev.jsonl'), 'datasets/bad_english/proofing-v3/dev-backgen.jsonl': src('datasets/bad_english/proofing-v3/dev-backgen.jsonl'), 'datasets/bad_english/proofing-v3/dev-heldout.jsonl': src('datasets/bad_english/proofing-v3/dev-heldout.jsonl'), 'datasets/bad_english/proofing-v3/mash-eval.jsonl': src('datasets/bad_english/proofing-v3/mash-eval.jsonl')},
    sealed_hashes_sha256: sha(path.join(EVID, 'sealed-hashes-union.json')), files: {...written, ...extra}, summary: buildSummary,
    note: 'Built from the qualified datasets/bad_english/proofing-v3 by tools/datasets/build-language-proofing-v3.mjs. Targets of llm:deepseek-flash pairs are DeepSeek-written, review pending; spacing pairs are produced by tools/datasets/language-proofing/spacing.mjs. proofreader/{train,dev}.jsonl are byte-identical to ../{train,dev}.jsonl.'};
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'proofreader/manifest.json'), JSON.stringify({format: 'chatsop-proofreader-projection-v1', corpus: 'bad_english/proofing-it3', prompt_profile: 'message-only', created: integrity.generated_at, training_authorized: false, review_status: 'not_reviewed', files: written}, null, 1) + '\n');
  const ver = `${integrity.generated_at.slice(0, 10)}-${written['proofreader/train.jsonl'].sha256.slice(0, 8)}`;
  fs.writeFileSync(path.join(OUT, 'VERSION'), JSON.stringify({format: 'chatsop-dataset-version-v1', corpus: 'bad_english/proofing-it3', counter: 3, dataset: 'bad_english/proofing-it3', version: ver, label: `bad_english/proofing-it3 ${ver} (sentence pairs, ${files.train.length} train / ${files.dev.length} dev)`}) + '\n');
  console.log(JSON.stringify({out: path.relative(ROOT, OUT), ...buildSummary, integrity, tokens: tokenStats}, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), o = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) o[rest[i].slice(2)] = rest[i + 1];
  if (command === 'build') build(o); else { console.error('usage: build-language-proofing-v3.mjs build [--spacing N] [--seed S] [--cap-heldout N]'); process.exitCode = 2; }
}
