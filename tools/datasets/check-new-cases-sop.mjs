#!/usr/bin/env node
/** SymbolicLM check for the new proofreading cases (section 8.2 of `new_cases.md`).
 *
 *   node tools/datasets/check-new-cases-sop.mjs [--in datasets_sources/new_cases/cases.jsonl]
 *        [--out datasets_sources/new_cases/symbolic-lm-check.json] [--limit 200] [--sample 20]
 *        [--fail-on-unparsed] [--spell] [--per-case-ms 20000] [--skip-tags id1,id2]
 *
 * Every `clean` rewrite of every case is parsed by the real SymbolicLM (Stanza + UD-to-SOP rules, CPU only)
 * and the check fails for a rewrite that yields an unparsed span or an invalid SOP. Writes a JSON report and,
 * when there are failures, a JSONL list of them. Sealed and development cases are checked the same way.
 * Rows whose main tag is listed in `--skip` (default `identity_unfixable`: fragments, follow-ups, gibberish,
 * greetings, deliberate ambiguity) cannot become SOP by construction and are counted apart, not as failures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSymbolicLM } from '../../lib/symbolic-lm/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  const input = path.resolve(root, args.in ?? 'datasets_sources/new_cases/cases.jsonl');
  const output = path.resolve(root, args.out ?? 'datasets_sources/new_cases/symbolic-lm-check.json');
  const rows = fs.readFileSync(input, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  const sample = Number(args.sample ?? 0), limit = Number(args.limit ?? 0);
  // Rows that are fragments, follow-ups, gibberish or greetings by design (main tag identity_unfixable) cannot
  // become SOP: they are reported apart and do not count as failures.
  const skipTags = String(args.skip ?? 'identity_unfixable').split(',').filter(Boolean);
  const selected = sample > 0 ? rows.filter((_, index) => index % sample === 0) : rows;
  const slice = limit > 0 ? selected.slice(0, limit) : selected;
  const perCaseMs = Number(args['per-case-ms'] ?? 20000);
  let lm = await createSymbolicLM({threads: args.threads ? Number(args.threads) : undefined});
  const progress = `${output}.jsonl`;
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(progress, '');
  const append = record => fs.appendFileSync(progress, JSON.stringify(record) + '\n');
  const started = Date.now();
  const results = [], failures = [];
  let analyzed = 0, unparsedRows = 0, invalidRows = 0, skipped = 0;
  try {
    for (const [rowIndex, row] of slice.entries()) {
      if (skipTags.includes(row.categories?.[0])) { skipped++; continue; }
      for (const [cleanIndex, clean] of row.clean.entries()) {
        let result = null, timedOut = false;
        try {
          result = await Promise.race([
            lm.analyze(clean, {route: 'auto', spell: Boolean(args.spell)}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('case timeout')), perCaseMs).unref?.()),
          ]);
        } catch (error) {
          if (!/case timeout/.test(String(error?.message))) throw error;
          timedOut = true;
          // A case that hangs the Stanza worker leaves it unusable: restart the worker and go on.
          try { await lm.stop(); } catch {}
          lm = await createSymbolicLM({threads: args.threads ? Number(args.threads) : undefined});
        }
        const unparsed = timedOut ? [{span: clean.slice(0, 60), near: null, hint: 'timeout'}] : (result.trace?.unparsed ?? []).map(u => ({span: u.span, near: u.near ?? null, hint: u.hint ?? null}));
        analyzed++;
        if (unparsed.length) unparsedRows++;
        if (!result.valid) invalidRows++;
        const record = {id: row.id, clean: cleanIndex, ok: !timedOut && unparsed.length === 0 && Boolean(result?.valid), valid: Boolean(result?.valid),
          route: result?.route ?? null, outcome: result?.outcome ?? null, timedOut, unparsed, sopFirstLine: String(result?.sop ?? '').split('\n')[0]};
        results.push(record);
        append(record);
        if (!record.ok) failures.push({...record, message: row.message, text: clean, mainTag: row.categories?.[0] ?? null});
      }
      if ((rowIndex + 1) % 25 === 0) {
        const rate = (Date.now() - started) / (rowIndex + 1);
        console.log(`${rowIndex + 1}/${slice.length} cases, ${analyzed} rewrites, ${unparsedRows} with unparsed spans, ${Math.round(rate)} ms/case, eta ${Math.round(rate * (slice.length - rowIndex - 1) / 1000)} s`);
      }
    }
  } finally { await lm.stop(); }
  const report = {version: 1, at: new Date().toISOString(), input: path.relative(root, input), cases: slice.length, skipped, rewrites: analyzed,
    ok: analyzed - failures.length, unparsed: unparsedRows, invalid: invalidRows, timedOut: results.filter(r => r.timedOut).length, ms: Date.now() - started, failures};
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  if (failures.length) fs.writeFileSync(output.replace(/\.json$/, '.jsonl'), failures.map(f => JSON.stringify(f)).join('\n') + '\n');
  console.log(`${analyzed} rewrites from ${slice.length} cases (${skipped} skipped as not-formalizable): ${failures.length} failures (${unparsedRows} with unparsed spans, ${invalidRows} invalid)`);
  for (const failure of failures.slice(0, 15)) console.log(`FAIL ${failure.id}[${failure.clean}] ${failure.unparsed.map(u => u.span).join(' | ') || 'invalid SOP'} :: ${failure.text.slice(0, 90)}`);
  return args['fail-on-unparsed'] && failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error.stack); process.exitCode = 2; });
