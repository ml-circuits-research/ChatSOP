/** JSONL helpers and the work directory of the decomposition work (shared by the evaluation tools and the iteration-3 data builders). */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';

export const WORK = path.join(ROOT, 'eval/reports/current/decomposition');
export const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
export const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
