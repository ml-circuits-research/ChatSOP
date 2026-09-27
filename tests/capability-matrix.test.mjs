import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildMatrix,renderMatrix} from '../tools/capability-matrix.mjs';
const bank={experiment:'engine-comparison-v1',runs:[{engine:'weaver',count:8,seed:11,corpusHash:'same',queriesHash:'same',samples:[{fp:0,fn:0}],summary:{uniform:{exactSets:1},hotspot:{exactSets:1},absent:{exactSets:1}},stats:{banksBytes:100}}],lifecycles:[]};
const reasoning={experiment:'reasoning-memory-v1',cells:[{engine:'weaver',backend:'js',status:'observed',reportedBackend:'js',queryStatus:'supported',complete:true},{engine:'weaver',backend:'prolog',status:'skipped',reason:'SWI unavailable'},{engine:'weaver',backend:'z3',status:'unsupported',reason:'Z3 cannot execute Horn'}]};
test('unmeasured matrix cells remain missing, not inferred from another engine or JS fallback',()=>{
 const result=buildMatrix(bank,reasoning);assert.deepEqual(result.totals,{observed:1,skipped:1,unsupported:1,missing:12});
 assert.equal(result.reasoningMatrix[0].cells[1].status,'skipped');assert.equal(result.reasoningMatrix[0].cells[2].status,'unsupported');
 assert.ok(result.reasoningMatrix.slice(1).every(row=>row.cells.every(cell=>cell.status==='missing')));
 assert.match(renderMatrix(result),/missing: No raw comparison cell/);
});
test('inconsistent workload and fabricated observed backend cannot enter matrix',()=>{
 const wrong={...bank,runs:[...bank.runs,{...bank.runs[0],engine:'sqlite',corpusHash:'other'}]};
 assert.throws(()=>buildMatrix(wrong,reasoning),/Inconsistent workload/);
 const wrongReason={...reasoning,cells:[{...reasoning.cells[0],reportedBackend:'prolog'}]};
 assert.throws(()=>buildMatrix(bank,wrongReason),/backend mismatch/);
});
test('generator deterministically reconstructs checked-in matrix from raw reports',()=>{
 const directory=new URL('../eval/reports/current/comparisons/',import.meta.url),engines=JSON.parse(fs.readFileSync(new URL('engines.json',directory))),reasoners=JSON.parse(fs.readFileSync(new URL('reasoners.json',directory)));
 const expected=buildMatrix(engines,reasoners),target=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-test-'));
 try{const command=['tools/capability-matrix.mjs','--engines',new URL('engines.json',directory).pathname,'--reasoners',new URL('reasoners.json',directory).pathname,'--out',path.join(target,'matrix.json')];
  for(let i=0;i<2;i++){const run=spawnSync(process.execPath,command,{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,'matrix.json'))),expected);assert.equal(fs.readFileSync(path.join(target,'matrix.txt'),'utf8'),renderMatrix(expected));}
  assert.ok(expected.bankRuns.some(run=>run.engine==='hybrid'&&run.hintConsumer?.calls>0));
  assert.ok(expected.lifecycle.every(x=>x.gcApplied?.deletedFiles>0&&x.retractionCurrent&&x.restartRetraction));
 }finally{fs.rmSync(target,{recursive:true,force:true});}
});
