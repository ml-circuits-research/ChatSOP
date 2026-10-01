/**
 * v1.4 (R15, DS021 Q-LANG-7): numeric problems in words, read from the message text by a closed set of patterns
 * (English and Romanian function words and comparators only; the numbers are copied from the message):
 *
 *   range + bound question   "The course runs with 2 to 10 students. Is it possible to have fewer than 5?"
 *                            → var ?x int 2 10, claim ?x below 5, task possible
 *   capacity + minimum       "We have room for 38 and a minimum of 9 registrations. Must there be more than 6?"
 *                            → var ?x int 0 38, require ?x at_least 9, claim ?x above 6, task prove
 *   percentage               "What is 25% of 4400 lei?" → require ?x equal 4400 times 25 (hundredths), select ?x
 *   division                 "The bill is 1000 lei and we are 4. How much does each pay?" → ?share … divided_by 4
 *
 * `numericConstraint(message)` returns a constraint wire or null; anything else stays with the clause rules.
 */
const fold = text => String(text ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ');
const N = '(\\d{1,7})';
const RANGE = [new RegExp(`(?:between|intre|in\\w{2,3})\\s+${N}\\s+(?:and|si)\\s+${N}`), new RegExp(`${N}\\s*(?:to|-|–|pana la)\\s*${N}`)];
const UPPER = new RegExp(`(?:at\\s+m[oa]\\w{0,2}[sz]t|no more than|maximum(?: of)?|max\\.?|cel mult|maximum|room for|loc pentru|up to|pana la)\\s+${N}`);
const LOWER = new RegExp(`(?:at\\s+l\\w{1,2}[as]t|minimum(?: of)?|min\\.?|cel putin|minim(?:um)?(?: de)?|no fewer than)\\s+${N}`);
const ASK = [
  ['below', new RegExp(`(?:fewer than|less than|under|below|mai putin de|mai putini de|sub)\\s+${N}`)],
  ['above', new RegExp(`(?:more than|over|above|peste|mai mult de|mai multi de|mai multe de)\\s+${N}`)],
  ['at_least', new RegExp(`(?:at least|cel putin)\\s+${N}`)],
  ['at_most', new RegExp(`(?:at most|cel mult)\\s+${N}`)],
  ['equal', new RegExp(`(?:exactly|exact|seat|be|fim|fi|avem|have|host|take)\\s+${N}\\b(?!\\s*%)`)],
  // A verb with a bare number ("Pot sta 7 la o masă?", "E posibil să vină 4?") asks for exactly that many.
  ['equal', new RegExp(`\\b[a-z]{2,}\\s+${N}\\b(?!\\s*(?:%|percent|la suta))`)],
];
const POSSIBLE = /\b(is it possible|could|can|possible|putem|pot|poate|se poate|e posibil|este posibil|ar putea|may)\b/;
const PROVE = /\b(must|guarantee|necessarily|always|does that mean|trebuie|garanteaza|neaparat|sigur|obligatoriu)\b/;
/** A universal question without a modal ("Are orice cutie peste 5?") asks whether it always holds. */
const EVERY = /\b(every|any|each|orice|fiecare|o\w{1,2}ice)\b/;

function questionPart(text) {
  const parts = text.split(/(?<=[.!?])\s+/);
  return {question: [...parts].reverse().find(p => p.includes('?')) ?? parts.at(-1)};
}

export function numericConstraint(message) {
  const text = fold(message);
  // Percentage: "what is 25% of 4400", "cat inseamna 9% din 3600".
  const pct = new RegExp(`${N}\\s*(?:%|percent|per cent|la suta|procente)\\s*(?:of|din)\\s*(?:the\\s+)?${N}`).exec(text);
  if (pct && /\?/.test(text)) {
    const [p, m] = [Number(pct[1]), Number(pct[2])];
    return {type: 'constraint', id: 'c', vars: [['?x', 0, m * 100]], requires: [`?x equal ${m} times ${p}`], claim: '?x at_least 0', task: 'possible', select: '?x'};
  }
  // Division: a total and a number of people, "each".
  const total = new RegExp(`${N}\\s*(?:de\\s+)?(?:lei|ron|euro|eur|€|\\$|usd|pounds|gbp)`).exec(text);
  const people = new RegExp(`(?:we are|there are|suntem|sunt|split (?:between|among)|between|intre|impartit la)\\s+${N}`).exec(text);
  if (total && people && /\b(each|fiecare|per person|de fiecare|de cap)\b/.test(text) && /\?/.test(text)) {
    const t = Number(total[1]), n = Number(people[1]);
    if (n > 0) return {type: 'constraint', id: 'c', vars: [['?share', 0, t]], requires: [`?share equal ${t} divided_by ${n}`, `?share at_most ${t}`], claim: '?share at_least 0', task: 'possible', select: '?share'};
  }
  const {question} = questionPart(text);
  if (!/\?/.test(question)) return null;
  let asked = null, context = '';
  for (const [op, re] of ASK) { const m = re.exec(question); if (m) { asked = [op, Number(m[1])]; context = text.slice(0, text.lastIndexOf(question) + m.index); break; } }
  if (!asked) return null;
  let lo = null, hi = null;
  const requires = [];
  for (const re of RANGE) { const m = re.exec(context); if (m) { lo = Number(m[1]); hi = Number(m[2]); break; } }
  if (lo === null) {
    const up = UPPER.exec(context), low = LOWER.exec(context);
    if (!up) return null;
    lo = 0; hi = Number(up[1]);
    if (low) requires.push(`?x at_least ${Number(low[1])}`);
  } else {
    const low = LOWER.exec(context);
    if (low && Number(low[1]) > lo) requires.push(`?x at_least ${Number(low[1])}`);
  }
  if (!(hi >= lo)) return null;
  const task = PROVE.test(question) ? 'prove' : POSSIBLE.test(question) ? 'possible' : EVERY.test(question) ? 'prove' : null;
  if (!task) return null;
  return {type: 'constraint', id: 'c', vars: [['?x', lo, hi]], requires, claim: `?x ${asked[0]} ${asked[1]}`, task};
}
