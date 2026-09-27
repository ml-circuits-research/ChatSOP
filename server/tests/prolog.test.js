import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {compileProlog} from '../src/solvers.js';import {context,queryProgram} from './helpers.js';
const hasSWI=spawnSync('swipl',['--version'],{encoding:'utf8'}).status===0;
test('Prolog code is generated from typed atoms, not concatenated user source',()=>{const code=compileProlog([{p:'parent',a:['ana','bogdan'],neg:false}],[]);assert.match(code,/table rw/);assert.ok(!code.includes('shell('));});
test('temporal Prolog export requires explicit date',()=>{const r=spawnSync(process.execPath,['cli.js','compile-prolog','--file','kb/bootstrap.sop'],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/requires --at/);});
test('SWI portable Horn result agrees with JS', {skip:!hasSWI},async()=>{const c=context();try{const r=await c.run(queryProgram('grandmother(ana, carina)')+'\n  backend prolog');assert.equal(r.result.status,'supported');assert.equal(r.result.backendAgreement,true);}finally{c.dispose();}});
