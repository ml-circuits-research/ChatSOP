import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {Runtime} from '../src/runtime.js';import {parse,validateGraph} from '../src/sop/parser.js';import {context,schema} from './helpers.js';
const query=(select='?who',where='grandmother(?who, carina)')=>`@q query\n  select ${select}\n  where ${where}\n  at 2026-09-26\n`;
const solve=(outputs='?who one')=>`@r solve\n  query $q\n  output ${outputs}\n`;
const answer='@answer cnl\n  result $r\n  language ro';
test('deferred output is legal without @who declaration',()=>assert.ok(validateGraph(parse(query()+solve()+'@s jsEval\n  expr $who'))));
test('unknown dollar reference without a producer is an error',()=>assert.throws(()=>validateGraph(parse('@s jsEval\n  expr $missing')),/Unknown reference/));
test('duplicate output producers are rejected',()=>assert.throws(()=>validateGraph(parse(query()+solve()+'@r2 solve\n  query $q\n  output ?who one')),/Multiple producers/));
test('output cannot overwrite an explicit wire',()=>assert.throws(()=>validateGraph(parse('@who value\n  data "fixed"\n'+query()+solve())),/conflicts/));
test('deferred output cycle is caught before executing',()=>assert.throws(()=>validateGraph(parse(query('?who','parent(?who, $who)')+solve())),/Cyclic/));
test('unselected output variable is not inferred by name',async()=>{const c=context();try{await assert.rejects(c.run(query()+solve('?other one')),/selected\/declared/);}finally{c.dispose();}});
test('runtime generates and consumes a scalar output',async()=>{const c=context();try{const r=await c.run(query()+solve()+'@s jsEval\n  expr "answer: " + $who');assert.equal(r.result,'answer: ana');assert.equal(r.outputs.who.status,'bound');assert.ok(r.generated.some(g=>g.source.includes('@who binding')));assert.ok(r.trace.find(t=>t.type==='binding'));}finally{c.dispose();}});
test('output dependencies work regardless of declaration order',async()=>{const c=context();try{const r=await c.run('@s jsEval\n  expr $who\n'+query()+solve()+answer);assert.equal(r.values.s,'ana');}finally{c.dispose();}});
test('many answers are not silently collapsed to a scalar',async()=>{const c=context();try{const r=await c.run(query('?who','ancestor(?who, carina)')+solve()+'@s jsEval\n  expr $who\n'+answer);assert.equal(r.outputs.who.status,'ambiguous');assert.equal(r.blocked.s.status,'blocked');assert.equal(r.result.packet.status,'supported');assert.equal(Object.hasOwn(r.values,'who'),false);}finally{c.dispose();}});
test('many output intentionally returns the candidate set',async()=>{const c=context();try{const r=await c.run(query('?who','ancestor(?who, carina)')+solve('?who many')+answer);assert.deepEqual(r.values.who.sort(),['ana','bogdan']);}finally{c.dispose();}});
test('rows preserve associations across multiple selected columns',async()=>{const c=context();try{const r=await c.run(query('?p ?child','parent(?p, ?child)')+solve('?pairs rows')+answer);assert.ok(r.values.pairs.some(x=>x['?p']==='ana'&&x['?child']==='bogdan'));assert.ok(!r.values.pairs.some(x=>x['?p']==='ana'&&x['?child']==='carina'));}finally{c.dispose();}});
test('missing answer stays unbound and blocks only descendants',async()=>{const c=context();try{const r=await c.run(query('?who','works_at(?who, unknown_org)')+solve()+'@s jsEval\n  expr $who\n'+answer);assert.equal(r.outputs.who.status,'no_answer');assert.equal(r.result.packet.status,'unknown');assert.equal(r.blocked.s.status,'blocked');}finally{c.dispose();}});
test('incomplete retrieval cannot materialize one answer',async()=>{const c=context();try{const r=await c.run(query()+solve()+answer,{policy:{maxProbes:1}});assert.equal(r.outputs.who.status,'incomplete');}finally{c.dispose();}});
test('explicit opposite evidence blocks selected scalar',async()=>{const c=context();try{const r=await c.run(`@negative fact
  holds not grandmother(ana, carina)
  valid timeless
@put assert
  input $negative
`+query()+`@r solve
  query $q
  output ?who one
  after $put
`+answer);assert.equal(r.outputs.who.status,'conflict');}finally{c.dispose();}});
test('a status output can be used even when no fact is known',async()=>{const c=context();try{const r=await c.run(query('?who','works_at(?who, missing)')+solve('?decision status')+'@s jsEval\n  expr $decision');assert.equal(r.result,'unknown');}finally{c.dispose();}});
test('count output requires a complete count query',async()=>{const c=context();try{const r=await c.run(query('?who','ancestor(?who, carina)').replace('  select','  mode count\n  select')+solve('?total count')+'@s jsEval\n  expr $total');assert.equal(r.result,2);}finally{c.dispose();}});
test('query output used to formulate a second memory query',async()=>{const c=context();try{const r=await c.run(query()+solve()+`@q2 query
  select ?organization
  where parent($who, ?organization)
  at 2026-09-26
@r2 solve
  query $q2
  output ?organization one
@answer jsEval
  expr $organization`);assert.equal(r.result,'bogdan');assert.ok(r.epochs>=3);}finally{c.dispose();}});
test('template output names are hygienic across two expansions',async()=>{const c=context();try{const body=query()+solve()+'@final jsEval\n  expr $who';const sop='@t template\n  params\n  yield final\n  body |\n'+body.split('\n').map(l=>'    '+l).join('\n')+'\n@a expand\n  using ~t\n@b expand\n  using ~t';const r=await c.run(sop);assert.equal(r.values.a,'ana');assert.equal(r.values.b,'ana');assert.equal(r.values.a__who,'ana');assert.equal(r.values.b__who,'ana');}finally{c.dispose();}});
test('generated bindings cannot be injected by model or user',async()=>{await assert.rejects(new Runtime().run('@v value\n  data 1\n@x binding\n  result $v\n  variable ?x\n  mode one\n  owner v'),/runtime-generated/);});
const numeric=(backend='js',ambiguous=false)=>`@c constraint
  var ?arrival int 0 1440
  require ?arrival ${ambiguous?'>=':'=='} 770 + 70
  claim ?arrival <= 840
@r solve
  constraint $c
  backend ${backend}
  output ?arrival one
@answer cnl
  result $r
  language ro`;
for(const backend of ['js','z3']){
const skip=backend==='z3'&&!!spawnSync('z3',['-version']).error;
test(backend+' numerical value exported only when unique',{skip},async()=>{const r=await new Runtime().run(numeric(backend));assert.equal(r.values.arrival,840);assert.equal(r.result.packet.status,'entailed');});
test(backend+' one model is not a unique output',{skip},async()=>{const r=await new Runtime().run(numeric(backend,true));assert.equal(r.outputs.arrival.status,'ambiguous');assert.equal(Object.hasOwn(r.values,'arrival'),false);});
}
test('finite constraint many projects all base-domain values',async()=>{const r=await new Runtime().run('@c constraint\n  var ?n int 1 3\n  claim ?n == 2\n  task possible\n@r solve\n  constraint $c\n  output ?n many');assert.deepEqual(r.values.n,[1,2,3]);});
test('expansion budget also bounds automatic solve wiring',async()=>{const c=context();try{await assert.rejects(c.run(query()+solve(),{policy:{maxEpochs:0}}),/epoch budget/);}finally{c.dispose();}});
test('one logical variable cannot connect incompatible predicate argument types',async()=>{const c=context();try{await assert.rejects(c.run(`@q query
  select ?v
  where parent(?v, carina)
  where works_at(ana, ?v)
@r solve
  query $q`),/Incompatible types/);}finally{c.dispose();}});
test('approved mixed template links numeric memory to constraint output',async()=>{const c=context();try{const r=await c.run('@route value\n  data "route_demo"\n@start value\n  data 770\n@deadline value\n  data 840\n@answer expand\n  using ~check_arrival\n  with route $route\n  with start $start\n  with deadline $deadline');assert.equal(r.values.answer__duration,70);assert.equal(r.values.answer__arrival,840);assert.equal(r.result.packet.status,'possible');}finally{c.dispose();}});
test('template may yield a deferred output directly',async()=>{const c=context();try{const body=query()+solve();const sop='@t template\n  yield who\n  body |\n'+body.split('\n').map(l=>'    '+l).join('\n')+'\n@answer expand\n  using ~t';const r=await c.run(sop);assert.equal(r.result,'ana');}finally{c.dispose();}});
