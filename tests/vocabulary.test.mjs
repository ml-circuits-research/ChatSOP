// Vocabulary check (tools/datasets/audit/vocabulary.mjs, tools/verify-vocabulary.mjs): SOP constructs outside the
// language contract are detected, clean SOP passes, and the vocabulary follows the contract rather than a list.
// Fixtures are in-test only; planted values are derived from the loaded contract so the test survives new types.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as parser from '../sop/parser.mjs';
import * as declarative from '../sop/declarative.mjs';
import {
  buildVocabulary, checkHelpPages, checkProgram, checkRow, htmlBlocks, loadVocabulary, markdownBlocks, scanSop,
} from '../tools/datasets/audit/vocabulary.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const vocabulary = await loadVocabulary();
const constructs = findings => findings.map(finding => finding.construct);
const CLEAN_QUERY = '@q query\n  mode select\n  select ?x\n  where works_at ?x acme\n';

/** A contract stub: the real SPEC plus whatever a test adds. */
const stub = ({spec = {}, exports = {}, model = null, wiresJson = null} = {}) => buildVocabulary({
  modules: {
    'sop/parser.mjs': {...parser, SPEC: {...parser.SPEC, ...spec}, ...exports},
    'sop/declarative.mjs': model ? {MODEL_TYPES: new Set(model)} : declarative,
  },
  wiresJson,
});

test('the vocabulary is read from the parser SPEC and the model types', () => {
  assert.deepEqual([...vocabulary.types.keys()].filter(type => !vocabulary.types.get(type).ontology).sort(), Object.keys(parser.SPEC).sort());
  for (const [type, spec] of Object.entries(parser.SPEC)) assert.deepEqual([...vocabulary.types.get(type).one].sort(), [...(spec.one ?? [])].sort(), type);
  assert.ok(vocabulary.modelTypes.size > 0, 'current model-authorable types found');
  for (const type of vocabulary.modelTypes) assert.ok(vocabulary.types.has(type), `model type ${type} is a contract type`);
});

test('clean SOP passes', () => {
  assert.deepEqual(checkProgram(CLEAN_QUERY, vocabulary, {parse: true}), []);
  assert.deepEqual(checkRow({id: 'r1', evaluation_track: 'formalization', sop_target: CLEAN_QUERY}, vocabulary), []);
  const program = '# comment\n@f fact\n  holds works_at ana acme\n  valid timeless\n  source "hr"\n\n@r rule\n  when works_at ?x ?y\n  then employed ?x\n';
  assert.deepEqual(checkProgram(program, vocabulary, {parse: true}), []);
});

test('a planted unknown wire type is detected, with a suggestion', () => {
  const findings = checkProgram('@q qurey\n  where works_at ?x acme\n', vocabulary);
  assert.deepEqual(constructs(findings), ['unknown_type']);
  assert.equal(findings[0].class, 'hallucination');
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].message, /qurey.*did you mean query/);
});

test('a planted unknown field keyword is detected on its line', () => {
  const findings = checkProgram('@q query\n  where works_at ?x acme\n  ask ?x\n', vocabulary);
  assert.deepEqual(constructs(findings), ['unknown_field']);
  assert.equal(findings[0].field, 'ask');
  assert.equal(findings[0].line, 3);
});

test('a planted bad enumerated value is detected for every enum the contract exports', () => {
  assert.ok(vocabulary.enums.size > 0, 'at least one enumeration is exported by the contract');
  for (const [key, entry] of vocabulary.enums) {
    const findings = checkProgram(`@w ${entry.type}\n  ${entry.field} no_such_value_xyz\n`, vocabulary, {complete: false});
    assert.deepEqual(constructs(findings), ['unknown_enum'], key);
    assert.equal(findings[0].value, 'no_such_value_xyz');
    const good = checkProgram(`@w ${entry.type}\n  ${entry.field} ${[...entry.values][0]}\n`, vocabulary, {complete: false});
    assert.deepEqual(good, [], `${key} accepts a listed value`);
  }
});

test('a model-forbidden type in a model target is detected; system targets and setup programs are exempt', () => {
  const forbidden = [...vocabulary.types.keys()].find(type => !vocabulary.types.get(type).ontology && !vocabulary.modelTypes.has(type) && !vocabulary.pending.has(type));
  const program = `@x ${forbidden}\n`;
  const row = {id: 'r2', evaluation_track: 'formalization', sop_target: program};
  const findings = checkRow(row, vocabulary, {parse: false}).filter(finding => finding.construct === 'model_forbidden_type');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].class, 'contract');
  assert.equal(findings[0].where, 'sop_target');
  assert.equal(checkRow({...row, evaluation_track: 'system'}, vocabulary, {parse: false}).filter(f => f.construct === 'model_forbidden_type').length, 0);
  assert.equal(checkRow({id: 'r3', setup_sop: program, sop_target: CLEAN_QUERY}, vocabulary, {parse: false}).filter(f => f.construct === 'model_forbidden_type').length, 0);
});

test('cardinality: a repeated one-valued field and a missing required field are detected', () => {
  const repeated = checkProgram('@q query\n  mode select\n  mode exists\n  select ?x\n  where works_at ?x acme\n', vocabulary);
  assert.deepEqual(constructs(repeated), ['cardinality']);
  assert.equal(repeated[0].line, 3);
  assert.deepEqual(constructs(checkProgram('@q query\n  mode exists\n', vocabulary)), ['cardinality']);
  assert.deepEqual(checkProgram('@q query\n  mode exists\n', vocabulary, {complete: false}), [], 'fragments skip required fields');
});

test('the vocabulary follows the contract: an extra stubbed type, enum and model type are honored', () => {
  const program = '@w widget\n  size small\n';
  assert.deepEqual(constructs(checkProgram(program, vocabulary)), ['unknown_type'], 'the real contract has no widget');
  const extended = stub({spec: {widget: {one: ['size'], required: ['size']}}, exports: {WIDGET_SIZES: ['small', 'large']}, model: ['query', 'widget']});
  assert.deepEqual(checkProgram(program, extended, {parse: false}), []);
  assert.deepEqual(constructs(checkProgram('@w widget\n  size huge\n', extended)), ['unknown_enum']);
  assert.deepEqual(checkRow({id: 'r4', sop_target: program}, extended, {parse: false}), [], 'widget is model-authorable in the stub');
  const unauthorable = stub({spec: {widget: {one: ['size']}}, model: ['query']});
  assert.deepEqual(constructs(checkRow({id: 'r5', sop_target: program}, unauthorable, {parse: false})), ['model_forbidden_type']);
});

test('types whose migration is in flight are classified as pending, not hallucinated', () => {
  const snapshot = {wires: Object.fromEntries(Object.keys(parser.SPEC).map(type => [type, {authoredByModel: false}]))};
  snapshot.wires.retired_wire = {authoredByModel: true};
  const migrating = stub({spec: {widget: {one: ['size']}}, model: ['query'], wiresJson: snapshot});
  assert.match(migrating.pending.get('widget'), /not yet in wires\.json/);
  assert.match(migrating.pending.get('retired_wire'), /no longer in parser SPEC/);
  const findings = checkProgram('@r retired_wire\n  x 1\n', migrating);
  assert.deepEqual(findings.map(f => [f.construct, f.class]), [['unknown_type', 'migration_pending']]);
  const target = checkRow({id: 'r6', sop_target: '@w widget\n  size 1\n'}, migrating, {parse: false});
  assert.deepEqual(target.map(f => [f.construct, f.class]), [['model_forbidden_type', 'migration_pending']]);
});

test('enumerations validated only by inline literals are reported as unverified, never enforced', () => {
  const sources = {'sop/parser.mjs': "function validateShape(w){\n if(w.type==='rule')assert(['logical','causal'].includes(one(w,'mode','logical')),'x');\n}\n"};
  // The real parser exports ENUMS (which would verify rule.mode); a stub without it exercises the inline path.
  const withoutEnums = Object.fromEntries(Object.entries(parser).filter(([name]) => name !== 'ENUMS'));
  const v = buildVocabulary({modules: {'sop/parser.mjs': withoutEnums, 'sop/declarative.mjs': declarative}, sources});
  assert.ok(v.unverified.some(item => item.type === 'rule' && item.field === 'mode' && item.observed.includes('causal')));
  assert.ok(!v.enums.has('rule.mode'));
  assert.deepEqual(checkProgram('@r rule\n  when p ?x\n  then q ?x\n  mode anything\n', v), []);
});

test('the tolerant scanner reads fragments, blocks and condition groups', () => {
  const conditionField = (type, key) => type === 'query' && key === 'where';
  const wires = scanSop('Some prose.\n@q query\n  where all\n    p ?x\n    q ?x\n  end\n  filter $n > 1\nmore prose\n  stray 1\n', {conditionField});
  assert.equal(wires.length, 1);
  assert.deepEqual(wires[0].fields.map(f => f.key), ['where', 'filter']);
  const indented = scanSop('    @t template\n      body |\n        @inner query\n          where p ?x\n      yield inner\n', {conditionField});
  assert.deepEqual(indented[0].fields.map(f => [f.key, f.block ?? false]), [['body', true], ['yield', false]]);
  assert.deepEqual(constructs(checkProgram('@t template\n  body |\n    @inner query\n      wher p ?x\n  yield inner\n', vocabulary)), ['unknown_field', 'cardinality'], 'nested SOP in a block is checked (its required where is missing too)');
});

test('documentation blocks: invalid examples are exempt except for unknown types; markdown fences are read', () => {
  const html = '<p>x</p>\n<pre data-sop="current"><code>@q query\n  wher p ?x</code></pre>\n'
    + '<pre data-sop="invalid" data-check="parse" data-error="Unsupported field"><code>@q query\n  wher p ?x</code></pre>\n'
    + '<pre data-sop="invalid" data-check="parse" data-error="Unknown wire type"><code>@q qurey\n  where p ?x</code></pre>\n'
    + '<pre data-sop="invalid" data-check="parse" data-error="needs where"><code>@q qurey\n  where p ?x</code></pre>\n'
    + '<pre class="language-js"><code>@q query\n  wher p</code></pre>';
  const blocks = htmlBlocks(html);
  assert.equal(blocks.length, 4);
  const results = blocks.map(block => constructs(checkProgram(block.source, vocabulary, {ontology: block.ontology, invalid: block.invalid, complete: false})));
  assert.deepEqual(results, [['unknown_field'], [], [], ['unknown_type']]);
  assert.equal(blocks[0].line + 1, 2, 'block line + finding line gives the file line');
  const markdown = 'Text\n\n```sop\n@q query\n  where p ?x\n  ask ?x\n```\n\n```sh\n@q query\n  wher p\n```\n';
  const fenced = markdownBlocks(markdown);
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0].line + checkProgram(fenced[0].source, vocabulary, {complete: false})[0].line, 6);
});

test('help pages are cross-checked against the contract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocabulary-help-'));
  try {
    const table = rows => `<table><tbody>${rows.map(row => `<tr><td><code>${row}</code> x</td><td>y</td></tr>`).join('')}</tbody></table>`;
    fs.writeFileSync(path.join(dir, 'query.html'), table([...parser.SPEC.query.one.filter(field => field !== 'limit'), ...parser.SPEC.query.many, 'ask']));
    fs.writeFileSync(path.join(dir, 'overview.html'), table(['query', 'where', 'frobnicate']));
    const findings = checkHelpPages(dir, vocabulary);
    const find = (construct, predicate = () => true) => findings.filter(f => f.construct === construct && predicate(f));
    assert.equal(find('doc_missing_row', f => f.type === 'query' && f.field === 'limit').length, 1);
    assert.equal(find('doc_unknown_row', f => f.field === 'ask').length, 1);
    assert.equal(find('doc_unknown_keyword').map(f => f.field).join(), 'frobnicate');
    assert.ok(find('doc_missing_page', f => f.type === 'fact').length === 1);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('the CLI reports planted findings with locations and exits nonzero', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vocabulary-cli-'));
  try {
    fs.symlinkSync(path.join(repository, 'sop'), path.join(root, 'sop'));
    fs.mkdirSync(path.join(root, 'examples'));
    fs.writeFileSync(path.join(root, 'examples', 'bad.sop'), '@q query\n  where p ?x\n\n@z qurey\n  where p ?x\n');
    fs.writeFileSync(path.join(root, 'examples', 'good.sop'), CLEAN_QUERY);
    const out = path.join(root, 'report.json');
    const run = spawnSync(process.execPath, [path.join(repository, 'tools/verify-vocabulary.mjs'), '--root', root, '--scope', 'examples', '--out', out], {encoding: 'utf8'});
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /unknown_type \[hallucination\]: 1/);
    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(report.verdict, 'fail');
    assert.deepEqual(report.findings.map(f => f.location), ['examples/bad.sop:4']);
    fs.rmSync(path.join(root, 'examples', 'bad.sop'));
    assert.equal(spawnSync(process.execPath, [path.join(repository, 'tools/verify-vocabulary.mjs'), '--root', root, '--scope', 'examples', '--out', out]).status, 0);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
