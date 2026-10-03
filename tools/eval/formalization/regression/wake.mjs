#!/usr/bin/env node
/**
 * Wake-up of the formalization improver (AGENTS.md "Formalization improvement"): how many inbox rows and new regression cases arrived
 * since the last improvement run, and whether a run is due.
 *   node tools/eval/formalization/regression/wake.mjs [--threshold 10] [--exit-due]   report (with --exit-due: exit 0 when due, 1 when not)
 *   node tools/eval/formalization/regression/wake.mjs --mark                          record that an improvement run consumed the inbox
 * Due when at least `threshold` new cases (after deduplication against eval/formalization-regression/cases.jsonl) arrived. Trigger:
 *   node tools/eval/formalization/regression/wake.mjs --exit-due && node tools/eval/formalization/regression/build.mjs \
 *     && node TinyAgent/bin/tinyagent.mjs job jobs/formalization-improve && node tools/eval/formalization/regression/wake.mjs --mark
 * (after a books or commonsense evaluation has scored and reported its failures, or periodically).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {INBOX} from '../../../../lib/formalization-errors.mjs';
import {mergeInbox, STATE} from './cases.mjs';

export const MARK = path.join(STATE, 'improver.json');
const lines = () => fs.existsSync(INBOX) ? fs.readFileSync(INBOX, 'utf8').split('\n').filter(Boolean).length : 0;

export function wakeState({threshold = 10} = {}) {
  const mark = fs.existsSync(MARK) ? JSON.parse(fs.readFileSync(MARK, 'utf8')) : {inbox_lines: 0, at: null};
  const total = lines();
  const {added} = mergeInbox();
  return {inbox_lines: total, new_rows: Math.max(0, total - mark.inbox_lines), new_cases: added.length, last_run: mark.at, threshold, due: added.length >= threshold};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--threshold');
  if (args.includes('--mark')) {
    fs.mkdirSync(STATE, {recursive: true});
    fs.writeFileSync(MARK, JSON.stringify({inbox_lines: lines(), at: new Date().toISOString()}, null, 1) + '\n');
    console.log(`marked: ${lines()} inbox rows consumed`);
  } else {
    const s = wakeState({threshold: i >= 0 ? Number(args[i + 1]) : 10});
    console.log(JSON.stringify(s));
    if (args.includes('--exit-due')) process.exit(s.due ? 0 : 1);
  }
}
