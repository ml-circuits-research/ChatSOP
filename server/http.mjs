#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {Repository} from '../memory/repository.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {Runtime} from '../sop/runtime.mjs';
import {parse} from '../sop/parser.mjs';
import {SessionStore} from './session-store.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const error=(res,status,code,message)=>json(res,status,{error:{message,type:'invalid_request_error',code}});
const positive=(value,name)=>{if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid server limit: '+name);return value;};
const credentials=(tokens)=>{const entries=Object.entries(tokens);if(!entries.length||entries.some(([user,token])=>! /^[A-Za-z0-9_-]{1,80}$/.test(user)||typeof token!=='string'||token.length<16))throw Error('Bearer credentials must map named users to tokens of at least 16 characters');if(new Set(entries.map(x=>x[1])).size!==entries.length)throw Error('Bearer tokens must be unique per user');return entries;};
const authenticate=(header,users)=>{if(typeof header!=='string'||!header.startsWith('Bearer '))return null;const supplied=Buffer.from(header.slice(7));let user=null;for(const [name,key] of users){const expected=Buffer.from(key);if(supplied.length===expected.length&&timingSafeEqual(supplied,expected))user=name;}return user;};
async function readBody(req,maxBytes){let length=0,chunks=[];for await(const chunk of req){length+=chunk.length;if(length>maxBytes){req.resume();const e=new Error('Request body exceeds configured limit');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Expected a JSON request body');e.status=400;throw e;}}
function checkBody(body,model,maxContextBytes){if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Expected a chat completion object');if(body.model!==model)throw Error('Unsupported model');if(body.tools!==undefined||body.tool_choice!==undefined||body.functions!==undefined||body.function_call!==undefined)throw Error('Tools and function calling are not implemented');if(![undefined,false,true].includes(body.stream))throw Error('stream must be a boolean');if(!Array.isArray(body.messages)||body.messages.length!==1||body.messages[0]?.role!=='user'||typeof body.messages[0].content!=='string'||!body.messages[0].content.trim()||Object.keys(body.messages[0]).some(k=>!['role','content'].includes(k)))throw Error('Supply exactly one new user text message; conversation history is server-managed');if(Buffer.byteLength(body.messages[0].content)>maxContextBytes) {const e=new Error('Message exceeds context limit');e.status=413;throw e;}const allowed=new Set(['model','messages','stream','user','conversation_id','chatSop']);if(Object.keys(body).some(k=>!allowed.has(k)))throw Error('Unsupported chat completion parameter');if(body.chatSop!==undefined&&(typeof body.chatSop!=='object'||!body.chatSop||Array.isArray(body.chatSop)||Object.keys(body.chatSop).some(k=>k!=='trustedSop')||typeof body.chatSop.trustedSop!=='string'))throw Error('Invalid chatSop trusted circuit');return body.messages[0].content;}
function checkedTrusted(source){const wires=parse(source).wires;if(!wires.length||!wires.some(w=>w.type==='remember')||wires.some(w=>!['fact','event','remember'].includes(w.type)))throw Error('Trusted circuit requires an explicit remember of facts or events');return source;}
function trace(result,formalizer,system){const packet=result.packet??{};return {prompt_profile:result.promptProfile,circuit:result.executionSop,model_sop:result.sop,provenance:packet.proof??[],backend:packet.route?.backend??packet.backend??null,fallback:packet.route?.fallback??packet.fallback??null,completeness:packet.complete??packet.completeness??null,cnl:result.cnl,status:packet.status??null,pendingSop:packet.pendingSop??null,required:packet.required??null,system_circuit:system?.source??null,system_receipt:system?.receipt??null,formalizer_model:formalizer.model};}
function completion(result,model,formalizer,system){const id='chatcmpl-'+randomUUID(),created=Math.floor(Date.now()/1000);return {id,object:'chat.completion',created,model,choices:[{index:0,message:{role:'assistant',content:result.text},finish_reason:'stop'}],usage:null,chatSop:trace(result,formalizer,system)};}
function sse(res,data){res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'});const base={id:data.id,created:data.created,model:data.model,object:'chat.completion.chunk'};res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:data.choices[0].message.content},finish_reason:null}],chatSop:data.chatSop})+'\n\n');res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');}
export function createServer({config,repo,lexicon,authTokens,base='demo',limits={},sessionRoot}={}){
 if(!config||!repo||!lexicon)throw Error('Server requires config, repository and lexicon');
 if(!['formal','bare'].includes(config.promptProfile))throw Error('Specify promptProfile: formal or bare explicitly; implicit profile mixing is forbidden');
 const formalizer=config.formalizer,model=config.model??'chatsop-local',users=credentials(authTokens??(process.env.CHATSOP_API_KEY?{local:process.env.CHATSOP_API_KEY}:{}));
 const maxRequestBytes=positive(limits.maxRequestBytes??65536,'maxRequestBytes'),maxContextBytes=positive(limits.maxContextBytes??4800,'maxContextBytes'),maxConcurrent=positive(limits.maxConcurrent??4,'maxConcurrent'),timeoutMs=positive(limits.timeoutMs??30000,'timeoutMs');
 const sessions=new SessionStore({repo,lexicon,config:{...config,contextMaxBytes:Math.min(config.contextMaxBytes??maxContextBytes,maxContextBytes),formalizer:formalizer?{...formalizer,timeoutMs:Math.min(formalizer.timeoutMs??timeoutMs,timeoutMs)}:undefined},root:sessionRoot??path.join(repo.root,'http-conversations')});
 let active=0;const busy=new Set();
 async function readiness(){
  if(!formalizer?.url||!formalizer?.model)return {ready:false,model_available:false};
  try{
   const u=new URL(formalizer.url);
   if(!['http:','https:'].includes(u.protocol))return {ready:false,model_available:false};
   if(!u.pathname.endsWith('/v1/chat/completions'))return {ready:false,model_available:false};
   u.pathname=u.pathname.slice(0,-'/v1/chat/completions'.length)+'/v1/models';u.search='';
   const response=await fetch(u,{headers:process.env.RECALL_LLM_KEY?{Authorization:'Bearer '+process.env.RECALL_LLM_KEY}:{},signal:AbortSignal.timeout(Math.min(timeoutMs,2000))});
   if(!response.ok)return {ready:false,model_available:false};
   const body=await response.json();
   const entry=Array.isArray(body.data)?body.data.find(x=>x.id===formalizer.model):null;
   if(!entry)return {ready:false,model_available:false};
   const actual=entry.chatSopIdentity;
   if(config.promptProfile==='bare'){
    const expected=config.backendIdentity,keys=['model_id','revision','tokenizer_sha256','dataset_version_sha256','prompt_profile'];
    if(!expected||!actual||keys.some(k=>typeof expected[k]!=='string'||!expected[k]||actual[k]!==expected[k])||actual.prompt_profile!=='bare')return {ready:false,model_available:false};
   }else if(actual?.prompt_profile&&actual.prompt_profile!=='formal')return {ready:false,model_available:false};
   return {ready:true,model_available:true};
  }catch{return {ready:false,model_available:false};}
 }
 const server=http.createServer(async(req,res)=>{
  const url=req.url?.split('?')[0];if(url==='/healthz'&&req.method==='GET')return json(res,200,{status:'ok'});
  const user=authenticate(req.headers.authorization,users);if(!user)return error(res,401,'unauthorized','Bearer authentication required');
  if(url==='/readyz'&&req.method==='GET'){const state=await readiness();return json(res,state.ready?200:503,state);}
  if(url==='/v1/models'&&req.method==='GET'){const state=await readiness();return json(res,200,{object:'list',data:state.ready?[{id:model,object:'model',created:0,owned_by:'chatsop'}]:[]});}
  if(['/v1/responses','/v1/embeddings'].includes(url)||url?.startsWith('/v1/tools'))return error(res,501,'not_implemented','This API surface is not implemented');
  if(url!=='/v1/chat/completions'||req.method!=='POST')return error(res,404,'not_found','Endpoint not found');
  if(active>=maxConcurrent)return error(res,429,'concurrency_limit','Server concurrency limit reached');
  let key;try{
   if(! (await readiness()).ready)return error(res,503,'model_unavailable','Formalizer model endpoint is not ready');
   const body=await readBody(req,maxRequestBytes),text=checkBody(body,model,maxContextBytes);
   if(body.user!==undefined&&body.user!==user)throw Error('Authenticated user mismatch');
   const conversation=body.conversation_id??'default';if(typeof conversation!=='string'||! /^[A-Za-z0-9_-]{1,80}$/.test(conversation))throw Error('Invalid conversation_id');
   key=user+'\0'+conversation;if(busy.has(key))return error(res,409,'conversation_busy','Conversation has an active request');
   const entry=sessions.get(user,conversation,base);let system=null;
   busy.add(key);active++;
   const work=(async()=>{
    if(body.chatSop){const source=checkedTrusted(body.chatSop.trustedSop),stored=await new Runtime({repo,session:entry.agent.session,schema:lexicon.predicates,lexicon,policy:{...config.policy,allowRules:false,allowPin:false,allowJsEval:false}}).run(source);system={source,receipt:stored.result};}
    const result=await entry.agent.turn(text,{language:'en',rewrite:false});sessions.save(entry,user,conversation,base);return result;
   })();work.finally(()=>{active--;busy.delete(key);}).catch(()=>{});
   const result=await Promise.race([work,new Promise((_,reject)=>{const timer=setTimeout(()=>{const e=new Error('Request time limit reached');e.status=504;reject(e);},timeoutMs);timer.unref();work.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
   if(res.destroyed)return;const data=completion(result,model,formalizer,system);if(body.stream)sse(res,data);else json(res,200,data);
  }catch(e){if(res.destroyed)return;const status=e.status??(e.name==='TimeoutError'||e.message==='Request time limit reached'?504:400);error(res,status,status===413?'request_limit':status===504?'time_limit':status===400?'invalid_request':'internal_error',status===400&&!e.status?'Invalid SOP or request; no model detail exposed':status===504?'Request time limit reached':e.status?e.message:'Server request failed');}
 });return server;
}
export async function startServer({configPath=path.join(root,'config/runtime.json'),host=process.env.CHATSOP_HOST??'127.0.0.1',port=Number(process.env.CHATSOP_PORT??3000)}={}){
 if(!['127.0.0.1','::1','localhost'].includes(host)&&process.env.CHATSOP_ALLOW_REMOTE!=='1')throw Error('Non-local binding requires CHATSOP_ALLOW_REMOTE=1');
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));const selected=process.env.CHATSOP_PROMPT_PROFILE;
 if(selected&&config.promptProfile&&config.promptProfile!==selected)throw Error('Prompt profile mismatch between config and environment');
 config.promptProfile=selected??config.promptProfile;
 if(!config.promptProfile)throw Error('Configure promptProfile explicitly (formal for base models, bare for qualified fine-tuned models)');
 const project=path.resolve(root),repo=new Repository(path.resolve(project,config.root??'state'),{memory:config.memory}),lexicon=Lexicon.load(path.resolve(project,config.ontology??'config/ontology.sop'));
 repo.init(config.base??'demo');
 const server=createServer({config,repo,lexicon,base:config.base??'demo',limits:config.server?.limits});await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){startServer({configPath:process.env.CHATSOP_CONFIG??path.join(root,'config/runtime.json')}).then(server=>console.log('ChatSOP listening on '+JSON.stringify(server.address()))).catch(e=>{console.error(e.message);process.exitCode=1;});}
