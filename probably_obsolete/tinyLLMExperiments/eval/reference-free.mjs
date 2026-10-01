/**
 * Reference-free metrics of a PREDICTED program (DS016 "Reference-free metrics").
 *
 * Each check reads only the user's message and the predicted SOP, so it applies to any message, including an
 * unlabeled one. The checks reuse the corpus-audit logic that the audit applies to gold targets
 * (tools/datasets/audit/): the contract vocabulary (`checkProgram`), the no-identifier and anchoring guard
 * (`modelTargetIdFindings`, cross-lingual through `anchoredValue`), the EN/RO negation and omission cues
 * (`hasNegationCue`, `hasOmissionCue`), plus the host's own admission (`checkModelProgram`, `compileDeclarative`,
 * sop/linking.mjs `mentionedIn`/`mentionedThroughLexicon`). Two small detectors are defined here: whether a
 * message contains a question or request (`messageAsks`) and whether it is gibberish (`gibberishVerdict`).
 * These are plausibility checks: passing them does not make a prediction correct, failing them flags a defect.
 */
import {parse, one, many} from '../sop/parser.mjs';
import {checkModelProgram, compileDeclarative} from '../sop/declarative.mjs';
import {propositionOf} from '../sop/propositions.mjs';
import {mentionedIn, mentionedThroughLexicon} from '../sop/linking.mjs';
import {checkProgram, loadVocabulary, modelTargetIdFindings, NON_FAILING} from '../tools/datasets/audit/vocabulary.mjs';
import {anchoredValue} from '../tools/datasets/audit/translation.mjs';
import {editDistance, hasNegationCue, hasOmissionCue, negativeMeaning} from '../tools/datasets/audit/text.mjs';
import {fraction} from './contracts.mjs';

const VOCABULARY = await loadVocabulary();
const fold = text => String(text ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[’`´]/g, "'");

// ---------------------------------------------------------------- question / request detector
const QUESTION_START = /^(?:who|whom|whose|what|which|when|where|why|how|do|does|did|is|are|was|were|has|have|had|can|could|would|will|should|shall|may|might|am|isn't|aren't|wasn't|doesn't|don't|didn't|cine|ce|care|cand|unde|cum|cati|cate|cat|de ce|de cand|de cate|de cati|pana cand|in ce|la ce|cu ce|din ce|pentru ce|oare|exista|poti|puteti|stii|stiti)\b/;
const REQUEST = /\b(?:tell me|let me know|check|confirm|verify|find out|i wonder|i was wondering|i need to know|i'd like to know|id like to know|know if|see if|ask if|whether|any idea|any chance|do you know|can you|could you|true or false|fact-check|remind me|spune-mi|zi-mi|verifica|confirma|afla|aflu|ma intreb|am nevoie sa stiu|daca|ai idee|vreau sa stiu|ma intereseaza|adevarat sau fals|numara-mi|explica-mi)\b/;
/** Request verbs matched with one typo (five letters or more), as a noisy message writes them ("I wonrder who …"). */
const REQUEST_WORDS = ['wonder', 'whether', 'confirm', 'verify', 'remind', 'verifica', 'confirma', 'intreb', 'intereseaza'];
/** Does the message ask something (a question mark, an interrogative sentence start, or a request to check/tell)? */
export function messageAsks(message) {
  const text = fold(message);
  if (text.includes('?')) return true;
  const sentences = text.split(/(?<=[.!:;,])\s+|\n+/).map(sentence => sentence.trim().replace(/^[^\p{L}]+/u, ''));
  if (sentences.some(sentence => QUESTION_START.test(sentence)) || REQUEST.test(text)) return true;
  const tokens = text.match(/\p{L}+/gu) ?? [];
  return tokens.some(token => token.length >= 5 && REQUEST_WORDS.some(word => editDistance(token, word, 1) <= 1));
}

// ---------------------------------------------------------------- gibberish detector
/** Frequent EN/RO words (diacritics folded): function words, question words, greetings, chat forms, common verbs. */
const KNOWN = new Set(`a an the of for to in on at by with and or but not no yes from is was are were be been am do does did have has had i you he she it we they me him her us them my your his its our their this that these those what who whom whose which when where why how
can could would will should may might must there here all any every some none more most very so too just only also still again ever never always now then than if whether because about into over under after before
hi hello hey thanks thank please ok okay cheers bye good morning evening night nice great fine sure right sorry lol haha hmm wow cool thx pls u ur r btw
work works worked live lives know tell check need want like think see say says said go goes went get got make made take give find help write send
si sau dar nu da de la in pe cu din pentru ca sa se am ai are au e este sunt era fost un o unei unui al ale lui ei el ea noi voi ei ele eu tu
ce cine care cand unde cum cat cati cate de ce oare daca mai tot toti toate fiecare nimic nimeni niciun nicio acum azi ieri maine aici acolo foarte doar inca
salut buna ziua dimineata seara mersi multumesc multumim merci pa super perfect bine gata aha mhm deci adica hai ok stiu poti spune zi vreau am inteles
lucreaza locuieste merge face vine stie zice spune`.split(/\s+/).filter(Boolean));
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const letters = text => fold(text).match(/\p{L}+/gu) ?? [];
const known = word => KNOWN.has(word) || (word.length >= 4 && [...KNOWN].some(entry => entry.length >= 4 && editDistance(word, entry, 1) <= 1));
/** A token that cannot be a word: no vowel, a run of 4+ consonants, a letter repeated 3+ times, or a keyboard-row run of 4+. */
export function nonWordlike(word) {
  if (word.length >= 3 && !/[aeiouy]/.test(word)) return true;
  if (/[^aeiouy\W\d]{5,}/u.test(word)) return true;
  if (/(\p{L})\1\1/u.test(word)) return true;
  for (let i = 0; i + 4 <= word.length; i++) if (KEY_ROWS.some(row => row.includes(word.slice(i, i + 4)))) return true;
  return false;
}
/**
 * `gibberish`, `intelligible` or `uncertain`. Intelligible: at least two frequent words and at most a quarter of
 * non-word tokens; or one frequent word and no non-word token; or a capitalized name after the first word, no
 * non-word token and at least three words. Gibberish: non-word tokens in the majority, or at least one non-word
 * token with neither a frequent word (typos of one edit tolerated from four letters) nor a name. Otherwise
 * uncertain (excluded from the unclear-consistency denominator). Pronounceable pseudo-words
 * ("blazorke mifnap") that contain one frequent word can pass as intelligible: the detector is a heuristic.
 */
export function gibberishVerdict(message) {
  const words = letters(message);
  if (!words.length) return 'gibberish';
  const frequent = words.filter(known).length, odd = words.filter(nonWordlike).length;
  // Capitalized tokens after the first word are name evidence ("Oana teaches German, correct?").
  const names = (String(message).match(/\p{L}+/gu) ?? []).slice(1).filter(token => /^\p{Lu}\p{Ll}/u.test(token)).length;
  if ((frequent >= 2 && odd / words.length <= 0.25) || (frequent >= 1 && odd === 0) || (names >= 1 && odd === 0 && words.length >= 3)) return 'intelligible';
  if (odd / words.length > 0.5 || (frequent === 0 && names === 0 && odd >= 1)) return 'gibberish';
  return 'uncertain';
}

// ---------------------------------------------------------------- per-prediction checks
const PROPOSITION_TYPES = new Set(['stated', 'assumed']);
const spanFold = text => fold(text).replace(/\s+/g, ' ').trim();
/** Is a span verbatim in the message, up to case, diacritics and whitespace? */
export const verbatimIn = (span, message) => { const s = spanFold(span); return s.length > 0 && spanFold(message).includes(s); };
/**
 * Reference-free record of one prediction. `lexicon` (optional) is a host lexicon for cross-lingual anchoring of
 * translated common nouns; without it the generator's EN↔RO lexicon is used (tools/datasets/audit/translation.mjs).
 */
export function referenceFreeRecord(message, predicted, {lexicon = null} = {}) {
  const record = {parse_valid: false, compile_valid: false, contract_valid: false, defects: []};
  if (typeof predicted !== 'string') { record.defects.push('no prediction'); return record; }
  let program;
  try { program = parse(predicted); record.parse_valid = true; } catch (error) { record.defects.push(`parse: ${error.message}`); return record; }
  try { checkModelProgram(program); compileDeclarative(predicted, {inputText: message}); record.compile_valid = true; } catch (error) { record.defects.push(`compile: ${error.message}`); }
  const contract = checkProgram(predicted, VOCABULARY, {ontology: 'deny', model: true}).filter(finding => !NON_FAILING.has(finding.class));
  record.contract_valid = contract.length === 0;
  for (const finding of contract) record.defects.push(`contract: ${finding.message}`);
  const wires = program.wires;
  const unclear = wires.find(wire => wire.type === 'unclear');
  record.unclear = unclear ? one(unclear, 'kind') : null;
  // Stated-value anchoring: every role value (and a reported speaker) of a `stated` wire comes from the message.
  let values = 0, anchored = 0;
  for (const wire of wires.filter(w => w.type === 'stated')) {
    let p;
    try { p = propositionOf(wire); } catch { continue; }
    const items = [...p.roles.map(role => role.value).filter(value => typeof value === 'string' && !value.startsWith('?')), ...(p.speaker && p.speaker !== 'user' ? [p.speaker] : [])];
    for (const value of items) {
      values++;
      if (mentionedIn(value, message) || mentionedThroughLexicon(value, message, lexicon) || anchoredValue(value, message)) anchored++;
      else record.defects.push(`anchoring: stated value ${JSON.stringify(value)} of @${wire.id} is not in the message`);
    }
  }
  record.stated_values = values;
  record.stated_values_anchored = anchored;
  // Honesty (DS016 "Honest partial formalization"): a value the message does not contain is invented; a span the
  // model marked `unparsed` is honest when it is verbatim in the message (case, diacritics and spacing folded).
  record.invented_values = values - anchored;
  const spans = wires.filter(w => w.type === 'unparsed').map(w => { try { return JSON.parse(one(w, 'span')); } catch { return ''; } });
  record.unparsed_spans = spans.length;
  record.marked_unparsed = spans.filter(span => verbatimIn(span, message)).length;
  for (const span of spans) if (!verbatimIn(span, message)) record.defects.push(`unparsed: span ${JSON.stringify(span)} is not verbatim in the message`);
  record.honesty_ratio = record.marked_unparsed + record.invented_values ? record.marked_unparsed / (record.marked_unparsed + record.invented_values) : null;
  record.invented_value_rate = values ? record.invented_values / values : null;
  // No identifier-like tokens or retired constructs (the audit's no-context guard G2 on the prediction).
  const idFindings = modelTargetIdFindings({sop_target: predicted, question: message}).filter(finding => !/is not in the message/.test(finding));
  record.id_tokens = idFindings.length > 0;
  for (const finding of idFindings) record.defects.push(`identifier: ${finding}`);
  // Polarity: negated stated/query propositions against the message's negation or omission cues.
  // A lexically negative relation ("be absent from work", "omit") carries the negation as much as `polarity negated`.
  const negativeRelation = text => (String(text).match(/relation\s+("(?:\\.|[^"\\])*")/g) ?? []).some(line => negativeMeaning(JSON.parse(line.replace(/^relation\s+/, ''))));
  const negated = wires.some(wire => (wire.type === 'stated' && (one(wire, 'polarity') === 'negated' || negativeMeaning(JSON.parse(one(wire, 'relation', '""')))))
    || (wire.type === 'query' && [...many(wire, 'where'), ...many(wire, 'scope')].some(text => /\bpolarity negated\b/.test(text) || negativeRelation(text)))
    // Words-only negative constructs (DS021 Q-LANG-1/2): "none", "not all" quantifiers and "besides/not counting X" exclusions.
    || (wire.type === 'query' && (['none', 'not_all'].includes(one(wire, 'quantifier', '')) || many(wire, 'except').length > 0)));
  const cue = hasNegationCue(message) || hasOmissionCue(message);
  record.negation_cue = cue;
  record.negated_prediction = negated;
  // Question form: a message that asks produces a query or constraint; a message that does not ask produces none.
  record.message_asks = messageAsks(message);
  record.has_problem = wires.some(wire => wire.type === 'query' || wire.type === 'constraint');
  // Unclear consistency against the gibberish detector.
  record.gibberish_verdict = gibberishVerdict(message);
  // Model additions.
  record.assumed_wires = wires.filter(wire => wire.type === 'assumed').length;
  record.proposition_wires = wires.filter(wire => PROPOSITION_TYPES.has(wire.type)).length;
  return record;
}

const rate = (items, predicate) => fraction(items.filter(predicate).length, items.length);
/**
 * Aggregate reference-free records (DS016 definitions). Rows whose prediction is `unclear` are excluded from the
 * polarity and question-form denominators (the unclear check judges them).
 */
export function referenceFreeMetrics(records) {
  const all = records.filter(Boolean);
  const parsed = all.filter(r => r.parse_valid);
  const content = parsed.filter(r => !r.unclear);
  const decided = parsed.filter(r => r.gibberish_verdict !== 'uncertain');
  const sum = key => parsed.reduce((n, r) => n + (r[key] ?? 0), 0);
  return {
    rows: all.length,
    parse_validity: rate(all, r => r.parse_valid),
    compile_validity: rate(all, r => r.compile_valid),
    contract_vocabulary: rate(all, r => r.parse_valid && r.contract_valid),
    stated_value_anchoring: fraction(sum('stated_values_anchored'), sum('stated_values')),
    rows_fully_anchored: rate(parsed.filter(r => r.stated_values > 0), r => r.stated_values_anchored === r.stated_values),
    polarity_agreement: rate(content, r => r.negation_cue === r.negated_prediction),
    unsupported_negation: rate(content, r => r.negated_prediction && !r.negation_cue),
    missed_negation: rate(content, r => r.negation_cue && !r.negated_prediction),
    question_form_agreement: rate(content, r => r.message_asks === r.has_problem),
    missing_query: rate(content.filter(r => r.message_asks), r => !r.has_problem),
    spurious_query: rate(content.filter(r => !r.message_asks), r => r.has_problem),
    unclear_gibberish_agreement: rate(decided, r => (r.unclear === 'gibberish') === (r.gibberish_verdict === 'gibberish')),
    gibberish_missed: rate(decided.filter(r => r.gibberish_verdict === 'gibberish'), r => r.unclear !== 'gibberish'),
    gibberish_on_intelligible: rate(decided.filter(r => r.gibberish_verdict === 'intelligible'), r => r.unclear === 'gibberish'),
    id_like_tokens: rate(parsed, r => r.id_tokens),
    assumed_wire_share: fraction(sum('assumed_wires'), sum('proposition_wires')),
    // Honesty: invented stated values against honestly marked `unparsed` spans (DS016).
    invented_values: sum('invented_values'), marked_unparsed: sum('marked_unparsed'), unparsed_spans: sum('unparsed_spans'),
    invented_value_rate: fraction(sum('invented_values'), sum('stated_values')),
    honesty_ratio: fraction(sum('marked_unparsed'), sum('marked_unparsed') + sum('invented_values')),
    rows_with_unparsed: rate(parsed, r => (r.unparsed_spans ?? 0) > 0),
    rows_with_assumed: rate(parsed, r => r.assumed_wires > 0),
  };
}
