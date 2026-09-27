import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Runtime} from '../sop/runtime.mjs';import {context,schema,lex,queryProgram,day} from './helpers.mjs';import {Lexicon} from '../sop/lexicon.mjs';
test('local SOP executes Horn rules',async()=>{const r=await new Runtime({schema}).run(fs.readFileSync(new URL('../examples/local.sop',import.meta.url),'utf8'));assert.equal(r.result.packet.answers[0].binding['?who'],'ana');});
test('retrieve missing rule-body predicates before deriving answer',async()=>{const c=context();try{const r=await c.run(fs.readFileSync(new URL('../examples/query.sop',import.meta.url),'utf8'));assert.equal(r.values.r.answers[0].binding['?who'],'ana');assert.ok(r.values.m.needed.includes('parent'));assert.ok(r.values.m.needed.includes('mother'));}finally{c.dispose();}});
test('mixed memory to numeric solver path',async()=>{const c=context();try{const r=await c.run(fs.readFileSync(new URL('../examples/mixed.sop',import.meta.url),'utf8'));assert.equal(r.values.duration,70);assert.equal(r.result.packet.status,'possible');}finally{c.dispose();}});
test('approved template expands into separate SSA names',async()=>{const c=context();try{const r=await c.run(fs.readFileSync(new URL('../examples/expand.sop',import.meta.url),'utf8'));assert.equal(r.epochs,2);assert.equal(r.result.packet.answers.length,2);assert.ok(r.trace.some(x=>x.wire==='answer__q'));}finally{c.dispose();}});
test('epoch budget is enforced',async()=>{const c=context();try{await assert.rejects(c.run(fs.readFileSync(new URL('../examples/expand.sop',import.meta.url),'utf8'),{policy:{maxEpochs:0}}),/epoch budget/);}finally{c.dispose();}});
test('hypothesis never contaminates persistent memory',async()=>{const c=context();try{const r=await c.run(fs.readFileSync(new URL('../examples/hypothesis.sop',import.meta.url),'utf8'));assert.equal(r.result.packet.hypothetical,true);const after=await c.run(queryProgram('parent carina person_delta'));assert.equal(after.result.status,'unknown');}finally{c.dispose();}});
test('read-only policy refuses explicit session remember',async()=>{const c=context();try{await assert.rejects(c.run('@f fact\n  holds parent ana carina\n  valid timeless\n@s remember\n  input $f',{policy:{allowWrite:false}}));assert.equal((await c.run(queryProgram('parent ana carina'))).result.status,'unknown');}finally{c.dispose();}});
test('model output cannot install rules',async()=>{const c=context();try{await assert.rejects(new Runtime({repo:c.repo,session:c.session,schema}).run('@r rule\n  when parent ?x ?y\n  then likes ?x ?y',{origin:'model'}));}finally{c.dispose();}});
test('independent writes batch one revision',async()=>{const c=context({bootstrap:false});try{const r=await c.run('@a fact\n  holds parent ana bogdan\n  valid timeless\n@b fact\n  holds parent bogdan carina\n  valid timeless\n@x remember\n  input $a\n@y remember\n  input $b');assert.equal(c.session.revision,1);assert.equal(r.values.x.revision,r.values.y.revision);}finally{c.dispose();}});
test('foreign target causes whole effect batch to fail',async()=>{const c=context({bootstrap:false});try{await assert.rejects(c.run('@a fact\n  holds parent ana bogdan\n  valid timeless\n@e event\n  action retract\n  target "c_00000000000000000000000000000000"\n@x remember\n  input $a $e'));assert.equal(Object.keys(c.session.live.claims).length,0);}finally{c.dispose();}});
test('a fact declaration alone does not record a session claim',async()=>{const c=context();try{await c.run('@a fact\n  holds parent ana carina\n  valid timeless');assert.equal((await c.run(queryProgram('parent ana carina'))).result.status,'unknown');}finally{c.dispose();}});
test('conditional premises support a query but cannot be remembered as verified facts',async()=>{
 const c=context({bootstrap:false});try{
  const source='@p premise\n  holds likes ana lab_alpha\n@s query\n  where likes ana lab_alpha\n@answer solve\n  query $s\n  assume $p';
  const r=await c.run(source);
  assert.equal(r.result.status,'supported');assert.equal(r.result.hypothetical,true);
  assert.equal((await c.run(queryProgram('likes ana lab_alpha'))).result.status,'unknown');
  await assert.rejects(c.run('@p premise\n  holds likes ana lab_alpha\n@s remember\n  input $p'));
  assert.equal(Object.keys(c.session.live.claims).length,0);
 }finally{c.dispose();}
});
test('entity resolve creates a typed consumable temporary symbol for local query',async()=>{
 const source='@company resolve\n  text "Alpha Lab"\n  language en\n  kind entity\n  type organization\n@f fact\n  holds works_at maria lab_alpha\n  valid timeless\n@q query\n  where works_at maria $company\n@r reason\n  query $q\n  data $f';
 const result=await new Runtime({schema,lexicon:lex}).run(source);
 assert.equal(result.values.company,'lab_alpha');
 assert.equal(result.outputs.company.type,'organization');
 assert.equal(result.outputs.company.version,lex.version);
 assert.equal(result.result.status,'supported');
});
test('unresolved identity blocks dependent query rather than making a fact',async()=>{
 const l=new Lexicon('@alpha entity\n  kind person\n  label en "bank"\n@beta entity\n  kind person\n  label en "bank"\n@has predicate\n  args person\n  label en "has"');
 for(const [name,status] of [['bank','ambiguous'],['unlisted','unknown']]){
  const r=await new Runtime({schema:l.predicates,lexicon:l}).run(`@who resolve\n  text "${name}"\n  language en\n  kind entity\n@q query\n  where has $who`);
  assert.equal(r.outputs.who.status,status);assert.equal(r.blocked.q.status,'blocked');assert.equal(r.values.q,undefined);
 }
});
test('runtime checks resolved entity type and refuses predicate as atom argument',async()=>{
 const runtime=new Runtime({schema,lexicon:lex});
 await assert.rejects(runtime.run('@who resolve\n  text "Alpha Lab"\n  language en\n  kind entity\n@q query\n  where works_at $who lab_alpha'),/entity type/);
 await assert.rejects(runtime.run('@what resolve\n  text "works at"\n  language en\n  kind predicate\n@q query\n  where likes maria $what'),/Only entity resolution/);
});
