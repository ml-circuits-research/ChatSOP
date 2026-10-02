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
 * The closed, context-free role inventory of model-language propositions (DS014).
 * The model names arguments with these words only; each lexicon predicate maps
 * its argument positions to them with `role NAME TYPE` lines.
 */
export const ROLE_NAMES = Object.freeze(['subject', 'object', 'recipient', 'location', 'source', 'destination', 'instrument', 'time', 'topic']);
/**
 * Copula readings (DS014 "KnowledgeLinker: the copula"): the only readings of "be" the linker code knows. A base
 * memory declares which of its predicates carry one (`reading NAME` on a predicate wire); the linker never names a
 * predicate itself. `class` = membership in a kind, `occupation` = what someone does for a living, `attribute` = a
 * property, `identity` = the same thing, `location` = where something is, `describe` = a predicate whose facts about a
 * subject answer "who/what is X?" (ranked by `describe_rank`). Two readings serve comparisons of quantities (sop/quantities.mjs), not
 * the copula: `unit_amount` = how many base units one of the subject unit is, `unit_dimension` = the dimension the subject unit measures.
 */
export const COPULA_READINGS = Object.freeze(['class', 'occupation', 'attribute', 'identity', 'location', 'describe', 'unit_amount', 'unit_dimension']);
/** Validity forms of a proposition: `valid on|from|until "text"`; the host normalizes the text. */
export const VALIDITY_FORMS = Object.freeze(['on', 'from', 'until']);
/** Output port modes: `output ?name MODE` on solve and reasoning operations (default one). */
export const OUTPUT_MODES = Object.freeze(['one', 'many', 'rows', 'count', 'status']);
/**
 * Query modes (DS014, DS004): `select` lists bindings, `exists` asks whether a binding exists, `count`
 * counts distinct selected bindings, `explain` asks why a proposition holds (the answer is its derivation),
 * `every` asks whether the `scope` holds for every binding of the `where` restriction (a universal question).
 */
export const QUERY_MODES = Object.freeze(['select', 'exists', 'count', 'explain', 'every']);
/**
 * The five reasoning modes of the knowledge language (DS004 "Query modes", DS006): `why_not` asks what would make a claim
 * derivable, `plan` asks how a goal is reached, `abduce` asks for the minimal explanations of an observation, `conform`
 * asks whether a performed trace complies with the procedures and norms in force, `procedure` asks for the approved
 * procedure of a task. They are question forms, never operations; the model language lists them in `QUERY_MODES` only
 * where DS014 says so.
 */
export const REASONING_QUERY_MODES = Object.freeze(['why_not', 'plan', 'abduce', 'conform', 'procedure']);
/** Part of a time variable's interval that a question asks for: since when, until when, how long. */
export const TIME_MEASURES = Object.freeze(['start', 'end', 'duration']);

/**
 * Words-only model forms (DS014 "Words, not operators"). Comparators of `compare` lines and constraint
 * expressions, arithmetic words of constraint expressions, the directions of `rank`, the quantifier words of
 * `mode every`, the ordering words of `order` and the kinds of `fragment`. The host lowers the words to its
 * internal operators; a model-authored wire never spells an operator symbol.
 */
export const COMPARATOR_WORDS = Object.freeze({above: '>', below: '<', at_least: '>=', at_most: '<=', equal: '==', not_equal: '!='});
export const ARITHMETIC_WORDS = Object.freeze({plus: '+', minus: '-', times: '*', divided_by: '/'});
/**
 * The words of a rule's `compute ?v A WORD B` leaf (DS004 "Exact arithmetic", owner 2026-10-02: problems state their own numbers):
 * the four arithmetic words with exact decimal results (`divided_by` is exact: 7 divided_by 2 is 3.5), and `whole_divided_by`
 * (the integer quotient, truncated toward zero), `modulo` (the remainder of the whole division), `power` (an integer exponent
 * from 0 to 64), `rounded_to`, `rounded_up_to` and `rounded_down_to` (A to the nearest, next or previous multiple of B: `rounded_to 0.01`
 * gives cents, `rounded_up_to 1` the whole number of batches). Numbers are integers or decimals.
 */
export const COMPUTE_WORDS = Object.freeze([...Object.keys(ARITHMETIC_WORDS), 'whole_divided_by', 'modulo', 'power', 'rounded_to', 'rounded_up_to', 'rounded_down_to', 'minimum_with', 'maximum_with']);
/** The compute words whose results the integer-only engines reproduce (truncating whole division); every other word, and any decimal operand, needs `exact_arithmetic`. */
export const INTEGER_COMPUTE_WORDS = Object.freeze(['plus', 'minus', 'times', 'whole_divided_by']);
export const RANK_WORDS = Object.freeze(['highest', 'lowest']);
/** Optional cut after the variable of `rank`: `position 2` (the second best value, "the second largest") or `top 3` (the three best values). */
export const RANK_CUTS = Object.freeze(['position', 'top']);
export const QUANTIFIER_WORDS = Object.freeze(['all', 'none', 'not_all', 'most', 'half', 'at_least']);
export const ORDER_WORDS = Object.freeze(['before', 'after', 'same_time']);
/**
 * The single-word sampling form of `order` (DS004 "Sampling", DS014 "Words, not operators"): `order random` returns the answers of a `mode select` query in
 * a seeded random order, and with `limit N` a random sample of N of them ("a random fact", "give me some examples"). The answer set is
 * the one without the line; at most one per query; `ORDER_SAMPLING_MODES` are the modes it applies to (`order_random_mode` otherwise).
 */
export const ORDER_SAMPLING = Object.freeze(['random']);
export const ORDER_SAMPLING_MODES = Object.freeze(['select']);
export const FRAGMENT_KINDS = Object.freeze(['follow_up']);

/**
 * Clause links (DS014 "Clauses and links", owner decisions L1, L2 and L4 of 2026-09-29). One finite clause of the
 * message is one short wire; a subordinate or result clause is related to its main clause by one keyword line
 * `KEYWORD $id` on a `stated`, `assumed` or `query` wire. The keywords are the English conjunctions themselves
 * (the owner's L2 choice over an abstract `clause TYPE`); each maps to one semantic type of the PDTB-3-derived
 * inventory, which is what the host acts on. This one table is the whole set, so an experiment can compare a
 * different keyword variant by swapping it. Every keyword except `so` sits on the main clause and points at the
 * clause the conjunction introduces; `so` (a result) sits on the effect clause and points at its cause.
 *
 * `target` says what the linked wire must be: `supposed` requires a `stated` wire with `certainty supposed`
 * (a condition or a purpose is not asserted to have happened); `any` accepts any `stated` or `assumed` wire.
 */
export const LINK_KEYWORDS = Object.freeze({
  because: Object.freeze({type: 'cause', target: 'any'}),
  so: Object.freeze({type: 'cause', target: 'any'}),
  if: Object.freeze({type: 'condition', target: 'supposed'}),
  unless: Object.freeze({type: 'negative_condition', target: 'supposed'}),
  although: Object.freeze({type: 'concession', target: 'any'}),
  so_that: Object.freeze({type: 'purpose', target: 'supposed'}),
  before: Object.freeze({type: 'before', target: 'any'}),
  after: Object.freeze({type: 'after', target: 'any'}),
  when: Object.freeze({type: 'during', target: 'any'}),
  while: Object.freeze({type: 'during', target: 'any'}),
});
/** The link keyword lines, in table order; each takes exactly one `$id`. */
export const LINK_WORDS = Object.freeze(Object.keys(LINK_KEYWORDS));
/** The semantic types the host distinguishes (DS014): conditions scope a query, timed temporal links bound its period. */
export const LINK_TYPES = Object.freeze([...new Set(Object.values(LINK_KEYWORDS).map(link => link.type))]);
/** At most this many link lines per wire (`link_too_many`). */
export const MAX_LINKS = 3;
/**
 * `unparsed` (DS014 "Honest partial formalization", owner decision of 2026-09-29): a verbatim span of the message the
 * model could not formalize. `hint` names the slot the span probably fills: a role name (`subject`, `object`,
 * `time`, `location`), a `value`, the `relation` of the `near` wire, a `reference` to something said earlier, or
 * `other`.
 */
export const UNPARSED_HINTS = Object.freeze(['subject', 'object', 'time', 'location', 'value', 'relation', 'reference', 'other']);
/** Hints that pair with a placeholder variable of any role (a role-name hint pairs with that role only). */
export const GENERIC_HINTS = Object.freeze(['value', 'reference', 'other']);
/** Longest `unparsed` span, in characters. */
export const MAX_SPAN = 200;
/** Status of a link in the packet (`clause_links[].status`): applied by the host, or recorded and reported only. */
export const LINK_STATUSES = Object.freeze(['applied', 'not_checked']);

/**
 * `pragmatic` (DS023, owner decisions of 2026-10-01 and 2026-10-02): what a message does besides stating or asking (courtesy,
 * emotion, tone), written by the formalizer in the same understanding step as the query (basis `llm`). The closed kinds and the
 * closed bases (how the signal was found) are listed here; a signal is the system's subjective perception, never a fact about
 * the world: it shapes the reply (a courtesy reply, the tone of an answer) and never becomes evidence.
 */
export const PRAGMATIC_KINDS = Object.freeze(['greeting', 'closing', 'thanks', 'apology', 'politeness', 'urgency', 'frustration', 'anger', 'confusion', 'curiosity', 'joy', 'sadness', 'fear', 'disappointment', 'hedge', 'emphasis', 'profanity', 'offensive', 'irony_possible', 'confirmation_request', 'topic_shift', 'unclassified']);
export const PRAGMATIC_BASES = Object.freeze(['lexicon', 'pattern', 'classifier', 'llm']);

/**
 * `instruction` (behaviour layer, owner decision of 2026-10-02): what the user asks about how the assistant should answer from now on,
 * written by the formalizer. `do set` adds an instruction, `do cancel` withdraws the active one of its kind (or all, without a kind),
 * `do list` asks for the active instructions. The kinds: `prefix` and `suffix` (start or end every answer with the verbatim `text`),
 * `short` and `detailed` (the answer style). An instruction is never a fact: it becomes behaviour data of the conversation (DS023).
 */
export const INSTRUCTION_ACTIONS = Object.freeze(['set', 'cancel', 'list']);
export const INSTRUCTION_KINDS = Object.freeze(['prefix', 'suffix', 'short', 'detailed']);
/** Instruction kinds that carry the verbatim `text` they add to every answer. */
export const INSTRUCTION_TEXT_KINDS = Object.freeze(['prefix', 'suffix']);

export const ENUMS = Object.freeze({
  query: {mode: [...QUERY_MODES, ...REASONING_QUERY_MODES], measure: [...TIME_MEASURES], fragment: [...FRAGMENT_KINDS]},
  constraint: {task: ['prove', 'possible', 'optimize'], direction: ['min', 'max']},
  rule: {mode: ['logical', 'causal']},
  event: {action: ['end', 'retract', 'correct']},
  resolve: {kind: ['entity', 'predicate']},
  stated: {polarity: [...POLARITIES], certainty: [...CERTAINTIES]},
  assumed: {polarity: [...POLARITIES], basis: [...BASES]},
  unclear: {kind: Object.keys(UNCLEAR_KINDS), language: [...REPLY_LANGUAGES], readingKinds: [...READING_KINDS]},
  unparsed: {hint: [...UNPARSED_HINTS]},
  pragmatic: {kind: [...PRAGMATIC_KINDS], basis: [...PRAGMATIC_BASES]},
  instruction: {do: [...INSTRUCTION_ACTIONS], kind: [...INSTRUCTION_KINDS]},
});

/** Is `value` one of the closed values of `type.field`? */
export const allowed = (type, field, value) => ENUMS[type]?.[field]?.includes(value) === true;
