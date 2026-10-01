#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {Repository} from '../memory/repository.mjs';
import {demoLexicon} from '../lib/knowledge-seeds.mjs';
import {Runtime} from '../sop/runtime.mjs';
import {parse} from '../sop/parser.mjs';
import {SessionStore} from './session-store.mjs';
import {Auth,sessionCookie,readCookie} from './auth.mjs';
import {createAuditRouter} from './audit.mjs';
import {handleWeb,createSignedInRoutes} from './web.mjs';
import {sendHtml} from './pages/layout.mjs';
import {adminPage} from './pages/admin.mjs';
import {chatPage} from './pages/chat.mjs';
import {answerLanguage,LANGUAGE_CHOICES} from './language.mjs';
import {loadRegistry,FormalizerManager,MODES,isManaged} from './formalizers.mjs';
import {createServerModels} from './server-models.mjs';
import {TRANSLATE_PROMPT,chatSystemPrompt,ChatHistory} from './chat-modes.mjs';
import {loadTextToCleanEnglishConfig} from '../lib/text-to-clean-english/index.mjs';
import {createCapabilities,REWRITE_MODES} from './capabilities.mjs';
import {createApiRouter} from './api.mjs';
import {createProductRouter,PRODUCT_ENDPOINTS} from './product.mjs';
import {BaseMemories,ensureDefaultBase} from '../lib/chat-data/memories.mjs';
import {ChatData} from '../lib/chat-data/index.mjs';
import {Sessions} from '../lib/chat-data/sessions.mjs';
import {SessionRuntimes} from './session-runtime.mjs';
import {createAuthoring,AUTHORING_ENDPOINTS} from './authoring.mjs';
import {ompSettings,createOmpModels} from '../lib/omp/index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const error=(res,status,code,message)=>json(res,status,{error:{message,type:'invalid_request_error',code}});
const positive=(value,name)=>{if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid server limit: '+name);return value;};
const credentials=(tokens)=>{const entries=Object.entries(tokens);
 if(!entries.length)throw Error('No bearer credentials configured. Set CHATSOP_API_KEY (at least 16 characters), or start with `npm start` which generates a token for you.');
 const bad=entries.find(([user,token])=>! /^[A-Za-z0-9_-]{1,80}$/.test(user)||typeof token!=='string');
 if(bad)throw Error('Bearer credentials map a user name (letters, digits, _ or -) to a token; invalid entry for user '+JSON.stringify(bad[0]));
 const short=entries.find(([,token])=>token.length<16);
 if(short)throw Error('Bearer token for user '+JSON.stringify(short[0])+' is '+JSON.stringify(short[1]).length+' characters; tokens must be at least 16 characters');
 if(new Set(entries.map(x=>x[1])).size!==entries.length)throw Error('Bearer tokens must be unique per user');
 return entries;};
const authenticate=(header,users)=>{if(typeof header!=='string'||!header.startsWith('Bearer '))return null;const supplied=Buffer.from(header.slice(7));let user=null;for(const [name,key] of users){const expected=Buffer.from(key);if(supplied.length===expected.length&&timingSafeEqual(supplied,expected))user=name;}return user;};
async function readBody(req,maxBytes){let length=0,chunks=[];for await(const chunk of req){length+=chunk.length;if(length>maxBytes){req.resume();const e=new Error('Request body exceeds configured limit');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Expected a JSON request body');e.status=400;throw e;}}
const invalid=(message,code='invalid_request')=>Object.assign(new Error(message),{status:400,code});
/** Validates a chat completion request; `models` is the set of accepted `model` values (façade id and registry ids). */
function checkBody(body,models,maxContextBytes){if(!body||typeof body!=='object'||Array.isArray(body))throw invalid('Expected a chat completion object');if(typeof body.model!=='string'||!models.has(body.model))throw invalid('Unknown model '+JSON.stringify(String(body.model).slice(0,80))+'; GET /v1/models lists the available models: '+[...models].join(', '),'unknown_model');if(body.tools!==undefined||body.tool_choice!==undefined||body.functions!==undefined||body.function_call!==undefined)throw invalid('Tools and function calling are not implemented');if(![undefined,false,true].includes(body.stream))throw invalid('stream must be a boolean');if(!Array.isArray(body.messages)||body.messages.length!==1||body.messages[0]?.role!=='user'||typeof body.messages[0].content!=='string'||!body.messages[0].content.trim()||Object.keys(body.messages[0]).some(k=>!['role','content'].includes(k)))throw invalid('Supply exactly one new user text message; conversation history is server-managed');if(Buffer.byteLength(body.messages[0].content)>maxContextBytes) {const e=new Error('Message exceeds context limit');e.status=413;throw e;}const allowed=new Set(['model','messages','stream','user','conversation_id','session_id','chatSop','language','mode','cleaning','understanding']);if(Object.keys(body).some(k=>!allowed.has(k)))throw invalid('Unsupported chat completion parameter');if(body.mode!==undefined&&!MODES.includes(body.mode))throw invalid('mode must be chat, formalize or translate','unsupported_mode');if(body.chatSop!==undefined&&(body.mode??'formalize')!=='formalize')throw invalid('A chatSop trusted circuit needs mode formalize','unsupported_mode');if(body.language!==undefined&&!LANGUAGE_CHOICES.includes(body.language))throw invalid('language must be en, ro or auto');if(body.chatSop!==undefined&&(typeof body.chatSop!=='object'||!body.chatSop||Array.isArray(body.chatSop)||Object.keys(body.chatSop).some(k=>k!=='trustedSop')||typeof body.chatSop.trustedSop!=='string'))throw invalid('Invalid chatSop trusted circuit');if(body.cleaning!==undefined&&(typeof body.cleaning!=='object'||!body.cleaning||Array.isArray(body.cleaning)||typeof body.cleaning.original!=='string'||Object.keys(body.cleaning).some(k=>!['original','backend','changed'].includes(k))))throw invalid('Invalid cleaning trace object; expected {original, backend?, changed?}');if(body.understanding!==undefined){const u=body.understanding;if(typeof u!=='object'||!u||Array.isArray(u)||Object.keys(u).some(k=>!['interpret','rewrite','emotion'].includes(k))||(u.interpret!==undefined&&typeof u.interpret!=='boolean')||(u.emotion!==undefined&&typeof u.emotion!=='boolean')||(u.rewrite!==undefined&&!REWRITE_MODES.includes(u.rewrite)))throw invalid('Invalid understanding object; expected {interpret?: boolean, rewrite?: off|gated|always, emotion?: boolean}');if((body.mode??'formalize')!=='formalize')throw invalid('understanding needs mode formalize','unsupported_mode');}return body.messages[0].content;}
function checkedTrusted(source){const wires=parse(source).wires;if(!wires.length||!wires.some(w=>w.type==='remember')||wires.some(w=>!['fact','event','remember'].includes(w.type)))throw Error('Trusted circuit requires an explicit remember of facts or events');return source;}
const docsRoot=path.join(root,'docs');
const mimeTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8','.woff2':'font/woff2','.map':'application/json'};
function serveDocs(res,url){
 let relative;try{relative=decodeURIComponent(url.slice('/docs/'.length));}catch{return error(res,400,'invalid_path','Malformed static path');}
 if(relative.includes('\0'))return error(res,400,'invalid_path','Unsafe static path');
 const target=path.resolve(docsRoot,relative);
 if(target!==docsRoot&&!target.startsWith(docsRoot+path.sep))return error(res,400,'invalid_path','Unsafe static path');
 const resolved=fs.statSync(target,{throwIfNoEntry:false})?.isDirectory()?path.join(target,'index.html'):target;
 const stat=fs.statSync(resolved,{throwIfNoEntry:false});
 if(!stat||!stat.isFile())return error(res,404,'not_found','Static file not found');
 const body=fs.readFileSync(resolved),extension=path.extname(resolved).toLowerCase();
 res.writeHead(200,{'Content-Type':mimeTypes[extension]??'application/octet-stream','Content-Length':body.length,'Cache-Control':extension==='.html'?'no-cache':'max-age=300'});
 res.end(body);
}
/** Repository Markdown served read-only at its repository path (GET, signed-in): skills, READMEs and the root notes. */
export const REPO_MARKDOWN=/^\/(?:skills\/(?:README\.md|[A-Za-z0-9-]+\/SKILL\.md)|eval\/README\.md|datasets\/SOURCES\.md|(?:README|AGENTS|TODO|CHANGES|questions|dependencies)\.md)$/;
function serveRepoMarkdown(res,url){
 const file=path.join(root,url.slice(1));
 const stat=fs.statSync(file,{throwIfNoEntry:false});
 if(!stat||!stat.isFile())return error(res,404,'not_found','File not found');
 const body=fs.readFileSync(file);
 res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
 res.end(body);
}
const bearerToken=header=>{const match=/^Bearer\s+(.+)$/.exec(String(header??''));return match?match[1].trim():null;};
const readJsonBody=async(req,limit=1_000_000)=>{let raw='';for await(const chunk of req)raw+=chunk;assertBody(raw.length<=limit,'Request body exceeds the admin limit');return raw?JSON.parse(raw):{};};
const assertBody=(condition,message)=>{if(!condition){const e=new Error(message);e.status=413;throw e;}};

async function handleAdmin(req,res,url,auth,readiness){
 try{
  return await adminRoutes(req,res,url,auth,readiness);
 }catch(e){
  const status=e.status??(e.code==='invalid_credentials'?401:400);
  return error(res,status,e.code??'invalid_request',e.message);
 }
}
async function adminRoutes(req,res,url,auth,readiness){
 const method=req.method;
 if(method==='GET'&&url==='/admin'){
  return sendHtml(res,200,adminPage({signedIn:Boolean(auth.session(readCookie(req.headers.cookie,'chatsop_session')))}));
 }
 if(method==='GET'&&url==='/admin/status'){
  const state=await readiness();
  const session=auth.session(readCookie(req.headers.cookie,'chatsop_session'));
  return json(res,200,{configured:auth.configured,authenticated:Boolean(session),ready:state.ready,model_available:state.model_available===true,prompt_profile:state.prompt_profile??null,tokens:auth.configured&&session?auth.tokens():undefined});
 }
 if(method==='POST'&&url==='/admin/setup'){
  const body=await readJsonBody(req);
  const token=auth.setup(body.password);
  res.setHeader('Set-Cookie',sessionCookie(token));
  return json(res,200,{configured:true,authenticated:true});
 }
 if(method==='POST'&&url==='/admin/login'){
  const body=await readJsonBody(req);
  const token=auth.login(body.password);
  if(!token){const failure=new Error('Wrong administrator password');failure.code='invalid_credentials';throw failure;}
  res.setHeader('Set-Cookie',sessionCookie(token));
  return json(res,200,{authenticated:true});
 }
 if(method==='POST'&&url==='/admin/logout'){
  auth.logout(readCookie(req.headers.cookie,'chatsop_session'));
  res.setHeader('Set-Cookie','chatsop_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return json(res,200,{authenticated:false});
 }
 const session=auth.session(readCookie(req.headers.cookie,'chatsop_session'));
 if(!session)return error(res,401,'unauthorized','Sign in on /login first');
 if(method==='POST'&&url==='/admin/token'){
  const body=await readJsonBody(req);
  return json(res,200,auth.mintToken(body.label));
 }
 if(method==='POST'&&url==='/admin/token/revoke'){
  const body=await readJsonBody(req);
  return json(res,200,{revoked:auth.revoke(body.id)});
 }
 return error(res,404,'not_found','Endpoint not found');
}

function trace(result,formalizer,system,cleaning,understanding){const packet=result.packet??{};return {mode:'formalize',latency_ms:result.formalization?.ms??null,prompt_profile:result.promptProfile,formalizer_label:formalizer.label??null,formalization_ms:result.formalization?.ms??null,circuit:result.executionSop,model_sop:result.sop,provenance:packet.proof??[],backend:packet.route?.backend??packet.backend??null,fallback:packet.route?.fallback??packet.fallback??null,completeness:packet.complete??packet.completeness??null,cnl:result.cnl,status:packet.status??null,pendingSop:packet.pendingSop??null,required:packet.required??null,reinforcement:packet.reinforcement??null,answer_language:result.answerLanguage??null,language_source:result.languageSource??null,user_statements:result.userStatements??[],carried_statements:result.carriedStatements??[],model_assumptions:result.modelAssumptions??[],assumption_policy:result.assumptionPolicy??null,assumption_branch:result.assumptionBranch??null,unclear:result.unclear??null,understood_as:packet.understood_as??null,system_circuit:system?.source??null,system_receipt:system?.receipt??null,formalizer_model:formalizer.id??formalizer.model,cleaning:cleaning?{original:cleaning.original,backend:cleaning.backend??null,changed:cleaning.changed??null}:null,understanding:understanding??null};}
function completion(result,model,formalizer,system,cleaning,understanding){const id='chatcmpl-'+randomUUID(),created=Math.floor(Date.now()/1000);return {id,object:'chat.completion',created,model,choices:[{index:0,message:{role:'assistant',content:result.text},finish_reason:'stop'}],usage:null,chatSop:trace(result,formalizer,system,cleaning,understanding)};}
/** A Chat or Translate reply of a base model: the text as generated and a trace of mode, model and latency. */
function plainCompletion(reply,model,chosen,mode,extra){const id='chatcmpl-'+randomUUID(),created=Math.floor(Date.now()/1000);return {id,object:'chat.completion',created,model,choices:[{index:0,message:{role:'assistant',content:reply.text},finish_reason:reply.finish==='length'?'length':'stop'}],usage:reply.usage??null,chatSop:{mode,status:'answered',formalizer_model:chosen.id,formalizer_label:chosen.label,model_label:chosen.label,latency_ms:Math.round(reply.ms),finish:reply.finish??null,usage:reply.usage??null,...extra}};}
function sse(res,data){res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'});const base={id:data.id,created:data.created,model:data.model,object:'chat.completion.chunk'};res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:data.choices[0].message.content},finish_reason:null}],chatSop:data.chatSop})+'\n\n');res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');}
/**
 * `formalizers`, when given, is `{registry, manager}` (server/formalizers.mjs): the chat then accepts every
 * registry id as `model`, the façade id selects the registry default, and readiness reports each model's state.
 */
export function createServer({config,repo,lexicon,authTokens,auth=null,base='demo',limits={},sessionRoot,formalizers=null,chatData=null,serverModelsFile}={}){
 if(!config||!repo||!lexicon)throw Error('Server requires config, repository and lexicon');
 if(!['formal','bare'].includes(config.promptProfile))throw Error('Specify promptProfile: formal or bare explicitly; implicit profile mixing is forbidden');
 const formalizer=config.formalizer,model=config.model??'chatsop-local';
 const users=auth?null:credentials(authTokens??(process.env.CHATSOP_API_KEY?{local:process.env.CHATSOP_API_KEY}:{}));
 const maxRequestBytes=positive(limits.maxRequestBytes??65536,'maxRequestBytes'),maxContextBytes=positive(limits.maxContextBytes??4800,'maxContextBytes'),maxConcurrent=positive(limits.maxConcurrent??4,'maxConcurrent'),timeoutMs=positive(limits.timeoutMs??30000,'timeoutMs');
 const sessions=new SessionStore({repo,lexicon,config:{...config,contextMaxBytes:Math.min(config.contextMaxBytes??maxContextBytes,maxContextBytes),formalizer:formalizer?{...formalizer,timeoutMs:Math.min(formalizer.timeoutMs??timeoutMs,timeoutMs)}:undefined},root:sessionRoot??path.join(repo.root,'http-conversations')});
 const pages=createSignedInRoutes();
 const audit=createAuditRouter({ledgerDir:process.env.CHATSOP_AUDIT_LEDGER?path.resolve(process.env.CHATSOP_AUDIT_LEDGER):path.join(root,'eval/reports/current/audit')});
 let active=0;const busy=new Set();
 async function endpointCheck(){
  if(!formalizer?.url||!formalizer?.model)return {ready:false,model_available:false,prompt_profile:config.promptProfile};
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
  }catch{return {ready:false,model_available:false,prompt_profile:config.promptProfile};}
 }
 const registry=formalizers?.registry??null,manager=formalizers?.manager??null;
 const accepted=new Set([model,...(registry?registry.models.map(m=>m.id):[])]);
 /** The registry model a request's `model` selects for `mode` (the façade id selects the mode's default), or null without a registry. */
 const selectModel=(id,mode='formalize')=>{
  if(!registry)return null;
  const chosen=registry.models.find(m=>m.id===(id===model?registry.defaults[mode]??registry.default:id));
  if(!chosen||!chosen.capabilities.includes(mode)){const offered=registry.models.filter(m=>m.capabilities.includes(mode)).map(m=>m.id);throw invalid('Model '+JSON.stringify(id)+' does not offer mode '+mode+(offered.length?'; models for '+mode+': '+offered.join(', '):'; no model offers it'),'unsupported_mode');}
  return chosen;
 };
 // Chat-mode history per user and conversation (in memory, bounded; server-managed like the formalize context).
 const chatHistory=new ChatHistory();
 const capabilities=createCapabilities({registry,manager,timeoutMs,cache:limits.cache});
 const serverModels=registry&&manager?createServerModels({registry,manager,...(serverModelsFile?{file:serverModelsFile}:{}),warm:capabilities.warmState}):null;
 const api=createApiRouter({capabilities,serverModels,json,error,readBody,limits:{maxRequestBytes,maxContextBytes,maxConcurrent:limits.maxConcurrentApi??16},extraEndpoints:chatData?[...PRODUCT_ENDPOINTS,...AUTHORING_ENDPOINTS]:[]});
 // The product layer (DS031): base memories, sessions, omp. Present when a chat data root is configured (startServer always does).
 const memories=chatData?new BaseMemories({chatData,memory:config.memory}):null;
 if(memories)ensureDefaultBase(memories,config);
 const sessionStore=chatData?new Sessions({chatData,memories,memory:config.memory}):null;
 const runtimes=chatData?new SessionRuntimes({sessions:sessionStore,memories,config:{...config,contextMaxBytes:Math.min(config.contextMaxBytes??maxContextBytes,maxContextBytes),formalizer:formalizer?{...formalizer,timeoutMs:Math.min(formalizer.timeoutMs??timeoutMs,timeoutMs)}:undefined},defaultBase:config.chatData?.defaultBase??'default'}):null;
 const omp=chatData?ompSettings(config):null,ompModels=chatData?createOmpModels(omp):null;
 const authoring=chatData?createAuthoring({sessions:sessionStore,runtimes,chatData,models:ompModels,settings:omp,readBody,json,maxBytes:limits.maxProductBytes??8_000_000,capabilities}):null;
 const product=chatData?createProductRouter({memories,sessions:sessionStore,runtimes,readBody,json,limits,extra:authoring}):null;
 const rewriteDefault=capabilities.rewriteDefault,emotionDefault=capabilities.emotionDefault;
 /** Defaults the chat page shows in its settings: the cleaning step's `sendAll`, the rewrite default and whether a SymbolicProofingLLM is registered. */
 const chatSettings=()=>{const cleaning=loadTextToCleanEnglishConfig();return {emotionEnabled:emotionDefault(),cleaningEnabled:cleaning.enabled!==false,sendAll:cleaning.llm?.sendAll===true,rewrite:rewriteDefault(),rewriteAvailable:Boolean(registry?.defaults?.['proofread-symbolic'])};};
 /** Per-model state: stopped, starting, ready or error (with the reason). */
 async function modelStates(){
  return registry.models.map(m=>{
   const state=manager.status(m.id);
   const defaults=Object.entries(registry.defaults).filter(([,id])=>id===m.id).map(([mode])=>mode);
   return {id:m.id,label:m.label,note:m.note,kind:m.kind,capabilities:m.capabilities,default:m.id===registry.default,default_for:defaults,...state,prompt_profile:m.capabilities.includes('formalize')?'bare':null};
  });
 }
 /** Without a registry: the configured endpoint's readiness. With one: ready while any model can answer. */
 async function readiness(){
  if(!registry)return endpointCheck();
  const models=await modelStates(),usable=models.some(m=>m.capabilities.includes('formalize')&&m.state!=='error');
  return {ready:usable,model_available:usable,prompt_profile:config.promptProfile,default_model:registry.default,default_models:registry.defaults,formalizers:models};
 }
 /** Chat or Translate with a base model (DS012 "Chat modes"): no SOP, no host execution, no repository access. */
 async function plainTurn(res,body,text,mode,chosen,user){
  const state=manager.status(chosen.id);
  if(state.state==='error'&&manager.missing(manager.entries.get(chosen.id)))return error(res,503,'model_unavailable','Model '+chosen.id+' cannot start: '+state.error);
  if(body.user!==undefined&&body.user!==user)throw Error('Authenticated user mismatch');
  const conversation=body.conversation_id??'default';if(typeof conversation!=='string'||! /^[A-Za-z0-9_-]{1,80}$/.test(conversation))throw Error('Invalid conversation_id');
  const key=user+'\0'+conversation;if(busy.has(key))return error(res,409,'conversation_busy','Conversation has an active request');
  busy.add(key);active++;
  try{
   const language=body.language??'auto',history=mode==='chat'?chatHistory.get(key):[];
   const system=mode==='translate'?TRANSLATE_PROMPT:chatSystemPrompt(language);
   const messages=[...(system?[{role:'system',content:system}]:[]),...history,{role:'user',content:text}];
   const reply=await manager.chat(chosen.id,mode,messages,{temperature:mode==='chat'?0.7:0,timeoutMs});
   if(mode==='chat')chatHistory.add(key,text,reply.text);
   if(res.destroyed)return;
   const data=plainCompletion(reply,body.model,chosen,mode,{answer_language:mode==='translate'?null:language==='auto'?null:language,language_source:mode==='translate'?'not applicable':language==='auto'?'model':'request',system_prompt:system,history_turns:history.length/2,sampling:mode==='chat'?'temperature 0.7, top_p 0.9':'greedy'});
   return body.stream?sse(res,data):json(res,200,data);
  }finally{active--;busy.delete(key);}
 }
 /** The caches inside running services (SymbolicLM: Stanza parse, sentence units, rewrite calls), read from their /health; never starts a service. */
 async function cacheServices(){
  const out={};
  for(const [id,entry] of manager?.entries??[])if(entry.model.kind==='service'&&entry.state==='ready')try{const r=await fetch(manager.url(entry)+'/health',{signal:AbortSignal.timeout(1000)});const h=await r.json();if(h.caches)out[id]=h.caches;}catch{}
  return out;
 }
 const server=http.createServer(async(req,res)=>{
  const url=req.url?.split('?')[0];if((url==='/healthz'||url==='/health')&&req.method==='GET')return json(res,200,{status:'ok',warm:capabilities.warmState()});
  // The documentation site is served statically and needs no authentication:
  // it is the same public HTML that lives under docs/ in the repository.
  if(req.method==='GET'&&url==='/docs'){res.writeHead(302,{Location:'/docs/'});return res.end();}
  if(req.method==='GET'&&url?.startsWith('/docs/'))return serveDocs(res,url);
  // Browser pages: home, /login, /logout and the login redirect of signed-out
  // page loads. They present the session-cookie auth; they never grant access.
  try{if(await handleWeb(req,res,url,{auth,readiness,formalizer}))return;}catch(e){if(res.headersSent)return res.end();return error(res,e.status??400,e.code??'invalid_request',e.message);}
  if(auth&&(url==='/admin'||url?.startsWith('/admin/')))return await handleAdmin(req,res,url,auth,readiness);
  const sessionUser=auth?auth.session(readCookie(req.headers.cookie,'chatsop_session')):null;
  const bearer=auth?auth.bearer(bearerToken(req.headers.authorization)):null;
  const legacy=users?authenticate(req.headers.authorization,users):null;
  const user=sessionUser??bearer??legacy;
  if(!user){
   if(auth&&!auth.usable)return error(res,403,'setup_required','Open /login in a browser and set the administrator password to enable this API');
   return error(res,401,'unauthorized','Bearer authentication required');
  }
  // Repository Markdown that the documentation links to (skills, the eval README, dataset sources, root notes),
  // served read-only as plain text to signed-in users so the server carries all documentation.
  if(req.method==='GET'&&REPO_MARKDOWN.test(url??''))return serveRepoMarkdown(res,url);
  if(url==='/audit'||url?.startsWith('/audit/')){
   if(!user)return error(res,401,'unauthorized','Sign in on /login first');
   try{
    const parsed=new URL(req.url,'http://localhost');
    const handled=await audit.handle(req,res,url,Object.fromEntries(parsed.searchParams),(status,body,type)=>json(res,status,body));
    if(handled)return;
   }catch(e){if(res.destroyed)return;return error(res,e.status??400,e.code??'invalid_request',e.message);}
  }
  try{const parsed=new URL(req.url,'http://localhost');if(await pages.handle(req,res,url,Object.fromEntries(parsed.searchParams),(status,body)=>json(res,status,body),{signedIn:Boolean(sessionUser)}))return;}catch(e){if(res.destroyed)return;return error(res,e.status??400,e.code??'invalid_request',e.message);}
  if(url==='/chat'&&req.method==='GET'){const state=await readiness();return sendHtml(res,200,chatPage({model,ready:state.ready,models:state.formalizers??null,defaultModel:state.default_model??null,defaultModels:state.default_models??null,settings:chatSettings()}));}
  if(url==='/readyz'&&req.method==='GET'){const state=await readiness();return json(res,state.ready?200:503,state);}
  if(url==='/v1/models'&&req.method==='GET'){
   const state=await readiness();
   if(!registry)return json(res,200,{object:'list',data:state.ready?[{id:model,object:'model',created:0,owned_by:'chatsop'}]:[]});
   return json(res,200,{object:'list',default:registry.default,defaults:registry.defaults,data:state.formalizers.map(({id,...chatsop})=>({id,object:'model',created:0,owned_by:'chatsop',chatsop}))});
  }
  // The independent capability APIs (DS030, docs/api.html): proofread (alias /v1/text-to-clean-english), understand, symbolic rewrite and analyze, emotion detect, capabilities, cache stats.
  if(product&&url?.startsWith('/v1/')&&await product.handle(req,res,url,{admin:Boolean(sessionUser)||(!auth&&Boolean(legacy)),user}))return;
  if(url?.startsWith('/v1/')&&await api.handle(req,res,url,{admin:Boolean(sessionUser)||(!auth&&Boolean(legacy)),cacheServices}))return;
 const start=/^\/v1\/models\/([^/]+)\/start$/.exec(url??'');
  if(start&&req.method==='POST'){
   // Starts a registry model ahead of the first message (the chat page calls it when a model is selected).
   const selected=registry?.models.find(m=>m.id===decodeURIComponent(start[1]));
   if(!selected)return error(res,404,'unknown_model','Unknown model; GET /v1/models lists the available models');
   if(isManaged(selected))manager.ensure(selected.id).catch(()=>{});
   const state=(await modelStates()).find(m=>m.id===selected.id);
   return json(res,isManaged(selected)&&state.state!=='error'?202:200,state);
  }
  if(['/v1/responses','/v1/embeddings'].includes(url)||url?.startsWith('/v1/tools'))return error(res,501,'not_implemented','This API surface is not implemented');
  if(url!=='/v1/chat/completions'||req.method!=='POST')return error(res,404,'not_found','Endpoint not found');
  if(active>=maxConcurrent)return error(res,429,'concurrency_limit','Server concurrency limit reached');
  let key,understanding=null;try{
   const body=await readBody(req,maxRequestBytes),text=checkBody(body,accepted,maxContextBytes);
   const mode=body.mode??'formalize';
   if(mode!=='formalize'&&!registry)throw invalid('Mode '+mode+' needs the model registry (config/formalizers.json) with a '+mode+' model','unsupported_mode');
   const chosenModel=selectModel(body.model,mode);
   if(mode!=='formalize')return await plainTurn(res,body,text,mode,chosenModel,user);
   if(isManaged(chosenModel)){const state=manager.status(chosenModel.id);if(state.state==='error'&&manager.missing(manager.entries.get(chosenModel.id)))return error(res,503,'model_unavailable','Formalizer '+chosenModel.id+' cannot start: '+state.error);}
   else if(!registry&&!(await endpointCheck()).ready)return error(res,503,'model_unavailable','Formalizer model endpoint is not ready');
   if(body.user!==undefined&&body.user!==user)throw Error('Authenticated user mismatch');
   const conversation=body.conversation_id??'default';if(typeof conversation!=='string'||! /^[A-Za-z0-9_-]{1,80}$/.test(conversation))throw Error('Invalid conversation_id');
   // Session mode (DS031): the turn runs in the session's own repository (a clone of its base memory). A request without session_id
   // uses one automatic session per user and conversation on the default base memory.
   const isAdmin=Boolean(sessionUser)||(!auth&&Boolean(legacy));
   let rt=null,sessionId=null;
   if(runtimes){
    if(body.session_id!==undefined&&(typeof body.session_id!=='string'||! /^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.session_id)))throw invalid('Invalid session_id','invalid_session');
    sessionId=body.session_id??runtimes.autoSession(user,conversation);
    rt=runtimes.open(sessionId,{user,admin:isAdmin});
   }
   key=rt?'session\0'+sessionId:user+'\0'+conversation;if(busy.has(key))return error(res,409,'conversation_busy','Conversation has an active request');
   const entry=rt?rt.entry(user):sessions.get(user,conversation,base);let system=null;
   busy.add(key);active++;
   const work=(async()=>{
    if(body.chatSop){const source=checkedTrusted(body.chatSop.trustedSop),stored=await new Runtime({repo:rt?rt.repo:repo,session:entry.agent.session,schema:(rt?.lexicon??lexicon).predicates,lexicon:rt?.lexicon??lexicon,policy:{...config.policy,allowRules:false,allowPin:false}}).run(source);system={source,receipt:stored.result};}
    const chosen=answerLanguage(text,body.language);
    const managed=isManaged(chosenModel)?{id:chosenModel.id,promptProfile:'bare',pragmatic:()=>understanding?.emotion??null,formalize:async message=>{
     if(chosenModel.kind!=='service'||chosenModel.id!==capabilities.symbolicId()){const reply=await manager.formalize(chosenModel.id,message,{timeoutMs});return reply.sop;}
     // SymbolicLM: the same cached call as POST /v1/understand (same message and rewrite setting), so the analysis the page already asked for is reused.
     const call=await capabilities.symbolicFormalize(message,body.understanding);
     const symbolic=call.symbolic,wantEmotion=typeof body.understanding?.emotion==='boolean'?body.understanding.emotion:capabilities.emotionDefault();
     let emotion=null;
     if(wantEmotion)try{const r=await capabilities.emotionFor(message,{leftoverSpans:symbolic?.interpretation?.available?symbolic.interpretation.not_represented:[]});emotion={signals:r.signals,emoji:capabilities.emojiOf(r.signals),leftovers:r.leftovers,sop:r.sop,trace:r.trace};}catch{}
     understanding={requested:{...call.requested,emotion:wantEmotion},cache:call.status,...(symbolic?{message:message,analysed_text:symbolic.analysed_text??null,route:symbolic.route??null,language:symbolic.language??null,english:symbolic.english??null,uncertainty:symbolic.uncertainty?{uncertain:symbolic.uncertainty.uncertain,kinds:symbolic.uncertainty.kinds}:null,rewrite:symbolic.rewrite??null,interpretation:symbolic.interpretation??null,emotion}:{emotion})};
     return call.sop;}}:null;
    const result=await entry.agent.turn(text,{language:chosen.language,answerLanguage:chosen.language,languageSource:chosen.source,rewrite:false,formalizer:managed});if(rt){rt.save(entry,user);sessionStore.appendTranscript(sessionId,{role:'user',text});sessionStore.appendTranscript(sessionId,{role:'assistant',text:result.text,status:result.packet?.status??null});}else sessions.save(entry,user,conversation,base);return result;
   })();work.finally(()=>{active--;busy.delete(key);}).catch(()=>{});
   const result=await Promise.race([work,new Promise((_,reject)=>{const timer=setTimeout(()=>{const e=new Error('Request time limit reached');e.status=504;reject(e);},timeoutMs);timer.unref();work.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
   if(res.destroyed)return;const data=completion(result,body.model,chosenModel?{id:isManaged(chosenModel)?chosenModel.id:formalizer.model,label:chosenModel.label}:formalizer,system,body.cleaning,understanding);if(rt)data.chatSop.session={id:sessionId,base:rt.info.base};if(body.stream)sse(res,data);else json(res,200,data);
  }catch(e){if(res.destroyed)return;
   // The model answered but its SOP was not admitted or could not be executed: 422 with what it wrote, so the chat can show it.
   if(e.modelSop!==undefined)return json(res,422,{error:{message:'The formalizer output was not admitted or could not be executed',type:'invalid_request_error',code:'model_output_rejected'},chatSop:{status:'rejected',rejection:String(e.message).slice(0,500),model_sop:e.modelSop,prompt_profile:e.promptProfile??null,formalizer_model:e.formalization?.model??null,formalization_ms:e.formalization?.ms??null,understanding}});
   const status=e.status??(e.name==='TimeoutError'||e.message==='Request time limit reached'?504:400);error(res,status,(e.status&&e.code)||(status===413?'request_limit':status===504?'time_limit':status===400?'invalid_request':'internal_error'),status===400&&!e.status?'Invalid SOP or request; no model detail exposed':status===504?'Request time limit reached':e.status?e.message:'Server request failed');}
 });server.auth=auth;server.capabilities=capabilities;server.serverModels=serverModels;server.sessions=sessionStore;server.memories=memories;server.authoring=authoring;server.ompModels=ompModels;server.ompSettings=omp;
 server.on('close',()=>capabilities.close());
 return server;
}
export async function startServer({configPath=path.join(root,'config/runtime.json'),host=process.env.CHATSOP_HOST??'0.0.0.0',port=Number(process.env.CHATSOP_PORT??9999)}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));const selected=process.env.CHATSOP_PROMPT_PROFILE;
 if(selected&&config.promptProfile&&config.promptProfile!==selected)throw Error('Prompt profile mismatch between config and environment');
 config.promptProfile=selected??config.promptProfile;
 if(!config.promptProfile)throw Error('Configure promptProfile explicitly (formal for base models, bare for qualified fine-tuned models)');
 const project=path.resolve(root),lexicon=demoLexicon();  // the lexicon of the code paths without sessions; every chat session uses its own base memory's lexicon
 // Chat data (DS031): every chat lives under one gitignored root. The runtime repository is the default base memory's own repository;
 // it is only a placeholder for the code paths without sessions, which session mode never uses for a chat.
 const chatData=ChatData.open(config,process.env,project),bases=new BaseMemories({chatData,memory:config.memory});
 const repo=bases.repository(ensureDefaultBase(bases,config));
 const stopCleanup=chatData.scheduleCleanup(report=>{if(report.error)console.error('chat data cleanup failed: '+report.error);else if(report.tmp.length||report.sessions.length)console.log('chat data cleanup removed '+report.tmp.length+' tmp folders and '+report.sessions.length+' abandoned sessions');});
 const auth=new Auth({file:path.resolve(project,config.auth?.file??'state/auth.json'),apiKey:process.env.CHATSOP_API_KEY??null});
 // The formalizer registry (DS012 "Formalizer models"): `config.formalizers` names its file, false disables it.
 const registryFile=config.formalizers===false?null:path.resolve(project,config.formalizers??'config/formalizers.json');
 const formalizers=registryFile&&fs.existsSync(registryFile)?(registry=>({registry,manager:new FormalizerManager({registry,logDir:path.resolve(project,config.root??'state','formalizer-logs')})}))(loadRegistry(registryFile)):null;
 const server=createServer({config,repo,lexicon,auth,base:'main',limits:config.server?.limits,formalizers,chatData,...(process.env.CHATSOP_SERVER_MODELS?{serverModelsFile:path.resolve(process.env.CHATSOP_SERVER_MODELS)}:{})});
 server.on('close',stopCleanup);
 if(formalizers){
  server.formalizers=formalizers;
  server.on('close',()=>formalizers.manager.stopAll());
  // Ctrl+C or a service stop ends the llama-server children before the process exits.
  const stop=signal=>{formalizers.manager.stopAll().finally(()=>process.exit(signal==='SIGINT'?130:143));};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }
 await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));
 // Warmup (DS012 "Model lifecycle"): the kept-open models start and are probed in the background; the server is usable at once. CHATSOP_WARMUP=0 or the `warmup` setting turns it off.
 if(formalizers&&server.serverModels&&server.serverModels.settings().warmup&&process.env.CHATSOP_WARMUP!=='0')setImmediate(()=>{(async()=>server.ompModels?.list?.())().catch(()=>{});return server.capabilities.warmup().then(state=>console.log('warmup: '+state.state+' in '+state.ms+' ms ('+Object.entries(state.models).filter(([,m])=>m.mode==='keep_open').map(([id,m])=>id+' '+(m.warm?'warm':m.state)).join(', ')+')')).catch(e=>console.error('warmup failed: '+e.message));});
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){startServer({configPath:process.env.CHATSOP_CONFIG??path.join(root,'config/runtime.json')}).then(server=>console.log('ChatSOP listening on '+JSON.stringify(server.address())+'\n  home (sign in, chat, audit, admin): http://127.0.0.1:'+server.address().port+'/\n  documentation: http://127.0.0.1:'+server.address().port+'/docs/')).catch(e=>{console.error(e.message);console.error('\nHint: `npm start` generates a token, serves the documentation and prints the access URLs.');process.exitCode=1;});}
