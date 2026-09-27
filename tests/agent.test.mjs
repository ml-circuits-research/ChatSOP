import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {Agent} from '../server/agent.mjs';import {context,lex} from './helpers.mjs';import {Lexicon} from '../sop/lexicon.mjs';import {complete} from '../server/llm.mjs';
async function mock(t,responses){let i=0;const requests=[];const server=http.createServer((req,res)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{requests.push(JSON.parse(s));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:responses[i]?.text??responses[i]},finish_reason:responses[i++]?.finish??'stop'}]}));});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return {config:{url:`http://127.0.0.1:${server.address().port}/v1/chat/completions`,model:'mock'},requests};}
test('model submits a query while the host exposes a separate execution circuit',async t=>{const c=context();t.after(c.dispose);const answer='@q query\n  where grandmother ana carina';const m=await mock(t,[answer,answer]);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});const first=await a.turn('Is Ana the grandmother of Carina?',{language:'en',rewrite:false});assert.equal(first.packet.status,'supported');assert.equal(first.sop,answer);assert.match(first.executionSop,/@\w+ solve/);assert.doesNotMatch(first.sop,/\b(?:solve|remember|cnl)\b/);assert.equal((await a.turn('Why?',{language:'en',rewrite:false})).packet.status,'supported');assert.equal(m.requests[0].response_format,undefined);assert.ok(m.requests[1].messages[0].content.includes('previous_query_sop'));});
test('truncated LLM output is never executed',async t=>{const m=await mock(t,[{text:'@f fact',finish:'length'}]);await assert.rejects(()=>complete(m.config,'x'),/truncated/);});
test('model-authored operations and documentary provenance never run',async t=>{const c=context();t.after(c.dispose);const forbidden=['@p fact\n  holds works_at maria lab_alpha\n  valid timeless','@q query\n  where works_at maria lab_alpha\n@s remember\n  input $q','@p premise\n  holds works_at maria lab_alpha\n  source forged_document'];const m=await mock(t,forbidden);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});for(const reply of forbidden)await assert.rejects(()=>a.turn('Maria works at Alpha Lab.',{language:'en',rewrite:false}));assert.equal(Object.keys(c.session.live.claims).length,0);});
test('unlisted entities cannot bypass the vocabulary shortlist',async t=>{const c=context();t.after(c.dispose);const m=await mock(t,['@p premise\n  holds works_at carina lab_alpha']);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});await assert.rejects(()=>a.turn('Maria works at Alpha Lab.',{language:'en',rewrite:false}),/outside its shortlist/);assert.equal(Object.keys(c.session.live.claims).length,0);});
test('entity types remain guarded in declarative premises',async t=>{const c=context();t.after(c.dispose);const m=await mock(t,['@p premise\n  holds works_at lab_alpha maria']);const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});await assert.rejects(()=>a.turn('Maria works at Alpha Lab.',{language:'en',rewrite:false}));assert.equal(Object.keys(c.session.live.claims).length,0);});
test('certified generated entity can be used without appearing literally in shortlist',()=>{const c=context();try{const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{}});const context={predicates:[{id:'parent'}],entities:[{id:'carina'}]};const wire={type:'query',fields:{where:['parent $who ?child']}};assert.doesNotThrow(()=>a.validateAtom({p:'parent',a:['ana','?child']},context,{wire,atomIndex:0,outputs:{who:{status:'bound',valueType:'person'}}}));assert.throws(()=>a.validateAtom({p:'parent',a:['ana','?child']},context,{wire,atomIndex:0,outputs:{who:{status:'bound',valueType:'organization'}}}),/output type/);}finally{c.dispose();}});
test('mock formalizer consumes canonical EN and RO entity aliases with one call per turn',async t=>{
 const c=context();t.after(c.dispose);
 const response=surface=>`@q query\n  where works_at maria "${surface}"`;
 const m=await mock(t,[response('Alpha Lab'),response('Alfa')]);
 const agent=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});
 const english=await agent.turn('Maria works at Alpha Lab?',{language:'en',rewrite:false});
 const romanian=await agent.turn('Maria lucrează la Alfa?',{language:'ro',rewrite:false});
 assert.equal(english.packet.status,'supported');assert.equal(romanian.packet.status,'supported');
 assert.match(english.executionSop,/@\w+ resolve/);assert.match(romanian.executionSop,/@\w+ resolve/);
 assert.equal(m.requests.length,2);assert.match(m.requests[0].messages[0].content,/"id":"lab_alpha"/);
 assert.ok(!m.requests[0].messages[0].content.includes('"aliases"'));
});
test('ambiguous and unknown aliases request clarification before downstream querying',async t=>{
 const c=context({bootstrap:false});t.after(c.dispose);
 const lexicon=new Lexicon('@has predicate\n  args person\n  label en "has"\n@person1 entity\n  kind person\n  label en "bank"\n@person2 entity\n  kind person\n  label en "bank"');
 const reply=surface=>`@q query\n  where has "${surface}"`;
 const m=await mock(t,[reply('bank'),reply('mystery')]);
 const a=new Agent({repo:c.repo,session:c.session,lexicon,config:{formalizer:m.config}});
 for(const surface of ['bank','mystery']){const answer=await a.turn('Who has '+surface+'?',{language:'en',rewrite:false});assert.equal(answer.packet.status,'clarify');assert.ok(answer.generated.some(g=>/@\w+ clarify/.test(g.source)));}
 assert.equal(m.requests.length,2);assert.equal(Object.keys(c.session.live.claims).length,0);
});
test('a clarification preserves the pending problem and only host-listed identity candidates',async t=>{
 const c=context({bootstrap:false});t.after(c.dispose);
 const lexicon=new Lexicon('@has predicate\n  args person\n  label en "has"\n@person1 entity\n  kind person\n  label en "bank"\n@person2 entity\n  kind person\n  label en "bank"');
 const m=await mock(t,['@q query\n  where has "bank"','@q query\n  where has person1']);
 const agent=new Agent({repo:c.repo,session:c.session,lexicon,config:{formalizer:m.config}});
 const ambiguous=await agent.turn('Who has bank?',{language:'en',rewrite:false});
 assert.equal(ambiguous.packet.status,'clarify');
 assert.equal(ambiguous.packet.reason,'unresolved_dependency');
 assert.match(ambiguous.packet.pendingSop,/@q query/);
 assert.deepEqual(ambiguous.packet.required[0].candidates.map(x=>x.id),['person1','person2']);
 const selected=await agent.turn('I mean the first one.',{language:'en',rewrite:false});
 assert.equal(selected.packet.status,'unknown');
 assert.match(m.requests[1].messages[0].content,/pending_clarification/);
 assert.equal(Object.keys(c.session.live.claims).length,0);
});
test('undeclared canonical identities cannot bypass the model shortlist',async t=>{
 const c=context();t.after(c.dispose);
 const m=await mock(t,['@q query\n  where works_at carina lab_alpha']);
 const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});
 await assert.rejects(()=>a.turn('Maria works at Alpha Lab?',{language:'en',rewrite:false}),/outside its shortlist/);
});
test('declarative premises remain conditional in one conversation, never repository facts',async t=>{
 const c=context({bootstrap:false});t.after(c.dispose);
 const m=await mock(t,['@p premise\n  holds likes ana lab_alpha','@q query\n  where likes ana lab_alpha','@q query\n  where likes ana lab_alpha']);
 const agent=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});
 const interpreted=await agent.turn('Ana likes Alpha Lab.',{language:'en',rewrite:false});
 assert.equal(interpreted.packet.status,'context_updated');
 assert.equal(Object.keys(c.session.live.claims).length,0);
 const related=await agent.turn('Ana likes Alpha Lab?',{language:'en',rewrite:false});
 assert.equal(related.packet.status,'supported');assert.equal(related.packet.hypothetical,true);
 assert.ok(m.requests[1].messages[0].content.includes('conditionalPremises'));
 const separate=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{formalizer:m.config}});
 const unrelated=await separate.turn('Ana likes Alpha Lab?',{language:'en',rewrite:false});
 assert.equal(unrelated.packet.status,'unknown');
 assert.equal(Object.keys(c.session.live.claims).length,0);
});
