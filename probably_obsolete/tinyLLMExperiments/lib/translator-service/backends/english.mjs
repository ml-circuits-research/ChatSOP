/**
 * TranslatorService backend `symbolic`: a small English morphology for the realizer of
 * lib/translator-service/backends/symbolic.mjs (verb tense and person, noun plural, the indefinite article).
 * Hand-authored, deterministic; the irregular verb and noun tables below are ChatSOP-authored lists of common
 * English forms (MIT, repository LICENSE). Moved out of lib/symbolic-lm/ with the rest of the symbolic translator
 * (owner decision 2026-09-29, DS021 "TranslatorService") without a behaviour change.
 */

// base: [past, past participle]
const IRREGULAR = Object.freeze(Object.fromEntries(`arise arose arisen|awake awoke awoken|be was been|bear bore borne|beat beat beaten|become became become|begin began begun|bend bent bent|bet bet bet|bind bound bound|bite bit bitten|bleed bled bled|blow blew blown|break broke broken|breed bred bred|bring brought brought|broadcast broadcast broadcast|build built built|burn burned burned|burst burst burst|buy bought bought|catch caught caught|choose chose chosen|cling clung clung|come came come|cost cost cost|creep crept crept|cut cut cut|deal dealt dealt|dig dug dug|do did done|draw drew drawn|dream dreamed dreamed|drink drank drunk|drive drove driven|eat ate eaten|fall fell fallen|feed fed fed|feel felt felt|fight fought fought|find found found|flee fled fled|fly flew flown|forbid forbade forbidden|forget forgot forgotten|forgive forgave forgiven|freeze froze frozen|get got got|give gave given|go went gone|grind ground ground|grow grew grown|hang hung hung|have had had|hear heard heard|hide hid hidden|hit hit hit|hold held held|hurt hurt hurt|keep kept kept|kneel knelt knelt|know knew known|lay laid laid|lead led led|lean leaned leaned|leap leapt leapt|learn learned learned|leave left left|lend lent lent|let let let|lie lay lain|light lit lit|lose lost lost|make made made|mean meant meant|meet met met|pay paid paid|prove proved proven|put put put|quit quit quit|read read read|ride rode ridden|ring rang rung|rise rose risen|run ran run|say said said|see saw seen|seek sought sought|sell sold sold|send sent sent|set set set|sew sewed sewn|shake shook shaken|shine shone shone|shoot shot shot|show showed shown|shrink shrank shrunk|shut shut shut|sing sang sung|sink sank sunk|sit sat sat|sleep slept slept|slide slid slid|speak spoke spoken|speed sped sped|spend spent spent|spin spun spun|split split split|spread spread spread|spring sprang sprung|stand stood stood|steal stole stolen|stick stuck stuck|sting stung stung|stink stank stunk|strike struck struck|string strung strung|strive strove striven|swear swore sworn|sweep swept swept|swim swam swum|swing swung swung|take took taken|teach taught taught|tear tore torn|tell told told|think thought thought|throw threw thrown|understand understood understood|undertake undertook undertaken|upset upset upset|wake woke woken|wear wore worn|weave wove woven|weep wept wept|win won won|wind wound wound|withdraw withdrew withdrawn|write wrote written|oversee oversaw overseen|overcome overcame overcome|undergo underwent undergone|rebuild rebuilt rebuilt|rewrite rewrote rewritten|mislead misled misled|withhold withheld withheld|forecast forecast forecast|outgrow outgrew outgrown|overtake overtook overtaken`
  .split('|').map(line => { const [base, past, part] = line.split(' '); return [base, {past, part}]; })));

const NOUN_PLURAL = Object.freeze({person: 'people', man: 'men', woman: 'women', child: 'children', foot: 'feet', tooth: 'teeth', mouse: 'mice', goose: 'geese', ox: 'oxen', analysis: 'analyses', crisis: 'crises', thesis: 'theses', criterion: 'criteria', phenomenon: 'phenomena', datum: 'data', medium: 'media', sheep: 'sheep', fish: 'fish', series: 'series', species: 'species', aircraft: 'aircraft', staff: 'staff', information: 'information', equipment: 'equipment', advice: 'advice', news: 'news', knife: 'knives', life: 'lives', wife: 'wives', leaf: 'leaves', half: 'halves', shelf: 'shelves', wolf: 'wolves', thief: 'thieves'});

const VOWEL = /[aeiou]/;
/** Regular verb forms. CVC doubling only for short stems ("stop" → "stopped"; "visit" → "visited"). */
function regular(base, form) {
  if (form === 's') {
    if (/(s|x|z|ch|sh|o)$/.test(base)) return base + 'es';
    if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ies';
    return base + 's';
  }
  // CVC doubling for short stems ("stop" → "stopped") and a final single-vowel "l" ("enrol" → "enrolled", "travel").
  const doubled = (/^[^aeiou]*[aeiou][bdgklmnprt]$/.test(base) && base.length <= 4 && !/w$|x$|y$/.test(base)) || /[^aeiou][aeiou]l$/.test(base);
  if (form === 'ed') {
    if (/e$/.test(base)) return base + 'd';
    if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ied';
    return (doubled ? base + base.at(-1) : base) + 'ed';
  }
  if (form === 'ing') {
    if (/ie$/.test(base)) return base.slice(0, -2) + 'ying';
    if (/[^e]e$/.test(base) && base !== 'be' && base !== 'see') return base.slice(0, -1) + 'ing';
    return (doubled ? base + base.at(-1) : base) + 'ing';
  }
  return base;
}

/**
 * Inflect the verb of an English phrase ("work at", "take part in", "be enrolled at"): only the first word
 * changes. `form`: `base`, `s` (third person singular present), `past`, `part` (past participle), `ing`.
 * `person`/`number` choose "am/is/are" and "was/were" for "be".
 */
export function inflectVerb(phrase, form, {person = 3, number = 'Sing'} = {}) {
  const [verb, ...rest] = String(phrase).split(' ');
  const tail = rest.length ? ' ' + rest.join(' ') : '';
  const v = verb.toLowerCase();
  let out;
  if (v === 'be') {
    if (form === 's' || form === 'present') out = number === 'Plur' || person === 2 ? 'are' : person === 1 ? 'am' : 'is';
    else if (form === 'past') out = number === 'Plur' || person === 2 ? 'were' : 'was';
    else if (form === 'part') out = 'been';
    else if (form === 'ing') out = 'being';
    else out = 'be';
    return out + tail;
  }
  if (v === 'have' && (form === 's' || form === 'present')) return (number === 'Sing' && person === 3 ? 'has' : 'have') + tail;
  if (form === 'present') form = number === 'Sing' && person === 3 ? 's' : 'base';
  if (form === 'base') return verb + tail;
  if (form === 's') out = v === 'do' ? 'does' : v === 'go' ? 'goes' : regular(v, 's');
  else if (form === 'past') out = IRREGULAR[v]?.past ?? regular(v, 'ed');
  else if (form === 'part') out = IRREGULAR[v]?.part ?? regular(v, 'ed');
  else if (form === 'ing') out = regular(v, 'ing');
  else out = verb;
  return out + tail;
}

/** Plural of an English noun phrase head (the last word of the phrase). */
export function pluralize(phrase) {
  const words = String(phrase).split(' ');
  const last = words.at(-1);
  const lower = last.toLowerCase();
  let plural;
  if (NOUN_PLURAL[lower]) plural = NOUN_PLURAL[lower];
  else if (/(s|x|z|ch|sh)$/.test(lower)) plural = last + 'es';
  else if (/[^aeiou]y$/.test(lower)) plural = last.slice(0, -1) + 'ies';
  else plural = last + 's';
  return [...words.slice(0, -1), plural].join(' ');
}

/** "a" or "an" before a word. */
export const indefinite = word => (/^(?:[aeio]|u(?!ni|se|su|ro|ti|ku)|hour|honest|honou?r)/i.test(String(word)) ? 'an' : 'a');

/** Is `word` one of the irregular or known English verbs of the table (for tests and diagnostics). */
export const isIrregular = verb => Object.hasOwn(IRREGULAR, String(verb).toLowerCase());
