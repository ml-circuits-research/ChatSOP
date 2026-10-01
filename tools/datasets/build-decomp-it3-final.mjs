#!/usr/bin/env node
/**
 * Final stages of the decomposition training data for SymbolicProofingLLM iteration 3 (datasets/neuro_english/proofing-it3-decomp), after
 * tools/datasets/build-decomp-it3.mjs (groups, collect). Prepared, not trained: nothing here trains or authorizes training.
 *   node tools/datasets/build-decomp-it3-final.mjs parse      Stanza parses (default and accurate, CPU unless CHATSOP_UD_DEVICE) of every target sentence not yet recorded
 *   node tools/datasets/build-decomp-it3-final.mjs certify    per-sentence certification of the targets (identical trees) -> certified.jsonl
 *   node tools/datasets/build-decomp-it3-final.mjs judge      omp meaning-judge folders (Grok, GLM) for the certified candidates
 *   node tools/datasets/build-decomp-it3-final.mjs build      filters (two votes, naturalness, sealed overlap), the dataset files, audit and manifest
 * Gates, in order: (1) mechanical checks (build-decomp-it3.mjs collect: names, numbers, negation, quantifiers, question, pronouns, connectives);
 * (2) per-sentence certification of the targets: every sentence of a regular target has identical default and accurate trees; a partial-acceptance target has
 * at least one certified sentence and its one neuro_english sentence is NOT certified; (3) the two-vote meaning judge (Grok, the votes m1 and m2 of iteration 2, both `yes`; deviation D1 of eval-decomposition-v1: GLM is not required);
 * (4) naturalness of the tangled sentence; (5) no sentence of the pair equals, or has the content words of, a sealed sentence (checked by tools/eval/decomposition/overlap-check.mjs, which also reads the
 * decomposition evaluation set); (6) dedup by tangled text.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {AnalysisLayer} from '../eval/analysis-layer.mjs';
import {folder as severityFolder} from '../eval/severity-calibration.mjs';
import {loadVerdicts} from '../eval/severity-judge.mjs';
import {readJsonl, writeJsonl} from '../eval/decomposition/io.mjs';
import {WORK} from './build-decomp-it3.mjs';

export const OUT = path.join(ROOT, 'datasets/neuro_english/proofing-it3-decomp');
/** The votes of a judge: the main folder and its shard folders (`<name>_s1` ...) merged, id -> S0..S4 or null. */
export function loadVotes(name) {
  const out = new Map();
  const base = path.join(ROOT, 'datasets_sources');
  for (const dir of fs.readdirSync(base).filter(d => d === name || ((d.startsWith(`${name}_s`) || d.startsWith(`${name}_b`)) && /^_[sb]\d+$/.test(d.slice(name.length))))) {
    if (!fs.existsSync(path.join(base, dir, 'output/verdicts.jsonl'))) continue;
    for (const [id, v] of loadVerdicts(dir)) if (v || !out.has(id)) out.set(id, v);
  }
  return out;
}
let votesCache = null;
const sevOf = (name, id) => { votesCache ??= {}; votesCache[name] ??= loadVotes(name); return votesCache[name].get(id) ?? null; };
const sha = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export const LIST_TRAIN_CAP = 1300;
export const NATURAL_BAD = /^(with|given|having|seeing|considering)\b/i;

export async function parse() {
  const rows = readJsonl(path.join(WORK, 'candidates.jsonl'));
  return new AnalysisLayer().ensure(rows.flatMap(r => r.sentences));
}

export function certify() {
  const layer = new AnalysisLayer();
  const out = readJsonl(path.join(WORK, 'candidates.jsonl')).map(r => {
    const cert = r.sentences.map(s => layer.localPass(s));
    const uncertified = r.partial ? r.sentences.map(s => r.uncertified.includes(s)) : r.sentences.map(() => false);
    const ok = r.partial ? cert.some((c, i) => c && !uncertified[i]) && r.sentences.every((_, i) => (uncertified[i] ? !cert[i] : cert[i])) : cert.every(Boolean);
    return {...r, sentence_certified: cert, target_certified: ok};
  });
  writeJsonl(path.join(WORK, 'certified.jsonl'), out);
  const count = {};
  for (const r of out) { const k = r.partial ? 'partial' : r.style; count[k] ??= {rows: 0, certified: 0}; count[k].rows++; count[k].certified += r.target_certified; }
  return {rows: out.length, certified: out.filter(r => r.target_certified).length, count};
}

export function judgeFolders() {
  const rows = readJsonl(path.join(WORK, 'certified.jsonl')).filter(r => r.target_certified && !NATURAL_BAD.test(r.tangled));
  const items = rows.map(r => ({id: r.id, message: r.tangled, candidate: r.target}));
  return ['grok', 'glm'].map(j => severityFolder(`decomp_it3_meaning_${j}`, items));
}

const MJ = 'datasets_sources/symbolic_proofing_it2_meaning_judge';

/**
 * Meaning-judge folders (Grok, the two votes m1 and m2 of iteration 2: checklist prompts, `preserves` yes or no), sharded `decomp_it3_mj_b1..8`, for the live
 * candidates (certified, natural, not flagged by the overlap checker). Owner decision relayed by the orchestrator (2026-10-01): a row is accepted on Grok's two
 * votes alone (calibration on meaning v2: Grok raw precision 99.0%, recall 76.5%); GLM severity verdicts that exist are only reported as agreement.
 */
export function meaningFolders({shards = 8, tag = 'b'} = {}) {
  const leak = JSON.parse(fs.readFileSync(path.join(WORK, 'leak-verdicts.json'), 'utf8')).flagged;
  const judged = loadMeaningVotes();
  const rows = readJsonl(path.join(WORK, 'certified.jsonl')).filter(r => r.target_certified && !NATURAL_BAD.test(r.tangled) && !leak[r.id] && !(judged.get(r.id)?.m1 && judged.get(r.id)?.m2));
  const out = [];
  for (let k = 0; k < shards; k++) {
    const name = `decomp_it3_mj_${tag}${k + 1}`, dir = path.join(ROOT, 'datasets_sources', name);
    for (const d of ['input', 'output', 'logs', 'scripts']) fs.mkdirSync(path.join(dir, d), {recursive: true});
    const part = rows.filter((_, i) => i % shards === k);
    const items = part.flatMap(r => ['m1', 'm2'].map(condition => ({id: r.id, condition, user: `ORIGINAL: ${r.tangled}\n\nREWRITE: ${r.target}`})));
    fs.writeFileSync(path.join(dir, 'input/items.jsonl'), items.map(i => JSON.stringify(i)).join('\n') + '\n');
    for (const c of ['m1', 'm2']) fs.copyFileSync(path.join(ROOT, MJ, `SYSTEM_${c}.txt`), path.join(dir, `SYSTEM_${c}.txt`));
    fs.writeFileSync(path.join(dir, 'scripts/judge.py'), fs.readFileSync(path.join(ROOT, MJ, 'scripts/judge.py'), 'utf8').replaceAll('symbolic_proofing_it2_meaning_judge', name));
    fs.writeFileSync(path.join(dir, 'TASK.md'), fs.readFileSync(path.join(ROOT, MJ, 'TASK.md'), 'utf8').replaceAll('symbolic_proofing_it2_meaning_judge', name).replace(/^# Task: .*$/m, '# Task: meaning-preservation check of rewrites (tangled sentence and its decomposition, iteration-3 decomposition data)').replace('(a message of a dataset row)', '(a tangled single sentence)').replace('at most 32 in flight', 'at most 16 in flight').replace('concurrency=32', 'concurrency=16'));
    fs.writeFileSync(path.join(dir, 'run.sh'), `cd ${ROOT}\nomp -p --model "xai-oauth/grok-4.20-0309-non-reasoning" --auto-approve --no-title @datasets_sources/${name}/TASK.md "Do the task in TASK.md" </dev/null > datasets_sources/${name}/logs/omp-run.log 2>&1\n`);
    out.push({name, items: items.length});
  }
  return {candidates: rows.length, folders: out};
}

/** Grok's two votes per id from the shard folders: Map id -> {m1, m2} ('yes' | 'no' | null). */
export function loadMeaningVotes() {
  const out = new Map();
  const base = path.join(ROOT, 'datasets_sources');
  for (const d of fs.readdirSync(base).filter(d => /^decomp_it3_mj_[a-z]\d+$/.test(d))) {
    const f = path.join(base, d, 'output/verdicts.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line), v = String(r.answer?.preserves ?? '').toLowerCase();
      const rec = out.get(r.id) ?? {m1: null, m2: null};
      rec[r.condition] = v === 'yes' || v === 'no' ? v : null;
      out.set(r.id, rec);
    }
  }
  return out;
}

const lowText = s => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function build({seed = 'decomp-it3-v1'} = {}) {
  const rows = readJsonl(path.join(WORK, 'certified.jsonl')).filter(r => r.target_certified);
  // the overlap verdicts come from the evaluation-side checker (tools/eval/decomposition/overlap-check.mjs); this builder never reads a sealed file
  const leakFile = path.join(WORK, 'leak-verdicts.json');
  if (!fs.existsSync(leakFile)) throw Error('run tools/eval/decomposition/overlap-check.mjs first (it writes leak-verdicts.json)');
  const flagged = JSON.parse(fs.readFileSync(leakFile, 'utf8')).flagged;
  const meaning = loadMeaningVotes();
  const dropped = {};
  const drop = w => { dropped[w] = (dropped[w] ?? 0) + 1; };
  const kept = [], seenTangled = new Set();
  for (const r of rows) {
    if (NATURAL_BAD.test(r.tangled)) { drop('unnatural_opening'); continue; }
    if (flagged[r.id]) { drop(`sealed_${flagged[r.id]}`); continue; }
    const mv = meaning.get(r.id);
    if (!mv || !mv.m1 || !mv.m2) { drop('no_vote'); continue; }
    if (mv.m1 !== 'yes' || mv.m2 !== 'yes') { drop('meaning_vote'); continue; }
    const g = sevOf('decomp_it3_meaning_grok', r.id), z = sevOf('decomp_it3_meaning_glm', r.id);
    if (seenTangled.has(lowText(r.tangled))) { drop('duplicate_tangled'); continue; }
    seenTangled.add(lowText(r.tangled));
    kept.push({...r, votes: {grok_m1: mv.m1, grok_m2: mv.m2, grok_severity: g, glm_severity: z}});
  }
  const rank = r => createHash('sha1').update(`${seed}|${r.id}`).digest('hex');
  // the list category (about 1,200 requested) is capped in train so that it does not dominate the subordinate category; the cap keeps a deterministic hash order
  const isList = r => !r.partial && ['list_coordination', 'multi_question'].includes(r.style);
  let listTrain = 0;
  const capped = [];
  for (const r of kept.sort((a, b) => (rank(a) < rank(b) ? -1 : 1))) {
    if (r.split === 'train' && isList(r) && ++listTrain > LIST_TRAIN_CAP) { drop('list_cap'); continue; }
    capped.push(r);
  }
  const finalRows = capped;
  const rowOf = r => ({id: `decomp-it3::${r.id}`, prompt: r.tangled, target: r.target, kind: 'repair', language: 'en', source_language: 'en', pipeline: 'direct', target_source: r.partial ? 'repair:decomp-it3-partial' : 'repair:decomp-it3'});
  const auditOf = (r, split) => {
    return {id: `decomp-it3::${r.id}`, pair_split: split, kind: 'repair', origin: 'decomp-it3', origin_id: r.id, style: r.partial ? 'partial' : r.style, partial_acceptance: Boolean(r.partial), target_sentences: r.sentences.length, target_certified_sentences: r.sentence_certified.filter(Boolean).length,
      uncertified_kept_verbatim: r.partial ? r.uncertified : [], source_rows: r.rows, verification: 'VERIFIED_BY_CONSTRUCTION', meaning_votes: r.votes, meaning_judge: 'grok_two_vote_m1_m2', prompt_words: r.tangled.split(/\s+/).length, mechanical: 'names numbers negation quantifiers question pronouns connectives'};
  };
  fs.mkdirSync(path.join(OUT, 'proofreader'), {recursive: true});
  const audit = [];
  const files = {};
  for (const split of ['train', 'dev']) {
    const list = finalRows.filter(r => r.split === split);
    writeJsonl(path.join(OUT, `${split}.jsonl`), list.map(rowOf));
    writeJsonl(path.join(OUT, 'proofreader', `${split}.jsonl`), list.map(rowOf));
    audit.push(...list.map(r => auditOf(r, split)));
    files[`${split}.jsonl`] = {rows: list.length, sha256: sha(path.join(OUT, `${split}.jsonl`))};
    files[`proofreader/${split}.jsonl`] = files[`${split}.jsonl`];
  }
  writeJsonl(path.join(OUT, 'audit.jsonl'), audit);
  files['audit.jsonl'] = {rows: audit.length, sha256: sha(path.join(OUT, 'audit.jsonl'))};
  const by = {};
  for (const a of audit) { const k = `${a.pair_split}/${a.style}`; by[k] = (by[k] ?? 0) + 1; }
  const category = a => (a.partial_acceptance ? 'partial' : ['subordinate', 'relative', 'participle'].includes(a.style) ? 'subordinate' : 'list');
  const trainAudit = audit.filter(a => a.pair_split === 'train');
  // Grok (m1 AND m2) against the GLM severity verdicts that exist, on every live candidate: agreement only, GLM is not a gate (deviation D1)
  const glm = loadVotes('decomp_it3_meaning_glm');
  const agree = {both_accept: 0, grok_only: 0, glm_only: 0, both_reject: 0};
  for (const [id, v] of meaning) { const z = glm.get(id); if (!z) continue; const a = v.m1 === 'yes' && v.m2 === 'yes', b = ['S0', 'S1'].includes(z); agree[a && b ? 'both_accept' : a ? 'grok_only' : b ? 'glm_only' : 'both_reject']++; }
  const manifest = {format: 'chatsop-proofing-pairs-v1', dataset: 'neuro_english', model: 'SymbolicProofingLLM', role: 'proofreader', prompt_profile: 'message-only', iteration: 3, variant: 'decomp',
    status: 'prepared, not trained', training_authorized: false, review_status: 'not_reviewed', created: new Date().toISOString(),
    purpose: 'targeted top-up of decomposition (tangled single sentence -> 3 to 5 short certified sentences) for SymbolicProofingLLM iteration 3; to be merged with neuro_english/proofing-it3 by the orchestrator, never trained on its own authority',
    direction: 'reverse generation: a certified multi-sentence group of symbolic_english train/dev sentences is tangled by DeepSeek into one sentence; the pair is (tangled -> the group), so every target sentence is certified by construction',
    gates: ['mechanical checks (names, numbers, negation, quantifiers, question, pronouns, connectives)', 'per-sentence certification of the targets (identical default and accurate Stanza trees; partial pairs: the single neuro_english sentence is not certified)', 'two-vote meaning judge (Grok m1 and m2, as in iteration 2; deviation D1: GLM is not required, its verdicts are reported as agreement only)', 'naturalness of the tangled opening', 'sealed overlap (evaluation-side checker, content-word signature)', 'dedup'],
    summary: {train: files['train.jsonl'].rows, dev: files['dev.jsonl'].rows, by_style: by, train_by_category: Object.fromEntries(['subordinate', 'list', 'partial'].map(c => [c, trainAudit.filter(a => category(a) === c).length])), partial_acceptance_train: trainAudit.filter(a => a.partial_acceptance).length},
    meaning_judge: {gate: 'Grok (xai-oauth/grok-4.20-0309-non-reasoning), the two votes m1 AND m2 of iteration 2 (checklist prompts, `preserves` yes)', deviation: 'D1 of eval-decomposition-v1, owner decision relayed by the orchestrator 2026-10-01: a row is accepted on Grok alone (calibration on meaning v2: Grok raw precision 99.0%, recall 76.5%; GLM 97.0% and 89.4%); GLM severity verdicts (at most S1) are reported as agreement only', agreement_with_glm_severity: agree},
    dropped, files, sealed_overlap_checker: 'tools/eval/decomposition/overlap-check.mjs'};
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'proofreader/manifest.json'), JSON.stringify({format: 'chatsop-proofreader-projection-v1', corpus: 'neuro_english/proofing-it3-decomp', prompt_profile: 'message-only', training_authorized: false, review_status: 'not_reviewed', note: 'Byte-identical copies of ../train.jsonl and ../dev.jsonl in the layout training/cli.mjs expects for the role proofreader.', files: {'proofreader/train.jsonl': files['train.jsonl'], 'proofreader/dev.jsonl': files['dev.jsonl']}}, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'VERSION'), JSON.stringify({format: 'chatsop-dataset-version-v1', corpus: 'neuro_english/proofing-it3-decomp', counter: 1, label: `neuro_english/proofing-it3-decomp ${files['train.jsonl'].sha256.slice(0, 8)} (prepared, not trained)`, dataset: 'neuro_english/proofing-it3-decomp', version: `2026-10-01-${files['train.jsonl'].sha256.slice(0, 8)}`, rules: 'ud-rules-v2.5'}) + '\n');
  const sum = manifest.summary, trainCat = sum.train_by_category;
  fs.writeFileSync(path.join(OUT, 'README.md'), `# neuro_english/proofing-it3-decomp: decomposition of tangled sentences for SymbolicProofingLLM iteration 3 (prepared, not trained)

Status: **prepared, not trained**. There is NO authorization receipt and NO training run; this data is a targeted top-up that the orchestrator may merge with \`neuro_english/proofing-it3\`, and training needs the owner's explicit approval (AGENTS.md rule 3). A qualification record (\`qualification.json\`, \`tools/research/qualify-decomp-it3.mjs\`) is not an authorization.

Purpose: iteration 2 decomposes tangled sentences only partly (the sentence count reaches the target in 32.8% of the sealed decomposition pairs; subordinate clauses 21% good, lists 24%). The pairs here are (tangled single sentence -> 3 to 5 short certified sentences, explicit subjects), in the reverse direction: a certified group of short sentences is tangled into one sentence by DeepSeek, so every target sentence is certified by construction. Counts: train \${sum.train}, dev \${sum.dev}; train categories: subordinate (subordinate, relative and participle folds) \${trainCat.subordinate}, list and long coordination (including several questions, capped at \${LIST_TRAIN_CAP}) \${trainCat.list}, partial-acceptance \${trainCat.partial}.

Sources of the target sentences: one-clause, filler-free, pronoun-free (statement groups) sentences of \`symbolic_english\` train/dev rows, the sentences of the targets of \`neuro_english/proofing-it3\` (re-certified), and, for the partial-acceptance pairs, ONE uncertified one-clause sentence of \`neuro_english\` train/dev per group (\`failure_kind\` trees_differ). Splits stay apart: a train group holds train sentences only.

**Partial-acceptance pairs** (\`target_source: repair:decomp-it3-partial\`): the group holds certified sentences and exactly one sentence that SymbolicLM does not certify; the target repeats the uncertified sentence verbatim (never paraphrased) next to the certified short sentences. They teach "split what can be split, leave the rest in its original wording" (DS021 "Partial acceptance of a decomposition", a proposal).

Gates, in order: mechanical checks (names, numbers, negation, quantifiers, question mark, no added pronoun, no connective absent from the group); per-sentence certification of the targets (identical default and accurate Stanza trees; partial pairs: the single neuro_english sentence is not certified); naturalness of the tangled opening; the sealed-overlap checker (\`tools/eval/decomposition/overlap-check.mjs\`: no sentence equals or has the content words of a sealed sentence, the decomposition evaluation set included); the two-vote meaning judge (Grok m1 AND m2, as in iteration 2; owner decision relayed by the orchestrator: GLM is not required, its verdicts are reported as agreement in \`manifest.json\`); dedup by tangled text.

Files: as in \`proofing-it3\` (\`train.jsonl\`, \`dev.jsonl\`, \`audit.jsonl\`, \`manifest.json\`, \`VERSION\`, \`proofreader/\`), plus \`qualification.json\`. Builders: \`tools/datasets/decomp-it3-groups.mjs\`, \`build-decomp-it3.mjs\`, \`build-decomp-it3-final.mjs\`; report \`eval/reports/current/decomposition/summary.md\`.
`);
  return {kept: finalRows.length, dropped, summary: manifest.summary};
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const fn = {parse, certify, judge: judgeFolders, meaning: () => meaningFolders({tag: process.argv[3] ?? 'b'}), build}[process.argv[2]];
  if (!fn) { console.error('usage: parse | certify | judge | meaning | build'); process.exit(2); }
  console.log(JSON.stringify(await fn(), null, 1));
  process.exit(0);
}
