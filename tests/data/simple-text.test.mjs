// Oracle simple-text rendering (DS022 "Simple-text rendering"): surface IR and gold SOP → short simple sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSimpleText} from '../../tools/datasets/diversity/simple-text.mjs';
import {sopToSurface, stratified} from '../../tools/research/simplifier-oracle.mjs';

const prop = (relation, roles, extra = {}) => ({relation, roles, polarity: 'affirmed', ...extra});

test('construction forms give one grammatical clause per line, names kept, one question per line', () => {
  const ir = {stated: [prop('raise', [['subject', '"Mr Lazăr"'], ['object', '"Florin"']], {link: {predicate: 'parent_of'}, certainty: 'asserted'})], assumed: [], unclear: null,
    query: {ask: 'whether', props: [prop('teach', [['subject', '"Zsófia Farkas"'], ['object', '"piano"']], {link: {predicate: 'teaches'}})]}, constraint: null};
  assert.equal(renderSimpleText(ir, {language: 'en'}).text, 'Mr Lazăr raises Florin.\nDoes Zsófia Farkas teach piano?');
});

test('Romanian propositions use the Romanian construction and the message alias of a translated value', () => {
  const ir = {stated: [prop('teach', [['subject', '"Zsófia"'], ['object', '"piano"']], {source_relation: 'preda', link: {predicate: 'teaches'}, polarity: 'negated', certainty: 'asserted'})], assumed: [], unclear: null, query: null, constraint: null};
  const out = renderSimpleText(ir, {language: 'ro', message: 'Zsófia nu predă pian.', entities: [{id: 'piano', label: 'piano', aliases: ['pian', 'piano']}]});
  assert.equal(out.text, 'Zsófia nu predă pian.');
});

test('status labels, chit-chat and gibberish', () => {
  const hedged = {stated: [prop('live in', [['subject', '"Ana"'], ['location', '"Cluj"']], {certainty: 'asserted', speaker: '"Yuki"'})], assumed: [], unclear: null, query: null, constraint: null};
  assert.match(renderSimpleText(hedged).text, /^Yuki says: Ana lives in Cluj\.$/);
  assert.equal(renderSimpleText({unclear: {kind: 'no_request'}}, {message: 'mersi!'}).text, '');
  assert.equal(renderSimpleText({unclear: {kind: 'gibberish'}}, {message: 'dfgh jkl'}).text, 'dfgh jkl');
});

test('gold SOP parses back into a surface IR the renderer reads', () => {
  const ir = sopToSurface(`@s1 stated\n  relation "close at"\n  role subject "the Cluj customs office"\n  role object "5 pm"\n  polarity affirmed\n  certainty asserted\n@q query\n  select ?x\n  where match\n    relation "work at"\n    role subject ?x\n    role object "Acme"\n    polarity affirmed\n  end\n  except ?x "Ana"\n  compare any\n    ?x equal "Bob"\n    ?x equal "Dan"\n  end`);
  const out = renderSimpleText(ir, {language: 'en'});
  assert.equal(out.lines[0], 'The Cluj customs office closes at 5 pm.');
  assert.equal(out.lines[1], 'Who works at Acme?');
  assert.deepEqual(out.lines.slice(2), ['Except: Ana.', 'Options: Bob, Dan.']);
});

test('stratified sampling is deterministic and covers every stratum', () => {
  const rows = Array.from({length: 200}, (_, i) => ({id: `r${i}`, language: i % 2 ? 'en' : 'ro', family: `f${i % 5}`}));
  const a = stratified(rows, 50), b = stratified(rows, 50);
  assert.deepEqual(a.map(r => r.id), b.map(r => r.id));
  assert.equal(new Set(a.map(r => `${r.language}|${r.family}`)).size, 10);
});
