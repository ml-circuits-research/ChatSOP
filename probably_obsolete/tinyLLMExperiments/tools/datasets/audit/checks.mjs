/** Row-level semantic checks for the corpus audit.
 *
 * Each check is a descriptor `{id, severity, threshold, description, run(context)}`. `run` returns a list of
 * human-readable findings for one row (empty when the row passes). The runner computes, per check, the rate
 * of flagged rows over the rows the check applies to and compares it with the threshold. To add a check,
 * append a descriptor here (or in `corpusChecks` for corpus-level metrics) and give it a planted-defect test
 * in `tests/audit-corpus.test.mjs`.
 *
 * Wire roles are configurable (`config.groundedTypes`, `config.assumptionTypes`, `config.problemTypes`):
 * grounded statements and problem wires must be supported by the message; assumption statements are
 * counted and reported but never flagged as unfaithful.
 */
import {classifyTerm, literalText, labelOf} from './rows.mjs';
import {VOCABULARY_ROW_CHECKS} from './vocabulary.mjs';
import {anchoredValue} from './translation.mjs';
import {
  COMPARISON_MEANING, QUANTIFIER_MEANING, TEMPORAL_MEANING, contentTokens, guessLanguage, hasNegationCue, hasOmissionCue,
  meaningMatches, nameTokens, negativeMeaning, normalize, phrasePresent, tokenPresent, tokens,
} from './text.mjs';

/** Wires whose content must be supported by the message: grounded statements plus problem wires. */
export const checkedWires = context => context.analysis.wires.filter(wire => context.config.groundedTypes.has(wire.type) || context.config.problemTypes.has(wire.type));

/** The message's own phrase behind a target relation: itself for English input, the recorded `source_relation` of a
 * translated phrase, or null when a non-English row does not record it. */
function sourceRelation(row, relation) {
  const ir = row.surface_ir ?? {};
  const props = [...(ir.stated ?? []), ...(ir.assumed ?? []), ...(ir.query?.props ?? []), ...(ir.query?.scope ?? []), ...(ir.moreQueries ?? []).flatMap(q => q.props ?? [])];
  const found = props.find(p => p.relation === relation && p.source_relation);
  if (found) return found.source_relation;
  return (row.language ?? 'en') === 'en' && !row.code_switch ? relation : props.some(p => p.relation === relation) ? relation : null;
}

const idPhrase = id => normalize(String(id).replace(/[_:.-]+/g, ' '));

/** Does the message mention this entity through its label, an alias, a lexicon surface or its literal id? */
export function entityMention(entity, context) {
  context.mentions ??= new Map();
  if (!context.mentions.has(entity.id)) context.mentions.set(entity.id, computeMention(entity, context));
  return context.mentions.get(entity.id);
}

function computeMention(entity, context) {
  const {normMessage, messageTokens} = context;
  if (phrasePresent(idPhrase(entity.id), normMessage)) return 'yes';
  const texts = [entity.label, ...entity.surfaces.map(surface => surface.text)].filter(Boolean);
  let hasNames = false;
  for (const text of texts) {
    if (phrasePresent(text, normMessage)) return 'yes';
    const head = String(text).split(',')[0];
    if (phrasePresent(head, normMessage)) return 'yes';
    const content = contentTokens(head);
    if (!content.length) continue;
    // A distinguishing number in a label (e.g. "harbor berth 12") must be present exactly.
    if (content.filter(token => /^\d+$/.test(token)).some(token => !messageTokens.has(token))) continue;
    const names = nameTokens(head);
    if (names.length) {
      hasNames = true;
      if (names.some(token => tokenPresent(token, messageTokens))) return 'yes';
      continue;
    }
    const covered = content.filter(token => tokenPresent(token, messageTokens)).length;
    if (covered / content.length >= 0.5) return 'yes';
  }
  if (!hasNames && guessLanguage(texts.join(' ')) !== context.language) return 'crosslingual';
  return 'no';
}

/** Does the message contain the quoted literal (whole phrase, or most of its content tokens)? */
function literalMentioned(term, context) {
  const text = literalText(term);
  if (phrasePresent(text, context.normMessage)) return true;
  // A number literal is mentioned by its digits or its number word ("more than two" -> 2), and a person pronoun by any of its forms
  // ("our matters" -> object "us"): the model normalizes both (DS021 content words).
  if (/^\d+$/.test(text) && numberMentioned(text, context.messageTokens)) return true;
  const person = PRONOUN_PERSON.get(text.toLowerCase());
  if (person && [...PRONOUN_PERSON].some(([form, same]) => same === person && context.messageTokens.has(form))) return true;
  // Canonical English targets (Q-DATA-6): a translated common noun is anchored through the EN↔RO lexicon.
  if (anchoredValue(text, context.message, context.row)) return true;
  const content = contentTokens(text);
  const words = content.length ? content : tokens(text);
  return words.length > 0 && words.filter(token => tokenPresent(token, context.messageTokens)).length / words.length >= 0.5;
}

/** Person pronoun forms by person ("I" and "my" are first person singular), for literals the model normalizes ("our" -> "us"). */
const PRONOUN_PERSON = new Map([
  ...['i', 'me', 'my', 'mine', 'myself'].map(form => [form, '1s']), ...['we', 'us', 'our', 'ours', 'ourselves'].map(form => [form, '1p']),
  ...['you', 'your', 'yours', 'yourself'].map(form => [form, '2']),
]);

const predicateText = (id, context) => {
  const predicate = context.vocabulary.predicates.get(id);
  return [id, ...(predicate?.surfaces ?? [])].join(' ');
};
const predicateNegative = (id, context) => negativeMeaning(id) || (context.vocabulary.predicates.get(id)?.surfaces ?? []).some(negativeMeaning);
const atomNegative = (atom, context) => atom.negated || predicateNegative(atom.predicate, context);

const GENERIC_GLOSS = new Set(['record', 'records', 'recorded', 'entry', 'entries', 'named', 'item', 'items', 'entity', 'condition', 'relation',
  'described', 'event', 'action', 'performed', 'associates', 'associated', 'has', 'the', 'person', 'thing', 'value', 'predicat', 'relatie',
  'explicit', 'implicit', 'demonstrativ', 'fara', 'unui', 'unei']);

const NUMBER_WORDS = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'],
  ro: ['zero', 'unu', 'doi', 'trei', 'patru', 'cinci', 'sase', 'sapte', 'opt', 'noua', 'zece', 'unsprezece', 'doisprezece', 'treisprezece', 'paisprezece', 'cincisprezece', 'saisprezece', 'saptesprezece', 'optsprezece', 'nouasprezece', 'douazeci'],
};
const numberMentioned = (value, messageTokens) => {
  if (messageTokens.has(value)) return true;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 20) return false;
  return messageTokens.has(NUMBER_WORDS.en[number]) || messageTokens.has(NUMBER_WORDS.ro[number])
    || (number === 1 && (messageTokens.has('un') || messageTokens.has('o') || messageTokens.has('una')))
    || (number === 2 && messageTokens.has('doua'));
};

/** Constructs a structure label can claim, and how each is recognised in a target. */
export const LABEL_CLAIMS = {
  quantifier: {tokens: ['quantifier', 'quantification', 'count'], severity: 'error'},
  comparison: {tokens: ['comparison', 'compare', 'comparative'], severity: 'error'},
  temporal: {tokens: ['temporal', 'at', 'during', 'asof'], severity: 'error'},
  negation: {tokens: ['negation', 'negative', 'negated'], severity: 'warning'},
};
export function claimedConstructs(label) {
  // Word comparators are single tokens ("quantified:at_least" claims no temporal "at").
  const parts = new Set(String(label).toLowerCase().replace(/\bat_(least|most)\b/g, 'at$1').split(/[^a-z0-9]+/).filter(Boolean));
  return Object.entries(LABEL_CLAIMS).filter(([, claim]) => claim.tokens.some(token => parts.has(token))).map(([name]) => name);
}
export function presentConstructs(context) {
  const wires = context.analysis.wires;
  const meanings = wires.flatMap(wire => wire.atoms.map(atom => predicateText(atom.predicate, context)));
  return {
    quantifier: wires.some(wire => wire.mode === 'count' || (wire.type === 'constraint' && ['possible', 'prove'].includes(wire.task)))
      || meanings.some(text => meaningMatches(QUANTIFIER_MEANING, text)),
    comparison: wires.some(wire => wire.comparison) || meanings.some(text => meaningMatches(COMPARISON_MEANING, text)),
    temporal: wires.some(wire => wire.temporalFields.length > 0) || meanings.some(text => meaningMatches(TEMPORAL_MEANING, text)),
    negation: wires.some(wire => wire.atoms.some(atom => atomNegative(atom, context))),
  };
}

const answerIds = row => {
  const out = new Set();
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'string') out.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(row.expected?.answers ?? []);
  return out;
};
export const contextShape = context => {
  const answers = answerIds(context.row);
  const entityIds = [...context.vocabulary.entities.keys()];
  const leaked = entityIds.filter(id => answers.has(id));
  return {predicates: context.vocabulary.predicates.size, entities: entityIds.length, nonAnswerEntities: entityIds.length - leaked.length, leaked};
};

const CASE_ID_PATTERN = /\b[a-z]{1,5}[-_][a-z]{2,8}[-_]\d{2,}\b|\b[a-z]{1,4}_\d{3,}\b/i;
const HASH_LIKE = /^(?=.*\p{L})(?=.*\d)[\p{L}\d]{4,}$/u;
const ORDINAL = /^\d+(?:st|nd|rd|th|lea|a|le)$/i;

export const ROW_CHECKS = [
  {
    id: 'faithfulness.entity', severity: 'error', threshold: 0, target: true,
    description: 'Every entity and quoted constant in a grounded or problem wire is mentioned in the message (label, alias, lexicon surface or literal id).',
    run(context) {
      const findings = [];
      for (const wire of checkedWires(context)) for (const atom of wire.atoms) for (const term of atom.args) {
        const kind = classifyTerm(term, context.vocabulary);
        if (kind === 'literal' && !literalMentioned(term, context)) findings.push(`${wire.type} @${wire.id}: literal ${term} is not in the message`);
        if (kind !== 'entity') continue;
        const mention = entityMention(context.vocabulary.entities.get(term), context);
        if (mention === 'no') findings.push(`${wire.type} @${wire.id}: entity ${term} ("${context.vocabulary.entities.get(term).label}") is never mentioned in the message`);
      }
      return findings;
    },
  },
  {
    id: 'faithfulness.entity_crosslingual', severity: 'warning', threshold: 0.05, target: true,
    description: 'An entity label in another language than the message is not matched; add an alias in the message language to make grounding checkable.',
    run(context) {
      const findings = [];
      for (const wire of checkedWires(context)) for (const atom of wire.atoms) for (const term of atom.args) {
        if (classifyTerm(term, context.vocabulary) !== 'entity') continue;
        if (entityMention(context.vocabulary.entities.get(term), context) === 'crosslingual') findings.push(`${wire.type} @${wire.id}: entity ${term} ("${context.vocabulary.entities.get(term).label}") has no ${context.language} surface in the message`);
      }
      return findings;
    },
  },
  {
    id: 'faithfulness.vocabulary', severity: 'error', threshold: 0, target: true,
    description: 'Every predicate and constant of an identifier atom in a grounded or problem wire comes from the row vocabulary; model-language propositions carry strings that the host links, so only their constants are checked.',
    run(context) {
      const findings = [];
      for (const wire of checkedWires(context)) for (const atom of wire.atoms) {
        if (atom.proposition) {
          for (const term of atom.args) if (!['literal', 'variable', 'number'].includes(classifyTerm(term, context.vocabulary))) findings.push(`${wire.type} @${wire.id}: role value ${term} is neither a quoted string, a number nor a ?variable`);
          continue;
        }
        if (!context.vocabulary.predicates.has(atom.predicate)) findings.push(`${wire.type} @${wire.id}: predicate ${atom.predicate} is not in the row's verification vocabulary`);
        for (const term of atom.args) if (classifyTerm(term, context.vocabulary) === 'unknown') findings.push(`${wire.type} @${wire.id}: constant ${term} is not in the row's verification vocabulary`);
      }
      return findings;
    },
  },
  {
    id: 'faithfulness.polarity', severity: 'error', threshold: 0, target: true,
    description: 'A negated atom, or a lexically negative predicate, needs a negation or omission cue (statement: anywhere in the message; query: in the question).',
    run(context) {
      const findings = [];
      for (const wire of checkedWires(context)) {
        const scope = wire.type === 'query' ? context.question : context.message;
        const where = wire.type === 'query' ? 'question' : 'message';
        const cue = hasNegationCue(scope) || hasOmissionCue(scope);
        if (cue) continue;
        for (const atom of wire.atoms) {
          if (atom.negated) findings.push(`${wire.type} @${wire.id}: "not ${atom.predicate}" but the ${where} has no negation cue`);
          else if (predicateNegative(atom.predicate, context)) findings.push(`${wire.type} @${wire.id}: negative predicate ${atom.predicate} but the ${where} has no negation or omission cue`);
        }
      }
      return findings;
    },
  },
  {
    id: 'faithfulness.polarity_unmarked', severity: 'warning', threshold: 0.05, target: true,
    description: 'The message contains a negation cue but the target is positive-only.',
    run(context) {
      if (!hasNegationCue(context.message)) return [];
      const wires = checkedWires(context);
      const negative = wires.some(wire => wire.atoms.some(atom => atomNegative(atom, context))) || wires.some(wire => wire.type === 'constraint');
      return negative ? [] : ['the message contains a negation cue but no checked wire is negative'];
    },
  },
  {
    id: 'faithfulness.predicate', severity: 'warning', threshold: 0.1, target: true,
    description: 'The relation phrase (or the gloss, label or identifier words of a used predicate) plausibly appears in the message.',
    run(context) {
      const findings = [];
      const seen = new Set();
      for (const wire of checkedWires(context)) for (const atom of wire.atoms) {
        if (atom.proposition) {
          // A model-language relation phrase is written from the message; at least one content word must appear there.
          // Targets are canonical English (Q-DATA-6): for a translated phrase the message's own source phrase
          // (surface_ir `source_relation`) is checked; a translated phrase without a recorded source is not checkable.
          if (seen.has(atom.predicate)) continue;
          seen.add(atom.predicate);
          const source = sourceRelation(context.row, atom.predicate);
          if (source === null) continue;
          const words = contentTokens(source).filter(token => token.length >= 3 && !/\d/.test(token));
          if (words.length && !words.some(token => tokenPresent(token, context.messageTokens))) findings.push(`relation "${source}" has no surface in the message`);
          continue;
        }
        if (seen.has(atom.predicate) || !context.vocabulary.predicates.has(atom.predicate)) continue;
        seen.add(atom.predicate);
        const words = contentTokens(predicateText(atom.predicate, context).replace(/[_:.-]+/g, ' '))
          .filter(token => token.length >= 3 && !/\d/.test(token) && !GENERIC_GLOSS.has(token));
        if (words.length && !words.some(token => tokenPresent(token, context.messageTokens))) findings.push(`predicate ${atom.predicate} ("${context.vocabulary.predicates.get(atom.predicate).meaning}") has no surface in the message`);
      }
      return findings;
    },
  },
  {
    id: 'faithfulness.constraint_number', severity: 'warning', threshold: 0.05, target: true,
    description: 'Numbers in constraint restrictions and claims appear in the message (digits or EN/RO number words up to 20).',
    run(context) {
      const findings = [];
      for (const wire of checkedWires(context)) for (const value of wire.numbers) {
        if (!numberMentioned(String(Math.abs(Number(value))), context.messageTokens)) findings.push(`${wire.type} @${wire.id}: number ${value} is not in the message`);
      }
      return findings;
    },
  },
  {
    id: 'label.construct', severity: 'error', threshold: 0, target: true,
    description: 'A structure label that claims a quantifier, comparison or temporal feature is backed by the matching construct in the target.',
    run(context) {
      const present = presentConstructs(context);
      return claimedConstructs(labelOf(context.row)).filter(name => LABEL_CLAIMS[name].severity === 'error' && !present[name])
        .map(name => `label "${labelOf(context.row)}" claims ${name} but the target has no ${name} construct`);
    },
  },
  {
    id: 'label.negation', severity: 'warning', threshold: 0.05, target: true,
    description: 'A structure label that claims negation has a negative atom or a lexically negative predicate in the target.',
    run(context) {
      const present = presentConstructs(context);
      return claimedConstructs(labelOf(context.row)).includes('negation') && !present.negation ? [`label "${labelOf(context.row)}" claims negation but the target is positive-only`] : [];
    },
  },
  {
    id: 'context.trivial', severity: 'warning', threshold: 0.25, target: true,
    description: 'The row\'s verification world (never model input) has one predicate and at most one non-answer entity, so host linking and the executed expectation are exercised only weakly.',
    run(context) {
      const shape = contextShape(context);
      return shape.predicates === 1 && shape.nonAnswerEntities <= 1 ? [`verification world has ${shape.predicates} predicate(s) and ${shape.nonAnswerEntities} non-answer entit(y/ies)`] : [];
    },
  },
  {
    id: 'context.single_predicate', severity: 'info', threshold: 1, target: true,
    description: 'The verification world (never model input) has a single predicate: host linking never has to choose.',
    run: context => contextShape(context).predicates === 1 ? ['single candidate predicate'] : [],
  },
  {
    id: 'context.answer_leak', severity: 'warning', threshold: 0, target: true,
    description: 'A gold answer entity is listed in the row\'s verification context. The model sees only the message, so this cannot leak an answer to it; it describes the scaffolding.',
    run(context) {
      const {leaked} = contextShape(context);
      return leaked.length ? [`gold answer entit(y/ies) ${leaked.join(', ')} listed in the verification context`] : [];
    },
  },
  {
    id: 'diversity.case_id_in_text', severity: 'warning', threshold: 0, target: false,
    description: 'Case identifiers or internal entity/predicate ids appear inside the natural-language message.',
    run(context) {
      const {row, normMessage, message} = context;
      const ids = [row.id, row.split_group_id, row.semantic_case_id, row.surface_group_id,
        ...[...context.vocabulary.entities.keys(), ...context.vocabulary.predicates.keys()].filter(id => /[_:.-]/.test(id) && /\d/.test(id))];
      const hits = [...new Set(ids.filter(Boolean))].filter(id => phrasePresent(idPhrase(id), normMessage));
      const generic = CASE_ID_PATTERN.exec(message);
      if (generic && !hits.length) hits.push(generic[0]);
      return hits.length ? [`identifier(s) in text: ${hits.slice(0, 3).join(', ')}`] : [];
    },
  },
  {
    id: 'diversity.hash_like_name', severity: 'warning', threshold: 0.05, target: false,
    description: 'Names that mix letters and digits (generator counters or hashes such as "Osmira11") appear in the message.',
    run(context) {
      const hits = String(context.message).split(/[^\p{L}\d]+/u).filter(token => HASH_LIKE.test(token) && !ORDINAL.test(token));
      return hits.length ? [`hash-like name(s): ${[...new Set(hits)].slice(0, 3).join(', ')}`] : [];
    },
  },  // Contract vocabulary (wire types, fields, enumerated values, model-authorable subset), read from sop/parser.mjs.
  ...VOCABULARY_ROW_CHECKS,
];

/** Build the per-row context once; checks share it. */
export function rowContext(row, {message, question, vocabulary, analysis, config}) {
  const normMessage = normalize(message);
  return {
    row, message, question, vocabulary, analysis, config, normMessage,
    messageTokens: new Set(tokens(message)),
    language: row.language ?? row.verification_context?.language ?? row.context?.language ?? 'en',
  };
}
