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
import {Auth,sessionCookie,readCookie} from './auth.mjs';
import {createAuditRouter} from './audit.mjs';
import {handleWeb,createSignedInRoutes} from './web.mjs';
import {sendHtml} from './pages/layout.mjs';
import {adminPage} from './pages/admin.mjs';
import {chatPage} from './pages/chat.mjs';
import {answerLanguage,ANSWER_LANGUAGES} from './language.mjs';

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
function checkBody(body,model,maxContextBytes){if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Expected a chat completion object');if(body.model!==model)throw Error('Unsupported model');if(body.tools!==undefined||body.tool_choice!==undefined||body.functions!==undefined||body.function_call!==undefined)throw Error('Tools and function calling are not implemented');if(![undefined,false,true].includes(body.stream))throw Error('stream must be a boolean');if(!Array.isArray(body.messages)||body.messages.length!==1||body.messages[0]?.role!=='user'||typeof body.messages[0].content!=='string'||!body.messages[0].content.trim()||Object.keys(body.messages[0]).some(k=>!['role','content'].includes(k)))throw Error('Supply exactly one new user text message; conversation history is server-managed');if(Buffer.byteLength(body.messages[0].content)>maxContextBytes) {const e=new Error('Message exceeds context limit');e.status=413;throw e;}const allowed=new Set(['model','messages','stream','user','conversation_id','chatSop','language']);if(Object.keys(body).some(k=>!allowed.has(k)))throw Error('Unsupported chat completion parameter');if(body.language!==undefined&&!ANSWER_LANGUAGES.includes(body.language))throw Error('language must be en or ro');if(body.chatSop!==undefined&&(typeof body.chatSop!=='object'||!body.chatSop||Array.isArray(body.chatSop)||Object.keys(body.chatSop).some(k=>k!=='trustedSop')||typeof body.chatSop.trustedSop!=='string'))throw Error('Invalid chatSop trusted circuit');return body.messages[0].content;}
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

function trace(result,formalizer,system){const packet=result.packet??{};return {prompt_profile:result.promptProfile,circuit:result.executionSop,model_sop:result.sop,provenance:packet.proof??[],backend:packet.route?.backend??packet.backend??null,fallback:packet.route?.fallback??packet.fallback??null,completeness:packet.complete??packet.completeness??null,cnl:result.cnl,status:packet.status??null,pendingSop:packet.pendingSop??null,required:packet.required??null,reinforcement:packet.reinforcement??null,answer_language:result.answerLanguage??null,language_source:result.languageSource??null,user_statements:result.userStatements??[],carried_statements:result.carriedStatements??[],model_assumptions:result.modelAssumptions??[],assumption_policy:result.assumptionPolicy??null,assumption_branch:result.assumptionBranch??null,unclear:result.unclear??null,understood_as:packet.understood_as??null,system_circuit:system?.source??null,system_receipt:system?.receipt??null,formalizer_model:formalizer.model};}
function completion(result,model,formalizer,system){const id='chatcmpl-'+randomUUID(),created=Math.floor(Date.now()/1000);return {id,object:'chat.completion',created,model,choices:[{index:0,message:{role:'assistant',content:result.text},finish_reason:'stop'}],usage:null,chatSop:trace(result,formalizer,system)};}
function sse(res,data){res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'});const base={id:data.id,created:data.created,model:data.model,object:'chat.completion.chunk'};res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:data.choices[0].message.content},finish_reason:null}],chatSop:data.chatSop})+'\n\n');res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');}
export function createServer({config,repo,lexicon,authTokens,auth=null,base='demo',limits={},sessionRoot}={}){
 if(!config||!repo||!lexicon)throw Error('Server requires config, repository and lexicon');
 if(!['formal','bare'].includes(config.promptProfile))throw Error('Specify promptProfile: formal or bare explicitly; implicit profile mixing is forbidden');
 const formalizer=config.formalizer,model=config.model??'chatsop-local';
 const users=auth?null:credentials(authTokens??(process.env.CHATSOP_API_KEY?{local:process.env.CHATSOP_API_KEY}:{}));
 const maxRequestBytes=positive(limits.maxRequestBytes??65536,'maxRequestBytes'),maxContextBytes=positive(limits.maxContextBytes??4800,'maxContextBytes'),maxConcurrent=positive(limits.maxConcurrent??4,'maxConcurrent'),timeoutMs=positive(limits.timeoutMs??30000,'timeoutMs');
 const sessions=new SessionStore({repo,lexicon,config:{...config,contextMaxBytes:Math.min(config.contextMaxBytes??maxContextBytes,maxContextBytes),formalizer:formalizer?{...formalizer,timeoutMs:Math.min(formalizer.timeoutMs??timeoutMs,timeoutMs)}:undefined},root:sessionRoot??path.join(repo.root,'http-conversations')});
 const pages=createSignedInRoutes();
 const audit=createAuditRouter({ledgerDir:process.env.CHATSOP_AUDIT_LEDGER?path.resolve(process.env.CHATSOP_AUDIT_LEDGER):path.join(root,'eval/reports/current/audit')});
 let active=0;const busy=new Set();
 async function readiness(){
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
 const server=http.createServer(async(req,res)=>{
  const url=req.url?.split('?')[0];if(url==='/healthz'&&req.method==='GET')return json(res,200,{status:'ok'});
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
  if(url==='/chat'&&req.method==='GET'){const state=await readiness();return sendHtml(res,200,chatPage({model,ready:state.ready}));}
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
    if(body.chatSop){const source=checkedTrusted(body.chatSop.trustedSop),stored=await new Runtime({repo,session:entry.agent.session,schema:lexicon.predicates,lexicon,policy:{...config.policy,allowRules:false,allowPin:false}}).run(source);system={source,receipt:stored.result};}
    const chosen=answerLanguage(text,body.language);const result=await entry.agent.turn(text,{language:chosen.language,answerLanguage:chosen.language,languageSource:chosen.source,rewrite:false});sessions.save(entry,user,conversation,base);return result;
   })();work.finally(()=>{active--;busy.delete(key);}).catch(()=>{});
   const result=await Promise.race([work,new Promise((_,reject)=>{const timer=setTimeout(()=>{const e=new Error('Request time limit reached');e.status=504;reject(e);},timeoutMs);timer.unref();work.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
   if(res.destroyed)return;const data=completion(result,model,formalizer,system);if(body.stream)sse(res,data);else json(res,200,data);
  }catch(e){if(res.destroyed)return;const status=e.status??(e.name==='TimeoutError'||e.message==='Request time limit reached'?504:400);error(res,status,status===413?'request_limit':status===504?'time_limit':status===400?'invalid_request':'internal_error',status===400&&!e.status?'Invalid SOP or request; no model detail exposed':status===504?'Request time limit reached':e.status?e.message:'Server request failed');}
 });server.auth=auth;
 return server;
}
export async function startServer({configPath=path.join(root,'config/runtime.json'),host=process.env.CHATSOP_HOST??'0.0.0.0',port=Number(process.env.CHATSOP_PORT??9999)}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));const selected=process.env.CHATSOP_PROMPT_PROFILE;
 if(selected&&config.promptProfile&&config.promptProfile!==selected)throw Error('Prompt profile mismatch between config and environment');
 config.promptProfile=selected??config.promptProfile;
 if(!config.promptProfile)throw Error('Configure promptProfile explicitly (formal for base models, bare for qualified fine-tuned models)');
 const project=path.resolve(root),repo=new Repository(path.resolve(project,config.root??'state'),{memory:config.memory}),lexicon=Lexicon.load(path.resolve(project,config.ontology??'config/ontology.sop'));
 repo.init(config.base??'demo');
 const auth=new Auth({file:path.resolve(project,config.auth?.file??'state/auth.json'),apiKey:process.env.CHATSOP_API_KEY??null});
 const server=createServer({config,repo,lexicon,auth,base:config.base??'demo',limits:config.server?.limits});await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){startServer({configPath:process.env.CHATSOP_CONFIG??path.join(root,'config/runtime.json')}).then(server=>console.log('ChatSOP listening on '+JSON.stringify(server.address())+'\n  home (sign in, chat, audit, admin): http://127.0.0.1:'+server.address().port+'/\n  documentation: http://127.0.0.1:'+server.address().port+'/docs/')).catch(e=>{console.error(e.message);console.error('\nHint: `npm start` generates a token, serves the documentation and prints the access URLs.');process.exitCode=1;});}
