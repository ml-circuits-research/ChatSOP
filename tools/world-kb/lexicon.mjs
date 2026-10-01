/**
 * Loads the world-v1 host lexicon shards into one Lexicon (sop/lexicon.mjs). The parser caps one file at 2,048 wires, so the
 * generated ontology is sharded; the shards are merged entry by entry (index offsets shifted). Used by the chat check
 * (eval/world-kb/chat.mjs) and by anything that needs the world vocabulary without editing the global config/ontology.sop.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Lexicon} from '../../sop/lexicon.mjs';

export function loadWorldLexicon(dir) {
  const merged = new Lexicon('', {provenance: 'world-v1'});
  const hash = createHash('sha256');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sop')).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    hash.update(text);
    const part = new Lexicon(text, {provenance: `world-v1/${f}`});
    const offset = merged.entries.length;
    merged.entries.push(...part.entries);
    for (const name of ['exact', 'folded']) for (const [k, list] of part[name]) { const cur = merged[name].get(k) ?? merged[name].set(k, []).get(k); for (const i of list) cur.push(i + offset); }
    for (const [k, set] of part.index) { const cur = merged.index.get(k) ?? merged.index.set(k, new Set()).get(k); for (const i of set) cur.add(i + offset); }
    Object.assign(merged.entities, part.entities);
    Object.assign(merged.predicates, part.predicates);
    Object.assign(merged.concepts, part.concepts);
  }
  merged.version = hash.digest('hex').slice(0, 16);
  return merged;
}
