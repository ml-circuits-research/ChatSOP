#!/usr/bin/env node
/**
 * LLM severity judge plumbing (DS016 "Graded severity", layer 3): omp task folders under datasets_sources/ and their verdicts.
 *   node tools/eval/severity-judge.mjs folder <name> --pairs residue.jsonl   # input items {id, a, b} -> datasets_sources/<name>/ (same layout as the calibration folders)
 * `loadVerdicts(name)` reads datasets_sources/<name>/output/verdicts.jsonl as Map id -> severity (S0..S4) or null when the answer is unusable.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {folder} from './severity-calibration.mjs';
import {readJsonl} from './severity-local.mjs';

export function loadVerdicts(name) {
  const f = path.join(ROOT, 'datasets_sources', name, 'output/verdicts.jsonl');
  const out = new Map();
  for (const r of readJsonl(f)) { const s = String(r.answer?.severity ?? '').toUpperCase(); out.set(r.id, /^S[0-4]$/.test(s) ? s : null); }
  return out;
}
export const folderFromPairs = (name, pairs) => folder(name, pairs.map(p => ({id: p.id, message: p.a, candidate: p.b})));

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, name, flag, file] = process.argv.slice(2);
  if (cmd === 'folder' && name && flag === '--pairs') console.log(JSON.stringify(folderFromPairs(name, readJsonl(file))));
  else { console.error('usage: folder <name> --pairs residue.jsonl'); process.exit(2); }
}
