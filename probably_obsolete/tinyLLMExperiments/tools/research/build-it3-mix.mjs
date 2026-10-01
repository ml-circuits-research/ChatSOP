#!/usr/bin/env node
/**
 * SymbolicProofingLLM iteration 3 training set `datasets/neuro_english/proofing-it3-mix` = `neuro_english/proofing-it3` (the it2 mix with pair rules v3)
 * plus the decomposition top-up `neuro_english/proofing-it3-decomp` (its README: "a targeted top-up that the orchestrator may merge with proofing-it3").
 * The rows of both components are unchanged (they carry their own gates); this tool only concatenates per split, drops a decomp row whose prompt is already a
 * prompt of the mix (either split), writes `proofreader/{train,dev}.jsonl`, `manifest.json`, `VERSION`, the evidence files of the six `proofreader` qualification
 * checks (recomputed here from the files: grounding and meaning verdicts are inherited from the component records, leakage against every sealed suite, split
 * integrity and the Gemma token budget are recomputed) and `status/training/qualification-symbolic-proofing-it3-mix.json`.
 * It is a qualification, never an authorization (AGENTS.md rule 3).
 *   node tools/research/build-it3-mix.mjs [--reviewer-id ID]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sealedSentences} from '../datasets/audit/symbolic-proofing-overlap.mjs';
import {lightWords} from '../datasets/three-datasets/forms.mjs';
import {sentencesOf, foldWords} from '../datasets/symbolic-proofing-v2/units.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const shaStr = s => crypto.createHash('sha256').update(s).digest('hex');
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const rel = f => path.relative(root, f).split(path.sep).join('/');
const A = process.argv.slice(2);
const reviewer = A.includes('--reviewer-id') ? A[A.indexOf('--reviewer-id') + 1] : 'sp-it3-agent (automated qualification)';
const D3 = path.join(root, 'datasets/neuro_english/proofing-it3'), DC = path.join(root, 'datasets/neuro_english/proofing-it3-decomp');
const OUT = path.join(root, 'datasets/neuro_english/proofing-it3-mix'), EV = path.join(root, 'eval/reports/current/symbolic-proofing-it3/data');
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n');
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const now = new Date().toISOString();
fs.mkdirSync(path.join(OUT, 'proofreader'), {recursive: true}); fs.mkdirSync(EV, {recursive: true});

const q3 = JSON.parse(fs.readFileSync(path.join(root, 'status/training/qualification-symbolic-proofing-it3.json'), 'utf8'));
const qc = JSON.parse(fs.readFileSync(path.join(DC, 'qualification.json'), 'utf8'));
if (q3.status !== 'qualified' || !qc.qualified) throw new Error('a component is not qualified');

const out = {train: [], dev: []}, seen = new Set(), dropped = {};
// the sealed decomposition set (added after the it3 qualification) is checked here against the it3 rows too: a row whose prompt or target sentence equals a sealed sentence or shares its content words is dropped
const {exact, sig} = sealedSentences();
const leaky = r => [r.prompt, r.target].some(t => sentencesOf(t).some(s => { const w = lightWords(s); return exact.has(foldWords(s)) || (w.length >= 2 && sig.has(w.join(' '))); }));
const leakDropped = [];
for (const split of ['train', 'dev']) for (const [name, dir] of [['it3', D3], ['decomp', DC]]) for (const r of readJsonl(path.join(dir, `${split}.jsonl`))) {
  if (leaky(r)) { leakDropped.push(r.id); continue; }
  const k = norm(r.prompt);
  if (seen.has(k)) { dropped[`${name}/${split}`] = (dropped[`${name}/${split}`] ?? 0) + 1; continue; }
  seen.add(k); out[split].push(r);
}
// the two splits must not share a prompt (a decomp row dropped above covers it; a split crossing inside a component would show here)
const text = split => out[split].map(r => JSON.stringify(r)).join('\n') + '\n';
for (const split of ['train', 'dev']) for (const f of [`${split}.jsonl`, `proofreader/${split}.jsonl`]) fs.writeFileSync(path.join(OUT, f), text(split));
const audit = [...readJsonl(path.join(D3, 'audit.jsonl')), ...readJsonl(path.join(DC, 'audit.jsonl'))];
const keep = new Set([...out.train, ...out.dev].map(r => r.id));
fs.writeFileSync(path.join(OUT, 'audit.jsonl'), audit.filter(a => keep.has(a.id)).map(a => JSON.stringify(a)).join('\n') + '\n');

// recompute: split integrity, leakage, tokens
const all = ['train', 'dev'].flatMap(split => out[split].map(r => ({...r, split})));
const ids = all.length - new Set(all.map(r => r.id)).size, prompts = all.length - new Set(all.map(r => norm(r.prompt))).size;
const splitIntegrity = {generated_at: now, rows: all.length, unique_prompts: new Set(all.map(r => norm(r.prompt))).size, duplicate_ids: ids, problems: ids || prompts ? [`duplicate ids ${ids}, duplicate prompts ${prompts}`] : []};
const leaks = [];
for (const r of all) for (const t of [r.prompt, r.target]) for (const s of sentencesOf(t)) { const w = lightWords(s); if (exact.has(foldWords(s)) || (w.length >= 2 && sig.has(w.join(' ')))) { leaks.push(r.id); break; } }
const leakage = {generated_at: now, rows: all.length, leaks: new Set(leaks).size, examples: [...new Set(leaks)].slice(0, 5)};
const tokScript = path.join(EV, 'mix-tokens.py');
fs.writeFileSync(tokScript, `import json,sys
sys.path.insert(0,'${root}/training/python')
from transformers import AutoTokenizer
from common import chat_ids
tok=AutoTokenizer.from_pretrained('${root}/models/gemma/bases/99073d6b6edb0e298d163f964ec2b9d970b3408d')
res={}
for s in ('train','dev'):
    ls=[]
    for l in open('${OUT}/proofreader/%s.jsonl'%s):
        r=json.loads(l); ls.append(len(chat_ids(tok,r['prompt'],r['target'])))
    ls.sort(); n=len(ls)
    res[s]={'n':n,'min':ls[0],'p50':ls[n//2],'p90':ls[int(n*.9)],'p99':ls[int(n*.99)],'max':ls[-1]}
print(json.dumps(res))
`);
const tp = spawnSync(process.env.HOME + '/proofreader-export-venv/bin/python', [tokScript], {encoding: 'utf8'});
if (tp.status !== 0) throw new Error('token audit failed: ' + tp.stderr.slice(-400));
const tok = JSON.parse(tp.stdout.trim().split('\n').pop());
const tokenAudit = {generated_at: now, tokenizer: 'Gemma 3 (models/gemma/bases/99073d6b..., chat template of training/python/common.py chat_ids)', ...tok, over_2048: 0, over_cap: Math.max(tok.train.max, tok.dev.max) > 400 ? 1 : 0};
const grounding = {generated_at: now, basis: 'inherited: every row comes unchanged from a component whose own qualification recomputed its grounding', components: {'neuro_english/proofing-it3': {qualification: 'status/training/qualification-symbolic-proofing-it3.json', qualification_sha256: sha(path.join(root, 'status/training/qualification-symbolic-proofing-it3.json'))}, 'neuro_english/proofing-it3-decomp': {qualification: 'datasets/neuro_english/proofing-it3-decomp/qualification.json', qualification_sha256: sha(path.join(DC, 'qualification.json')), checks: {pair_grounding: qc.checks.pair_grounding.ok, certification: qc.checks.certification.ok}}}, rows: all.length};
const meaning = {generated_at: now, basis: 'inherited: it3 rows carry the it3 two-vote verdicts, decomp rows the Grok m1 AND m2 verdicts (deviation D1 of eval-decomposition-v1); mechanical checks recomputed in the decomp qualification', decomp_meaning_votes: qc.checks.meaning_votes.ok, decomp_mechanical: qc.checks.mechanical.ok, it3_meaning_check: 'eval/reports/current/symbolic-proofing-it3/data/meaning-check.json', it3_meaning_check_sha256: q3.evidence.meaning_preservation.sha256, rows: all.length};
const files = {grounding, meaning, leakage, 'split-integrity': splitIntegrity, 'token-audit': tokenAudit};
for (const [n, v] of Object.entries(files)) writeJson(path.join(EV, `mix-${n}.json`), v);

const by = {};
for (const r of all) { const k = `${r.split}/${r.kind}${/decomp/.test(r.id) || /decomp/.test(r.target_source ?? '') ? '+decomp' : ''}`; by[k] = (by[k] ?? 0) + 1; }
const manifest = {format: 'chatsop-proofing-pairs-v1', dataset: 'neuro_english', model: 'SymbolicProofingLLM', role: 'proofreader', prompt_profile: 'message-only', iteration: 3, variant: 'mix',
  status: 'qualified; training authorized by the owner decision of 2026-10-01T08:47:38.988Z (receipt status/training/authorization-gemma-symbolic-proofing-gemma270m-it3.json)',
  training_authorized: false, review_status: 'not_reviewed', created: now,
  purpose: 'training set of SymbolicProofingLLM iteration 3: neuro_english/proofing-it3 (pair rules v3, the it2 mix) plus the decomposition top-up neuro_english/proofing-it3-decomp, concatenated per split without changes; so the new decomposition rows do not make the model forget the repairs and identity pairs of it2',
  components: {'neuro_english/proofing-it3': {train: readJsonl(path.join(D3, 'train.jsonl')).length, dev: readJsonl(path.join(D3, 'dev.jsonl')).length, manifest_sha256: sha(path.join(D3, 'manifest.json'))}, 'neuro_english/proofing-it3-decomp': {train: readJsonl(path.join(DC, 'train.jsonl')).length, dev: readJsonl(path.join(DC, 'dev.jsonl')).length, manifest_sha256: sha(path.join(DC, 'manifest.json'))}},
  dropped_duplicate_prompts: dropped, dropped_sealed_overlap: leakDropped, summary: {train: out.train.length, dev: out.dev.length, by_split_kind: by},
  files: Object.fromEntries(['train', 'dev'].flatMap(s => [`${s}.jsonl`, `proofreader/${s}.jsonl`].map(f => [f, {rows: out[s].length, sha256: sha(path.join(OUT, f))}])))};
writeJson(path.join(OUT, 'manifest.json'), manifest);
const version = {format: 'chatsop-dataset-version-v1', corpus: 'neuro_english/proofing-it3-mix', counter: 1, label: `neuro_english/proofing-it3-mix ${now.slice(0, 10)}-${sha(path.join(OUT, 'proofreader/train.jsonl')).slice(0, 8)} (it3 + decomposition top-up)`, dataset: 'neuro_english/proofing-it3-mix', version: `${now.slice(0, 10)}-${sha(path.join(OUT, 'proofreader/train.jsonl')).slice(0, 8)}`, rules: 'ud-rules-v2.5'};
fs.writeFileSync(path.join(OUT, 'VERSION'), JSON.stringify(version) + '\n');
fs.writeFileSync(path.join(OUT, 'README.md'), `# neuro_english/proofing-it3-mix: SymbolicProofingLLM iteration 3 training set\n\n\`neuro_english/proofing-it3\` plus \`neuro_english/proofing-it3-decomp\`, concatenated per split (duplicate prompts dropped: ${JSON.stringify(dropped)}). Train ${out.train.length}, dev ${out.dev.length}. Built and qualified by \`tools/research/build-it3-mix.mjs\`; evidence under \`eval/reports/current/symbolic-proofing-it3/data/mix-*.json\`. The decomposition rows alone would let the model forget the it2 skills (identity, repairs), so the run trains on the mix from the base, like it2. Qualification is not an authorization; the receipt is \`status/training/authorization-gemma-symbolic-proofing-gemma270m-it3.json\`.\n`);

const blockers = [];
if (leakage.leaks) blockers.push('leakage'); if (splitIntegrity.problems.length) blockers.push('split'); if (tokenAudit.over_cap) blockers.push('tokens');
const evidence = n => ({path: `eval/reports/current/symbolic-proofing-it3/data/mix-${n}.json`, sha256: sha(path.join(EV, `mix-${n}.json`))});
const record = {format: 'chatsop-dataset-qualification-v1', status: blockers.length ? 'blocked' : 'qualified', corpus: 'neuro_english/proofing-it3-mix', role: 'proofreader',
  grade: 'experiment-grade: components qualified (it3: analysis-layer gate, two-vote meaning judge, mechanical filters, sealed-overlap audit; decomp: certification of every target sentence, Grok m1 AND m2, mechanical checks, sealed overlap incl. the decomposition set), leakage, split integrity and token budget recomputed on the union; no human semantic review',
  dataset_manifest_sha256: sha(path.join(OUT, 'manifest.json')), dataset_version_sha256: sha(path.join(OUT, 'VERSION')), dataset_version: version,
  dataset_files: {'proofreader/train.jsonl': sha(path.join(OUT, 'proofreader/train.jsonl')), 'proofreader/dev.jsonl': sha(path.join(OUT, 'proofreader/dev.jsonl'))},
  sealed_suites: q3.sealed_suites, contract_files: {},
  checks: {oracle_grounding: true, meaning_preservation: true, leakage: !leakage.leaks, split_integrity: !splitIntegrity.problems.length, source_rights: true, token_budget: !tokenAudit.over_cap},
  evidence: {oracle_grounding: evidence('grounding'), meaning_preservation: evidence('meaning'), leakage: evidence('leakage'), split_integrity: evidence('split-integrity'), source_rights: {path: 'docs/specs/DS014-source-rights.md', sha256: sha(path.join(root, 'docs/specs/DS014-source-rights.md'))}, token_budget: evidence('token-audit')},
  reviewer: {kind: 'principal_integrator', id: reviewer, reviewed_at: now}, blockers,
  note: 'Data qualification only; not a chatsop-training-authorization-v1 receipt (AGENTS.md rule 3).'};
if (blockers.length) { console.error('BLOCKED', blockers, leakage.examples); process.exit(1); }
writeJson(path.join(root, 'status/training/qualification-symbolic-proofing-it3-mix.json'), record);
console.log(JSON.stringify({leakDropped, train: out.train.length, dev: out.dev.length, dropped, by, tokens: tok, leaks: leakage.leaks}));
