// Guard G3: the documents that describe the model surface never reintroduce the
// retired context-bearing design (tools/lint/model-surface.mjs, DS021).
import test from 'node:test';
import assert from 'node:assert/strict';
import {lintModelSurface, lintText} from '../tools/lint/model-surface.mjs';

test('model-surface documents contain no context-bearing phrases', () => {
  const findings = lintModelSurface();
  assert.deepEqual(findings, [], findings.map(f => `${f.file}:${f.line} ${f.rule}: ${f.text}`).join('\n'));
});

test('the lint catches positive claims and exempts negations and invalid examples', () => {
  const hits = text => lintText(text).map(f => f.rule);
  assert.deepEqual(hits('The model receives an entity shortlist.'), ['shortlist']);
  assert.deepEqual(hits('The bare prompt is CONTEXT + MESSAGE.'), ['context-message-prompt']);
  assert.deepEqual(hits('The relation is a canonical predicate ID.'), ['canonical-id']);
  assert.deepEqual(hits('Use `unclear` with kind contradictory for conflicts.'), ['retired-unclear-kind']);
  assert.deepEqual(hits('The model sees no shortlist and no identifiers.'), []);
  assert.deepEqual(hits('A contradictory message is formalized as written.'), []);
  assert.deepEqual(hits('<pre data-sop="invalid" data-check="parse"><code>@u unclear\n  kind contradictory</code></pre>'), []);
});
