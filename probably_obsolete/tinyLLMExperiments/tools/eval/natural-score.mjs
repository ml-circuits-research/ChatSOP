#!/usr/bin/env node
/**
 * Pipeline success on the `natural` suite (datasets/natural, owner chat messages; DS016 "Natural input and the stability check"). CPU only.
 *
 *   node tools/eval/natural-score.mjs run --clean-url URL --rewrite-url URL [--limit N]   clean (LanguageProofingLLM) -> SymbolicLM -> interpretation -> gated rewrite; writes run.jsonl
 *   node tools/eval/natural-score.mjs pairs [--limit N]                                    judge folders (Grok, GLM) for "I understood" and the clean English against the ORIGINAL message
 *   node tools/eval/natural-score.mjs report [--limit N] [--out DIR]                       merges the judges, writes summary.json and summary.md
 *
 * Layers per message (what the chat does): textToCleanEnglish (sendAll, one sentence per call) -> SymbolicLM accurate analysis, certified when the default
 * and accurate Stanza trees are identical -> the gated SymbolicProofingLLM rewrite (rewriteWhen trees, accept certified, as `understanding.rewrite = gated`)
 * -> the interpretation "I understood" (lib/symbolic-lm/interpretation.mjs) of the final text. Severity: tools/eval/severity judge prompts, the ORIGINAL owner message
 * against the summary (and against the clean English for the proofing step alone). No local layer decides here (the originals are mostly Romanian, the
 * mechanical layers are English-only); every pair goes to the two judges. Where the judges disagree on S3/S4 the case is excusable ambiguity (owner rule).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {textToCleanEnglish} from '../../lib/text-to-clean-english/index.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {runRewritePipeline} from '../../lib/symbolic-lm/rewrite-gate.mjs';
import {interpretResult} from '../../lib/symbolic-lm/interpretation.mjs';
import {endpointRewriter, cachedRewriter} from './composed/rewriters.mjs';
import {readJsonl, writeJsonl} from './severity-local.mjs';
import {folderFromPairs, loadVerdicts} from './severity-judge.mjs';
import {pairId} from './severity-apply.mjs';
import {rank, SEVERITIES} from './severity/scale.mjs';
import {wilson} from './severity/metrics.mjs';
import {markers, understoodText} from './decomposition/metrics.mjs';

/** `NATURAL_WORK` names another report folder (a second arm, for example `eval/reports/current/natural-prod1`); judge verdicts are shared across folders by pair id. */
export const WORK = path.join(ROOT, process.env.NATURAL_WORK ?? 'eval/reports/current/natural');
const SUITE = path.join(ROOT, 'datasets/natural/messages.jsonl');
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
/** The finished records in suite order (the merged run.jsonl when it exists, else what the workers have appended so far). */
const runRows = () => { const f = path.join(WORK, 'run.jsonl'); if (fs.existsSync(f)) return readJsonl(f); const m = new Map(readJsonl(path.join(WORK, 'run.partial.jsonl')).map(r => [r.id, r])); return readJsonl(SUITE).map(r => m.get(r.id)).filter(Boolean); };
const rows = limit => readJsonl(SUITE).slice(0, limit ? Number(limit) : undefined);

const NEG_RO = /\b(nu|n-|niciun|nicio|nici|nimic|nimeni|fara|fără|niciodata|niciodată|deloc)\b|\bn-(?:am|ai|a|are|o|avem)\b/i;
const NEG_EN = /\b(not|no|never|without|nothing|nobody|none|neither|nor|cannot|can't|don't|doesn't|didn't|isn't|aren't|won't|wouldn't|shouldn't|couldn't|haven't|hasn't|hadn't)\b|n't\b/i;
const digitsOf = t => (String(t).match(/\d+(?:[.,]\d+)*/g) ?? []).map(x => x.replace(',', '.'));
/** Anchors an owner sentence carries that a faithful English version keeps verbatim: digit runs, code-like tokens (underscore, dot, slash, camelCase, ALLCAPS) and mid-sentence capitalised words. */
const namesOf = t => {
  const toks = String(t).split(/\s+/).map(x => x.replace(/^[("'“„\[]+|[)"'”.,;:!?\]]+$/g, '')).filter(Boolean);
  return toks.filter((x, i) => /[_/\\]|[a-z][A-Z]|^[A-Z]{2,}$|\.[a-z]{2,4}$/.test(x) || (i > 0 && /^\p{Lu}\p{Ll}{2,}/u.test(x))).filter(x => x.length > 2);
};

export function proofingChecks(original, clean) {
  const low = String(clean).toLowerCase();
  const numbers = digitsOf(original).every(d => digitsOf(clean).includes(d));
  const lost = namesOf(original).filter(n => !low.includes(n.toLowerCase().replace(/-(?:ul|ului|urile|uri|le|ii|a)$/, '')));
  const negation = NEG_RO.test(original) || NEG_EN.test(original) ? NEG_EN.test(clean) : !NEG_EN.test(clean) || NEG_EN.test(original);
  return {numbers, names: lost.length === 0, lost_names: lost, negation};
}

async function run(o) {
  const list = rows(o.limit);
  const cleanUrl = o['clean-url'], rewriteUrl = o['rewrite-url'];
  if (!cleanUrl || !rewriteUrl) throw Error('--clean-url and --rewrite-url are needed');
  const memoFile = path.join(WORK, 'cache/clean-sentences.jsonl');
  fs.mkdirSync(path.dirname(memoFile), {recursive: true});
  const memoCache = new Map(readJsonl(memoFile).map(r => [r.k, r.v]));
  const memo = async (parts, compute) => { const k = JSON.stringify(parts); if (memoCache.has(k)) return memoCache.get(k); const v = await compute(); memoCache.set(k, v); fs.appendFileSync(memoFile, JSON.stringify({k, v}) + '\n'); return v; };
  const cleanOptions = {backendOptions: {endpoint: cleanUrl}, partial: true, memo};
  const rewrite = cachedRewriter(endpointRewriter(rewriteUrl), path.join(WORK, 'cache/raw-rewrite.jsonl'));
  const lm = await createSymbolicLM({device: process.env.CHATSOP_UD_DEVICE ?? 'cpu'});
  // Several workers may share the partial file (`--offset K` starts at message K, wrapping; `--reverse` walks backwards): a message another worker finished is skipped.
  const partial = path.join(WORK, 'run.partial.jsonl');
  const doneIds = () => new Set(readJsonl(partial).map(r => r.id));
  let order = list.map((row, n) => ({row, n}));
  const k = Number(o.offset ?? 0) % Math.max(1, order.length);
  order = [...order.slice(k), ...order.slice(0, k)];
  if (o.reverse) order.reverse();
  const out = [];
  const inspect = unit => lm.inspectUnit(unit);
  try {
    for (const {row, n} of order) {
      if (doneIds().has(row.id)) continue;
      const t0 = Date.now();
      const rec = {id: row.id, words: row.words, input_sentences: splitSentences(row.message).length, message: row.message};
      // layer 1: textToCleanEnglish, whole message, plus every original sentence alone (memoized, so no second model call) for the sentence-level checks of the proofing step
      const whole = await textToCleanEnglish(row.message, cleanOptions);
      rec.clean = whole.clean; rec.clean_changed = whole.changed; rec.clean_failures = whole.failures?.length ?? 0;
      rec.proofing_sentences = [];
      for (const u of splitSentences(row.message)) {
        const one = await textToCleanEnglish(u.text, cleanOptions);
        rec.proofing_sentences.push({original: u.text, clean: one.clean, ...proofingChecks(u.text, one.clean)});
      }
      // layer 2: SymbolicLM certification of every sentence of the clean text (before any rewrite)
      const units = splitSentences(rec.clean);
      rec.clean_sentences = [];
      for (const u of units) { const f = await inspect(u.text); rec.clean_sentences.push({text: u.text, certified: f.certified === true, uncertain: Boolean(f.uncertain)}); }
      // layer 3: gated rewrite (trees, accept certified), then analysis and interpretation of the final text
      const rw = await runRewritePipeline(rec.clean, {split: splitSentences, inspect, rewrite, gate: 'trees', acceptance: 'certified'});
      rec.final = rw.text; rec.rewrite_sent = rw.units.filter(u => u.sent).length; rec.rewrite_accepted = rw.units.filter(u => u.accepted).length;
      rec.rewrite_units = rw.units.filter(u => u.sent).map(u => ({text: u.text, output: u.output, accepted: u.accepted, reasons: u.reasons}));
      const interpret = async text => {
        try { const result = await lm.analyze(text, {route: 'direct', language: 'auto'}); return await interpretResult(lm, result, {certify: true}); }
        catch (error) { return {available: false, reason: String(error.message).slice(0, 120), sentences: [], not_represented: []}; }
      };
      const pre = await interpret(rec.clean);
      const post = rw.text === rec.clean ? pre : await interpret(rw.text);
      const shape = i => ({available: Boolean(i.available), sentences: i.sentences?.length ?? 0, certified_sentences: (i.sentences ?? []).filter(s => s.certified === true).length, verified: (i.sentences ?? []).filter(s => s.status === 'verified').length,
        not_represented: [...new Set([...(i.not_represented ?? []), ...(i.sentences ?? []).flatMap(s => s.not_represented ?? [])])], sentences_with_gap: (i.sentences ?? []).filter(s => (s.not_represented ?? []).length).length, all_certified: i.certified === true, marked: markers(i).marked});
      rec.pre = shape(pre); rec.post = shape(post);
      rec.summary = understoodText(post); rec.status = (post.sentences ?? []).map(s => s.status);
      rec.ms = Date.now() - t0;
      out.push(rec);
      fs.appendFileSync(partial, JSON.stringify(rec) + '\n');
      if ((n + 1) % 10 === 0) console.log(`${n + 1}/${list.length} (${rec.ms} ms)`);
    }
  } finally { await lm.stop(); }
  const all = new Map(readJsonl(partial).map(r => [r.id, r]));
  const merged = list.map(r => all.get(r.id)).filter(Boolean);
  if (merged.length === list.length) writeJsonl(path.join(WORK, 'run.jsonl'), merged);
  console.log(JSON.stringify({this_worker: out.length, merged: merged.length, of: list.length}));
}

const GRADE = 'natural_grade';
const loadJudge = (j, stage) => { const n = `${GRADE}_${stage}_${j}`; return fs.existsSync(path.join(ROOT, 'datasets_sources', n, 'output/verdicts.jsonl')) ? loadVerdicts(n) : new Map(); };
const stagesPresent = () => fs.readdirSync(path.join(ROOT, 'datasets_sources')).map(n => new RegExp(`^${GRADE}_(\\w+)_grok$`).exec(n)?.[1]).filter(Boolean);
const judgeMap = j => new Map(stagesPresent().flatMap(s => [...loadJudge(j, s)]));

function allPairs(list) {
  const m = new Map();
  for (const r of list) for (const b of [r.summary, r.clean]) if (b?.trim()) { const p = {a: r.message, b}; m.set(pairId(p), {id: pairId(p), a: p.a, b: p.b}); }
  // stage s3: every original sentence against its own clean English (the proofing step alone, per sentence)
  for (const r of list) for (const u of r.proofing_sentences ?? []) if (u.clean?.trim()) { const p = {a: u.original, b: u.clean}; m.set(pairId(p), {id: pairId(p), a: p.a, b: p.b}); }
  return [...m.values()];
}

/** `pairs --stage s1|s2 [--limit N]`: folders for the pairs no earlier stage judged (stage s2 = everything not in s1). */
function pairs(o) {
  const list = runRows().slice(0, o.limit ? Number(o.limit) : undefined);
  const stage = o.stage ?? 's1';
  const have = new Set([...judgeMap('grok').keys()].filter(id => judgeMap('glm').has(id)));
  const todo = allPairs(list).filter(p => !have.has(p.id));
  writeJsonl(path.join(WORK, `grade/pairs-${stage}.jsonl`), todo);
  const folders = ['grok', 'glm'].map(j => folderFromPairs(`${GRADE}_${stage}_${j}`, todo));
  console.log(JSON.stringify({stage, pairs: todo.length, folders}));
}

const sevOf = (id, judges) => {
  const g = judges.grok.get(id) ?? null, z = judges.glm.get(id) ?? null;
  const up = g && z ? (rank(g) >= rank(z) ? g : z) : g ?? z, lo = g && z ? (rank(g) <= rank(z) ? g : z) : g ?? z;
  return {upper: up, lower: lo, grok: g, glm: z};
};
const share = (k, n) => ({k, n, rate: n ? k / n : null, ci: n ? wilson(k, n) : null});
const f = s => (s.rate === null ? 'n/a' : `${s.k}/${s.n} = ${(100 * s.rate).toFixed(1)}%`);
const wordCount = t => (String(t).match(/[\p{L}\p{N}']+/gu) ?? []).length;
/** A degenerate loop: the same 5-word sequence three or more times. */
const repeatsItself = t => { const w = String(t).toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [], seen = new Map(); for (let i = 0; i + 5 <= w.length; i++) { const k = w.slice(i, i + 5).join(' '); seen.set(k, (seen.get(k) ?? 0) + 1); if (seen.get(k) >= 3) return true; } return false; };
const band = w => (w < 15 ? '<15' : w <= 40 ? '15-40' : '>40');
const SEV_COLS = [...new Set([...SEVERITIES, 'NONE'])];
const BANDS = ['<15', '15-40', '>40'];

function report(o) {
  const list = runRows().slice(0, o.limit ? Number(o.limit) : undefined);
  const out = path.resolve(o.out ?? WORK);
  const judges = {grok: judgeMap('grok'), glm: judgeMap('glm')};
  const recs = list.map(r => {
    const s = r.summary?.trim() ? sevOf(pairId({a: r.message, b: r.summary}), judges) : {upper: 'NONE', lower: 'NONE', grok: 'NONE', glm: 'NONE'};
    const c = r.clean?.trim() ? sevOf(pairId({a: r.message, b: r.clean}), judges) : {upper: null, lower: null};
    return {...r, band: band(r.words), sev: s, cleanSev: c};
  });
  const sum = {generated_at: new Date().toISOString(), n: recs.length, judged_summary: recs.filter(r => r.sev.upper).length, judged_clean: recs.filter(r => r.cleanSev.upper).length};
  const groups = [['all', recs], ...BANDS.map(b => [b, recs.filter(r => r.band === b)])];
  const allSent = rs => rs.flatMap(r => r.clean_sentences);
  const sev3 = (r, w) => r.sev[w] && rank(r.sev[w]) >= 3;
  const cleanBad = (r, w) => r.cleanSev[w] && rank(r.cleanSev[w]) >= 3;
  const layer = {};
  for (const [name, rs] of groups) {
    const j = rs.filter(r => r.sev.upper), jc = rs.filter(r => r.cleanSev.upper);
    const ps = rs.flatMap(r => r.proofing_sentences);
    layer[name] = {
      messages: rs.length,
      clean_sentences: share(allSent(rs).filter(s => s.certified).length, allSent(rs).length),
      clean_messages_all_certified: share(rs.filter(r => r.clean_sentences.length && r.clean_sentences.every(s => s.certified)).length, rs.length),
      final_sentences: share(rs.reduce((a, r) => a + r.post.certified_sentences, 0), rs.reduce((a, r) => a + r.post.sentences, 0)),
      final_messages_all_certified: share(rs.filter(r => r.post.all_certified).length, rs.length),
      rewrite_sentences_sent: rs.reduce((a, r) => a + r.rewrite_sent, 0), rewrite_accepted: rs.reduce((a, r) => a + r.rewrite_accepted, 0),
      sentences_with_not_represented_span: share(rs.reduce((a, r) => a + r.post.sentences_with_gap, 0), rs.reduce((a, r) => a + r.post.sentences, 0)),
      messages_with_not_represented_span: share(rs.filter(r => r.post.not_represented.length).length, rs.length),
      messages_marked: share(rs.filter(r => r.post.marked).length, rs.length),
      proofing_sentences: ps.length, proofing_numbers_kept: share(ps.filter(p => p.numbers).length, ps.length), proofing_names_kept: share(ps.filter(p => p.names).length, ps.length), proofing_negation_kept: share(ps.filter(p => p.negation).length, ps.length),
      proofing_judged: jc.length,
      proofing_good_enough_upper: share(jc.filter(r => !cleanBad(r, 'upper')).length, jc.length), proofing_s4_upper: share(jc.filter(r => r.cleanSev.upper === 'S4').length, jc.length),
      proofing_firm_s3p: share(jc.filter(r => cleanBad(r, 'upper') && cleanBad(r, 'lower')).length, jc.length), proofing_excusable_s3p: share(jc.filter(r => cleanBad(r, 'upper') && !cleanBad(r, 'lower')).length, jc.length),
      summary_judged: j.length,
      summary_good_enough_upper: share(j.filter(r => !sev3(r, 'upper')).length, j.length), summary_good_enough_lower: share(j.filter(r => !sev3(r, 'lower')).length, j.length),
      summary_firm_s3p: share(j.filter(r => sev3(r, 'upper') && sev3(r, 'lower')).length, j.length), summary_excusable_s3p: share(j.filter(r => sev3(r, 'upper') && !sev3(r, 'lower')).length, j.length),
      summary_firm_s4: share(j.filter(r => r.sev.upper === 'S4' && r.sev.lower === 'S4').length, j.length), summary_excusable_s4: share(j.filter(r => r.sev.upper === 'S4' && r.sev.lower !== 'S4').length, j.length),
      summary_silent_firm_s3p: share(j.filter(r => sev3(r, 'upper') && sev3(r, 'lower') && !r.post.marked).length, j.length),
      summary_none: share(j.filter(r => r.sev.upper === 'NONE').length, j.length),
      distribution_upper: Object.fromEntries(SEV_COLS.map(s => [s, j.filter(r => r.sev.upper === s).length])),
      judge_agreement_exact: share(j.filter(r => r.sev.grok && r.sev.glm && r.sev.grok === r.sev.glm).length, j.filter(r => r.sev.grok && r.sev.glm).length),
    };
  }
  sum.layers = layer;
  // proofing per sentence (stage s3): the sentence judged against its own clean English, by the length of the original sentence
  const wcount = t => (String(t).match(/[\p{L}\p{N}']+/gu) ?? []).length;
  const sb = w => (w < 8 ? '<8' : w <= 20 ? '8-20' : w <= 40 ? '21-40' : '>40');
  const sent = recs.flatMap(r => (r.proofing_sentences ?? []).map(u => ({...u, sev: sevOf(pairId({a: u.original, b: u.clean}), judges), w: wcount(u.original)}))).filter(u => u.sev.upper);
  const good = (u, which) => !(rank(u.sev[which]) >= 3);
  sum.proofing_per_sentence = Object.fromEntries(['all', '<8', '8-20', '21-40', '>40'].map(b => { const us = b === 'all' ? sent : sent.filter(u => sb(u.w) === b); return [b, {sentences: us.length, good_enough_upper: share(us.filter(u => good(u, 'upper')).length, us.length), good_enough_lower: share(us.filter(u => good(u, 'lower')).length, us.length), s4_upper: share(us.filter(u => u.sev.upper === 'S4').length, us.length), firm_s3p: share(us.filter(u => !good(u, 'upper') && !good(u, 'lower')).length, us.length), excusable_s3p: share(us.filter(u => !good(u, 'upper') && good(u, 'lower')).length, us.length)}]; }));
  // failure types: derived from the facts of each record
  const types = {};
  const add = (t, r) => { (types[t] ??= []).push(r.id); };
  for (const r of recs) {
    if (r.clean_failures) add('clean_backend_failure', r);
    if (repeatsItself(r.clean)) add('proofing_repetition_loop', r);
    if (r.words >= 8 && wordCount(r.clean) > 1.8 * r.words) add('proofing_length_blowup', r);
    if (!r.summary?.trim()) add('no_interpretation', r);
    if (r.proofing_sentences.some(p => !p.numbers)) add('proofing_lost_number', r);
    if (r.proofing_sentences.some(p => !p.names)) add('proofing_lost_name_or_identifier', r);
    if (r.proofing_sentences.some(p => !p.negation)) add('proofing_negation_changed', r);
    if (r.cleanSev.upper && cleanBad(r, 'upper') && cleanBad(r, 'lower')) add('proofing_meaning_firm_s3plus', r);
    if (r.clean_sentences.some(s => !s.certified)) add('uncertified_sentence_after_clean', r);
    if (r.rewrite_sent && r.rewrite_accepted < r.rewrite_sent) add('rewrite_refused_or_failed', r);
    if (r.post.not_represented.length) add('not_represented_span', r);
    if (r.status.some(s => s !== 'verified')) add('interpretation_uncertain_sentence', r);
    if (r.sev.upper && sev3(r, 'upper') && sev3(r, 'lower')) add('summary_firm_s3plus', r);
    if (r.sev.upper && sev3(r, 'upper') && !sev3(r, 'lower')) add('summary_excusable_ambiguity', r);
    if (r.sev.upper && sev3(r, 'upper') && sev3(r, 'lower') && !r.post.marked) add('summary_silent_firm_s3plus', r);
  }
  sum.failure_types = Object.fromEntries(Object.entries(types).map(([k, v]) => [k, {messages: v.length, ids: v.slice(0, 8)}]));
  // worked examples: the worst firm failures first, then clean successes, then the excusable ambiguities
  const score = r => (r.sev.lower ? rank(r.sev.lower) : -1) * 10 + (r.sev.upper ? rank(r.sev.upper) : -1);
  const worst = [...recs].filter(r => r.sev.upper).sort((a, b) => score(b) - score(a) || b.words - a.words).slice(0, 5);
  const best = [...recs].filter(r => r.sev.upper && r.sev.upper === 'S0' && r.post.all_certified).sort((a, b) => b.words - a.words).slice(0, 2);
  const amb = [...recs].filter(r => r.sev.upper && sev3(r, 'upper') && !sev3(r, 'lower')).slice(0, 3);
  const ex = [...worst.map(r => ['worst', r]), ...best.map(r => ['good', r]), ...amb.map(r => ['excusable ambiguity', r])];
  sum.examples = ex.map(([k, r]) => ({kind: k, id: r.id, words: r.words, severity: {grok: r.sev.grok, glm: r.sev.glm}, clean_severity: {upper: r.cleanSev.upper, lower: r.cleanSev.lower}}));
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(sum, null, 1) + '\n');
  writeJsonl(path.join(out, 'graded.jsonl'), recs.map(({message, clean, final, summary, sev, cleanSev, ...rest}) => ({...rest, message, clean, final, summary, sev, cleanSev})));
  const md = [`# natural suite: pipeline success on the owner's chat messages (CPU)`, '', `Generated ${sum.generated_at}. Messages: ${sum.n}; judged summaries: ${sum.judged_summary}; judged clean English: ${sum.judged_clean}.`, ''];
  const t = (title, keys, fmtv = f) => { md.push(`### ${title}`, '', `| metric | ${groups.map(g => `${g[0]} words (n=${g[1].length})`).join(' | ')} |`, `| --- | ${groups.map(() => '---').join(' | ')} |`); for (const [label, key] of keys) md.push(`| ${label} | ${groups.map(g => fmtv(layer[g[0]][key])).join(' | ')} |`); md.push(''); };
  t('Layer by layer (rates; upper = the worse judge, lower = the milder)', [
    ['proofing: numbers kept (per sentence, mechanical)', 'proofing_numbers_kept'], ['proofing: names and identifiers kept (per sentence, mechanical)', 'proofing_names_kept'], ['proofing: negation presence kept (per sentence, mechanical)', 'proofing_negation_kept'],
    ['proofing: clean English good enough S0-S2 (upper)', 'proofing_good_enough_upper'], ['proofing: S4 (upper)', 'proofing_s4_upper'], ['proofing: firm S3+ (both judges)', 'proofing_firm_s3p'], ['proofing: excusable ambiguity S3+ (judges disagree)', 'proofing_excusable_s3p'],
    ['SymbolicLM: clean sentences certified', 'clean_sentences'], ['SymbolicLM: clean messages with every sentence certified', 'clean_messages_all_certified'],
    ['after gated rewrite: sentences certified', 'final_sentences'], ['after gated rewrite: messages fully certified', 'final_messages_all_certified'],
    ['interpretation: sentences with a not-represented span', 'sentences_with_not_represented_span'], ['interpretation: messages with a not-represented span', 'messages_with_not_represented_span'], ['interpretation: messages that mark something (gap, uncertain)', 'messages_marked'],
    ['"I understood" good enough S0-S2 (upper)', 'summary_good_enough_upper'], ['"I understood" good enough S0-S2 (lower)', 'summary_good_enough_lower'],
    ['"I understood" FIRM S3+ (both judges)', 'summary_firm_s3p'], ['"I understood" excusable ambiguity S3+ (judges disagree)', 'summary_excusable_s3p'],
    ['"I understood" FIRM S4', 'summary_firm_s4'], ['"I understood" excusable ambiguity S4', 'summary_excusable_s4'], ['FIRM S3+ with no marker (silent)', 'summary_silent_firm_s3p'], ['no interpretation (NONE)', 'summary_none'], ['judge agreement (exact severity)', 'judge_agreement_exact']]);
  if (sent.length) {
    md.push('### Proofing step alone, per sentence (each original sentence against its own clean English; upper = worse judge)', '', '| original sentence words | sentences | good enough S0-S2 (upper) | good enough (lower) | S4 (upper) | firm S3+ | excusable ambiguity S3+ |', '| --- | ---: | --- | --- | --- | --- | --- |');
    for (const [b, x] of Object.entries(sum.proofing_per_sentence)) md.push(`| ${b} | ${x.sentences} | ${f(x.good_enough_upper)} | ${f(x.good_enough_lower)} | ${f(x.s4_upper)} | ${f(x.firm_s3p)} | ${f(x.excusable_s3p)} |`);
    md.push('');
  }
  md.push('### Rewrite', '', `| | ${groups.map(g => g[0]).join(' | ')} |`, `| --- | ${groups.map(() => '---').join(' | ')} |`, `| sentences sent to SymbolicProofingLLM | ${groups.map(g => layer[g[0]].rewrite_sentences_sent).join(' | ')} |`, `| rewrites accepted (certified and mechanical meaning checks) | ${groups.map(g => layer[g[0]].rewrite_accepted).join(' | ')} |`, '');
  md.push('### Severity distribution of "I understood" (upper)', '', `| ${SEV_COLS.join(' | ')} |`, `| ${SEV_COLS.map(() => '---:').join(' | ')} |`, `| ${SEV_COLS.map(s => layer.all.distribution_upper[s]).join(' | ')} |`, '');
  md.push('### Failure types (messages)', '', '| type | messages | example ids |', '| --- | ---: | --- |', ...Object.entries(sum.failure_types).sort((a, b) => b[1].messages - a[1].messages).map(([k, v]) => `| ${k} | ${v.messages} | ${v.ids.slice(0, 3).join(', ')} |`), '');
  md.push('### Worked examples', '');
  for (const [k, r] of ex) md.push(`**${k}** ${r.id} (${r.words} words; Grok ${r.sev.grok}, GLM ${r.sev.glm}; clean English upper ${r.cleanSev.upper ?? '-'})`, '', `- original: ${JSON.stringify(r.message.slice(0, 500))}`, `- clean English: ${JSON.stringify(r.clean.slice(0, 500))}`, `- final text: ${JSON.stringify(r.final === r.clean ? '(unchanged)' : r.final.slice(0, 500))}`, `- I understood: ${JSON.stringify(r.summary.slice(0, 500))}`, `- not represented: ${JSON.stringify(r.post.not_represented.slice(0, 6))}`, '');
  fs.writeFileSync(path.join(out, 'tables.md'), md.join('\n') + '\n');
  console.log(md.slice(0, 40).join('\n'));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [cmd, ...rest] = process.argv.slice(2), o = args(rest);
  const fn = {run, pairs, report}[cmd];
  if (!fn) { console.error('usage: run --clean-url URL --rewrite-url URL [--limit N] | pairs [--stage s1|s2] | report'); process.exit(2); }
  await fn(o);
  process.exit(0);
}
