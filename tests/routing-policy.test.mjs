import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReasoningRegistry,solverAvailable} from '../reasoning/registry.mjs';
import {Runtime} from '../sop/runtime.mjs';
import {context,queryProgram} from './helpers.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const problem={kind:'constraint',vars:{x:{sort:'Int',min:0,max:2}},constraints:[],claim:{op:'le',a:['x',2]},task:'prove'};
const numeric=(reasoning='advanced',backend='auto')=>new ReasoningRegistry({availability:()=>false}).run(reasoning,{mode:'constraint',problem,backend});
const query={kind:'query',mode:'exists',where:[{p:'likes',a:['ana','book'],neg:false}],filters:[],select:[],limit:100,at:Date.parse('2026-09-26'),asof:Infinity};
const horn=(backend='auto',registry=new ReasoningRegistry({availability:()=>false}))=>registry.run('advanced',{mode:'deduce',backend,query,memory:{facts:[{kind:'observed',id:'f',atom:query.where[0],valid:{from:-Infinity,until:Infinity}}],rules:[],complete:true,probes:0}});
const fact='@f fact\n  holds likes ana book\n  valid timeless\n@s remember\n  input $f';

// A fresh coding agent starts from the one project root; imported task skills do not
// install another project policy, and ported skills have one physical source.
test('fresh agent can resolve the single root policy and both ported skill paths',()=>{
 const guide=path.join(root,'AGENTS.md'),matrix=path.join(root,'docs/specs/matrix.md');
 assert.ok(fs.statSync(guide).isFile());
 assert.ok(fs.statSync(matrix).isFile());
 for(const name of ['training-rules','training-runbook']){
  const local=path.join(root,'skills',name,'SKILL.md'),ported=path.join(root,'.agents/skills',name,'SKILL.md');
  assert.equal(fs.realpathSync(ported),fs.realpathSync(local));
 }
 for(const entry of fs.readdirSync(path.join(root,'.agents/skills'),{withFileTypes:true})){
  const skill=path.join(root,'.agents/skills',entry.name);
  assert.ok(fs.lstatSync(skill).isSymbolicLink(),entry.name+' must resolve by pointer, not duplicate local rules');
  if(!fs.existsSync(skill))continue; // The external optional catalog is not required for project authority.
  const target=fs.realpathSync(skill);
  assert.ok(fs.statSync(path.join(target,'SKILL.md')).isFile(),entry.name);
  assert.equal(fs.existsSync(path.join(target,'AGENTS.md')),false,entry.name+' must not introduce project guidance');
  if(!['training-rules','training-runbook'].includes(entry.name))assert.notEqual(target,path.join(root,'skills',entry.name));
 }
 for(const entry of fs.readdirSync(path.join(root,'skills'),{withFileTypes:true})){
  if(entry.isDirectory())assert.equal(fs.existsSync(path.join(root,'skills',entry.name,'AGENTS.md')),false,entry.name);
 }
});

test('trusted reason capability advertises the conditional read effect',()=>{
 const r=spawnSync(process.execPath,[path.join(root,'tools/capabilities.mjs')],{encoding:'utf8',maxBuffer:2_000_000});
 assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout);
 assert.equal(result.wires.reason.effects,'may-reinforce-nonhypothetical-observed-proof');
 assert.equal(result.wires.remember.effects,'records-explicit-facts-and-events-in-session');
});

test('reasoning registry calculates over caller-owned premises without mutating memory',()=>{
 const memory={facts:[{kind:'observed',id:'f',atom:query.where[0],valid:{from:-Infinity,until:Infinity}}],rules:[],complete:true,probes:0,
  reinforce(){throw Error('registry must not reinforce');}};
 const previous=JSON.stringify(memory);
 const answer=new ReasoningRegistry({availability:()=>false}).run('reference',{query,memory});
 assert.equal(answer.status,'supported');assert.equal(answer.route.backend,'js');
 assert.equal(JSON.stringify(memory),previous);
});

test('reference rejects external backends; advanced is a route and reports JS fallback',()=>{
 const denied=numeric('reference','z3');
 assert.equal(denied.status,'unsupported');assert.equal(denied.code,'reference_backend_mismatch');
 assert.equal(denied.route.backend,'z3');assert.equal(denied.route.fallback,null);
 const fallback=numeric();
 assert.equal(fallback.reasoningStrategy,'advanced');assert.equal(fallback.backend,'js');
 assert.equal(fallback.route.backend,'js');assert.match(fallback.route.fallback,/Z3 unavailable/);
 assert.equal(fallback.status,'entailed');
 const h=horn();assert.equal(h.route.backend,'js');assert.match(h.route.fallback,/Prolog unavailable/);
 assert.equal(h.status,'supported');
});

test('explicit external backends are rejected on JS-only controller modes',()=>{
 for(const mode of ['abduce','diagnose','associate','induce','analogize','plan','simulate']){
  const requested=mode==='abduce'?'z3':'prolog';
  const result=new ReasoningRegistry({availability:()=>false}).run('advanced',{mode,backend:requested});
  assert.equal(result.status,'unsupported',mode);
  assert.equal(result.code,'explicit_backend_not_available_for_mode',mode);
  assert.equal(result.route.backend,requested,mode+' must retain the explicitly requested backend');
  assert.equal(result.route.fallback,null,mode);
 }
});

test('explicit missing Z3 and SWI never route to JS',()=>{
 const oldZ3=process.env.Z3_BIN,oldSwi=process.env.SWIPL_BIN;
 try{
  process.env.Z3_BIN=path.join(root,'missing-z3-rp');
  process.env.SWIPL_BIN=path.join(root,'missing-swipl-rp');
  const n=numeric('advanced','z3');
  assert.equal(n.status,'unsupported');assert.equal(n.code,'backend_unavailable');
  assert.equal(n.backend,'z3');assert.equal(n.route.backend,'z3');assert.equal(n.route.fallback,null);
  const h=horn('prolog');
  assert.equal(h.status,'unsupported');assert.equal(h.code,'backend_unavailable');
  assert.equal(h.route.backend,'prolog');assert.equal(h.route.fallback,null);
 }finally{
  if(oldZ3===undefined)delete process.env.Z3_BIN;else process.env.Z3_BIN=oldZ3;
  if(oldSwi===undefined)delete process.env.SWIPL_BIN;else process.env.SWIPL_BIN=oldSwi;
 }
});

test('trusted circuit reports advanced when an explicit external backend selects its strategy',async()=>{
 const old=process.env.Z3_BIN;
 try{
  process.env.Z3_BIN=path.join(root,'missing-z3-rp');
  const source='@c constraint\n  var ?x int 0 2\n  claim ?x <= 2\n@r solve\n  constraint $c\n  backend z3';
  const x=await new Runtime().run(source);
  assert.equal(x.result.reasoningStrategy,'advanced');
  assert.equal(x.result.status,'unsupported');
  assert.equal(x.result.code,'backend_unavailable');
  assert.equal(x.result.route.backend,'z3');assert.equal(x.result.route.fallback,null);
  const denied=await new Runtime().run(source+'\n  reasoning reference');
  assert.equal(denied.result.reasoningStrategy,'reference');
  assert.equal(denied.result.status,'unsupported');assert.equal(denied.result.code,'reference_backend_mismatch');
  assert.equal(denied.result.route.backend,'z3');assert.equal(denied.result.route.fallback,null);
 }finally{if(old===undefined)delete process.env.Z3_BIN;else process.env.Z3_BIN=old;}
});

test('incompatible explicit Prolog interval query fails rather than selecting JS',async()=>{
 const source='@q query\n  where likes ana book\n  during 2026-09-01 2026-10-01\n@r reason\n  query $q\n  backend prolog';
 await assert.rejects(new Runtime().run(source),/Prolog adapter implements point-in-time queries/);
});

for(const [name,key,run] of [
 ['Z3','Z3_BIN',()=>new ReasoningRegistry().run('advanced',{mode:'constraint',backend:'z3',problem})],
 ['SWI','SWIPL_BIN',()=>horn('prolog',new ReasoningRegistry())]
])test(name+' uses the real explicitly configured binary when available',t=>{
 if(!process.env[key]||!solverAvailable(name==='Z3'?'z3':'prolog')){t.skip(key+' not set to an available solver');return;}
 const r=run();assert.notEqual(r.status,'unsupported');assert.equal(r.route.backend,name==='Z3'?'z3':'prolog');assert.equal(r.route.fallback,null);
});

test('candidate retrieval, hypothetical proof, and host read-only policy do not reinforce evidence',async()=>{
 const c=context({bootstrap:false,memory:{power:16,arity:3,retention:{reinforceOnUse:true,writeStrength:1,useStrength:2}}});
 try{
  await c.run(fact);
  const original=c.repo.reinforce.bind(c.repo);let calls=0;
  c.repo.reinforce=(...args)=>{calls++;return original(...args);};
  const recall=await c.run('@q query\n  where likes ana book\n@m recall\n  query $q');
  assert.ok(recall.result.facts.length);assert.equal(calls,0);
  const readOnly=await c.run(queryProgram('likes ana book'),{policy:{reinforce:false}});
  assert.equal(readOnly.result.status,'supported');assert.equal(readOnly.result.reinforcement,undefined);assert.equal(calls,0);
  const absent=await c.run(queryProgram('likes ana missing'));
  assert.equal(absent.result.status,'unknown');assert.equal(calls,0);
  const assumed=await c.run('@p premise\n  holds likes ana pen\n@rule rule\n  when likes ana book\n  when likes ana pen\n  then likes ana set\n@q query\n  where likes ana set\n@m link\n  query $q\n  data $rule\n@r reason\n  query $q\n  memory $m\n  assume $p');
  assert.equal(assumed.result.status,'supported');assert.equal(assumed.result.hypothetical,true);
  assert.equal(assumed.result.reinforcement,undefined);
  assert.equal(calls,0);
 }finally{c.dispose();}
});

test('a permitted verified observed proof declares any promotion in its result',async()=>{
 const c=context({bootstrap:false,memory:{power:16,arity:3,retention:{reinforceOnUse:true,writeStrength:1,useStrength:2}}});
 try{
  await c.run(fact);
  const x=await c.run(queryProgram('likes ana book'));
  assert.equal(x.result.status,'supported');
  assert.ok(x.result.reinforcement?.facts>0);
  assert.equal(x.result.reinforcement.strength,2);
 }finally{c.dispose();}
});

test('retention disables proof-use promotion even when host policy permits it',async()=>{
 const c=context({bootstrap:false,memory:{power:16,arity:3,retention:{reinforceOnUse:false,writeStrength:1,useStrength:2}}});
 try{
  await c.run(fact);
  const x=await c.run(queryProgram('likes ana book'));
  assert.equal(x.result.status,'supported');assert.equal(x.result.reinforcement,undefined);
 }finally{c.dispose();}
});
