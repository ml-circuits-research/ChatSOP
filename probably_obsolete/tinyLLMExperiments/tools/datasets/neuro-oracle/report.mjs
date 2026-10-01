/** eval/reports/current/neuro-oracle/summary.md: what the oracle did with the DeepSeek candidates.
 * Reads the observation files of both sides (train/dev and sealed) and the train/dev dataset rows; the sealed side contributes
 * only counts and labels (row attributes, verdicts), never message text.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {WORK, readJson, readJsonl, datasetRows} from './common.mjs';
import {sessionCosts, estimateKernel} from './cost.mjs';
import {PARSE_DIR, MEANING_DIR} from './judge.mjs';

const rank = (key, seed) => crypto.createHash('sha1').update(`${seed}|${key}`).digest('hex');
const pick = (list, n, key, seed) => list.slice().sort((a, b) => rank(key(a), seed).localeCompare(rank(key(b), seed))).slice(0, n);
const VERIFIED = new Set(['VERIFIED_GOLD', 'VERIFIED_GOLD_NORMALIZED', 'VERIFIED_FORM']);
const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : 'n/a');
const count = (list, key) => list.reduce((o, x) => { const k = key(x) ?? 'none'; o[k] = (o[k] ?? 0) + 1; return o; }, {});
const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
const lines = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0);
const clip = (text, n = 200) => { const t = String(text).replace(/\s+/g, ' '); return (t.length > n ? t.slice(0, n - 1) + '…' : t).replace(/\|/g, '\\|'); };
const maybe = (name, fallback) => (fs.existsSync(path.join(WORK, name)) ? readJson(path.join(WORK, name)) : fallback);
const maybeRows = name => (fs.existsSync(path.join(WORK, name)) ? readJsonl(path.join(WORK, name)) : []);

export function writeSummary({manifest}) {
  const verdicts = [...maybeRows('verdicts.jsonl'), ...maybeRows('verdicts-test.jsonl')];
  const rows = [...maybeRows('rows-train-dev.jsonl'), ...maybeRows('rows-test.jsonl')];
  const trainDev = datasetRows('neuro_english'), message = new Map(trainDev.map(r => [r.id, r.message]));
  const cands = new Map(maybeRows('candidates.jsonl').map(c => [c.cid, c]));
  const cal = maybe('meaning-calibration.json', null), adjudication = maybe('meaning-adjudication.json', null), first = maybe('meaning-calibration-first-run.json', null);
  const matching = {train_dev: maybe('matching-train-dev.json', null), test: maybe('matching-test.json', null)};
  const costs = sessionCosts();
  const L = [];
  const isVerified = v => VERIFIED.has(v.level);
  const withOutput = rows.filter(r => r.output !== 'none');
  const verifiedRows = new Set(verdicts.filter(isVerified).map(v => v.id));
  const verifiedDeepseek = new Set(verdicts.filter(v => isVerified(v) && v.src === 'deepseek').map(v => v.id));
  const rowOf = new Map(rows.map(r => [r.id, r]));
  const normalizedRows = new Set(verdicts.filter(v => v.level === 'VERIFIED_GOLD_NORMALIZED').map(v => v.id));
  const strictRows = new Set(verdicts.filter(v => v.level === 'VERIFIED_GOLD').map(v => v.id));
  const untrustedRows = new Set(verdicts.filter(v => v.extra === 'VERIFIED_FORM_UNTRUSTED').map(v => v.id));
  const gateRows = new Set(verdicts.filter(v => v.gate === 'pass').map(v => v.id));

  L.push('# Neuro oracle: DeepSeek rewrite candidates for SymbolicProofingLLM', '');
  L.push(`Generated ${new Date().toISOString()} by \`node tools/datasets/neuro-targets-oracle.mjs summary\`. Rules ${manifest?.rules_version ?? 'n/a'} (frozen), Stanza accurate package (parses recorded on the GPU, rules replayed). Candidates: \`datasets_sources/neuro_english_targets/\` (DeepSeek flash through omp). Sealed-side numbers come from \`tools/eval/neuro-oracle-test.mjs\` and carry no message text. Not human-reviewed.`, '');
  L.push('## Matching to the current rows', '');
  for (const [side, m] of Object.entries(matching)) if (m) L.push(`**${side.replace('_', '/')}**: ${JSON.stringify(m.counts)}; moved ${JSON.stringify(m.moved)}`, '');
  L.push('Candidates of rows that moved to symbolic_english in the rebuild are dropped (`candidates_dropped_symbolic`, counted over every id of the DeepSeek output that is no longer a neuro row); ids are matched exactly.', '');

  L.push('## Candidate funnel', '');
  L.push(`Candidates judged: ${verdicts.length} (DeepSeek ${verdicts.filter(v => v.src === 'deepseek').length}, rows' existing targets ${verdicts.filter(v => v.src === 'dataset_target').length}).`, '');
  L.push(table(['level', 'candidates', 'rows'], Object.entries(count(verdicts, v => v.level)).map(([level, n]) => [level, String(n), String(new Set(verdicts.filter(v => v.level === level).map(v => v.id)).size)])), '');
  L.push(table(['reason of rejection or state', 'candidates'], Object.entries(count(verdicts.filter(v => !isVerified(v)), v => `${v.has_gold ? 'gold row' : 'no-gold row'}: ${v.reason}`)).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, String(n)])), '');
  const norm = verdicts.filter(v => v.level === 'VERIFIED_GOLD_NORMALIZED');
  L.push(`Strict and normalized gold matches are reported separately. Strict (VERIFIED_GOLD): ${verdicts.filter(v => v.level === 'VERIFIED_GOLD').length} candidates, ${strictRows.size} rows. Normalized (VERIFIED_GOLD_NORMALIZED, the SOP matches the gold only after the host's frame and synonym normalization, sop/frames.mjs): ${norm.length} candidates, ${normalizedRows.size} rows, of which ${[...normalizedRows].filter(id => !strictRows.has(id) && rowOf.get(id)?.rewrite_target).length} rows are rewrite targets without a strict match (rows flagged \`rewrite_target: false\` get no pair). The DeepSeek meaning check answered yes for ${norm.filter(v => v.meaning === 'yes').length} and no for ${norm.filter(v => v.meaning === 'no').length} of the normalized candidates (${norm.filter(v => !v.meaning).length} without an answer); it is applied only when trusted (${cal?.trusted ? 'it is' : 'it is not'}).`, '');

  L.push('## Rescue rate', '');
  L.push(`A row is rescued when at least one candidate is VERIFIED_GOLD, VERIFIED_GOLD_NORMALIZED or VERIFIED_FORM. Denominator: neuro rows that have a DeepSeek output (${withOutput.length} of ${rows.length}; the others are not in the DeepSeek input: rows added by the rebuild, the legacy re-split and the composed tools). Rescued: ${verifiedRows.size} rows (${pct(verifiedRows.size, withOutput.length)}); by a DeepSeek candidate alone: ${verifiedDeepseek.size}. Rows flagged \`rewrite_target: false\` (gold convention only) count here but get no training pair.`, '');
  L.push(`Optional tier, not counted above: no-gold rows whose candidate passed the parse gate and got an untrusted meaning "yes" ${untrustedRows.size} rows; no-gold rows that passed the parse gate before the meaning check ${gateRows.size}.`, '');
  const optionalRows = new Set([...verifiedRows, ...untrustedRows]);
  const rate = (list, key) => Object.entries(count(list, key)).sort().map(([k, n]) => { const inK = list.filter(r => String(key(r) ?? 'none') === k); const done = inK.filter(r => verifiedRows.has(r.id)).length, extra = inK.filter(r => optionalRows.has(r.id)).length; return [k, String(n), String(done), pct(done, n), String(extra), pct(extra, n)]; });
  const RH = ['rows', 'rescued (verified)', 'rate', 'rescued incl. optional tiers', 'rate'];
  L.push('By failure_kind (rows with a DeepSeek output):', '', table(['failure_kind', ...RH], rate(withOutput, r => r.failure_kind)), '');
  L.push('By split:', '', table(['split', ...RH], rate(withOutput, r => r.split)), '');
  L.push('By row kind:', '', table(['rows', ...RH], rate(withOutput, r => (r.has_gold ? 'gold SOP' : 'no gold SOP'))), '');
  const forms = new Map();
  for (const r of withOutput) { const o = forms.get(r.form) ?? forms.set(r.form, {n: 0, done: 0, extra: 0}).get(r.form); o.n++; if (verifiedRows.has(r.id)) o.done++; if (optionalRows.has(r.id)) o.extra++; }
  const formList = [...forms.entries()].sort((a, b) => b[1].n - a[1].n);
  L.push(`By form (analysis skeleton of the longest sentence; ${forms.size} forms; the 25 most frequent):`, '', table(['form', 'rows', 'rescued (verified)', 'rate', 'incl. optional tiers', 'rate'], formList.slice(0, 25).map(([f, o]) => [clip(f, 110), String(o.n), String(o.done), pct(o.done, o.n), String(o.extra), pct(o.extra, o.n)])), '');
  L.push('By decomposition type of the message (structural type of a message with several clauses or questions, DS008 "Decomposition coverage"):', '', table(['type', ...RH], rate(withOutput, r => r.shape_type).sort((a, b) => Number(b[1]) - Number(a[1]))), '');
  const never = formList.filter(([, o]) => o.done === 0 && o.n >= 4), neverAny = formList.filter(([, o]) => o.extra === 0 && o.n >= 4);
  L.push('## Forms that never get rescued', '', `${formList.filter(([, o]) => o.done === 0).length} of ${forms.size} forms have no verified rescued row; ${never.length} of them have at least 4 rows (${never.reduce((s, [, o]) => s + o.n, 0)} rows). Even with the optional tiers ${neverAny.length} forms with at least 4 rows (${neverAny.reduce((s, [, o]) => s + o.n, 0)} rows) stay unrescued. The largest unrescued forms (verified levels only):`, '', table(['form', 'rows', 'rows rescued by an optional tier'], never.slice(0, 20).map(([f, o]) => [clip(f, 120), String(o.n), String(o.extra)])), '');
  const unchanged = rows.filter(r => r.output === 'unchanged');
  L.push(`DeepSeek answered \`unchanged\` for ${unchanged.length} rows (per failure_kind ${JSON.stringify(count(unchanged, r => r.failure_kind))}); ${unchanged.filter(r => verifiedRows.has(r.id)).length} of them are rescued by the row's existing target.`, '');

  L.push('## Meaning check (DeepSeek), calibration', '');
  if (cal) {
    const t = cal.tally;
    L.push(`Preregistered as \`eval-neuro-meaning-judge-v1\`. Positives: ${t.positive.n} VERIFIED_GOLD candidates (train/dev rows); the judge said yes to ${t.positive.yes}. Negatives (candidate converted but gold mismatch): ${t.negative_gold_mismatch.n}, yes ${t.negative_gold_mismatch.yes}. Floor negatives (a candidate against another row's message): ${t.negative_other_row.n}, yes ${t.negative_other_row.yes}.`, '');
    L.push(`Precision of "yes" against the gold-mismatch negatives: ${(100 * cal.precision_main).toFixed(1)}% (Wilson lower bound ${(100 * cal.precision_main_wilson_low).toFixed(1)}%); threshold ${(100 * cal.threshold)}%; **trusted: ${cal.trusted}**. H2 (no on at least 90% of floor negatives): ${pct(t.negative_other_row.no, t.negative_other_row.n)}.`, '');
    if (first) L.push(`Deviation D1: the first calibration run (sample drawn from all splits, 100/100/50) gave precision ${(100 * first.precision_main).toFixed(1)}% with ${first.tally.positive.yes}/100 yes on positives; it was redrawn from train/dev rows only so that the train/dev tool never touches sealed rows. Both runs agree.`, '');
    if (adjudication) L.push(`Adjudication of the proxy (one model's review, not a human's): ${adjudication.note}`, '');
    L.push(cal.trusted ? 'The meaning check is required for VERIFIED_FORM.' : 'The meaning check is below the preregistered precision, so it is **not used**: no pair of a no-gold row is VERIFIED_FORM; the training set has VERIFIED_GOLD and VERIFIED_GOLD_NORMALIZED repair pairs (the normalized ones are verified by the SOP, the judge not applied) plus identity pairs and the composed pairs. Candidates that passed the parse gate and got a meaning "yes" are kept as the optional tier `VERIFIED_FORM_UNTRUSTED` (`--include-extra form`).', '');
  } else L.push('Not run yet.', '');

  L.push('## DeepSeek cost', '');
  const parseCalls = lines(path.join(PARSE_DIR, 'input/items.jsonl')), meaningCalls = lines(path.join(MEANING_DIR, 'input/items.jsonl'));
  const price = Object.values(costs).find(c => c.price_per_m?.input)?.price_per_m;
  const estParse = estimateKernel({calls: parseCalls, systemChars: 9000, userChars: 2200, outputTokens: 220}, price), estMeaning = estimateKernel({calls: meaningCalls, systemChars: 2300, userChars: 600, outputTokens: 60}, price);
  L.push(table(['task folder', 'omp sessions', 'agent turns', 'metered cost (USD, usage.cost.total)', 'tokens (input / output / cache read)'], Object.entries(costs).map(([f, c]) => [f, String(c.sessions), String(c.turns), c.cost_usd.toFixed(4), `${c.input} / ${c.output} / ${c.cache_read}`])), '');
  L.push(`Metered: ${Object.values(costs).reduce((s, c) => s + c.cost_usd, 0).toFixed(4)} USD in total (deepseek-flash at ${price ? `${price.input} / ${price.output} / ${price.cache_read}` : 'n/a'} USD per million input / output / cache-read tokens). The session files meter the agent's turns only; the ${parseCalls + meaningCalls} judge requests sent from the eval kernel with \`completion()\` (${parseCalls} parse-judge items, ${meaningCalls} meaning items in the inputs) are not in them. Estimated from item sizes at the same prices: about ${estParse ?? 'n/a'} USD for the parse judge and ${estMeaning ?? 'n/a'} USD for the meaning check (an estimate, not a meter reading).`, '');

  L.push('## SymbolicProofingLLM pair set', '');
  if (manifest) {
    for (const split of ['train', 'dev', 'test']) {
      const s = manifest.summary[split];
      if (!s) continue;
      L.push(`**${split}**: ${s.pairs} pairs; kind ${JSON.stringify(s.by_kind)}; verification ${JSON.stringify(s.by_verification)}; repairs per failure_kind ${JSON.stringify(s.by_failure_kind)}; target sentences (repairs) ${JSON.stringify(s.by_target_sentences)}; decomposition type (repairs) ${JSON.stringify(s.by_decomposition_type)}; tokens prompt+target ${JSON.stringify(s.tokens_total)}.`, '');
    }
    L.push(`Dropped: ${JSON.stringify(manifest.dropped)}; composed hook ${JSON.stringify(manifest.composed_hook)}. Identity ratio ${manifest.identity_ratio} per repair pair.`, '');
  }
  const auditFile = path.join(WORK, '..', '..', '..', '..', 'datasets/neuro_english/proofing/audit.jsonl');
  if (fs.existsSync(auditFile)) {
    const rep = readJsonl(auditFile).filter(a => a.kind === 'repair');
    L.push('Repair pairs (train and dev) per form (the 15 most frequent): ' + JSON.stringify(Object.fromEntries(Object.entries(count(rep, a => clip(a.form ?? 'none', 70))).sort((a, b) => b[1] - a[1]).slice(0, 15))) + '.', '');
  }

  const good = verdicts.filter(v => isVerified(v) && cands.has(v.cid) && message.has(v.id)), rejected = verdicts.filter(v => !isVerified(v) && v.level === 'REJECTED' && cands.has(v.cid) && message.has(v.id));
  L.push('## 30 random verified pairs (train/dev rows)', '');
  L.push(table(['level', 'message', 'candidate'], pick(good, 30, v => v.cid, 'sample-verified').map(v => [v.level, clip(message.get(v.id)), clip(cands.get(v.cid).text)])), '');
  L.push('## 20 random rejected candidates (train/dev rows)', '');
  L.push(table(['reason', 'message', 'candidate'], pick(rejected, 20, v => v.cid, 'sample-rejected').map(v => [v.reason + (v.gate_failed ? ` (${JSON.stringify(v.gate_failed)})` : ''), clip(message.get(v.id), 160), clip(cands.get(v.cid).text, 160)])), '');
  fs.writeFileSync(path.join(WORK, 'summary.md'), L.join('\n') + '\n');
  return L.length;
}
