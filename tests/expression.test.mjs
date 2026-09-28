import test from 'node:test';
import assert from 'node:assert/strict';
import {runExpression} from '../sop/expression.mjs';

const accepted = [
  ['arithmetic', '2 + 3 * 4', 14],
  ['string', '$s.trim().toLowerCase()', 'ana'],
  ['slice', '[1, 2, 3].slice(1).join(";")', '2;3'],
  ['conditional', 'false ? 1 / 0 : 7', 7],
  ['object', '({count: 2}).count', 2],
  ['unicode', '"ș".normalize("NFC")', 'ș'],
  ['only', 'only([{x: 42}]).x', 42],
];
for (const [name, expr, expected] of accepted) {
  test('jsEval ' + name, () => {
    assert.deepEqual(runExpression(expr, {refs: {s: ' Ana '}}).value, expected);
  });
}

// Each rejection names the sandbox guard that must fire, so an incidental
// TypeError or a different guard cannot make the case pass.
const rejected = [
  ['process.exit()', /Method not allowed: exit$/],
  ['globalThis', /No global values in jsEval: globalThis$/],
  ['Function("return 1")()', /Unsupported call$/],
  ['({}).constructor', /Forbidden property$/],
  ['({})["__proto__"]', /Forbidden property$/],
  ['require("fs")', /Only String\/Number\/only are callable$/],
  ['import("fs")', /Only String\/Number\/only are callable$/],
  ['while(true){}', /Expected eof, got \{$/],
  ['/abc/.test("a")', /Expected expression, got \/$/],
  ['"x".repeat(1000000000)', /Method not allowed: repeat$/],
  ['1/0', /Nonfinite result$/],
  ['only([])', /only\(\) requires exactly one result/],
  ['only([1,2])', /only\(\) requires exactly one result/],
  ['[1,2].map(x => x)', /Unsupported expression token near =>/],
  ['({a:1}).missing', /Missing own property missing$/],
];
for (const [expr, message] of rejected) {
  test('jsEval rejects ' + expr, () => {
    assert.throws(() => runExpression(expr), message);
  });
}

test('operation and output limits', () => {
  assert.throws(() => runExpression('1+2+3', {maxOps: 2}), /Expression operation budget$/);
  assert.throws(() => runExpression('"12345" + "6789"', {maxBytes: 6}), /Concatenation budget$/);
});

test('no coercive equality', () => {
  assert.equal(runExpression('"2" == 2').value, false);
});
