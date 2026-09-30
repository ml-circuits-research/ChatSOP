// The target converter (tools/datasets/convert-targets.mjs) turns earlier target forms into the current SOP Lang
// model surface where the mapping is mechanical, flags the rows that need regeneration, and never writes a target
// that the parser or model admission rejects.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {convertRow, convertRows, clauseInValue, unlinkedConnective, suppositionScopesAll, messageTime, lexiconValue, rowLexicon, strictMentioned} from '../tools/datasets/convert-targets.mjs';
import {Dictionary} from '../sop/dictionary.mjs';
import {parse} from '../sop/parser.mjs';
import {checkModelProgram} from '../sop/declarative.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dictionary = Dictionary.fromEntries([
  {id: 'rel:works_at', pos: 'relation', en: ['work at', 'be employed by'], ro: ['lucra la', 'fi angajat la'], forms: ['lucrează la', 'a lucrat la']},
  {id: 'n:gym', pos: 'phrase', en: ['gym'], ro: ['sală de sport'], forms: ['def:sala de sport', 'săli de sport']},
  {id: 'v:inchina', pos: 'verb', en: ['submit'], ro: ['închina'], forms: ['închin', 'închinat']},
]);
const valid = text => { checkModelProgram(parse(text)); return true; };
const query = (relation, subject, object, links = '') => `@q query\n  where match\n    relation ${JSON.stringify(relation)}\n    role subject ${JSON.stringify(subject)}\n    role object ${JSON.stringify(object)}\n    polarity affirmed\n  end\n${links}`;
const stated = (id, relation, subject, object, certainty = 'asserted') => `@${id} stated\n  relation ${JSON.stringify(relation)}\n  role subject ${JSON.stringify(subject)}\n  role object ${JSON.stringify(object)}\n  polarity affirmed\n  certainty ${certainty}\n`;

test('a single supposition in a conditional message scopes the query with an if link', () => {
  const row = {id: 'a', language: 'en', family: 'counterfactual', question: 'Hypothetically, if Ana works at Acme, does she have access to the lab?',
    sop_target: stated('s1', 'work at', 'Ana', 'Acme', 'supposed') + '\n' + query('have access to', 'Ana', 'the lab')};
  const result = convertRow(row, {dictionary});
  assert.equal(result.status, 'converted');
  assert.ok(result.row.sop_target.endsWith('  end\n  if $s1\n'), result.row.sop_target);
  assert.ok(valid(result.row.sop_target));
  assert.deepEqual(result.changes.map(c => c.kind), ['condition_link']);
});

test('several queries: linked only when the supposition obviously leads them all, otherwise regenerated', () => {
  const two = stated('s1', 'work at', 'Ana', 'Acme', 'supposed') + '\n' + query('have access to', 'Ana', 'the lab') + '\n' + query('have access to', 'Ana', 'the archive').replace('@q ', '@q2 ');
  const leading = convertRow({id: 'b', language: 'en', question: "Let's say Ana works at Acme. Does she have access to the lab? And to the archive?", sop_target: two}, {dictionary});
  assert.equal(leading.status, 'converted');
  assert.equal((leading.row.sop_target.match(/  if \$s1/g) ?? []).length, 2);
  const partial = convertRow({id: 'c', language: 'en', question: 'Does Ana have access to the archive? If Ana works at Acme, does she have access to the lab?', sop_target: two}, {dictionary});
  assert.equal(partial.status, 'regenerate');
  assert.deepEqual(partial.reasons.map(r => r.reason), ['supposition_partial_scope']);
  assert.equal(suppositionScopesAll('If X, who is it and where?', 2), true);
  assert.equal(suppositionScopesAll('If X, who? And where?', 2), false, 'the condition sits inside the first question');
  assert.equal(suppositionScopesAll('Who? If X, where?', 2), false);
});

test('Romanian rows: relation from the generator source or the dictionary, values from the row lexicon, dates as written', () => {
  const row = {id: 'd', language: 'ro', family: 'lookup', question: 'Ana lucrează la sala de sport din 8 octombrie 2019?',
    surface_ir: {query: {props: [{relation: 'be employed by', source_relation: 'fi angajat la'}]}},
    ontology_sop: '@gym entity\n  kind place\n  label en "the gym"\n  label ro "sala de sport"\n',
    sop_target: '@q query\n  where match\n    relation "be employed by"\n    role subject "Ana"\n    role object "the gym"\n    polarity affirmed\n  end\n  at "8 October 2019"\n'};
  const result = convertRow(row, {dictionary});
  assert.equal(result.status, 'converted');
  assert.match(result.row.sop_target, /relation "fi angajat la"/);
  assert.match(result.row.sop_target, /role object "sala de sport"/);
  assert.match(result.row.sop_target, /at "8 octombrie 2019"/);
  assert.match(result.row.sop_target, /role subject "Ana"/, 'a proper name is kept');
  assert.deepEqual(result.changes.map(c => c.method).sort(), ['generator_source', 'lexicon', 'message_time']);
  // Without a generator source the dictionary gives the lemma of the form in the message.
  const bare = convertRow({...row, surface_ir: null, ontology_sop: ''}, {dictionary});
  assert.match(bare.row.sop_target, /relation "lucra la"/);
  assert.match(bare.row.sop_target, /role object "sala de sport"/, 'the definite nominative for "the gym"');
});

test('content without a unique Romanian source is kept and flagged; English rows keep their content', () => {
  const target = query('fix', 'Ion', 'the boiler');
  const ro = convertRow({id: 'e', language: 'ro', question: 'A reparat Ion centrala?', sop_target: target}, {dictionary});
  assert.equal(ro.status, 'unchanged');
  assert.deepEqual([...new Set(ro.flags.map(f => f.flag))], ['content_not_normalized']);
  const en = convertRow({id: 'f', language: 'en', question: 'Did Ion repair the boiler?', sop_target: target}, {dictionary});
  assert.equal(en.status, 'unchanged');
  assert.equal(en.flags.length, 0);
  // Mixed rows: an English string the message itself writes is kept.
  const mixed = convertRow({id: 'g', language: 'mixed', question: 'Am un meeting: did Ion fix the boiler?', sop_target: target}, {dictionary});
  assert.equal(mixed.status, 'unchanged');
  assert.equal(mixed.flags.length, 0);
});

test('dictionary surfaces need a strict mention: a short message word never matches a rare lemma', () => {
  assert.equal(strictMentioned('închina', 'Am depus dosarul încă din noiembrie'), false);
  assert.equal(strictMentioned('lucra la', 'Ana lucrează la Acme'), true);
});

test('clauses stuffed into values are flagged for regeneration', () => {
  assert.ok(clauseInValue('before the cleaners arrive'));
  assert.ok(clauseInValue('the contract that was signed at the notary'));
  assert.ok(clauseInValue('whoever is on call'));
  assert.ok(clauseInValue('the bucket we use for the footage'));
  assert.ok(clauseInValue('when I was a child'));
  for (const fine of ['after lunch', 'before October', 'that fence', 'any of that', 'the day before', 'Before Sunrise', 'the eu-west-3 inventory', 'after moving in'])
    assert.equal(clauseInValue(fine), null, fine);
  const row = {id: 'h', language: 'en', question: 'Do we have to be out before the cleaners arrive?',
    sop_target: '@q query\n  where match\n    relation "have to be out"\n    role subject "we"\n    role time "before the cleaners arrive"\n    polarity affirmed\n  end\n'};
  const result = convertRow(row, {dictionary});
  assert.equal(result.status, 'regenerate');
  assert.equal(result.row, undefined);
  assert.deepEqual(result.reasons.map(r => r.reason), ['clause_in_value']);
});

test('a connective between two propositions without a link is flagged; prepositions and question words are not', () => {
  const target = stated('s1', 'fail', 'the rollback', 'prod') + '\n' + stated('s2', 'be idempotent', 'the migration', 'V47');
  const joined = convertRow({id: 'i', language: 'en', question: 'The rollback on prod failed because the migration V47 is not idempotent.', sop_target: target}, {dictionary});
  assert.equal(joined.status, 'regenerate');
  assert.deepEqual(joined.reasons.map(r => r.reason), ['connective_without_link']);
  const anchors = (id, span) => ({s1: /ana/i.test(span), s2: /ion/i.test(span)})[id];
  assert.equal(unlinkedConnective('Ana looks after Ion.', anchors, ['s1', 's2'], ['look after']), null, 'part of a relation phrase');
  assert.equal(unlinkedConnective('Ana left after lunch and Ion stayed.', anchors, ['s1', 's2']), null, 'a preposition before a noun phrase');
  assert.equal(unlinkedConnective('Do you know when Ana met Ion?', anchors, ['s1', 's2']), null, 'an interrogative');
  assert.equal(unlinkedConnective('I ask because Ana met Ion.', anchors, ['s1', 's2']), null, 'a remark about asking');
  assert.ok(unlinkedConnective('Ana left before Ion arrived.', anchors, ['s1', 's2']));
});

test('accepted alternatives are converted too, and messageTime and the row lexicon pick unique surfaces', () => {
  const target = stated('s1', 'work at', 'Ana', 'Acme', 'supposed') + '\n' + query('have access to', 'Ana', 'the lab');
  const result = convertRow({id: 'j', language: 'en', question: 'If Ana works at Acme, does she have access to the lab?', sop_target: target, sop_targets_accepted: [target, target.replace('"the lab"', '"the laboratory"')]}, {dictionary});
  assert.equal(result.status, 'converted');
  assert.ok(result.row.sop_targets_accepted.every(t => t.includes('  if $s1') && valid(t)));
  assert.equal(messageTime('1 May 2019', 'Între 1 mai 2019 și 01.07.2022 a lucrat acolo.'), '1 mai 2019');
  assert.equal(messageTime('1 May 2019', 'Pe 1 mai 2019, adică 01.05.2019.'), null, 'two writings: not unique');
  const lexicon = rowLexicon({ontology_sop: '@c entity\n  kind choir\n  label en "the university choir"\n  label ro "corul universității"\n  alias ro "corul universitatii"\n'});
  assert.equal(lexiconValue('the university choir', 'Cine cântă în corul universității?', lexicon), 'corul universității');
});

test('a source the current parser rejects is reported, never written', () => {
  const {rows, report} = convertRows([{id: 'k', language: 'en', question: 'x', sop_target: '@q query\n  where works_at ana acme\n'}], {dictionary});
  assert.equal(rows.length, 0);
  assert.equal(report.invalid.source_invalid, 1);
});

test('the CLI reads a JSONL file, writes converted rows and a report, and a dry run writes no rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-targets-'));
  const input = path.join(dir, 'in.jsonl');
  const rows = [
    {id: 'a', language: 'en', family: 'counterfactual', question: 'If Ana works at Acme, does she have access to the lab?', sop_target: stated('s1', 'work at', 'Ana', 'Acme', 'supposed') + '\n' + query('have access to', 'Ana', 'the lab')},
    {id: 'b', language: 'en', family: 'wild', question: 'Do we have to be out before the cleaners arrive?', sop_target: '@q query\n  where match\n    relation "have to be out"\n    role subject "we"\n    role time "before the cleaners arrive"\n    polarity affirmed\n  end\n'},
  ];
  fs.writeFileSync(input, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const cli = path.join(root, 'tools/datasets/convert-targets.mjs');
  execFileSync(process.execPath, [cli, '--in', input, '--out', path.join(dir, 'out.jsonl'), '--report', path.join(dir, 'report.json')], {encoding: 'utf8'});
  const written = fs.readFileSync(path.join(dir, 'out.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(written.map(r => r.id), ['a']);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  assert.equal(report.regenerate.clause_in_value, 1);
  assert.deepEqual(report.ids.regenerate.clause_in_value, ['b']);
  assert.equal(report.language.en.converted, 1);
  assert.equal(report.family.wild.regenerate, 1);
  execFileSync(process.execPath, [cli, '--in', input, '--dry-run', '--report', path.join(dir, 'dry.json')], {encoding: 'utf8'});
  assert.ok(fs.existsSync(path.join(dir, 'dry.json')));
  assert.throws(() => execFileSync(process.execPath, [cli, '--in', input, '--out', input], {encoding: 'utf8', stdio: 'pipe'}), 'never overwrites its input');
  fs.rmSync(dir, {recursive: true, force: true});
});
