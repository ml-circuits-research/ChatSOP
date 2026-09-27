import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {qualify} from '../tools/qualify-solvers.mjs';

const row=(rows,id)=>{const found=rows.find(x=>x.cell===id);assert.ok(found,`Missing qualification cell ${id}`);return found;};
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'solver-qualification-'));
let report;
try{qualify({out:path.join(tmp,'qualification.json')});report=JSON.parse(fs.readFileSync(path.join(tmp,'qualification.json'),'utf8'));}finally{fs.rmSync(tmp,{recursive:true,force:true});}

test('reference oracle distinguishes recursive evidence, variable outputs, conflict, time, and incomplete closure',()=>{
 const reference=report.reference;
 const recursion=row(reference,'recursion');assert.equal(recursion.result.status,'supported');assert.equal(recursion.result.backend,'js');assert.equal(recursion.result.complete,true);assert.ok(recursion.result.proofIds.includes('p1'));assert.ok(recursion.result.proofIds.includes('p2'));
 assert.deepEqual(row(reference,'variables-output').result.answers.map(a=>a['?who']).sort(),['bogdan','carina']);
 assert.equal(row(reference,'explicit-negation').result.status,'refuted');assert.equal(row(reference,'contradiction').result.status,'both');
 assert.equal(row(reference,'time-in-range').result.status,'supported');assert.equal(row(reference,'time-out-of-range').result.status,'unknown');
 assert.equal(row(reference,'hypothesis').result.hypothetical,true);assert.deepEqual(row(reference,'defeated-hypothesis').result.defeatedAssumptions,['h1']);
 assert.equal(row(reference,'fact-limit').result.complete,false);assert.equal(row(reference,'fact-limit').result.status,'unknown');
});

test('SWI computes a separate closure while the JS layer constructs the proof',()=>{
 if(!report.binaries.swi.available){for(const cell of report.swi)assert.equal(cell.status,'skipped');return;}
 for(const cell of report.swi){assert.equal(cell.result.backend,'prolog');assert.equal(cell.result.proofBackend,'js-derivation-checked-against-prolog-closure');assert.ok(cell.costMs.nativeClosure>=0);assert.ok(cell.costMs.jsVerification>=0);assert.ok(cell.costMs.composedAdapter>=0);if(cell.nativeClosure.complete&&cell.jsClosure.complete)assert.equal(cell.result.backendAgreement,true);assert.equal(cell.result.status,row(report.reference,cell.cell).result.status);}
 assert.deepEqual(row(report.swi,'variables-output').result.answers.map(a=>a['?who']).sort(),['bogdan','carina']);
 assert.equal(row(report.swi,'hypothesis').result.hypothetical,true);
 assert.equal(row(report.swi,'defeated-hypothesis').result.hypothetical,false);
 assert.equal(row(report.swi,'fact-limit').result.complete,false);
});

test('Z3 keeps satisfiability, entailment, optimality, unsat and resource limits distinct',()=>{
 assert.equal(row(report.reference,'sat-not-entailment').result.status,'possible');assert.equal(row(report.reference,'same-claim-not-entailed').result.status,'unknown');
 assert.equal(row(report.reference,'non-unique-optimum').result.outputProjection['?x'].status,'ambiguous');
 if(!report.binaries.z3.available){for(const cell of report.z3)assert.equal(cell.status,'skipped');return;}
 assert.equal(row(report.z3,'sat-not-entailment').result.checks.withNegatedClaim,'sat');
 assert.equal(row(report.z3,'same-claim-not-entailed').result.status,'unknown');
 assert.equal(row(report.z3,'entailed').result.checks.withNegatedClaim,'unsat');
 assert.equal(row(report.z3,'unsat-premises').result.status,'inconsistent');
 const optimum=row(report.z3,'non-unique-optimum');assert.equal(optimum.result.status,'optimal');assert.equal(optimum.result.optimalityCheck,'impossible');assert.equal(optimum.result.outputProjection['?x'].status,'ambiguous');
 const timeout=row(report.z3,'timeout-1ms');assert.equal(timeout.result.backend,'z3');assert.equal(timeout.timeoutMs,1);if(!timeout.result.complete)assert.equal(timeout.interpretation,'undecided-within-bound');
});

test('advanced is explicit routing, and an unavailable direct Z3 request cannot fall back',()=>{
 assert.equal(row(report.routing,'reference-constraint').result.route.backend,'js');
 assert.equal(row(report.routing,'advanced-constraint').result.route.backend,report.binaries.z3.available?'z3':'js');
 assert.equal(row(report.routing,'advanced-horn').result.route.backend,report.binaries.swi.available?'prolog':'js');
 assert.equal(row(report.routing,'reference-horn').result.route.backend,'js');
 const fallback=row(report.routing,'advanced-auto-unavailable').result;assert.equal(fallback.route.backend,'js');assert.match(fallback.route.fallback,/Z3 unavailable/);
 const missing=row(report.routing,'explicit-z3-unavailable').result;assert.equal(missing.status,'unsupported');assert.equal(missing.backend,'z3');
 assert.ok(report.unsupported.some(x=>x.cell==='cross-family-global-score'));
});
