/** sha256 of the code and static resources that decide a SymbolicLM analysis (recorded in manifests and baselines). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';

const FILES = ['lib/symbolic-lm/index.mjs', 'lib/symbolic-lm/uncertainty.mjs', 'lib/languages-util/langid.mjs', 'lib/languages-util/spellfix.mjs', 'sop/dictionary.mjs', 'training/python/ud_parse_worker.py', 'config/symbolic-lm.json'];
const DIRS = ['lib/ud-to-sop'];

export function codeHashes() {
  const files = [...FILES];
  for (const dir of DIRS) for (const name of fs.readdirSync(path.join(ROOT, dir)).sort()) if (name.endsWith('.mjs')) files.push(`${dir}/${name}`);
  return Object.fromEntries(files.filter(f => fs.existsSync(path.join(ROOT, f))).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')]));
}
