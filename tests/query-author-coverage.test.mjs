import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuery} from '../lib/query-author/validate.mjs';
import {lex} from './helpers.mjs';

const match = (relation, subject, object) => `  where match\n    relation "${relation}"\n    role subject ${subject}\n    role object ${object}\n    polarity affirmed\n  end\n`;
const people = [
  {surface: 'Ana', candidates: ['ana'], strong: true},
  {surface: 'Bogdan', candidates: ['bogdan'], strong: true}
];
const age = `@q query\n  select ?person\n${match('age', '?person', '?years')}`;
const options = `  compare any\n    ?person equal "Ana"\n    ?person equal "Bogdan"\n  end\n`;
const ranked = `@q query\n  select ?person\n  rank highest ?years\n${options}${match('age', '?person', '?years')}`;
const check = (sop, message, mentions = null, extra = {}) => validateQuery({sop, message, mentions, lexicon: lex, ...extra});
const codes = result => result.problems.map(problem => problem.code);

// No general language parser: these guards only cover explicit English quantifier and comparison cues.
test('dropped most and numeric lower bound are errors, while their explicit forms pass', () => {
  const base = `@q query\n  mode every\n${match('works_at', '?person', '"Alpha Lab"')}  scope match\n    relation "age"\n    role subject ?person\n    role object ?years\n    polarity affirmed\n  end\n`;
  const most = 'Do most employees at Alpha Lab have an age?';
  assert.ok(codes(check(base, most)).includes('quantifier_not_used'));
  assert.equal(check(base.replace('  mode every\n', '  mode every\n  quantifier most\n'), most).ok, true);
  const bound = 'Do at least 3 employees at Alpha Lab have an age?';
  assert.ok(codes(check(base, bound)).includes('quantifier_not_used'));
  assert.equal(check(base.replace('  mode every\n', '  mode every\n  quantifier at_least 3\n'), bound).ok, true);
  assert.equal(check(`@q query\n  select ?person\n  compare ?years at_least 3\n${match('age', '?person', '?years')}`, 'Which employees are at least 3 years old?').ok, true, 'an attribute threshold is not forced into a quantifier');
  assert.equal(check(age, 'Who is the most popular person?').ok, true, 'a superlative adjective is not a set quantifier');
});

test('comparative choice needs ranked and restricted candidates; compare any and where any both admit', () => {
  const message = 'Which is older, Ana or Bogdan?';
  assert.ok(codes(check(age, message, people)).includes('comparison_options_not_used'));
  const unrestrictedRank = age.replace('  select ?person\n', '  select ?person\n  rank highest ?years\n');
  assert.ok(codes(check(unrestrictedRank, message, people)).includes('comparison_options_not_used'));
  assert.equal(check(ranked, message, people).ok, true);
  const whereAny = `@q query\n  select ?person\n  rank highest ?years\n  where all\n    any\n      match\n        relation "age"\n        role subject "Ana"\n        role object ?years\n        polarity affirmed\n      end\n      match\n        relation "age"\n        role subject "Bogdan"\n        role object ?years\n        polarity affirmed\n      end\n    end\n  end\n`;
  // The equivalent option restriction can also be a top-level where any with shared variables.
  const equivalent = `@q query\n  select ?years\n  rank highest ?years\n  where any\n    match\n      relation "age"\n      role subject "Ana"\n      role object ?years\n      polarity affirmed\n    end\n    match\n      relation "age"\n      role subject "Bogdan"\n      role object ?years\n      polarity affirmed\n    end\n  end\n`;
  assert.equal(check(equivalent, message, people).ok, true);
  assert.equal(check(whereAny, message, people).ok, true, 'nested where any is an equivalent restriction on the named options');
});

test('explicit two-value comparison is not replaced by two unrelated matches', () => {
  const message = 'Is Ana older than Bogdan?';
  const base = `@q query\n  where all\n    match\n      relation "age"\n      role subject "Ana"\n      role object ?a\n      polarity affirmed\n    end\n    match\n      relation "age"\n      role subject "Bogdan"\n      role object ?b\n      polarity affirmed\n    end\n  end\n`;
  assert.ok(codes(check(base, message, people)).includes('comparison_not_used'));
  assert.equal(check(base.replace('  where all\n', '  compare ?a above ?b\n  where all\n'), message, people).ok, true);
});

test('a name repeated only in an unused assumed proposition does not cover the question', () => {
  const assumption = `@a assumed\n  relation "age"\n  role subject "Bogdan"\n  role object 35\n  polarity affirmed\n  basis world\n`;
  const query = `@q query\n  select ?years\n${match('age', '"Ana"', '?years')}`;
  const result = check(assumption + query, 'How old are Ana and Bogdan?', people);
  assert.deepEqual(codes(result), ['mention_not_used']);
  assert.equal(check(query.replace('"Ana"', '"Bogdan"'), 'How old is Bogdan?', [people[1]]).ok, true);
});
