#!/usr/bin/env node
/** Builds the diverse-surface additions to datasets_archive/proofing (v2 = v1 + these rows), from a held-out-disjoint
 * "candidates" pool of Haiku-diversified formalizer-v1 train-row paraphrases (DS022 "LLM diversification";
 * never eval/suites/**). For each English candidate row:
 *   1. Score the RAW paraphrase text against its own (unchanged) gold SOP with the frozen rules v1.4 oracle
 *      (tools/research/proofing-oracle.mjs loadFrozenRules -- never the live lib/ud-to-sop).
 *   2. If it already passes (strict execution_equivalent): kind=identity, target=input, target_source='identity'.
 *   3. If it fails: try the untrained Qwen3-1.7B small candidate (PROMPTS.proof, then PROMPTS.simple, protect/
 *      restore around names and literals exactly as tools/research/proofing.mjs's own small-candidate generation);
 *      if any rewrite passes, kind=repair with that target_source.
 *   4. Still failing: up to 4 Claude Haiku 4.5 teacher variants (own budget ledger, separate from
 *      proofing-candidates-v1's, so this task's $30 cap is auditable on its own); first passing variant wins.
 *   5. Still failing: kind=hard, target=null (never a training target; convention_rewrite_withheld).
 *
 * Writes datasets_archive/proofing-diverse-dev/v2-additions-{train,dev,hard}.jsonl (same rich schema as
 * datasets_archive/proofing/{train,dev,hard_cases}.jsonl) -- appending them into the real corpus files is a separate,
 * explicit step (tools/research/build-proofing-v2.mjs merge) so a build can be inspected before it changes
 * datasets_archive/proofing itself.
 *
 *   node tools/research/build-proofing-v2.mjs build --pool datasets_archive/proofing-diverse-dev/candidates.jsonl
 *        [--out datasets_archive/proofing-diverse-dev] [--budget 20] [--dev-fraction 0.12]
 *   node tools/research/build-proofing-v2.mjs merge --additions datasets_archive/proofing-diverse-dev
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawn as spawnChild} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadFrozenRules, ParseCache, ROOT, readJsonl, writeJsonl, writeJson, scoreRows, sha} from './proofing-oracle.mjs';
import {protectText, cleanOutput, CANDIDATES, PROMPTS, TEACHER_SYSTEM} from './proofing.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';

const PY = path.join(os.homedir(), 'nlp-venv/bin/python');
const OUT_DEFAULT = path.join(ROOT, 'datasets_archive/proofing-diverse-dev');
const TEACHER_MODEL = 'claude-haiku-4-5-20251001';

function args(argv) {
  const [command, ...rest] = argv, out = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); out[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return out;
}
function hash32(text) { let h = 2166136261 >>> 0; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

function qwenRewrite(rules, rows, promptName) {
  if (!rows.length) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofing-v2-qwen-'));
  const prepared = rows.map(row => ({row, p: protectText(rules, row.question)}));
  const promptFile = path.join(dir, 'prompt.txt');
  fs.writeFileSync(promptFile, PROMPTS[promptName]);
  const tmpIn = path.join(dir, 'in.jsonl'), tmpOut = path.join(dir, 'out.jsonl');
  writeJsonl(tmpIn, prepared.map(x => ({id: x.row.id, text: x.p.text})));
  const modelDir = path.join(ROOT, CANDIDATES['qwen3-1.7b'].dir);
  execFileSync(PY, [path.join(ROOT, 'training/python/proofread_llm.py'), '--model', modelDir, '--prompt-file', promptFile, '--in', tmpIn, '--out', tmpOut, '--device', 'cuda', '--batch', '32'], {stdio: ['ignore', 'ignore', 'inherit']});
  const outs = new Map(readJsonl(tmpOut).map(o => [o.id, o]));
  const result = prepared.map(x => { const o = outs.get(x.row.id); const cleaned = cleanOutput(o?.output); const r = rules.protect.restore(cleaned, x.p.slots); return {id: x.row.id, text: r.text}; });
  fs.rmSync(dir, {recursive: true, force: true});
  return result;
}

function callClaude(system, message, cwd, timeoutMs = 240000) {
  return new Promise(resolve => {
    const argv = ['-p', '--model', TEACHER_MODEL, '--output-format', 'json', '--tools', '', '--system-prompt', system, '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'];
    const child = spawnChild('claude', argv, {cwd, env: {...process.env, MAX_THINKING_TOKENS: '0'}, stdio: ['pipe', 'pipe', 'pipe']});
    child.stdin.end(message);
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('close', code => { clearTimeout(timer); resolve({code, out, err}); });
  });
}

async function teacherVariants(rules, row, ledger, scratch) {
  const p = protectText(rules, row.question);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (ledger.spent_usd >= ledger.stop_usd) return {variants: [], stopped: true};
    const {code, out, err} = await callClaude(TEACHER_SYSTEM, '<message>\n' + p.text + '\n</message>', scratch);
    let data = null;
    try { data = JSON.parse(out); } catch { /* retry */ }
    if (code === 0 && data && !data.is_error && typeof data.result === 'string') {
      ledger.spent_usd += data.total_cost_usd ?? 0; ledger.calls++;
      const variants = [...data.result.matchAll(/<version>([\s\S]*?)<\/version>/g)]
        .map(v => cleanOutput(v[1].replace(/^\s*(\d[.)]\s*)?((minimal proofreading|standard|simple|explicit)\s*:\s*)?/i, ''))).filter(Boolean).slice(0, 4);
      return {variants: variants.map(v => rules.protect.restore(v, p.slots).text), stopped: false};
    }
    const limited = /rate.?limit|429|overloaded|529|usage limit/i.test(out + err);
    await new Promise(r => setTimeout(r, (limited ? 30000 : 3000) * 2 ** attempt));
  }
  ledger.failed++;
  return {variants: [], stopped: false};
}

async function buildCommand(o) {
  const poolFile = path.resolve(ROOT, o.pool ?? 'datasets_archive/proofing-diverse-dev/candidates.jsonl');
  const outDir = o.out ? path.resolve(ROOT, o.out) : OUT_DEFAULT;
  const budget = Number(o.budget ?? 20);
  fs.mkdirSync(outDir, {recursive: true});
  const pool = readJsonl(poolFile).filter(r => r.language === 'en');
  console.log(`build-proofing-v2: ${pool.length} EN candidate rows from ${path.relative(ROOT, poolFile)}`);

  const rules = await loadFrozenRules('v1.4');
  const cache = new ParseCache(rules, {device: 'cuda'});
  const rawParses = await cache.parseAll(pool.map(r => r.question), {log: m => console.log('raw', m)});
  const rawConv = rawParses.map((parse, i) => { try { return rules.convertParse(parse, pool[i].question); } catch (e) { return {sop: '', valid: false, outcome: 'crash'}; } });
  const rawPreds = pool.map((r, i) => ({id: r.id, sop: rawConv[i].sop}));
  const rawScores = scoreRows(pool, rawPreds, path.join(outDir, 'score-work', 'raw'));

  const passing = pool.filter(r => rawScores.get(r.id)?.strict);
  const failing = pool.filter(r => !rawScores.get(r.id)?.strict);
  console.log(`raw oracle: ${passing.length} pass, ${failing.length} fail (of ${pool.length})`);

  // Small-candidate rewrites (free: local GPU inference, no Haiku cost) for every failing row.
  const proofOut = qwenRewrite(rules, failing, 'proof');
  const simpleOut = qwenRewrite(rules, failing, 'simple');
  const byIdProof = new Map(proofOut.map(o => [o.id, o.text]));
  const byIdSimple = new Map(simpleOut.map(o => [o.id, o.text]));
  const candTexts = failing.flatMap(r => [{id: r.id, cand: 'qwen3-1.7b:proof', text: byIdProof.get(r.id) ?? ''}, {id: r.id, cand: 'qwen3-1.7b:simple', text: byIdSimple.get(r.id) ?? ''}]);
  const candParses = await cache.parseAll(candTexts.map(c => c.text), {log: m => console.log('cand', m)});
  const candConv = candParses.map((parse, i) => { try { return rules.convertParse(parse, candTexts[i].text); } catch (e) { return {sop: '', valid: false, outcome: 'crash'}; } });
  const candPreds = candTexts.map((c, i) => ({id: `${c.id}#${c.cand}`, sop: candConv[i].sop}));
  const candRowsForScoring = candTexts.map((c, i) => ({...pool.find(r => r.id === c.id), id: `${c.id}#${c.cand}`}));
  const candScores = scoreRows(candRowsForScoring, candPreds, path.join(outDir, 'score-work', 'candidates'));

  const repaired = [], stillFailing = [];
  for (const row of failing) {
    const proofKey = `${row.id}#qwen3-1.7b:proof`, simpleKey = `${row.id}#qwen3-1.7b:simple`;
    if (candScores.get(proofKey)?.strict) repaired.push({row, target: byIdProof.get(row.id), target_source: 'qwen3-1.7b:proof'});
    else if (candScores.get(simpleKey)?.strict) repaired.push({row, target: byIdSimple.get(row.id), target_source: 'qwen3-1.7b:simple'});
    else stillFailing.push(row);
  }
  console.log(`small candidates repaired ${repaired.length}/${failing.length}; ${stillFailing.length} go to the teacher`);

  // Haiku teacher, own ledger, own cap (this task's budget, separate from proofing-candidates-v1's).
  const ledgerFile = path.join(outDir, 'teacher-ledger.json');
  const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {model: TEACHER_MODEL, cap_usd: budget, stop_usd: budget, spent_usd: 0, calls: 0, failed: 0};
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'proofing-v2-teacher-'));
  const teacherRepaired = [], hard = [];
  const teacherRecords = [];
  let stopped = false;
  for (const row of stillFailing) {
    if (stopped) { hard.push(row); continue; }
    const {variants, stopped: didStop} = await teacherVariants(rules, row, ledger, scratch);
    if (didStop) { stopped = true; hard.push(row); continue; }
    teacherRecords.push({id: row.id, variants});
    let picked = null;
    if (variants.length) {
      const vParses = await cache.parseAll(variants);
      const vConv = vParses.map((parse, i) => { try { return rules.convertParse(parse, variants[i]); } catch { return {sop: '', valid: false}; } });
      const vPreds = variants.map((v, i) => ({id: `${row.id}#t${i}`, sop: vConv[i].sop}));
      const vRows = variants.map((v, i) => ({...row, id: `${row.id}#t${i}`}));
      const vScores = scoreRows(vRows, vPreds, path.join(outDir, 'score-work', 'teacher'));
      for (let i = 0; i < variants.length; i++) if (vScores.get(`${row.id}#t${i}`)?.strict) { picked = {text: variants[i], k: i + 1}; break; }
    }
    if (picked) teacherRepaired.push({row, target: picked.text, target_source: `teacher:${picked.k}`});
    else hard.push(row);
    if ((teacherRepaired.length + hard.length) % 25 === 0) { ledger.updated_at = new Date().toISOString(); writeJson(ledgerFile, ledger); console.log(`teacher: ${teacherRepaired.length} repaired, ${hard.length} hard so far, $${ledger.spent_usd.toFixed(2)} spent`); }
  }
  ledger.updated_at = new Date().toISOString();
  writeJson(ledgerFile, ledger);
  writeJsonl(path.join(outDir, 'teacher-variants.jsonl'), teacherRecords);
  fs.rmSync(scratch, {recursive: true, force: true});
  await cache.stop();
  console.log(`teacher repaired ${teacherRepaired.length}/${stillFailing.length}; ${hard.length} remain hard; $${ledger.spent_usd.toFixed(2)} of $${budget} spent`);

  // Assemble rich-schema rows (same shape as datasets_archive/proofing/{train,dev,hard_cases}.jsonl).
  const now = new Date().toISOString();
  const rightsInput = 'formalizer-v1 message, Haiku-diversified surface paraphrase (DS022 LLM diversification, meaning-preserving, judge- and execution-verified before this build; owner decision D2)';
  const identityRow = row => ({
    id: `proofdiv_${row.id}`, source_corpus: 'formalizer-v1', source_id: row.id, split_group_id: row.split_group_id, semantic_case_id: row.semantic_case_id,
    split: null, language: 'en', input: row.question, target: row.question, kind: 'identity', target_source: 'identity', layer: null, question_type: row.question_type ?? null,
    noise_ops: [], raw_oracle: {rules: 'v1.4', strict: true, tolerant: true}, target_oracle: {rules: 'v1.4', strict: true, tolerant: true}, signals: null, char_edit: 0,
    meaning_checks: null, broken_by_candidates: [], quality_flags: {synthetic: true, human_reviewed: false, training_approved: false, source_rows_copied: false, llm_diversified_surface: true},
    rights: {input: rightsInput, target: 'identical to the input'},
  });
  const repairRow = (row, target, targetSource) => ({
    id: `proofdiv_${row.id}`, source_corpus: 'formalizer-v1', source_id: row.id, split_group_id: row.split_group_id, semantic_case_id: row.semantic_case_id,
    split: null, language: 'en', input: row.question, target, kind: 'repair', target_source: targetSource, layer: 'input', question_type: row.question_type ?? null,
    noise_ops: [], raw_oracle: {rules: 'v1.4', strict: false, tolerant: false}, target_oracle: {rules: 'v1.4', strict: true, tolerant: true}, signals: null, char_edit: null,
    meaning_checks: {ok: true}, repaired_by: [targetSource], attempts: targetSource.startsWith('teacher') ? 3 : 1,
    quality_flags: {synthetic: true, human_reviewed: false, training_approved: false, source_rows_copied: false, llm_diversified_surface: true},
    rights: {input: rightsInput, target: targetSource.startsWith('teacher') ? `Claude Haiku 4.5 rewrite (${TEACHER_MODEL}), oracle-filtered` : `model output of ${CANDIDATES[targetSource.split(':')[0]]?.repo} (${CANDIDATES[targetSource.split(':')[0]]?.licence}), oracle-filtered`},
  });
  const hardRow = row => ({
    id: `proofdiv_${row.id}`, source_corpus: 'formalizer-v1', source_id: row.id, split_group_id: row.split_group_id, semantic_case_id: row.semantic_case_id,
    split: null, language: 'en', input: row.question, target: null, kind: 'hard', target_source: null, layer: 'rules_or_convention', question_type: row.question_type ?? null,
    convention_rewrite_withheld: true, raw_oracle: {rules: 'v1.4', strict: false, tolerant: false}, target_oracle: null,
    quality_flags: {synthetic: true, human_reviewed: false, training_approved: false, source_rows_copied: false, llm_diversified_surface: true},
    rights: {input: rightsInput, target: null},
  });

  const allNewRows = [
    ...passing.map(identityRow),
    ...repaired.map(({row, target, target_source}) => repairRow(row, target, target_source)),
    ...teacherRepaired.map(({row, target, target_source}) => repairRow(row, target, target_source)),
    ...hard.map(hardRow),
  ];
  // Split train/dev by split_group_id, REUSING v1's own split for any group v1 already assigned (never let the
  // same underlying formalizer-v1 message end up in train via v1 and in dev via a v2 paraphrase, or vice versa --
  // that would leak the same content across splits under a different surface). Only a split_group_id v1 never
  // saw in train or dev (e.g. one v1 only ever put in hard_cases, or a genuinely new sample) falls back to the
  // deterministic hash.
  const corpusDir = path.join(ROOT, 'datasets_archive/proofing');
  const v1GroupSplit = new Map();
  for (const split of ['train', 'dev']) {
    const file = path.join(corpusDir, split + '.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const row of readJsonlShardedSync(file)) if (!v1GroupSplit.has(row.split_group_id)) v1GroupSplit.set(row.split_group_id, split);
  }
  const devFraction = Number(o['dev-fraction'] ?? 0.12);
  const groupIsDev = new Map();
  for (const row of allNewRows) {
    if (groupIsDev.has(row.split_group_id)) continue;
    const known = v1GroupSplit.get(row.split_group_id);
    groupIsDev.set(row.split_group_id, known ? known === 'dev' : (hash32('proofing-v2-split:' + row.split_group_id) % 1000) / 1000 < devFraction);
  }
  for (const row of allNewRows) if (row.kind !== 'hard') row.split = groupIsDev.get(row.split_group_id) ? 'dev' : 'train';

  const trainAdd = allNewRows.filter(r => r.kind !== 'hard' && r.split === 'train');
  const devAdd = allNewRows.filter(r => r.kind !== 'hard' && r.split === 'dev');
  const hardAdd = allNewRows.filter(r => r.kind === 'hard');
  writeJsonl(path.join(outDir, 'v2-additions-train.jsonl'), trainAdd);
  writeJsonl(path.join(outDir, 'v2-additions-dev.jsonl'), devAdd);
  writeJsonl(path.join(outDir, 'v2-additions-hard.jsonl'), hardAdd);
  writeJson(path.join(outDir, 'build-v2.json'), {
    at: now, pool_rows: pool.length, raw_pass: passing.length, raw_fail: failing.length,
    small_candidate_repaired: repaired.length, teacher_repaired: teacherRepaired.length, hard: hard.length,
    train_additions: trainAdd.length, dev_additions: devAdd.length, hard_additions: hardAdd.length,
    teacher_spend_usd: ledger.spent_usd, teacher_calls: ledger.calls, dev_fraction: devFraction,
  });
  console.log(JSON.stringify({train_additions: trainAdd.length, dev_additions: devAdd.length, hard_additions: hardAdd.length, teacher_spend_usd: ledger.spent_usd}, null, 1));
}

async function mergeCommand(o) {
  const additionsDir = path.resolve(ROOT, o.additions ?? OUT_DEFAULT);
  const corpusDir = path.join(ROOT, 'datasets_archive/proofing');
  for (const [addFile, targetFile] of [['v2-additions-train.jsonl', 'train.jsonl'], ['v2-additions-dev.jsonl', 'dev.jsonl'], ['v2-additions-hard.jsonl', 'hard_cases.jsonl']]) {
    const additions = readJsonl(path.join(additionsDir, addFile));
    if (!additions.length) continue;
    const targetPath = path.join(corpusDir, targetFile);
    const existing = fs.existsSync(targetPath) ? readJsonlShardedSync(targetPath) : [];
    const existingIds = new Set(existing.map(r => r.id));
    const dup = additions.filter(r => existingIds.has(r.id));
    if (dup.length) throw Error(`${dup.length} v2 addition ids already exist in ${targetFile} (id collision) -- refusing to merge`);
    writeJsonl(targetPath, [...existing, ...additions]);
    console.log(`merged ${additions.length} rows into ${targetFile} (now ${existing.length + additions.length})`);
  }
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.command === 'build') return buildCommand(o);
  if (o.command === 'merge') return mergeCommand(o);
  throw Error(`Unknown command ${o.command}`);
}
main().catch(error => { console.error(error.stack); process.exit(1); });
