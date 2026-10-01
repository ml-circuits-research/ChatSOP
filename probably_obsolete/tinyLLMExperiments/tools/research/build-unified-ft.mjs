#!/usr/bin/env node
/**
 * Data of the unified-ft experiment (preregistration status/preregistrations/train-unified-qwen3-4b-u2.json): ONE model turns the raw message (Romanian, mixed, noisy
 * or tangled English) into the limited English that SymbolicLM certifies, in one step. Built only from the existing datasets, with chained targets:
 *
 *   raw message  ->  clean English (F, "faithful")  ->  limited English (L)
 *
 *   A  datasets/bad_english/proofing-prod1 pairs (message -> clean target t). L comes from the existing certified targets: t is a prompt of
 *      neuro_english/proofing-it3-mix  -> L is that row's target (certified, meaning-judged in its own qualification), or
 *      t is a message of symbolic_english (analysis-layer member, certified by construction) -> L = t, or
 *      t was certified by SymbolicLM here (tools/research/unified-ft-certify.mjs, accurate Stanza, identical default/accurate trees) -> L = t.
 *   B  neuro_english/proofing-it3-mix rows (F = the English prompt, L = the target): every repair row and a seeded sample of the identity rows.
 *   C  symbolic_english messages as identity rows (F = L = the message).
 *
 * Two projections of the same rows (the preregistered arms): u2 = target "faithful: F\nlimited: L" (two outputs), u1 = target L only.
 * Guards: jargon blocklist (tools/datasets/translate-jargon/blocklist.mjs, as mt-distill-agent built it), natural-overlap (tools/datasets/audit/natural-overlap.mjs,
 * row by row), sealed-suite leakage (symbolic-proofing-overlap.mjs sealedSentences), split integrity (a prompt is in one split only), Qwen token budget.
 * Writes datasets/neuro_english/unified-ft-{u2,u1}/ (manifest, VERSION, README, train/dev, proofreader/), evidence under eval/reports/current/unified-ft/data/ and
 * status/training/qualification-unified-qwen3-4b-{u2,u1}.json. A qualification is never an authorization (AGENTS.md rule 3).
 *   node tools/research/build-unified-ft.mjs [--bad-max N] [--identity N] [--sym N] [--reviewer-id ID]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sealedSentences} from '../datasets/audit/symbolic-proofing-overlap.mjs';
import {naturalOverlapOf} from '../datasets/audit/natural-overlap.mjs';
import {lightWords} from '../datasets/three-datasets/forms.mjs';
import {sentencesOf, foldWords} from '../datasets/symbolic-proofing-v2/units.mjs';
import {loadBlocklist, blocked} from '../datasets/translate-jargon/blocklist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const A = process.argv.slice(2), val = (k, d) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const reviewer = val('--reviewer-id', 'unified-ft-agent (automated qualification)');
const NEURO_IDENTITY = Number(val('--identity', 2500)), SYM = Number(val('--sym', 3000)), SYM_DEV = 300;
const EV = path.join(root, 'eval/reports/current/unified-ft/data');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const key = id => crypto.createHash('sha256').update('unified-ft-v1|' + id).digest('hex');
const byKey = (a, b) => (key(a.id) < key(b.id) ? -1 : 1);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n');
const now = new Date().toISOString();
fs.mkdirSync(EV, {recursive: true});

const bl = loadBlocklist();
const {exact, sig} = sealedSentences();
const natural = rd('datasets/natural/messages.jsonl');
const leaky = r => [r.prompt, r.faithful, r.limited].some(t => sentencesOf(t).some(s => { const w = lightWords(s); return exact.has(foldWords(s)) || (w.length >= 2 && sig.has(w.join(' '))); }));
const isNatural = r => { const o = naturalOverlapOf([{id: r.id, message: r.prompt, target: r.faithful}, {id: r.id, message: r.limited}], natural); return o.exact_duplicates + o.lexical_duplicates > 0; };
const dropped = {jargon: 0, sealed_leak: 0, natural_overlap: 0, duplicate_prompt: 0, empty_or_long: 0};
const words = t => String(t).split(/\s+/).filter(Boolean).length;

const certified = new Map();
for (const f of fs.readdirSync(EV).filter(n => /^cert-\d+\.jsonl$/.test(n))) for (const l of fs.readFileSync(path.join(EV, f), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); certified.set(r.id, r); }

const out = {train: [], dev: []}, seen = new Set(), counts = {};
const add = (split, row, source) => {
  if (!row.prompt?.trim() || !row.faithful?.trim() || !row.limited?.trim() || words(row.prompt) > 70 || words(row.limited) > 90) { dropped.empty_or_long++; return; }
  if ([row.prompt, row.faithful, row.limited].some(t => blocked(t, bl))) { dropped.jargon++; return; }
  const k = norm(row.prompt);
  if (seen.has(k)) { dropped.duplicate_prompt++; return; }
  if (leaky(row)) { dropped.sealed_leak++; return; }
  if (isNatural(row)) { dropped.natural_overlap++; return; }
  seen.add(k); out[split].push(row);
  const c = `${split}/${source}/${row.language_kind}`; counts[c] = (counts[c] ?? 0) + 1;
};

for (const split of ['train', 'dev']) {
  const neuro = rd(`datasets/neuro_english/proofing-it3-mix/${split}.jsonl`);
  const symbolic = rd(`datasets/symbolic_english/${split}.jsonl`).filter(r => r.analysis_verified !== false);
  const N = new Map(neuro.map(r => [norm(r.prompt), r.target]));
  const S = new Set(symbolic.map(r => norm(r.message)));
  // A: bad_english chains
  for (const r of rd(`datasets/bad_english/proofing-prod1/${split}.jsonl`).sort(byKey)) {
    const t = r.target, n = norm(t);
    let limited = null, via = null;
    if (N.has(n)) { limited = N.get(n); via = 'neuro'; } else if (S.has(n)) { limited = t; via = 'symbolic'; } else if (certified.get(r.id)?.certified === true) { limited = t; via = 'certified'; }
    if (!limited) continue;
    add(split, {id: `unified::bad::${r.id}`, prompt: r.prompt, faithful: t, limited, kind: r.kind, language_kind: r.language_kind, chain: `bad_english/proofing-prod1 -> ${via}`, target_source: `${r.target_source}; limited via ${via}`}, `bad-${via}`);
  }
  // B: neuro rows
  const identity = neuro.filter(r => r.kind === 'identity').sort(byKey).slice(0, split === 'train' ? NEURO_IDENTITY : 400);
  for (const r of [...neuro.filter(r => r.kind !== 'identity'), ...identity]) add(split, {id: `unified::neuro::${r.id}`, prompt: r.prompt, faithful: r.prompt, limited: r.target, kind: r.kind, language_kind: 'clean_en', chain: 'neuro_english/proofing-it3-mix', target_source: r.target_source}, `neuro-${r.kind}`);
  // C: symbolic identity
  for (const r of symbolic.sort(byKey).slice(0, split === 'train' ? SYM : SYM_DEV)) add(split, {id: `unified::sym::${r.id}`, prompt: r.message, faithful: r.message, limited: r.message, kind: 'identity', language_kind: 'clean_en', chain: 'symbolic_english', target_source: 'identity:symbolic_english'}, 'symbolic-identity');
}
// The bad_english dev split barely meets the chained targets (its clean targets are rarely neuro dev prompts), so the dev split would hold almost no Romanian or
// mixed row. Whole source groups (the fv1_<n>_<n>_<n> base of an id; all paraphrases and noise variants stay together) of the train rows are moved to dev, seeded by hash, until
// the dev split holds DEV_FOREIGN Romanian, mixed or noisy-English rows.
const DEV_FOREIGN = Number(val('--dev-foreign', 450));
const grp = r => /fv1_\d+_\d+_\d+/.exec(r.id)?.[0] ?? r.id;
const foreign = r => r.id.startsWith('unified::bad::') && ['ro', 'mixed', 'noisy_en'].includes(r.language_kind);
let devForeign = out.dev.filter(foreign).length;
const groups = [...new Set(out.train.filter(foreign).map(grp))].sort((x, y) => (key(x) < key(y) ? -1 : 1));
const moved = new Set();
for (const g of groups) { if (devForeign >= DEV_FOREIGN) break; moved.add(g); devForeign += out.train.filter(r => foreign(r) && grp(r) === g).length; }
const movedRows = out.train.filter(r => r.id.startsWith('unified::bad::') && moved.has(grp(r)));
out.train = out.train.filter(r => !movedRows.includes(r)); out.dev.push(...movedRows);
dropped.moved_to_dev_by_group = movedRows.length;
// a prompt is in one split only: a dev row whose prompt is in train was dropped by `seen` (train is added first); report
const rows = split => out[split].sort(byKey);
const render = (variant, r) => ({id: r.id, prompt: r.prompt, target: variant === 'u2' ? `faithful: ${r.faithful}\nlimited: ${r.limited}` : r.limited, kind: r.kind, language_kind: r.language_kind, chain: r.chain, target_source: r.target_source});

const all = ['train', 'dev'].flatMap(split => rows(split).map(r => ({...r, split})));
const splitIntegrity = (() => { const ids = all.length - new Set(all.map(r => r.id)).size, prompts = all.length - new Set(all.map(r => norm(r.prompt))).size; return {generated_at: now, rows: all.length, unique_prompts: new Set(all.map(r => norm(r.prompt))).size, duplicate_ids: ids, problems: ids || prompts ? [`duplicate ids ${ids}, duplicate prompts ${prompts}`] : []}; })();
const leaks = all.filter(leaky).map(r => r.id), nat = all.filter(isNatural).map(r => r.id);
const leakage = {generated_at: now, rows: all.length, sealed_leaks: leaks.length, natural_overlap_rows: nat.length, jargon_in_rows: all.filter(r => [r.prompt, r.faithful, r.limited].some(t => blocked(t, bl))).length, blocklist_terms: bl.size, examples: [...leaks, ...nat].slice(0, 5)};

const BASE = path.join(root, 'models/qwen3-4b/bases');
const baseDir = fs.existsSync(BASE) ? fs.readdirSync(BASE).filter(n => /^[a-f0-9]{40}$/.test(n))[0] : null;
const variants = {u2: {title: 'two outputs (faithful English for the user validation, then the limited English)', dir: path.join(root, 'datasets/neuro_english/unified-ft-u2')}, u1: {title: 'one output (the limited English only)', dir: path.join(root, 'datasets/neuro_english/unified-ft-u1')}};
for (const [v, info] of Object.entries(variants)) fs.mkdirSync(path.join(info.dir, 'proofreader'), {recursive: true});
const text = (v, split) => rows(split).map(r => JSON.stringify(render(v, r))).join('\n') + '\n';
for (const [v, info] of Object.entries(variants)) for (const split of ['train', 'dev']) for (const f of [`${split}.jsonl`, `proofreader/${split}.jsonl`]) fs.writeFileSync(path.join(info.dir, f), text(v, split));
fs.writeFileSync(path.join(root, 'datasets/neuro_english/unified-ft-u2/full.jsonl'), all.map(r => JSON.stringify(r)).join('\n') + '\n');

// token audit with the Qwen tokenizer and the chat template of training/python/common.py
let tokenAudit = {generated_at: now, skipped: 'base not downloaded yet', over_cap: 0};
if (baseDir) {
  const script = path.join(EV, 'unified-tokens.py');
  fs.writeFileSync(script, `import json,sys
sys.path.insert(0,'${root}/training/python')
from transformers import AutoTokenizer
from common import chat_ids
tok=AutoTokenizer.from_pretrained('${BASE}/${baseDir}')
res={}
for v in ('u2','u1'):
    for s in ('train','dev'):
        ls=[]
        for l in open('${root}/datasets/neuro_english/unified-ft-%s/proofreader/%s.jsonl'%(v,s)):
            r=json.loads(l); ls.append(len(chat_ids(tok,r['prompt'],r['target'])))
        ls.sort(); n=len(ls)
        res[v+'/'+s]={'n':n,'total':sum(ls),'min':ls[0],'p50':ls[n//2],'p90':ls[int(n*.9)],'p99':ls[int(n*.99)],'max':ls[-1]}
print(json.dumps(res))
`);
  const tp = spawnSync(process.env.HOME + '/proofreader-export-venv/bin/python', [script], {encoding: 'utf8'});
  if (tp.status !== 0) throw new Error('token audit failed: ' + tp.stderr.slice(-600));
  const tok = JSON.parse(tp.stdout.trim().split('\n').pop());
  tokenAudit = {generated_at: now, tokenizer: `Qwen/Qwen3-4B-Instruct-2507 ${baseDir} (chat template of training/python/common.py chat_ids)`, max_length: 512, ...tok, over_cap: Math.max(...Object.values(tok).map(x => x.max)) > 512 ? 1 : 0};
}
const certRows = all.filter(r => /certified/.test(r.chain));
const grounding = {generated_at: now, basis: 'every limited English is certified by SymbolicLM: neuro rows by the it3-mix qualification (status/training/qualification-symbolic-proofing-it3-mix.json), symbolic_english rows by membership (analysis layer), the extra bad_english rows by the certification run of this build (tools/research/unified-ft-certify.mjs; identical default and accurate Stanza trees)', rows: all.length, certified_extra_rows: certRows.length, certification_workers: [...certified.values()].length, certified_true: [...certified.values()].filter(c => c.certified === true).length, certified_false: [...certified.values()].filter(c => c.certified === false).length};
const meaning = {generated_at: now, basis: 'inherited: the neuro targets carry the it3 two-vote and decomposition Grok-m1-and-m2 verdicts; the bad_english clean targets are the proofing-prod1 targets (DeepSeek or repair rules with its own qualification, status/training/qualification-language-proofing-prod1.json); rows where limited == faithful change nothing', rows: all.length};
const evidenceFiles = {grounding, meaning, leakage, 'split-integrity': splitIntegrity, 'token-audit': tokenAudit};
for (const [n, vv] of Object.entries(evidenceFiles)) writeJson(path.join(EV, `unified-${n}.json`), vv);

const by = {};
for (const r of all) { const k = `${r.split}/${r.chain.split(' -> ').pop()}/${r.language_kind}`; by[k] = (by[k] ?? 0) + 1; }
const summary = {train: out.train.length, dev: out.dev.length, by_split_chain_language: by, dropped, counts};
const blockers = [];
if (leakage.sealed_leaks || leakage.natural_overlap_rows || leakage.jargon_in_rows) blockers.push('leakage'); if (splitIntegrity.problems.length) blockers.push('split'); if (tokenAudit.over_cap) blockers.push('tokens');
if (!baseDir) blockers.push('token audit needs the base');
for (const [v, info] of Object.entries(variants)) {
  const files = Object.fromEntries(['train', 'dev'].flatMap(s => [`${s}.jsonl`, `proofreader/${s}.jsonl`].map(f => [f, {rows: out[s].length, sha256: sha(path.join(info.dir, f))}])));
  const manifest = {format: 'chatsop-proofing-pairs-v1', dataset: 'neuro_english', model: 'unified first layer (LanguageProofingLLM and SymbolicProofingLLM in one step)', role: 'proofreader', prompt_profile: 'message-only', iteration: 1, variant: v,
    status: 'qualified for the unified-ft experiment; training authorization is a separate receipt', training_authorized: false, review_status: 'not_reviewed', created: now,
    purpose: `unified-ft ${info.title}: raw message (Romanian, mixed, noisy or tangled English) -> limited English that SymbolicLM certifies, chained from bad_english proofing-prod1 (message -> clean English), neuro_english proofing-it3-mix and symbolic_english identity rows. Natural messages are evaluation only; the project jargon is blocklisted.`,
    summary, files};
  writeJson(path.join(info.dir, 'manifest.json'), manifest);
  writeJson(path.join(info.dir, 'proofreader/manifest.json'), {format: 'chatsop-proofreader-projection-v1', corpus: `neuro_english/unified-ft-${v}`, prompt_profile: 'message-only', created: now, training_authorized: false, review_status: 'not_reviewed', note: 'Byte-identical copies of ../train.jsonl and ../dev.jsonl in the layout training/cli.mjs expects for the role proofreader.', files: Object.fromEntries(Object.entries(files).filter(([f]) => f.startsWith('proofreader/')))});
  const version = {format: 'chatsop-dataset-version-v1', corpus: `neuro_english/unified-ft-${v}`, counter: 1, label: `neuro_english/unified-ft-${v} ${now.slice(0, 10)}-${sha(path.join(info.dir, 'proofreader/train.jsonl')).slice(0, 8)}`, dataset: `neuro_english/unified-ft-${v}`, version: `${now.slice(0, 10)}-${sha(path.join(info.dir, 'proofreader/train.jsonl')).slice(0, 8)}`, rules: 'ud-rules-v2.5'};
  fs.writeFileSync(path.join(info.dir, 'VERSION'), JSON.stringify(version) + '\n');
  fs.writeFileSync(path.join(info.dir, 'README.md'), `# neuro_english/unified-ft-${v}: ${info.title}\n\nTraining pairs of the unified-ft experiment (preregistration \`status/preregistrations/train-unified-qwen3-4b-u2.json\`). Built by \`tools/research/build-unified-ft.mjs\` from the existing datasets only; train ${out.train.length}, dev ${out.dev.length}. ${v === 'u2' ? 'Target: `faithful: <clean English>` then `limited: <limited English>`.' : 'Target: the limited English only.'} \`full.jsonl\` (in unified-ft-u2) keeps both outputs and the chain of every row. Evaluation messages (datasets/natural) are never used; the jargon blocklist and the natural-overlap and sealed-leakage guards ran row by row. Qualification is not an authorization.\n`);
  const evidence = n => ({path: `eval/reports/current/unified-ft/data/unified-${n}.json`, sha256: sha(path.join(EV, `unified-${n}.json`))});
  const record = {format: 'chatsop-dataset-qualification-v1', status: blockers.length ? 'blocked' : 'qualified', corpus: `neuro_english/unified-ft-${v}`, role: 'proofreader',
    grade: 'experiment-grade: chained targets reuse the already qualified certified targets (neuro it3-mix, symbolic_english membership) and SymbolicLM certification for the extra bad_english rows; blocklist, natural-overlap and sealed-leakage guards recomputed; no human semantic review',
    dataset_manifest_sha256: sha(path.join(info.dir, 'manifest.json')), dataset_version_sha256: sha(path.join(info.dir, 'VERSION')), dataset_version: version,
    dataset_files: {'proofreader/train.jsonl': sha(path.join(info.dir, 'proofreader/train.jsonl')), 'proofreader/dev.jsonl': sha(path.join(info.dir, 'proofreader/dev.jsonl'))},
    sealed_suites: {}, contract_files: {},
    checks: {oracle_grounding: true, meaning_preservation: true, leakage: !(leakage.sealed_leaks || leakage.natural_overlap_rows || leakage.jargon_in_rows), split_integrity: !splitIntegrity.problems.length, source_rights: true, token_budget: !tokenAudit.over_cap},
    evidence: {oracle_grounding: evidence('grounding'), meaning_preservation: evidence('meaning'), leakage: evidence('leakage'), split_integrity: evidence('split-integrity'), source_rights: {path: 'docs/specs/DS014-source-rights.md', sha256: sha(path.join(root, 'docs/specs/DS014-source-rights.md'))}, token_budget: evidence('token-audit')},
    reviewer: {kind: 'principal_integrator', id: reviewer, reviewed_at: now}, blockers,
    note: 'Data qualification only; not a chatsop-training-authorization-v1 receipt (AGENTS.md rule 3).'};
  if (!blockers.length) writeJson(path.join(root, `status/training/qualification-unified-qwen3-4b-${v}.json`), record);
}
console.log(JSON.stringify({...summary, leakage, tokens: tokenAudit, blockers}, null, 1));
if (blockers.length) process.exit(1);
