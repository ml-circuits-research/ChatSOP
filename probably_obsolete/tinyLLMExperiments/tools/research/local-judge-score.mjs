#!/usr/bin/env node
/** Scores local-judge verdicts (tools/research/local-judge.mjs) with the existing report code (experiment eval-local-judge-v1).
 *
 *   node tools/research/local-judge-score.mjs parse   --verdicts FILE --dir SCRATCH   # verdicts of conditions a and c
 *   node tools/research/local-judge-score.mjs meaning --verdicts FILE --dir SCRATCH   # verdicts of m1, m2, m1r
 *
 * parse:   writes SCRATCH/{reference,extension,results-a,results-c}.jsonl and runs parse-judge-report.mjs `report()` with
 *          PARSE_JUDGE_OUT=SCRATCH, so metrics.json (kappa, weighted good precision and recall, the Stanza-spaCy
 *          identical-trees AND judge gates) is computed exactly as for DeepSeek flash and Haiku.
 * meaning: writes SCRATCH/output/verdicts.jsonl and runs tools/datasets/meaning-judge/score-calibration.mjs
 *          (--tag v2 labels and adjudication) with --out SCRATCH, giving calibration.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(x => x.trim()).map(JSON.parse);
const [cmd] = process.argv.slice(2);
const verdictsFile = arg('verdicts'), dir = path.resolve(arg('dir') ?? '');
if (!['parse', 'meaning'].includes(cmd) || !verdictsFile || !arg('dir')) { console.error('usage: local-judge-score.mjs parse|meaning --verdicts FILE --dir SCRATCH'); process.exit(2); }
fs.mkdirSync(dir, {recursive: true});
const rows = readJsonl(verdictsFile);

if (cmd === 'parse') {
  const OUT = 'eval/reports/current/parse-judge';
  for (const f of ['reference.jsonl', 'extension.jsonl']) fs.copyFileSync(path.join(ROOT, OUT, f), path.join(dir, f));
  for (const c of ['a', 'c']) {
    const lines = rows.filter(r => r.condition === c).map(r => {
      const verdict = r.answer?.verdict ?? null;
      return JSON.stringify({id: r.id, verdict, good_enough: ['CORRECT', 'MINOR', 'INPUT_TYPO'].includes(verdict), condition: c, model: 'local', sentences: [{text: '', verdict, api_ms: r.ms ?? null}], cost_usd: 0, ms: r.ms ?? null});
    });
    fs.writeFileSync(path.join(dir, `results-${c}.jsonl`), lines.join('\n') + (lines.length ? '\n' : ''));
  }
  process.env.PARSE_JUDGE_OUT = path.relative(ROOT, dir).startsWith('..') ? dir : path.relative(ROOT, dir);
  process.chdir(ROOT);
  const {report} = await import('./parse-judge-report.mjs');
  report();
} else {
  fs.mkdirSync(path.join(dir, 'output'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'output/verdicts.jsonl'), rows.map(r => JSON.stringify({id: r.id, condition: r.condition, answer: r.answer})).join('\n') + '\n');
  const res = spawnSync('node', ['tools/datasets/meaning-judge/score-calibration.mjs', '--tag', 'v2', '--folder', dir, '--out', dir], {cwd: ROOT, stdio: 'inherit'});
  process.exit(res.status ?? 1);
}
