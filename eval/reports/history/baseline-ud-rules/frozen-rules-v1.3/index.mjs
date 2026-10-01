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
import {parse} from '../../sop/parser.mjs';
import {checkModelProgram, compileDeclarative} from '../../sop/declarative.mjs';
import {Analysis, isGibberish} from './analyze.mjs';
import {emitProgram} from './emit.mjs';
import {MASKS} from './lexicon.mjs';
import {readLabels, maskLabels, applyLabels} from './labels.mjs';

export {Analysis, isGibberish} from './analyze.mjs';
export {emitProgram, emitWire} from './emit.mjs';

/** Replace greetings, lead-ins ("Fact-check:"), politeness and tag tails by spaces (offsets stay valid). */
export function maskMessage(message) {
  let text = maskLabels(String(message), readLabels(message));
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
const CLAIM = /(^|[.!?"”—–-]\s*)(is (this|that|it) (correct|true|right|accurate)|true or false|fact[- ]?c\w{0,3}k|does (that|this|it) hold|adev[ăa]rat sau fals|(e|este) (corect|adev[ăa]rat)( asta| acest lucru)?)\s*[?:]/i;
export function claimCheck(wires, message) {
  if (!CLAIM.test(message)) return wires;
  let n = wires.filter(w => w.type === 'query').length;
  const probe = wires.find(w => w.type === 'query' && w.blocks.length === 1 && (/^(be|fi) (correct|true|right|accurate|corect|adevarat|adevărat)$/.test(w.blocks[0].relation) || (w.blocks[0].relation === 'hold' && w.blocks[0].roles.some(r => /^(that|this|it)$/i.test(String(r.value))))));
  const out = [];
  for (const w of wires) {
    if (w === probe) continue;
    if (w.type === 'stated' && w.certainty === 'asserted' && !w.speaker) {
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
  // A message whose words were all masked (greetings, thanks, politeness) asks nothing (C12 no_request).
  const words = (parseResult.sentences ?? []).flatMap(s => s.words).filter(w => /\p{L}/u.test(w.text));
  if (!words.length && /\p{L}/u.test(String(message))) return finish(unclear('no_request'), message, notes, 'no_request');
  if (!String(message).trim() || isGibberish(parseResult)) return finish(unclear('gibberish'), message, notes, 'gibberish');
  const analysis = new Analysis(parseResult, message).run();
  // v1.3: a pronoun after two parallel clauses (DS021 convention): unclear ambiguous with one reading per candidate.
  if (analysis.ambiguous) return finish([{type: 'unclear', id: 'u', kind: 'ambiguous', readings: analysis.ambiguous.readings.map(name => `${analysis.ambiguous.pronoun} is ${name}`)}], message, analysis.notes, 'ambiguous');
  let wires = applyLabels(claimCheck(analysis.wires, message), labels, message, kind => analysis.id(kind));
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
