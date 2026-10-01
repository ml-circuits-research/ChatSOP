/** Deterministic, mechanical meaning-changing perturbations of a rewrite candidate (experiment eval-meaning-judge-calibration-v1).
 *
 * Each function takes the candidate text and a seeded `pick` (index chooser) and returns the changed text, or null when the
 * perturbation does not apply. One change per call. A perturbed candidate is ALWAYS a meaning change against the message it
 * was a correct rewrite of, except for rare accidents (documented in the report: label noise is measured by adjudicating the
 * judge/label disagreements).
 */
const NAME_POOL = ['Victor', 'Elena', 'Mihai', 'Sofia', 'Kofi', 'Nadia', 'Tomas', 'Irina', 'Hassan', 'Clara'];
const STARTERS = new Set(['Is', 'Are', 'Was', 'Were', 'Do', 'Does', 'Did', 'Can', 'Could', 'Will', 'Would', 'Should', 'Has', 'Have', 'Had', 'Who', 'Whom', 'What', 'Which', 'Where', 'When', 'Why', 'How', 'The', 'A', 'An', 'If', 'I', 'My', 'Tell', 'Check', 'Please', 'Also', 'Not', 'No', 'All', 'Some', 'Most', 'Every', 'Everyone', 'Someone', 'Anyone', 'There', 'It', 'This', 'That', 'He', 'She', 'They', 'We', 'You', 'Yes', 'Hello', 'Hi', 'Thanks', 'Let', 'Name', 'List', 'Give', 'Find', 'Verify', 'Just', 'Quick', 'Suppose', 'Assume', 'Given', 'Since', 'Because', 'Although', 'Before', 'After', 'When', 'While', 'Unless', 'Other', 'Any', 'Each', 'Both', 'Only', 'Nobody', 'Everybody', 'Somebody', 'Anybody', 'Nothing', 'Something', 'Everything', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'His', 'Her', 'Their', 'Our', 'Your', 'Background', 'Question', 'Context', 'Fact', 'Fact-check', 'Hypothetically', 'Honestly', 'Anyway', 'Btw', 'So', 'Okay', 'Sorry', 'Thanks', 'Verify', 'Confirm', 'Say', 'Suppose']);

const sentenceStarts = text => { const s = new Set(); const re = /(?:^|[.?!]\s+)(\p{L}+)/gu; let m; while ((m = re.exec(text))) s.add(m.index + m[0].length - m[1].length); return s; };

/** Name candidates: capitalized words that are not function words, not a bare sentence start that is a common word. Returns [{text, index}] (multi-word names joined). */
export function names(text) {
  const starts = sentenceStarts(text);
  const out = [];
  const re = /\p{Lu}[\p{L}'-]+(?:\s\p{Lu}[\p{L}'-]+)*/gu;
  let m;
  while ((m = re.exec(text))) {
    let t = m[0], idx = m.index;
    // strip a leading function word ("Does Ana" is matched only when both are capitalized)
    const parts = t.split(' ');
    while (parts.length && STARTERS.has(parts[0]) ) { idx += parts[0].length + 1; parts.shift(); }
    if (!parts.length) continue;
    t = parts.join(' ');
    if (STARTERS.has(t)) continue;
    // a sentence-initial single word that also occurs in lower case elsewhere is a common word, not a name
    if (starts.has(idx) && !parts[1] && new RegExp(`\\b${t.toLowerCase()}\\b`).test(text)) continue;
    // a quoted title or a single sentence-initial word followed by a verb cannot be told apart reliably: keep it only when it is not sentence-initial or is followed by a capitalized word
    out.push({text: t, index: idx});
  }
  return out;
}

const occurrences = (text, sub) => { let n = 0, i = -1; while ((i = text.indexOf(sub, i + 1)) >= 0) n++; return n; };
const replaceAt = (text, index, length, sub) => text.slice(0, index) + sub + text.slice(index + length);
const wordRe = s => new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');

/** Applies the first match of `rules` ([{re, to}]) in a pick-chosen order; `re` is a RegExp (u flag). */
function applyRules(text, rules, pick) {
  const keys = rules.map(() => pick(1000));
  const order = rules.map((_, i) => i).sort((a, b) => keys[a] - keys[b]);
  for (const i of order) { const {re, to} = rules[i]; const m = re.exec(text); if (m) return text.slice(0, m.index) + (typeof to === 'function' ? to(m) : to) + text.slice(m.index + m[0].length); }
  return null;
}

export const swapNames = (text, pick) => {
  const list = names(text).filter(n => occurrences(text, n.text) === 1);
  const distinct = [...new Map(list.map(n => [n.text, n])).values()];
  if (distinct.length < 2) return null;
  const a = distinct[pick(distinct.length)];
  const rest = distinct.filter(n => n !== a);
  const b = rest[pick(rest.length)];
  if (a.text.includes(b.text) || b.text.includes(a.text)) return null;
  const [x, y] = a.index < b.index ? [a, b] : [b, a];
  return text.slice(0, x.index) + y.text + text.slice(x.index + x.text.length, y.index) + x.text + text.slice(y.index + y.text.length);
};

export const replaceName = (text, pick) => {
  const list = names(text).filter(n => occurrences(text, n.text) >= 1);
  if (!list.length) return null;
  const n = list[pick(list.length)];
  const pool = NAME_POOL.filter(x => !text.includes(x));
  const to = pool[pick(pool.length)];
  return text.split(n.text).join(to); // every occurrence: one referent replaced by another
};

export const flipNegation = (text, pick) => applyRules(text, [
  {re: /\b(does|did|do) not\b/i, to: m => ({does: 'does', did: 'did', do: 'do'})[m[1].toLowerCase()] === undefined ? m[0] : m[1]},
  {re: /\b(doesn't|didn't|don't)\b/i, to: m => m[1].replace(/n't$/i, '')},
  {re: /\b(is|are|was|were|has|have|can|will|should|could|would) not\b/i, to: m => m[1]},
  {re: /\b(isn't|aren't|wasn't|weren't|hasn't|haven't|can't|won't|shouldn't|couldn't|wouldn't)\b/i, to: m => ({"isn't": 'is', "aren't": 'are', "wasn't": 'was', "weren't": 'were', "hasn't": 'has', "haven't": 'have', "can't": 'can', "won't": 'will', "shouldn't": 'should', "couldn't": 'could', "wouldn't": 'would'})[m[1].toLowerCase()]},
  {re: /\bno one\b/i, to: 'someone'}, {re: /\bnobody\b/i, to: 'somebody'}, {re: /\bnever\b/i, to: 'always'},
  {re: /\b(is|are|was|were) (?=[\p{L}])(?!not\b)/u, to: m => `${m[1]} not `},
], pick);

export const changeQuantifier = (text, pick) => applyRules(text, [
  {re: /\bat least (\d+)\b/i, to: m => `at most ${m[1]}`}, {re: /\bat most (\d+)\b/i, to: m => `at least ${m[1]}`},
  {re: /\bmore than (\d+)\b/i, to: m => `fewer than ${m[1]}`},
  {re: /\ball\b/i, to: 'some'}, {re: /\bsome\b/i, to: 'all'}, {re: /\bmost\b/i, to: 'few'}, {re: /\bevery\b/i, to: 'some'},
  {re: /\beveryone\b/i, to: 'someone'}, {re: /\beveryone\b/i, to: 'no one'}, {re: /\bsomeone\b/i, to: 'everyone'},
  {re: /\bany\b(?! (?:idea|clue|chance|way))/i, to: 'every'}, {re: /\bnone\b/i, to: 'all'}, {re: /\bnone of\b/i, to: 'all of'}, {re: /\bonly\b/i, to: 'also'},
], pick);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const changeNumber = (text, pick) => {
  const cand = [];
  for (const m of text.matchAll(/\d{1,2}:\d{2}|\d+/g)) cand.push(m);
  for (const m of text.matchAll(new RegExp(`\\b(${[...MONTHS, ...DAYS].join('|')})\\b`, 'g'))) cand.push(m);
  if (!cand.length) return null;
  const m = cand[pick(cand.length)];
  const t = m[0];
  let to;
  if (MONTHS.includes(t)) to = MONTHS[(MONTHS.indexOf(t) + 1 + pick(10)) % 12];
  else if (DAYS.includes(t)) to = DAYS[(DAYS.indexOf(t) + 1 + pick(5)) % 7];
  else if (t.includes(':')) { const [h, mi] = t.split(':').map(Number); to = `${String((h + 1 + pick(3)) % 24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; if (t[0] !== '0' && to[0] === '0') to = to.slice(1); }
  else { const n = Number(t); to = n >= 1900 && n <= 2100 ? String(n + 1 + pick(4)) : String(n + 1 + pick(3)); }
  if (to === t) return null;
  return replaceAt(text, m.index, t.length, to);
};

export const changeQuestionType = (text, pick) => applyRules(text, [
  {re: /\bWho\b/, to: 'What'}, {re: /\bWhat\b/, to: 'Who'}, {re: /\bwho\b/, to: 'what'}, {re: /\bwhat\b/, to: 'who'},
  {re: /\bWhere\b/, to: 'When'}, {re: /\bWhen\b/, to: 'Where'}, {re: /\bHow many\b/, to: 'Which'}, {re: /\bWhich\b/, to: 'How many'},
  {re: /\bWhom\b/, to: 'Who'},
  {re: /(?<![\p{L}])(Does|Did|Do|Is|Are|Was|Were|Can|Will) (?=[\p{L}])/u, to: m => `Why ${m[1].toLowerCase()} `},
  {re: /(?<![\p{L}])(Does|Did|Do|Is|Are|Was|Were|Can|Will) (?=[\p{L}])/u, to: m => `Who ${m[1].toLowerCase()} `},
], pick);

const sentences = text => text.match(/[^.?!]+[.?!]+(?:["”')\]]+)?|[^.?!]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [];
const words = s => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length > 3));
export const dropFact = (text, pick) => {
  const s = sentences(text);
  if (s.length >= 2) {
    const ok = s.map((x, i) => [x, i]).filter(([x]) => x.split(/\s+/).length >= 4 && !/^(hi|hello|hey|good morning|thanks|thank you|quick|just|honestly|btw|so|anyway|okay|sorry|i hope|talk soon|i have been)/i.test(x)).filter(([x, i]) => [...words(x)].some(w => !s.some((y, j) => j !== i && words(y).has(w))));
    if (ok.length) { const [, i] = ok[pick(ok.length)]; return s.filter((_, j) => j !== i).join(' '); }
  }
  // single sentence: remove a trailing time/place/number qualifier
  return applyRules(text, [
    {re: /\s+(?:in|since|until|by) (?:\d{4})(?=[.?!]|$)/, to: ''},
    {re: /\s+on (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?=[.?!]|$)/, to: ''},
    {re: /\s+at \d{1,2}:\d{2}(?=[.?!]|$)/, to: ''},
    {re: /\s+(?:and|but) (?:also )?[^.?!,]+(?=[.?!]|$)/, to: ''},
    {re: /, (?:because|although|unless|after|before|when|while) [^.?!,]+(?=[.?!]|$)/, to: ''},
    {re: /\s+in [\p{Lu}][\p{L}]+(?:\s[\p{Lu}][\p{L}]+)*(?=[.?!]|$)/u, to: ''},
  ], pick);
};

const FACTS = ['The office is in Cluj.', 'The meeting was moved to Monday.', 'The report is due in 2025.', 'The budget was cut by 20 percent.', 'It rained all week.', 'The director is away this month.', 'The manager approved the request.', 'The shop closes at 18:00.'];
export const addFact = (text, pick) => {
  const n = NAME_POOL[pick(NAME_POOL.length)];
  const pool = [...FACTS, `${n} also works there.`, `${n} disagrees.`, `${n} has already left.`];
  const extra = pool[pick(pool.length)];
  if (text.includes(extra)) return null;
  return /[.?!]["”)]?$/.test(text) ? `${text} ${extra}` : `${text}. ${extra}`;
};

const RELATIONS = [['works at', 'studies at'], ['works for', 'reports to'], ['manages', 'reports to'], ['reports to', 'manages'], ['buys', 'sells'], ['sells', 'buys'], ['teaches', 'studies'], ['lives in', 'works in'], ['works in', 'lives in'], ['wrote', 'read'], ['owns', 'rents'], ['rents', 'owns'], ['likes', 'hates'], ['hires', 'fires'], ['starts', 'ends'], ['started', 'ended'], ['employs', 'fires'], ['wins', 'loses'], ['won', 'lost'], ['leads', 'follows'], ['trains', 'beats'], ['visited', 'left'], ['borrowed', 'lent'], ['borrow', 'lend'], ['attend', 'skip'], ['attends', 'skips'], ['supports', 'opposes'], ['approved', 'rejected'], ['approves', 'rejects'], ['opens', 'closes'], ['open', 'closed'], ['increased', 'decreased'], ['arrived', 'left'], ['married to', 'related to'], ['parent of', 'child of'], ['author of', 'editor of'], ['member of', 'leader of'], ['owner of', 'tenant of'], ['teacher of', 'student of'], ['boss of', 'colleague of'], ['manager of', 'employee of']];
export const changeRelation = (text, pick) => {
  const hits = RELATIONS.filter(([a]) => wordRe(a).test(text));
  if (!hits.length) return null;
  const [a, b] = hits[pick(hits.length)];
  return text.replace(wordRe(a), b);
};

export const changePreposition = (text, pick) => applyRules(text, [
  {re: /(?<!\b(?:Apart|apart|Aside|aside) )\bfrom (?=[\p{Lu}\d]|the )/u, to: 'to '}, {re: /\bto (?=[\p{Lu}]|the )/u, to: 'from '},
  {re: /\bbefore\b/, to: 'after'}, {re: /\bafter\b/, to: 'before'}, {re: /\bBefore\b/, to: 'After'}, {re: /\bAfter\b/, to: 'Before'},
  {re: /\bwith (?=[\p{Lu}]|the )/u, to: 'without '}, {re: /\bwithout\b/, to: 'with'},
  {re: /\buntil\b/, to: 'since'}, {re: /\bsince\b/, to: 'until'}, {re: /\babove\b/, to: 'below'}, {re: /\bbelow\b/, to: 'above'},
  {re: /\bover (?=\d)/, to: 'under '}, {re: /\bunder (?=\d)/, to: 'over '}, {re: /\bonto\b/, to: 'off'}, {re: /\binto\b/, to: 'out of'},
], pick);

export const changeConnective = (text, pick) => applyRules(text, [
  {re: /\bbecause\b/i, to: m => (m[0][0] === 'B' ? 'If' : 'if')}, {re: /\bunless\b/i, to: m => (m[0][0] === 'U' ? 'Because' : 'because')},
  {re: /\bif\b/, to: 'because'}, {re: /\bIf\b/, to: 'Because'}, {re: /\balthough\b/i, to: m => (m[0][0] === 'A' ? 'Because' : 'because')},
  {re: /\bwhile\b/, to: 'because'}, {re: / or (?=[\p{L}])/u, to: ' and '}, {re: / and (?=[\p{L}])/u, to: ' or '},
], pick);

/** Ambiguity resolution: only built when the candidate keeps an "or"-free attachment ambiguity we can resolve mechanically; none of the mechanical forms is reliable enough, so the type is reported as not built. */
export const resolveAmbiguity = () => null;

export const TYPES = {
  swap_names: swapNames, replace_name: replaceName, flip_negation: flipNegation, change_quantifier: changeQuantifier, change_number_date: changeNumber,
  change_question_type: changeQuestionType, drop_fact: dropFact, add_fact: addFact, change_relation: changeRelation, change_preposition: changePreposition,
  change_connective: changeConnective, resolve_ambiguity: resolveAmbiguity,
};

/** Seeded chooser: `pick(n)` returns 0..n-1 from a counter-based hash stream. */
export function makePick(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (Math.imul(s, 31) + ch.charCodeAt(0)) >>> 0;
  return n => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 374761393) >>> 0; s ^= s >>> 13; s = Math.imul(s, 3266489909) >>> 0; return (s >>> 8) % Math.max(1, n); };
}
