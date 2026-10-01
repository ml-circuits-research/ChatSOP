/** Fail-closed structural invariants of a corpus (the original audit-corpus checks), accumulated row by row. */
import {parse} from '../../../sop/parser.mjs';
import {MODEL_TYPES} from '../../../sop/declarative.mjs';
import {normalize} from './text.mjs';
import {targetOf} from './rows.mjs';

const PROBLEM_CAP = 200;
/** Message text that presupposes context the model does not see: vocabulary, records, pipeline stages, ids. */
export const CONTEXT_TEXT = /din vocabular|from the vocabulary|observațiilor și regulilor|facts and rules|review stage \d|gp-[a-z]+-\d+|\bc_[0-9a-f]{16,}|\b[a-z]+_\d+_\d+/i;

/**
 * `quality_flags` must declare that no source rows were copied. Builders spell this `source_rows_copied: false`
 * or `copied_source_rows: false`; fully synthetic curricula (`synthetic: true`) have no source rows to copy. The list form
 * of the wild suite declares it with `independent_writers` (the rows were written by independent writers).
 */
const declaresNoCopiedRows = flags => Array.isArray(flags) ? flags.includes('independent_writers')
  : Boolean(flags) && (flags.source_rows_copied === false || flags.copied_source_rows === false || flags.synthetic === true);
/** A reference row has no verification world (`scoring.executed: false`, the wild suite protocol, DS016): it is scored against accepted golds, not executed. */
const isReferenceRow = row => row.scoring?.executed === false;

export class Invariants {
  constructor() {
    this.ids = new Set();
    this.questions = new Map();
    this.groups = new Map();
    this.problems = [];
    this.counts = {};
  }

  fail(kind, message) {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    if (this.problems.length < PROBLEM_CAP) this.problems.push(message);
  }

  /** Check one row; returns the parse error message for its target, if any. */
  add(row, split) {
    const require = (condition, kind, message) => {
      if (!condition) this.fail(kind, message);
    };
    // 1. Required shape and identifier integrity.
    require(row.id && !this.ids.has(row.id), 'id', `duplicate or missing id: ${row.id}`);
    this.ids.add(row.id);
    require(row.semantic_case_id || isReferenceRow(row), 'semantic_case_id', `${row.id}: missing semantic_case_id`);
    require(row.split, 'split', `${row.id}: missing split`);
    require(['en', 'ro'].includes(row.language), 'language', `${row.id}: unexpected language ${row.language}`);
    require(row.question && typeof row.question === 'string', 'question', `${row.id}: missing question`);
    // The model input is the message only (DS021): no separate prompt, and no text that presupposes a vocabulary,
    // records, review stages or identifiers the model cannot see (no-context sweep guard G2).
    require(row.prompt === undefined || row.prompt === row.question, 'prompt', `${row.id}: prompt differs from the message (question)`);
    require(!CONTEXT_TEXT.test(row.question ?? ''), 'context_text', `${row.id}: question presupposes context, records or identifiers`);
    require(declaresNoCopiedRows(row.quality_flags), 'provenance', `${row.id}: quality_flags does not declare that no source rows were copied`);
    // 2. Declarative boundary for model-facing targets; 5. executed expectations.
    const target = targetOf(row);
    let parseError = null;
    if (!target) {
      require(row.target_review_status === 'pending_review' || row.surfaces_only === true, 'target', `${row.id}: no target and no pending_review marker`);
    } else {
      try {
        const program = parse(target);
        if (row.evaluation_track !== 'system') {
          const allowed = MODEL_TYPES;
          const bad = program.wires.filter(wire => !allowed.has(wire.type)).map(wire => wire.type);
          require(bad.length === 0, 'declarative', `${row.id}: formalization target contains ${bad.join(', ')}`);
        }
      } catch (error) {
        parseError = error.message;
        this.fail('parse', `${row.id}: target does not parse (${error.message})`);
      }
      require(isReferenceRow(row) || (row.expected && typeof row.expected.status === 'string'), 'expected', `${row.id}: target without an executed expectation`);
    }
    // 3. Split safety for connected groups.
    const key = row.split_group_id ?? row.semantic_case_id ?? row.id;
    if (!this.groups.has(key)) this.groups.set(key, new Set());
    this.groups.get(key).add(split);
    // 4. Duplicate detection on the natural-language request.
    const question = normalize(row.question);
    if (this.questions.has(question)) this.fail('duplicate_question', `duplicate question text: ${row.id} repeats ${this.questions.get(question)}`);
    else this.questions.set(question, row.id);
    return parseError;
  }

  finish() {
    const crossing = [...this.groups].filter(([, splits]) => splits.size > 1).map(([key]) => key);
    if (crossing.length) {
      this.counts.split_crossing = crossing.length;
      this.problems.push(`connected groups cross splits: ${crossing.slice(0, 5).join(', ')}`);
    }
    return {problems: this.problems, counts: this.counts, total: Object.values(this.counts).reduce((sum, count) => sum + count, 0), connected_groups: this.groups.size};
  }
}
