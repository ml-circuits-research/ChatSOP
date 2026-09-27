import test from 'node:test';import assert from 'node:assert/strict';
import {runExpression} from '../src/sop/expression.js';
for(const [name,expr,expected]of [['arithmetic','2 + 3 * 4',14],['string','$s.trim().toLowerCase()','ana'],['slice','[1, 2, 3].slice(1).join(";")','2;3'],['conditional','false ? 1 / 0 : 7',7],['object','({count: 2}).count',2],['unicode','"ș".normalize("NFC")','ș'],['only','only([{x: 42}]).x',42]])test('jsEval '+name,()=>assert.deepEqual(runExpression(expr,{refs:{s:' Ana '}}).value,expected));
for(const expr of ['process.exit()','globalThis','Function("return 1")()','({}).constructor','({})["__proto__"]','require("fs")','import("fs")','while(true){}','/abc/.test("a")','"x".repeat(1000000000)','1/0','only([])','only([1,2])','[1,2].map(x => x)','({a:1}).missing'])test('jsEval rejects '+expr,()=>assert.throws(()=>runExpression(expr)));
test('operation and output limits',()=>{assert.throws(()=>runExpression('1+2+3',{maxOps:2}));assert.throws(()=>runExpression('"12345" + "6789"',{maxBytes:6}));});
test('no coercive equality',()=>assert.equal(runExpression('"2" == 2').value,false));
