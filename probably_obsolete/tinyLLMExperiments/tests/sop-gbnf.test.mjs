// The GBNF grammar of the SOP model surface (tools/sop-gbnf.mjs) follows the parser contracts: it is generated
// from the exported enumerations and SPEC, llama.cpp accepts it, every gold target of a train sample is a sentence
// of it, and programs the parser or the model compiler rejects are not.
//
// The llama.cpp checks use `test-gbnf-validator` (the same grammar engine llama-server samples with). They are
// skipped with a message when the binary is absent (LLAMA_CPP_DIR, default ~/llama-cpp-venv/llama.cpp).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateGbnf, FIELD_ORDER} from '../tools/sop-gbnf.mjs';
import {parse, SPEC, ROLE_NAMES, POLARITIES, CERTAINTIES, BASES, QUERY_MODES, TIME_MEASURES, COMPARATOR_WORDS, ARITHMETIC_WORDS, RANK_WORDS, QUANTIFIER_WORDS, ORDER_WORDS, LINK_WORDS, UNPARSED_HINTS, MAX_LINKS, MAX_SPAN, ENUMS} from '../sop/parser.mjs';
import {checkModelProgram, MODEL_TYPES} from '../sop/declarative.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(process.env.LLAMA_CPP_DIR ?? path.join(os.homedir(), 'llama-cpp-venv/llama.cpp'), 'build/bin/test-gbnf-validator');
const haveValidator = fs.existsSync(validator);
const skip = haveValidator ? false : `llama.cpp test-gbnf-validator not found at ${validator}`;
const grammar = generateGbnf();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-gbnf-'));

/** Does the llama.cpp grammar engine accept every program? Programs are joined by a separator line, which no
 * program can produce, under a batch root, so one validator call checks many programs. */
function accepts(programs) {
  const batch = grammar.replace('root ::= program', 'root ::= program ("~~~\\n" program)*');
  fs.writeFileSync(path.join(temp, 'batch.gbnf'), batch);
  fs.writeFileSync(path.join(temp, 'input.txt'), programs.map(p => p.endsWith('\n') ? p : p + '\n').join('~~~\n'));
  const out = execFileSync(validator, [path.join(temp, 'batch.gbnf'), path.join(temp, 'input.txt')], {encoding: 'utf8'});
  assert.ok(!/Failed to (parse|initialize)/.test(out), 'llama.cpp could not load the grammar: ' + out.slice(0, 300));
  return out.includes('is valid according to the grammar');
}
const parserRejects = text => { try { checkModelProgram(parse(text)); return false; } catch { return true; } };

test('the grammar is generated from the exported contracts', () => {
  assert.equal(generateGbnf(), grammar, 'deterministic output');
  for (const type of MODEL_TYPES) assert.ok(grammar.includes(`" ${type}\\n"`), `wire type ${type}`);
  for (const role of ROLE_NAMES) assert.ok(grammar.includes(`"${role} "`), `role ${role}`);
  const words = [...POLARITIES, ...CERTAINTIES, ...BASES, ...QUERY_MODES, ...TIME_MEASURES, ...Object.keys(COMPARATOR_WORDS), ...Object.keys(ARITHMETIC_WORDS),
    ...RANK_WORDS, ...ORDER_WORDS, ...ENUMS.unclear.kind, ...ENUMS.unclear.language, ...ENUMS.constraint.task, ...ENUMS.constraint.direction, ...LINK_WORDS, ...UNPARSED_HINTS];
  for (const word of words) assert.ok(grammar.includes(`"${word}"`) || grammar.includes(`"${word} "`), `enum word ${word}`);
  for (const word of QUANTIFIER_WORDS) assert.ok(grammar.includes(`"${word}`), `quantifier ${word}`);
  for (const [type, order] of Object.entries(FIELD_ORDER)) for (const field of order) assert.ok([...(SPEC[type].one ?? []), ...(SPEC[type].many ?? [])].includes(field), `${type}.${field}`);
  assert.ok(!/"filter /.test(grammar), 'trusted-circuit fields are not part of the model surface');
  assert.ok(grammar.includes(`link-line{0,${MAX_LINKS}}`), 'at most MAX_LINKS link lines per wire');
  assert.ok(grammar.includes(`str-char{0,${MAX_SPAN - 1}}`), 'an unparsed span is at most MAX_SPAN characters');
  for (const type of ['stated', 'assumed', 'query']) assert.deepEqual(FIELD_ORDER[type].slice(-LINK_WORDS.length), [...LINK_WORDS], `${type} ends with the link keywords`);
  assert.deepEqual(FIELD_ORDER.unparsed, ['span', 'near', 'hint']);
});

test('llama.cpp accepts every gold target of a train sample', {skip}, () => {
  const rows = fs.readFileSync(path.join(root, 'datasets_archive/formalizer-v1/formalizer/train.jsonl'), 'utf8').split('\n').filter(Boolean);
  const sample = rows.filter((_, index) => index % 25 === 0).map(line => JSON.parse(line).target);
  assert.ok(sample.length > 900, 'a sample of about 950 targets');
  for (const text of sample) parse(text);
  assert.ok(accepts(sample), 'every sampled gold target is a sentence of the grammar');
});

test('llama.cpp rejects programs that the parser or the model compiler rejects', {skip}, () => {
  const stated = body => `@s stated\n  relation "work at"\n${body}`;
  const s2 = '@s2 stated\n  relation "be idempotent"\n  role subject "the migration"\n  polarity negated\n  certainty asserted\n';
  const clause = links => `@s1 stated\n  relation "fail"\n  role subject "the rollback"\n  polarity affirmed\n  certainty asserted\n${links}\n${s2}`;
  const invalid = {
    'missing polarity': stated('  role subject "Ana"\n  certainty asserted\n'),
    'unknown role': stated('  role employee "Ana"\n  polarity affirmed\n  certainty asserted\n'),
    'repeated role': stated('  role subject "Ana"\n  role subject "Ion"\n  polarity affirmed\n  certainty asserted\n'),
    'unquoted value': stated('  role subject ana\n  polarity affirmed\n  certainty asserted\n'),
    'basis on stated': stated('  role subject "Ana"\n  polarity affirmed\n  basis world\n'),
    'five roles': stated(ROLE_NAMES.slice(0, 5).map(r => `  role ${r} "x"`).join('\n') + '\n  polarity affirmed\n  certainty asserted\n'),
    'unknown unclear kind': '@u unclear\n  kind contradictory\n',
    'ambiguous with one reading': '@u unclear\n  kind ambiguous\n  reading "one"\n',
    'unclear not alone': '@u unclear\n  kind gibberish\n\n@q query\n  where match\n    relation "work at"\n    role subject "Ana"\n    polarity affirmed\n  end\n',
    'atom leaf in a query': '@q query\n  where works_at ana acme\n',
    'filter in a model query': '@q query\n  select ?x\n  where match\n    relation "cost"\n    role subject "X"\n    role object ?x\n    polarity affirmed\n  end\n  filter ?x > 3\n',
    'every without scope': '@q query\n  mode every\n  where match\n    relation "work at"\n    role subject ?x\n    polarity affirmed\n  end\n',
    'operator in a constraint': '@c constraint\n  var ?x int\n  require ?x == 4\n  select ?x\n  task possible\n',
    'constraint without task': '@c constraint\n  var ?x int\n  require ?x equal 2 times 3\n  select ?x\n',
    'unknown wire type': '@f fact\n  holds works_at ana acme\n',
    // clause links, references and unparsed spans (current language)
    'link without a $id': clause('  because s2\n'),
    'link with a quoted value': clause('  because "s2"\n'),
    'unknown link keyword': clause('  since $s2\n'),
    'too many link lines': clause('  because $s2\n  after $s2\n  before $s2\n  when $s2\n'),
    'link inside a match block': '@q query\n  where match\n    relation "work at"\n    role subject ?x\n    polarity affirmed\n    because $s2\n  end\n\n' + s2,
    'link on a constraint': '@c constraint\n  var ?x int\n  require ?x equal 2\n  task possible\n  select ?x\n  because $s2\n\n' + s2,
    'handle as a role value': stated('  role subject ~s2\n  polarity affirmed\n  certainty asserted\n'),
    'unparsed without span': '@u unparsed\n  hint object\n',
    'unparsed span not quoted': '@u unparsed\n  span the thing\n',
    'unparsed span too long': `@u unparsed\n  span "${'x'.repeat(MAX_SPAN + 1)}"\n`,
    'unknown unparsed hint': '@u unparsed\n  span "the thing"\n  hint person\n',
    'near without a $id': '@u unparsed\n  span "the thing"\n  near s2\n\n' + s2,
    'link on an unparsed wire': '@u unparsed\n  span "the thing"\n  because $s2\n\n' + s2,
  };
  for (const [name, text] of Object.entries(invalid)) {
    assert.ok(parserRejects(text), `${name}: the parser or model admission rejects it`);
    assert.equal(accepts([text]), false, `${name}: the grammar rejects it`);
  }
  const valid = '@s1 stated\n  relation "work at"\n  role subject "Ana"\n  role object "Acme"\n  polarity affirmed\n  certainty asserted\n\n@q query\n  select ?who\n  where match\n    relation "work at"\n    role subject ?who\n    role object "Acme"\n    polarity affirmed\n  end\n  except ?who "Ana"\n';
  assert.ok(!parserRejects(valid) && accepts([valid]), 'a valid program is accepted');
});

test('llama.cpp accepts the clause links, references and unparsed spans of the current language', {skip}, () => {
  const programs = {
    'because link (RO content words)': '@s1 stated\n  relation "pica"\n  role subject "rollback-ul"\n  polarity affirmed\n  certainty asserted\n  because $s2\n\n@s2 stated\n  relation "fi idempotent"\n  role subject "migrarea"\n  polarity negated\n  certainty asserted\n',
    'so on the effect, three links': '@s1 stated\n  relation "rain"\n  role time "yesterday"\n  polarity affirmed\n  certainty asserted\n\n@s2 stated\n  relation "cancel"\n  role object "the match"\n  polarity affirmed\n  certainty asserted\n  so $s1\n  after $s3\n  while $s4\n\n@s3 assumed\n  relation "meet"\n  role subject "the board"\n  polarity affirmed\n\n@s4 stated\n  relation "wait"\n  role subject "the fans"\n  polarity affirmed\n  certainty asserted\n',
    'if on a query': '@s1 stated\n  relation "work at"\n  role subject "Ana"\n  role object "Acme"\n  polarity affirmed\n  certainty supposed\n\n@q query\n  where match\n    relation "have access to"\n    role subject "Ana"\n    role object "the lab"\n    polarity affirmed\n  end\n  if $s1\n',
    'unless and timed before on a query': '@s1 stated\n  relation "rain"\n  role time "tomorrow"\n  polarity affirmed\n  certainty supposed\n\n@s2 stated\n  relation "arrive"\n  role subject "the cleaners"\n  role time "at 10"\n  polarity affirmed\n  certainty asserted\n\n@q query\n  select ?x\n  where match\n    relation "clean"\n    role subject ?x\n    polarity affirmed\n  end\n  unless $s1\n  before $s2\n',
    '$q chain': '@q query\n  select ?p\n  where match\n    relation "antrena"\n    role subject ?p\n    role object "CS Craiova"\n    polarity affirmed\n  end\n\n@q2 query\n  select ?c\n  where match\n    relation "lucra la"\n    role subject $q\n    role object ?c\n    polarity affirmed\n  end\n',
    '$s proposition argument': '@s1 stated\n  relation "get a raise"\n  role subject "Ion"\n  polarity affirmed\n  certainty asserted\n\n@s2 stated\n  relation "be unfair"\n  role subject $s1\n  polarity affirmed\n  certainty hedged\n',
    'unparsed placeholder in a statement': '@s1 stated\n  relation "lend"\n  role subject "Ana"\n  role object ?thing\n  polarity affirmed\n  certainty asserted\n\n@u1 unparsed\n  span "the whatchamacallit"\n  near $s1\n  hint object\n',
    'unparsed alone, several spans': '@u1 unparsed\n  span "zorbly the fnord"\n  hint other\n\n@u2 unparsed\n  span "?? $x ~y"\n',
    'unparsed near a query, relation hint': '@q query\n  select ?x\n  where match\n    relation "fix"\n    role subject ?x\n    role object "the boiler"\n    polarity affirmed\n  end\n\n@u1 unparsed\n  span "sorted out"\n  near $q\n  hint relation\n',
    'constraint naming $q': '@q query\n  select ?n\n  where match\n    relation "cost"\n    role subject "the ticket"\n    role object ?n\n    polarity affirmed\n  end\n\n@c constraint\n  var ?t int\n  require ?t equal $q times 3\n  task possible\n  select ?t\n',
  };
  for (const [name, text] of Object.entries(programs)) {
    assert.doesNotThrow(() => checkModelProgram(parse(text)), `${name}: the parser and model admission accept it`);
    assert.ok(accepts([text]), `${name}: the grammar accepts it`);
  }
  // Rules that are not context-free stay with the parser: the grammar accepts these, admission rejects them.
  const crossWire = {
    'unpaired placeholder': '@s1 stated\n  relation "lend"\n  role subject "Ana"\n  role object ?thing\n  polarity affirmed\n  certainty asserted\n',
    'if naming an asserted clause': programs['if on a query'].replace('certainty supposed', 'certainty asserted'),
    'unknown link target': programs['because link (RO content words)'].replace('because $s2', 'because $s9'),
    'two $id role values': '@s1 stated\n  relation "x"\n  role subject "A"\n  polarity affirmed\n  certainty asserted\n\n@s2 stated\n  relation "cause"\n  role subject $s1\n  role object $s1\n  polarity affirmed\n  certainty asserted\n',
  };
  // Links follow the other fields (canonical order): a link line before certainty is outside the grammar.
  const early = programs['because link (RO content words)'].replace('  certainty asserted\n  because $s2\n', '  because $s2\n  certainty asserted\n');
  assert.ok(!parserRejects(early) && !accepts([early]), 'a link line before the other fields is not canonical');
  for (const [name, text] of Object.entries(crossWire)) {
    assert.ok(parserRejects(text), `${name}: admission rejects it`);
    assert.ok(accepts([text]), `${name}: context-free, so the grammar accepts it`);
  }
});
