import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveDatasetPath } from '../../lib/dataset-paths.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const [file, out] = process.argv.slice(2).length === 4 && process.argv[2] === '--file' && process.argv[4] === '--out'
  ? [process.argv[3], process.argv[5]] : [];
try {
  assert(file && out, 'Usage: node tools/eval/baseline.mjs --file <suite.jsonl> --out eval/predictions/<name>.jsonl');
  const source = path.resolve(root, resolveDatasetPath(file)), destination = path.resolve(root, out);
  assert(((source.startsWith(path.join(root, 'datasets') + path.sep) || source.startsWith(path.join(root, 'datasets_archive') + path.sep)) && source.endsWith('/dev.jsonl')) ||
    (source.startsWith(path.join(root, 'eval/suites') + path.sep) && source.endsWith('/test.jsonl')), 'Baseline input must be a dev suite or sealed eval test suite');
  assert(destination.startsWith(path.join(root, 'eval/predictions') + path.sep) && destination.endsWith('.jsonl'), 'Baseline output must be eval/predictions/*.jsonl');
  const input = fs.readFileSync(source), rows = input.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  assert(rows.length && rows.every(row => typeof row.id === 'string' && typeof (row.sop_target ?? row.target) === 'string'), 'Suite rows must carry explicit IDs and targets');
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'Duplicate suite ID');
  const predictions = rows.map(row => JSON.stringify({ id:row.id, sop:row.sop_target ?? row.target })).join('\n') + '\n';
  const provenance = { format:'chatsop-baseline-predictions-v1', predictor_identity:'deterministic-baseline-gold-copy',
    claim:'Gold-copy evaluator sanity check only; not a model prediction or model accuracy.',
    command:`node tools/eval/baseline.mjs --file ${file} --out ${out}`,
    suite:file, suite_sha256:sha256(input), predictions:out, predictions_sha256:sha256(predictions), rows:rows.length };
  const provenanceText = JSON.stringify(provenance, null, 2) + '\n';
  if (fs.existsSync(destination) || fs.existsSync(destination + '.manifest.json')) {
    assert(fs.existsSync(destination) && fs.existsSync(destination + '.manifest.json'), 'Partial baseline artifacts; refuse to overwrite');
    assert(!fs.lstatSync(destination).isSymbolicLink() && !fs.lstatSync(destination + '.manifest.json').isSymbolicLink(), 'Symlink baseline artifacts refused');
    assert.equal(fs.readFileSync(destination, 'utf8'), predictions, 'Existing baseline predictions differ; refuse to overwrite');
    assert.equal(fs.readFileSync(destination + '.manifest.json', 'utf8'), provenanceText, 'Existing provenance differs; refuse to overwrite');
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive:true });
    fs.writeFileSync(destination, predictions, { flag:'wx' });
    fs.writeFileSync(destination + '.manifest.json', provenanceText, { flag:'wx' });
  }
  console.log(JSON.stringify({ predictions:out, rows:rows.length, predictor_identity:provenance.predictor_identity, suite_sha256:provenance.suite_sha256 }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
