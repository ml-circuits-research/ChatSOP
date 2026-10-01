#!/usr/bin/env node
/** Dataset qualification record and authorization receipt for LanguageProofingLLM iteration 2 (bad_english/proofing-v2, frozen role id `proofreader`).
 * Sibling of tools/research/qualify-language-proofing.mjs (same record schema, training/cli.mjs `qualificationSchema` for role `proofreader`), every
 * check recomputed from the files on disk, written only when every check holds (fail closed).
 *
 *   node tools/research/qualify-language-proofing-v2.mjs [--reviewer-id ID]
 *   node tools/research/qualify-language-proofing-v2.mjs --authorize gemma --run RUN --decision-ts TS
 *
 * Checks:
 *   oracle_grounding      every pair is reproduced from its source: it1 pairs from datasets/bad_english/proofing-it2-projection/proofreader, back-generated pairs from the
 *                         DeepSeek output lines of the recorded parts (entriesOf/pairsOfEntry of tools/datasets/language-proofing/backgen-v2.mjs), identity pairs
 *                         are gate-clean sentences (prompt equals target), keyboard-mash pairs are gate-unclean (prompt equals target), oversampled copies equal their original
 *   meaning_preservation  mechanical checks (names, numbers, quotes, negation, question marks, length ratio) hold for every repair pair and every back-generated pair
 *                         carries its recorded two-vote meaning-judge verdict (noisy_en: both yes; ro and mixed: not both no)
 *   leakage               no folded exact match of a train/dev/dev-set prompt or target with any sealed text (integrity.json)
 *   split_integrity       an id is in one split only; no train prompt equals a dev prompt; no held-out vocabulary word in train
 *   source_rights         DS014 records DeepSeek-written text
 *   token_budget          no pair above 2048 tokens with the Gemma 3 tokenizer
 * The record is not a training authorization (AGENTS.md rule 3).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJournal} from '../../lib/journal.mjs';
import {pairProblems, hashText, norm} from '../datasets/language-proofing/pairs.mjs';
import {entriesOf, pairsOfEntry, pairProblemsV2, gateClean, harmonize} from '../datasets/language-proofing/backgen-v2.mjs';
import {familyPairs} from '../datasets/language-proofing/family-templates.mjs';
import {normalizeSpacing, perturb} from '../datasets/language-proofing/spacing.mjs';
import {repairNameTarget, swapName, typoChild, instNames} from '../datasets/language-proofing/names-typos.mjs';
import {WORK, USED, JUDGE} from '../datasets/build-language-proofing-v2.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = file => path.relative(root, file).split(path.sep).join('/');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
// iteration 2 by default; the unused iteration-3 data (datasets/bad_english/proofing-v3) is qualified with LP_DATA, LP_EVIDENCE, LP_CAND, LP_QUAL and LP_CORPUS set
const DATA = path.resolve(root, process.env.LP_DATA ?? 'datasets/bad_english/proofing-v2');
const QUAL = path.resolve(root, process.env.LP_QUAL ?? 'status/training/qualification-language-proofing-it2.json');
const EVID = path.resolve(root, process.env.LP_EVIDENCE ?? path.relative(root, WORK));
const CAND = process.env.LP_CAND ?? 'candidates.jsonl';
const CORPUS = process.env.LP_CORPUS ?? 'bad_english/proofing-v2';
// iteration 3 (datasets/bad_english/proofing-it3) additionally sets LP_EXTRA (the extra dev files whose rows carry audit records) and LP_SEALED (the sealed-hash union its builder wrote)
const EXTRA = (process.env.LP_EXTRA ?? 'dev-backgen,dev-heldout').split(',');
const SEALED = path.resolve(root, process.env.LP_SEALED ?? path.join(WORK, 'sealed-hashes.json'));

export function qualify({reviewerId = 'language-proofing-it2-agent (automated qualification)'} = {}) {
  const blockers = [];
  const manifestPath = path.join(DATA, 'manifest.json'), versionPath = path.join(DATA, 'VERSION');
  const manifest = readJson(manifestPath);
  const audit = new Map(readJsonl(path.join(DATA, 'audit.jsonl')).map(a => [a.id, a]));
  const flat = ['train', 'dev'].flatMap(split => readJsonl(path.join(DATA, `${split}.jsonl`)).map(row => ({...row, split})));
  const extra = EXTRA.flatMap(name => readJsonl(path.join(DATA, `${name}.jsonl`)).map(row => ({...row, split: name})));
  // regenerate the back-generated pairs from the DeepSeek output of the recorded parts
  const sealedJ = readJson(SEALED), sealed = {hashes: new Set(sealedJ.hashes), signatures: new Set(sealedJ.signatures)};
  const regenerated = new Map(), regeneratedPrompts = new Set(), regeneratedFolded = new Set();
  for (const part of manifest.backgen_parts) {
    const inputs = readJsonl(path.join(USED, 'input', `part-${part}.jsonl`)), lines = readJsonl(path.join(USED, 'output', `part-${part}.jsonl`));
    lines.forEach((line, i) => {
      for (const entry of entriesOf(line, inputs[i].message, sealed, {null_rows: 0})) for (const p of pairsOfEntry(entry, {})) { regenerated.set(`${p.prompt}\u0000${harmonize(p.prompt, p.target)}\u0000${entry.lang}`, true); regeneratedPrompts.add(p.prompt); if (hashText(p.prompt) === hashText(p.target)) regeneratedFolded.add(hashText(p.prompt)); }
    });
  }
  const it1 = new Map([...readJsonl(path.join(root, 'datasets/bad_english/proofing-it2-projection/proofreader/train.jsonl')), ...readJsonl(path.join(root, 'datasets/bad_english/proofing-it2-projection/proofreader/dev.jsonl'))].map(r => [r.id, r]));
  const byId = new Map([...flat, ...extra].map(r => [r.id, r]));
  const templates = new Set(familyPairs({seed: manifest.seed}).map(p => `${p.prompt}\u0000${harmonize(p.prompt, p.target) ?? p.target}`));
  let ungrounded = 0, mechanical = 0, unjudged = 0;
  const reasons = {};
  const bad = (k) => { reasons[k] = (reasons[k] ?? 0) + 1; };
  const verdicts = new Map();
  for (const r of readJsonl(path.join(JUDGE, 'output/verdicts.jsonl'))) verdicts.set(`${r.id}|${r.condition}`, r.answer?.preserves);
  const cands = new Map(readJsonl(path.join(WORK, CAND)).map(c => [`${c.row_id}::${c.src}:${c.lang}`, c]));
  // one row against its audit record; `name_repair` pairs are checked twice (the repair, then the original pair)
  const groundRow = (row, a) => {
    if (!a) { ungrounded++; bad('no audit record'); return; }
    if (a.source === 'it1') {
      const o = it1.get(row.id);
      if (row.kind === 'identity' && row.target_source === 'identity:gate-clean-noisy') {
        if (!o || o.prompt !== row.prompt || row.prompt !== row.target || !gateClean(row.prompt).clean || hashText(o.prompt) !== hashText(o.target)) { ungrounded++; bad('it1 gate-clean noisy pair not identity'); }
        return;
      }
      if (!o || o.prompt !== row.prompt || (row.kind === 'repair' ? harmonize(o.prompt, o.target) !== row.target : o.target !== row.target)) { ungrounded++; bad('it1 pair differs'); }
      if (row.kind === 'repair' && pairProblems(row.prompt, row.target).length) { mechanical++; bad('it1 mechanical'); }
    } else if (a.source === 'backgen' && a.converted_to_identity) {
      if (!regeneratedPrompts.has(row.prompt) || row.prompt !== row.target || !gateClean(row.prompt).clean || !regeneratedFolded.has(hashText(row.prompt))) { ungrounded++; bad('backgen gate-clean noisy pair not identity'); }
    } else if (a.source === 'backgen') {
      const lang = row.language_kind;
      if (!regenerated.has(`${row.prompt}\u0000${row.target}\u0000${lang}`)) { ungrounded++; bad('backgen pair not reproduced'); }
      if (pairProblemsV2(row.prompt, row.target).length) { mechanical++; bad('backgen mechanical'); }
      const cand = cands.get(row.id.replace(/#\d+$/, ''));
      const m1 = cand ? verdicts.get(`${cand.judge_id}|m1`) : undefined, m2 = cand ? verdicts.get(`${cand.judge_id}|m2`) : undefined;
      if (m1 === undefined || m2 === undefined) { unjudged++; bad('no judge verdict'); }
      else if (lang === 'noisy_en' ? !(m1 === 'yes' && m2 === 'yes') : (m1 !== 'yes' && m2 !== 'yes')) { unjudged++; bad('judge rule violated'); }
    } else if (a.source === 'identity') {
      if (row.prompt !== row.target || !gateClean(row.prompt).clean) { ungrounded++; bad('identity not gate-clean'); }
    } else if (a.source === 'mash') {
      if (row.prompt !== row.target || gateClean(row.prompt).clean) { ungrounded++; bad('mash is gate-clean'); }
    } else if (a.source === 'template') {
      if (!templates.has(`${row.prompt}\u0000${row.target}`)) { ungrounded++; bad('template pair not reproduced'); }
      if (pairProblems(row.prompt, row.target).length) { mechanical++; bad('template mechanical'); }
    } else if (a.source === 'spacing') {
      // iteration 3: the target is the mechanical spacing normalization of the prompt; a synthetic prompt is reproduced from its clean target and recorded operations
      if (row.kind !== 'repair' || row.prompt === row.target || normalizeSpacing(row.prompt) !== row.target || !gateClean(row.target).clean) { ungrounded++; bad('spacing pair not a normalization'); }
      else if (!a.natural && perturb(row.target, a.ops, a.seed) !== row.prompt) { ungrounded++; bad('spacing perturbation not reproduced'); }
    } else if (a.source === 'name_repair') {
      // production build 1: the target of the original pair lost the connector of an institution name only; the repair restores it
      if (repairNameTarget(row.prompt, a.original_target) !== row.target || pairProblems(row.prompt, row.target).length) { ungrounded++; bad('name repair not reproduced'); }
      else groundRow({...row, target: a.original_target}, a.original);
    } else if (a.source === 'name_swap') {
      const o = byId.get(a.of), sw = o && swapName(o.prompt, o.target, a.from, a.to);
      if (!o || !sw || sw.prompt !== row.prompt || sw.target !== row.target || !instNames(row.prompt).includes(a.to) || pairProblems(row.prompt, row.target).length) { ungrounded++; bad('name swap not reproduced'); }
    } else if (a.source === 'typo_child') {
      const o = byId.get(a.of);
      if (!o || typoChild(o.prompt, {occ: a.occ, op: a.op, seed: a.seed}) !== row.prompt || o.target !== row.target || pairProblems(row.prompt, row.target).length) { ungrounded++; bad('typo child not reproduced'); }
    } else if (a.source === 'oversample') {
      const o = byId.get(a.of);
      if (!o || o.prompt !== row.prompt || o.target !== row.target) { ungrounded++; bad('oversample differs'); }
    } else { ungrounded++; bad(`unknown source ${a.source}`); }
    };
  for (const row of [...flat, ...extra]) groundRow(row, audit.get(row.id));
  if (ungrounded) blockers.push(`${ungrounded} pairs are not reproduced from their source (${JSON.stringify(reasons)})`);
  if (mechanical) blockers.push(`${mechanical} repair pairs fail the mechanical meaning checks`);
  if (unjudged) blockers.push(`${unjudged} back-generated pairs lack a passing meaning-judge verdict`);
  const bySource = {};
  for (const a of audit.values()) bySource[a.source] = (bySource[a.source] ?? 0) + 1;
  fs.mkdirSync(EVID, {recursive: true});
  const meaning = {generated_at: new Date().toISOString(), pairs: flat.length, sets_checked: ['train', 'dev', ...EXTRA], mechanical_failures: mechanical, judge_violations: unjudged, pairs_by_source: bySource, judge_folder: rel(JUDGE),
    note: 'noisy_en back-generated pairs need both judge votes (m1 AND m2); ro and mixed pairs are dropped only when both votes say no (the judge is calibrated on English originals only); it1 pairs keep the it1 checks (mechanical only, DeepSeek targets pending review)'};
  fs.writeFileSync(path.join(EVID, 'meaning-v2.json'), JSON.stringify(meaning, null, 1) + '\n');
  fs.writeFileSync(path.join(EVID, 'grounding-v2.json'), JSON.stringify({generated_at: meaning.generated_at, pairs: flat.length + extra.length, ungrounded, regenerated_backgen_pairs: regenerated.size, reasons}, null, 1) + '\n');
  const integrity = readJson(path.join(EVID, 'integrity.json'));
  if (Object.values(integrity.exact_matches).some(n => n !== 0)) blockers.push('integrity.json reports an exact match with a sealed text');
  if (integrity.ids_in_two_splits || integrity.train_prompts_also_in_dev || integrity.heldout_vocabulary_words_in_train || integrity.heldout_prompts_in_train) blockers.push('integrity.json reports a split or held-out violation');
  if (sha(SEALED) !== manifest.sealed_hashes_sha256) blockers.push('sealed-hashes.json changed after the dataset was built');
  const rights = fs.readFileSync(path.join(root, 'docs/specs/DS014-source-rights.md'), 'utf8');
  if (!/deepseek/i.test(rights)) blockers.push('DS014-source-rights.md does not mention DeepSeek-written text');
  const tokens = readJson(path.join(EVID, 'token-audit.json'));
  if (tokens.over_2048 !== 0) blockers.push(`${tokens.over_2048} pairs above 2048 tokens`);
  for (const [name, info] of Object.entries(manifest.files)) if (sha(path.join(DATA, name)) !== info.sha256) blockers.push(`${name} changed after the manifest was written`);
  if (blockers.length) return {status: 'blocked', blockers};
  const ev = file => ({path: rel(file), sha256: sha(file)});
  const record = {
    format: 'chatsop-dataset-qualification-v1', status: 'qualified', corpus: CORPUS, role: 'proofreader',
    grade: 'experiment-grade: sentence pairs reproduced from the it1 projection, the DeepSeek back-generation output or mechanical generators; mechanical meaning checks, the calibrated two-vote meaning judge for back-generated pairs, sentence-level leakage checks against every sealed text; DeepSeek-written targets are unreviewed (pending), no human semantic review',
    dataset_manifest_sha256: sha(manifestPath), dataset_version_sha256: sha(versionPath), dataset_version: readJson(versionPath),
    dataset_files: {'proofreader/train.jsonl': sha(path.join(DATA, 'proofreader/train.jsonl')), 'proofreader/dev.jsonl': sha(path.join(DATA, 'proofreader/dev.jsonl'))},
    sealed_suites: {'bad_english/proofing-test': sha(path.join(root, 'eval/suites/bad_english/proofing-test.jsonl'))},
    contract_files: {},
    checks: Object.fromEntries(['oracle_grounding', 'meaning_preservation', 'leakage', 'split_integrity', 'source_rights', 'token_budget'].map(name => [name, true])),
    evidence: {oracle_grounding: ev(path.join(EVID, 'grounding-v2.json')), meaning_preservation: ev(path.join(EVID, 'meaning-v2.json')), leakage: ev(path.join(EVID, 'integrity.json')),
      split_integrity: ev(path.join(EVID, 'integrity.json')), source_rights: ev(path.join(root, 'docs/specs/DS014-source-rights.md')), token_budget: ev(path.join(EVID, 'token-audit.json'))},
    reviewer: {kind: 'principal_integrator', id: reviewerId, reviewed_at: new Date().toISOString()},
    blockers: [], note: 'Data qualification only; not a chatsop-training-authorization-v1 receipt (AGENTS.md rule 3).',
  };
  fs.writeFileSync(QUAL, JSON.stringify(record, null, 1) + '\n');
  return {status: 'qualified', qualification: rel(QUAL), sha256: sha(QUAL)};
}

/** One chatsop-training-authorization-v1 receipt transcribing owner decisions that already exist in the journal (fails when no matching decision event or scope file exists). */
export function authorize({model, run, decisionTs, scopeFile = process.env.LP_SCOPE ?? 'status/training/owner-approval-language-proofing-it2.json'}) {
  const qualification = readJson(QUAL);
  if (qualification.status !== 'qualified') throw Error('The dataset qualification record is not qualified');
  const decision = readJournal().find(event => event.ts === decisionTs && event.area === 'training' && event.state === 'decision');
  if (!decision) throw Error(`No training decision event at ${decisionTs} in status/journal.jsonl`);
  const scope = readJson(path.join(root, scopeFile));
  if (scope.journal_event.ts !== decision.ts) throw Error('The approval scope does not match this decision');
  for (const d of scope.further_decisions ?? []) if (!readJournal().some(e => e.ts === d.ts && e.actor === d.actor)) throw Error(`further decision ${d.ts} is not in the journal`);
  if (!scope.approved_models.includes(model)) throw Error(`${model} is outside the owner's approved models for this experiment`);
  const receipt = {
    format: 'chatsop-training-authorization-v1', authorization: 'explicit-user-approval', approved: true, approved_by: 'user',
    approved_at: decision.ts, instruction: `${decision.title}: ${decision.detail}`,
    journal_event: {file: 'status/journal.jsonl', ts: decision.ts, actor: decision.actor},
    further_decisions: scope.further_decisions ?? [],
    model, run, role: 'proofreader', qualification_sha256: sha(QUAL),
    recipe_sha256: sha(path.join(root, process.env.LP_RECIPE ?? path.join('config', `train-${model}.json`))),
    dataset_manifest_sha256: qualification.dataset_manifest_sha256, dataset_version_sha256: qualification.dataset_version_sha256,
    transcribed_by: process.env.CHATSOP_ACTOR || 'language-proofing-it2-agent', transcribed_at: new Date().toISOString(),
  };
  const out = path.join(root, 'status/training', `authorization-${model}-${run}.json`);
  fs.writeFileSync(out, JSON.stringify(receipt, null, 1) + '\n');
  return {authorization: rel(out), sha256: sha(out)};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    if (arg('--authorize')) console.log(JSON.stringify(authorize({model: arg('--authorize'), run: arg('--run'), decisionTs: arg('--decision-ts')}), null, 1));
    else { const r = qualify({reviewerId: arg('--reviewer-id')}); console.log(JSON.stringify(r, null, 1)); if (r.status !== 'qualified') process.exitCode = 2; }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
