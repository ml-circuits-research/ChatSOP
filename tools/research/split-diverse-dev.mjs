#!/usr/bin/env node
/** Splits the pool of Haiku-diversified formalizer-v1 paraphrases (DS022 "LLM diversification") that passed
 * llm-diversify's own checks into two split_group_id-disjoint sets, BEFORE any model is scored on either:
 *   - diverse-dev: a held-out evaluation set (never used to build datasets_archive/proofing v2)
 *   - candidates: the pool tools/research/build-proofing-v2.mjs may turn into new datasets_archive/proofing rows
 * The split is a pure function of split_group_id (fnv1a hash), so it never depends on and can be computed before
 * any evaluation result -- listed here for the record, not because the mechanism is a secret.
 *
 *   node tools/research/split-diverse-dev.mjs --pools eval/reports/current/llm-diversify/pilot/accepted.jsonl,eval/reports/current/llm-diversify/diverse-dev-batch/accepted.jsonl
 *        --out datasets_archive/proofing-diverse-dev [--dev-fraction 0.5] [--min-en-dev 400]
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : [];
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const sha256 = text => createHash('sha256').update(text).digest('hex');
function hash32(text) { let h = 2166136261 >>> 0; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

function main() {
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf('--' + name); return i < 0 ? null : args[i + 1]; };
  const poolFiles = String(opt('pools')).split(',').map(f => path.resolve(ROOT, f.trim()));
  const outDir = path.resolve(ROOT, opt('out') ?? 'datasets_archive/proofing-diverse-dev');
  const devFraction = Number(opt('dev-fraction') ?? 0.5);
  const minEnDev = Number(opt('min-en-dev') ?? 400);

  const seen = new Set();
  const pool = [];
  for (const file of poolFiles) for (const row of readJsonl(file)) { if (seen.has(row.id)) continue; seen.add(row.id); pool.push(row); }

  const groups = [...new Set(pool.map(r => r.split_group_id))];
  const devGroups = new Set(groups.filter(g => (hash32('diverse-dev-split:' + g) % 1000) / 1000 < devFraction));
  const devRows = pool.filter(r => devGroups.has(r.split_group_id));
  const candidateRows = pool.filter(r => !devGroups.has(r.split_group_id));
  const enDevCount = devRows.filter(r => r.language === 'en').length;

  fs.mkdirSync(outDir, {recursive: true});
  const devFile = path.join(outDir, 'diverse-dev.jsonl'), candFile = path.join(outDir, 'candidates.jsonl');
  writeJsonl(devFile, devRows);
  writeJsonl(candFile, candidateRows);
  const byLang = rows => Object.fromEntries([...new Set(rows.map(r => r.language))].map(l => [l, rows.filter(r => r.language === l).length]));
  const manifest = {
    format: 'chatsop-diverse-dev-split-v1', built_at: new Date().toISOString(), source_pools: poolFiles.map(f => path.relative(ROOT, f)),
    method: 'deterministic fnv1a hash of split_group_id, threshold dev_fraction -- computed before any model is scored on either half; disjoint by split_group_id, never eval/suites/**',
    dev_fraction: devFraction, groups_total: groups.length, groups_dev: devGroups.size, groups_candidates: groups.length - devGroups.size,
    diverse_dev: {rows: devRows.length, by_language: byLang(devRows), sha256: sha256(fs.readFileSync(devFile, 'utf8')), min_en_target: minEnDev, en_target_met: enDevCount >= minEnDev},
    candidates: {rows: candidateRows.length, by_language: byLang(candidateRows), sha256: sha256(fs.readFileSync(candFile, 'utf8'))},
  };
  fs.writeFileSync(path.join(outDir, 'split-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(JSON.stringify(manifest, null, 1));
  if (!manifest.diverse_dev.en_target_met) { console.error(`only ${enDevCount} EN rows in diverse-dev, need >= ${minEnDev}`); process.exitCode = 3; }
}
main();
