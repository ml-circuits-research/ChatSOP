/**
 * Path E, controlled English (Attempto-like): the model rewrites the facts and the question into a FIXED set of sentence patterns
 * (the question text in config/knowledge/formalizer-six-paths-v1 `E_rewrite`), and this deterministic parser compiles them. A
 * sentence the parser rejects is named in one re-ask; rejected sentences after it stop the path honestly.
 *   arithmetic  "The <q> is <number>." and the defining patterns → `name = expression` lines → SOP session rules;
 *   logic       "<Name> is <property>.", "Every <p> is <p2>.", "If something is <p> and <p2> then it is <p3>." → facts and rules
 *               of the deduce primitive (tools/eval/method-library/primitives.mjs, a closed-world SOP circuit).
 * The patterns are a small formal language written by the model; the parser reads only that language (like the SOP parser), never the
 * problem's own phrasing. A number is mapped to the registry index with the same value (so a perturbation moves it).
 */
import {ask, ident, ReadError} from './common.mjs';
import {programResult} from './program.mjs';
import {deduce} from '../method-library/primitives.mjs';

const NUM = String.raw`-?\d[\d,]*(?:\.\d+)?`;
const Q = String.raw`(?:the\s+)?([a-z][a-z0-9' -]*?)`;
const OPERAND = String.raw`((?:the\s+)?${NUM}|the\s+[a-z][a-z0-9' -]*?)`;
const BIN = {plus: '+', minus: '-', times: '*', 'divided by': '/', 'multiplied by': '*'};
const CMP = {'at most': '<=', 'at least': '>=', 'less than': '<', 'more than': '>', 'greater than': '>', 'equal to': '=='};
const strip = s => s.replace(/^(?:a|an|the)\s+/i, '').trim();

/** Parses the rewritten text → {quantities: Map name → {kind, ...}, asked: [...], logic: {facts, rules, questions}, rejected: [lines]}. */
export function parseCnl(text) {
  const out = {defs: new Map(), asked: [], facts: [], rules: [], logicQ: [], rejected: []};
  const sentences = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*|`/g, '').split('\n')
    .map(s => s.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(s => s && !/^[A-Za-z ]{1,20}:$/.test(s));
  for (const raw of sentences) {
    const s = raw.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/\b([Tt]he) the\b/g, '$1').trim();
    const low = s.toLowerCase();
    let m;
    const operand = x => { x = x.trim().replace(new RegExp(`^the\\s+(?=${NUM}$)`), ''); return new RegExp(`^${NUM}$`).test(x) ? {num: Number(x.replace(/,/g, ''))} : {q: ident(strip(x))}; };
    const list = x => x.split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map(y => y.trim()).filter(Boolean).map(operand);
    const def = (name, d) => { const id = ident(strip(name)); if (!id || out.defs.has(id)) return false; out.defs.set(id, d); return true; };
    if ((m = new RegExp(`^the ([a-z][a-z0-9' -]*?) is (${NUM})( percent| %|%)?\\.?$`).exec(low))) { if (def(m[1], {kind: 'num', num: Number(m[2].replace(/,/g, '')), percent: Boolean(m[3])})) continue; }
    else if ((m = new RegExp(`^the ([a-z][a-z0-9' -]*?) is ${OPERAND} (plus|minus|times|multiplied by|divided by) ${OPERAND}\\.?$`).exec(low))) { if (def(m[1], {kind: 'bin', op: BIN[m[3]], a: operand(m[2]), b: operand(m[4])})) continue; }
    else if ((m = new RegExp(`^the ([a-z][a-z0-9' -]*?) is the difference (?:of|between) ${OPERAND} and ${OPERAND}\\.?$`).exec(low))) { if (def(m[1], {kind: 'bin', op: '-', a: operand(m[2]), b: operand(m[3])})) continue; }
    else if ((m = /^the ([a-z][a-z0-9' -]*?) is the (sum|product|average) of (.+?)\.?$/.exec(low))) { if (def(m[1], {kind: m[2], items: list(m[3])})) continue; }
    else if ((m = new RegExp(`^the ([a-z][a-z0-9' -]*?) is (?:the )?(\\d+)/(\\d+)(?: percent)? of ${OPERAND}\\.?$`).exec(low))) { if (def(m[1], {kind: 'frac', a: {num: Number(m[2])}, b: {num: Number(m[3])}, c: operand(m[4])})) continue; }
    else if ((m = new RegExp(`^the ([a-z][a-z0-9' -]*?) is ${OPERAND} percent of ${OPERAND}\\.?$`).exec(low))) { if (def(m[1], {kind: 'pct', a: operand(m[2]), b: operand(m[3])})) continue; }
    else if ((m = new RegExp(`^the ([a-z][a-z0-9' -]*?) is ${OPERAND} (increased|decreased) by ${OPERAND} percent\\.?$`).exec(low))) { if (def(m[1], {kind: m[3], a: operand(m[2]), b: operand(m[4])})) continue; }
    else if ((m = new RegExp(`^the ([a-z][a-z0-9' -]*?) is ${OPERAND} rounded( up| down)?\\.?$`).exec(low))) { if (def(m[1], {kind: 'round', dir: (m[3] ?? '').trim(), a: operand(m[2])})) continue; }
    else if ((m = /^the ([a-z][a-z0-9' -]*?) is the (smaller|larger|smallest|largest) of (.+?)\.?$/.exec(low))) { if (def(m[1], {kind: /small/.test(m[2]) ? 'min' : 'max', items: list(m[3])})) continue; }
    else if ((m = new RegExp(`^the ([a-z][a-z0-9' -]*?) is the remainder of ${OPERAND} divided by ${OPERAND}\\.?$`).exec(low))) { if (def(m[1], {kind: 'rem', a: operand(m[2]), b: operand(m[3])})) continue; }
    else if ((m = /^what is the ([a-z][a-z0-9' -]*?)\?$/.exec(low))) { out.asked.push({kind: 'value', q: ident(strip(m[1]))}); continue; }
    else if ((m = new RegExp(`^is ${OPERAND} (at most|at least|less than|more than|greater than|equal to) ${OPERAND}\\?$`).exec(low))) { out.asked.push({kind: 'cmp', op: CMP[m[2]], a: operand(m[1]), b: operand(m[3])}); continue; }
    else if ((m = /^every ([a-z][a-z0-9 -]*?) is (not )?([a-z][a-z0-9 -]*?)\.?$/.exec(low))) { out.rules.push({if: [`${ident(strip(m[1]))} ?x`], then: `${m[2] ? 'not ' : ''}${ident(strip(m[3]))} ?x`}); continue; }
    else if ((m = /^if something is (.+?) then it is (not )?([a-z][a-z0-9 -]*?)\.?$/.exec(low))) { out.rules.push({if: m[1].split(/\s+and\s+(?:it is\s+)?/).map(p => /^not\s+/.test(p) ? `not ${ident(strip(p.slice(4)))} ?x` : `${ident(strip(p))} ?x`), then: `${m[2] ? 'not ' : ''}${ident(strip(m[3]))} ?x`}); continue; }
    else if ((m = /^([A-Z][\w'-]*) ([a-z]+(?: [a-z]+)?) ([A-Z][\w'-]*)\.?$/.exec(s))) { out.facts.push(`${ident(m[2])} ${JSON.stringify(m[1])} ${JSON.stringify(m[3])}`); continue; }
    else if ((m = /^[Ii]s it true that ([A-Z][\w'-]*) ([a-z]+(?: [a-z]+)?) ([A-Z][\w'-]*)\?$/.exec(s))) { out.logicQ.push({atom: `${ident(m[2])} ${JSON.stringify(m[1])} ${JSON.stringify(m[3])}`}); continue; }
    else if ((m = /^the ([a-z][a-z0-9 -]*?) is (not )?([a-z][a-z-]*(?: [a-z][a-z-]*)?)\.?$/.exec(low)) && !/^(the |a |an )/.test(m[3])) { out.facts.push(`${m[2] ? 'not ' : ''}${ident(strip(m[3]))} ${JSON.stringify(`the ${m[1]}`)}`); continue; }
    else if ((m = /^is the ([a-z][a-z0-9 -]*?) (not )?([a-z][a-z -]*?)\?$/.exec(low)) && !/^(the |a |an |at |less |more |greater |equal )/.test(m[3])) { out.logicQ.push({name: `the ${m[1]}`, negated: Boolean(m[2]), p: ident(strip(m[3])), words: `${m[1]} ${m[3]}`}); continue; }
    else if ((m = /^[Ii]s ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*) (not )?([a-z][a-z0-9 -]*?)\?$/.exec(s))) { out.logicQ.push({name: m[1], negated: Boolean(m[2]), p: ident(strip(m[3]))}); continue; }
    else if ((m = /^([A-Z][\w'-]*(?: [A-Z][\w'-]*)*) is (not )?([a-z][a-z0-9 -]*?)\.?$/.exec(s))) { out.facts.push(`${m[2] ? 'not ' : ''}${ident(strip(m[3]))} ${JSON.stringify(m[1])}`); continue; }
    out.rejected.push(raw);
  }
  // "Is the rock fragment present?": the split between the thing and the property is the one whose thing a statement names.
  const subjects = new Set(out.facts.map(f => (/"([^"]+)"/.exec(f) ?? [])[1]).filter(Boolean));
  for (const q of out.logicQ) {
    if (!q.words) continue;
    const w = q.words.split(' ');
    for (let k = w.length - 1; k >= 1; k--) if (subjects.has(`the ${w.slice(0, k).join(' ')}`)) { q.name = `the ${w.slice(0, k).join(' ')}`; q.p = ident(strip(w.slice(k).join(' '))); break; }
  }
  return out;
}

/** The program lines of the arithmetic part, with numbers mapped to registry indices; or {why}. */
export function cnlProgram(p, registry) {
  const lines = [], done = new Set(), visiting = new Set();
  // Every quantity is the number as written ("15 percent" is 15); a percentage of the registry is its fraction in a program, so it is
  // multiplied back, and "percent of", "increased by ... percent" divide by 100.
  const ref = num => {
    const hits = registry.filter(v => v.value === num);
    if (!hits.length) return String(num);
    const pctHit = hits.find(h => h.percent), h = pctHit ?? hits[0];
    return h.percent ? `(v${h.index} * 100)` : `v${h.index}`;
  };
  const term = o => { if ('num' in o) return ref(o.num); emit(o.q); return `q_${o.q}`; };
  const pct = o => `(${term(o)} / 100)`;
  const emit = name => {
    if (done.has(name)) return;
    if (visiting.has(name)) throw new Error(`${name} is defined by itself`);
    const d = p.defs.get(name);
    if (!d) throw new Error(`"the ${name.replace(/_/g, ' ')}" is used but never given`);
    visiting.add(name);
    let t;
    switch (d.kind) {
      case 'num': t = ref(d.num); break;
      case 'bin': t = `(${term(d.a)}) ${d.op} (${term(d.b)})`; break;
      case 'sum': t = d.items.map(term).join(' + '); break;
      case 'product': t = d.items.map(x => `(${term(x)})`).join(' * '); break;
      case 'average': t = `(${d.items.map(term).join(' + ')}) / ${d.items.length}`; break;
      case 'pct': t = `${pct(d.a)} * (${term(d.b)})`; break;
      case 'increased': t = `(${term(d.a)}) * (1 + ${pct(d.b)})`; break;
      case 'decreased': t = `(${term(d.a)}) * (1 - ${pct(d.b)})`; break;
      case 'round': t = `Math.${d.dir === 'up' ? 'ceil' : d.dir === 'down' ? 'floor' : 'round'}(${term(d.a)})`; break;
      case 'min': case 'max': t = d.items.length > 1 ? `Math.${d.kind}(${d.items.map(term).join(', ')})` : term(d.items[0]); break;
      case 'rem': t = `(${term(d.a)}) % (${term(d.b)})`; break;
      case 'frac': t = `(${term(d.a)}) / (${term(d.b)}) * (${term(d.c)})`; break;
      default: throw new Error('unknown definition');
    }
    visiting.delete(name); done.add(name);
    lines.push({name: `q_${name}`, text: t});
  };
  try {
    p.asked.forEach((a, i) => {
      const t = a.kind === 'value' ? term({q: a.q}) : `${term(a.a)} ${a.op} ${term(a.b)}`;
      lines.push({name: `answer${i + 1}`, text: t});
    });
  } catch (error) { return {why: error.message}; }
  return {lines};
}

/** The sentences of a problem, by punctuation and line breaks (structure), grouped into at most `max` chunks; questions apart. */
export function sentencesOf(text, max = 8) {
  const all = String(text).split(/\n+/).flatMap(line => line.split(/(?<=[.!?;])\s+(?=[A-Z0-9"“(])/)).map(x => x.trim()).filter(Boolean);
  const facts = all.filter(x => !/\?\s*$/.test(x));
  const chunks = [];
  const per = Math.ceil(facts.length / max) || 1;
  for (let i = 0; i < facts.length; i += per) chunks.push(facts.slice(i, i + per).join(' '));
  return chunks;
}

/**
 * Path E, sentence by sentence (redesign after batch1, where tiny rewrote whole problems into free sentences 99 times in 100): each
 * sentence of the problem is rewritten on its own into the patterns (or "none"), with the names written so far shown, a rejected
 * sentence named in one re-ask; then the question sentences. The parser and the compilation are unchanged.
 */
export async function pathE({item, registry, ctx}) {
  ctx.maxQuestions = Math.max(ctx.maxQuestions, 12);
  const lines = [];
  const known = () => {
    const p = parseCnl(lines.join('\n'));
    const names = [...p.defs.keys()].map(n => `the ${n.replace(/_/g, ' ')}`);
    const things = [...new Set(p.facts.map(f => (/"([^"]+)"/.exec(f) ?? [])[1]).filter(Boolean))];
    return [...names, ...things].join(', ') || '(none yet)';
  };
  const reader = t => {
    if (/^\W*none\W*$/i.test(String(t).trim())) return [];
    const p = parseCnl(t);
    if (p.rejected.length) throw new ReadError(`these lines follow no pattern: ${p.rejected.slice(0, 4).join(' | ')}`);
    const out = String(t).split('\n').map(x => x.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(x => x && !/^[A-Za-z ]{1,20}:$/.test(x));
    return out.length ? out : null;
  };
  for (const sentence of sentencesOf(item.question)) {
    const a = await ask(ctx, 'E_sentence', {problem: item.question, known: known(), sentence}, reader, {maxTokens: 300});
    if (!a) return {status: 'rejected', why: `sentence not in the patterns: ${sentence.slice(0, 80)}`};
    lines.push(...a.value);
  }
  const q = await ask(ctx, 'E_question', {problem: item.question, known: known()}, t => { const v = reader(t); if (!v?.length) return null; const p = parseCnl(v.join('\n')); return p.asked.length || p.logicQ.length ? v : null; }, {maxTokens: 300});
  if (!q) return {status: 'rejected', why: 'no question sentence'};
  lines.push(...q.value);
  const p = parseCnl(lines.join('\n'));
  if (p.asked.length) {
    const prog = cnlProgram(p, registry);
    if (!prog.lines) return {status: 'rejected', why: prog.why};
    const res = programResult(prog.lines, registry, {message: item.question});
    if (!res.ok) return {status: 'rejected', why: res.violations.slice(0, 2).join('; ')};
    return {status: 'ok', exec: res.exec, program: res.program, kind: 'arithmetic'};
  }
  const run = async () => {
    const out = [];
    for (const lq of p.logicQ) {
      const atom = lq.atom ?? `${lq.negated ? 'not ' : ''}${lq.p} ${JSON.stringify(lq.name)}`;
      const res = await deduce({facts: p.facts, rules: p.rules, question: {ask: 'forced', atom}});
      if (res.kind !== 'yesno') return null;
      out.push(res.value);
    }
    return out;
  };
  if (await run()) return {status: 'ok', exec: async () => run(), kind: 'logic'};
  return {status: 'rejected', why: 'the statements and the question could not be checked together'};
}
