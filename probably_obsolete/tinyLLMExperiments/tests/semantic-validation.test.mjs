import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaCanonical } from '../tools/datasets/semantic-compare.mjs';

test('local wire alpha-renaming never rewrites approved external definition handles', () => {
  const suffix = '@query query\n  where parent ana bogdan\n@answer solve\n  query $query\n  data ~reviewed';
  const collision = `@reviewed value\n  data 1\n${suffix}`;
  const harmlessLocalRename = `@other value\n  data 1\n${suffix}`;
  const changedHandle = `@other value\n  data 1\n${suffix.replace('~reviewed', '~other')}`;
  assert.equal(alphaCanonical(collision), alphaCanonical(harmlessLocalRename));
  assert.notEqual(alphaCanonical(collision), alphaCanonical(changedHandle));
});
