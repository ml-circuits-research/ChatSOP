#!/usr/bin/env node
/**
 * Builds or extends the formalization regression set from the inbox (tools/eval/formalization-regression/cases.mjs):
 *   node tools/eval/formalization-regression/build.mjs [--dry-run]
 * Appends new cases and new observations to eval/formalization-regression/cases.jsonl; never removes a case.
 */
import {mergeInbox, writeCases, CASES} from './cases.mjs';
import path from 'node:path';
import {ROOT} from './cases.mjs';

const {cases, added, updated, refused} = mergeInbox();
if (!process.argv.includes('--dry-run')) writeCases(cases);
console.log(JSON.stringify({file: path.relative(ROOT, CASES), cases: cases.length, runnable: cases.filter(c => c.runnable).length, added: added.length, updated: updated.length, refused: refused.length}));
