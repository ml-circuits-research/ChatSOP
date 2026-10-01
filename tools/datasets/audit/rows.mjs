/** Row access for the corpus audit: streaming JSONL, the model-visible message, vocabulary and target atoms. */
import fs from 'node:fs';
import readline from 'node:readline';
import {shardPaths} from '../../../lib/jsonl-shards.mjs';
import {parse, parseMatch, propositionPairs, parseProposition} from '../../../sop/parser.mjs';
import {normalize} from './text.mjs';
import {rowWorld, verificationContext} from '../../../lib/row-world.mjs';

/** Stream a JSONL file row by row; a malformed line is reported, never skipped silently. */
export async function* streamJsonl(file) {
  // A split may be stored as shards (lib/jsonl-shards.mjs); line numbers continue across parts.
  let number = 0;
  for (const part of shardPaths(file)) {
    const lines = readline.createInterface({input: fs.createReadStream(part, {encoding: 'utf8'}), crlfDelay: Infinity});
    for await (const line of lines) {
      number++;
      if (!line.trim()) continue;
      try {
        yield {row: JSON.parse(line), line: number};
      } catch (error) {
        yield {row: null, line: number, error: `${file}:${number}: ${error.message}`};
      }
    }
  }
}

export const targetOf = row => row.sop_target ?? row.target ?? null;

/**
 * Corpus audit profiles (the `audit_profile` of a corpus manifest). The default profile audits rows of the model language: a user
 * message (`question`) and an SOP target. `text-repair` is for corpora whose target is text, never SOP (the proofing corpus: `input`
 * is the message as typed, `target` its repaired text); its rows are read as messages without a target, so the SOP checks do not
 * apply and the message checks (identifiers, duplicates, leakage between the splits) do.
 */
export function adaptRow(row, profile) {
  if (profile !== 'text-repair') return row;
  const {target, ...rest} = row;
  return {...rest, question: row.input, repair_target: target, surfaces_only: true};
}

/** The user's message: the whole question (legacy-format rows may still split it into attached assertions). */
export function messageOf(row) {
  if (typeof row.prompt === 'string') {
    const index = row.prompt.indexOf('\nMESSAGE\n');
    if (index >= 0) return row.prompt.slice(index + 9);
  }
  return [...(row.context_assertions ?? []), row.question ?? ''].join('\n');
}

/** The question sentence alone; query polarity must be carried by the question, not by an attached assertion. */
export const questionOf = row => typeof row.question === 'string' ? row.question : messageOf(row).split('\n').at(-1);

const QUOTED = /"(?:\\.|[^"\\])*"/g;
/** Split an atom into whitespace-separated terms, keeping JSON-quoted text as one term. */
export function splitTerms(text) {
  const out = [];
  const pattern = /"(?:\\.|[^"\\])*"|\S+/g;
  for (const match of String(text).matchAll(pattern)) out.push(match[0]);
  return out;
}

/** Ontology-declared labels and aliases per entity id, with their language tag. */
export function ontologySurfaces(ontology) {
  const map = new Map();
  let current = null;
  for (const line of String(ontology ?? '').split('\n')) {
    const header = /^@([A-Za-z0-9_:.-]+)\s+(\w+)/.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    const field = /^\s+(label|alias)\s+([a-z]{2})\s+("(?:\\.|[^"\\])*")/.exec(line);
    if (current && field) {
      let text;
      try {
        text = JSON.parse(field[3]);
      } catch {
        continue;
      }
      if (!map.has(current)) map.set(current, []);
      map.get(current).push({kind: field[1], language: field[2], text});
    }
  }
  return map;
}

/** Entities and predicates of the row's evaluation-only verification context (never model input), enriched with ontology surfaces. */
export function vocabularyOf(row, lexicon = null) {
  // A generated row may reference its shared predicate declarations (lib/row-world.mjs).
  const surfaces = ontologySurfaces(rowWorld(row).ontology);
  const entities = new Map();
  for (const entity of verificationContext(row)?.entities ?? []) {
    const extra = surfaces.get(entity.id) ?? [];
    const aliases = [...(entity.aliases ?? []), ...(entity.alias ? [entity.alias] : [])].map(text => ({kind: 'alias', language: null, text}));
    const lexical = (lexicon?.entities?.[entity.id] ?? []).map(text => ({kind: 'lexicon', language: null, text}));
    entities.set(entity.id, {id: entity.id, label: entity.label ?? '', surfaces: [...extra, ...aliases, ...lexical]});
  }
  const predicates = new Map();
  for (const predicate of verificationContext(row)?.predicates ?? []) {
    const meaning = predicate.gloss ?? predicate.meaning ?? predicate.description ?? '';
    const extra = (surfaces.get(predicate.id) ?? []).map(entry => entry.text);
    const lexical = lexicon?.predicates?.[predicate.id] ?? [];
    predicates.set(predicate.id, {id: predicate.id, meaning, surfaces: [meaning, ...extra, ...lexical].filter(Boolean), arity: predicate.args?.length ?? null});
  }
  return {entities, predicates};
}

const GROUP = new Set(['all', 'any', 'end']);
/** A model-language proposition (stated, assumed or a query match block) as an audit atom: the relation phrase and
 * the role values as written (JSON-quoted strings or ?variables). It carries no identifier: the host links it. */
const propositionAtom = p => ({negated: p.polarity === 'negated', predicate: p.relation, proposition: true,
  args: p.roles.map(role => typeof role.value === 'string' && role.value.startsWith('?') ? role.value : JSON.stringify(String(role.value)))});

/** Break a `holds`/`where` field into atoms, flattening explicit all/any/end groups and reading match blocks. */
function atomsOf(text) {
  const atoms = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === 'match') {
      const block = [line.trim()];
      while (i + 1 < lines.length && lines[i + 1].trim() !== 'end') block.push(lines[++i].trim());
      i++;
      atoms.push(propositionAtom(parseMatch(block.join('\n'))));
      continue;
    }
    const terms = splitTerms(line.trim());
    if (!terms.length || (terms.length === 1 && GROUP.has(terms[0]))) continue;
    const negated = terms[0] === 'not';
    const body = negated ? terms.slice(1) : terms;
    if (!body.length) continue;
    atoms.push({negated, predicate: body[0], args: body.slice(1)});
  }
  return atoms;
}

const COMPARATOR = /(?:<=|>=|==|!=|<|>)/;
const WORD_COMPARATOR = /\b(?:above|below|at_least|at_most|equal|not_equal)\b/;
/** Parse a target into wires with atoms and the constructs the label checks look for. Throws on parse errors. */
export function analyzeTarget(target) {
  const program = parse(target);
  const wires = program.wires.map(wire => {
    const fields = wire.fields ?? {};
    const atoms = [...(fields.holds ?? []), ...(fields.where ?? [])].flatMap(atomsOf);
    if (wire.type === 'stated' || wire.type === 'assumed') atoms.push(propositionAtom(parseProposition(propositionPairs(wire), {where: '@' + wire.id})));
    const expressions = [...(fields.require ?? []), ...(fields.claim ?? []), ...(fields.filter ?? []), ...(fields.compare ?? [])].map(String);
    return {
      id: wire.id,
      type: wire.type,
      atoms,
      mode: fields.mode?.[0] ?? null,
      task: fields.task?.[0] ?? null,
      temporalFields: ['at', 'during', 'asof', 'valid', 'order'].filter(name => fields[name]?.length),
      // Comparisons in words (DS021 words-only forms: compare, rank, and above/below/at_least/… in constraints) count like operators.
      comparison: expressions.some(expression => COMPARATOR.test(expression) || WORD_COMPARATOR.test(expression)) || Boolean(fields.objective?.length || fields.direction?.length || fields.compare?.length || fields.rank?.length),
      numbers: expressions.flatMap(expression => expression.replace(QUOTED, ' ').match(/-?\b\d+(?:\.\d+)?\b/g) ?? []),
      vars: (fields.var ?? []).map(String),
    };
  });
  return {wires};
}

/** Classify one term of an atom against the row vocabulary. */
export function classifyTerm(term, vocabulary) {
  if (term.startsWith('?')) return 'variable';
  if (term.startsWith('"')) return 'literal';
  if (/^-?\d+(?:\.\d+)?$/.test(term)) return 'number';
  if (/^\d{4}-\d{2}(?:-\d{2})?(?:T[\d:.]+Z?)?$/.test(term) || term === 'timeless') return 'time';
  if (vocabulary.entities.has(term)) return 'entity';
  if (vocabulary.predicates.has(term)) return 'predicate';
  return 'unknown';
}

export const literalText = term => {
  try {
    return JSON.parse(term);
  } catch {
    return term.slice(1, -1);
  }
};

/** Structure label of a row, used to decide which constructs the row claims. */
export const labelOf = row => String(row.structure_id ?? row.shape ?? row.form ?? '');

export const normalizedMessage = row => normalize(messageOf(row));
