/** Content hash of the code that decides SymbolicLM output (lib/ud-to-sop, lib/symbolic-lm, config/symbolic-lm.json), the key of the result cache. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../../../lib/dataset-paths.mjs';

export function rulesVersion(root = ROOT) {
  const hash = createHash('sha1');
  for (const dir of ['lib/ud-to-sop', 'lib/symbolic-lm']) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter(n => n.endsWith('.mjs') || n.endsWith('.json')).sort()) hash.update(name).update(fs.readFileSync(path.join(full, name)));
  }
  const cfg = path.join(root, 'config/symbolic-lm.json');
  if (fs.existsSync(cfg)) hash.update(fs.readFileSync(cfg));
  return hash.digest('hex').slice(0, 12);
}
