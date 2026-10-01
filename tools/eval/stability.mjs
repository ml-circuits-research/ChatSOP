#!/usr/bin/env node
/**
 * Incremental stability check (DS016 "Natural input and the stability check", owner request 2026-10-01): is the analysis of a long message stable
 * when it grows one sentence at a time? CPU only, no model beyond Stanza.
 *
 *   node tools/eval/stability.mjs run [--natural N] [--decomposition N] [--max-sentences M] [--out DIR]
 *
 * Groups: long owner messages after cleaning (the `clean` field of eval/reports/current/natural/run.jsonl, four or more sentences) and long rows of the
 * decomposition suite (the expected decomposition of rows with four or more sentences, joined by spaces). For every group and every prefix of k = 1..n
 * host sentences (lib/sentence-split.mjs, the prefix is a slice of the text) SymbolicLM parses the whole prefix (Stanza accurate, maskMessage, the rules
 * convertParse) and, for every host sentence i, records
 *   tree   the tokens [form, lemma, upos, head, deprel] of the Stanza sentences inside the host sentence (and whether Stanza cut it differently),
 *   wires  the SOP wires whose origin `pos` lies inside the sentence, canonical (own id dropped, `$ref` replaced by the relation it points to).
 * Instability = for an earlier sentence i < k, a signature at prefix k that differs from the one at prefix k-1 (adjacent) or from the one when the
 * sentence is analysed alone. Cause of a change, first match: segmentation (Stanza's sentence cuts inside i differ), stanza_context (same cuts, other
 * tokens or tree), rules_whole_message (the outcome of the whole prefix changed class: converted, unclear, fallback), coreference (only the assumed
 * `refer to` wires differ), rules_other (any other wire change). Writes records.jsonl and summary.md/summary.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {createSymbolicLM, compactAnalysis} from '../../lib/symbolic-lm/index.mjs';
import {convertParse, maskMessage, emitWire} from '../../lib/ud-to-sop/index.mjs';
import {readJsonl, writeJsonl} from './severity-local.mjs';

const OUT = path.join(ROOT, 'eval/reports/current/stability');
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

/** Canonical text of a wire: its own id dropped, `$id` references replaced by the relation they point to. */
export function canonWires(wires) {
  const rel = new Map(wires.map(w => [w.id, w.relation ?? w.type]));
  return wires.map(w => ({wire: w, canon: emitWire(w).replace(/^@\S+/, '@').replace(/\$([A-Za-z][A-Za-z0-9_]*)/g, (m, id) => `$<${rel.get(id) ?? id}>`).replace(/\s+/g, ' ').trim()}));
}

/** Per host sentence of `text`: {tree, cuts, wires}. `units` are the host sentences of `text`. */
export async function analyseText(lm, text, units) {
  const {parse} = await lm.parse(maskMessage(text), 'en');
  const converted = convertParse(parse, text);
  const analysis = compactAnalysis(parse, {language: 'en'});
  const wires = canonWires(converted.wires ?? []);
  const per = units.map(u => {
    const inside = analysis.sentences.filter(s => s.start >= u.start - 1 && s.end <= u.end + 1);
    const straddle = analysis.sentences.some(s => s.start < u.end && s.end > u.start && !(s.start >= u.start - 1 && s.end <= u.end + 1));
    const tree = inside.map(s => s.tokens.map(t => [t[1], t[2], t[3], t[4], t[5]]));
    const w = wires.filter(x => x.wire.pos !== undefined && x.wire.pos >= u.start - 1 && x.wire.pos < u.end);
    return {tree: JSON.stringify(tree), cuts: inside.length + (straddle ? '*' : ''), straddle, wires: w.map(x => x.canon).sort(), assumedOnly: w.map(x => x.wire.type)};
  });
  return {outcome: converted.outcome, valid: converted.valid, per, sop: converted.sop, wire_count: wires.length, unplaced: wires.filter(x => x.wire.pos === undefined).length};
}

const wireDiff = (a, b) => ({removed: a.wires.filter(x => !b.wires.includes(x)).map(x => x.slice(0, 160)).slice(0, 3), added: b.wires.filter(x => !a.wires.includes(x)).map(x => x.slice(0, 160)).slice(0, 3)});
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Cause of a change between two signatures of one sentence (`a` earlier, `b` later) given the outcome classes of the two analyses. */
export function causeOf(a, b, oa, ob) {
  if (a.cuts !== b.cuts || a.straddle !== b.straddle) return 'segmentation';
  if (a.tree !== b.tree) return 'stanza_context';
  if (sameArr(a.wires, b.wires)) return null;
  if (oa !== ob) return 'rules_whole_message';
  const diff = [...a.wires.filter(x => !b.wires.includes(x)), ...b.wires.filter(x => !a.wires.includes(x))];
  if (diff.length && diff.every(x => /relation "refer to"/.test(x) || /^@ assumed relation "refer to"/.test(x))) return 'coreference';
  return 'rules_other';
}

async function groupRecords(lm, group) {
  const units = splitSentences(group.text);
  const n = units.length;
  const alone = [];
  for (const u of units) { const r = await analyseText(lm, u.text, [{start: 0, end: u.text.length}]); alone.push({...r.per[0], outcome: r.outcome}); }
  const prefixes = [];
  for (let k = 1; k <= n; k++) {
    const text = group.text.slice(0, units[k - 1].end);
    const r = await analyseText(lm, text, units.slice(0, k));
    prefixes.push(r);
  }
  const records = [];
  for (let k = 2; k <= n; k++) for (let i = 1; i < k; i++) {
    const cur = prefixes[k - 1].per[i - 1], prev = prefixes[k - 2].per[i - 1], one = alone[i - 1];
    const adj = causeOf(prev, cur, prefixes[k - 2].outcome, prefixes[k - 1].outcome);
    const vsAlone = causeOf(one, cur, one.outcome, prefixes[k - 1].outcome);
    records.push({group: group.id, corpus: group.corpus, n, k, i, changed_adjacent: Boolean(adj), cause_adjacent: adj, changed_vs_alone: Boolean(vsAlone), cause_vs_alone: vsAlone,
      tree_changed_adjacent: prev.tree !== cur.tree, tree_changed_vs_alone: one.tree !== cur.tree, wires_changed_adjacent: !sameArr(prev.wires, cur.wires), wires_changed_vs_alone: !sameArr(one.wires, cur.wires),
      ...(adj ? {diff_adjacent: wireDiff(prev, cur), outcome_before: prefixes[k - 2].outcome, outcome_after: prefixes[k - 1].outcome} : {}), ...(vsAlone ? {diff_vs_alone: wireDiff(one, cur), outcome_alone: one.outcome} : {}),
      sentence: units[i - 1].text, pronoun: /\b(he|she|it|they|him|her|them|his|its|their|this|that|these|those)\b/i.test(units[i - 1].text)});
  }
  const finals = prefixes.at(-1);
  const wholeOutcomes = prefixes.map(p => p.outcome);
  return {records, summary: {id: group.id, corpus: group.corpus, sentences: n, outcomes: wholeOutcomes, outcome_changes: wholeOutcomes.filter((o, j) => j && o !== wholeOutcomes[j - 1]).length, unplaced_wires: finals.unplaced, text: group.text.slice(0, 160)}};
}

const pct = (k, n) => (n ? `${k}/${n} = ${(100 * k / n).toFixed(1)}%` : 'n/a');

async function run(o) {
  const maxS = Number(o['max-sentences'] ?? 14), nNat = Number(o.natural ?? 20), nDec = Number(o.decomposition ?? 20);
  const out = path.resolve(o.out ?? OUT);
  const runFile = path.join(ROOT, 'eval/reports/current/natural/run.jsonl');
  const nat = readJsonl(fs.existsSync(runFile) ? runFile : path.join(ROOT, 'eval/reports/current/natural/run.partial.jsonl'))
    .map(r => ({id: r.id, corpus: 'natural (clean English)', text: r.clean, n: splitSentences(r.clean).length})).filter(g => g.n >= 4 && g.n <= maxS).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)).slice(0, nNat);
  const dec = readJsonl(path.join(ROOT, 'eval/suites/decomposition/test.jsonl')).filter(r => r.expected.length >= 4)
    .map(r => ({id: r.id, corpus: 'decomposition (expected decomposition)', text: r.expected.join(' '), n: r.expected.length})).filter(g => splitSentences(g.text).length >= 4).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)).slice(0, nDec);
  const lm = await createSymbolicLM({device: process.env.CHATSOP_UD_DEVICE ?? 'cpu'});
  const records = [], groups = [];
  try {
    for (const g of [...nat, ...dec]) {
      const r = await groupRecords(lm, g);
      records.push(...r.records); groups.push(r.summary);
      console.log(`${g.corpus.split(' ')[0]} ${g.id}: ${r.summary.sentences} sentences, ${r.records.filter(x => x.changed_adjacent).length}/${r.records.length} adjacent changes`);
    }
  } finally { await lm.stop(); }
  fs.mkdirSync(out, {recursive: true});
  writeJsonl(path.join(out, 'records.jsonl'), records);
  writeJsonl(path.join(out, 'groups.jsonl'), groups);
  summarize(records, groups, out);
}

const PRONOUN_ROLE = /role \w+ "(?:it|he|she|they|him|her|them|this|that|these|those)"/i;

/** Refines a rules cause with what the stored diff and the whole-prefix outcomes show: admission_fallback (a later sentence made the program inadmissible and wires were dropped), no_content_collapse (a text with no content sentence yet is `unclear`), coreference (a pronoun resolved differently, or a `refer to` link that only the context has). */
export function refine(cause, diff, outcomeA, outcomeB) {
  if (cause !== 'rules_whole_message' && cause !== 'rules_other') return cause;
  if (outcomeA === 'fallback' || outcomeB === 'fallback') return 'admission_fallback';
  if (outcomeA !== 'converted' || outcomeB !== 'converted') return 'no_content_collapse';
  const lines = [...(diff?.removed ?? []), ...(diff?.added ?? [])];
  if (lines.length && lines.every(x => /relation "refer to"/.test(x))) return 'coreference';
  if (diff?.removed?.length && diff.removed.length === diff.added.length && lines.some(x => PRONOUN_ROLE.test(x))) return 'coreference';
  return 'rules_other';
}

export function summarize(records, groups, out) {
  const outcomes = new Map(groups.map(g => [g.id, g.outcomes]));
  for (const r of records) {
    if (r.changed_adjacent) r.cause_adjacent = refine(r.cause_adjacent, r.diff_adjacent, r.outcome_before, r.outcome_after);
    if (r.changed_vs_alone) r.cause_vs_alone = refine(r.cause_vs_alone, r.diff_vs_alone, r.outcome_alone, outcomes.get(r.group)?.[r.k - 1]);
  }
  fs.mkdirSync(out, {recursive: true});
  writeJsonl(path.join(out, 'records.jsonl'), records);
  const corpora = [...new Set(records.map(r => r.corpus))];
  const stat = rs => {
    const causes = (key) => Object.fromEntries(Object.entries(rs.filter(r => r[key]).reduce((a, r) => (a[r[key]] = (a[r[key]] ?? 0) + 1, a), {})).sort((a, b) => b[1] - a[1]));
    const sents = new Set(rs.map(r => `${r.group}|${r.i}`)), changedSents = new Set(rs.filter(r => r.changed_adjacent).map(r => `${r.group}|${r.i}`)), changedAlone = new Set(rs.filter(r => r.changed_vs_alone).map(r => `${r.group}|${r.i}`));
    const pron = rs.filter(r => r.pronoun), nonPron = rs.filter(r => !r.pronoun);
    return {pairs: rs.length, groups: new Set(rs.map(r => r.group)).size, sentences: sents.size,
      adjacent: {changed: rs.filter(r => r.changed_adjacent).length, tree: rs.filter(r => r.tree_changed_adjacent).length, wires: rs.filter(r => r.wires_changed_adjacent).length, sentences_ever_changed: changedSents.size, causes: causes('cause_adjacent')},
      alone: {changed: rs.filter(r => r.changed_vs_alone).length, tree: rs.filter(r => r.tree_changed_vs_alone).length, wires: rs.filter(r => r.wires_changed_vs_alone).length, sentences_ever_changed: changedAlone.size, causes: causes('cause_vs_alone'),
        pronoun_sentence_pairs: pron.length, pronoun_changed: pron.filter(r => r.changed_vs_alone).length, nonpronoun_changed: nonPron.filter(r => r.changed_vs_alone).length, nonpronoun_pairs: nonPron.length}};
  };
  const summary = {generated_at: new Date().toISOString(), method: 'prefixes of k = 1..n host sentences analysed whole; earlier sentence i < k compared at prefix k against prefix k-1 and against the sentence alone', all: stat(records), by_corpus: Object.fromEntries(corpora.map(c => [c, stat(records.filter(r => r.corpus === c))])),
    groups: groups.map(g => ({id: g.id, corpus: g.corpus, sentences: g.sentences, outcome_changes: g.outcome_changes, outcomes: [...new Set(g.outcomes)]}))};
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  const md = ['# Incremental stability: analysing a long message one sentence at a time (CPU)', '', `Generated ${summary.generated_at}. Pairs are (earlier sentence i, added sentence k > i); a pair is unstable when the analysis of sentence i at prefix k differs from its analysis at prefix k-1 (adjacent) or from its analysis alone.`, ''];
  for (const [name, s] of [['all', summary.all], ...Object.entries(summary.by_corpus)]) {
    md.push(`## ${name}`, '', `Groups ${s.groups}, sentences ${s.sentences}, (i, k) pairs ${s.pairs}.`, '',
      '| comparison | unstable pairs | tree changed | wires changed | sentences ever changed |', '| --- | --- | --- | --- | --- |',
      `| vs the previous prefix (sentence k-1 absent) | ${pct(s.adjacent.changed, s.pairs)} | ${pct(s.adjacent.tree, s.pairs)} | ${pct(s.adjacent.wires, s.pairs)} | ${pct(s.adjacent.sentences_ever_changed, s.sentences)} |`,
      `| vs the sentence analysed alone | ${pct(s.alone.changed, s.pairs)} | ${pct(s.alone.tree, s.pairs)} | ${pct(s.alone.wires, s.pairs)} | ${pct(s.alone.sentences_ever_changed, s.sentences)} |`, '',
      `Causes (adjacent): ${JSON.stringify(s.adjacent.causes)}`, '', `Causes (against alone): ${JSON.stringify(s.alone.causes)}; pairs of sentences with a pronoun or demonstrative that changed against alone: ${pct(s.alone.pronoun_changed, s.alone.pronoun_sentence_pairs)}; others: ${pct(s.alone.nonpronoun_changed, s.alone.nonpronoun_pairs)}`, '');
  }
  md.push('## Groups', '', '| group | corpus | sentences | whole-prefix outcome classes | outcome class changes |', '| --- | --- | ---: | --- | ---: |', ...summary.groups.map(g => `| ${g.id} | ${g.corpus.split(' ')[0]} | ${g.sentences} | ${g.outcomes.join(', ')} | ${g.outcome_changes} |`), '');
  fs.writeFileSync(path.join(out, 'tables.md'), md.join('\n') + '\n');
  console.log(md.slice(0, 30).join('\n'));
}

function report(o) {
  const out = path.resolve(o.out ?? OUT);
  summarize(readJsonl(path.join(out, 'records.jsonl')), readJsonl(path.join(out, 'groups.jsonl')), out);
}


if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [cmd, ...rest] = process.argv.slice(2), o = args(rest);
  if (cmd === 'report') report(o);
  else if (cmd === 'run') await run(o);
  else { console.error('usage: run [--natural N] [--decomposition N] [--max-sentences M] [--out DIR] | report [--out DIR]'); process.exit(2); }
  process.exit(0);
}
