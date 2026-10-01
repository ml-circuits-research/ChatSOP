// Executes the wire help pages under docs/wire_typs/ against the real parser,
// lowering, declarative compiler, runtime and lexicon, and checks that the
// field tables and the wire index agree with the parser SPEC.
//
// Markup contract (see docs/wire_typs/*.html):
//   <pre data-sop="current">   a valid program; it must parse, pass
//                              validateGraph, lower its ground declarations,
//                              compile when it is model-authored only, and run
//                              without throwing: under the model-origin compiler
//                              when it uses stated/assumed/unclear/unparsed, otherwise
//                              under a trusted Runtime. A program of model
//                              wire types only, without an atom-condition
//                              query, also passes the model-origin compiler.
//   <pre data-sop="ontology">  a valid host ontology declaration; Lexicon loads it.
//   <pre data-sop="invalid" data-check="STAGE" data-error="TEXT">
//                              every stage before STAGE succeeds and STAGE
//                              fails with an error containing TEXT. STAGE is
//                              parse | graph | lower | compile | runtime | lexicon.
//                              The compile stage always applies the model-origin
//                              compiler, so it shows what a model may not author.
//   data-status="wire=status"  (runtime stage only, instead of data-error) the
//                              run completes but reports that status, such as
//                              an explicit unsupported route.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse, validateGraph, dependencies, SPEC, ONTOLOGY_SPEC} from '../sop/parser.mjs';
import {lowerFact, lowerRule, lowerQuery, lowerConstraint} from '../sop/lower.mjs';
import {compileDeclarative, MODEL_TYPES} from '../sop/declarative.mjs';
import {Runtime} from '../sop/runtime.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {Repository} from '../memory/repository.mjs';
import {helpPages, pageExamples, tableFields} from '../tools/wire-help-pages.mjs';

const HELP = new URL('../docs/wire_typs/', import.meta.url);
const INDEX = new URL('../docs/wire_types.html', import.meta.url);
const WIRES = JSON.parse(fs.readFileSync(new URL('../sop/contracts/wires.json', import.meta.url), 'utf8')).wires;
const ONTOLOGY_TYPES = Object.keys(ONTOLOGY_SPEC);
// The strict ontology SPEC lists every field Lexicon accepts; other keywords are rejected.
const ONTOLOGY_FIELDS = Object.fromEntries(Object.entries(ONTOLOGY_SPEC).map(([type, spec]) => [type, [...(spec.one ?? []), ...(spec.many ?? [])]]));
const MODEL_ONLY = new Set(['stated', 'assumed', 'unclear', 'unparsed']);
const LEXICON = Lexicon.load(new URL('../config/ontology.sop', import.meta.url));
const TOPIC_PAGES = new Set(['overview', 'syntax', 'small-model', 'model-guide', 'question-types']);
const STAGES = ['parse', 'graph', 'lower', 'compile', 'runtime', 'lexicon'];
const NOW = Date.parse('2026-09-26T12:00:00Z');
const LOWER = {fact: lowerFact, rule: lowerRule, query: (w, v) => lowerQuery(w, v, null, {now: NOW}), constraint: lowerConstraint};

// Page, example and table extraction is shared with the vocabulary check (tools/datasets/audit/vocabulary.mjs).
const pages = helpPages(HELP);
const examples = pageExamples;

async function withRuntime(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-help-'));
  try {
    const repo = new Repository(root);
    repo.init('base');
    const session = repo.session('base', 'reviewer', 'help');
    return await fn(new Runtime({repo, session, lexicon: LEXICON, now: NOW}));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

/** Runs the stages in order; returns {stage, error} for the first failure or {values} on success. */
async function execute(source, {model = false} = {}) {
  let stage = 'parse';
  try {
    const program = parse(source);
    stage = 'graph';
    validateGraph(program);
    stage = 'lower';
    // A model query states conditions as match blocks of strings; only the host compiler lowers it.
    const modelQuery = w => w.type === 'query' && (w.fields.where ?? []).some(text => /(^|\n)match(\n|$)/.test(text));
    for (const w of program.wires) if (LOWER[w.type] && !modelQuery(w) && !dependencies(w).values.length) LOWER[w.type](w, {});
    stage = 'compile';
    // Atom-condition queries belong to trusted circuits; a model-type-only program also passes the model compiler.
    const atomQuery = w => w.type === 'query' && !modelQuery(w);
    if (model || (program.wires.every(w => MODEL_TYPES.has(w.type)) && !program.wires.some(atomQuery))) compileDeclarative(source, {lexicon: LEXICON});
    stage = 'runtime';
    const modelOnly = program.wires.some(w => MODEL_ONLY.has(w.type) || modelQuery(w));
    // Host-emitted advisory wires (pragmatic, DS029) join a model program after its compilation: the model-origin run
    // executes the model part, and the whole program has already passed parse and the graph check above.
    const modelPart = source.split(/\n\s*\n/).filter(block => !/^@\w+ pragmatic\b/.test(block.trim())).join('\n\n');
    const result = await withRuntime(runtime => modelOnly ? runtime.run(modelPart, {origin: 'model'}) : runtime.run(source));
    return {values: result.values};
  } catch (error) {
    return {stage, error};
  }
}

test('help pages and the wire index agree', () => {
  const index = fs.readFileSync(INDEX, 'utf8');
  const linked = [...index.matchAll(/<a id="([^"]+)" href="wire_typs\/([^"]+)\.html" target="wire-content" data-topic="([^"]+)"/g)];
  assert.ok(linked.length > 0, 'sidebar entries found');
  const names = new Set(pages.map(p => p.name));
  for (const [, id, file, topic] of linked) {
    assert.equal(id, file, `sidebar id matches ${file}.html`);
    assert.equal(topic, file, `sidebar topic matches ${file}.html`);
    assert.ok(names.has(file), `sidebar entry ${file} has a page`);
  }
  const sidebar = linked.map(m => m[2]);
  assert.equal(new Set(sidebar).size, sidebar.length, 'no duplicate sidebar entries');
  for (const name of names) assert.ok(sidebar.includes(name), `page ${name}.html is in the sidebar`);
  for (const type of [...Object.keys(SPEC), ...ONTOLOGY_TYPES]) assert.ok(names.has(type), `wire ${type} has a help page`);
});

test('parser SPEC and the wire contract list the same fields', () => {
  assert.deepEqual(Object.keys(WIRES).sort(), Object.keys(SPEC).sort());
  for (const [type, spec] of Object.entries(SPEC))
    for (const key of ['one', 'many', 'required'])
      assert.deepEqual(WIRES[type][key] ?? [], spec[key] ?? [], `${type}.${key}`);
});

test('every documented field exists and every field is documented', () => {
  for (const page of pages) {
    const expected = SPEC[page.name] ? [...(SPEC[page.name].one ?? []), ...(SPEC[page.name].many ?? [])] : ONTOLOGY_FIELDS[page.name];
    if (!expected) continue;
    const rows = tableFields(page.html);
    assert.deepEqual([...rows].sort(), [...expected].sort(), `${page.name}.html field rows match the parser`);
  }
});

test('every keyword of every wire page has a stable field-<keyword> anchor', () => {
  for (const type of [...Object.keys(SPEC), ...ONTOLOGY_TYPES]) {
    const page = pages.find(p => p.name === type);
    assert.ok(page, `wire ${type} has a help page`);
    const fields = SPEC[type] ? [...(SPEC[type].one ?? []), ...(SPEC[type].many ?? [])] : ONTOLOGY_FIELDS[type];
    for (const field of fields) {
      const anchors = page.html.match(new RegExp(`\\bid="field-${field}"`, 'g')) ?? [];
      assert.equal(anchors.length, 1, `${type}.html has exactly one id="field-${field}"`);
    }
  }
  for (const type of MODEL_ONLY) assert.ok(pages.some(p => p.name === type), `${type}.html exists`);
});

test('every wire page has a valid and an invalid example', () => {
  for (const page of pages) {
    if (TOPIC_PAGES.has(page.name)) continue;
    const kinds = examples(page).map(e => e.kind);
    assert.ok(kinds.some(k => k === 'current' || k === 'ontology'), `${page.name}.html has a valid example`);
    assert.ok(kinds.includes('invalid'), `${page.name}.html has an invalid example`);
  }
});

test('valid help examples execute', async () => {
  for (const page of pages) for (const example of examples(page)) {
    if (example.kind === 'ontology') {
      assert.doesNotThrow(() => new Lexicon(example.source), example.label);
      continue;
    }
    if (example.kind !== 'current') continue;
    const result = await execute(example.source);
    assert.ok(!result.error, `${example.label} fails at ${result.stage}: ${result.error?.message}`);
  }
});

test('invalid help examples fail at the documented stage with the documented reason', async () => {
  for (const page of pages) for (const example of examples(page)) {
    if (example.kind !== 'invalid') continue;
    assert.ok(STAGES.includes(example.check), `${example.label} declares a data-check stage`);
    assert.ok(example.error || example.status, `${example.label} declares data-error or data-status`);
    if (example.check === 'lexicon') {
      assert.throws(() => new Lexicon(example.source), error => error.message.includes(example.error), example.label);
      continue;
    }
    const result = await execute(example.source, {model: example.check === 'compile'});
    if (example.status) {
      assert.equal(example.check, 'runtime', `${example.label}: data-status needs the runtime stage`);
      assert.ok(!result.error, `${example.label} runs: ${result.error?.message}`);
      const [wire, status] = example.status.split('=');
      assert.equal(result.values[wire]?.status, status, `${example.label} reports ${status}`);
      continue;
    }
    assert.ok(result.error, `${example.label} must fail at ${example.check}`);
    assert.equal(result.stage, example.check, `${example.label} fails at ${result.stage}: ${result.error.message}`);
    assert.ok(result.error.message.includes(example.error), `${example.label}: "${result.error.message}" includes "${example.error}"`);
  }
});
