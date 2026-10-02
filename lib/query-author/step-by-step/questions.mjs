/**
 * The questions of the generic protocol (DS022 "LocalLLMStepByStep", methods B, C and D). The system message is method A's
 * (byte-identical); the first user turn starts with the 13 answer kinds and the 8 aspects, also byte-identical for every request and
 * memory, so llama-server keeps them in the cached prefix. Every question is a numbered choice ("0" is always "none"), a short list
 * of numbers or lettered lines; the model never writes SOP or JSON.
 */
import {ASPECTS} from './cues.mjs';

export const KINDS = Object.freeze([
  ['yesno', 'yes or no: whether something is true, holds, is allowed or is absent', 'Is Ana a doctor? May Ion work on 2026-04-01? Is Ana older than Ion?'],
  ['reach', 'whether one thing can be reached from another through a chain of links', 'Can one get from A to B without passing a closed point?'],
  ['list', 'the names of the things that fit', 'Who works at Acme? Which cities are in Spain?'],
  ['value', 'one stored value of something: an amount, a total, a size, a date, a difference', 'What is the total pay of Sales? What is the age of Ana?'],
  ['count', 'how many different things fit', 'How many people work at Acme?'],
  ['highest', 'the thing with the highest or largest value', 'Who earns the most at Acme?'],
  ['lowest', 'the thing with the lowest or smallest value', 'Which city is the smallest?'],
  ['puzzle', 'numbers for unknowns (x, y) that must satisfy given equations or limits', 'Let x and y be integers from 0 to 5; is there an assignment with x + y = 4?'],
  ['every', 'whether all, none, most or at least some number of the members of a group fit', 'Is everyone at Acme certified? Do most members hold a licence?'],
  ['when', 'when something held, since when, until when, or for how long', 'When did Ana work at Acme? How long has Ion lived in Cluj?'],
  ['why', 'why something is true: its reason or explanation', 'Why is Ana eligible?'],
  ['statement', 'nothing is asked: the user states a fact', 'Ana works at Acme.'],
  ['none', 'nothing to look up: a greeting, thanks, or no request', 'Hello! Thanks.'],
]);

export const QUANTIFIERS = Object.freeze([
  ['all', 'all of them'], ['none', 'none of them'], ['most', 'most of them (more than half)'], ['not_all', 'not all of them'], ['half', 'exactly half of them'], ['at_least', 'at least a number of them'],
]);

export const CLAUSE_ROLES = Object.freeze([
  ['supposition', 'a supposition the question assumes (if, suppose, were)'],
  ['fact', 'a fact the user states'],
  ['time', 'a time limit for the question (before, after, when something happened)'],
  ['second', 'a second question'],
  ['same', 'part of the same question'],
  ['ignore', 'nothing to look up (a remark, a reason for asking)'],
]);

const numbered = list => list.map(([, text, examples], i) => `${i + 1}. ${text}${examples ? ` (for example: ${examples})` : ''}`).join('\n');
const choices = list => list.map((text, i) => `${i + 1}. ${text}`).join('\n');

/** The byte-identical start of the first user turn of methods B, C and D (prewarmed with the system message). */
export const PROTOCOL_PREFIX = `Kinds of answer a request can want:\n${numbered(KINDS)}\n\nParts a request can have:\n${numbered(ASPECTS)}\n\nThe user's request:\n<<<\n`;

export const q = {
  kind: message => `${PROTOCOL_PREFIX}${message}\n>>>\n\nWhich kind of answer from the list does the request want? Reply with the number only.`,
  kindCheck: options => `Which of these fits the request better?\n${options.map(([, t], i) => `${i + 1}. ${t}`).join('\n')}\nReply with the number only.`,
  aspects: () => 'Which parts from the list "Parts a request can have" does the request have? Reply with the numbers separated by commas, or 0 for none.',
  aspectCheck: (span, text) => `The request says "${span}". Is that ${text}?\n1. yes\n2. no\nReply with the number only.`,
  statements: (lines, more, what) => `The knowledge can hold these statements (A, B, C stand for names or values):\n${lines.join('\n')}${more ? `\n${lines.length + 1}. none of these; show other statements` : ''}\n0. none of these fits\n\nWhich statements does ${what} need? Pick as few as possible: usually the one statement that directly says what is asked (the knowledge applies its own rules); add another only for a separate condition or for a value to compare or limit. Reply with the numbers only, separated by commas.`,
  places: (statement, letters, options, note = '') => `${note}For the statement "${statement}", what are ${letters.join(' and ')} in the request?\nChoices:\n${choices(options)}\nReply with one line per letter, like "${letters[0]}: 1".`,
  truth: options => `Does the request ask\n${numbered(options)}\nReply with the number only.`,
  limitTarget: (span, options) => `The request has the limit "${span}". What does it limit?\n${choices(options)}\n0. nothing\nReply with the number only.`,
  limitKind: number => `Which limit does the request set on the number ${number}?\n${choices([`more than ${number}`, `fewer than ${number}`, `at least ${number}`, `at most ${number}`, `exactly ${number}`])}\n0. none\nReply with the number only.`,
  optionsTarget: (span, options) => `The request offers a choice: "${span}". Which unknown must be one of these named things?\n${choices(options)}\n0. none\nReply with the number only.`,
  exclusionTarget: (span, options) => `The request leaves out "${span}". Which unknown must not be that?\n${choices(options)}\n0. none\nReply with the number only.`,
  twoSided: (span, options) => `The request compares two things: "${span}". How are they compared?\n${choices(options)}\n0. they are not compared\nReply with the number only.`,
  nameLetter: (statement, letters, names) => `In the statement "${statement}", which letter is ${names}? Reply with the letter only.`,
  scope: lines => `Which of these statements must hold for each member of the group (the others say who belongs to the group)?\n${choices(lines)}\nReply with the number only.`,
  quantifier: () => `How many of the members does the request ask about?\n${numbered(QUANTIFIERS)}\nReply with the number only.`,
  chain: (statement) => `Does the request follow a chain of several "${statement}" links, one after another, or only one direct link?\n1. a chain of several links\n2. only one direct link\nReply with the number only.`,
  definition: () => `None of the statements says it directly. Can it be worked out from them?\n1. by following a chain of links from one thing to another\n2. by counting, for each group, the things in it\n3. by the fewest links needed to get from one thing to another\n0. no\nReply with the number only.`,
  stepStatement: lines => `Which statement is one link from one thing to the next?\n${choices(lines)}\nReply with the number only.`,
  pickName: (what, names) => `Which name is ${what}?\n${choices(names)}\nReply with the number only.`,
  clauseRole: (clause) => `The request contains the part "${clause}". What is that part?\n${numbered(CLAUSE_ROLES)}\nReply with the number only.`,
  clauseStatement: (clause, lines) => `Which statement says "${clause}"?\n${choices(lines)}\n0. none of these\nReply with the number only.`,
  clauseKind: clause => `The request also asks: "${clause}". Which kind of answer from the first list does that part want? Reply with the number only.`,
  contrast: options => `Which of these says what the request asks?\n${choices(options)}\n${options.length + 1}. neither\nReply with the number only.`,
  confirm: paraphrase => `The system understood the request as:\n"${paraphrase}"\nIs this what the request asks? Reply yes or no.`,
  wrongPart: parts => `Which part is wrong?\n${choices(parts)}\nReply with the number only.`,
  unusedName: (surface, lines) => `The request also names "${surface}". Which statement says something about it?\n${choices(lines)}\n0. none\nReply with the number only.`,
  pronoun: (word, names) => `In the request, who or what is "${word}"?\n${choices(names)}\n0. none of these\nReply with the number only.`,
};
