/** Blocklist of the ChatSOP project's own jargon, built from the owner's natural messages (evaluation set) and the project vocabulary. Training rows containing a blocked term are dropped. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {fold} from '../../../sop/dictionary.mjs';
import {loadSpellfix} from '../../../lib/languages-util/spellfix.mjs';

// Only the ChatSOP project's OWN vocabulary (owner, 2026-10-01: common words such as review, docs, test, gate, smoke, agent, dataset are NOT jargon and must not be blocked)
const MANUAL = ['sop', 'sops', 'chatsop', 'symboliclm', 'languageproofingllm', 'symbolicproofingllm', 'languagesutil', 'translatorservice', 'texttocleanenglish', 'recallmemory', 'holomemory', 'wire', 'wires', 'wire_types', 'circuit', 'circuits', 'circuite', 'circuitul', 'circuitele', 'firele', 'firul', 'bad_english', 'symbolic_english', 'neuro_english', 'sigilat', 'sigilate'];
export function loadBlocklist() {
  const words = new Set(MANUAL.map(fold));
  const dir = path.join(ROOT, 'eval/reports/current/translate-compare');
  const sf = loadSpellfix(), common = new Set([...sf.dict.ro, ...sf.dict.en].map(fold));
  // words found in the owner's messages (discovered or detected spans) block a training row only when they are NOT ordinary Romanian or English words:
  // the blocklist targets the project's own vocabulary, not common words such as "fara" or "review"
    // From the owner's messages only identifier-like tokens (file names, paths, snake_case) are added: ordinary words, typos and words written without diacritics are not jargon.
  const addRare = w => { const f = fold(w).replace(/^[^a-z0-9_]+|[^a-z0-9_]+$/g, ''); if (f.length >= 3 && /[._/]/.test(f)) words.add(f); };
  if (fs.existsSync(path.join(dir, 'jargon-listed.txt'))) for (const l of fs.readFileSync(path.join(dir, 'jargon-listed.txt'), 'utf8').split('\n')) if (l && !l.startsWith('#')) addRare(l);
  for (const f of ['jargon-discovered.jsonl', 'jargon-spans.jsonl']) { const p = path.join(dir, f); if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (r.word) addRare(r.word); for (const s of r.spans ?? []) addRare(s.text); } }
  return words;
}
const tokens = text => fold(String(text)).split(/[^a-z0-9_]+/).filter(Boolean);
/** Is any token of `text` (or the whole term) in the blocklist? */
export const blocked = (text, bl) => { const t = tokens(text); return t.some(w => bl.has(w) || (w.length > 3 && bl.has(w.replace(/(ul|le|ii|lor|uri|ului|urile|a)$/, '')))); };
