import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Repository} from '../memory/repository.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {createServer} from '../server/http.mjs';

const tokens={alice:'alice-secret-token-123456',bob:'bob-secret-token-123456'};
const query='@q query\n  where likes ana lab_alpha';
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
async function close(server){await new Promise(resolve=>server.close(resolve));}
async function fixture(t,{replies={},lexicon,limits={},config={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chatsop-http-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=new Repository(root);repo.init('base');
 const lex=lexicon??Lexicon.load(new URL('../config/ontology.sop',import.meta.url));
 const calls=[];const mock=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'mock',chatSopIdentity:config.backendIdentity}]}));return;}
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);calls.push(body);
  const answer=replies[body.messages[0].content.split('\nMESSAGE\n').at(-1)]??query;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
 });const endpoint=await listen(mock);t.after(()=>close(mock));
 const formalizer={url:endpoint+'/v1/chat/completions',model:'mock'};
 const options={repo,lexicon:lex,base:'base',authTokens:tokens,limits,config:{promptProfile:'formal',formalizer,policy:{allowWrite:true},...config}};
 let server=createServer(options),url=await listen(server);
 t.after(async()=>{if(server.listening)await close(server);});
 async function restart(){await close(server);server=createServer({...options,repo:new Repository(root),sessionRoot:path.join(root,'http-conversations')});url=await listen(server);}
 async function request(method,route,body,token=tokens.alice){const response=await fetch(url+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const raw=await response.text();return {status:response.status,body:raw&&!response.headers.get('content-type')?.includes('text/event-stream')?JSON.parse(raw):null,raw,headers:response.headers};}
 async function chat(text,{conversation_id='c1',token=tokens.alice,...extra}={}){return request('POST','/v1/chat/completions',{model:'chatsop-local',messages:[{role:'user',content:text}],conversation_id,...extra},token);}
 return {repo,lex,formalizer,endpoint,calls,request,chat,restart,get url(){return url;}};
}
const record=atom=>`@f fact\n  holds ${atom}\n  valid timeless\n  source user\n@s remember\n  input $f`;

test('authenticated model discovery, readiness, profile and streaming expose one verified trace',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('GET','/healthz')).status,200);
 assert.deepEqual((await f.request('GET','/readyz')).body,{ready:true,model_available:true});
 assert.equal((await f.request('GET','/v1/models')).body.data[0].id,'chatsop-local');
 const reply=await f.chat('Ana likes Alpha Lab?',{stream:true});assert.equal(reply.status,200);
 assert.match(reply.headers.get('content-type'),/text\/event-stream/);assert.match(reply.raw,/data: \[DONE\]/);
 const event=JSON.parse(reply.raw.split('\n')[0].slice(6));assert.equal(event.chatSop.status,'unknown');assert.equal(event.chatSop.prompt_profile,'formal');assert.equal(event.chatSop.backend,'js');assert.equal(event.chatSop.completeness,true);assert.equal(event.chatSop.fallback,null);assert.match(event.chatSop.circuit,/@\w+ solve/);assert.match(f.calls[0].messages[0].content,/You are|SOP|formalizer/i);
});

test('remember, correction, contradiction, UNKNOWN, restart and principal isolation',async t=>{
 const f=await fixture(t);
 const first=await f.chat('Ana likes Alpha Lab?',{chatSop:{trustedSop:record('likes ana lab_alpha')}});
 assert.equal(first.status,200);assert.equal(first.body.chatSop.status,'supported');assert.match(first.body.chatSop.system_circuit,/@s remember/);
 const id=first.body.chatSop.system_receipt.ids[0];assert.ok(id);
 assert.equal((await f.chat('Ana likes Alpha Lab?',{token:tokens.bob})).body.chatSop.status,'unknown');
 const correction=`@f fact\n  holds likes ana lab_beta\n  valid timeless\n  source user\n@e event\n  action correct\n  target "${id}"\n  replacement $f\n@s remember\n  input $e`;
 const corrected=await f.chat('Ana likes Alpha Lab?',{chatSop:{trustedSop:correction}});
 assert.equal(corrected.body.chatSop.status,'unknown');assert.equal(corrected.body.chatSop.system_receipt.count,2);
 const conflict=await f.chat('Ana likes Alpha Lab?',{chatSop:{trustedSop:record('likes ana lab_alpha').replace('source user','source corrected_user')+'\n@n fact\n  holds not likes ana lab_alpha\n  valid timeless\n  source user\n@sn remember\n  input $n'}});
 assert.equal(conflict.body.chatSop.status,'both');assert.ok(conflict.body.chatSop.provenance.length);
 await f.restart();assert.equal((await f.chat('Ana likes Alpha Lab?')).body.chatSop.status,'both');
 assert.equal((await f.chat('Ana likes Alpha Lab?',{token:tokens.bob})).body.chatSop.status,'unknown');
 assert.ok(f.calls.length>=6);
});

test('ambiguous alias returns pendingSop and host clarification continues after restart',async t=>{
 const lex=new Lexicon('@has predicate\n  args person\n  label en "has"\n@person1 entity\n  kind person\n  label en "bank"\n@person2 entity\n  kind person\n  label en "bank"');
 const f=await fixture(t,{lexicon:lex,replies:{'Who has bank?':'@q query\n  where has "bank"','I mean the first one.':'@q query\n  where has person1'}});
 const first=await f.chat('Who has bank?');assert.equal(first.body.chatSop.status,'clarify');assert.match(first.body.chatSop.pendingSop,/@q query/);assert.deepEqual(first.body.chatSop.required[0].candidates.map(c=>c.id),['person1','person2']);
 await f.restart();const next=await f.chat('I mean the first one.');assert.equal(next.body.chatSop.status,'unknown');assert.match(f.calls[1].messages[0].content,/pending_clarification/);
});

test('fail closed, bearer security, request limits, unsupported surfaces and model privilege refusal',async t=>{
 const f=await fixture(t,{limits:{maxRequestBytes:1600,maxContextBytes:180}});
 assert.equal((await f.request('GET','/v1/models',null,null)).status,401);
 assert.equal((await f.request('GET','/readyz',null,'wrong-secret-token-123456')).status,401);
 assert.equal((await f.chat('x'.repeat(181))).status,413);
 assert.equal((await f.chat('Ana likes Alpha Lab?',{user:'bob'})).status,400);
 for(const route of ['/v1/responses','/v1/embeddings','/v1/tools'])assert.equal((await f.request('POST',route,{})).status,501);
 assert.equal((await f.chat('x',{tools:[]})).status,400);
 const injected=await fixture(t,{replies:{'Record this':'@f fact\n  holds likes ana lab_alpha\n  valid timeless\n@s remember\n  input $f'}});
 assert.equal((await injected.chat('Record this')).status,400);assert.equal(Object.keys(injected.repo.session('base','alice','c1').live.claims).length,0);
 const offline=createServer({config:{promptProfile:'formal'},repo:f.repo,lexicon:f.lex,base:'base',authTokens:tokens});const url=await listen(offline);t.after(()=>close(offline));const response=await fetch(url+'/readyz',{headers:{Authorization:'Bearer '+tokens.alice}});assert.equal(response.status,503);assert.equal((await response.json()).model_available,false);
});

test('bare mode requires matched attestation and sends only CONTEXT plus MESSAGE',async t=>{
 const identity={model_id:'mock-base',revision:'pinned-revision',tokenizer_sha256:'tokenizer-digest',dataset_version_sha256:'data-digest',prompt_profile:'bare'};
 const f=await fixture(t,{config:{promptProfile:'bare',backendIdentity:identity}});
 const answer=await f.chat('Ana likes Alpha Lab?');assert.equal(answer.status,200);assert.equal(answer.body.chatSop.prompt_profile,'bare');assert.match(f.calls[0].messages[0].content,/^CONTEXT\n/);assert.doesNotMatch(f.calls[0].messages[0].content,/You are/);
 const refused=createServer({repo:f.repo,lexicon:f.lex,base:'base',authTokens:tokens,config:{promptProfile:'bare',formalizer:f.formalizer,backendIdentity:{...identity,revision:'wrong'}}});const url=await listen(refused);t.after(()=>close(refused));const response=await fetch(url+'/readyz',{headers:{Authorization:'Bearer '+tokens.alice}});assert.equal(response.status,503);
 assert.throws(()=>createServer({repo:f.repo,lexicon:f.lex,base:'base',authTokens:tokens,config:{formalizer:f.formalizer}}),/promptProfile/);
});
