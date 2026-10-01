import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { parse, canonical } from '../../sop/parser.mjs';
import { Lexicon } from '../../sop/lexicon.mjs';
import { MODEL_TYPES as modelTypes } from '../../sop/declarative.mjs';
import { alphaCanonical, checkLocalGraph } from './semantic-normalize.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const requireField = (condition, message) => { if (!condition) throw Error(message); };
const text = value => typeof value === 'string' && value.length > 0;
const splits = new Set(['train', 'dev', 'test']);
const statuses = new Set(['valid', 'ambiguous', 'underspecified', 'contradictory', 'unsupported']);
const inputModes = new Set(['query_only', 'assertions_query', 'clarification']);
const evaluationTracks = new Set(['formalization', 'system']);
const jsonValue = value => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || Array.isArray(value) && value.every(jsonValue) || value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(jsonValue);
export const canonicalTarget = source => { const graph = parse(source); checkLocalGraph(graph); return canonical(graph); };
// These fingerprints describe the compiler inputs, not a semantic approval.
export function authoringProvenance(row, markdown) {
  requireField(typeof markdown === 'string' && markdown.length > 0, `${row.id}: missing Markdown provenance`);
  return {
    split_key: row.split_group_id,
    case_md_sha256: sha256(markdown),
    parser_sha256: sha256(fs.readFileSync(new URL('../../sop/parser.mjs', import.meta.url))),
    prompt_sha256: sha256(fs.readFileSync(new URL('../../server/llm.mjs', import.meta.url))),
    ontology_sha256: sha256(row.ontology_sop ?? fs.readFileSync(new URL('../../config/knowledge/demo/0001-vocabulary.sop', import.meta.url), 'utf8')),
    review_status: 'integrator-authored-not-human-validated',
  };
}

export function validateAuthoringRecord(row, markdown) {
  validateRecord(row);
  const expected = authoringProvenance(row, markdown);
  requireField(row.authoring && Object.keys(expected).every(key => row.authoring[key] === expected[key])
    && Object.keys(row.authoring).length === Object.keys(expected).length, `${row.id}: missing or stale authoring provenance`);
  requireField(row.generation_trace.review_status === 'synthetic_unreviewed'
    && row.matrix?.provenance_class === 'synthetic_unreviewed'
    && row.quality_flags?.human_reviewed === false
    && row.quality_flags?.training_approved === false, `${row.id}: parse pass is not semantic review`);
  return row;
}
// Optional stricter policy for a newly isolated authoring collection; existing
// curriculum intentionally reuses families and structures across splits.
export function validateFamilyStructureIsolation(rows) {
  const owner = new Map(), members = new Map();
  for (const row of rows) {
    const keys = [`group:${row.split_group_id}`, `case:${row.semantic_case_id}`, `family:${row.matrix?.family_id}`, `structure:${row.structure_id}`];
    const touched = new Set(keys.map(key => owner.get(key)).filter(Boolean));
    const component = touched.values().next().value ?? { cases: new Set(), splits: new Set() };
    for (const other of touched) if (other !== component) {
      for (const key of members.get(other)) { owner.set(key, component); (members.get(component) ?? new Set()).add(key); }
      for (const name of other.cases) component.cases.add(name);
      for (const name of other.splits) component.splits.add(name);
      members.delete(other);
    }
    if (!members.has(component)) members.set(component, new Set());
    for (const key of keys) { owner.set(key, component); members.get(component).add(key); }
    component.cases.add(row.semantic_case_id);
    component.splits.add(row.split);
  }
  const crossings = [...members.keys()].filter(component => component.splits.size > 1)
    .map(component => ({ splits: [...component.splits].sort(), cases: [...component.cases].sort() }));
  requireField(!crossings.length, `Advisory family/structure components cross splits: ${JSON.stringify(crossings)}`);
  return { components: members.size };
}

export function validateRecord(row) {
  requireField(row && typeof row === 'object' && !Array.isArray(row), 'Dataset row must be an object');
  for (const field of ['id', 'semantic_case_id', 'split_group_id', 'structure_id', 'surface_group_id', 'question', 'sop_target']) requireField(text(row[field]), `${row.id ?? 'row'}: missing ${field}`);
  requireField(typeof row.setup_sop === 'string', `${row.id ?? 'row'}: missing setup_sop`);
  requireField(evaluationTracks.has(row.evaluation_track), `${row.id}: explicit formalization/system evaluation_track required`);
  requireField(['en', 'ro'].includes(row.language), `${row.id}: invalid language`);
  requireField(statuses.has(row.semantic_status), `${row.id}: invalid semantic_status`);
  requireField(row.negative_of === null || text(row.negative_of), `${row.id}: invalid negative_of`);
  requireField(Array.isArray(row.context_assertions) && row.context_assertions.every(text), `${row.id}: invalid context_assertions`);
  requireField(row.source && text(row.source.id) && text(row.source.kind) && text(row.source.uri) && text(row.source.revision) && /^[a-f0-9]{64}$/.test(row.source.sha256) && (row.source.license === null || text(row.source.license)), `${row.id}: invalid source provenance`);
  if (row.source.content !== undefined) requireField(typeof row.source.content === 'string' && sha256(row.source.content) === row.source.sha256, `${row.id}: source checksum mismatch`);
  if (row.source.content !== undefined && row.setup_sop) for (const wire of parse(row.setup_sop).wires) if (wire.type === 'fact') {
    const quote = wire.fields.quote?.[0];
    if (quote) requireField(row.source.content.includes(JSON.parse(quote)), `${row.id}: setup fact quote not found in source content`);
  }
  if (row.source.kind === 'synthetic_fixture' && row.source.uri === `synthetic://pilot/${row.source.id}`) {
    requireField(row.source.license === null, `${row.id}: invalid diagnostic pilot provenance`);
    requireField(sha256(row.context_assertions.join('\n') + '\n') === row.source.sha256, `${row.id}: source checksum mismatch`);
    for (const wire of parse(row.setup_sop).wires) if (wire.type === 'fact')
      requireField(wire.fields.source?.[0] === row.source.id && row.context_assertions.includes(JSON.parse(wire.fields.quote?.[0] ?? 'null')), `${row.id}: fact without exact source quote`);
  }
  requireField(row.generation_trace && text(row.generation_trace.method) && (row.generation_trace.template === null || text(row.generation_trace.template)) && (row.generation_trace.model === null || text(row.generation_trace.model)) && text(row.generation_trace.review_status), `${row.id}: invalid generation trace`);
  if (row.input_mode !== undefined) requireField(inputModes.has(row.input_mode), `${row.id}: invalid input_mode`);
  else requireField(row.source.kind === 'synthetic_fixture' && row.source.uri === `synthetic://pilot/${row.source.id}`, `${row.id}: missing input_mode`);
  requireField(row.quality_flags && typeof row.quality_flags === 'object' && !Array.isArray(row.quality_flags), `${row.id}: invalid quality_flags`);
  const context = row.context;
  requireField(context && Number.isFinite(Date.parse(context.now)) && context.language === row.language && Array.isArray(context.entities) && context.entities.every(e => text(e.id) && text(e.type)) && Array.isArray(context.predicates) && context.predicates.every(p => text(p.id) && Array.isArray(p.args)) && Array.isArray(context.approvedTemplates) && Array.isArray(context.procedures_sop), `${row.id}: invalid context`);
  requireField(row.expected && ['supported', 'refuted', 'both', 'unknown', 'clarify', 'stored', 'context_updated', 'possible', 'impossible', 'entailed', 'inconsistent'].includes(row.expected.status), `${row.id}: invalid expected status`);
  if (row.expected.answers !== undefined) requireField(Array.isArray(row.expected.answers) && row.expected.answers.every(tuple => Array.isArray(tuple) && tuple.every(jsonValue)), `${row.id}: invalid expected answer tuples`);
  if (row.expected.outputs !== undefined) requireField(row.expected.outputs && typeof row.expected.outputs === 'object' && !Array.isArray(row.expected.outputs) && jsonValue(row.expected.outputs), `${row.id}: invalid expected outputs`);
  if (row.expected.packet !== undefined) requireField(row.expected.packet && typeof row.expected.packet === 'object' && !Array.isArray(row.expected.packet) && jsonValue(row.expected.packet), `${row.id}: invalid expected packet`);
  if (row.expected.session_claims !== undefined) requireField(Array.isArray(row.expected.session_claims) && row.expected.session_claims.every(claim => claim && text(claim.holds) && text(claim.valid) && text(claim.source) && text(claim.quote) && ['normal', 'pinned'].includes(claim.retention)), `${row.id}: invalid expected session claims`);
  for (const [field, program] of [['sop_target', row.sop_target], ['setup_sop', row.setup_sop]]) {
    try { if (program) canonicalTarget(program); } catch (error) { throw Error(`${row.id}: invalid ${field}: ${error.message}`); }
  }
  if (row.ontology_sop !== undefined) {
    requireField(typeof row.ontology_sop === 'string', `${row.id}: invalid ontology_sop`);
    try { new Lexicon(row.ontology_sop); } catch (error) { throw Error(`${row.id}: invalid host ontology_sop: ${error.message}`); }
  }
  const wires = parse(row.sop_target).wires;
  const terminal = wires.at(-1).type;
  if (row.evaluation_track === 'formalization') {
    requireField(wires.every(wire => modelTypes.has(wire.type)), `${row.id}: formalization target contains execution or write wires`);
    requireField(!row.expected.session_claims?.length, `${row.id}: model statements must not become session claims`);
    requireField(row.input_mode !== 'assertions_query' || wires.some(wire => ['stated', 'assumed'].includes(wire.type)), `${row.id}: attached assertions must be interpreted as stated or assumed propositions`);
    requireField(row.expected.status !== 'clarify' || ['ambiguous', 'underspecified', 'unsupported'].includes(row.semantic_status), `${row.id}: host clarification needs ambiguous or underspecified declarative intent`);
    requireField(modelTypes.has(terminal), `${row.id}: formalization target must end in a model-language declaration`);
  } else {
    requireField(row.input_mode === 'assertions_query' || !wires.some(wire => wire.type === 'remember'), `${row.id}: only explicitly attached assertions may be recorded in system circuits`);
    requireField(['cnl', 'clarify', 'remember', 'solve'].includes(terminal), `${row.id}: system target must end in a result or explicit session record`);
  }
  return row;
}

export function validateCorpus(rows, { reservedStructures = [] } = {}) {
  requireField(Array.isArray(rows) && rows.length > 0, 'Corpus must have rows');
  const ids = new Set(), cases = new Map(), groups = new Map(), signatures = new Map(), surfaces = new Set(), structureSplits = new Map(), targets = new Map();
  for (const row of rows) {
    validateRecord(row);
    requireField(!ids.has(row.id), `Duplicate row id: ${row.id}`); ids.add(row.id);
    const surface = `${row.semantic_case_id}\0${row.language}\0${row.question}\0${row.context_assertions.join('\n')}`;
    requireField(!surfaces.has(surface), `${row.id}: duplicate semantic surface`);
    surfaces.add(surface);
    const target = alphaCanonical(row.sop_target);
    targets.set(row.id, target);
    const signature = JSON.stringify([row.split_group_id, target, row.setup_sop, row.source.id, row.source.sha256, row.input_mode, row.context.now, row.ontology_sop ?? null, row.context_assertions, row.expected]);
    const previous = signatures.get(signature);
    requireField(!previous || previous === row.semantic_case_id, `${row.id}: duplicate semantic case under different IDs`);
    signatures.set(signature, row.semantic_case_id);
    const group = groups.get(row.split_group_id);
    requireField(!group || group === row.split, `${row.id}: split_group_id leaks across splits`); groups.set(row.split_group_id, row.split);
    const c = cases.get(row.semantic_case_id);
    if (c) {
      requireField(targets.get(c.id) === target, `${row.id}: same-case target differs structurally; requires semantic adjudication and canonical target selection`);
      requireField(c.split === row.split && c.split_group_id === row.split_group_id && c.structure_id === row.structure_id && JSON.stringify(c.expected) === JSON.stringify(row.expected) && c.negative_of === row.negative_of && c.setup_sop === row.setup_sop && c.source.sha256 === row.source.sha256 && c.context.now === row.context.now && c.ontology_sop === row.ontology_sop, `${row.id}: semantic case inconsistent across surfaces`);
    }
    else cases.set(row.semantic_case_id, row);
    if (!structureSplits.has(row.structure_id)) structureSplits.set(row.structure_id, new Set());
    structureSplits.get(row.structure_id).add(row.split);
  }
  for (const row of cases.values()) if (row.negative_of !== null) {
    const source = cases.get(row.negative_of);
    requireField(source && source.split === row.split && source.split_group_id === row.split_group_id, `${row.id}: missing/crosssplit negative_of anchor`);
    const independentWorld = source.setup_sop !== row.setup_sop || source.source.sha256 !== row.source.sha256 || source.context.now !== row.context.now || source.ontology_sop !== row.ontology_sop || source.input_mode !== row.input_mode || JSON.stringify(source.context_assertions) !== JSON.stringify(row.context_assertions);
    const independentOracle = independentWorld && JSON.stringify(source.expected) !== JSON.stringify(row.expected);
    requireField(source.semantic_case_id !== row.semantic_case_id && (targets.get(source.id) !== targets.get(row.id) || independentOracle), `${row.id}: negative does not discriminate from anchor`);
  }
  // Compute transitive semantic components, including paired contrasts. Repeated
  // family/structure labels are deliberately not semantic identity edges.
  const adjacency = new Map([...cases.keys()].map(id => [id, new Set()]));
  const anchorByGroup = new Map();
  for (const row of cases.values()) {
    const anchor = anchorByGroup.get(row.split_group_id);
    if (anchor) { adjacency.get(row.semantic_case_id).add(anchor); adjacency.get(anchor).add(row.semantic_case_id); }
    else anchorByGroup.set(row.split_group_id, row.semantic_case_id);
    if (row.negative_of) { adjacency.get(row.semantic_case_id).add(row.negative_of); adjacency.get(row.negative_of).add(row.semantic_case_id); }
  }
  const seen = new Set();
  for (const id of cases.keys()) {
    if (seen.has(id)) continue;
    const pending = [id], component = [], componentSplits = new Set();
    while (pending.length) {
      const next = pending.pop();
      if (seen.has(next)) continue;
      seen.add(next); component.push(next); componentSplits.add(cases.get(next).split);
      pending.push(...adjacency.get(next));
    }
    requireField(componentSplits.size === 1, `Connected semantic group crosses splits: ${component.sort().join(', ')} (${[...componentSplits].sort().join(', ')})`);
  }
  for (const structure of reservedStructures) requireField(!structureSplits.get(structure)?.has('train'), `Reserved structure in train: ${structure}`);
  return { rows: rows.length, semantic_cases: cases.size, by_split: Object.fromEntries([...splits].map(split => [split, rows.filter(row => row.split === split).length])), by_structure: Object.fromEntries([...structureSplits].map(([id, set]) => [id, [...set].sort()])) };
}
