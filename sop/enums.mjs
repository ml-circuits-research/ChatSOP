/**
 * Closed enumerations of SOP field values, `{type: {field: [values]}}`. The
 * parser, the lowerer and the audit tools read these exports; no check spells
 * an enumeration inline. `unclear.kind` comes from the single reply table in
 * sop/unclear.mjs.
 */
import {UNCLEAR_KINDS, REPLY_LANGUAGES, READING_KINDS} from './unclear.mjs';

export const POLARITIES = Object.freeze(['affirmed', 'negated']);
export const CERTAINTIES = Object.freeze(['asserted', 'hedged', 'supposed']);
export const BASES = Object.freeze(['closure', 'default', 'disambiguation', 'implicature', 'world']);
/**
 * The closed, context-free role inventory of model-language propositions (DS021).
 * The model names arguments with these words only; each lexicon predicate maps
 * its argument positions to them with `role NAME TYPE` lines.
 */
export const ROLE_NAMES = Object.freeze(['subject', 'object', 'recipient', 'location', 'source', 'destination', 'instrument', 'time', 'topic']);
/** Validity forms of a proposition: `valid on|from|until "text"`; the host normalizes the text. */
export const VALIDITY_FORMS = Object.freeze(['on', 'from', 'until']);
/** Output port modes: `output ?name MODE` on solve and reasoning operations (default one). */
export const OUTPUT_MODES = Object.freeze(['one', 'many', 'rows', 'count', 'status']);
/**
 * Query modes (DS021, DS004): `select` lists bindings, `exists` asks whether a binding exists, `count`
 * counts distinct selected bindings, `explain` asks why a proposition holds (the answer is its derivation),
 * `every` asks whether the `scope` holds for every binding of the `where` restriction (a universal question).
 */
export const QUERY_MODES = Object.freeze(['select', 'exists', 'count', 'explain', 'every']);
/** Part of a time variable's interval that a question asks for: since when, until when, how long. */
export const TIME_MEASURES = Object.freeze(['start', 'end', 'duration']);

export const ENUMS = Object.freeze({
  query: {mode: [...QUERY_MODES], measure: [...TIME_MEASURES]},
  constraint: {task: ['prove', 'possible', 'optimize'], direction: ['min', 'max']},
  rule: {mode: ['logical', 'causal']},
  event: {action: ['end', 'retract', 'correct']},
  resolve: {kind: ['entity', 'predicate', 'concept']},
  stated: {polarity: [...POLARITIES], certainty: [...CERTAINTIES]},
  assumed: {polarity: [...POLARITIES], basis: [...BASES]},
  unclear: {kind: Object.keys(UNCLEAR_KINDS), language: [...REPLY_LANGUAGES], readingKinds: [...READING_KINDS]},
});

/** Is `value` one of the closed values of `type.field`? */
export const allowed = (type, field, value) => ENUMS[type]?.[field]?.includes(value) === true;
