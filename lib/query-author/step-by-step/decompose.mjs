/**
 * Semantic decomposition of a numeric problem, stage A (experiments/proposal/semantic-decomposition-protocol.md; the protocol is data in
 * config/knowledge/formalizer-protocol-v1/0070-decomposition.sop). The model never invents names and never splits the text:
 *   N0 registry  the system extracts every number of the message (structure) as v1..vn with a window of context; the model labels
 *                them by index (`v3: minutes per block | packing line`) and copies the named things it compares (e1..ek);
 *   N1 goals     what the question asks, one line per asked item, with a kind from a closed list (number, yes or no, which thing, other);
 *   N2 type      per goal, a shape from a menu filtered by the goal's kind (chain, check, batch, choose, breakeven);
 *   N3 slots     the type's closed questions answered by index: a formula over v1..vn (earlier lines may define intermediate values,
 *                least to most), a check, the amount and capacity of a batch, the score formula with a table of roles per thing,
 *                direction and limits of a choice, the two linear costs of a break-even.
 * Assembly reuses arithmeticCircuit: registry values are stated, every formula is a session rule, goals are the queries; a choice is a
 * score formula instantiated per thing, ranked, with the limits as conditions. The validator is the connectability check.
 * Every reading is structural (indices, menus, arithmetic); nothing interprets the user's words.
 */
import {readChoice} from './answers.mjs';
import {extractNumbers, readThings, renderRegistry, registry as makeRegistry} from '../../formalize/registry.mjs';

const strip = text => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*|`/g, '').trim();
const lines = text => strip(text).split('\n').map(s => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
const choicesOf = (data, q) => data.rows('choice').filter(r => r[0] === q).map(([, n, value]) => ({n, value, text: data.rows('choice_text').find(r => r[0] === q && r[1] === n)?.[2] ?? String(value)})).sort((a, b) => a.n - b.n);

export {extractNumbers} from '../../formalize/registry.mjs';

/** `vK: label | thing` lines → Map index → label (lines by index only; an index outside the registry is ignored). */
export function readLabels(text, n) {
  const out = new Map();
  for (const line of lines(text)) {
    const m = /^v(\d+)\s*[:=-]\s*(.+)$/i.exec(line);
    if (!m) continue;
    const k = Number(m[1]);
    if (k >= 1 && k <= n && !out.has(k)) out.set(k, m[2].trim().slice(0, 80));
  }
  return out.size ? out : null;
}

/** `gK: what | kind-number` lines → [{k, what, kind}] with the kind from the closed goal-kind menu. */
export function readGoals(text, kinds) {
  const out = [];
  for (const line of lines(text)) {
    const m = /^g(\d+)\s*[:=-]\s*(.+?)\s*\|\s*(.+)$/i.exec(line);
    if (!m) continue;
    const n = readChoice(m[3], kinds.length);
    const kind = n ? kinds[n - 1].value : kinds.find(k => m[3].toLowerCase().includes(String(k.text).toLowerCase()))?.value;
    if (kind) out.push({k: out.length + 1, what: m[2].trim().slice(0, 80), kind});
  }
  return out.length ? out.slice(0, 4) : null;
}

/** `role = vK, role = vK` pairs → {role: index} (indices of the registry only). */
function readPairs(text, n, slug) {
  const out = {};
  for (const m of strip(text).matchAll(/([A-Za-z_][\w]*)\s*[=:]\s*v(\d+)\b/g)) { const k = Number(m[2]); if (k >= 1 && k <= n) out[slug(m[1])] = k; }
  return Object.keys(out).length ? out : null;
}

/**
 * The decomposition questions and the circuit. Returns {sop, report} or null (nothing this stage can model: the caller falls back).
 * `ask(q, vars, reader, tokens)` is the problem questions' reader with re-ask; `data` the protocol data.
 */
export async function decomposeCircuit({ask, message, lexicon, data, writer}) {
  const {readFormulas, arithmeticCircuit, slug} = writer;
  const reg = makeRegistry(message, {window: data.one('registry_window', 'words') ?? 10});
  const registry = reg.numbers;
  if (!registry.length) return null;
  const registryText = renderRegistry(reg).numbersWithContext;
  const labels = await ask('dc_registry', {registry: registryText}, t => readLabels(t, registry.length)) ?? new Map();
  const vname = k => `v${k}${labels.get(k) && !/^irrelevant/i.test(labels.get(k)) ? `_${slug(labels.get(k).split('|')[0]).slice(0, 24)}` : ''}`.replace(/_+$/, '');
  const labelled = registry.map(v => `v${v.index} = ${v.span.trim()}${labels.get(v.index) ? `: ${labels.get(v.index)}` : ''}`).join('\n');
  const kinds = choicesOf(data, 'dc_goals');
  const goals = await ask('dc_goals', {numbers: labelled}, t => readGoals(t, kinds));
  if (!goals) return null;
  const things = goals.some(g => g.kind === 'which') ? await ask('dc_things', {}, t => readThings(t, message)) ?? [] : [];
  // Names in formulas: vK is written by index and becomes the registry name; gK the goal's name; other names are intermediate values.
  const gname = g => `g${g.k}_${slug(g.what).slice(0, 24)}`.replace(/_+$/, '');
  const values = registry.map(v => ({name: vname(v.index), value: v.value}));
  const rename = (text, extra = {}) => String(text).replace(/\bv(\d+)\b/gi, (w, k) => (Number(k) >= 1 && Number(k) <= registry.length ? vname(Number(k)) : w))
    .replace(/\bg(\d+)\b/gi, (w, k) => extra[`g${k}`] ?? w);
  const formulas = [], asked = [], report = {registry: registry.length, labelled: labels.size, goals: goals.map(g => g.kind), types: [], skipped: []};
  let options = [], direction = null;
  const known = () => [...values.map(v => v.name), ...formulas.map(f => f.name)];
  for (const g of goals) {
    const menu = data.rows('ptype_kind').filter(r => r[1] === g.kind).map(r => r[0]);
    const types = choicesOf(data, 'dc_type').filter(c => menu.includes(c.value));
    if (!types.length) { report.skipped.push(`g${g.k}:${g.kind}`); continue; }
    const type = types.length === 1 ? types[0].value : (await ask('dc_type', {goal: `g${g.k}: ${g.what}`, menu: types.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}, t => { const n = readChoice(t, types.length); return n ? types[n - 1].value : null; }));
    if (!type) { report.skipped.push(`g${g.k}:type`); continue; }
    report.types.push(type);
    const name = gname(g), vars = {goal: `g${g.k}: ${g.what}`, k: g.k, numbers: labelled};
    const lineSet = (q, extra = {}) => ask(q, {...vars, ...extra}, t => {
      const read = readFormulas(rename(t, {[`g${g.k}`]: name}), known());
      return read?.some(f => f.name === slug(name)) ? read : null;
    });
    if (type === 'chain' || type === 'check') {
      const read = await lineSet(type === 'chain' ? 'dc_chain' : 'dc_check');
      if (!read) { report.skipped.push(`g${g.k}:${type}`); continue; }
      formulas.push(...read); asked.push(slug(name));
    } else if (type === 'batch' || type === 'breakeven') {
      const pairs = await ask(type === 'batch' ? 'dc_batch' : 'dc_breakeven', vars, t => {
        const p = readPairs(t, registry.length, slug);
        return p && (type === 'batch' ? p.amount && p.capacity : p.fixed1 && p.per1 && p.fixed2 && p.per2) ? p : null;
      });
      if (!pairs) { report.skipped.push(`g${g.k}:${type}`); continue; }
      const v = k => vname(pairs[k]);
      const body = type === 'batch' ? (pairs.parallel ? `ceil(ceil(${v('amount')} / ${v('capacity')}) / ${v('parallel')})` : `ceil(${v('amount')} / ${v('capacity')})`)
        : `(${v('fixed2')} - ${v('fixed1')}) / (${v('per1')} - ${v('per2')})`;
      const read = readFormulas(`${name} = ${body}`, known());
      if (!read) { report.skipped.push(`g${g.k}:${type}`); continue; }
      formulas.push(...read); asked.push(slug(name));
    } else if (type === 'choose') {
      if (things.length < 2) { report.skipped.push(`g${g.k}:things`); continue; }
      const thingList = things.map((t, i) => `e${i + 1} ${t}`).join(', ');
      const score = await ask('dc_choose_formula', {...vars, things: thingList}, t => {
        const m = lines(t).map(l => /^([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(l)).find(Boolean);
        if (!m) return null;
        const roles = [...new Set((m[2].match(/[A-Za-z_][\w]*/g) ?? []).filter(w => !['round', 'ceil', 'floor', 'max', 'min'].includes(w.toLowerCase())).map(slug))];
        return roles.length ? {name: m[1], expr: m[2], roles} : null;
      });
      if (!score) { report.skipped.push(`g${g.k}:formula`); continue; }
      // A limit may name the score itself (`cost <= v7` for the score `cost = ...`): it stands for the score's formula.
      const limits = (await ask('dc_choose_limit', {...vars, roles: [score.name, ...score.roles].join(', ')}, t => (/^\s*none\b/i.test(strip(t)) ? [] : lines(t).filter(l => /[<>]=?|==|!=/.test(l)))) ?? [])
        .map(l => l.replace(new RegExp(`\\b${score.name}\\b`, 'g'), `(${score.expr})`));
      const roles = [...new Set([...score.roles, ...limits.flatMap(l => (l.match(/[A-Za-z_][\w]*/g) ?? []).filter(w => !/^v\d+$/i.test(w) && !['and', 'round', 'ceil', 'floor', 'max', 'min'].includes(w.toLowerCase())).map(slug))])];
      const table = await ask('dc_choose_table', {...vars, things: thingList, formula: [score.expr, ...limits].join('; '), example: `${things[0]}: ${roles.map((r, i) => `${r} = v${i + 1}`).join(', ')}`}, t => {
        const rows = new Map();
        for (const line of lines(t)) {
          const at = line.indexOf(':');
          if (at < 0) continue;
          const head = line.slice(0, at).replace(/^e(\d+)\b\s*/i, (w, k) => things[Number(k) - 1] ? `${things[Number(k) - 1]} ` : w).trim().toLowerCase();
          const thing = things.find(x => x.toLowerCase() === head || head.includes(x.toLowerCase()));
          const pairs = readPairs(line.slice(at + 1), registry.length, slug);
          if (thing && pairs && roles.every(r => pairs[r])) rows.set(thing, pairs);
        }
        return rows.size === things.length ? rows : null;
      });
      if (!table) { report.skipped.push(`g${g.k}:table`); continue; }
      const dir = choicesOf(data, 'dc_choose_direction');
      direction = await ask('dc_choose_direction', vars, t => { const n = readChoice(t, dir.length); return n ? dir[n - 1].value : null; }) ?? 'lowest';
      options = [];
      for (const thing of things) {
        const pairs = table.get(thing), sub = expr => expr.replace(/[A-Za-z_][\w]*/g, w => pairs[slug(w)] ? vname(pairs[slug(w)]) : w);
        const sname = `score_${slug(thing)}`.slice(0, 40);
        const read = readFormulas(`${sname} = ${rename(sub(score.expr))}`, known());
        if (!read) { options = []; break; }
        formulas.push(...read);
        const requires = [];
        limits.forEach((l, i) => { const ok = readFormulas(`ok${i + 1}_${slug(thing)}`.slice(0, 40) + ` = ${rename(sub(l))}`, known()); if (ok) { formulas.push(...ok); requires.push(ok[0].name); } });
        options.push({option: thing, value: sname, requires});
      }
      if (!options.length) report.skipped.push(`g${g.k}:instantiate`);
    }
  }
  if (!asked.length && !options.length) return null;
  return {sop: arithmeticCircuit({values, formulas, options, direction: options.length ? direction : null, asked, lexicon, onlyAsked: true}), report: {kind: 'decompose', ...report}};
}

