/** Browser chat on top of the independent capability APIs and `POST /v1/chat/completions` (DS012 "The chat page", DS030 "The chat page", DS031).
 *
 * Layout (owner request of 2026-10-01): a left sidebar with three vertical tabs (an icon rail or top bar below 760 px), each a `tabpanel`
 * with arrow-key navigation: *Chat* (session header with the base memory and "New session", the message list that keeps the newest
 * message in view and shows a "new messages" pill when the user has scrolled up, the review of a proposal, the attach button and a
 * composer that grows to five lines, Enter sends, Shift+Enter adds a line), *Settings* (cards: Language, Understanding, Coding agent,
 * Advanced) and *Base Memory* (table of base memories with View, Fork, Add knowledge and Start session). Markup is built here, the CSS is
 * `chat/style.mjs`, the product layer (sessions, base memories, the coding agent) is `chat-product.mjs`.
 *
 * The page calls the capability APIs one by one, each result shown as it arrives:
 * `POST /v1/language/proofread` proposes the clean English (Accept / Edit / Send original); then `POST /v1/emotion/detect` (emoticons
 * next to the message), `POST /v1/understand` (the "I understood" panel under the message, collapsed to one line until clicked, with the
 * leftover spans, their pragmatic kind and a clarification suggestion) and the formalize request run together, and the formalize request
 * reuses the cached work. The formalizer (SymbolicLM, `GET /v1/models`, started with
 * `POST /v1/models/<id>/start` when the page opens) is shown under Settings, Advanced and sent as `model`; there are no Chat or Translate modes. The
 * answer language is sent as `language` (`en`, `ro`, `auto`). Settings are remembered per browser: cleaning before formalizing and
 * "send every sentence" (`POST /v1/language/proofread`, `sendAll`), the SymbolicProofingLLM rewrite (`understanding.rewrite`), tone
 * detection (`understanding.emotion`) and "Show what I understood" (`understanding.interpret`). The page uses the HttpOnly session
 * cookie through same-origin fetch; it never sees a credential. The server owns conversation context per `conversation_id`; the page
 * keeps a local transcript copy for display. SOP in the trace is rendered by server/pages/sop-code.mjs. All dynamic text is inserted
 * with textContent. */
import {escapeHtml, layout} from './layout.mjs';
import {SOP_CODE_STYLE, sopCodeScript} from './sop-code.mjs';
import {CHAT_STYLE} from './chat/style.mjs';
import {serverModelsHtml, serverModelsScript} from './chat/server-models.mjs';
import {settingsCodingAgentHtml, memoryTabHtml, sessionHeadHtml, productDialogsHtml, attachHtml, chipsHtml, productScript} from './chat-product.mjs';

const ICONS = {
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  memory: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
};
const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const script = `
const $=id=>document.getElementById(id);
const MODEL=document.body.dataset.model;
// Model registry (config/formalizers.json): [{id,label,note,capabilities,state,error,default,default_for}], empty without a registry.
let models=JSON.parse(document.body.dataset.models||'[]');
const DEFAULTS=JSON.parse(document.body.dataset.defaultModels||'{}');
const EXAMPLE='Ask something, for example: Who works at Alpha Lab?';
const store={get(key,fallback){try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}};
let conversations=store.get('chatsop.conversations',['default']);
let current=store.get('chatsop.current','default');
if(!conversations.includes(current))conversations.unshift(current);
let sending=false;
// While a message is processed (cleaning, analysis, routing, formalizing, the coding agent) the composer is blocked and says what is running.
function setBusy(on,stage){
 sending=on;for(const id of ['input','send','attach']){const e=$(id);if(e)e.disabled=on;}
 $('busy').hidden=!on;if(on)$('busy-text').textContent=stage||'Working\u2026';
 $('composer').classList.toggle('busy',on);
 if(!on)$('input').focus({preventScroll:true});
}
const stage=text=>{if(sending)$('busy-text').textContent=text;};
// en or ro force the answer language; auto (Any) lets the host infer it from the message.
let language=store.get('chatsop.language','auto');if(!['en','ro','auto'].includes(language))language='auto';
// SymbolicLM is the one formalizer of the chat (config/formalizers.json, default).
let model=DEFAULTS.formalize??MODEL;
const modelInfo=()=>models.find(m=>m.id===model);
let polling=null;
function showState(){
 const el=$('model-state');if(!el)return;const m=modelInfo();if(!m){el.textContent='';return;}
 const words={stopped:'stopped (starts with the first message)',starting:'starting…',ready:'ready',error:'error'+(m.error?': '+m.error:'')};
 el.textContent=words[m.state]??m.state;el.className='state '+(m.state==='ready'?'ok':m.state==='error'?'bad':'');el.title=m.note||'';
}
const TABS=['chat','settings','memory'];
function switchTab(name,focus){
 if(!TABS.includes(name))name='chat';
 for(const t of TABS){const on=t===name;$('tab-'+t).setAttribute('aria-selected',String(on));$('tab-'+t).tabIndex=on?0:-1;$('panel-'+t).hidden=!on;}
 store.set('chatsop.activeTab',name);if(focus)$('tab-'+name).focus();
 if(name==='memory'&&typeof renderMemories==='function')renderMemories();
 if(name==='chat'){scrollBottom();$('input').focus({preventScroll:true});}
}
function initTabs(){
 for(const t of TABS)$('tab-'+t).onclick=()=>switchTab(t);
 $('tab-chat').parentNode.addEventListener('keydown',e=>{
  const at=TABS.findIndex(t=>$('tab-'+t)===document.activeElement);if(at<0)return;
  const to={ArrowDown:at+1,ArrowRight:at+1,ArrowUp:at-1,ArrowLeft:at-1,Home:0,End:TABS.length-1}[e.key];
  if(to===undefined)return;e.preventDefault();switchTab(TABS[(to+TABS.length)%TABS.length],true);
 });
 switchTab(store.get('chatsop.activeTab','chat'));
}
async function refreshModels(){
 try{const r=await fetch('/v1/models',{credentials:'same-origin'});if(!r.ok)return;const body=await r.json();models=body.data.map(d=>({id:d.id,...d.chatsop}));}catch{}
 showState();
 const m=modelInfo();
 if(m&&m.state==='starting'){if(!polling)polling=setInterval(refreshModels,1500);}else if(polling){clearInterval(polling);polling=null;}
}
async function startModel(){
 const m=modelInfo();if(!m)return;
 try{const r=await fetch('/v1/models/'+encodeURIComponent(m.id)+'/start',{method:'POST',credentials:'same-origin'});if(r.ok){const state=await r.json();Object.assign(m,state);}}catch{}
 showState();refreshModels();
}
const transcript=id=>store.get('chatsop.transcript.'+id,[]);
const saveTranscript=(id,items)=>store.set('chatsop.transcript.'+id,items.slice(-100));
function renderSelect(){const select=$('conversation');select.textContent='';for(const id of conversations){const option=document.createElement('option');option.value=id;option.textContent=id;option.selected=id===current;select.append(option);}}
function field(list,label,value){if(value===undefined||value===null||value==='')return;const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=typeof value==='string'?value:JSON.stringify(value);list.append(dt,dd);}
function block(parent,label,text){if(!text)return;const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=label;const pre=document.createElement('pre');pre.textContent=typeof text==='string'?text:JSON.stringify(text,null,2);details.append(summary,pre);parent.append(details);}
function sopBlock(parent,label,text){if(!text)return;const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=label;const pre=document.createElement('pre');const code=document.createElement('code');if(typeof text==='string'&&window.ChatSopCode)code.innerHTML=window.ChatSopCode.render(text);else code.textContent=typeof text==='string'?text:JSON.stringify(text,null,2);pre.append(code);details.append(summary,pre);parent.append(details);}
function traceView(c){
 const details=document.createElement('details');const summary=document.createElement('summary');
 const timing=typeof c.formalization_ms==='number'?' · '+(c.formalization_ms/1000).toFixed(2)+' s':'';
 summary.textContent='trace: formalize · '+(c.status??'no status')+(c.backend!==undefined?' · backend '+(c.backend??'n/a'):'')+' · model '+(c.formalizer_model??'?')+timing;details.append(summary);
 const list=document.createElement('dl');
 field(list,'status',c.status);if(c.rejection)field(list,'rejected because',c.rejection);field(list,'backend',c.backend);field(list,'fallback',c.fallback===null?'none':c.fallback);field(list,'complete',c.completeness);
 field(list,'formalizer',c.formalizer_label?c.formalizer_label+' ('+c.formalizer_model+')':c.formalizer_model);
 if(typeof c.formalization_ms==='number')field(list,'latency (formalization)',Math.round(c.formalization_ms)+' ms');
 field(list,'answer language',c.answer_language?c.answer_language+' ('+(c.language_source??'default')+')':null);
 if(c.unclear)field(list,'unclear',c.unclear);
 if(c.understood_as)field(list,'understood as',c.understood_as);
 field(list,'user statements',(c.user_statements??[]).length?c.user_statements.map(s=>s.statement).join(' '):'none');
 if((c.carried_statements??[]).length)field(list,'earlier statements',c.carried_statements.map(s=>s.atom).join('; '));
 field(list,'model assumptions',(c.model_assumptions??[]).length?c.model_assumptions.map(a=>a.statement+' ['+a.treatment+']').join(' '):'none');
 if(c.assumption_policy)field(list,'assumption policy',c.assumption_policy);
 field(list,'reinforcement',c.reinforcement??'none');
 if(c.required)field(list,'needs clarification',c.required);
 details.append(list);
 sopBlock(details,'model SOP (proposed by the formalizer)',c.model_sop);
 sopBlock(details,'execution circuit (generated by the host)',c.circuit);
 if(c.provenance&&c.provenance.length)block(details,'provenance',c.provenance);
 sopBlock(details,'pending clarification SOP',c.pendingSop);
 return details;
}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
// Text with the given spans highlighted (case-insensitive, each span once, in place); unmatched spans are ignored.
function markSpans(node,text,spans){
 node.textContent='';const low=text.toLowerCase();const hits=[];
 for(const span of spans||[]){const i=low.indexOf(String(span).toLowerCase());if(i>=0&&!hits.some(h=>i<h[1]&&h[0]<i+span.length))hits.push([i,i+span.length]);}
 hits.sort((a,b)=>a[0]-b[0]);let at=0;
 for(const [from,to] of hits){if(from>at)node.append(text.slice(at,from));const m=document.createElement('mark');m.textContent=text.slice(from,to);m.title='not represented in the interpretation';node.append(m);at=to;}
 node.append(text.slice(at));return hits.length;
}
/** Spans of the interpretation's not-represented list that the EmotionDetectionSystem classified (DS029): shown as pragmatic signals instead. */
function classifiedSpans(u){return new Set(((u.emotion&&u.emotion.leftovers&&u.emotion.leftovers.classified)||[]).map(c=>c.span));}
function unclassifiedSpans(u){const done=classifiedSpans(u);return ((u.interpretation&&u.interpretation.not_represented)||[]).filter(x=>!done.has(x));}
/** The pragmatic signals the EmotionDetectionSystem found (advisory, never facts): each with its kind, span, score and source. */
function emotionBlock(u){
 const e=u.emotion;if(!e||!e.signals||!e.signals.length)return null;
 const box=el('div','emotion');box.append(el('p','note','Tone and courtesy signals (EmotionDetectionSystem, advisory only: they adjust how I answer and are never facts):'));
 const list=document.createElement('ul');
 for(const s of e.signals){const li=document.createElement('li');li.append(el('span','badge '+(s.experimental?'warn':'ok'),s.kind));li.append(document.createTextNode(' '+(s.span?'\u201c'+s.span+'\u201d ':'whole message ')+'('+s.score+', '+s.source+(s.experimental?', experimental':'')+(s.leftover?', was not represented':'')+')'));list.append(li);}
 box.append(list);
 const done=(e.leftovers&&e.leftovers.classified)||[];
 if(done.length)box.append(el('p','note','Classified instead of left unparsed: '+done.map(c=>'\u201c'+c.span+'\u201d as '+c.kinds.join(', ')).join('; ')));
 return box;
}
/** The leftover parts of the message, labelled: those the EmotionDetectionSystem classified (with their pragmatic kind and emoticon) and those still not understood. */
function leftoverBlock(u){
 const done=(u.emotion&&u.emotion.leftovers&&u.emotion.leftovers.classified)||[],rest=unclassifiedSpans(u);
 if(!done.length&&!rest.length)return null;
 const emo={};for(const e of (u.emotion&&u.emotion.emoji)||[])emo[e.kind]=e.emoji;
 const box=el('div','left');box.append(el('p','note','Left over, not formalized:'));const list=document.createElement('ul');
 for(const c of done){const li=document.createElement('li');li.append(el('span','badge ok','classified'));li.append(document.createTextNode('\u201c'+c.span+'\u201d \u2192 '+c.kinds.map(k=>(emo[k]?emo[k]+' ':'')+k).join(', ')));list.append(li);}
 for(const x of rest){const li=document.createElement('li');li.append(el('span','badge warn','not understood'));li.append(document.createTextNode('\u201c'+x+'\u201d'));list.append(li);}
 box.append(list);return box;
}
function understoodPanel(u){const d=interpretationPanel(u);const lo=leftoverBlock(u);if(lo)d.append(lo);const em=emotionBlock(u);if(em)d.append(em);
 if(u.clarify){const c=el('div','clarify');c.append(el('b','','Clarification: '));c.append(document.createTextNode(u.clarify));d.append(c);}
 for(const e of u.errors||[])d.append(el('p','err','Could not run '+e.component+(e.span?' on \u201c'+e.span+'\u201d':'')+': '+e.message));
 if(u.timings)d.append(el('p','note','understand: '+Math.round(u.timings.total_ms)+' ms \u00b7 cache '+u.cache+(u.cache==='hit'&&typeof u.timings.compute_ms==='number'?' (computed once in '+Math.round(u.timings.compute_ms)+' ms)':'')));
 return d;}
function interpretationPanel(u){
 const i=u.interpretation;const details=el('details','understood');
 const summary=el('summary');details.append(summary);
 if(!i){summary.textContent='I understood: no interpretation was made';if(u.requested&&u.requested.rewrite_error)details.append(el('p','note','The SymbolicProofingLLM rewrite was not used: '+u.requested.rewrite_error));return details;}
 if(!i.available){summary.textContent='I understood: no interpretation';details.append(el('p','note',i.reason));return details;}
 const bad=i.sentences.filter(s=>s.status==='uncertain').length,nr=unclassifiedSpans(u).length;
 summary.textContent='I understood: '+i.sentences.length+(i.sentences.length===1?' sentence':' sentences')+(bad?' · '+bad+' uncertain':'')+(nr?' · '+nr+' not represented':'')+(i.certified===true?' · certified':i.certified===false?' · not certified':'');
 const rw=i.rewrite;
 if(rw&&rw.units.some(x=>x.sent)){const sent=rw.units.filter(x=>x.sent).length,acc=rw.units.filter(x=>x.accepted).length;
  details.append(el('p','note','SymbolicProofingLLM rewrite ('+(u.requested&&u.requested.rewrite||rw.gate)+'): '+sent+' sentence'+(sent===1?'':'s')+' sent, '+acc+' accepted.'));}
 else if(u.requested&&u.requested.rewrite&&u.requested.rewrite!=='off')details.append(el('p','note','SymbolicProofingLLM rewrite ('+u.requested.rewrite+'): no sentence needed a rewrite.'));
 if(u.requested&&u.requested.rewrite_error)details.append(el('p','note','The SymbolicProofingLLM rewrite was not used: '+u.requested.rewrite_error));
 if(u.analysed_text&&u.message&&u.analysed_text.trim()!==u.message.trim())details.append(el('p','note','Analysed as (English): '+u.analysed_text));
 for(const s of i.sentences){
  const row=el('div','us');const head=el('div');
  if(s.status==='verified'){head.append(el('span','badge ok','verified'));head.append(el('span','cnl',s.cnl_sentences.join(' ')));if(s.partial){const b=el('span','badge warn','partial');b.title='part of the sentence is not represented';head.append(b);}}
  else if(s.status==='failed'){head.append(el('span','badge warn','could not be analysed'));head.append(el('span','note',s.error||'the analysis of this sentence failed'));}
  else if(s.status==='uncertain'){head.append(el('span','badge warn','uncertain interpretation'));head.append(el('span','raw','raw analysis: '+s.summary));}
  else{head.append(el('span','badge','no statement'));head.append(el('span','note','framing or fragment, nothing to restate'));}
  if(s.certified===true){const b=el('span','badge ok','certified');b.title='the default and the accurate Stanza trees are identical';head.append(b);}
  else if(s.certified===false){const b=el('span','badge warn','not certified');b.title='the default and the accurate Stanza trees differ';head.append(b);}
  row.append(head);
  const orig=el('div','orig');orig.append(el('span','',s.rewrite&&s.rewrite.accepted?'rewritten sentence: ':'sentence: '));const span=el('span');markSpans(span,s.display_text||s.text,s.not_represented);orig.append(span);row.append(orig);
  if(s.not_represented.length)row.append(el('div','nr','not represented: '+s.not_represented.map(x=>'"'+x+'"').join(', ')));
  if(s.rewrite){const r=el('div','rw');r.append(el('span','badge '+(s.rewrite.accepted?'ok':'warn'),s.rewrite.accepted?'rewrite accepted (certified)':'rewrite rejected'+(s.rewrite.reasons&&s.rewrite.reasons.length?': '+s.rewrite.reasons.join(', '):'')));r.append(document.createTextNode('original: '+s.rewrite.original+' → rewrite: '+(s.rewrite.rewrite||'(empty)')));row.append(r);}
  if(s.status==='uncertain'&&s.unverified_cnl){const d=el('details');d.append(el('summary','','unverified CNL (the round trip failed: '+((s.round_trip&&s.round_trip.reasons)||[]).join(', ')+')'),el('div','cnl',s.unverified_cnl));row.append(d);}
  details.append(row);
 }
  return details;
}
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
async function api(path,body){
 const t0=performance.now();
 try{const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>null);return {ok:r.ok&&Boolean(j)&&!j.error,status:r.status,body:j,ms:Math.round(performance.now()-t0)};}
 catch{return {ok:false,status:0,body:null,ms:Math.round(performance.now()-t0)};}
}
/** Emoticons of the detected tone (POST /v1/emotion/detect): a tap or focus shows kind, score and span; the hover tooltip says the same. */
function emojiBar(res){
 const wrap=el('div');const bar=el('div','emo');bar.setAttribute('aria-label','Detected tone');const note=el('div','emo-note');
 for(const e of (res&&res.emoji)||[]){const tip=e.kind+' \u00b7 score '+e.score+(e.span?' \u00b7 \u201c'+e.span+'\u201d':'')+(e.experimental?' \u00b7 experimental':'');const b=el('button','emo-btn',e.emoji);b.type='button';b.title=tip;b.setAttribute('aria-label',tip);b.onclick=()=>{note.textContent=note.textContent===tip?'':tip;};bar.append(b);}
 if(!bar.childNodes.length)return null;wrap.append(bar,note);return wrap;
}
function setSlot(div,cls,node){const slot=div&&div.querySelector('.'+cls);if(!slot)return;slot.textContent='';if(node)slot.append(node);}
function showEmotion(div,res){setSlot(div,'emo-slot',emojiBar(res));}
function showUnderstood(div,u){
 div.classList.add('wide');
 const holder=document.createElement('div');holder.append(understoodPanel(u));setSlot(div,'understood-slot',holder);
 // The not-represented spans are highlighted in the message the user sent, when they occur in it verbatim.
 const t=div.querySelector('.txt');if(t&&u.interpretation&&u.interpretation.available)markSpans(t,t.textContent,unclassifiedSpans(u));
}
function add(item){
 const div=document.createElement('div');div.className='msg '+item.role;
 const text=document.createElement('div');text.className='txt';text.textContent=item.text;div.append(text);
 if(item.role==='user'){div.append(el('div','emo-slot'),el('div','understood-slot'));if(item.emotion)showEmotion(div,item.emotion);if(item.understood&&showUnderstoodOn)showUnderstood(div,item.understood);}
 if(item.hint){const hint=document.createElement('div');hint.className='meta';hint.innerHTML=item.hint;div.append(hint);}
 const u=item.trace&&item.trace.understanding;
 // The panel under the user's message (POST /v1/understand) replaces the one of the answer; the answer shows its own only when the page has none.
 if(u&&showUnderstoodOn&&!item.noPanel)div.append(understoodPanel(u));
 if(item.trace)div.append(traceView(item.trace));
 if(item.time){const meta=document.createElement('div');meta.className='meta';meta.textContent=new Date(item.time).toLocaleTimeString();div.append(meta);}
 $('log').append(div);
 return div;
}
function renderLog(){$('log').textContent='';stick=true;const items=transcript(current);if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='Conversation "'+current+'". '+EXAMPLE;$('log').append(p);}for(const item of items)add(item);scrollBottom(true);}
// The newest message stays in view: while the user is at the bottom the list follows every addition (also the answers filling in later);
// once the user scrolled up it stays put and the "new messages" pill appears.
const logEl=$('log'),hintEl=$('scroll-hint');let stick=true;
const nearBottom=()=>logEl.scrollHeight-logEl.scrollTop-logEl.clientHeight<80;
function scrollBottom(force){if(force)stick=true;if(!stick)return;logEl.scrollTop=logEl.scrollHeight;hintEl.hidden=true;}
const autoScroll=()=>scrollBottom();
// Only a move up by the user releases the follow mode: a late scroll event of our own scroll, after the content grew, must not.
let lastTop=0;
logEl.addEventListener('scroll',()=>{if(nearBottom()){stick=true;hintEl.hidden=true;}else if(logEl.scrollTop<lastTop-1)stick=false;lastTop=logEl.scrollTop;});
new MutationObserver(muts=>{
 if(stick){requestAnimationFrame(()=>scrollBottom());return;}
 if(muts.some(m=>[...m.addedNodes].some(n=>n.parentNode===logEl&&!(n.classList&&n.classList.contains('empty')))))hintEl.hidden=false;
}).observe(logEl,{childList:true,subtree:true,characterData:true});
hintEl.onclick=()=>scrollBottom(true);
function remember(item){const items=transcript(current);items.push(item);saveTranscript(current,items);}
function explain(status,body){
 const message=body&&body.error&&body.error.message;
 if(status===401||status===403)return {text:'You are not signed in (or the session expired).',hint:'<a href="/login?next=%2Fchat">Sign in again</a>'};
 if(status===503)return {text:'The selected model is not available, so no answer could be produced'+(message?': '+message:'.'),hint:'Choose another model under <b>Settings, Advanced</b>; the <a href="/">home page</a> shows the state of every model.'};
 if(status===422)return {text:'The model wrote SOP that the host did not admit or could not execute, so no answer was produced.',hint:'The trace shows what the model wrote and why it was refused. Rephrase the message or try another model.',trace:body&&body.chatSop};
 if(status===409)return {text:'This conversation is still answering the previous message. Wait for it, or start a new conversation.'};
 if(status===429)return {text:'The server is busy (too many simultaneous requests). Try again in a moment.'};
 if(status===504)return {text:'The answer took too long and was stopped.',hint:'If the message asked to store something, check the result before sending it again.'};
 if(status===413)return {text:'The message is too long for this server.'};
 if(status===400)return {text:message?'The request was refused: '+message:'The request was refused.'};
 if(status===0)return {text:'The server could not be reached. Check the connection and try again.'};
 return {text:'The server answered HTTP '+status+(message?': '+message:'')};
}
// Clean before formalizing (DS021 "textToCleanEnglish", off moves the toggle only, never the model boundary itself):
// on by default, remembered per browser.
let cleanBeforeFormalize=store.get('chatsop.cleanBeforeFormalize',true);
// Understanding settings (DS012 "Understanding in the chat"), remembered per browser. The server's own defaults come in data-settings.
const SETTINGS=JSON.parse(document.body.dataset.settings||'{}');
let cleanSendAll=store.get('chatsop.cleanSendAll',SETTINGS.sendAll===true);
let rewriteMode=store.get('chatsop.rewrite',SETTINGS.rewrite||'off');if(!['off','gated','always'].includes(rewriteMode))rewriteMode='off';
let showUnderstoodOn=store.get('chatsop.showUnderstood',true);
let emotionOn=store.get('chatsop.emotion',SETTINGS.emotionEnabled!==false);
function hideReview(){const el=$('clean-review');if(el){el.hidden=true;el.textContent='';}}
function diffView(spans){
 const wrap=document.createElement('div');wrap.className='diff';
 for(const part of spans&&spans.length?spans:[]){const s=document.createElement('span');s.className=part.type==='insert'?'ins':part.type==='delete'?'del':'eq';s.textContent=part.text;wrap.append(s);}
 if(!wrap.childNodes.length)wrap.textContent='';
 return wrap;
}
function patchItem(conversation,id,patch){const items=transcript(conversation);const i=items.findIndex(x=>x.id===id);if(i>=0){Object.assign(items[i],patch);saveTranscript(conversation,items);}}
/** Starts the cached analysis calls of a proposal in the background, so that accepting it finds them done (the final requests hit the server caches). */
function prefetch(text){if(emotionOn)api('/v1/emotion/detect',{message:text});if(showUnderstoodOn)api('/v1/understand',{message:text,rewrite:rewriteMode,emotion:emotionOn});}
async function proceedSend(text,cleaning,ctx){
 input.value='';fit();scrollBottom(true);
 const conversation=current;
 const user=ctx&&ctx.user?ctx.user:{id:uid(),role:'user',text,time:Date.now()};if(!(ctx&&ctx.user))remember(user);const userDiv=ctx&&ctx.userDiv?ctx.userDiv:add(user);
 const live=()=>conversation===current&&userDiv.isConnected;
 const pending=(cls,label)=>{const slot=userDiv.querySelector('.'+cls);if(slot)slot.append(el('div','pending',label));};
 stage('Analysing what I understood\u2026');
 // Independent capability calls (docs/api.html), started together and shown as each one arrives; the formalize request below reuses their cached work.
 const calls=[];
 if(emotionOn){pending('emo-slot','detecting tone\u2026');calls.push(api('/v1/emotion/detect',{message:text}).then(r=>{if(r.ok){user.emotion=r.body;patchItem(conversation,user.id,{emotion:r.body});}if(live())showEmotion(userDiv,r.ok?r.body:null);}));}
 if(showUnderstoodOn){pending('understood-slot','analysing what I understood\u2026');calls.push(api('/v1/understand',{message:text,rewrite:rewriteMode,emotion:emotionOn}).then(r=>{if(r.ok){user.understood=r.body;patchItem(conversation,user.id,{understood:r.body});if(live())showUnderstood(userDiv,r.body);}else if(live())setSlot(userDiv,'understood-slot',el('div','pending','The analysis of what I understood is not available ('+(r.status||'no connection')+').'));}));}
 // Session routing (DS031): after SymbolicLM's analysis the host decides between SymbolicLM and the coding agent and the page shows the path and why.
 if(typeof productAfterAnalysis==='function'){const routed=await productAfterAnalysis(text,user,calls,userDiv);if(routed&&routed.path==='authoring'){setBusy(false);autoScroll();return;}}
 stage('Formalizing and answering\u2026');
 const waiting=document.createElement('div');waiting.className='msg assistant muted';waiting.textContent=modelInfo()&&modelInfo().state!=='ready'?'starting the model, then thinking\u2026':'thinking\u2026';$('log').append(waiting);autoScroll();
 let status=0,body=null;
 try{const response=await fetch('/v1/chat/completions',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:model??MODEL,messages:[{role:'user',content:text}],conversation_id:conversation,...(typeof sessionBody==='function'?sessionBody():{}),language,...(cleaning?{cleaning}:{}),understanding:{interpret:showUnderstoodOn,rewrite:rewriteMode,emotion:emotionOn}})});status=response.status;body=await response.json().catch(()=>null);}catch{status=0;}
 await Promise.allSettled(calls);
 waiting.remove();if(models.length)refreshModels();
 const noPanel=Boolean(user.understood);
 if(noPanel&&body&&body.chatSop&&body.chatSop.understanding){const t={...body.chatSop,understanding:{...body.chatSop.understanding,interpretation:null,emotion:null}};body={...body,chatSop:t};}
 const item=status===200&&body&&body.choices?{role:'assistant',text:body.choices[0].message.content,trace:body.chatSop,time:Date.now(),noPanel}:{role:'assistant error',...explain(status,body),time:Date.now()};
 if(conversation===current){remember(item);add(item);}else{const items=transcript(conversation);items.push(item);saveTranscript(conversation,items);}
 setBusy(false);autoScroll();
}
function showReview(original,clean){
 const el=$('clean-review');if(!el)return proceedSend(original,null);
 el.hidden=false;el.textContent='';
 const title=document.createElement('p');title.className='review-title';title.textContent='Proposed clean English ('+(clean.backend&&clean.backend!=='none'?clean.backend:'host')+'). Review it, then choose:';el.append(title);
 el.append(diffView(clean.spans));
 if(!clean.spans||!clean.spans.length){const p=document.createElement('p');p.className='diff';p.textContent=clean.clean;el.append(p);}
 if(clean.reasons&&clean.reasons.length){const reasons=document.createElement('p');reasons.className='meta';reasons.textContent='Why: '+clean.reasons.join(', ');el.append(reasons);}
 if(clean.fallback){const f=document.createElement('p');f.className='meta';f.textContent='Fallback: '+clean.fallback.from+' could not run, so '+clean.fallback.to+' handled '+clean.fallback.sentences+' sentence'+(clean.fallback.sentences===1?'':'s')+' ('+clean.fallback.reason+'). The translation may be weaker.';el.append(f);}
 if(clean.errors&&clean.errors.length){const w=document.createElement('p');w.className='meta';w.textContent='Part of the check could not run ('+clean.errors.map(e=>e.component+(e.span?' on \u201c'+e.span+'\u201d':'')).join(', ')+'); those sentences are left as you wrote them.';el.append(w);}
 prefetch(clean.clean);
 const actions=document.createElement('div');actions.className='review-actions';
 const accept=document.createElement('button');accept.type='button';accept.className='primary';accept.textContent='Accept';
 accept.onclick=()=>{hideReview();setBusy(true,'Analysing\u2026');proceedSend(clean.clean,{original,backend:clean.backend,changed:true});};
 const edit=document.createElement('button');edit.type='button';edit.textContent='Edit';
 edit.onclick=()=>{hideReview();input.value=clean.clean;fit();input.focus();};
 const useOriginal=document.createElement('button');useOriginal.type='button';useOriginal.textContent='Send original';
 useOriginal.onclick=()=>{hideReview();setBusy(true,'Analysing\u2026');proceedSend(original,{original,backend:clean.backend,changed:false});};
 actions.append(accept,edit,useOriginal);el.append(actions);
 autoScroll();
}
const input=$('input');
async function send(){
 const text=input.value.trim();if(!text||sending)return;
 setBusy(true,cleanBeforeFormalize?'Checking the wording\u2026':'Working\u2026');scrollBottom(true);
 if(typeof productEarly==='function'&&await productEarly(text)){setBusy(false);return;}
 if(!transcript(current).length)$('log').textContent='';
 if(cleanBeforeFormalize){
  const checking=document.createElement('div');checking.className='msg assistant muted';checking.textContent='checking the wording…';$('log').append(checking);autoScroll();
  let clean=null;
  const r=await api('/v1/language/proofread',{message:text,sendAll:cleanSendAll});if(r.ok)clean=r.body;
  checking.remove();
  if(clean&&clean.changed){showReview(text,clean);setBusy(false);return;}
 }
 await proceedSend(text,null);
}
function newConversation(){const stamp=new Date().toISOString().slice(0,16).replace(/[-:T]/g,'');const id='c'+stamp+'-'+Math.random().toString(36).slice(2,6);conversations.unshift(id);current=id;store.set('chatsop.conversations',conversations.slice(0,50));store.set('chatsop.current',current);renderSelect();renderLog();$('input').focus();}
$('conversation').onchange=e=>{current=e.target.value;store.set('chatsop.current',current);renderLog();};
$('clear').onclick=()=>{saveTranscript(current,[]);renderLog();};
$('send').onclick=send;
// The composer grows to five lines.
function fit(){const t=$('input');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,136)+'px';scrollBottom();}
$('input').addEventListener('input',fit);
$('language').value=language;$('language').onchange=e=>{language=e.target.value;store.set('chatsop.language',language);};
if($('clean-toggle')){$('clean-toggle').checked=cleanBeforeFormalize;$('clean-toggle').onchange=e=>{cleanBeforeFormalize=e.target.checked;store.set('chatsop.cleanBeforeFormalize',cleanBeforeFormalize);$('send-all-toggle').disabled=!cleanBeforeFormalize;if(!cleanBeforeFormalize)hideReview();};}
$('send-all-toggle').checked=cleanSendAll;$('send-all-toggle').disabled=!cleanBeforeFormalize;$('send-all-toggle').onchange=e=>{cleanSendAll=e.target.checked;store.set('chatsop.cleanSendAll',cleanSendAll);};
$('rewrite-select').value=rewriteMode;$('rewrite-select').onchange=e=>{rewriteMode=e.target.value;store.set('chatsop.rewrite',rewriteMode);};
$('emotion-toggle').checked=emotionOn;$('emotion-toggle').onchange=e=>{emotionOn=e.target.checked;store.set('chatsop.emotion',emotionOn);};
$('understood-toggle').checked=showUnderstoodOn;$('understood-toggle').onchange=e=>{showUnderstoodOn=e.target.checked;store.set('chatsop.showUnderstood',showUnderstoodOn);renderLog();};
$('language').dataset.title=$('language').title||'';
showState();startModel();
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
renderSelect();renderLog();
`;
const row = (title, help, control, cls = '') => `<div class="srow${cls ? ' ' + cls : ''}"><div class="what"><b>${title}</b><span>${help}</span></div><div class="ctl">${control}</div></div>`;
const check = (id, title, help, cls = '') => row(`<label class="plain" for="${id}">${title}</label>`, help, `<input type="checkbox" id="${id}">`, cls);

export function chatPage({model, ready, models = null, defaultModel = null, defaultModels = null, settings = {}}) {
  const banner = ready ? '' : models
    ? '<p class="notice bad">SymbolicLM cannot run on this server (see the <a href="/">home page</a> for each model\'s state).</p>'
    : '<p class="notice bad">SymbolicLM is not ready, so answers will fail with "model unavailable" until it runs. See the <a href="/">home page</a> for details.</p>';
  const tab = (id, label, selected) => `<button id="tab-${id}" class="tab" role="tab" type="button" aria-selected="${selected}" aria-controls="panel-${id}" tabindex="${selected ? 0 : -1}">${ICONS[id]}<span>${label}</span></button>`;
  const advanced = (models ? row('Formalizer', 'SymbolicLM, the one formalizer of the chat (config/formalizers.json). It starts with the page.', '<span id="model-state" class="state" aria-live="polite"></span>') : '')
    + row('Reasoning strategy', 'The strategy of the base memory the session works on. The host chooses the reasoning route for each question; a per-message strategy is not offered.', '<span id="strategy-info" class="state">no session</span>');
  const body = `<main class="app" data-ready="${ready ? 'yes' : 'no'}">
${banner}
<nav class="tabs" role="tablist" aria-orientation="vertical" aria-label="Chat sections">${tab('chat', 'Chat', true)}${tab('settings', 'Settings', false)}${tab('memory', 'Base Memory', false)}</nav>
<section id="panel-chat" class="panel" role="tabpanel" aria-labelledby="tab-chat">
${sessionHeadHtml}
<div class="log-wrap"><div id="log" aria-live="polite"></div><button id="scroll-hint" class="pill-btn" type="button" hidden>↓ new messages</button></div>
<div id="clean-review" class="review" hidden aria-live="polite"></div>
<div class="composer-wrap">${chipsHtml}<div id="busy" class="busy" role="status" aria-live="polite" hidden><span class="spin" aria-hidden="true"></span><span id="busy-text">Working\u2026</span></div><div id="composer" class="composer"><button id="attach" class="icon-btn" type="button" title="Attach UTF-8 text files (txt, md, sop, csv, json): they go to the coding agent, which writes SOP circuits from them" aria-label="Attach files"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.5l-8.5 8.5a5.5 5.5 0 0 1-8-8L13 4.5a3.7 3.7 0 0 1 5.3 5.3l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8"/></svg></button>${attachHtml}<textarea id="input" rows="1" placeholder="Type a message" aria-label="Message"></textarea><button id="send" class="icon-btn primary" type="button" title="Send (Enter)" aria-label="Send">${SEND_ICON}</button></div><p class="composer-hint">Enter sends, Shift+Enter adds a new line. Attaching a file is the only thing that starts the coding agent by itself.</p></div>
</section>
<section id="panel-settings" class="panel scroll-panel" role="tabpanel" aria-labelledby="tab-settings" hidden><div class="inner">
<h2>Settings</h2><p class="lead">Choices are remembered in this browser.</p>
<section class="card set"><h3>Language</h3><p class="help">How answers are written and how your message is cleaned up first.</p>
${row('<label class="plain" for="language">Answer language</label>', 'English or Română force the language; Any infers it from the message (an explicit request such as "answer in Romanian", otherwise English).', '<select id="language"><option value="en">English</option><option value="ro">Română</option><option value="auto">Any</option></select>')}
${check('clean-toggle', 'Clean text before formalizing', 'textToCleanEnglish: the translator translates Romanian and mixed sentences, LanguageProofingLLM corrects English spelling and grammar; you review the result (Accept, Edit or Send original). Off sends your message as typed.', 'fz')}
${check('send-all-toggle', 'Send every sentence', 'On: clean sentences go to the cleaner too (the gate finds only about 28% of the sentences that need cleaning). Off: only the sentences the gate flags.', 'fz sub')}
</section>
<section class="card set fz"><h3>Understanding</h3><p class="help">What the page shows about how your message was understood.</p>
${row('<label class="plain" for="rewrite-select">Rewrite mode</label>', 'SymbolicProofingLLM rewrites sentences SymbolicLM cannot analyse reliably. Off: never. Gated: only uncertain sentences, kept if certified. Always: every sentence.', '<select id="rewrite-select"><option value="off">off</option><option value="gated">gated (trees + certified)</option><option value="always">always</option></select>')}
${check('emotion-toggle', 'Detect tone and courtesy', 'Classifies greetings, thanks, politeness, urgency and frustration. Advisory only: it adjusts how I answer and is never a fact.')}
${check('understood-toggle', 'Show what I understood', 'A one-line panel under your message; click it to see the restated sentences, what was not represented and whether the analysis is certified.')}
</section>
<section class="card set"><h3>Coding agent</h3><p class="help">The coding agent (omp) writes SOP circuits as proposed drafts. It never starts by itself.</p>
${settingsCodingAgentHtml}
</section>
${serverModelsHtml}
<section class="card set"><h3>Advanced</h3><p class="help">The formalizer and reasoning.</p>
${advanced}
</section>
</div></section>
<section id="panel-memory" class="panel scroll-panel" role="tabpanel" aria-labelledby="tab-memory" hidden><div class="inner">
${memoryTabHtml}
</div></section>
${productDialogsHtml}
</main>`;
  return layout({title: 'ChatSOP chat', active: 'chat', signedIn: true, body, script: sopCodeScript + '\n' + script + '\n' + serverModelsScript + '\n' + productScript, style: SOP_CODE_STYLE + CHAT_STYLE}).replace('<body>', `<body data-model="${escapeHtml(model)}" data-models="${escapeHtml(JSON.stringify(models ?? []))}" data-default-model="${escapeHtml(defaultModel ?? '')}" data-default-models="${escapeHtml(JSON.stringify(defaultModels ?? {}))}" data-settings="${escapeHtml(JSON.stringify(settings ?? {}))}">`);
}
