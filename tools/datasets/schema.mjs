import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { parse, canonical } from '../../sop/parser.mjs';
import { Lexicon } from '../../sop/lexicon.mjs';
import { alphaCanonical, checkLocalGraph } from './semantic-normalize.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const templateRevision = sha256(fs.readFileSync(new URL('../../datasets/templates/pilot.json', import.meta.url), 'utf8'));
const requireField = (condition, message) => { if (!condition) throw Error(message); };
const text = value => typeof value === 'string' && value.length > 0;
const splits = new Set(['train', 'dev', 'test']);
const statuses = new Set(['valid', 'ambiguous', 'underspecified', 'contradictory', 'unsupported']);
const inputModes = new Set(['query_only', 'assertions_query', 'clarification']);
const jsonValue = value => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || Array.isArray(value) && value.every(jsonValue) || value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(jsonValue);
export const canonicalTarget = source => { const graph = parse(source); checkLocalGraph(graph); return canonical(graph); };

export function validateRecord(row) {
  requireField(row && typeof row === 'object' && !Array.isArray(row), 'Dataset row must be an object');
  for (const field of ['id', 'semantic_case_id', 'split_group_id', 'structure_id', 'surface_group_id', 'question', 'sop_target']) requireField(text(row[field]), `${row.id ?? 'row'}: missing ${field}`);
  requireField(typeof row.setup_sop === 'string', `${row.id ?? 'row'}: missing setup_sop`);
  requireField(splits.has(row.split), `${row.id}: invalid split`);
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
    requireField(row.source.revision === templateRevision && row.source.license === null, `${row.id}: invalid diagnostic pilot provenance`);
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
  requireField(row.expected && ['supported', 'refuted', 'both', 'unknown', 'clarify', 'stored', 'possible', 'impossible', 'entailed', 'inconsistent'].includes(row.expected.status), `${row.id}: invalid expected status`);
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
  requireField(row.input_mode === 'assertions_query' || !wires.some(wire => wire.type === 'assert'), `${row.id}: only assertions_query may write session assertions`);
  const assumedRefs = new Set(wires.flatMap(wire => wire.fields.assume ?? []).map(ref => String(ref).replace(/^\$/, '')));
  for (const wire of wires) if (wire.type === 'fact') {
    const source = wire.fields.source?.[0];
    requireField(source === 'user' || source === 'assumption', `${row.id}: conversational facts must declare source user or assumption`);
    if (source === 'assumption') requireField(assumedRefs.has(wire.id), `${row.id}: an assumption fact must be consumed by an assume field`);
  }
  const terminal = wires.at(-1).type;
  requireField(['cnl', 'clarify', 'assert'].includes(terminal) || row.input_mode === undefined && terminal === 'solve', `${row.id}: conversational target must end cnl/clarify/assert`);
  requireField(row.expected.status !== 'clarify' || terminal === 'clarify' && ['ambiguous', 'underspecified', 'unsupported'].includes(row.semantic_status), `${row.id}: clarification requires ambiguity, underspecification or unsupported operation`);
  requireField(terminal !== 'assert' || row.input_mode === 'assertions_query' && row.expected.status === 'stored', `${row.id}: assert requires assertions_query and stored result`);
  requireField(terminal !== 'cnl' || row.expected.status !== 'stored', `${row.id}: stored result needs assert terminal`);
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
  for (const structure of reservedStructures) requireField(!structureSplits.get(structure)?.has('train'), `Reserved structure in train: ${structure}`);
  return { rows: rows.length, semantic_cases: cases.size, by_split: Object.fromEntries([...splits].map(split => [split, rows.filter(row => row.split === split).length])), by_structure: Object.fromEntries([...structureSplits].map(([id, set]) => [id, [...set].sort()])) };
}
