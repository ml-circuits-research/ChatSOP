/** Causes of a composition loss: why the SOP of a paragraph differs from the concatenation of its components' SOPs (DS016 "Composed metrics").
 * Pure functions over a paragraph record of SymbolicLM and the case. Causes, in the order they are tested:
 *   sentence_boundary   SymbolicLM cut the paragraph into a different number of sentences than its components have alone
 *   unparsed_in_context a block `unparsed` appears that no component has alone
 *   temporal_leak       a query gained an `asof`/`at`/`during` line that its component does not have (a time frame spread across sentences)
 *   link_changed        a `because`/`so`/`if`/`after`... link line appears or vanishes
 *   block_count         another number of blocks
 *   content_changed     same number of blocks, some block body differs
 */
import {canonicalize} from './sop-canon.mjs';

const body = b => b.replace(/^@b\d+/, '@').replace(/\$b\d+/g, '$');
const LINK = /^\s+(because|so|if|unless|although|so_that|before|after|when|while)\s/;
const TIME = /^\s+(asof|at|during|since|until)\s/;

export function diagnose(row, paragraph, aloneRecords) {
  const aloneSentences = aloneRecords.reduce((n, r) => n + r.sentences.length, 0);
  if (paragraph.sentences.length !== aloneSentences) return 'sentence_boundary';
  const exp = canonicalize(row.components.map(c => c.expected_sop)).blocks, act = canonicalize([paragraph.sop]).blocks;
  if (act.some(b => /^@b\d+ unparsed/.test(b)) && !exp.some(b => /^@b\d+ unparsed/.test(b))) return 'unparsed_in_context';
  const extra = act.map(body).filter(b => !exp.map(body).includes(b)), missing = exp.map(body).filter(b => !act.map(body).includes(b));
  const linesOf = list => list.flatMap(b => b.split('\n'));
  const links = (a, b) => linesOf(a).filter(l => LINK.test(l)).length !== linesOf(b).filter(l => LINK.test(l)).length;
  const timeExtra = linesOf(extra).filter(l => TIME.test(l)).length > linesOf(missing).filter(l => TIME.test(l)).length;
  if (timeExtra) return 'temporal_leak';
  if (links(extra, missing)) return 'link_changed';
  if (act.length !== exp.length) return 'block_count';
  return 'content_changed';
}

export function tally(items) { const out = {}; for (const x of items) out[x] = (out[x] ?? 0) + 1; return out; }
