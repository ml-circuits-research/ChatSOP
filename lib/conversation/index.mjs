/**
 * The choice of the chat's reply by the reasoning engine (DS023 "Conversation layer", owner decisions of 2026-10-02: no user-facing
 * text in code; the choice of a reply is a judgment, so the JS oracle makes it, not if/else code).
 *
 *   1. `turnFacts` maps a turn's result packet to facts (cv_turn_status, cv_turn_unclear, cv_turn_signal, cv_turn_answered, the near-miss
 *      candidate, the topics of the memory's statistics, ...): structure only, no reading of the user's words;
 *   2. the conversation layer (config/knowledge/conversation-v1, sop/replies.mjs) holds the reply wires, the situation priorities and
 *      the rules that derive `cv_applies SITUATION`; its reply wires become the facts cv_reply_for, cv_reply_part, cv_reply_language;
 *   3. the JS oracle (reasoning/strategies/js-reference, in process, the layer prepared once per version) derives `cv_applicable_reply`;
 *      per part (opening, body, closing) the replies of the applicable situation of highest priority are kept and one variant is
 *      picked with a seeded choice; the derivation of each chosen situation goes to the packet (`reply`) and the chat trace;
 *   4. `composeReply` fills the chosen texts' slots from the packet and joins opening, body and closing.
 */
import {prepare, update, ask} from '../../reasoning/strategies/js-reference/index.mjs';
import {proofOf} from '../../reasoning/strategies/js-reference/support.mjs';
import {replyLayer, fill, line, joinList, indexLayer} from '../../sop/replies.mjs';

/** The parts of a reply, in the order they are joined (sop/knowledge/grammar.mjs REPLY_PARTS without `line`). */
export const PARTS = ['prefix', 'opening', 'body', 'aside', 'follow_up', 'closing', 'suffix'];
const handles = new Map();
const symbol = value => String(value).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'none';

/** The layer prepared for the oracle: its circuits plus the reply wires as facts. Cached per layer version. */
function prepared(layer = replyLayer()) {
  if (handles.has(layer.version)) return handles.get(layer.version);
  const facts = [...layer.replies.values()].flatMap((r, i) => [
    `@cv_rf${i} fact\n  holds cv_reply_for ${r.id} ${r.situation}\n`,
    `@cv_rp${i} fact\n  holds cv_reply_part ${r.id} ${r.part}\n`,
    `@cv_rl${i} fact\n  holds cv_reply_language ${r.id} ${r.language}\n`]);
  const text = layer.circuits.map(c => c.text).join('\n') + '\n' + facts.join('\n');
  const entry = {handle: prepare(text), ...layerData(text), layer};
  handles.set(layer.version, entry);
  return entry;
}

/** The data of a layer text the code reads structurally: situation priorities, the drives and the reaction kinds of situations. */
function layerData(text) {
  const priorities = new Map(), reactionKinds = new Map(), drives = [];
  for (const m of text.matchAll(/holds cv_situation_priority (\w+) (-?\d+)/g)) priorities.set(m[1], Number(m[2]));
  for (const m of text.matchAll(/holds cv_reaction_kind (\w+) (\w+)/g)) reactionKinds.set(m[1], m[2]);
  for (const m of text.matchAll(/holds cv_drive (\w+)\s*$/gm)) drives.push(m[1]);
  return {priorities, reactionKinds, drives};
}

/** The drives and reaction kinds of the layer (for the behaviour state). */
export function layerInfo(layer = replyLayer()) { const {drives, reactionKinds} = prepared(layer); return {drives, reactionKinds}; }

/**
 * The facts of a turn. `packet` is the result packet; `extra`: {answerText, near: {candidates, mentions}, topics: [labels], language}.
 * A turn is `computed` when the renderer produced an answer text; `answered` when that answer decides the question.
 */
export function turnFacts(packet = {}, extra = {}) {
  const atoms = [`cv_turn_status ${symbol(packet.status ?? 'none')}`, `cv_turn_language ${symbol(extra.language ?? 'en')}`];
  if (packet.status === 'unclear' && packet.unclear_kind) atoms.push(`cv_turn_unclear ${symbol(packet.unclear_kind)}`);
  for (const s of packet.pragmatic ?? []) if ((s.score ?? 1) >= 0.5) atoms.push(`cv_turn_signal ${symbol(s.kind ?? s)}`);
  if (extra.answerText) atoms.push('cv_turn_computed');
  if (extra.answerText && answered(packet)) atoms.push('cv_turn_answered');
  const candidate = extra.near?.candidates?.[0];
  if (candidate) {
    atoms.push('cv_turn_candidate');
    if (candidate.distance === 0) atoms.push('cv_turn_candidate_exact');
    if (candidate.description) atoms.push('cv_turn_candidate_described');
    if (candidate.relations?.length) atoms.push('cv_turn_candidate_relations');
  }
  if (extra.topics?.length) atoms.push('cv_turn_topics');
  if (packet.readings?.length) atoms.push('cv_turn_readings');
  return [...new Set(atoms)];
}

/** Whether a computed packet decides its question (structure of the packet, not of the words). */
export function answered(packet = {}) {
  // A solved constraint (a puzzle, an optimisation) decides its question whatever the outcome (problem-agent, DS014 "Problems that state their own data").
  if (['refuted', 'both', 'mixed_temporal', 'stored', 'entailed', 'possible', 'impossible', 'inconsistent', 'optimal', 'feasible_bound'].includes(packet.status)) return true;
  if (packet.status !== 'supported' && packet.status !== 'incomplete') return false;
  if (packet.count !== undefined || packet.at_least !== undefined) return true;
  const rows = packet.rows ?? packet.answers;
  return !Array.isArray(rows) || rows.length > 0;
}

/** A seeded choice among variants (mulberry32 over the seed): varied across turns, reproducible for a fixed seed. */
function pick(options, seed) {
  let t = (Number(seed) >>> 0) + 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return options[(((t ^ (t >>> 14)) >>> 0) % options.length)];
}

/** The derivation of a ground atom as short lines ("cv_applies near_candidate ← rule cv_r_near_candidate"). */
function derivation(part, atom) {
  try {
    const rows = part.reread([{key: 'where', value: atom, block: []}], 'exists', []).rows;
    if (!rows.length) return [];
    const proof = proofOf(rows[0].prem);
    const byId = new Map(proof.nodes.map(n => [n.id, n]));
    const lines = [];
    const visit = (id, depth) => {
      const n = byId.get(id);
      if (!n || depth > 4) return;
      lines.push(`${'  '.repeat(depth)}${n.atom} ← ${n.kind === 'fact' ? 'turn fact' : `${n.kind} ${String(n.source?.id ?? '')}`}${n.absent?.length ? ` (absent: ${n.absent.join(', ')})` : ''}`);
      for (const p of n.premises) visit(p, depth + 1);
    };
    for (const r of proof.roots) visit(r, 0);
    return lines;
  } catch { return []; }
}

/**
 * The replies the oracle selects for the facts of a turn: {opening, body, closing} (each {id, situation, priority, text, why} or null),
 * the style (`short` or null), the facts and the time spent.
 */
export function chooseReplies(facts, {seed = Date.now(), layer = replyLayer(), overlay = ''} = {}) {
  const started = performance.now();
  const base = prepared(layer);
  // The conversation's own behaviour data (the user's instructions as reply wires and rules) joins the layer for this turn.
  const extra = overlay ? indexLayer([{name: 'overlay.sop', text: overlay}], 'conversation', {allowEmpty: true}) : null;
  const priorities = extra ? new Map([...base.priorities, ...layerData(overlay).priorities]) : base.priorities;
  const replies = extra ? new Map([...layer.replies, ...extra.replies]) : layer.replies;
  const replyFacts = extra ? [...extra.replies.values()].flatMap((r, i) => [`cv_reply_for ${r.id} ${r.situation}`, `cv_reply_part ${r.id} ${r.part}`, `cv_reply_language ${r.id} ${r.language}`]) : [];
  const turn = update(base.handle, {add: overlay + '\n' + [...facts, ...replyFacts].map((a, i) => `@cv_t${i} fact\n  holds ${a}\n`).join('\n')});
  const packet = ask({handle: turn, query: '@view query\n  mode exists\n  where any\n    cv_applicable_reply ?a\n    cv_style ?a\n  end\n', conditional: false, detail: true});
  const part = packet.detail?.parts?.[0];
  if (!part) throw Object.assign(new Error(`the conversation layer could not be evaluated: ${packet.status} ${packet.reason ?? ''}`), {code: 'reply_layer_error'});
  const read = p => part.reread([{key: 'where', value: `${p} ?a`, block: []}], 'select', ['?a']).rows.map(r => String(r.row.a));
  const applicable = read('cv_applicable_reply').map(id => replies.get(id)).filter(Boolean);
  const chosen = {};
  PARTS.forEach((name, i) => {
    const options = applicable.filter(r => r.part === name);
    if (!options.length) { chosen[name] = null; return; }
    const top = Math.max(...options.map(r => priorities.get(r.situation) ?? 0));
    const situation = options.find(r => (priorities.get(r.situation) ?? 0) === top).situation;
    const reply = pick(options.filter(r => r.situation === situation), Number(seed) + i * 7919);
    chosen[name] = {id: reply.id, situation, priority: top, text: reply.text, variants: options.filter(r => r.situation === situation).length,
      why: derivation(part, `cv_applies ${situation}`), outranked: [...new Set(options.filter(r => r.situation !== situation).map(r => r.situation))]};
  });
  return {...chosen, style: read('cv_style')[0] ?? null, facts, ms: Math.round((performance.now() - started) * 10) / 10};
}

/** The slots a turn can fill: the rendered answer, the near-miss candidate, the memory's topics, the readings. */
export function replySlots({answerText = null, near = null, topics = [], packet = {}, aside = null} = {}) {
  const c = near?.candidates?.[0];
  return {
    answer: answerText ?? undefined,
    mention: c?.mention ?? near?.mentions?.[0]?.surface ?? near?.mentions?.[0] ?? undefined,
    candidate: c?.label ?? undefined,
    candidate_description: c?.description ?? undefined,
    relations: c?.relations?.length ? joinList(c.relations.slice(0, 4).map(r => line('relation_label', {label: r.label ?? r.predicate}))) : undefined,
    topics: topics.length ? joinList(topics.slice(0, 4)) : undefined,
    readings: packet.readings?.length ? packet.readings.map((reading, i) => line('reading_item', {n: i + 1, reading})).join('\n') : undefined,
    aside_fact: aside ?? undefined,
  };
}

/**
 * The reply of a turn: the oracle's choice filled from the packet. Returns {text, reply} where `reply` is the packet record
 * {opening, body, closing, style, facts, ms} with each part's wire id, situation, priority and derivation.
 */
export function composeReply({packet = {}, answerText = null, near = null, topics = [], aside = null, language = 'en', seed = Date.now(), layer, facts: extraFacts = [], slots: extraSlots = {}, overlay = ''} = {}) {
  const facts = [...turnFacts(packet, {answerText, near, topics, language}), ...(aside ? ['cv_turn_aside_available'] : []), ...extraFacts];
  const choice = chooseReplies(facts, {seed, layer, overlay});
  const slots = {...replySlots({answerText, near, topics, packet, aside}), ...extraSlots};
  const filled = Object.fromEntries(PARTS.map(p => [p, choice[p] ? fill(choice[p].text, slots, choice[p].situation) : null]));
  if (choice.style === 'short' && filled.body?.includes('\n')) filled.body = filled.body.split('\n')[0];
  if (!filled.body) throw Object.assign(new Error(`the conversation layer selected no body for the turn (facts: ${facts.join('; ')})`), {code: 'reply_missing'});
  const text = PARTS.map(p => filled[p]).filter(Boolean).join(' ').replace(/ \n/g, '\n').replace(/\n /g, '\n');
  const record = Object.fromEntries(PARTS.map(p => [p, choice[p] && {id: choice[p].id, situation: choice[p].situation, priority: choice[p].priority, variants: choice[p].variants, why: choice[p].why, outranked: choice[p].outranked}]));
  // The user's own words around the reply (instructions) are kept apart, so a later rewording never changes them.
  const frame = {prefix: filled.prefix ?? null, suffix: filled.suffix ?? null};
  return {text, reply: {...record, style: choice.style, frame, facts, ms: choice.ms, layer: (layer ?? replyLayer()).origin}};
}
