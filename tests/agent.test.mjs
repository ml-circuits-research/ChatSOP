import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {Agent} from '../server/agent.mjs';import {context,lex,queryProgram} from './helpers.mjs';import {Lexicon} from '../sop/lexicon.mjs';import {complete} from '../server/llm.mjs';
async function mock(t,responses){let i=0;const requests=[];const server=http.createServer((req,res)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{requests.push(JSON.parse(s));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:responses[i]?.text??responses[i]},finish_reason:responses[i++]?.finish??'stop'}]}));});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return {config:{url:`http://127.0.0.1:${server.address().port}/v1/chat/completions`,model:'mock'},requests};}
test('SOP language boundary and context-only follow-up, mocked model not neural evidence',async t=>{const c=context();t.after(c.dispose);const answer=queryProgram('grandmother(ana, carina)')+'\n@answer cnl\n  result $r\n  language ro';const m=await mock(t,[answer,answer]);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});assert.equal((await a.turn('Ana este bunica Carinei?',{rewrite:false})).packet.status,'supported');assert.equal((await a.turn('De ce?',{rewrite:false})).packet.status,'supported');assert.equal(m.requests[0].response_format,undefined);assert.ok(m.requests[1].messages[0].content.includes('previous_query_sop'));});
test('truncated LLM output is never executed',async t=>{const m=await mock(t,[{text:'@f fact',finish:'length'}]);await assert.rejects(()=>complete(m.config,'x'),/truncated/);});
test('approved SOP procedure is retrieved into model micro-context',async t=>{const c=context();t.after(c.dispose);const answer='@person value\n  data "carina"\n@expanded expand\n  using ~find_ancestors\n  with person $person\n@packet jsEval\n  expr $expanded.packet\n@answer cnl\n  result $packet\n  language en';const m=await mock(t,[answer]);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});const r=await a.turn('Aplică procedura de ascendență pentru Carina.',{rewrite:false});assert.equal(r.packet.status,'supported');assert.match(m.requests[0].messages[0].content,/@find_ancestors template/);});
test('computed terms cannot bypass the vocabulary shortlist',async t=>{const c=context();t.after(c.dispose);const m=await mock(t,['@person value\n  data "unauthorized"\n@f fact\n  holds works_at($person, lab_alpha)\n  valid timeless\n@s assert\n  input $f']);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});await assert.rejects(()=>a.turn('Maria lucrează la Alfa.',{rewrite:false}),/outside its shortlist/);assert.equal(Object.keys(c.session.live.claims).length,0);});
test('entity type is checked after resolving values',async t=>{const c=context();t.after(c.dispose);const m=await mock(t,['@f fact\n  holds works_at(lab_alpha, maria)\n  valid timeless\n@s assert\n  input $f']);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});await assert.rejects(()=>a.turn('Maria lucrează la Alfa.',{rewrite:false}),/entity type/);});
test('model cannot fabricate documentary provenance',async t=>{const c=context();t.after(c.dispose);const m=await mock(t,['@f fact\n  holds works_at(maria, lab_alpha)\n  valid timeless\n  source forged_document\n@s assert\n  input $f']);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});await assert.rejects(()=>a.turn('Maria lucrează la Alfa.',{rewrite:false}),/document provenance/);});
test('certified generated entity can be used without appearing literally in shortlist',()=>{const c=context();try{const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{}});const context={predicates:[{id:'parent'}],entities:[{id:'carina'}]};const wire={type:'query',fields:{where:['parent($who, ?child)']}};assert.doesNotThrow(()=>a.validateAtom({p:'parent',a:['ana','?child']},context,{wire,atomIndex:0,outputs:{who:{status:'bound',valueType:'person'}}}));assert.throws(()=>a.validateAtom({p:'parent',a:['ana','?child']},context,{wire,atomIndex:0,outputs:{who:{status:'bound',valueType:'organization'}}}),/output type/);}finally{c.dispose();}});
test('mock formalizer consumes canonical EN and RO entity aliases with one call per turn',async t=>{
 const c=context();t.after(c.dispose);
 const response=surface=>`@company resolve\n  text "${surface}"\n  language ${surface==='Alpha Lab'?'en':'ro'}\n  kind entity\n  type organization\n@q query\n  where works_at(maria, $company)\n@r solve\n  query $q\n@answer cnl\n  result $r`;
 const m=await mock(t,[response('Alpha Lab'),response('Alfa')]);
 const agent=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});
 const english=await agent.turn('Maria works at Alpha Lab?',{language:'en',rewrite:false});
 const romanian=await agent.turn('Maria lucrează la Alfa?',{language:'ro',rewrite:false});
 assert.equal(english.packet.status,'supported');assert.equal(romanian.packet.status,'supported');
 assert.equal(english.outputs.company.id,'lab_alpha');assert.equal(romanian.outputs.company.id,'lab_alpha');
 assert.equal(m.requests.length,2);assert.match(m.requests[0].messages[0].content,/"id":"lab_alpha"/);
 assert.ok(!m.requests[0].messages[0].content.includes('"aliases"'));
});
test('ambiguous and unknown aliases request clarification before downstream querying',async t=>{
 const c=context({bootstrap:false});t.after(c.dispose);
 const lexicon=new Lexicon('@has predicate\n  args person\n  label en "has"\n@person1 entity\n  kind person\n  label en "bank"\n@person2 entity\n  kind person\n  label en "bank"');
 const reply=surface=>`@who resolve\n  text "${surface}"\n  language en\n  kind entity\n@q query\n  where has($who)\n@r solve\n  query $q\n@answer cnl\n  result $r`;
 const m=await mock(t,[reply('bank'),reply('mystery')]);
 const a=new Agent({repo:c.repo,session:c.session,lexicon,config:{formalizer:m.config}});
 for(const surface of ['bank','mystery']){const answer=await a.turn('Who has '+surface+'?',{language:'en',rewrite:false});assert.equal(answer.packet.status,'clarify');assert.equal(answer.trace.some(x=>x.wire==='q'&&x.status==='blocked'),true);}
 assert.equal(m.requests.length,2);assert.equal(Object.keys(c.session.live.claims).length,0);
});
test('model-written resolution cannot enlarge the input vocabulary',async t=>{
 const c=context();t.after(c.dispose);
 const m=await mock(t,['@who resolve\n  text "Carina"\n  language en\n  kind entity\n@q query\n  where works_at($who, lab_alpha)\n@r solve\n  query $q\n@answer cnl\n  result $r']);
 const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});
 await assert.rejects(()=>a.turn('Maria works at Alpha Lab?',{language:'en',rewrite:false}),/resolve text must come from/);
});
