#!/usr/bin/env node
/** Oracle simple-text samples for the "neural simplifier + symbolic NLP" study (DS022 "Simple-text rendering").
 *
 * For stratified samples of the sealed test and OOD suites the simple text is rendered from each row's surface IR;
 * the wild suite has no IR, so its gold SOP target is parsed back into a surface IR and rendered the same way (a
 * fair oracle for an upper bound: the text carries exactly the gold content). Output: one JSONL per suite in
 * eval/reports/current/simplifier/oracle/ with {id, suite, language, family, message, simple_text, lines,
 * source: 'surface_ir'|'gold_sop', kind, fallbacks}. Verification scaffolding only, never model input.
 *
 *   node tools/research/simplifier-oracle.mjs [--test 500] [--ood 500] [--wild all] [--out DIR]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSimpleText } from '../datasets/diversity/simple-text.mjs';
import { hash32 } from '../datasets/diversity/text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const load = suite => fs.readFileSync(path.join(ROOT, 'eval/suites', suite, 'test.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));

/** Stratified deterministic sample: proportional allocation over language × family, at least one per stratum. */
export function stratified(rows, n, key = r => `${r.language}|${r.family}`) {
  if (!Number.isFinite(n) || n >= rows.length) return rows;
  const strata = new Map();
  for (const r of rows) { const k = key(r); if (!strata.has(k)) strata.set(k, []); strata.get(k).push(r); }
  const order = r => hash32(`simplifier-oracle:${r.id}`);
  const picked = [];
  const quotas = [...strata].map(([k, list]) => [k, list, Math.max(1, Math.round((list.length / rows.length) * n))]);
  for (const [, list, quota] of quotas) picked.push(...[...list].sort((a, b) => order(a) - order(b)).slice(0, quota));
  const ids = new Set(picked.map(r => r.id));
  return rows.filter(r => ids.has(r.id)).sort((a, b) => order(a) - order(b)).slice(0, n);
}

// ---------------------------------------------------------------- gold SOP → surface IR (wild suite)
const tokens = line => line.match(/"(?:\\.|[^"\\])*"|\S+/g) ?? [];
/** Fold nested `all`/`any` … `end` expression groups (compare / require) into single token lines. */
function foldGroups(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if ((t[0] === 'compare' || t[0] === 'require') && t.length === 2 && (t[1] === 'any' || t[1] === 'all')) {
      const read = (start, op) => { const items = []; let j = start; while (j < lines.length && lines[j][0] !== 'end') { const u = lines[j]; if (u.length === 1 && (u[0] === 'any' || u[0] === 'all')) { const [inner, next] = read(j + 1, u[0]); items.push(inner); j = next + 1; } else { items.push({ leaf: u }); j++; } } return [{ op, items }, j]; };
      const [group, end] = read(i + 1, t[1]);
      out.push([t[0], { group }]);
      i = end;
    } else out.push(t);
  }
  return out;
}
const groupWords = g => g.leaf ? g.leaf.map(w => w.replace(/^\?/, '')).join(' ') : `(${g.items.map(groupWords).join(g.op === 'any' ? ' or ' : ' and ')})`;
/** Parse a model-surface SOP program (DS021) into the surface-IR shape the renderer reads. */
export function sopToSurface(source) {
  const ir = { stated: [], assumed: [], unclear: null, query: null, moreQueries: [], constraint: null };
  const blocks = source.split(/\n(?=@)/).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const [head, ...body] = block.split('\n');
    const type = head.trim().split(/\s+/)[1];
    const lines = foldGroups(body.map(l => tokens(l.trim())).filter(t => t.length));
    if (type === 'unclear') {
      ir.unclear = { kind: lines.find(t => t[0] === 'kind')?.[1], readings: lines.filter(t => t[0] === 'reading').map(t => t[1]) };
      if (!ir.unclear.readings.length) delete ir.unclear.readings;
      continue;
    }
    if (type === 'stated' || type === 'assumed') {
      const p = { roles: [], polarity: 'affirmed' };
      for (const t of lines) {
        if (t[0] === 'relation') p.relation = JSON.parse(t[1]);
        else if (t[0] === 'role') p.roles.push([t[1], t[2]]);
        else if (t[0] === 'polarity') p.polarity = t[1];
        else if (t[0] === 'certainty') p.certainty = t[1];
        else if (t[0] === 'speaker') p.speaker = t[1];
        else if (t[0] === 'basis') p.basis = t[1];
        else if (t[0] === 'valid') (p.valid ??= {})[t[1]] = t[2];
      }
      (type === 'stated' ? ir.stated : ir.assumed).push(p);
      continue;
    }
    if (type === 'constraint') {
      const c = { vars: [], require: [], claim: '', task: 'possible' };
      for (const t of lines) {
        if (t[0] === 'var') c.vars.push([t[1], t[3], t[4]]);
        else if (t[0] === 'require') c.require.push(t[1]?.group ? `one of ${groupWords(t[1].group)}` : t.slice(1).join(' '));
        else if (t[0] === 'claim') c.claim = t.slice(1).join(' ');
        else if (t[0] === 'task') c.task = t[1];
      }
      // Several constraint wires: the first is the constraint, the rest are rendered as extra conditions.
      if (ir.constraint) ir.constraint.require.push(...c.require, c.claim); else ir.constraint = c;
      continue;
    }
    if (type === 'query') {
      const q = { ask: 'whether', props: [], scope: [], select: [] };
      let target = null, current = null;
      for (const t of lines) {
        const k = t[0];
        if (k === 'where' || k === 'scope') { target = k === 'where' ? q.props : q.scope; if (t[1] === 'match') { current = { roles: [], polarity: 'affirmed' }; target.push(current); } else current = null; }
        else if (k === 'match') { current = { roles: [], polarity: 'affirmed' }; target.push(current); }
        else if (k === 'end') current = null;
        else if (current && k === 'relation') current.relation = JSON.parse(t[1]);
        else if (current && k === 'role') current.roles.push([t[1], t[2]]);
        else if (current && k === 'polarity') current.polarity = t[1];
        else if (k === 'select') q.select = t.slice(1);
        else if (k === 'mode') q.ask = { count: 'count', every: 'every', explain: 'explain', exists: 'whether' }[t[1]] ?? q.ask;
        else if (k === 'measure') q.measure = t[1];
        else if (k === 'except') (q.filter ??= []).push(`${t[1]} != ${t[2]}`);
        else if (k === 'compare' && t[1]?.group) {
          const leaves = t[1].group.items.filter(item => item.leaf).map(item => item.leaf);
          if (t[1].group.op === 'any' && leaves.every(l => l[1] === 'equal')) q.options = leaves.map(l => l[2]);
          else (q.compare ??= []).push(...leaves.map(l => [l[0], l[1], l[2]]));
        } else if (k === 'compare') (q.compare ??= []).push([t[1], t[2], t[3]]);
        else if (k === 'rank') q.rank = [t[1], t[2]];
        else if (k === 'order') q.order = [t[1], t[2], t[3]];
        else if (k === 'quantifier') q.quantifier = t.slice(1).join(' ');
        else if (k === 'fragment') q.fragment = t[1];
        else if (k === 'asof') q.asof = t[1];
        else if (k === 'at' || k === 'during') q.time = { [k]: t[1] };
      }
      if (q.select.length && q.ask === 'whether') q.ask = 'which';
      if (!q.scope.length) delete q.scope;
      if (!ir.query) ir.query = q; else ir.moreQueries.push(q);
    }
  }
  return ir;
}

function renderRow(row, suite) {
  const wild = suite === 'wild';
  const ir = wild ? sopToSurface(row.sop_target) : row.surface_ir;
  // Wild golds are English whatever the message language (Q-DATA-6), so their oracle text is English.
  const language = wild ? 'en' : row.language;
  const r = renderSimpleText(ir, { language, message: row.question, entities: row.verification_context?.entities ?? [] });
  return { id: row.id, suite, language: row.language, render_language: wild ? 'en' : (row.language === 'ro' ? 'ro' : 'en'), family: row.family, variant: row.variant ?? null, noise_level: row.noise_level ?? null,
    message: row.question, simple_text: r.text, lines: r.lines.length, kind: r.kind, fallbacks: r.fallbacks, source: wild ? 'gold_sop' : 'surface_ir' };
}

function main() {
  const out = path.resolve(ROOT, arg('out', 'eval/reports/current/simplifier/oracle'));
  fs.mkdirSync(out, { recursive: true });
  const plan = [['test', 'formalizer-v1', Number(arg('test', 500))], ['ood', 'formalizer-ood-v1', Number(arg('ood', 500))], ['wild', 'formalizer-wild-v1', arg('wild', 'all') === 'all' ? Infinity : Number(arg('wild'))]];
  const summary = {};
  for (const [suite, dir, n] of plan) {
    const rows = stratified(load(dir), n);
    const rendered = [], failures = [];
    for (const row of rows) { try { rendered.push(renderRow(row, suite)); } catch (error) { failures.push({ id: row.id, error: String(error.message ?? error) }); } }
    fs.writeFileSync(path.join(out, `${suite}.jsonl`), rendered.map(r => JSON.stringify(r)).join('\n') + '\n');
    const count = f => rendered.filter(f).length;
    summary[suite] = { suite: dir, rows: rows.length, rendered: rendered.length, failures: failures.length, failure_examples: failures.slice(0, 5), empty_no_request: count(r => r.kind === 'empty'), verbatim_gibberish: count(r => r.kind === 'verbatim'),
      rows_with_fallback_lines: count(r => r.fallbacks > 0), mean_lines: +(rendered.reduce((s, r) => s + r.lines, 0) / Math.max(1, rendered.length)).toFixed(2),
      mean_chars_message: Math.round(rendered.reduce((s, r) => s + r.message.length, 0) / Math.max(1, rendered.length)), mean_chars_simple: Math.round(rendered.reduce((s, r) => s + r.simple_text.length, 0) / Math.max(1, rendered.length)) };
  }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ generated: new Date().toISOString(), renderer: 'tools/datasets/diversity/simple-text.mjs', sampler: 'stratified language x family, hash32 order', suites: summary }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
