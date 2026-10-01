/** Corpus rows from accepted paraphrases, and the build quota for LLM-authored rows (DS022 "LLM diversification").
 *
 * A paraphrase row is its source row with a new message: the gold target, accepted readings, verification world,
 * expected result, split and split group are reused unchanged, so correctness is inherited from the generator and
 * the row stays in its source's split group (no paraphrase can cross into another split). Frame resources are
 * dropped (the paraphrase chose its own frame), construction resources are kept (the predicate words are kept),
 * noise labels are cleared (the writer's register is unlabelled) and a code switch keeps only its languages.
 */
import {maskedTemplate} from '../diversity/quotas.mjs';
import {hash32} from '../diversity/text.mjs';

export const METHOD = 'llm-paraphrase';
/** At most this share of a build may be LLM-authored (data-improvement plan, risk 1). */
export const MAX_LLM_SHARE = 0.4;

export const entitySurfaces = row => (row.verification_context?.entities ?? []).flatMap(entity => [entity.label, ...(entity.aliases ?? [])]).filter(Boolean);

/** Construction resources name a predicate of the row ("works_at.en.0"); frames do not ("yn.en.1", "conj.ro.0"). */
const predicateIds = row => new Set([...(row.verification_context?.predicates ?? []).map(p => p.id), ...(row.world?.predicates ?? [])]);

export function paraphraseRow(source, {index, text, trace}) {
  const predicates = predicateIds(source);
  const id = `${source.id}_lp${index}`;
  return {
    ...source,
    id,
    surface_group_id: `${source.surface_group_id ?? source.id}_lp${index}`,
    question: text,
    noise: [],
    noise_level: null,
    code_switch: source.code_switch ? {kind: 'llm_paraphrase', matrix: source.code_switch.matrix ?? source.language, embedded: source.code_switch.embedded ?? null} : null,
    surface_design: {
      ...source.surface_design,
      question_frame: METHOD, discourse: METHOD, shape: source.surface_design?.shape ?? null, form: source.surface_design?.form ?? null,
      masked_template: maskedTemplate(text, entitySurfaces(source)),
      resources: (source.surface_design?.resources ?? []).filter(resource => predicates.has(resource.split('.')[0])),
    },
    source: {...source.source, authored_by: METHOD},
    rights: {...source.rights, license: 'MIT (repository LICENSE); message text written by an LLM under the provider terms (DS014 "LLM-authored text"); target inherited from the generator', authored_by: METHOD, llm: {provider: 'Anthropic', model: trace.model}, text_copied: false},
    quality_flags: {...source.quality_flags, llm_authored: true},
    generation_trace: {method: METHOD, source_row_id: source.id, review_status: 'synthetic_unreviewed', ...trace},
  };
}

/**
 * Mix generator rows with LLM-authored rows so that LLM rows are at most `maxShare` of the result. Which LLM rows
 * are kept is a seeded hash, so the mix is reproducible; dropped rows are reported, never silently lost.
 */
export function applyQuota(generatorRows, llmRows, {maxShare = MAX_LLM_SHARE, seed = 20260929} = {}) {
  if (llmRows.some(row => !['train', 'dev'].includes(row.split))) throw Error('LLM-authored rows may only extend train or dev');
  const limit = Math.floor(maxShare * generatorRows.length / (1 - maxShare));
  const ordered = [...llmRows].sort((a, b) => hash32(`${seed}:${a.id}`) - hash32(`${seed}:${b.id}`));
  const kept = ordered.slice(0, limit);
  return {rows: [...generatorRows, ...kept], kept: kept.length, dropped: ordered.length - kept.length, llm_share: kept.length / (generatorRows.length + kept.length)};
}
