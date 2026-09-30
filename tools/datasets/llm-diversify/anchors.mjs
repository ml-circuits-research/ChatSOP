/** Mechanical filters of the paraphrase layer (DS022 "LLM diversification"), filters (a) and (b).
 *
 * (a) Anchors: every proper name and literal value of the gold target that the message writes must still be
 *     written in the paraphrase exactly as in the message; every content word of each stated or asked relation
 *     phrase must keep an inflected form (the DS022 relation-phrase convention, `relationWordProblems`); every
 *     number of the message stays and none is added.
 * (b) Cues: question-ness, the number of questions, negation count, certainty (hedge, supposition, reported
 *     speech, clause-initial conditionals), quantifiers, numeric bounds and presupposition triggers must agree
 *     between message and paraphrase.
 *
 * The gold target is read here only to derive what the paraphrase must preserve; it is never sent to a model.
 */
import {inflects, missingRelationWords} from '../diversity/relation-words.mjs';
import {foldDiacritics, editDistance} from '../diversity/text.mjs';

const fold = text => foldDiacritics(String(text ?? '')).toLowerCase().replace(/[’`´]/g, "'");
const tokens = text => fold(text).match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [];
const rawTokens = text => String(text ?? '').match(/[\p{L}\p{N}]+/gu) ?? [];

/** Quoted literal values of a target: roles, filters, speakers, times and validity bounds (not relations or readings). */
export function targetValues(target) {
  const out = [];
  for (const line of String(target ?? '').split('\n')) {
    const head = line.trim().split(/\s+/)[0];
    if (!['role', 'except', 'speaker', 'at', 'during', 'valid', 'asof'].includes(head)) continue;
    for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push(JSON.parse(`"${match[1]}"`));
  }
  return [...new Set(out)];
}

/** Every stated or asked proposition of the surface IR (assumed ones are exempt from the relation convention). */
const propositions = surface => [...(surface?.stated ?? []), ...(surface?.query?.props ?? []), ...(surface?.query?.scope ?? []), ...(surface?.moreQueries ?? []).flatMap(q => q.props ?? [])];

/**
 * What a paraphrase must preserve. `spans` are message substrings kept verbatim (`exact`) or case-insensitively;
 * `keyWords` are the message's forms of the relation-phrase content words; `untraced` counts target values the
 * message does not write (a resolved pronoun, "the user", a translated date), which the judge covers.
 */
export function protectedOf(row) {
  const message = row.question;
  const spans = new Map();
  let untraced = 0;
  const entities = row.verification_context?.entities ?? [];
  for (const value of targetValues(row.sop_target)) {
    if (message.includes(value)) { spans.set(value, 'exact'); continue; }
    const surfaces = entities.filter(entity => [entity.label, ...(entity.aliases ?? [])].includes(value)).flatMap(entity => [entity.label, ...(entity.aliases ?? [])]);
    const written = surfaces.filter(surface => surface && message.includes(surface)).sort((a, b) => b.length - a.length)[0];
    if (written) { spans.set(written, 'exact'); continue; }
    if (fold(message).includes(fold(value))) { spans.set(value, 'folded'); continue; }
    untraced++;
  }
  // Drop spans contained in a longer protected span ("Ana" inside "Ana Pop").
  const list = [...spans.keys()];
  for (const span of list) if (list.some(other => other !== span && other.includes(span))) spans.delete(span);
  const words = rawTokens(message);
  const keyWords = [];
  for (const prop of propositions(row.surface_ir)) {
    const phrase = prop.source_relation ?? prop.relation;
    if (!phrase) continue;
    for (const lemma of missingRelationWords(phrase, '')) {
      const form = words.find(word => inflects(lemma, fold(word)));
      if (form && !keyWords.includes(form)) keyWords.push(form);
    }
  }
  const numbers = [...new Set(rawTokens(message).filter(token => /\d/.test(token)))];
  return {spans: [...spans].map(([text, mode]) => ({text, mode})), keyWords, numbers, untraced};
}

/** Filter (a). Returns the list of problems (empty when the paraphrase keeps every anchor). */
export function anchorProblems(row, paraphrase, kept = protectedOf(row)) {
  const problems = [];
  for (const {text, mode} of kept.spans)
    if (mode === 'exact' ? !paraphrase.includes(text) : !fold(paraphrase).includes(fold(text))) problems.push(`span ${JSON.stringify(text)} missing`);
  // A relation word the message only writes with a typo ("dpend") counts as kept when the paraphrase writes it
  // correctly or keeps the message's misspelled token; otherwise a typo would hide a changed verb.
  const messageWords = tokens(row.question), paraphraseWords = tokens(paraphrase);
  for (const prop of propositions(row.surface_ir)) {
    const phrase = prop.source_relation ?? prop.relation;
    if (!phrase) continue;
    const missing = missingRelationWords(phrase, paraphrase).filter(lemma => {
      if (messageWords.some(word => inflects(lemma, word))) return true;
      const typo = messageWords.filter(word => editDistance(lemma.slice(0, word.length + 1), word, 2) <= 2 && word.length >= 3);
      // A lemma the message does not write recognizably ("bc" for "because") is left to the judge.
      return typo.length > 0 && !typo.some(word => paraphraseWords.includes(word));
    });
    if (missing.length) problems.push(`relation ${JSON.stringify(phrase)} lacks ${missing.join(', ')}`);
  }
  problems.push(...voiceProblems(row, paraphrase), ...focusProblems(row, paraphrase));
  const numbers = new Set(rawTokens(paraphrase).filter(token => /\d/.test(token)));
  for (const number of kept.numbers) if (!numbers.has(number)) problems.push(`number ${number} missing`);
  for (const number of numbers) if (!kept.numbers.includes(number) && !kept.spans.some(span => span.text.includes(number))) problems.push(`number ${number} added`);
  return problems;
}

/**
 * Voice (part of filter (a)): an English passive relation with a by-agent ("be issued by") must stay passive, and
 * an active one ("raise") must not become a by-passive, because the roles of the target follow the voice
 * (DS021: a by-agent passive keeps the passive with the agent as role object). The relation-word check alone
 * cannot see this: "is issued by" and "issues" share their content word.
 */
const COPULA = /\b(?:is|are|was|were|be|been|being|am|isn't|aren't|wasn't|weren't|isnt|arent|wasnt|werent)\b|'s\b|'re\b|'m\b/;
export function voiceProblems(row, paraphrase) {
  const text = fold(paraphrase), problems = [];
  for (const prop of propositions(row.surface_ir)) {
    if (prop.source_relation) {
      // Romanian: an active relation must not become a "fi + participle + de" passive ("a fost scrisă de").
      const lemma = tokens(prop.source_relation).find(word => !['fi', 'a', 'se', 'si'].includes(word));
      if (lemma && tokens(prop.source_relation)[0] !== 'fi')
        for (const match of text.matchAll(/\b(?:a fost|au fost|fost|este|e|sunt|era|erau|fie|fi)\s+(\w+)\s+de(?:\s+catre)?\b/g))
          if (inflects(lemma, match[1])) { problems.push(`active "${prop.source_relation}" became a passive`); break; }
      continue;
    }
    if (!prop.relation) continue;
    const words = tokens(prop.relation);
    if (words[0] === 'be' && COPULA.test(fold(row.question)) && !COPULA.test(text)) problems.push(`copula of "${prop.relation}" dropped`);
    if (words[0] === 'be' && words.includes('by')) {
      if (!/\bby\b/.test(text)) problems.push(`passive "${prop.relation}" lost its by-agent`);
    } else if (words[0] !== 'be') {
      const lemma = words[0];
      for (const match of text.matchAll(/\b(?:is|are|was|were|be|been|being|get|gets|got|getting|'s)\s+(?:\w+ly\s+|not\s+)?(\w+)\s+by\b/g))
        if (inflects(lemma, match[1])) { problems.push(`active "${prop.relation}" became a by-passive`); break; }
    }
  }
  return problems;
}

/**
 * Question focus (part of filter (a)): what the message asks must still be asked and what it states must not
 * become the asked part. A proposition is "asked" when one of its relation words is in a segment that ends with a
 * question mark (segments end at . ! ? ; and dashes). "Youssef plays for CS Lviv. He completed the training,
 * right?" -> "Youssef completed the training - he plays for CS Lviv, correct?" moves the question and fails.
 */
export function focusProblems(row, paraphrase) {
  const segments = text => String(text).split(/(?<=[.!?;])\s+|\s+[-–—]\s+|[—–]/).map(part => ({words: tokens(part), asks: /\?\s*$/.test(part.trim())}));
  const place = (text, phrase) => {
    const lemmas = missingRelationWords(phrase, '');
    if (!lemmas.length) return null;
    const hits = segments(text).filter(seg => lemmas.some(lemma => seg.words.some(word => inflects(lemma, word))));
    return hits.length ? {asked: hits.some(seg => seg.asks), stated: hits.some(seg => !seg.asks)} : null;
  };
  if (!row.question.includes('?') || !paraphrase.includes('?')) return [];
  const problems = [];
  const check = (prop, kind) => {
    const phrase = prop.source_relation ?? prop.relation;
    if (!phrase) return;
    const before = place(row.question, phrase), after = place(paraphrase, phrase);
    if (!before || !after) return;
    if (kind === 'query' && before.asked && !after.asked) problems.push(`"${phrase}" is no longer asked`);
    if (kind === 'stated' && before.stated && !after.stated) problems.push(`stated "${phrase}" became part of the question`);
  };
  for (const prop of row.surface_ir?.stated ?? []) check(prop, 'stated');
  for (const prop of [...(row.surface_ir?.query?.props ?? []), ...(row.surface_ir?.moreQueries ?? []).flatMap(q => q.props ?? [])]) check(prop, 'query');
  return problems;
}

// ---------------------------------------------------------------- filter (b): cue consistency
const count = (pattern, text) => (fold(text).match(pattern) ?? []).length;
const NEGATION = /\b(?:not|no|never|none|nobody|nothing|neither|nor|without|cannot|nowhere|dont|didnt|doesnt|isnt|wasnt|arent|werent|hasnt|havent|hadnt|cant|wont|wouldnt|couldnt|shouldnt|nu|niciun|nicio|niciunul|niciuna|niciodata|nimeni|nimic|fara|nici)\b|n't\b/g;
const QUESTION_START = /(?:^|[.!?]\s+|\n)\s*(?:who|whom|whose|what|which|when|where|why|how|do|does|did|is|are|was|were|has|have|had|can|could|would|will|should|may|am|isn't|aren't|doesn't|don't|didn't|cine|ce|care|cand|unde|cum|cati|cate|cat|oare|exista|poti|stii)\b/;
const REQUEST = /\b(?:tell me|let me know|check|confirm|verify|find out|wonder|whether|do you know|can you|could you|any idea|spune-mi|zi-mi|verifica|confirma|afla|ma intreb|stii daca|daca|vreau sa stiu)\b/;
const CUES = {
  hedge: /\b(?:i think|i believe|i guess|probably|maybe|perhaps|likely|i suspect|cred ca|probabil|banuiesc|parca|mi se pare)\b/,
  supposition: /\b(?:suppose|supposing|let's say|lets say|imagine|assume|assuming|hypothetically|presupun|presupunand|sa zicem|sa presupunem|ipotetic)\b/,
  report: /\b(?:says|said|claims|claimed|according to|reports|reported|insists|spune ca|zice ca|a zis|a spus|sustine|potrivit)\b/,
  universal: /\b(?:all|every|everyone|everybody|each|toti|toate|fiecare|oricine)\b/,
  only: /\b(?:only|doar|numai)\b/,
  most: /\b(?:most|majority|majoritatea|cei mai multi)\b/,
  presupposition: /\b(?:still|again|anymore|inca|din nou|iarasi)\b/,
  // Temporal order: "A before B" and "B after A" are equivalent in meaning but not in the target (order ?t1 before ?t2).
  before: /\b(?:before|earlier|prior to|inainte|mai devreme)\b/,
  after: /\b(?:after|later|afterwards|dupa|mai tarziu)\b/,
  bound: /\b(?:exactly|exact|at least|at most|more than|less than|fewer than|half|cel putin|cel mult|mai mult de|mai putin de|jumatate)\b/,
  // "if" / "dacă" that is not governed by a check or ask verb makes a supposition ("… if each table takes 5 to 13").
  conditional: /(?<!\b(?:check|checking|see|know|wonder|wondering|ask|asking|verify|confirm|tell me|find out|sure|unsure|verifica|stii|intreb|confirma|confirmi|afla|spune-mi|zi-mi|sa stiu|sa aflu|vezi|ma gandesc|curios)\s+)\b(?:if|daca|in cazul in care|in case)\b/,
};

/** Tag questions ("…, nu?", "…, doesn't she?", "…, nu-i așa?") ask for confirmation; they carry no negation. */
const TAG = /,?\s*(?:nu|no|nu-i asa|nu e asa|nu crezi|(?:is|are|was|were|do|does|did|has|have|had|can|could|will|would|should)n'?t\s+(?:he|she|it|they|we|you|i|there))\s*\?/g;
const withoutTags = text => fold(text).replace(TAG, '?');

/** Answer-type classes of wh-questions: the target's question form follows them (time questions, count, why, where). */
const WH = {
  until_when: /\b(?:until when|till when|up to when|pana cand|pana la ce data)\b/,
  since_when: /\b(?:since when|de cand|din ce an|din ce data)\b/,
  how_long: /\b(?:how long|for how long|cat timp|cata vreme|de cat timp)\b/,
  how_many_times: /\b(?:how many times|how often|de cate ori)\b/,
  how_many: /\b(?:how many|how much|cati|cate|cat costa|cat e|cat face|cat inseamna)\b/,
  why: /\b(?:why|how come|what explains|de ce|cum se explica|care e motivul|care-i explicatia)\b/,
  where: /\b(?:where|unde|in ce oras|in ce tara)\b/,
  when: /\b(?:when|cand|what time|what date|la ce ora|in ce zi)\b/,
  who: /\b(?:who|whom|whose|cine|pe cine|al cui|a cui)\b/,
};
const whClasses = text => {
  let rest = fold(text);
  const out = [];
  for (const [name, pattern] of Object.entries(WH)) if (pattern.test(rest)) { out.push(name); rest = rest.replace(new RegExp(pattern.source, 'g'), ' '); }
  return out.sort().join(',');
};

const asks = text => fold(text).includes('?') || QUESTION_START.test(fold(text)) || REQUEST.test(fold(text));

/** Filter (b). Returns the list of cue disagreements (empty when polarity, question form and certainty agree). */
export function cueProblems(row, paraphrase) {
  const problems = [];
  const message = row.question;
  if (asks(message) !== asks(paraphrase)) problems.push(asks(message) ? 'question became a statement' : 'statement became a question');
  const queries = (String(row.sop_target).match(/^@\S+\s+query\s*$/gm) ?? []).length;
  const marks = text => (String(text).match(/\?/g) ?? []).length;
  if (queries >= 2 && marks(paraphrase) < Math.min(queries, marks(message))) problems.push(`fewer questions (${marks(paraphrase)} < ${Math.min(queries, marks(message))})`);
  const whBefore = whClasses(message), whAfter = whClasses(paraphrase);
  if (whBefore !== whAfter) problems.push(`wh form ${whBefore || 'none'} -> ${whAfter || 'none'}`);
  const negBefore = count(NEGATION, withoutTags(message)), negAfter = count(NEGATION, withoutTags(paraphrase));
  if (negBefore !== negAfter) problems.push(`negation count ${negBefore} -> ${negAfter}`);
  for (const [name, pattern] of Object.entries(CUES)) {
    const before = pattern.test(fold(message)), after = pattern.test(fold(paraphrase));
    if (before !== after) problems.push(`${name} cue ${before ? 'dropped' : 'added'}`);
  }
  return problems;
}
