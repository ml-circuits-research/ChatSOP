/** The EmotionDetectionSystem in the chat turn (DS023 "Chat turn"): what the host does with the signals before and after
 * the formalizer. Everything here is pure, deterministic host text; no model writes any of it and no signal becomes a fact.
 *
 *   interpret(message, signals)  -> {language, courtesyOnly, signalOnly, core, wireSignals}
 *   standaloneReply(signals, language)  the reply to a message with no request (courtesy only, emotion only, or `unclear no_request`)
 *   tone(text, {signals, advice, status})  the English answer with the courtesy phrase and the tone the signals ask for
 *
 * Languages: the detector runs on the raw message, before any translation, so its lexicon covers the two languages of the product, English
 * and Romanian. A standalone reply is written in the language of the signals; the tone phrases of an answer are English like the answer
 * itself, and the output edge (server/answer-language.mjs) phrases the whole answer in the language of the message.
 */
import {fold} from './strategies/symbolic.mjs';
import {RO_LABELS} from './lexicon.mjs';

const COURTESY = ['closing', 'thanks', 'apology', 'greeting', 'politeness'];
/** Courtesy kinds whose span, at the very start or end of a message, is not part of the request and may be stripped before the formalizer. */
const EDGE = new Set(['greeting', 'closing', 'thanks', 'apology']);
/** Kinds whose span is a reaction, not content; a message made only of such spans (and filler words) has no request. */
const REACTION = new Set([...COURTESY, 'urgency', 'frustration', 'anger', 'confusion', 'curiosity', 'joy', 'sadness', 'fear', 'disappointment', 'profanity', 'offensive']);
const FILLER = new Set(("i i'm im i'd i've am is are was be so very really just quite too bit a the it this that you we my me to feel feeling now here there again and but not no yes ok okay oh ah well um uh " +
  'sunt e este foarte cam prea asa si dar nu da eu mi ma am o un ce deci acum aici').split(' '));
const STANDALONE_BY_EMOTION = ['confusion', 'frustration', 'anger', 'disappointment', 'sadness', 'fear', 'joy', 'urgency'];

const REPLIES = {
  greeting: {en: 'Hello! What would you like to know?', ro: 'Bună! Cu ce te pot ajuta?'},
  thanks: {en: "You're welcome.", ro: 'Cu plăcere.'},
  closing: {en: 'Goodbye!', ro: 'La revedere!'},
  apology: {en: 'No problem.', ro: 'Nicio problemă.'},
  politeness: {en: 'How can I help?', ro: 'Cu ce te pot ajuta?'},
  confusion: {en: 'Sorry for the confusion. Tell me which part is unclear, or ask a question, and I will explain it.', ro: 'Scuze pentru confuzie. Spune-mi ce nu e clar sau pune o întrebare și îți explic.'},
  frustration: {en: 'I am sorry about the trouble. Tell me what you need and I will go through it step by step.', ro: 'Îmi pare rău pentru neplăcere. Spune-mi ce ai nevoie și parcurgem pas cu pas.'},
  sadness: {en: 'I am sorry to hear that. Ask me anything whenever you are ready.', ro: 'Îmi pare rău să aud asta. Întreabă-mă orice când ești gata.'},
  joy: {en: 'Glad to hear it! What would you like to know?', ro: 'Mă bucur! Ce ai vrea să afli?'},
  urgency: {en: 'I am here. What do you need?', ro: 'Sunt aici. Ce ai nevoie?'},
  none: {en: 'What would you like to know?', ro: 'Ce ai vrea să afli?'},
};
REPLIES.anger = REPLIES.disappointment = REPLIES.fear = REPLIES.frustration;
REPLIES.fear = REPLIES.sadness;

const live = signals => signals.filter(s => s.score >= 0.5);

/** The language of the signals: Romanian when more of the courtesy and reaction signals come from Romanian lexicon entries than from English ones, or the message has Romanian letters. */
export function signalLanguage(signals, message = '') {
  const ro = signals.filter(s => RO_LABELS.has(s.label)).length, en = signals.filter(s => !RO_LABELS.has(s.label) && s.label).length;
  if (ro !== en) return ro > en ? 'ro' : 'en';
  if (ro > 0) return 'ro';
  // Without a matching signal the message itself decides: Romanian letters, or more Romanian than English function words.
  if (/[ăâîșțşţ]/i.test(message)) return 'ro';
  const words = fold(message).match(/[\p{L}']+/gu) ?? [];
  return words.filter(w => RO_WORDS.has(w)).length > words.filter(w => EN_WORDS.has(w)).length ? 'ro' : 'en';
}
const RO_WORDS = new Set('si sa nu este sunt bine atunci unde cine cum care pentru despre dar foarte mai ce cand de la cu'.split(' '));
const EN_WORDS = new Set('the is are a an of to and what where who how when why do does it in on for with that this ok okay then'.split(' '));

const letters = s => (s.match(/\p{L}/gu) ?? []).length;
const without = (message, signals) => { let rest = message; for (const s of signals) if (s.span) rest = rest.replace(s.span, ' '); return rest; };
const onlyFiller = text => (fold(text).match(/[\p{L}']+/gu) ?? []).every(w => FILLER.has(w));

/** Strips greeting, closing, thanks and apology spans that stand at the very start or end of the message; content is never stripped. */
export function stripEdges(message, signals) {
  const spans = live(signals).filter(s => EDGE.has(s.kind) && s.span).map(s => s.span);
  let text = message.trim(), changed = true;
  while (changed) {
    changed = false;
    for (const span of spans) {
      const head = text.match(new RegExp('^' + span.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s,;:!.\\-]*', 'i'));
      if (head && head[0].length < text.length) { text = text.slice(head[0].length); changed = true; }
      const tail = text.match(new RegExp('[\\s,;:!.\\-]*' + span.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s.!?]*$', 'i'));
      if (tail && tail.index > 0) { text = text.slice(0, tail.index); changed = true; }
    }
  }
  return text.trim() && letters(text) ? text.trim() : message;
}

/** What the signals say about the whole message. `core` is the message the formalizer gets (edge courtesy stripped). */
export function interpret(message, signals) {
  const used = live(signals), courtesy = used.filter(s => COURTESY.includes(s.kind));
  const language = signalLanguage(used.filter(s => REACTION.has(s.kind)), message);
  // A courtesy message with at most one word left (an address such as "Hello Claude") has no request either.
  const courtesyOnly = courtesy.length > 0 && (fold(without(message, courtesy)).match(/[\p{L}']+/gu) ?? []).length <= 1;
  const reactions = used.filter(s => REACTION.has(s.kind));
  const signalOnly = !courtesyOnly && reactions.length > 0 && onlyFiller(without(message, reactions));
  return {language, courtesyOnly, signalOnly, core: stripEdges(message, used), wireSignals: signals.filter(s => !s.experimental)};
}

/** The reply to a message without a request, in `language` ('en' or 'ro'). Courtesy first (as DS023 "Use by the reasoner"), then the strongest emotion, else a plain invitation. */
export function standaloneReply(signals, language = 'en') {
  const kinds = new Set(live(signals).map(s => s.kind));
  const courtesy = COURTESY.filter(k => kinds.has(k)).slice(0, 2);
  const keys = courtesy.length ? courtesy : [STANDALONE_BY_EMOTION.find(k => kinds.has(k)) ?? 'none'];
  // "Thanks, hello" answers the thanks first; the question invitation of a greeting is dropped when another reply already follows it.
  return keys.map(k => REPLIES[k][language] ?? REPLIES[k].en).join(' ');
}

const OPENING = {greeting: 'Hello!', thanks: 'Happy to help.', apology: 'No problem.', politeness: 'Of course.'};
const SORRY = new Set(['frustration', 'anger', 'disappointment']);

/** The answer text with the tone the signals ask for (DS023 "Chat turn"). `advice` is adviceFor(signals). A clarification or an `unclear` answer is returned unchanged. */
export function tone(text, {signals = [], advice = null, status = null} = {}) {
  if (!text || ['unclear', 'clarify', 'courtesy'].includes(status)) return {text, applied: []};
  const kinds = new Set(live(signals).map(s => s.kind)), applied = [];
  let body = text;
  if (advice?.answerStyle === 'short' && kinds.has('urgency') && body.includes('\n')) { body = body.split('\n')[0]; applied.push('shortened'); }
  const before = [];
  const opening = ['greeting', 'thanks', 'apology', 'politeness'].find(k => kinds.has(k));
  if (opening) { before.push(OPENING[opening]); applied.push('courtesy:' + opening); }
  if ([...kinds].some(k => SORRY.has(k))) { before.push('Sorry for the trouble.'); applied.push('apology'); }
  else if (kinds.has('sadness') || kinds.has('fear')) { before.push('I am sorry to hear that.'); applied.push('support'); }
  const after = [];
  if (kinds.has('confusion')) { after.push('If something is still unclear, tell me which part and I will explain it differently.'); applied.push('clarification'); }
  if (kinds.has('closing')) { after.push('Goodbye!'); applied.push('courtesy:closing'); }
  return {text: [...before, body, ...after].join(' ').replace(/ \n/g, '\n').replace(/\n /g, '\n'), applied};
}
