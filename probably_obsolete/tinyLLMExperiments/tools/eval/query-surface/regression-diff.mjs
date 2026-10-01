#!/usr/bin/env node
/**
 * Explains the changed rows of a symbolic-regression replay report: for each changed row, does the old SOP and does
 * the new SOP match the gold SOP (strictly, or after the host's frame normalization)? A change is a fix when the new
 * SOP matches and the old did not, or when both differ from the gold and the new one is closer in structure; rows
 * without a gold SOP are listed for a manual reading.
 *
 *   node tools/eval/query-surface/regression-diff.mjs <report.json> [--out file.md]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRows} from '../../symbolic-regression.mjs';
import {loadFrames, normalizeProgram} from '../../../sop/frames.mjs';
import {diffCategories, classesOf} from '../../research/symbolic-layers-diff.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const frames = loadFrames();
const norm = sop => { try { return normalizeProgram(sop, frames).sop.trim(); } catch { return null; } };
const same = (a, b) => a.trim() === b.trim() || (norm(a) !== null && norm(a) === norm(b));
const flat = s => (s ?? '').replace(/\n\s*/g, ' ').replace(/ end /g, ' ¦ ').replace(/ polarity affirmed/g, '').replace(/relation /g, 'rel ').replace(/role /g, '');
const distance = (sop, gold, message) => { try { return diffCategories(sop, gold, {executed: false, message}).filter(c => !['C', 'E'].includes(classesOf([c])[0])).length; } catch { return 99; } };

export function explain(reportFile) {
  const report = JSON.parse(fs.readFileSync(path.resolve(ROOT, reportFile), 'utf8'));
  const rows = new Map(readRows(['train', 'dev', 'test']).map(r => [r.id, r]));
  const out = [];
  for (const c of report.changed) {
    const row = rows.get(c.id);
    const gold = row?.gold_sop ?? null;
    let verdict = 'no gold: read it';
    if (gold) {
      const was = same(c.was, gold), now = same(c.now ?? '', gold);
      const dw = distance(c.was, gold, c.message), dn = distance(c.now ?? '', gold, c.message);
      verdict = now && !was ? 'fix (now matches the gold)' : was && !now ? 'REGRESSION (lost a gold match)' : now && was ? 'equivalent' : dn < dw ? `fix (closer to the gold: ${dw} to ${dn} differences)` : dn === dw ? `neutral (${dn} differences either way)` : `WORSE (${dw} to ${dn} differences)`;
    }
    out.push({id: c.id, class: c.class, message: c.message.replace(/\n/g, ' ').slice(0, 140), was: flat(c.was), now: flat(c.now), gold: gold ? flat(gold) : null, verdict});
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const rows = explain(file);
  const tally = {};
  for (const r of rows) tally[r.verdict.replace(/ \(.*/, '')] = (tally[r.verdict.replace(/ \(.*/, '')] ?? 0) + 1;
  const text = `# Regression diff (${file})\n\n${Object.entries(tally).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n` + rows.map(r => `## ${r.id} (${r.class}): ${r.verdict}\n\n- message: ${r.message}\n- was: \`${r.was.slice(0, 400)}\`\n- now: \`${r.now.slice(0, 400)}\`\n${r.gold ? `- gold: \`${r.gold.slice(0, 400)}\`\n` : ''}`).join('\n');
  if (outFile) { fs.writeFileSync(path.resolve(ROOT, outFile), text); console.log(JSON.stringify(tally)); } else console.log(text);
}
