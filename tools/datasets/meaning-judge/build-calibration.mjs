/** Builds the calibration set of the DeepSeek meaning judge (experiment eval-meaning-judge-calibration-v1).
 *
 *   node tools/datasets/meaning-judge/build-calibration.mjs [--seed S]
 *
 * Positives (same meaning): strict gold-matching rewrite pairs of datasets/neuro_english/proofing (VERIFIED_GOLD, train and
 * dev pairs; the sealed proofing test is never read) and datasets_archive/proofing repair pairs whose target matched the gold
 * SOP strictly (`target_oracle.strict`), English inputs only.
 * Negatives (different meaning): one mechanical change of a positive candidate (perturb.mjs), tagged by type, plus the
 * hand-written hard negatives of hard-negatives.mjs.
 *
 * Writes the labels to eval/reports/current/meaning-judge/labels.jsonl (never into the judge folder) and the judge input
 * (opaque ids, no labels) to datasets_sources/meaning_judge_calibration/input/items.jsonl for the conditions m1 and m2 on
 * every item and m1r (a repeat of m1) on 100 items.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT, readJsonl, writeJsonl} from '../neuro-oracle/common.mjs';
import {TYPES, makePick} from './perturb.mjs';
import {HARD_NEGATIVES} from './hard-negatives.mjs';

const args = process.argv.slice(2);
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : null; // null: the first (exploratory) set, written before the perturbations were tightened
const seed = args.includes('--seed') ? args[args.indexOf('--seed') + 1] : `meaning-judge-calibration-${tag ?? 'v1'}`;
export const WORK = path.join(ROOT, 'eval/reports/current/meaning-judge', tag ?? '');
export const FOLDER = path.join(ROOT, `datasets_sources/meaning_judge_calibration${tag ? '_' + tag : ''}`);
const rank = key => crypto.createHash('sha1').update(`${seed}|${key}`).digest('hex');
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const short = p => p.message.length <= 260 && p.candidate.length <= 260 && (p.message.match(/[.?!]/g) ?? []).length <= 5;
const shuffle = (list, key) => [...list].sort((a, b) => (rank(key(a)) < rank(key(b)) ? -1 : 1));

function neuroPool() {
  const dir = path.join(ROOT, 'datasets/neuro_english/proofing');
  const pairs = new Map();
  for (const split of ['train', 'dev']) for (const r of readJsonl(path.join(dir, 'proofreader', `${split}.jsonl`))) pairs.set(r.id, {...r, split});
  const out = [];
  for (const a of readJsonl(path.join(dir, 'audit.jsonl'))) {
    if (a.verification !== 'VERIFIED_GOLD') continue;
    const p = pairs.get(a.id);
    if (p && p.kind === 'repair' && norm(p.prompt) !== norm(p.target)) out.push({pair_id: a.id, source: 'neuro_proofing', split: p.split, message: p.prompt, candidate: p.target});
  }
  return out;
}

function archivePool() {
  const out = [];
  for (const split of ['train', 'dev']) for (const r of readJsonl(path.join(ROOT, 'datasets_archive/proofing', `${split}.jsonl`))) {
    if (r.kind !== 'repair' || r.language !== 'en' || !r.target_oracle?.strict || norm(r.input) === norm(r.target)) continue;
    if (/[ăâîșț]/i.test(r.input) && !/[ăâîșț]/i.test(r.target)) continue; // Romanian-diacritic inputs are a translation, not a rewrite
    out.push({pair_id: r.id, source: 'archive_proofing', split, message: r.input, candidate: r.target});
  }
  return out;
}

const neuro = shuffle(neuroPool().filter(short), p => p.pair_id), archive = shuffle(archivePool().filter(short), p => p.pair_id);
const POS = {neuro_proofing: 150, archive_proofing: 150};
const positives = [...neuro.slice(0, POS.neuro_proofing), ...archive.slice(0, POS.archive_proofing)];
const restNeuro = neuro.slice(POS.neuro_proofing), restArchive = archive.slice(POS.archive_proofing);

const typeNames = Object.keys(TYPES).filter(t => t !== 'resolve_ambiguity');
const PER_TYPE = 27;
const used = new Set(), negatives = [], notBuilt = {resolve_ambiguity: 'no reliable mechanical form'};
for (const type of typeNames) {
  let n = 0;
  // alternate sources so that each type mixes neuro (short, formal) and archive (typo-fixed) candidates
  const queues = [restNeuro, restArchive].map(list => shuffle(list, p => `${type}|${p.pair_id}`));
  for (let i = 0; n < PER_TYPE && (i < queues[0].length || i < queues[1].length); i++) for (const q of queues) {
    const p = q[i];
    if (!p || used.has(p.pair_id) || n >= PER_TYPE) continue;
    const perturbed = TYPES[type](p.candidate, makePick(`${seed}|${type}|${p.pair_id}`));
    if (!perturbed || norm(perturbed) === norm(p.candidate) || norm(perturbed) === norm(p.message)) continue;
    used.add(p.pair_id);
    negatives.push({...p, type, original_candidate: p.candidate, candidate: perturbed});
    n++;
  }
}

const rows = [];
positives.forEach(p => rows.push({label: 'same', type: 'positive', source: p.source, pair_id: p.pair_id, message: p.message, candidate: p.candidate}));
negatives.forEach(p => rows.push({label: 'different', type: p.type, source: p.source, pair_id: p.pair_id, message: p.message, candidate: p.candidate, original_candidate: p.original_candidate}));
HARD_NEGATIVES.forEach((h, i) => rows.push({label: 'different', type: `hard_${h.type}`, source: 'hand_written', pair_id: `hard-${String(i + 1).padStart(3, '0')}`, message: h.original, candidate: h.rewrite, note: h.note ?? null}));
const ordered = shuffle(rows, r => `${r.pair_id}|${r.type}`).map((r, i) => ({id: `mj-${String(i + 1).padStart(4, '0')}`, ...r}));

const userOf = r => `ORIGINAL: ${r.message}\n\nREWRITE: ${r.candidate}`;
const repeat = new Set(shuffle(ordered, r => `rep|${r.id}`).slice(0, 100).map(r => r.id));
const items = [];
for (const condition of ['m1', 'm2']) for (const r of ordered) items.push({id: r.id, condition, user: userOf(r)});
for (const r of ordered) if (repeat.has(r.id)) items.push({id: r.id, condition: 'm1r', user: userOf(r)});

fs.mkdirSync(WORK, {recursive: true});
writeJsonl(path.join(WORK, 'labels.jsonl'), ordered.map(r => ({...r, repeat: repeat.has(r.id)})));
writeJsonl(path.join(FOLDER, 'input/items.jsonl'), items);
const count = key => ordered.reduce((o, r) => { o[key(r)] = (o[key(r)] ?? 0) + 1; return o; }, {});
const summary = {seed, items: ordered.length, by_label: count(r => r.label), by_type: count(r => r.type), by_source: count(r => r.source), repeat: repeat.size, not_built: notBuilt, judge_input_lines: items.length};
fs.writeFileSync(path.join(WORK, 'calibration-set.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
