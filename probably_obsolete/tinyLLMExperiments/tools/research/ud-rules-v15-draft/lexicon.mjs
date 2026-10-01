/**
 * Closed word lists of the UD → SOP converter (baseline-ud-rules-v1). Every list is function vocabulary of
 * English or Romanian (connectives, question words, auxiliaries, prepositions, greetings); no content word, name or
 * domain term is listed, so the converter cannot copy a value that the message does not contain. Keys are folded
 * (lower case, diacritics removed; see `fold`).
 */

/** Lower case, cedilla to comma letters, diacritics removed, whitespace collapsed. */
export const fold = text => String(text ?? '').toLowerCase().replace(/[şţ]/g, c => (c === 'ş' ? 'ș' : 'ț'))
  .normalize('NFD').replace(/\p{M}/gu, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Subordinating connectives → the link keyword of sop/enums.mjs LINK_KEYWORDS. Multi-word connectives are matched
 * on the `mark` words of the clause (and a fixed/flat continuation), folded and joined with spaces.
 */
export const CONNECTIVES = Object.freeze({
  because: 'because', since: 'because', as: 'because', cause: 'because', cuz: 'because', 'given that': 'because',
  'pentru ca': 'because', fiindca: 'because', deoarece: 'because', caci: 'because', intrucat: 'because', 'din moment ce': 'because', 'dat fiind ca': 'because',
  if: 'if', 'in case': 'if', 'provided that': 'if', 'as long as': 'if', daca: 'if', 'in caz ca': 'if', 'cu conditia sa': 'if', 'cu conditia ca': 'if',
  unless: 'unless', 'decat daca': 'unless',
  although: 'although', though: 'although', 'even though': 'although', 'even if': 'although', desi: 'although', 'cu toate ca': 'although', 'chiar daca': 'although', 'macar ca': 'although',
  'so that': 'so_that', 'in order to': 'so_that', 'in order that': 'so_that', 'ca sa': 'so_that', 'pentru ca sa': 'so_that', 'pentru a': 'so_that',
  before: 'before', until: 'before', till: 'before', 'inainte sa': 'before', 'inainte ca': 'before', 'inainte de a': 'before', 'pana sa': 'before', 'pana cand': 'before', pana: 'before',
  after: 'after', once: 'after', 'as soon as': 'after', 'dupa ce': 'after', 'odata ce': 'after', 'imediat ce': 'after', 'de cand': 'after',
  when: 'when', whenever: 'when', cand: 'when', 'ori de cate ori': 'when', 'atunci cand': 'when',
  while: 'while', 'in timp ce': 'while', 'pe cand': 'while', 'cat timp': 'while',
});

/** Result adverbs: "A, so B" → `so $A` on B (the effect clause points at its cause). */
export const RESULT_ADVERBS = new Set(['so', 'therefore', 'thus', 'hence', 'deci', 'asa ca', 'prin urmare', 'astfel ca']);

/** Negation words (with the UD feature Polarity=Neg). */
export const NEGATIONS = new Set(['not', "n't", 'never', 'no', 'nu', 'niciodata', 'nici', "nu-", 'n-']);

/** Question words: kind and, for Romanian multi-word forms, the folded phrase. */
export const WH = Object.freeze({
  who: 'who', whom: 'who', whose: 'who', what: 'what', which: 'which', where: 'where', when: 'when', why: 'why', how: 'how',
  cine: 'who', cui: 'who', pe_cine: 'who', ce: 'what', care: 'which', unde: 'where', cand: 'when', cind: 'when', cum: 'how', cat: 'how_many', cati: 'how_many', cate: 'how_many', cata: 'how_many',
});
/** Multi-word question phrases checked on the folded clause text before single words. */
export const WH_PHRASES = Object.freeze([
  ['on how many occasions', 'how_many_times'], ['how many occasions', 'how_many_times'], ['how much time', 'how_long'],
  ['how many times', 'how_many_times'], ['de cate ori', 'how_many_times'], ['how often', 'how_many_times'], ['cat de des', 'how_many_times'], ['cat de frecvent', 'how_many_times'],
  ['since when', 'since_when'], ['de cand', 'since_when'], ['de cind', 'since_when'], ['until when', 'until_when'], ['pana cand', 'until_when'], ['pana cind', 'until_when'], ['till when', 'until_when'],
  ['how long', 'how_long'], ['cat timp', 'how_long'], ['cata vreme', 'how_long'],
  ['how many years', 'how_long'], ['how many months', 'how_long'], ['how many days', 'how_long'], ['cati ani', 'how_long'], ['cate luni', 'how_long'], ['cate zile', 'how_long'],
  ['up to what date', 'until_when'], ['until what date', 'until_when'], ['pana la ce data', 'until_when'], ['pina la ce data', 'until_when'], ['pina cind', 'until_when'], ['pina cand', 'until_when'], ['from what date', 'since_when'], ['de la ce data', 'since_when'],
  ['in what year', 'when'], ['what year', 'when'], ['in ce an', 'when'], ['on what date', 'when'], ['what date', 'when'], ['in ce data', 'when'], ['what time', 'when'], ['la ce ora', 'when'],
  ['how many', 'how_many'], ['how much', 'how_much'], ['de ce', 'why'], ['how come', 'why'], ['din ce motiv', 'why'], ['for what reason', 'why'], ['pentru ce motiv', 'why'], ['in what period', 'when'], ['in ce perioada', 'when'],
  ['where from', 'where_from'], ['de unde', 'where_from'], ['where to', 'where_to'], ['incotro', 'where_to'],
]);

/** Verbs whose clausal complement is the real question ("do you know if P", "check whether P", C6). */
export const EMBED_QUESTION = new Set(['know', 'tell', 'check', 'verify', 'find', 'confirm', 'wonder', 'ask', 'see', 'say', 'show', 'look', 'figure', 'let', 'remind', 'clarify', 'determine', 'explain', 'list', 'give', 'count', 'name', 'identify', 'establish', 'work', 'search', 'help',
  'sti', 'spune', 'verifica', 'afla', 'confirma', 'intreba', 'zice', 'arata', 'explica', 'lamuri', 'preciza', 'putea', 'vrea', 'dori', 'ajuta', 'uita', 'numara', 'enumera', 'numi', 'identifica', 'stabili', 'cauta', 'zi', 'interesa', 'curious', 'like']);
/** Nouns and adjectives that wrap a question or a claim ("any idea where …", "is it true that …", "e adevărat că …"). */
export const EMBED_WRAPPER_NOUNS = new Set(['idea', 'chance', 'case', 'true', 'false', 'possible', 'correct', 'right', 'sure', 'clue', 'question', 'fact-check',
  'idee', 'sansa', 'adevarat', 'fals', 'corect', 'sigur', 'posibil', 'cazul', 'caz', 'intrebare']);
/** Verbs of saying: "X says that P" → P with `speaker "X"` (C10). */
export const SAY = new Set(['say', 'claim', 'insist', 'swear', 'tell', 'report', 'state', 'mention', 'write', 'argue', 'admit', 'deny', 'announce', 'confirm', 'reckon',
  'spune', 'zice', 'sustine', 'afirma', 'pretinde', 'declara', 'jura', 'scrie', 'anunta', 'recunoaste', 'mentiona']);
/** Verbs of belief: first person → `hedged`; another subject → `hedged` + speaker (C10). */
export const THINK = new Set(['think', 'believe', 'guess', 'reckon', 'suspect', 'feel', 'expect', 'crede', 'banui', 'parea', 'socoti', 'considera']);
/** Suppositions: "suppose P", "să presupunem că P", "să zicem că P" → `supposed`. */
export const SUPPOSE = new Set(['suppose', 'assume', 'imagine', 'presupune', 'zice', 'considera', 'admite', 'pretend']);
/** Hedging adverbs → `certainty hedged`. */
export const HEDGE_ADVERBS = new Set(['probably', 'maybe', 'perhaps', 'possibly', 'apparently', 'likely', 'probabil', 'poate', 'posibil', 'aparent', 'pesemne']);
/** Modal auxiliaries kept inside the relation phrase (C2, Q-LANG-6). */
export const MODALS = new Set(['can', 'could', 'may', 'might', 'must', 'should', 'shall', 'ought', 'would']);
/** Romanian modal/aspectual verbs merged with their `să` complement ("poate să semneze" → "putea semna"). */
export const MERGE_VERBS = new Set(['putea', 'trebui', 'vrea', 'dori', 'incepe', 'termina', 'continua', 'planifica', 'planui', 'intentiona', 'obisnui', 'avea', 'incerca', 'hotari', 'decide',
  'plan', 'want', 'start', 'begin', 'stop', 'continue', 'try', 'need', 'intend', 'hope', 'decide', 'use', 'have', 'keep', 'finish', 'quit', 'like', 'love', 'prefer', 'manage', 'fail', 'refuse', 'agree', 'go']);

/** First-person pronouns → "the user" (Q-LANG-5); possessives → "the user's …". */
export const FIRST_PERSON = new Set(['i', 'me', 'myself', 'eu', 'mie', 'mine', 'ma', 'imi', 'mi', 'm']);
/** Romanian clitic pronouns that double an object or mark the requester ("o coordonează pe X", "spune-mi"). */
export const RO_CLITICS = new Set(['o', 'il', 'l', 'le', 'ii', 'i', 'mi', 'imi', 'ti', 'iti', 'ne', 'ni', 'va', 'vi', 'si', 'isi', 'se', 's', 'ma', 'te', 'ti-', 'mi-', 'l-', 'i-', 'le-', 'ne-', 'v-', 'm-', 'te-']);
/** Exclusion prepositions of a question ("besides Ana", "fără Kostas") → `except ?x "Ana"`. */
export const EXCEPT_PREPS = new Set(['besides', 'except', 'excluding', 'apart from', 'other than', 'but', 'fara', 'in afara de', 'exceptand', 'cu exceptia', 'mai putin', 'not counting']);
/** Comparators before a number ("over 45", "peste 45") → compare words (Q-LANG-1). */
export const COMPARATORS = Object.freeze([
  ['more than', 'above'], ['older than', 'above'], ['greater than', 'above'], ['over', 'above'], ['above', 'above'], ['mai mult de', 'above'], ['mai mare de', 'above'], ['peste', 'above'], ['mai mult decat', 'above'],
  ['less than', 'below'], ['younger than', 'below'], ['fewer than', 'below'], ['under', 'below'], ['below', 'below'], ['mai putin de', 'below'], ['mai mic de', 'below'], ['sub', 'below'], ['mai putin decat', 'below'],
  ['at least', 'at_least'], ['cel putin', 'at_least'], ['minimum', 'at_least'], ['at most', 'at_most'], ['cel mult', 'at_most'], ['maximum', 'at_most'], ['exactly', 'equal'], ['exact', 'equal'],
]);
/** Superlative value words → `rank highest|lowest ?v` (Q-LANG-1). */
export const RANK_VALUES = Object.freeze({'the most': 'highest', most: 'highest', 'the least': 'lowest', least: 'lowest', 'cel mai mult': 'highest', 'cel mai putin': 'lowest', 'cea mai mult': 'highest', 'cea mai putin': 'lowest'});
/** Quantifier words of a universal question (Q-LANG-2). */
export const QUANTIFIERS = Object.freeze({most: 'most', majority: 'most', half: 'half', 'jumatate': 'half', 'majoritatea': 'most', 'cei mai multi': 'most', 'cele mai multe': 'most'});
/** Aspectual verbs that turn "when did X start/stop …" into since-when / until-when. */
export const START_VERBS = new Set(['start', 'begin', 'incepe', 'apuca']);
export const STOP_VERBS = new Set(['stop', 'quit', 'finish', 'cease', 'end', 'inceta', 'termina', 'opri', 'renunta']);
export const FIRST_POSSESSIVE = new Set(['my', 'meu', 'mea', 'mei', 'mele', 'mine']);
/** Third-person pronouns that may be resolved to an antecedent named earlier in the message. */
export const THIRD_PERSON = new Set(['he', 'she', 'him', 'her', 'el', 'ea', 'lui', 'ei', 'il', 'o', 'l']);

/** Universal determiners: "all/every/each/toți/fiecare" → `mode every`; "no/nobody/niciun" → negated scope. */
export const UNIVERSAL = new Set(['all', 'every', 'each', 'everyone', 'everybody', 'tot', 'toti', 'toate', 'fiecare', 'oricare', 'oricine']);
export const NONE = new Set(['no', 'nobody', 'none', 'niciun', 'nicio', 'nimeni', 'niciunul', 'niciuna']);

/** Prepositions by role class (folded). A preposition not listed keeps the default (`object`). */
export const PREP_ROLE = Object.freeze({
  from: 'source', din: 'source', 'de la': 'source', out: 'source',
  into: 'destination', towards: 'destination', toward: 'destination', onto: 'destination', spre: 'destination', catre: 'destination', inspre: 'destination',
  with: 'instrument', by: 'instrument', via: 'instrument', using: 'instrument', cu: 'instrument',
  about: 'topic', regarding: 'topic', concerning: 'topic', despre: 'topic', 'because of': 'topic', 'din cauza': 'topic', 'due to': 'topic', 'din pricina': 'topic', 'in legatura cu': 'topic',
  pentru: 'recipient',
});
/** Prepositions whose place argument is a `location` when the argument is a place (NER GPE/LOC/FAC), else `object`. */
export const PLACE_PREPS = new Set(['in', 'at', 'on', 'inside', 'near', 'la', 'pe', 'langa', 'within', 'across', 'behind', 'under', 'above', 'intre', 'between', 'around', 'sub', 'peste', 'lânga']);
/** Temporal prepositions → validity form of a statement / period of a query. */
export const TIME_PREPS = Object.freeze({'pana pe': 'until', 'pina pe': 'until', 'pina la': 'until', pe: 'on', since: 'from', from: 'from', 'din': 'from', 'de la': 'from', 'incepand cu': 'from', until: 'until', till: 'until', 'pana la': 'until', pana: 'until', 'pana in': 'until', before: 'until', 'inainte de': 'until'});
/** Temporal nouns and adverbs that make an argument a time expression even without a DATE entity. */
export const TIME_WORDS = new Set(['yesterday', 'today', 'tomorrow', 'now', 'tonight', 'week', 'month', 'year', 'morning', 'evening', 'night', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'ieri', 'azi', 'astazi', 'maine', 'acum', 'saptamana', 'luna', 'an', 'anul', 'dimineata', 'seara', 'noaptea', 'luni', 'marti', 'miercuri', 'joi', 'vineri', 'sambata', 'duminica',
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'septembrie', 'octombrie', 'noiembrie', 'decembrie', 'semester', 'semestru', 'trimestru', 'quarter', 'season', 'sezon', 'weekend', 'last', 'next', 'ago']);

/** Whole-message greetings, thanks and chit-chat (C12 `no_request` when nothing else is said). */
export const SMALL_TALK = new Set(['hi', 'hello', 'hey', 'thanks', 'thank', 'you', 'ok', 'okay', 'bye', 'goodbye', 'good', 'morning', 'evening', 'night', 'cheers', 'great', 'cool', 'nice', 'yes', 'no', 'sure', 'fine', 'lol', 'wow',
  'salut', 'buna', 'ziua', 'seara', 'dimineata', 'mersi', 'multumesc', 'multumim', 'pa', 'bine', 'da', 'nu', 'super', 'ms', 'noroc', 'servus', 'hello', 'thx', 'ty', 'pls', 'please', 'te', 'rog', 'va', 'o', 'zi', 'frumoasa', 'faina', 'mult', 'very', 'much', 'a', 'have', 'nice', 'day', 'la', 'revedere', 'bro', 'u', 'mate', 'dude', 'man']);
/** v1.4 (R13b): thanks words; a short message with one of them and no question is small talk. */
export const THANKS = new Set(['thx', 'thanks', 'thank', 'ty', 'cheers', 'tks', 'thnx', 'mersi', 'multumesc', 'multumim', 'ms', 'merci']);
/** Action requests with no checkable question (C8 `no_request`). */
export const ACTION_REQUESTS = new Set(['write', 'translate', 'book', 'remind', 'compose', 'draft', 'send', 'call', 'order', 'schedule', 'summarize', 'generate', 'create', 'make', 'sing', 'play', 'draw', 'recommend', 'suggest', 'recomanda', 'sugera', 'propune',
  'scrie', 'traduce', 'rezerva', 'aminti', 'trimite', 'suna', 'comanda', 'programa', 'rezuma', 'genera', 'crea', 'face', 'desena', 'canta']);

/** Lead-ins and tails masked before parsing (replaced by spaces so offsets stay valid). Case-insensitive. */
export const MASKS = Object.freeze([
  /^\s*(?:hi|hello|hey|hai|hei|ciao|salut|salutare|bun[ăa] ziua|bun[ăa] seara|bun[ăa]|servus|nea|dear \w+|anyway|apropo|ok|okay|btw|deci|a[șs]adar|well|so|also|[șs]i|oh|honestly|sincer|quick one|quick question|one more thing|by the way|pe bune)\s*[,!.:-]+/iu,
  /(?:^|(?<=[.!?]\s{0,3}))\s*(?:background|context|question|[îi]ntrebare|info|note|not[ăa]|update|problem|problema)\s*:/giu,
  /^\s*(?:[\p{L}'’-]+\s+){0,2}[\p{L}'’-]+\s*:(?=\s)/u,
  /^\s*(?:fact[- ]check|true or false|adev[ăa]rat sau fals|question|quick question|[îi]ntrebare|btw|p\.?s\.?|ok so|so|deci|here'?s what i know|iat[ăa] ce [șs]tiu|ce [șs]tiu)\s*[:,-]/iu,
  /\b(?:please|pls|plz|te rog(?: frumos)?|v[ăa] rog(?: frumos)?)\b[,.]?/giu,
  // v1.3: mid-message lead-ins and question tails that carry no content.
  /(?:^|(?<=[.!?:]\s{0,3}))\s*(?:one more thing|both at once|help me with this one|remind me|a few questions,? then|so,? my questions|my questions|let me give you some background first)\s*[:,.]/giu,
  /(?:^|(?<=[.!?]\s{0,3}))\s*any\s+(?!chance\b)c\p{L}{2,6}ce(?=\s)/giu,
  /,\s*(?:if you know|if you can tell|by any chance)\s*(?=\?)/giu,
  /,\s*(?:do you know|any idea|[șs]tii|[șs]ti[țt]i|right|nu|corect|da|nu-i a[șs]a|isn't it|no|correct|true|a[șs]a e|a[șs]a-i|e corect|e adev[ăa]rat|am dreptate|yeah|yes|or what|am i right|is that right|is that correct)\s*(?=\?)/giu,
  // v1.4 (R1): lead-ins anywhere after a sentence boundary, typo-tolerant "fact-check" and "for context".
  /(?:^|(?<=[.!?:]\s{0,3}))\s*(?:f\p{L}{2,3}t[- ]?c\p{L}{2,4}k|true or false|here'?s what i know|here is what i know|here is what i would like to check|for con\p{L}{2,6}|facilities update from my side|adev[ăa]rat sau fals|iat[ăa] ce [șs]tiu)\s*[:,-]/giu,
  /\(\s*for con\p{L}{2,6}\s*[:,-]?/giu,
  // v1.4: "What were the dates when P?" asks when P (the wrapper words are masked, "when P?" remains).
  /\bwhat (?:were|are|was|is) the (?:dates?|periods?|times?|years?) (?=when\b)/giu,
  /(?:^|(?<=[.!?:]\s{0,3}))\s*(?:out of curiosity|just curious|curious|just checking|din curiozitate)\s*[,:]/giu,
  // v1.4 (R11b): a trailing "or not" of a yes/no question.
  /,?\s+or not(?=\s*\?)/giu,
  /,?\s+sau nu(?=\s*\?)/giu,
  /\b(?:thanks(?: a lot| in advance)?|thank you(?: very much)?|mersi(?: mult)?|mul[țt]umesc(?: frumos| mult)?|ms)\s*[!.]*\s*$/iu,
]);
