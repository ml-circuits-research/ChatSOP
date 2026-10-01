/**
 * Tangle typing of a stored analysis (decomposition evaluation, owner direction 2026-10-01).
 * "Tangled" means more than one finite clause, counted from the stored analysis: conj verbs, advcl, acl:relcl, ccomp or parataxis
 * verbs, several questions, a run-on or a list. `tangleOf(analysis)` returns {clauses, counts, types, primary}.
 */
export const TANGLE_TYPES = Object.freeze(['coordination', 'subordinate', 'relative', 'completive', 'multi_question', 'run_on', 'list']);
const VERBAL = new Set(['VERB', 'AUX']);

export function tangleOf(analysis) {
  const sentences = analysis?.sentences ?? [];
  const c = {conj_verb: 0, advcl: 0, relcl: 0, ccomp: 0, parataxis: 0, conj_noun: 0, comma: 0};
  let questions = 0, words = 0;
  for (const s of sentences) {
    const toks = s.tokens;
    if (/\?\s*$/.test(s.text)) questions++;
    const byId = new Map(toks.map(t => [t[0], t]));
    for (const t of toks) {
      if (t[3] !== 'PUNCT') words++;
      if (t[1] === ',') c.comma++;
      const [, , , upos, head, dep] = t;
      if (dep === 'conj') { if (VERBAL.has(upos)) c.conj_verb++; else if (upos === 'NOUN' || upos === 'PROPN') c.conj_noun++; }
      else if (dep === 'advcl') c.advcl++;
      else if (dep === 'acl:relcl') c.relcl++;
      else if (dep === 'ccomp') c.ccomp++;
      else if (dep === 'parataxis') c.parataxis++;
      void byId; void head;
    }
  }
  const clauses = sentences.length + c.conj_verb + c.advcl + c.relcl + c.ccomp + c.parataxis;
  const types = [];
  if (questions >= 2) types.push('multi_question');
  if (c.conj_noun >= 2 || c.conj_verb >= 3) types.push('list');
  if (c.conj_verb) types.push('coordination');
  if (c.advcl) types.push('subordinate');
  if (c.relcl) types.push('relative');
  if (c.ccomp) types.push('completive');
  if (c.parataxis || (sentences.length === 1 && c.comma >= 2 && clauses >= 2 && !types.length) || (sentences.length === 1 && words >= 28 && clauses >= 2)) types.push('run_on');
  // primary type by rarity: the strata are filled from the rarest type first
  const order = ['multi_question', 'list', 'completive', 'relative', 'run_on', 'subordinate', 'coordination'];
  const primary = order.find(t => types.includes(t)) ?? null;
  return {clauses, counts: c, questions, words, types, primary, tangled: clauses >= 2 && (clauses > sentences.length || questions >= 2) || questions >= 2};
}
