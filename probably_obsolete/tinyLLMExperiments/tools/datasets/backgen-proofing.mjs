#!/usr/bin/env node
/** Filter of the back-generated pairs into an additional SymbolicProofingLLM pair source
 * (datasets/neuro_english/proofing-backgen/{train,dev}.jsonl, flat format of datasets/neuro_english/proofing/proofreader/).
 *
 * DeepSeek (omp task datasets_sources/symbolic_backgen/) wrote 2 complex paraphrases for each symbolic_english train/dev
 * message. The pair is (paraphrase -> original message); the original is analysed correctly by SymbolicLM. A pair is kept when
 *   (a) mechanical checks hold: names, numbers, quotes, negation and question marks of the original are in the paraphrase, the
 *       length ratio is sane, the paraphrase is English (clean-English gate, language test), it is not a sealed text or a duplicate;
 *   (b) the meaning judge says yes (DeepSeek m1 of experiment eval-meaning-judge-calibration-v1; with `--two-vote` also m2),
 *       or the pair is marked unverified when the judge is not usable;
 *   (c) classification by the calibrated parse gate on the PARAPHRASE: default and accurate trees identical AND the DeepSeek parse
 *       judge conditions a and c good on the accurate tree. Gate passed: the paraphrase is also fine as it is, an IDENTITY example
 *       (a new form for symbolic_english). Gate failed: a REPAIR pair.
 * Splits are the splits of the source rows (train stays train, dev stays dev). Nothing here opens a sealed file: sealed texts
 * are known by their hashes (eval/reports/current/{three-datasets,neuro-oracle}/sealed*.json).
 *
 *   node tools/datasets/backgen-proofing.mjs collect                # mechanical checks of every complete output part
 *   node tools/datasets/backgen-proofing.mjs meaning-items [--two-vote]   # judge input of datasets_sources/backgen_meaning_judge
 *   node tools/datasets/backgen-proofing.mjs parse                  # Stanza default+accurate parses (GPU, light) and parse-judge input
 *   node tools/datasets/backgen-proofing.mjs build [--meaning-usable true|false] [--two-vote]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT, readJsonl, writeJsonl, writeJson, sha256, ParseStore} from './neuro-oracle/common.mjs';
import {datasetRows} from './neuro-oracle/common.mjs';
import {judgeSentences, sentenceKey, readVerdicts, gateOf, writeParseItems, PARSE_DIR} from './neuro-oracle/judge.mjs';
import {defaultTrees, treeAgreement} from './neuro-oracle/classify.mjs';
import {maskMessage} from '../../lib/ud-to-sop/index.mjs';
import {normalText} from './three-datasets/inputs.mjs';
import {mainForm} from './three-datasets/forms.mjs';
import {classifyRow} from './three-datasets/decomposition.mjs';
import {hasGoldMatch} from './three-datasets/rows.mjs';
import {flat} from './neuro-oracle/pairs.mjs';
import {tokenLengths, countBy, hashText} from './neuro-oracle/build.mjs';
import {cleanEnglishGate} from './clean-english.mjs';
import {loadSpellfix} from '../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {protectedItems, fold} from '../eval/bad-english-targets.mjs';
import {names} from './meaning-judge/perturb.mjs';

const SRC = path.join(ROOT, 'datasets_sources/symbolic_backgen');
const WORK = path.join(ROOT, 'eval/reports/current/backgen');
const MEANING_DIR = path.join(ROOT, 'datasets_sources/backgen_meaning_judge');
const PARSE_JUDGE_DIR = path.join(ROOT, 'datasets_sources/backgen_parse_judge');
const OUT_DIR = path.join(ROOT, 'datasets/neuro_english/proofing-backgen');
const SEALED_FILES = ['eval/reports/current/three-datasets/sealed-text-hashes.json', 'eval/reports/current/neuro-oracle/sealed-hashes.json'];
const args = process.argv.slice(2), cmd = args[0], flag = name => args.includes(`--${name}`);
const opt = name => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const NEGATION = /\b(?:not|never|no|nobody|none|nothing|neither|nor|without|cannot)\b|n't\b/gi;
const count = (text, re) => (text.match(re) ?? []).length;

/** Complete parts: same number of output lines as input lines (the external agent may still be writing the others). */
export function completeParts() {
  const parts = [];
  for (const name of fs.readdirSync(path.join(SRC, 'input')).filter(n => /^part-\d+\.jsonl$/.test(n)).sort()) {
    const out = path.join(SRC, 'output', name);
    if (!fs.existsSync(out)) continue;
    const input = readJsonl(path.join(SRC, 'input', name));
    const lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
    if (lines.length < input.length) continue;
    const rows = [];
    let ok = true;
    for (const line of lines) { try { rows.push(JSON.parse(line)); } catch { ok = false; } }
    if (ok && rows.length === input.length) parts.push({name, input, output: rows});
  }
  return parts;
}

/** Mechanical checks of one pair; returns {ok, failed: [...], clean}. `original` is the source message, `text` the paraphrase. */
export function mechanical(original, text, kind, resources) {
  const failed = [];
  const folded = fold(text);
  for (const item of protectedItems(original)) if (!folded.includes(fold(item))) failed.push(`protected:${item.slice(0, 30)}`);
  for (const n of names(original)) if (!folded.includes(fold(n.text))) failed.push(`name:${n.text.slice(0, 30)}`);
  const no = count(original, NEGATION), nt = count(text, NEGATION);
  if (no > 0 && nt < no) failed.push('negation_lost');
  if (no === 0 && nt > 0) failed.push('negation_added');
  const qo = count(original, /\?/g), qt = count(text, /\?/g);
  // an embedded question ("I was wondering if you could tell me who ...") may end with a full stop: the judge checks the kind there
  if (qt < qo && !(kind === 'embedded_question' && qt === 0)) failed.push('question_mark');
  const ratio = text.length / Math.max(1, original.length);
  if (ratio < 0.6 || ratio > 4.5) failed.push(`length_ratio:${ratio.toFixed(2)}`);
  if (/\n/.test(text) || !text.trim()) failed.push('format');
  if (normalText(text) === normalText(original)) failed.push('equals_original');
  const gate = cleanEnglishGate({question: text, language: 'en'}, resources);
  if (!gate.gates.all_tokens_english) failed.push('not_english');
  return {ok: failed.length === 0, failed, clean: gate.clean};
}

const sealedSet = () => {
  const set = new Set();
  for (const f of SEALED_FILES) { const file = path.join(ROOT, f); if (fs.existsSync(file)) for (const h of JSON.parse(fs.readFileSync(file, 'utf8')).hashes ?? []) set.add(h); }
  return set;
};
const sha = t => crypto.createHash('sha1').update(t).digest('hex');
/** Both hash spellings in use: the neuro oracle's (folded text, 20 hex) and the three-datasets one (16 hex of the folded text). */
const sealedHit = (set, text) => set.has(hashText(text)) || set.has(sha(normalText(text)).slice(0, 16)) || set.has(sha(normalText(text)).slice(0, 20));

const readCandidates = () => (fs.existsSync(path.join(WORK, 'candidates.jsonl')) ? readJsonl(path.join(WORK, 'candidates.jsonl')) : []);

function collect() {
  const rows = new Map(datasetRows('symbolic_english').map(r => [r.id, r]));
  const resources = {spellfix: loadSpellfix(), dictionary: defaultDictionary()};
  const sealed = sealedSet();
  const existing = new Set();
  for (const f of ['datasets/neuro_english/proofing/train.jsonl', 'datasets/neuro_english/proofing/dev.jsonl']) for (const r of readJsonl(path.join(ROOT, f))) existing.add(normalText(r.prompt));
  const parts = completeParts();
  const out = [], seen = new Map(), stats = {parts: parts.map(p => p.name), rows: 0, rows_without_variants: 0, variants: 0, by_reason: {}, source_missing: 0, sealed_hash_size: sealed.size};
  for (const {input, output} of parts) {
    const byId = new Map(input.map(r => [r.id, r.message]));
    for (const row of output) {
      stats.rows++;
      const src = rows.get(row.id);
      if (!src || src.message !== byId.get(row.id)) { stats.source_missing++; continue; }
      if (!row.variants?.length) { stats.rows_without_variants++; continue; }
      row.variants.forEach((v, n) => {
        stats.variants++;
        const text = String(v.text ?? '').trim();
        const m = mechanical(src.message, text, v.kind, resources);
        const failed = [...m.failed];
        const key = normalText(text);
        if (sealedHit(sealed, text)) failed.push('sealed_text');
        if (sealedHit(sealed, src.message)) failed.push('target_sealed_text'); // the original (the repair target) is also a sealed text or target
        if (seen.has(key)) failed.push('duplicate_paraphrase'); else seen.set(key, `${row.id}#${n}`);
        if (existing.has(key)) failed.push('already_in_proofing');
        for (const f of failed) { const k = f.split(':')[0]; stats.by_reason[k] = (stats.by_reason[k] ?? 0) + 1; }
        out.push({cid: `${row.id}#${n}`, id: row.id, n, kind: v.kind ?? null, split: src.split, text, original: src.message, mech_ok: failed.length === 0, failed, clean_gate: m.clean});
      });
    }
  }
  writeJsonl(path.join(WORK, 'candidates.jsonl'), out);
  stats.mech_ok = out.filter(c => c.mech_ok).length;
  stats.by_kind = countBy(out, c => c.kind);
  stats.ok_by_kind = countBy(out.filter(c => c.mech_ok), c => c.kind);
  writeJson(path.join(WORK, 'mechanical.json'), {generated_at: new Date().toISOString(), ...stats});
  console.log(JSON.stringify(stats, null, 1));
}

const userOf = c => `ORIGINAL: ${c.text}\n\nREWRITE: ${c.original}`; // the pair's direction: paraphrase (the input) -> original (the target)

function meaningItems() {
  const conditions = flag('two-vote') ? ['m1', 'm2'] : ['m1'];
  const file = path.join(MEANING_DIR, 'input/items.jsonl');
  const have = new Map(fs.existsSync(file) ? readJsonl(file).map(i => [`${i.id}|${i.condition}`, i]) : []);
  for (const c of readCandidates().filter(c => c.mech_ok)) for (const cond of conditions) if (!have.has(`${c.cid}|${cond}`)) have.set(`${c.cid}|${cond}`, {id: c.cid, condition: cond, user: userOf(c)});
  fs.mkdirSync(path.join(MEANING_DIR, 'input'), {recursive: true});
  writeJsonl(file, [...have.values()]);
  console.log(JSON.stringify({items: have.size, conditions}));
}

const meaningYes = (verdicts, cid, conds) => { const v = conds.map(c => verdicts.get(`${cid}|${c}`)?.preserves); return v.some(x => !x) ? null : v.every(x => x === 'yes'); };

async function parse() {
  const cands = readCandidates().filter(c => c.mech_ok);
  const verdicts = readVerdicts(MEANING_DIR);
  const conds = flag('two-vote') ? ['m1', 'm2'] : ['m1'];
  const todo = cands.filter(c => meaningYes(verdicts, c.cid, conds) === true);
  const texts = [...new Set(todo.map(c => c.text))];
  const {createSymbolicLM} = await import('../../lib/symbolic-lm/index.mjs');
  for (const pkg of ['default', 'accurate']) {
    const store = new ParseStore(pkg, path.join(WORK, 'parses'));
    store.load();
    const need = texts.filter(t => !store.map.has(`en|${maskMessage(t)}`) && !store.map.has(`auto|${maskMessage(t)}`));
    if (!need.length) continue;
    const lm = await createSymbolicLM({device: process.env.CHATSOP_UD_DEVICE ?? 'cuda', package: pkg});
    try {
      for (let i = 0; i < need.length; i += 64) {
        lm.prefetched.clear();
        await lm.prefetch(need.slice(i, i + 64), {language: 'auto', route: 'direct'});
        const entries = [...lm.prefetched].filter(([key]) => !store.map.has(key)).map(([key, value]) => [key, pkg === 'default' ? {sentences: (value.parse.sentences ?? []).map(s => ({text: s.text, words: s.words.map(({id, text, lemma, upos, head, deprel}) => ({id, text, lemma, upos, head, deprel}))}))} : value.parse]);
        if (entries.length) store.append(entries);
        process.stderr.write(`\r${pkg} ${Math.min(i + 64, need.length)}/${need.length}`);
      }
    } finally { await lm.stop(); }
    process.stderr.write('\n');
  }
  const acc = new ParseStore('accurate', path.join(WORK, 'parses')).load(), def = new ParseStore('default', path.join(WORK, 'parses')).load();
  const judgeList = [], trees = {};
  for (const c of todo) {
    const sentences = judgeSentences(c.text, acc);
    if (!sentences.length) { trees[c.cid] = {identical: false, sentences: [], note: 'no parse'}; continue; }
    const tree = treeAgreement(sentences.map(s => ({text: s.text, tokens: s.words.map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel])})), defaultTrees(c.text, def, maskMessage));
    trees[c.cid] = tree;
    if (tree.identical) judgeList.push({cid: c.cid, text: c.text});
  }
  // the parse judge folder is this task's own; sentences already judged by the neuro oracle keep their verdicts (same sentence key)
  const {index, sentences, new_items} = writeParseItems(judgeList, acc, PARSE_JUDGE_DIR);
  for (const f of ['SYSTEM_a.txt', 'SYSTEM_c.txt', 'TASK.md']) if (!fs.existsSync(path.join(PARSE_JUDGE_DIR, f))) fs.copyFileSync(path.join(PARSE_DIR, f), path.join(PARSE_JUDGE_DIR, f));
  fs.mkdirSync(path.join(PARSE_JUDGE_DIR, 'scripts'), {recursive: true});
  if (!fs.existsSync(path.join(PARSE_JUDGE_DIR, 'scripts/judge.py'))) fs.writeFileSync(path.join(PARSE_JUDGE_DIR, 'scripts/judge.py'), fs.readFileSync(path.join(PARSE_DIR, 'scripts/judge.py'), 'utf8').replaceAll('neuro_oracle_parse_judge', 'backgen_parse_judge'));
  for (const d of ['output', 'logs']) fs.mkdirSync(path.join(PARSE_JUDGE_DIR, d), {recursive: true});
  writeJson(path.join(WORK, 'trees.json'), {trees, judge_index: index});
  console.log(JSON.stringify({meaning_yes: todo.length, distinct_texts: texts.length, identical_trees: judgeList.length, sentences_to_judge: sentences, new_items}));
}

async function build() {
  const two = flag('two-vote'), conds = two ? ['m1', 'm2'] : ['m1'];
  const usable = opt('meaning-usable') !== 'false';
  const cands = readCandidates();
  const meaning = readVerdicts(MEANING_DIR);
  const pj = readVerdicts(PARSE_JUDGE_DIR);
  const neuroPj = readVerdicts(path.join(ROOT, 'datasets_sources/neuro_oracle_parse_judge'));
  const all = new Map([...neuroPj, ...pj]);
  const {trees, judge_index: index} = fs.existsSync(path.join(WORK, 'trees.json')) ? JSON.parse(fs.readFileSync(path.join(WORK, 'trees.json'), 'utf8')) : {trees: {}, judge_index: {}};
  const rows = new Map(datasetRows('symbolic_english').map(r => [r.id, r]));
  // pairs whose prompt or target equals a sealed text, written by tools/eval/backgen-sealed-check.mjs (the builder never opens a sealed file); dropped unless --keep-sealed-matches
  const sealedFile = path.join(WORK, 'sealed-matches.json');
  const sealedIds = new Set(!flag('keep-sealed-matches') && fs.existsSync(sealedFile) ? JSON.parse(fs.readFileSync(sealedFile, 'utf8')).ids : []);
  const kept = {repair: [], identity: []}, rejected = {};
  const reject = (c, why) => { rejected[why] = (rejected[why] ?? 0) + 1; };
  for (const c of cands) {
    if (!c.mech_ok) { reject(c, 'mechanical:' + c.failed[0].split(':')[0]); continue; }
    if (sealedIds.has(`${c.id}#bg${c.n}`)) { reject(c, 'sealed_text_match'); continue; }
    const m = meaningYes(meaning, c.cid, conds);
    if (usable && m === false) { reject(c, 'meaning_judge_no'); continue; }
    if (usable && m === null) { reject(c, 'meaning_pending'); continue; }
    const verification = usable ? (two ? 'MEANING_TWO_VOTE' : 'MEANING_JUDGE_YES') : 'UNVERIFIED_MEANING';
    const tree = trees[c.cid];
    let gate = {state: 'pending', failed: []};
    if (!usable && !tree) gate = {state: 'pending', failed: []};
    else if (!tree) gate = {state: 'pending', failed: []};
    else if (!tree.identical) gate = {state: 'fail', failed: [{reason: tree.note ?? 'trees_differ'}]};
    else gate = gateOf(index[c.cid] ?? [], all);
    if (gate.state === 'pending') { reject(c, 'gate_pending'); continue; }
    const src = rows.get(c.id);
    const shape = classifyRow({message: c.original, analysis: src.analysis, target: c.original});
    const audit = {id: `${c.id}#bg${c.n}`, pair_split: c.split, kind: gate.state === 'pass' ? 'identity' : 'repair', source: 'symbolic_backgen', source_row: c.id, paraphrase_kind: c.kind, verification, meaning_judge: usable ? Object.fromEntries(conds.map(k => [k, meaning.get(`${c.cid}|${k}`)?.preserves ?? null])) : null,
      parse_gate: gate.state === 'pass' ? 'passed' : (trees[c.cid]?.identical === false ? 'trees_differ' : 'judge_failed'), has_gold: hasGoldMatch(src), failure_kind: null, form: mainForm(src.analysis), corpus: src.source?.corpus ?? null,
      message_sentences: null, target_sentences: src.analysis?.sentences?.length ?? null, decomposition: shape.decomposition, decomposition_type: shape.type, clean_gate: c.clean_gate};
    if (gate.state === 'pass') kept.identity.push({flat: flat(audit.id, c.text, c.text, 'identity', 'identity:backgen_parse_gate'), audit: {...audit, verification: `IDENTITY_${verification}`}});
    else kept.repair.push({flat: flat(audit.id, c.text, c.original, 'repair', `backgen:${verification.toLowerCase()}`), audit});
  }
  fs.mkdirSync(OUT_DIR, {recursive: true});
  const all2 = [...kept.repair, ...kept.identity];
  const files = {train: path.join(OUT_DIR, 'train.jsonl'), dev: path.join(OUT_DIR, 'dev.jsonl')};
  for (const split of ['train', 'dev']) writeJsonl(files[split], all2.filter(p => p.audit.pair_split === split).sort((a, b) => a.flat.id.localeCompare(b.flat.id)).map(p => p.flat));
  const tokens = tokenLengths([files.train, files.dev]);
  const audit = all2.sort((a, b) => a.flat.id.localeCompare(b.flat.id)).map(p => ({...p.audit, tokens: {prompt: tokens[files[p.audit.pair_split]][p.flat.id][0], total: tokens[files[p.audit.pair_split]][p.flat.id][1]}}));
  writeJsonl(path.join(OUT_DIR, 'audit.jsonl'), audit);
  // proofreader projection (training/cli.mjs layout), like datasets/neuro_english/proofing/proofreader/
  fs.mkdirSync(path.join(OUT_DIR, 'proofreader'), {recursive: true});
  for (const split of ['train', 'dev']) fs.copyFileSync(files[split], path.join(OUT_DIR, 'proofreader', `${split}.jsonl`));
  const by = rows => ({pairs: rows.length, by_kind: countBy(rows, r => r.kind), by_paraphrase_kind: countBy(rows, r => r.paraphrase_kind), by_verification: countBy(rows, r => r.verification), by_parse_gate: countBy(rows, r => r.parse_gate), by_kind_and_paraphrase_kind: countBy(rows, r => `${r.kind}:${r.paraphrase_kind}`)});
  const summary = {train: by(audit.filter(r => r.pair_split === 'train')), dev: by(audit.filter(r => r.pair_split === 'dev')), all: by(audit)};
  const manifest = {format: 'chatsop-proofing-pairs-v1', dataset: 'neuro_english', source: 'symbolic_backgen', model: 'SymbolicProofingLLM', role: 'proofreader', prompt_profile: 'message-only',
    prompt: 'row.prompt verbatim: the complex paraphrase (message only)', target: 'row.target verbatim: the original symbolic_english message (repair) or the paraphrase itself (identity: SymbolicLM analyses it correctly as it is)',
    created: new Date().toISOString(), training_authorized: false, review_status: 'not_reviewed', meaning_judge_usable: usable, two_vote: two,
    pair_direction: '(complex paraphrase written by DeepSeek flash) -> (original symbolic_english message that SymbolicLM analyses correctly)', splits: 'split of the source symbolic_english row', rejected, summary,
    inputs: {backgen_parts: completeParts().map(p => p.name), meaning_judge: 'datasets_sources/backgen_meaning_judge', parse_judge: 'datasets_sources/backgen_parse_judge (plus the verdicts of datasets_sources/neuro_oracle_parse_judge for identical sentence keys)'},
    files: Object.fromEntries(['train.jsonl', 'dev.jsonl', 'audit.jsonl', 'proofreader/train.jsonl', 'proofreader/dev.jsonl'].map(f => [f, {rows: fs.readFileSync(path.join(OUT_DIR, f), 'utf8').split('\n').filter(Boolean).length, sha256: sha256(fs.readFileSync(path.join(OUT_DIR, f)))}]))};
  writeJson(path.join(OUT_DIR, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(OUT_DIR, 'VERSION'), JSON.stringify({format: 'chatsop-dataset-version-v1', corpus: 'neuro_english/proofing-backgen', counter: 1, label: `neuro_english/proofing-backgen ${manifest.created.slice(0, 10)}-${manifest.files['train.jsonl'].sha256.slice(0, 8)} (backgen pairs, meaning judge ${usable ? (two ? 'two-vote' : 'yes') : 'unverified'})`, dataset: 'neuro_english/proofing-backgen', version: `${manifest.created.slice(0, 10)}-${manifest.files['train.jsonl'].sha256.slice(0, 8)}`}) + '\n');
  fs.writeFileSync(path.join(WORK, 'identity-forms.jsonl'), kept.identity.map(p => JSON.stringify({id: p.flat.id, split: p.audit.pair_split, text: p.flat.prompt, source_row: p.audit.source_row, paraphrase_kind: p.audit.paraphrase_kind})).join('\n') + (kept.identity.length ? '\n' : ''));
  console.log(JSON.stringify({kept: {repair: kept.repair.length, identity: kept.identity.length}, rejected, summary: summary.all}, null, 1));
}

const commands = {collect, 'meaning-items': meaningItems, parse, build};
if (!commands[cmd]) { console.error('usage: backgen-proofing.mjs collect|meaning-items|parse|build'); process.exit(2); }
fs.mkdirSync(WORK, {recursive: true});
await commands[cmd]();
