/**
 * UD → SOP converter of the symbolic formalizer baseline `baseline-ud-rules-v1` (Stanza parse + deterministic
 * rules). `convertParse(parse, message)` turns one Stanza worker parse (training/python/ud_parse_worker.py) into
 * SOP Lang model output and checks it with the repository parser and model-surface admission; nothing else is read:
 * no context, lexicon, entity list or clock (DS021 model boundary). Content words stay in the message's language as
 * lemmas (owner decision D1); values are verbatim spans; what the rules cannot place is an `unparsed` wire.
 *
 * Returns {sop, wires, notes, valid, error, repaired, stats}; `stats` counts wires, unparsed spans and the share of
 * message characters covered by formalized values.
 */
// The relative imports below are written for the scratch layout that loadRules (tools/research/ud-rules-v14.mjs) builds, with
// this folder copied to lib/ud-to-sop and sop/ symlinked beside it; they do not resolve from this folder itself.
import {parse} from '../../sop/parser.mjs';
import {checkModelProgram, compileDeclarative} from '../../sop/declarative.mjs';
import {Analysis, isGibberish} from './analyze.mjs';
import {emitProgram} from './emit.mjs';
import {MASKS} from './lexicon.mjs';
import {readLabels, maskLabels, applyLabels} from './labels.mjs';
import {numericConstraint} from './numeric.mjs';

export {Analysis, isGibberish} from './analyze.mjs';
export {emitProgram, emitWire} from './emit.mjs';

/** v1.4 (R10): "Going by what was known on T, …", "As of T, …" → `asof "T"` on the sentence's query. */
const ASOF = /(?:^|(?<=[.!?:]\s{0,3}))\s*(?:(?:going by|based on|judging by|according to) what was known (?:on|as of|in|at)|as of|potrivit a ceea ce se [șs]tia (?:la|pe|[îi]n)|din ce se [șs]tia (?:la|pe|[îi]n))\s+([^,?]{3,40}?(?:,\s*\d{4})?)\s*,/giu;
export function asofSpans(message) {
  return [...String(message).matchAll(ASOF)].map(m => ({start: m.index, end: m.index + m[0].length, time: m[1].trim()}));
}

/** Replace greetings, lead-ins ("Fact-check:"), politeness and tag tails by spaces (offsets stay valid). */
export function maskMessage(message) {
  let text = maskLabels(String(message), readLabels(message));
  for (const a of asofSpans(message)) text = text.slice(0, a.start) + text.slice(a.start, a.end).replace(/[^\n]/g, ' ') + text.slice(a.end);
  for (const pattern of MASKS) text = text.replace(pattern, match => match.replace(/[^?\n]/g, ' '));
  return text;
}

/** Parse + model-surface admission of an SOP text; returns null when admitted, else the first error line. */
export function admissionError(sop, message) {
  try {
    checkModelProgram(parse(sop));
    compileDeclarative(sop, {inputText: message});
    return null;
  } catch (error) {
    return String(error.message).split('\n')[0];
  }
}

/** "Is this correct? \"P\"", "True or false: P" (C6 claim check): the checked statements become yes/no queries. */
// v1.5: Romanian claim tails "— se confirmă?" and "— așa este?" (TODO.md "Symbolic formalizer v1.5"); previously
// unmatched, so the reflexive-impersonal tail was parsed as its own (unlinked) clause instead of a claim marker.
const CLAIM = /(^|[.!?"”—–-]\s*)(is (this|that|it) (correct|true|right|accurate)|true or false|f\p{L}{2,3}t[- ]?c\p{L}{0,4}k|does (that|this|it) hold|(?:check|verify|confirm) this|verific[ăa]|verifica asta|adev[ăa]rat sau fals|(e|este) (corect|adev[ăa]rat)( asta| acest lucru)?|se confirm[ăa]|(?:a[șs]a|asa) este)\s*[?:]/iu;
/** v1.4 (R1): the character range of the message whose statements a claim marker checks. */
export function claimScope(message) {
  const text = String(message);
  const match = CLAIM.exec(text);
  if (!match) return null;
  const at = match.index + match[1].length;
  // A lead-in ("Fact-check:", "True or false:") checks what follows it, up to a blank line.
  if (/^(true or false|f\p{L}{2,3}t|adev|check|verify|confirm|verific)/iu.test(match[2])) {
    const blank = text.slice(at).search(/\n\s*\n/);
    return [at, blank < 0 ? text.length : at + blank];
  }
  // A marker that opens the message ("Is this correct? \"P\"") checks what follows it.
  if (!text.slice(0, match.index + match[1].length).replace(/[^\p{L}\p{N}]+/gu, '')) return [match.index + match[0].length, text.length];
  // A tail ("— does that hold?", "is this correct?") checks the quoted span or the sentence right before it.
  const before = text.slice(0, at).replace(/[\s—–-]+$/, '');
  // v1.5: Romanian typographic quotes open with „ (U+201E), not the Western “ (U+201C); look for either.
  const quote = /["”]$/.test(before) ? Math.max(before.lastIndexOf('"', before.length - 2), before.lastIndexOf('“'), before.lastIndexOf('„')) : -1;
  if (quote >= 0) return [quote, at];
  const end = before.replace(/[.!?]+$/, '').length;
  const start = Math.max(...['.', '!', '?', '\n'].map(c => text.lastIndexOf(c, end - 1))) + 1;
  return [start, at];
}

/**
 * v1.5: true when a relation+roles pair is the claim-check marker's own words parsed as a (near-empty) clause,
 * rather than real content: "be/fi correct/true…", "hold" + that/this/it (English "does that hold"), the Romanian
 * reflexive-impersonal "se confirma" (from "se confirmă"), or a bare copula "fi" with nothing but an inherited
 * subject (from "așa este"). English already dropped the first two forms; the Romanian ones did not match that
 * pattern, so the marker built a second, unlinked wire (eval-ud-rules-v14-v1 lost rows fv1_011603_0_0 and siblings).
 */
function isClaimMarker(relation, roles) {
  return /^(be|fi) (correct|true|right|accurate|corect|adevarat|adevărat)$/.test(relation) ||
    (relation === 'hold' && roles.some(r => /^(that|this|it)$/i.test(String(r.value)))) ||
    /^se confirma?$/.test(relation) ||
    (relation === 'fi' && roles.length && roles.every(r => r.name === 'subject'));
}

export function claimCheck(wires, message) {
  if (!CLAIM.test(message)) return wires;
  const scope = claimScope(message);
  const inScope = w => !scope || w.pos === undefined || (w.pos >= scope[0] - 1 && w.pos < scope[1]);
  let n = wires.filter(w => w.type === 'query').length;
  const probe = wires.find(w => w.type === 'query' && w.blocks.length === 1 && isClaimMarker(w.blocks[0].relation, w.blocks[0].roles));
  const out = [];
  for (const w of wires) {
    if (w === probe) continue;
    if (w.type === 'stated' && isClaimMarker(w.relation, w.roles)) continue;
    if (w.type === 'stated' && w.certainty === 'asserted' && !w.speaker && inScope(w)) {
      out.push({type: 'query', id: w.id.replace(/^s/, 'qc'), mode: null, select: [], measure: null, blocks: [{relation: w.relation, roles: w.roles.filter(r => !String(r.value).startsWith('$')), polarity: w.polarity}], scope: null, during: w.valid?.on ?? null, at: null, compares: [], excepts: [], rank: null, order: null, links: []});
      n++;
      continue;
    }
    out.push(w);
  }
  const ids = new Set(out.map(w => w.id));
  return out.map(w => (w.links ? {...w, links: w.links.filter(([, t]) => ids.has(t) && ['stated', 'assumed'].includes(out.find(x => x.id === t)?.type))} : w)).map(w => (w.type === 'unparsed' && w.near && !ids.has(w.near) ? {...w, near: null} : w));
}

const unclear = kind => [{type: 'unclear', id: 'u', kind}];

/**
 * Convert one parse. `parse` = {text, language, sentences}; `message` is the ORIGINAL message (the parse may be of
 * the masked text, whose offsets are identical).
 */
export function convertParse(parseResult, message = parseResult.text) {
  const notes = [];
  const labels = readLabels(message);
  // Constraint and ambiguity lines of a simple text are read directly (DS022 "Simple-text rendering").
  const direct = applyLabels([], labels.filter(l => ['ambiguous', 'reading', 'number', 'possible', 'prove', 'condition'].includes(l.kind)), message, () => 'x');
  if (direct.length && labels.some(l => ['ambiguous', 'number'].includes(l.kind))) return finish(direct, message, notes, 'labelled');
  // v1.4 (R15): a numeric problem of a closed shape is a constraint in words (Q-LANG-7).
  const numeric = numericConstraint(message);
  if (numeric) return finish([numeric], message, notes, 'numeric');
  // A message whose words were all masked (greetings, thanks, politeness) asks nothing (C12 no_request).
  const words = (parseResult.sentences ?? []).flatMap(s => s.words).filter(w => /\p{L}/u.test(w.text));
  if (!words.length && /\p{L}/u.test(String(message))) return finish(unclear('no_request'), message, notes, 'no_request');
  if (!String(message).trim() || isGibberish(parseResult)) return finish(unclear('gibberish'), message, notes, 'gibberish');
  const analysis = new Analysis(parseResult, message).run();
  // v1.3: a pronoun after two parallel clauses (DS021 convention): unclear ambiguous with one reading per candidate.
  if (analysis.scopeAmbiguity) return finish([{type: 'unclear', id: 'u', kind: 'ambiguous', readings: analysis.scopeAmbiguity}], message, analysis.notes, 'ambiguous');
  if (analysis.ambiguous) return finish([{type: 'unclear', id: 'u', kind: 'ambiguous', readings: analysis.ambiguous.readings.map(name => `${analysis.ambiguous.pronoun} is ${name}`)}], message, analysis.notes, 'ambiguous');
  let wires = applyLabels(claimCheck(analysis.wires, message), labels, message, kind => analysis.id(kind));
  for (const a of asofSpans(message)) for (const w of wires) if (w.type === 'query' && !w.asof && (w.pos === undefined || w.pos >= a.start)) w.asof = a.time;
  notes.push(...analysis.notes);
  const content = wires.filter(w => w.type !== 'unparsed');
  if (!content.length) {
    if (analysis.smallTalk || analysis.actionRequests) return finish(unclear('no_request'), message, notes, 'no_request');
    if (!wires.length) return finish(unclear('no_request'), message, notes, 'nothing_formalized');
  }
  // Admission: on an error, drop links and references, then offending wires (their text becomes unparsed).
  let sop = emitProgram(wires);
  let error = admissionError(sop, message);
  let repaired = [];
  if (error) {
    repaired.push(error);
    wires = wires.map(w => ({...w, links: [], ...(w.roles ? {roles: w.roles.filter(r => !String(r.value).startsWith('$'))} : {}), ...(w.blocks ? {blocks: w.blocks.map(b => ({...b, roles: b.roles.filter(r => !String(r.value).startsWith('$'))}))} : {})}));
    sop = emitProgram(wires);
    error = admissionError(sop, message);
  }
  for (let round = 0; error && round < wires.length; round++) {
    repaired.push(error);
    const named = /@([A-Za-z][A-Za-z0-9_]*)/.exec(error)?.[1];
    const culprit = wires.find(w => w.id === named) ?? wires.find(w => admissionError(emitProgram([w]), message));
    if (!culprit) break;
    wires = wires.filter(w => w !== culprit).map(w => (w.type === 'unparsed' && w.near === culprit.id ? {...w, near: null} : w));
    notes.push('dropped @' + culprit.id + ': ' + error);
    if (!wires.some(w => w.type !== 'unparsed')) break;
    sop = emitProgram(wires);
    error = admissionError(sop, message);
  }
  if (!wires.length || error) return finish(unclear('no_request'), message, [...notes, 'no admissible wire'], 'fallback');
  return finish(wires, message, notes, 'converted', repaired);
}

function finish(wires, message, notes, outcome, repaired = []) {
  const sop = emitProgram(wires);
  const error = admissionError(sop, message);
  const unparsed = wires.filter(w => w.type === 'unparsed');
  const stats = {
    wires: wires.length,
    types: wires.reduce((acc, w) => ({...acc, [w.type]: (acc[w.type] ?? 0) + 1}), {}),
    unparsed: unparsed.length,
    unparsed_chars: unparsed.reduce((sum, w) => sum + w.span.length, 0),
    message_chars: String(message).replace(/\s+/g, '').length,
    links: wires.reduce((sum, w) => sum + (w.links?.length ?? 0), 0),
  };
  return {sop, wires, notes, outcome, valid: !error, error, repaired, stats};
}
