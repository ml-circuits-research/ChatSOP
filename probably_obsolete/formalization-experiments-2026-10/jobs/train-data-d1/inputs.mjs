/**
 * Inputs of train-data-d1 (status/preregistrations/train-psm-lfm-v1.json, D1): scorable book problems never seen in an evaluation and
 * outside the frozen strict held-out units (tools/eval/structure-formalizer/heldout.mjs), ordered round-robin over the books in a seeded
 * hash order, so any prefix (the pilot's 50) is balanced across books. The prompt sees only `sentences` (the problem, one numbered
 * sentence per line); the gold fields stay in the item for the deterministic verification, never in a prompt.
 */
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadItems, loadSeen} from '../../tools/eval/books/sample.mjs';
import {goldOf} from '../../tools/eval/structure-formalizer/gold.mjs';
import {heldoutUnits, unitOf} from '../../tools/eval/structure-formalizer/heldout.mjs';
import {sentencesOf} from '../../lib/formalize/fol/input.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEED = 'train-data-d1';

export function inputs() {
  const held = heldoutUnits(), seen = loadSeen(ROOT);
  const pool = loadItems(ROOT).filter(i => goldOf(i) && !seen.has(i.id) && !held.has(unitOf(i)));
  const rank = id => createHash('sha256').update(`${SEED}/${id}`).digest('hex');
  const byBook = new Map();
  for (const i of pool.sort((a, b) => rank(a.id).localeCompare(rank(b.id)))) { if (!byBook.has(i.book)) byBook.set(i.book, []); byBook.get(i.book).push(i); }
  const books = [...byBook.keys()].sort((a, b) => rank(a).localeCompare(rank(b)));
  const out = [];
  for (let k = 0; out.length < pool.length; k++) for (const b of books) { const i = byBook.get(b)[k]; if (i) out.push(i); }
  return out.map(i => ({id: i.id, book: i.book, question: i.question, answer: i.answer, answer_value: i.answer_value, answer_kind: i.answer_kind,
    sentences: sentencesOf(i.question).map((u, k) => `s${k + 1}: ${u.text}`).join('\n')}));
}
