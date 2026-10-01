/**
 * Symbolic simplifications of the fallback cascade (DS012 "Graded severity", DS014 "Never NONE"): cheap, deterministic rewrites of a message that
 * SymbolicLM could not interpret. Each returns candidate texts; none invents content: they only drop a known lead-in or a trailing tag, cut a
 * coordinated question at its second auxiliary, or keep a subset of the sentences. The caller checks every candidate (certified, no catastrophic flag).
 */
const LEAD = /^\s*(?:honestly|quick (?:one|question|won)|hi|hello|hey|okay so|ok so|okay|well|so|sorry(?: in advance)?[^.!?:]*|here['’]s what i know|background|question|out of curiosity|just checking|by the way|btw|anyway|please|hmm|um)\s*[:,.!—-]+\s*/i;
const LEAD_SO = /^\s*(?:okay so|ok so|so)\s+/i;
const TAIL = /\s*,?\s*(?:right|correct|ok|okay|yes|isn['’]t it|any idea|do you know|please)\s*\?\s*$/i;
const SPLIT = /\s*,?\s+(?:and|but|or)\s+(?=(?:does|do|did|is|are|was|were|can|could|will|would|has|have|should|who|what|where|when|why|how)\b)/i;

export function stripLeadIns(text) {
  let t = String(text), prev;
  do { prev = t; t = t.replace(LEAD, '').replace(LEAD_SO, ''); } while (t !== prev && t.trim());
  t = t.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
export const stripTag = text => String(text).replace(TAIL, '?').trim();
export function splitCoordinated(text) {
  const t = String(text), m = SPLIT.exec(t);
  if (!m) return null;
  const first = t.slice(0, m.index).replace(/[,\s]+$/, ''), second = t.slice(m.index + m[0].length).replace(/^\s+/, '');
  const q = /\?\s*$/.test(t);
  return `${first}${q ? '?' : '.'} ${second[0].toUpperCase()}${second.slice(1)}`;
}

/** Candidate rewrites of a whole message (unit texts joined by a space): lead-ins, tags and coordination handled per unit. */
export function simplifications(message, units) {
  const out = new Map();
  const add = (label, text) => { const t = String(text).replace(/\s+/g, ' ').trim(); if (t && t !== String(message).replace(/\s+/g, ' ').trim() && !out.has(t)) out.set(t, label); };
  const list = units?.length ? units : [message];
  add('drop_lead_ins', list.map(stripLeadIns).join(' '));
  add('drop_lead_ins_and_tags', list.map(u => stripTag(stripLeadIns(u))).join(' '));
  const split = list.map(u => splitCoordinated(stripTag(stripLeadIns(u))) ?? stripTag(stripLeadIns(u)));
  add('split_coordination', split.join(' '));
  return [...out].map(([text, label]) => ({label, text}));
}
