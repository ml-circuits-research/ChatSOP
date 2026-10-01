#!/usr/bin/env node
/** Markdown tables of the LanguageProofingLLM iteration-2 report from the score files in $LP_WORK (run after the evaluations).
 *   node tools/eval/language-proofing-v2-tables.mjs --arms identity,base-gemma270m,lp-it1,lp-it2 > eval/reports/history/language-proofing-it2/tables.md
 */
import fs from 'node:fs';
import path from 'node:path';
import {WORK} from './language-proofing-eval.mjs';

const arms = (process.argv[process.argv.indexOf('--arms') + 1] ?? 'identity,base-gemma270m,lp-it1,lp-it2').split(',');
const label = {identity: 'no rewrite', 'base-gemma270m': 'untrained 270M', 'lp-it1': 'iteration 1', 'lp-it2': process.env.LP_BOLD === 'lp-it2' || !process.env.LP_BOLD ? '**iteration 2**' : 'iteration 2', 'lp-it3': '**iteration 3**', 'lp-it2-rj': 'iteration 2 (differing outputs re-judged by Grok and GLM)'};
const score = (name, tag) => { const f = path.join(WORK, 'scores', `${name}__${tag}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).summary : null; };
const P = r => (r ? `${r.pct}` : '-'), PK = r => (r ? `${r.pct} (${r.k}/${r.n})` : '-');
const M = r => (r?.mean ?? '-');
const lines = [];
const out = s => lines.push(s);

out('### Sealed proofing test, repair units, mechanical layer (all units)\n');
out('| arm / kind | units | clean % | content % | chrF (n ref) | exact % |\n|---|---|---|---|---|---|');
for (const a of arms) { const s = score(a, 'test'); if (!s) continue;
  const row = (nm, g) => out(`| ${nm} | ${g.n} | ${P(g.clean_english_rate)} | ${P(g.content_preserved_with_negation)} | ${M(g.chrf)} (${g.with_reference}) | ${P(g.exact_reference)} |`);
  row(`${label[a] ?? a}, all repair`, s.repair); for (const k of ['ro', 'mixed', 'noisy_en']) if (s.by_kind[k]) row(`&nbsp;&nbsp;${k}`, s.by_kind[k]); }
out('\n### Judged sample (600 units, stratified, seed 7), all layers\n');
out('| arm / kind | units | clean % | content % | chrF | analysis % | meaning % | composite % |\n|---|---|---|---|---|---|---|---|');
for (const a of arms) { const s = score(a, 'test600'); if (!s) continue;
  const row = (nm, g) => out(`| ${nm} | ${g.n} | ${P(g.clean_english_rate)} | ${P(g.content_preserved_with_negation)} | ${M(g.chrf)} | ${P(g.analysis_correct)} | ${P(g.meaning_judge_two_vote)} | ${PK(g.good)} |`);
  row(`${label[a] ?? a}, all repair`, s.repair); for (const k of ['ro', 'mixed', 'noisy_en']) if (s.by_kind[k]) row(`&nbsp;&nbsp;${k}`, s.by_kind[k]); }
out('\n### Clean sentences left untouched (clean900) and identity units\n');
out('| arm | clean900 untouched % (k/n) | Wilson 95% | content broken % | judged identity untouched % |\n|---|---|---|---|---|');
for (const a of arms) { const s = score(a, 'testclean'), j = score(a, 'test600'); if (!s) continue; const u = s.identity.left_untouched;
  out(`| ${label[a] ?? a} | ${PK(u)} | [${u.ci95.lo}, ${u.ci95.hi}] | ${P(s.identity.content_broken)} | ${j?.identity ? PK(j.identity.left_untouched) : '-'} |`); }
out('\n### Dev sets (selection signal), mechanical layer\n');
out('| arm | devbg repair composite % | devbg chrF | held-out repair composite % | held-out word kept % | dev2300 repair composite % | identity untouched % (dev) | mash unchanged % |\n|---|---|---|---|---|---|---|---|');
for (const a of arms) { const bg = score(a, 'devbg'), ho = score(a, 'heldout'), dv = score(a, 'dev2300'); if (!bg) continue;
  const hw = fs.existsSync(path.join(WORK, 'scores', `heldout-word__${a}.json`)) ? JSON.parse(fs.readFileSync(path.join(WORK, 'scores', `heldout-word__${a}.json`), 'utf8')).total.pct : '-';
  const ms = fs.existsSync(path.join(WORK, 'scores', `mash__${a}.json`)) ? JSON.parse(fs.readFileSync(path.join(WORK, 'scores', `mash__${a}.json`), 'utf8')).unchanged : null;
  const idk = (bg.identity?.left_untouched?.k ?? 0) + (dv?.identity?.left_untouched?.k ?? 0), idn = (bg.identity?.left_untouched?.n ?? 0) + (dv?.identity?.left_untouched?.n ?? 0);
  out(`| ${label[a] ?? a} | ${P(bg.repair.good)} | ${M(bg.repair.chrf)} | ${P(ho?.repair?.good)} | ${hw} | ${P(dv?.repair?.good)} | ${idn ? Math.round(1000 * idk / idn) / 10 : '-'} (${idk}/${idn}) | ${ms ? PK(ms) : '-'} |`); }
out('\n### Vocabulary probe (child cases)\n');
out('| arm | child units | relation word kept | parent flip (child to parent) | parent units | parent kept |\n|---|---|---|---|---|---|');
for (const a of arms) { const f = path.join(WORK, 'scores', `probe-child__${a}.json`); if (!fs.existsSync(f)) continue; const t = JSON.parse(fs.readFileSync(f, 'utf8')).total;
  out(`| ${label[a] ?? a} | ${t.child_units} | ${t.child_kept} (${Math.round(1000 * t.child_kept / t.child_units) / 10}%) | ${t.parent_flip} (${Math.round(1000 * t.parent_flip / t.child_units) / 10}%) | ${t.parent_units} | ${t.parent_kept} |`); }
out('\n### Composed K4, per sentence, every sentence sent (sendAll)\n');
out('| arm | clean sentences changed | bad sentences fixed | bad rewritten wrongly | bad untouched | dropped components | paragraphs with added text | exact paragraphs |\n|---|---|---|---|---|---|---|---|');
for (const a of arms) { const f = path.join(WORK, 'composed', `${a}__K4__sentence.summary.json`); if (!fs.existsSync(f)) continue; const d = JSON.parse(fs.readFileSync(f, 'utf8')), s = d.stages.at(-1);
  const k = x => (x ? `${x.p}% (${x.k}/${x.n})` : '-');
  out(`| ${label[a] ?? a} | ${k(s.clean_sentences_changed)} | ${k(s.bad_sentences_fixed)} | ${k(s.bad_sentences_wrong_rewrite)} | ${k(s.bad_sentences_untouched)} | ${k(s.dropped_components)} | ${k(s.cases_with_added_text)} | ${s.cases_exact?.all ? `${s.cases_exact.all.p}% (${s.cases_exact.all.k}/${s.cases_exact.all.n})` : "-"} |`); }
out('\n### Vocabulary probes and spacing (iteration 3 sets, mechanical layer)\n');
out('| arm | trained-vocabulary word kept % (dev-heldout, ten words) | unseen-word kept % (dev-heldout-v3, eight words) | unseen: clean identity sentences kept unchanged % | spacing exact % (dev-spacing) | defect-free dev identity untouched % |\n|---|---|---|---|---|---|');
const sj = f => { const p = path.join(WORK, 'scores', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
for (const a of arms) { const t = sj(`words-trained__${a}.json`), u = sj(`words-unseen__${a}.json`), sp = sj(`spacing__${a}.json`), id3 = score(a, 'heldout3id');
  const k = x => (x ? `${x.pct} (${x.k}/${x.n})` : '-');
  out(`| ${label[a] ?? a} | ${k(t?.total)} | ${k(u?.total)} | ${id3?.identity ? PK(id3.identity.left_untouched) : '-'} | ${k(sp?.spacing_exact)} | ${k(sp?.identity_defect_free_untouched)} |`); }
console.log(lines.join('\n'));
