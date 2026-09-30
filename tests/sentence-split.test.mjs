import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, mergePrograms } from '../lib/sentence-split.mjs';
import { parse } from '../sop/parser.mjs';
import { checkModelProgram } from '../sop/declarative.mjs';

// Host sentence segmentation and circuit merge of experiment eval-sentence-split-v1 (lib/sentence-split.mjs).
const texts = message => splitSentences(message).map(unit => unit.text);

test('abbreviations, initials, decimals, dates and times do not cut a sentence', () => {
  assert.deepEqual(texts('Dr. Popescu works at Nr. 5 Str. Ulmilor. He lives in Iași. Is he at home?'),
    ['Dr. Popescu works at Nr. 5 Str. Ulmilor.', 'He lives in Iași.', 'Is he at home?']);
  assert.deepEqual(texts('Dl. Ionescu a plătit 12.400 lei la 10.30 pe 12.03.2024. Cât mai are de plătit?!'),
    ['Dl. Ionescu a plătit 12.400 lei la 10.30 pe 12.03.2024.', 'Cât mai are de plătit?!']);
  assert.deepEqual(texts('We saw J. R. R. Tolkien. It is 3.5 km away. Pe 3. martie mergem la mare.'),
    ['We saw J. R. R. Tolkien.', 'It is 3.5 km away.', 'Pe 3. martie mergem la mare.']);
  assert.deepEqual(texts('I bought pears etc. and went home. Stau în sat. Maria vine.'), ['I bought pears etc. and went home.', 'Stau în sat.', 'Maria vine.']);
});

test('quotes, ellipses, lists, lines and emoji keep their sentence', () => {
  assert.deepEqual(texts('She said "Is it open? I hope so." Then she left... and came back. Really?'),
    ['She said "Is it open? I hope so."', 'Then she left... and came back.', 'Really?']);
  assert.deepEqual(texts('Questions:\n- Where is Ana?\n- Who wrote it?\n\nThanks'), ['Questions:\n- Where is Ana?', '- Who wrote it?', 'Thanks']);
  assert.deepEqual(texts('Ana is here. What I want to know: where is Ion?'), ['Ana is here.', 'What I want to know: where is Ion?']);
  assert.deepEqual(texts('Mesaj fără punct\ncare continuă. Apoi alta.'), ['Mesaj fără punct\ncare continuă.', 'Apoi alta.']);
  assert.deepEqual(texts('am luat 10 la licenta!!!! 🎉🎉🎉'), ['am luat 10 la licenta!!!! 🎉🎉🎉']);
  const message = '  Ana works at Orion.  Where is Ion?  ';
  for (const unit of splitSentences(message)) assert.equal(message.slice(unit.start, unit.end), unit.text);
});

const stated = (subject, id = 's1') => `@${id} stated\n  relation "work at"\n  role subject "${subject}"\n  role object "Orion"\n  polarity affirmed\n  certainty asserted\n`;
const query = '@q query\n  select ?who\n  where match\n    relation "live in"\n    role subject ?who\n    role location "Cluj"\n    polarity affirmed\n  end\n';

test('merge renumbers ids, drops duplicates and chit-chat, and keeps a valid model program', () => {
  const {sop, stats} = mergePrograms([{text: stated('Ana')}, {text: '@u unclear\n  kind no_request\n'}, {text: stated('Ana') + '\n' + stated('Ion', 's2')}, {text: query}]);
  const program = checkModelProgram(parse(sop));
  assert.deepEqual(program.wires.map(w => `${w.id} ${w.type}`), ['s1 stated', 's2 stated', 'q query']);
  assert.equal(stats.dropped_duplicates, 1);
  assert.equal(stats.dropped_unclear, 1);
});

test('unclear survives only when no unit has content; gibberish only when every unit is gibberish', () => {
  const gib = '@u unclear\n  kind gibberish\n', chat = '@u unclear\n  kind no_request\n';
  assert.match(mergePrograms([{text: gib}, {text: gib}]).sop, /kind gibberish/);
  assert.match(mergePrograms([{text: gib}, {text: chat}]).sop, /kind no_request/);
  assert.doesNotMatch(mergePrograms([{text: gib}, {text: stated('Ana')}]).sop, /unclear/);
});

test('difference merge removes the previous sentence\'s own wires from a pair output', () => {
  const {sop} = mergePrograms([{text: stated('Ana')}, {text: stated('Ana') + '\n' + stated('Ion', 's2'), exclude: [stated('Ana')]}]);
  assert.equal(parse(sop).wires.length, 2);
});
