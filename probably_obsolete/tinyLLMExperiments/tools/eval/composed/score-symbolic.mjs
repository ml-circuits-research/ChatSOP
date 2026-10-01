/** Scoring of SymbolicLM alone on composed paragraphs (K1 all symbolic, K3 identity long, K5 reference across sentences).
 *
 * For each case: the paragraph is analysed as one message; every component is analysed alone (cached). Measures
 *   sop_exact            the paragraph SOP equals the concatenation of the components' stored SOPs modulo id renumbering
 *   sop_vs_alone         the paragraph SOP equals the concatenation of what SymbolicLM gives each component alone now
 *   components_ok        share of components whose blocks are right in the paragraph
 *   analysis_equal       every component's sentences get the same tokens, heads and labels as when analysed alone, and no sentence is cut or merged
 *   components_alone_ok  every component alone still equals its stored SOP (else a miss is a component regression, not a composition effect)
 * Composition effect = cases whose components all pass alone but whose paragraph does not.
 */
import {compareParagraph} from './sop-canon.mjs';
import {handled} from './lm.mjs';
import {diagnose, tally} from './diagnose.mjs';
import {rateBy, wilson} from './stats.mjs';

const tokenKey = sentences => JSON.stringify(sentences.map(s => s.tokens.map(t => [t[1], t[2], t[3], t[4], t[5]])));

/** Text to analyse alone for a component: the original text (K5 references also have a named twin, scored separately). */
export async function scoreCase(row, lm) {
  const t0 = Date.now();
  const paragraph = await lm.run(row.message);
  const alone = [];
  // A reference sentence (K5) is analysed alone in its named form: the pronoun cannot be resolved without the earlier sentence.
  for (const c of row.components) alone.push(await lm.run(c.named_text ?? c.text));
  const expected = row.components.map(c => c.expected_sop);
  const vsStored = compareParagraph(paragraph.sop, expected);
  const vsAlone = compareParagraph(paragraph.sop, alone.map(a => a.sop));
  const componentsAloneOk = alone.map((a, i) => compareParagraph(a.sop, [expected[i]]).exact);
  let named = null;
  if (row.kind === 'K5') {
    const last = row.components[row.components.length - 1], prior = row.components.slice(0, -1);
    const namedRun = await lm.run([...prior.map(p => p.text), last.named_text].join(row.joiner));
    named = compareParagraph(namedRun.sop, [...prior.map(p => p.expected_sop), last.expected_sop]).exact;
  }
  const alonePar = alone.flatMap(a => a.sentences);
  const analysisEqual = paragraph.sentences.length === alonePar.length && tokenKey(paragraph.sentences) === tokenKey(alonePar);
  return {
    id: row.id, kind: row.kind, lm_id: lm.id, stratum: row.stratum, n_components: row.n_components, n_sentences: row.n_sentences,
    sop_exact: vsStored.exact, sop_vs_alone: vsAlone.exact, components_ok: vsStored.per_component.filter(Boolean).length, analysis_equal: analysisEqual,
    sentence_split_ok: paragraph.sentences.length === alonePar.length, components_alone_ok: componentsAloneOk.every(Boolean), components_alone_ok_n: componentsAloneOk.filter(Boolean).length,
    blocks: {expected: vsStored.expected_blocks, actual: vsStored.actual_blocks}, outcome: paragraph.outcome, valid: paragraph.valid, handled: handled(paragraph), uncertain: paragraph.uncertain,
    cause: vsStored.exact ? null : diagnose(row, paragraph, alone), named_paragraph_exact: named, reference: row.reference ?? null, ms: Date.now() - t0,
  };
}

/** Rates with Wilson intervals by number of sentences (K1/K3/K5 stratum), for the measures above. */
export function summarize(records) {
  const by = r => r.stratum ?? String(r.n_components);
  const out = {cases: records.length};
  for (const [name, pred] of [['sop_exact', r => r.sop_exact], ['sop_vs_alone', r => r.sop_vs_alone], ['analysis_equal', r => r.analysis_equal], ['sentence_split_ok', r => r.sentence_split_ok], ['components_alone_ok', r => r.components_alone_ok], ['handled', r => r.handled]]) out[name] = rateBy(records, by, pred);
  const isolated = records.filter(r => r.components_alone_ok);
  out.composition_effect = {cases_with_all_components_ok_alone: isolated.length, ...rateBy(isolated, by, r => r.sop_exact)};
  out.causes_of_loss = tally(records.filter(r => r.cause).map(r => (r.components_alone_ok ? '' : 'component_regression+') + r.cause));
  const comp = records.reduce((a, r) => ({k: a.k + r.components_ok, n: a.n + r.n_components}), {k: 0, n: 0});
  out.components = wilson(comp.k, comp.n);
  const cn = records.reduce((a, r) => ({k: a.k + r.components_alone_ok_n, n: a.n + r.n_components}), {k: 0, n: 0});
  out.components_alone = wilson(cn.k, cn.n);
  return out;
}
