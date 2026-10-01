/**
 * The English answer of a query result packet, written from the packet by fixed templates (no model, DS014 "Answer rendering"):
 *   wh-question   the answer values with readable labels ("Answer: Paris."; several values as a list; a count with "at least" when incomplete),
 *   yes/no        "Yes." / "No." / "I don't know." with the reason,
 *   evidence      a short justification: each supporting fact as a sentence with its source, the rule that derived it, and an origin label
 *                 (stated in this conversation / assumed / definition / memory),
 *   incomplete    one line saying the search was not exhaustive.
 * The structured packet is never changed; `renderAnswer` returns null for a packet it does not cover (the caller keeps its generic lines).
 * Labels and relation phrases come from the lexicon when it is given (entity labels; the English lexemes of the predicate), otherwise
 * from the identifier ("computer_scientist" becomes "computer scientist"; entities are capitalized, classes are not).
 */
import {formatTime} from '../lib/time.mjs';

const CLASS_RELATIONS = new Set(['is_a', 'has_occupation', 'instance_of', 'subclass_of', 'type_of']);
const COVERED = new Set(['supported', 'refuted', 'both', 'unknown', 'incomplete', 'mixed_temporal']);
const SHOWN = 8, ROOTS = 4;
const CONNECTIVES = new Set(['of', 'the', 'and', 'de', 'la', 'von', 'van', 'in', 'on', 'for', 'del', 'da', 'di']);
const ident = value => typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value);
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether `renderAnswer` covers this packet. */
export function renderable(packet) {
  if (!packet || packet.status === 'clarify') return Boolean(packet?.text);
  const knowledge = Array.isArray(packet.rows) || packet.count !== undefined || packet.at_least !== undefined || packet.bound === 'at_least' || Array.isArray(packet.used);
  return Boolean(COVERED.has(packet.status) && (knowledge || packet.query && Array.isArray(packet.answers))
    && !['every', 'explain', 'constraint'].includes(packet.kind)
    && !['every', 'explain'].includes(packet.query?.mode)
    && !packet.patterns && !packet.mappings && !packet.explanations && !packet.plan && !packet.candidates && !packet.whatif && packet.objective === undefined);
}

function labeller(packet, lexicon) {
  const classes = new Set();
  for (const p of Array.isArray(packet.proof) ? packet.proof : []) if (CLASS_RELATIONS.has(p.atom?.p)) for (const t of p.atom.a.slice(1)) classes.add(t);
  return value => {
    if (typeof value === 'number') return String(value);
    if (typeof value !== 'string') return JSON.stringify(value);
    if (!ident(value)) return value;
    const known = lexicon?.entities?.[value]?.labels?.en;
    if (known) return known;
    // A conversation entity (`local_maria`, introduced by a user statement) is shown as the user wrote the name.
    const local = value.startsWith('local_');
    const words = value.replace(/^local_/, '').split('_').join(' ');
    if (local) return words.replace(/(^|\s)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
    return classes.has(value) || lexicon?.classes?.[value] ? words : words.replace(/(^|\s)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
  };
}

/** Present-tense forms of a relation phrase ("be the capital of" -> "is the capital of"; "live in" -> "lives in"; negated: "is not ...", "does not live in"). */
function conjugate(base, negative) {
  const [first, ...rest] = base.split(/\s+/);
  const tail = rest.join(' ');
  if (first === 'be') {
    const past = rest[0] === 'born';
    return `${past ? 'was' : 'is'}${negative ? ' not' : ''}${tail ? ' ' + tail : ''}`;
  }
  // A lexeme may be written as a participle ("located in") or in the third person ("works at"): both are recognised.
  if (/(?:ed|wn)$/.test(first) && first.length > 4) return `${negative ? 'is not' : 'is'} ${base}`;
  if (/[^s]s$/.test(first) && !['has', 'does', 'is'].includes(first)) return negative ? `does not ${first.replace(/ies$/, 'y').replace(/(?:sh|ch|x|z|o)es$/, m => m.slice(0, -2)).replace(/s$/, '')}${tail ? ' ' + tail : ''}` : base;
  if (negative) return `does not ${base}`;
  const third = first === 'have' ? 'has' : /(?:s|sh|ch|x|z|o)$/.test(first) ? first + 'es' : /[^aeiou]y$/.test(first) ? first.slice(0, -1) + 'ies' : first + 's';
  return `${third}${tail ? ' ' + tail : ''}`;
}

function phraseOf(predicate, lexicon) {
  const p = lexicon?.predicates?.[predicate];
  const lexemes = (p?.lexemes ?? []).filter(l => l.language === 'en' && !l.converse && l.pos !== 'noun');
  const lexeme = lexemes.find(l => l.pos === 'copula') ?? lexemes[0];
  if (lexeme?.forms?.[0]) return lexeme.forms[0];
  const label = p?.labels?.en ?? predicate.split('_').join(' ');
  // Without a lexeme the phrase is read from the identifier: a noun before a preposition ("capital of") takes "is the"; a participle ("born in") takes "is".
  const words = label.split(/\s+/);
  if (/^(?:of|in|at|to|by|from|on|for|with)$/.test(words.at(-1)) && words.length > 1 && !/(?:s|ed|wn|rn)$/.test(words[0])) return `be the ${label}`;
  if (/(?:ed|wn|rn)$/.test(words[0]) && words.length > 1) return `be ${label}`;
  return label;
}
const originOf = proof => {
  if (proof.origin === 'conversation') return proof.kind === 'assumption' || proof.kind === 'assumed' ? 'supposed in this conversation' : 'stated in this conversation';
  if (proof.origin === 'coding_agent') return proof.kind === 'assumption' || proof.kind === 'assumed' ? 'assumption by coding agent' : 'definition by coding agent';
  if (proof.origin === 'memory') return 'memory';
  if (proof.source === 'user' || /^user\b/.test(String(proof.source ?? ''))) return 'stated in this conversation';
  if (proof.kind === 'assumed' || proof.assumed) return 'assumed';
  if (/class hierarchy|definition|^core-/i.test(String(proof.source ?? ''))) return 'definition';
  return 'memory';
};

/** One fact as a sentence without the final stop: "Paris is the capital of France". */
function factText(atom, label, lexicon) {
  const [subject, ...others] = atom.a;
  const predicate = lexicon?.predicates?.[atom.p];
  if (!others.length && !(predicate?.lexemes ?? []).some(l => l.language === 'en' && !l.converse && l.pos !== 'noun')) {
    const name = predicate?.labels?.en ?? atom.p.split('_').join(' ');
    return `The "${name}" relation ${atom.neg ? 'does not hold' : 'holds'} for ${label(subject)}`;
  }
  const objects = others.map(label);
  let phrase = conjugate(phraseOf(atom.p, lexicon), Boolean(atom.neg));
  // An indefinite article closing the lexeme ("be a") agrees with the next word: "is an entity", "is a person".
  if (/ an?$/.test(phrase) && objects[0]) phrase = phrase.replace(/ an?$/, /^[aeiou]/i.test(objects[0]) ? ' an' : ' a');
  return [label(subject), phrase, ...objects].join(' ');
}

function justification(packet, shown, label, lexicon) {
  const proofs = packet.proof ?? [];
  const origins = new Map((packet.origins ?? []).map(o => [o.id, o]));
  if (!proofs.length) return [];
  const byId = new Map(proofs.map(p => [p.id, p]));
  const referenced = new Set(proofs.flatMap(p => p.from ?? []));
  const wanted = new Set(shown.map(String));
  let roots = proofs.filter(p => !referenced.has(p.id));
  if (wanted.size) {
    const matching = roots.filter(p => p.atom.a.some(t => wanted.has(String(t))));
    if (matching.length) roots = matching;
  }
  const during = Boolean(packet.query?.during);
  const when = p => (during && p.valid ? ` [valid ${formatTime(p.valid.from)} to ${p.valid.until == null ? 'now' : formatTime(p.valid.until)}]` : '');
  const sourced = p => {
    const tagged = origins.get(p.id) ?? origins.get(p.source?.id);
    const origin = tagged ? originOf(tagged) : originOf(p);
    return `${factText(p.atom, label, lexicon)} (${origin}${p.source && p.source !== 'user' && typeof p.source === 'string' ? ': ' + p.source : ''})${when(p)}`;
  };
  const lines = [];
  for (const root of roots.slice(0, ROOTS)) {
    if (root.kind === 'derived') {
      const parts = (root.from ?? []).map(id => byId.get(id)).filter(Boolean).map(sourced);
      const rule = String(root.rule ?? '').replace(/^r_/, '').split('_').join(' ');
      lines.push(`${capital(factText(root.atom, label, lexicon))}, because ${parts.length ? parts.join(' and ') : 'the supporting facts hold'}${rule ? `, by the rule "${rule}"` : ''}.`);
    } else lines.push(capital(sourced(root)) + '.');
  }
  if (roots.length > ROOTS) lines.push(`(${roots.length - ROOTS} more supporting facts not shown.)`);
  return lines;
}

/** Remove a class that another listed class already implies (the answers "person" and "entity" give only "person"). */
function mostSpecific(values, packet) {
  const names = new Set(values.filter(ident));
  const implied = new Set();
  const byId = new Map((packet.proof ?? []).map(p => [p.id, p]));
  for (const p of packet.proof ?? []) {
    if (p.kind !== 'derived' || !CLASS_RELATIONS.has(p.atom?.p) || !names.has(p.atom.a[1])) continue;
    for (const id of p.from ?? []) {
      const parent = byId.get(id);
      if (parent && CLASS_RELATIONS.has(parent.atom?.p) && parent.atom.a.length === 2 && names.has(parent.atom.a[0]) && parent.atom.a[1] === p.atom.a[1]) implied.add(p.atom.a[1]);
    }
  }
  return values.filter(v => !implied.has(v));
}

const list = items => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** Wire packets carry a sufficient support set, not the typed runtime's prose-ready fact proof. */
function wireSources(packet) {
  const byId = new Map((packet.origins ?? []).map(o => [o.id, o]));
  const nodes = packet.proof?.nodes ?? [];
  const byNode = new Map(nodes.map(n => [n.id, n]));
  const bySource = new Map(nodes.filter(n => n.source?.id).map(n => [n.source.id, n]));
  const evidence = [];
  if (!Array.isArray(packet.used)) {
    const visited = new Set();
    const visit = id => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = byNode.get(id);
      if (!node) return;
      if (node.source?.id) evidence.push(node.source);
      for (const premise of node.premises ?? []) visit(premise);
    };
    for (const root of packet.proof?.roots ?? []) visit(root);
  }
  const steps = Array.isArray(packet.used) ? packet.used : evidence;
  const seen = new Set();
  const labels = [];
  for (const step of steps) {
    const id = step?.id;
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const entry = byId.get(id) ?? bySource.get(id) ?? {};
    const origin = originOf(entry);
    labels.push(`${origin} (${id})`);
  }
  return labels.length ? [`Sources used: ${list(labels)}.`] : [];
}

function wireAnswer(packet, label, lexicon) {
  const lines = [];
  const mode = packet.kind === 'count' || packet.query?.mode === 'count' || packet.count !== undefined || packet.at_least !== undefined || packet.bound === 'at_least'
    ? 'count' : packet.query?.mode ?? (Array.isArray(packet.rows) ? 'select' : 'exists');
  const incomplete = packet.complete === false || packet.status === 'incomplete';
  const supported = packet.status === 'supported' || packet.status === 'both';
  if (mode === 'count') {
    const lower = packet.at_least ?? packet.count;
    if (packet.at_least !== undefined || packet.bound === 'at_least' || incomplete) {
      if (lower !== undefined) lines.push(`At least ${lower}; the exact number cannot be given ${incomplete ? 'because the search was not exhaustive' : 'because the predicate is not closed'}.`);
      else lines.push("I don't know the number: the search was not exhaustive.");
    } else if (packet.status === 'unknown') lines.push("The available information does not decide the count, so I don't know.");
    else if (packet.count !== undefined) lines.push(`${packet.count}.`);
    else lines.push("The available information does not decide the count, so I don't know.");
  } else if (mode === 'select') {
    const rows = packet.rows ?? (packet.answers ?? []).map(a => a.binding).filter(Boolean);
    const seen = new Set();
    const items = rows.map(row => Object.values(row).map(label).join(' / ')).filter(text => text && !seen.has(text) && seen.add(text));
    const shown = items.slice(0, SHOWN);
    if (items.length) lines.push(`${items.length === 1 ? 'Answer' : 'Answers'}: ${items.length > SHOWN ? `${shown.join(', ')} and ${items.length - SHOWN} more` : list(shown)}.`);
    else if (incomplete) lines.push("I don't know: the search stopped before it found an answer, so this is not a \"no\".");
    else if (packet.status === 'unknown') lines.push("The available information does not decide the question, so I don't know.");
    else lines.push('No matching answers were established.');
    if (packet.status === 'both' && items.length) lines.push('Some answers have conflicting evidence.');
    if (incomplete && items.length) lines.push('The search was not exhaustive, so more answers may exist.');
  } else {
    if (packet.status === 'unknown') lines.push("The available information does not decide the question, so I don't know.");
    else if (packet.status === 'incomplete') lines.push("I don't know: the search stopped before it found an answer, so this is not a \"no\".");
    else if (packet.status === 'refuted') lines.push('No.');
    else if (packet.status === 'both') lines.push('Both: the claim and its explicit negation each have supporting evidence.');
    else if (packet.status === 'mixed_temporal') lines.push('It depends on the time: the claim and its negation hold in different intervals.');
    else lines.push('Yes.');
    if (incomplete && supported) lines.push('The search was not exhaustive.');
  }
  if (supported || packet.status === 'refuted') {
    if (Array.isArray(packet.proof)) lines.push(...justification(packet, [], label, lexicon));
    lines.push(...wireSources(packet));
  }
  return lines.join('\n');
}

/** The natural English answer for a covered packet, or null. `options.lexicon`: entity labels and relation phrases. */
export function renderAnswer(packet, {lexicon = null} = {}) {
  if (!renderable(packet)) return null;
  if (packet.status === 'clarify') return packet.text;
  const label = labeller(packet, lexicon);
  if (Array.isArray(packet.rows) || packet.count !== undefined || packet.at_least !== undefined || packet.bound === 'at_least' || (Array.isArray(packet.used) && !Array.isArray(packet.answers))) return wireAnswer(packet, label, lexicon);
  const lines = [];
  const incomplete = packet.complete === false;
  if (packet.hypothetical) lines.push('This result depends on the stated assumptions.');
  if (packet.kind === 'count') {
    if (packet.at_least !== undefined || (incomplete && packet.count !== undefined)) lines.push(`At least ${packet.at_least ?? packet.count}; the exact number cannot be given because the search was not exhaustive.`);
    else if (packet.count !== undefined && packet.status === 'supported') lines.push(`${packet.count}.`);
    else lines.push("The available information does not decide the count, so I don't know.");
    if (packet.origins && packet.used) lines.push(...wireSources(packet));
    return lines.join('\n');
  }
  const rows = packet.answers.filter(r => r && r.binding);
  const valued = rows.filter(r => Object.keys(r.binding).length);
  const supported = packet.status === 'supported' || packet.status === 'both' || packet.status === 'mixed_temporal';
  if (!valued.length) {
    if (packet.query?.select?.length && !rows.some(r => Object.keys(r.binding).length === 0)) {
      if (incomplete || packet.status === 'incomplete') lines.push("I don't know: the search stopped before it found an answer, so this is not a \"no\".");
      else if (packet.status === 'unknown') lines.push("The available information does not decide the question, so I don't know.");
      else lines.push('No matching answers were established.');
      return lines.join('\n');
    }
    if (packet.status === 'unknown') lines.push("The available information does not decide the question, so I don't know.");
    else if (packet.status === 'incomplete') lines.push("I don't know: the search stopped before it found an answer, so this is not a \"no\".");
    else if (packet.status === 'refuted') lines.push('No.');
    else if (packet.status === 'both') lines.push('Both: the claim and its explicit negation each have supporting evidence.');
    else if (packet.status === 'mixed_temporal') lines.push('It depends on the time: the claim and its negation hold in different intervals.');
    else lines.push('Yes.');
    if (supported || packet.status === 'refuted') lines.push(...justification(packet, [], label, lexicon));
    if ((supported || packet.status === 'refuted') && packet.origins && Array.isArray(packet.used)) lines.push(...wireSources(packet));
    if (incomplete && packet.status !== 'incomplete' && packet.status !== 'unknown' && packet.status !== 'refuted' && !supported) lines.push('The search was not exhaustive.');
    return lines.join('\n');
  }
  const single = valued.every(r => Object.keys(r.binding).length === 1);
  let items = valued.map(r => ({raw: single ? Object.values(r.binding)[0] : null, text: Object.values(r.binding).map(label).join(' / ')}));
  if (single) {
    const kept = new Set(mostSpecific(items.map(i => i.raw), packet));
    items = items.filter(i => kept.has(i.raw));
  }
  const seen = new Set();
  items = items.filter(i => !seen.has(i.text) && seen.add(i.text));
  // A value that is not an identifier (a description from the memory) is quoted as a description, not listed as a name.
  const isFree = i => typeof i.raw === 'string' && !ident(i.raw) && (/[()]/.test(i.raw) || i.raw.split(/\s+/).length >= 4 || i.raw.split(/\s+/).some(w => /^\p{Ll}/u.test(w) && !CONNECTIVES.has(w)));
  const free = items.filter(isFree).map(i => i.text);
  const names = items.filter(i => !isFree(i)).map(i => i.text);
  const shown = names.slice(0, SHOWN);
  if (names.length) lines.push(`${names.length === 1 ? 'Answer' : 'Answers'}: ${names.length > SHOWN ? `${shown.join(', ')} and ${names.length - SHOWN} more` : list(shown)}.`);
  for (const text of free.slice(0, 2)) lines.push(`Described as: ${text}`);
  if (packet.status === 'refuted') lines.push('These are explicitly contradicted by the evidence.');
  const values = items.filter(i => i.raw !== null).map(i => i.raw);
  lines.push(...justification(packet, values.length ? values : valued.flatMap(r => Object.values(r.binding)), label, lexicon));
  if (packet.origins && Array.isArray(packet.used)) lines.push(...wireSources(packet));
  if (incomplete) lines.push('The search was not exhaustive, so more answers may exist.');
  return lines.join('\n');
}
