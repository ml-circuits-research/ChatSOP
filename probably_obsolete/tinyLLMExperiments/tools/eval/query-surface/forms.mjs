/**
 * Question forms of the query-surface evaluation (owner priority 2026-10-01). A MEASUREMENT instrument only: it reads
 * the surface of a message to say which query form a question needs, so coverage can be tabulated per form. It is not
 * a rule of SymbolicLM (the rules read the UD analysis) and never feeds one. A message may need several forms
 * (multi-label); `primary` picks one for the one-row-per-question tables.
 *
 * Forms: wh, yes_no, count, quantified, comparative, temporal, why, why_not, plan, abduce, what_if, conform, procedure,
 * negated, embedded, multi.
 */
export const FORMS = Object.freeze(['wh', 'yes_no', 'count', 'quantified', 'comparative', 'temporal', 'why', 'why_not', 'plan', 'abduce', 'what_if', 'conform', 'procedure', 'negated', 'embedded', 'multi']);

/** Sentences of a message that are questions: those ending in "?" (a trailing quote or bracket allowed). */
export function questionSentences(message) {
  const text = String(message).replace(/\s+/g, ' ');
  return (text.match(/[^.!?]*\?+["')\]”]*/g) ?? []).map(s => s.trim()).filter(Boolean);
}

const AUX = 'do|does|did|is|are|was|were|has|have|had|can|could|will|would|should|shall|may|might|must|am';
const NEG = String.raw`(?:\bnot\b|n['’]t\b|\bnever\b|\bno one\b|\bnobody\b|\bnone\b|\bneither\b|\bnor\b|\bwithout\b)`;
const re = {
  count: /\bhow many\b|\bhow much\b|\bnumber of\b|\bcount (?:of|the)\b|\bhow often\b/i,
  quantified: /\b(?:all|every|each|everyone|everybody|everything|no one|nobody|none|anyone|anybody|anything|any|most|both|half|only|at least \d+|at most \d+)\b/i,
  comparative: /\b(?:more|less|fewer|greater|higher|lower|bigger|smaller|older|younger|longer|shorter|earlier|later|better|worse|cheaper|faster|slower|larger|\w+er) than\b|\b(?:the )?(?:most|least|\w{3,}est|highest|lowest|best|worst|first|last|latest|earliest)\b|\bover \d|\bunder \d|\bat least\b|\bat most\b|\bmore than \d/i,
  temporal: /\bwhen\b|\bsince\b|\buntil\b|\btill\b|\bhow long\b|\bwhat time\b|\bwhat date\b|\bwhich year\b|\bbefore\b|\bafter\b|\bduring\b|\bhow many times\b|\bfor how long\b|\bby when\b/i,
  why_not: /\bwhy (?:not|(?:is|are|was|were|do|does|did|can|could|will|would|should|has|have|had)n['’]t|(?:isn|aren|wasn|weren|don|doesn|didn|can|couldn|won|wouldn|shouldn|hasn|haven|hadn)['’]t)\b|\bwhat(?:['’]s| is| would be| was) (?:missing|blocking|stopping|preventing|wrong)\b|\bwhat would (?:make|it take)\b|\bwhat (?:prevents|stops|blocks)\b|\bwhy .*\b(?:not|never)\b/i,
  why: /\bwhy\b|\bhow come\b|\bwhat(?:['’]s| is| was) the (?:reason|cause)\b|\bwhat caused\b|\bwhat explains\b|\bwhat could explain\b|\bwhat makes\b|\bhow did .* come to\b/i,
  plan: /\bhow (?:do|can|should|would|could|might|to|will) (?:i|we|you|one|someone)\b|\bhow to\b|\bwhat are the steps\b|\bsteps (?:to|for)\b|\bwhat should (?:i|we) do\b|\bwhat do (?:i|we) need to do\b|\bwhat(?:['’]s| is) the way to\b|\bhow (?:do|can) (?:i|we) (?:get|make|fix|reset|set)/i,
  abduce: /\bwhat (?:could|might|may|would) (?:have )?(?:explain|caused?|be (?:the )?(?:cause|reason|explanation)|be behind|account for|lead to)\b|\b(?:which|what) (?:fault|cause|reason|factor|event)s? (?:could|might|may|would)\b|\bwhat (?:could|might|may) be behind\b|\bpossible (?:cause|explanation)s?\b/i,
  what_if: /^\W*(?:and )?what if\b|\bwhat (?:would|will|could|might) happen\b|^\W*if\b[^?]*,[^?]*\?|\b(?:would|could|will|might)\b[^?]*\bif\b|\bsuppose\b|\bassuming\b|\bin case\b|\bimagine\b|\bwhat about if\b/i,
  conform: /\b(?:compliant|compliance|complies|comply|follow(?:ed|ing)? (?:the|our|this|that|a) (?:procedure|process|policy|protocol|rules?|checklist|steps?|guidelines?)|allowed to|permitted|permissible|authori[sz]ed to|is it (?:ok|okay|legal|fine|acceptable) to|may (?:i|we)|against (?:the )?(?:policy|rules?|procedure)|according to (?:the )?(?:policy|procedure|rules?)|did we (?:follow|stick to|violate|breach)|violat\w+|required to|supposed to|entitled to|eligible)\b/i,
  procedure: /\bwhat(?:['’]s| is| are) the (?:\w+ )*(?:procedure|process|protocol|policy|checklist|steps)\b|\bwhich (?:procedure|process|protocol|policy) (?:applies|covers|governs)\b|\bwhat does the (?:\w+ )*(?:procedure|policy|process) (?:say|require|specify)\b/i,
  embedded: /^\W*(?:(?:hey|so|ok|okay|um|please|quick question|just|well)[,:]?\s+)*(?:do you know|don['’]t you know|could you (?:please )?(?:tell|say|let) me|can you (?:please )?(?:tell|say|let) me|would you (?:please )?(?:tell|say) me|i (?:wonder|was wondering|(?:'d| would) like to know|want to know|need to know|am curious|(?:'m| am) not sure|can['’]t remember|forgot)|any idea|tell me|let me know|do you remember|do you happen to know|i['’]m curious|curious (?:about|whether|if))\b[^?]*\b(?:who|whom|whose|what|when|where|why|how|whether|if|which)\b/i,
};
const WH = /^\W*(?:and |but |so |also |then |ok(?:ay)?,? |hey,? |please,? )*(?:who|whom|whose|what|which|where|whence|whither)\b/i;
const WH_ANY = /\b(?:who|whom|whose|what|which|where)\b/i;
const YN = new RegExp(String.raw`^\W*(?:(?:and|but|so|also|then|ok|okay|hey|well|please|quick question|just checking|out of curiosity)[,:]?\s+)*(?:${AUX})\b`, 'i');
const YN_TAG = /,\s*(?:right|isn['’]t (?:it|he|she)|doesn['’]t (?:it|he|she)|aren['’]t (?:they|you)|no|correct)\s*\?\s*$/i;

/** Forms of one question sentence. */
export function sentenceForms(sentence) {
  const s = sentence.replace(/^\W+/, m => m); // keep the punctuation for the anchors
  const forms = new Set();
  const lead = s.replace(/^(?:(?:and|but|so|also|then|ok|okay|hey|well|please|quick question|just checking|out of curiosity)[,:]?\s+)+/i, '');
  const isWh = WH.test(s) || /^(?:why|how|when)\b/i.test(lead) || (WH_ANY.test(s) && !YN.test(s));
  if (isWh) forms.add('wh');
  if ((YN.test(s) || YN_TAG.test(s) || (!isWh && !re.embedded.test(s))) && !/^(?:why|how|when|where|who|what|which|whose|whom)\b/i.test(lead)) forms.add('yes_no');
  for (const key of ['count', 'comparative', 'temporal', 'plan', 'abduce', 'what_if', 'conform', 'procedure', 'embedded']) if (re[key].test(s)) forms.add(key);
  if (re.why_not.test(s)) forms.add('why_not'); else if (re.why.test(s)) forms.add('why');
  // quantified: a quantifier word that is not part of a count or a plain "any" inside a negation-free wh question
  if (re.quantified.test(s) && !/^\W*(?:how many|how much)\b/i.test(lead)) {
    const strong = /\b(?:all|every|each|everyone|everybody|everything|no one|nobody|none|most|both|half|only)\b/i.test(s) || /\b(?:is|are|do|does|did|has|have|can|will|was|were)\s+(?:any|anyone|anybody|anything)\b/i.test(s) || /\bat least \d+|\bat most \d+/i.test(s);
    if (strong) forms.add('quantified');
  }
  if (new RegExp(NEG, 'i').test(s)) forms.add('negated');
  if (forms.has('plan')) forms.delete('wh');
  return forms;
}

/** Forms of a message: the union over its question sentences, plus `multi` when there are several. */
export function messageForms(message) {
  const questions = questionSentences(message);
  const forms = new Set();
  for (const q of questions) for (const f of sentenceForms(q)) forms.add(f);
  if (questions.length >= 2) forms.add('multi');
  if (forms.has('why_not')) forms.delete('why');
  if (forms.has('embedded')) { forms.delete('yes_no'); forms.delete('wh'); }
  return {questions, forms: FORMS.filter(f => forms.has(f))};
}

/** The one form that names a question in a one-row-per-question table (most specific first). */
const ORDER = ['multi', 'why_not', 'conform', 'procedure', 'plan', 'abduce', 'what_if', 'embedded', 'why', 'count', 'quantified', 'comparative', 'temporal', 'negated', 'wh', 'yes_no'];
export const primaryForm = forms => ORDER.find(f => forms.includes(f)) ?? null;
