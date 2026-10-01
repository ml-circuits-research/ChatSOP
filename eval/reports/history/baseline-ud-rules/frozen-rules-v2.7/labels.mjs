/**
 * Labelled simple-text lines (DS022 "Simple-text rendering") for the UD → SOP converter (baseline-ud-rules-v1.1).
 *
 * A simplifier (or the oracle renderer tools/datasets/diversity/simple-text.mjs) writes one clause per line and opens
 * a line with a connective label: `Maybe:`, `Suppose:`, `<X> says:`, `<X> thinks:`, `Assumption:`, `And:`,
 * `Count:`, `Except:`, `Condition:`, `Rank:`, `Order:`, `As of:`, `Group:` + `Check <quantifier>:`, `Options:`,
 * `Ambiguous.` + `Reading:`, and the constraint lines `Number x is between LO and HI.` / `Is it possible that …?` /
 * `Prove that ….` (Romanian: `Poate:`, `Să presupunem:`, `<X> spune:` / `crede:`, `Presupunere:`, `Și:`, `Numără:`,
 * `Excepție:`, `Condiție:`, `Clasament:`, `Ordine:`, `Conform datelor din:`, `Grup:` + `Verifică …:`, `Variante:`,
 * `Ambiguu.` + `Variantă:`, `Numărul …`, `Este posibil ca …?`, `Demonstrează că …`).
 *
 * `readLabels(message)` finds the labels by position; `maskLabels(text, labels)` blanks what the parser must not see
 * (the label words, and whole modifier lines the rules read directly), keeping offsets; `applyLabels(wires, labels)`
 * turns the labels into certainty, speaker, `assumed`, query conjuncts, count, except, compare, rank, order, asof,
 * universal questions and constraints. Every value still comes verbatim from the message.
 */
import {fold} from './lexicon.mjs';

const W = "[\\p{L}\\p{N}'’.&-]+";
const LINE_RULES = [
  ['ambiguous', /^(ambiguous|ambiguu)\.\s*$/iu],
  ['reading', /^(?:reading|variant[ăa]):\s*(.+?)\s*$/iu],
  ['number', new RegExp(`^(?:number|num[ăa]rul)\\s+(${W})\\s+(?:is between|este [îi]ntre)\\s+(-?\\d+)\\s+(?:and|[șs]i)\\s+(-?\\d+)\\.?\\s*$`, 'iu')],
  ['possible', /^(?:is it possible that|este posibil ca)\s+(.+?)\?\s*$/iu],
  ['prove', /^(?:prove that|demonstreaz[ăa] c[ăa])\s+(.+?)\.?\s*$/iu],
  ['maybe', /^(maybe|poate):\s*/iu],
  ['suppose', /^(suppose|s[ăa] presupunem):\s*/iu],
  ['assumption', /^(assumption|presupunere):\s*/iu],
  ['and', /^(and|[șs]i):\s*/iu],
  ['count', /^(count|num[ăa]r[ăa]):\s*/iu],
  ['except', /^(?:except|excep[țt]ie):\s*(.+?)\.?\s*$/iu],
  ['condition', /^(?:condition|condi[țt]ie):\s*(.+?)\.?\s*$/iu],
  ['rank', /^(?:rank|clasament):\s*(.+?)\.?\s*$/iu],
  ['order', /^(?:order|ordine):\s*(.+?)\.?\s*$/iu],
  ['asof', /^(?:as of|conform datelor din):\s*(.+?)\.?\s*$/iu],
  ['options', /^(?:options|variante):\s*(.+?)\.?\s*$/iu],
  ['group', /^(group|grup):\s*/iu],
  ['check', /^(?:check|verific[ăa])\s+([^:]{1,30}):\s*/iu],
  ['says', /^((?:[\p{L}'’.&-]+\s+){0,5}?[\p{L}'’.&-]+)\s+(says|spune):\s*/iu],
  ['thinks', /^((?:[\p{L}'’.&-]+\s+){0,5}?[\p{L}'’.&-]+)\s+(thinks|crede):\s*/iu],
];
/** Lines the rules read entirely (nothing of them goes to the parser). */
const WHOLE_LINE = new Set(['ambiguous', 'reading', 'number', 'possible', 'prove', 'except', 'condition', 'rank', 'order', 'asof', 'options']);

/** Labelled lines of a message: [{kind, start, end, labelEnd, args}] (offsets into the message). */
export function readLabels(message) {
  const out = [];
  let offset = 0;
  for (const raw of String(message).split('\n')) {
    const lead = raw.length - raw.trimStart().length;
    const line = raw.trim();
    for (const [kind, pattern] of LINE_RULES) {
      const m = pattern.exec(line);
      if (!m) continue;
      out.push({kind, start: offset + lead, end: offset + lead + line.length, labelEnd: offset + lead + (WHOLE_LINE.has(kind) ? line.length : m[0].length), args: m.slice(1)});
      break;
    }
    offset += raw.length + 1;
  }
  // v2.7: "Both at once: does A, and is B?", "Does Ana both work at X and live in Y?": the yes/no questions of the sentence are one conjunction.
  for (const [pattern, explicit] of [[BOTH, true], [JOINED, false]]) for (const m of String(message).matchAll(pattern)) {
    const start = m.index + (m[1] ?? '').length, end = m.index + m[0].length;
    if (!out.some(l => l.kind === 'both' && l.start === start)) out.push({kind: 'both', start, end, labelEnd: start, args: [explicit]});
  }
  return out;
}
/** A sentence with "both at once:" before it, with "both … and" inside it, or two auxiliary-initial yes/no clauses joined by "and" (one question mark: the corpus gold is one conjunction); group 1 is the text before the sentence proper. */
const AUX = 'does|do|did|is|are|was|were|has|have|had|can|could|will|would';
const BOTH = /(^|[.!?]\s+|\n)((?:[^.!?\n]*\bboth at once\s*:[^.!?\n]*|[^.!?\n]*\bboth\b[^.!?\n]*\band\b[^.!?\n]*)[?])/giu;
const JOINED = new RegExp(`(^|[.!?]\\s+|\\n)((?:[^.!?\\n]*?[,:]\\s+)?(?:${AUX})\\b[^.!?\\n]*?,?\\s+and\\s+(?:${AUX})\\b[^.!?\\n]*[?])`, 'giu');

/** Blank label words and whole modifier lines (same length, so offsets stay valid). */
export function maskLabels(text, labels) {
  let out = String(text);
  for (const l of labels) out = out.slice(0, l.start) + out.slice(l.start, l.labelEnd).replace(/[^\n]/g, ' ') + out.slice(l.labelEnd);
  return out;
}

const COMPARE = [['not equal to', 'not_equal'], ['diferit de', 'not_equal'], ['equal to', 'equal'], ['egal cu', 'equal'], ['at least', 'at_least'], ['cel putin', 'at_least'], ['at most', 'at_most'], ['cel mult', 'at_most'], ['above', 'above'], ['peste', 'above'], ['below', 'below'], ['sub', 'below'], ['at_least', 'at_least'], ['at_most', 'at_most'], ['not_equal', 'not_equal'], ['equal', 'equal']];
const QUANTIFIER = [['not all', 'not_all'], ['nu toti', 'not_all'], ['all', null], ['toti', null], ['none', 'none'], ['niciunul', 'none'], ['most', 'most'], ['majoritatea', 'most'], ['half', 'half'], ['jumatate', 'half']];
const isVar = v => typeof v === 'string' && /^\?/.test(v);
const varsOf = q => [...new Set([...q.blocks, q.scope].filter(Boolean).flatMap(b => b.roles.map(r => r.value)).filter(isVar))];
const renameIn = (q, from, to) => {
  const swap = v => (v === from ? to : v);
  for (const b of [...q.blocks, q.scope].filter(Boolean)) b.roles = b.roles.map(r => ({...r, value: swap(r.value)}));
  q.select = (q.select ?? []).map(swap);
  q.compares = (q.compares ?? []).map(c => c.map(swap));
  q.excepts = (q.excepts ?? []).map(([v, x]) => [swap(v), x]);
  if (q.rank) q.rank = q.rank.map(swap);
  if (q.order) q.order = q.order.map(swap);
};
/** Placeholder variable of a query: the one from "something"/"ceva" (the value a Condition or Rank line names). */
const placeholderOf = q => q.placeholders?.at(-1) ?? varsOf(q).filter(v => !(q.select ?? []).includes(v)).at(-1) ?? null;
/** Constraint expression words: declared names become ?variables; comparator and arithmetic words stay. */
const expression = (text, names) => String(text).trim().split(/\s+/).map(token => (names.has(token) ? '?' + token.replace(/[^A-Za-z0-9_]/g, '_') : token)).join(' ');

/**
 * Apply the labels to the analysis wires (each wire carries `pos`, the offset of its sentence). Returns the new wire
 * list; `newId(kind)` allocates wire ids. Lines of a constraint or an ambiguity replace the analysis altogether.
 */
export function applyLabels(wires, labels, message, newId) {
  if (!labels.length) return wires;
  const readings = labels.filter(l => l.kind === 'reading').map(l => l.args[0]).filter(Boolean);
  if (labels.some(l => l.kind === 'ambiguous') && readings.length >= 2) return [{type: 'unclear', id: 'u', kind: 'ambiguous', readings: [...new Set(readings)].slice(0, 4)}];
  const numbers = labels.filter(l => l.kind === 'number');
  const claim = labels.find(l => l.kind === 'possible' || l.kind === 'prove');
  if (numbers.length && claim) {
    const names = new Set(numbers.map(l => l.args[0]));
    return [{type: 'constraint', id: 'c', vars: numbers.map(l => ['?' + l.args[0].replace(/[^A-Za-z0-9_]/g, '_'), l.args[1], l.args[2]]), requires: labels.filter(l => l.kind === 'condition').map(l => expression(l.args[0], names)), claim: expression(claim.args[0], names), task: claim.kind === 'prove' ? 'prove' : 'possible'}];
  }
  const lineOf = w => labels.find(l => w.pos !== undefined && w.pos >= l.start && w.pos < l.end) ?? null;
  let out = [...wires];
  const queries = () => out.filter(w => w.type === 'query');
  const previousQuery = at => queries().filter(q => q.pos < at).at(-1) ?? null;
  for (const label of labels) {
    const own = out.filter(w => lineOf(w) === label && w.type !== 'unparsed');
    switch (label.kind) {
      case 'maybe': for (const w of own) if (w.type === 'stated') w.certainty = 'hedged'; break;
      case 'suppose': for (const w of own) if (w.type === 'stated') w.certainty = 'supposed'; break;
      case 'says': case 'thinks': for (const w of own) if (w.type === 'stated') { w.speaker = label.args[0]; if (label.kind === 'thinks') w.certainty = 'hedged'; } break;
      case 'assumption':
        out = out.map(w => (own.includes(w) && w.type === 'stated' ? {type: 'assumed', id: newId('a'), pos: w.pos, relation: w.relation, roles: w.roles, polarity: w.polarity, links: []} : w));
        break;
      case 'count': for (const q of own.filter(w => w.type === 'query')) { const v = q.select?.[0] ?? varsOf(q)[0]; if (v) { q.mode = 'count'; q.select = [v]; q.measure = null; } } break;
      case 'and': {
        for (const q of own.filter(w => w.type === 'query')) {
          const prev = previousQuery(label.start);
          if (!prev || prev === q) continue;
          // The new line's asked or indefinite entity is the previous line's; other variables are renamed apart.
          const shared = q.select?.[0] ?? varsOf(q).find(v => !(q.placeholders ?? []).includes(v));
          const target = prev.mode === 'every' ? prev.everyVar : prev.select?.[0] ?? varsOf(prev).find(v => !(prev.placeholders ?? []).includes(v));
          const taken = new Set(varsOf(prev));
          for (const v of varsOf(q)) {
            if (v === shared && target) { renameIn(q, v, target); continue; }
            let fresh = v, i = 2;
            while (taken.has(fresh)) fresh = v.replace(/\d+$/, '') + i++;
            if (fresh !== v) renameIn(q, v, fresh);
            taken.add(fresh);
          }
          prev.blocks.push(...q.blocks);
          prev.compares = [...(prev.compares ?? []), ...(q.compares ?? [])];
          prev.placeholders = [...(prev.placeholders ?? []), ...(q.placeholders ?? []).map(v => (v === shared ? target : v))];
          if (!prev.mode && !prev.select?.length && varsOf(prev).length) prev.mode = 'exists';
          out = out.filter(w => w !== q);
          for (const w of out) if (w.type === 'unparsed' && w.near === q.id) w.near = prev.id;
        }
        break;
      }
      case 'both': {
        // the plain yes/no queries of one sentence become one query whose blocks all must hold
        const parts = queries().filter(q => q.pos >= label.start && q.pos < label.end && !q.mode && !q.select?.length && !q.fragment);
        if (parts.length < 2) break;
        // an explicit "both" always asks the conjunction; plain "A and B?" is one conjunction only when both ask about one subject (the diversity generator's `conjunction` form)
        // a query period belongs to one clause and would span the others: such a sentence keeps one query per clause
        if (parts.some(q => q.during || q.at || q.overlaps)) break;
        const subjects = parts.map(q => q.blocks.map(b => b.roles.find(r => r.name === 'subject')?.value));
        if (!label.args[0] && !(parts.every(q => q.blocks.length === 1 && !(q.compares ?? []).length) && subjects.every(([v]) => v && !isVar(v) && v === subjects[0][0]))) break;
        const [first, ...rest] = parts;
        for (const q of rest) {
          first.blocks.push(...q.blocks);
          first.compares = [...(first.compares ?? []), ...(q.compares ?? [])];
          out = out.filter(w => w !== q);
          for (const w of out) if (w.type === 'unparsed' && w.near === q.id) w.near = first.id;
        }
        break;
      }
      case 'group': for (const q of own.filter(w => w.type === 'query')) { q.group = true; q.everyVar = q.select?.[0] ?? varsOf(q)[0]; } break;
      case 'check': {
        const prev = previousQuery(label.start);
        const stated = own.find(w => w.type === 'stated');
        if (!prev || !stated || !prev.everyVar) break;
        const words = fold(label.args[0]);
        const quant = QUANTIFIER.find(([w]) => words === w || words.startsWith(w + ' '));
        const subject = stated.roles.find(r => r.name === 'subject');
        prev.scope = {relation: stated.relation, polarity: stated.polarity, roles: stated.roles.map(r => (r === subject ? {...r, value: prev.everyVar} : r))};
        prev.mode = 'every';
        prev.quantifier = quant?.[1] ?? (/^at least \d+$/.test(words) ? words.replace(' ', '_').replace(' ', ' ') : null);
        prev.select = [];
        prev.measure = null;
        out = out.filter(w => w !== stated);
        for (const w of out) if (w.type === 'unparsed' && w.near === stated.id) w.near = prev.id;
        break;
      }
      case 'except': { const prev = previousQuery(label.start); const v = prev && (prev.select?.[0] ?? varsOf(prev)[0]); if (v) prev.excepts = [...(prev.excepts ?? []), [v, label.args[0]]]; break; }
      case 'condition': {
        const prev = previousQuery(label.start);
        if (!prev) break;
        const text = fold(label.args[0]);
        const cmp = COMPARE.find(([w]) => text.includes(' ' + w + ' '));
        if (!cmp) break;
        const [left, right] = text.split(' ' + cmp[0] + ' ').map(x => x.trim());
        const slots = (prev.placeholders ?? []).filter(v => varsOf(prev).includes(v));
        const v = slots[0] ?? placeholderOf(prev);
        if (!v) break;
        const name = '?' + left.replace(/[^a-z0-9_]/g, '_');
        if (!varsOf(prev).includes(name)) renameIn(prev, v, name);
        let operand;
        if (/^-?\d+$/.test(right)) operand = right;
        else if (/^[a-z_]+$/.test(right) && slots[1]) { operand = '?' + right; if (!varsOf(prev).includes(operand)) renameIn(prev, slots[1], operand); }
        else operand = JSON.stringify(label.args[0].split(new RegExp('\\s' + cmp[0].replace(/ /g, '\\s') + '\\s', 'i')).at(-1) ?? right);
        prev.compares = [...(prev.compares ?? []), [name, cmp[1], operand]];
        break;
      }
      case 'rank': {
        const prev = previousQuery(label.start);
        if (!prev) break;
        const text = fold(label.args[0]);
        const direction = /^(highest|cel mai mare)\b/.test(text) ? 'highest' : /^(lowest|cel mai mic)\b/.test(text) ? 'lowest' : null;
        const v = placeholderOf(prev);
        if (!direction || !v) break;
        const name = '?' + (text.split(/\s+/).at(-1) || 'v').replace(/[^a-z0-9_]/g, '_');
        if (!varsOf(prev).includes(name)) renameIn(prev, v, name);
        prev.rank = [direction, varsOf(prev).includes(name) ? name : v];
        break;
      }
      case 'order': {
        const prev = previousQuery(label.start);
        if (!prev || prev.blocks.length < 2) break;
        const text = fold(label.args[0]);
        const relation = /\b(after|dupa)\b/.test(text) ? 'after' : /\b(same time|acelasi timp)\b/.test(text) ? 'same_time' : 'before';
        const [a, b] = prev.blocks;
        a.roles = [...a.roles.filter(r => r.name !== 'time'), {name: 'time', value: '?t1'}].slice(0, 4);
        b.roles = [...b.roles.filter(r => r.name !== 'time'), {name: 'time', value: '?t2'}].slice(0, 4);
        prev.order = ['?t1', relation, '?t2'];
        if (!prev.select?.length) prev.mode = 'exists';
        prev.measure = null;
        break;
      }
      case 'asof': { const next = queries().find(q => q.pos >= label.end); if (next) next.asof = label.args[0]; break; }
      case 'options': {
        const prev = previousQuery(label.start);
        const v = prev && (prev.select?.[0] ?? varsOf(prev)[0]);
        if (v) prev.options = [v, label.args[0].split(/\s*,\s*|\s+(?:or|sau)\s+/).filter(Boolean)];
        break;
      }
      default: break;
    }
  }
  return out;
}
