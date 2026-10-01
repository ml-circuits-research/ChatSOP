/** Browser chat on top of the independent capability APIs and `POST /v1/chat/completions` (DS012 "Chat modes", DS030 "The chat page").
 * In Formalize mode the page calls the capability APIs one by one, each result shown as it arrives: `POST /v1/language/proofread`
 * proposes the clean English (Accept / Edit / Send original); then `POST /v1/emotion/detect` (emoticons next to the message, tooltip
 * with kind, score and span), `POST /v1/understand` (the "I understood" panel under the message, a labelled list of leftover spans
 * with their pragmatic kind, a clarification suggestion) and the formalize request run together, and the formalize request reuses the
 * cached analysis and tone detection. While the proposal is under review the same calls are started for it in the background. A *Mode* selector picks Chat (plain
 * conversation with an unmodified base instruct model), Formalize (SOP Lang: a fine-tuned formalizer, then the host)
 * or Translate to English (a base model with a fixed prompt), sent as `mode`. The *Model* selector lists the registry
 * models whose `capabilities` include that mode (`GET /v1/models`, config/formalizers.json), starts the chosen model
 * ahead of the first message (`POST /v1/models/<id>/start`) and shows its state; the choice is remembered per browser
 * and mode and sent as `model`. The *Answer language* selector (English, Română, Any) is sent as `language` (`en`,
 * `ro`, `auto`): the Formalize answer language, a system instruction in Chat, not applicable in Translate. In
 * Formalize mode, before the message is sent a *Clean before formalizing* toggle (on by default, remembered per
 * browser) calls `POST /v1/text-to-clean-english` (`lib/text-to-clean-english/`, owner decision 2026-09-30): a
 * spelling/grammar/translation/simplification host step outside the model boundary. When it changes the message the
 * page shows the proposed English with a word-level diff and three choices — Accept, Edit (loads the proposal into
 * the composer for the user to change) and Send original — before anything reaches the formalizer; the original and
 * the accepted text are both sent to `/v1/chat/completions` (`cleaning: {original, backend, changed}`) and kept in
 * the trace. A collapsible *Settings* block (formalize mode, each choice remembered per browser) holds the cleaning toggles
 * (clean text before formalizing, send every sentence), the SymbolicProofingLLM rewrite choice (off, gated, always; sent as
 * `understanding.rewrite`) and "Show what I understood (CNL)" (on by default; sent as `understanding.interpret`); the "I understood:" panel is built from the `POST /v1/understand` answer (the formalize answer's `chatSop.understanding` has the same shape and is used only when that call failed) (DS012 "Understanding in the chat"): per
 * sentence the interpretation CNL, an "uncertain interpretation" marker with a raw analysis summary when the round trip failed,
 * the spans the CNL does not represent (highlighted in the message), certification and the rewrite trace. The page uses the
 * HttpOnly session cookie through same-origin fetch; it never sees or stores a
 * credential. The server owns conversation context per `conversation_id`; the
 * page keeps only a local transcript copy per conversation for display. SOP in
 * the trace (model SOP, execution circuit, pending clarification) is rendered by
 * the shared server/pages/sop-code.mjs highlighter, linked to the wire help. */
import {escapeHtml, layout} from './layout.mjs';
import {SOP_CODE_STYLE, sopCodeScript} from './sop-code.mjs';

const style = `
.chat{max-width:960px;margin:0 auto;padding:12px 16px 0;display:flex;flex-direction:column;min-height:calc(100dvh - 56px)}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.bar select{min-width:0;flex:1 1 180px;max-width:320px}
.bar .state{font-size:13px;color:var(--muted)}.bar .state.ok{color:var(--ok)}.bar .state.bad{color:var(--bad)}
#log{flex:1;display:flex;flex-direction:column;gap:10px;padding-bottom:12px}
.msg{max-width:88%;padding:9px 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere}
.msg.user{align-self:flex-end;background:var(--soft)}
.msg.error{border-color:var(--bad)}
.msg .meta{font-size:12px;color:var(--muted);margin-top:6px;white-space:normal}
.msg details{margin-top:6px;white-space:normal}.msg summary{cursor:pointer;color:var(--accent);font-size:13px}
.msg dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin:6px 0;font-size:13px}.msg dt{color:var(--muted)}.msg dd{margin:0;overflow-wrap:anywhere}
.composer{position:sticky;bottom:0;background:var(--bg);padding:10px 0 14px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:flex-end}
.composer textarea{flex:1;resize:vertical;min-height:44px;max-height:40vh}
.empty{color:var(--muted);text-align:center;margin:30px 0}
.review{border:1px solid var(--accent);background:var(--panel);border-radius:10px;padding:10px 12px;margin-bottom:10px}
.review-title{margin:0 0 6px;font-size:13px;color:var(--muted)}
.diff{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.5}
.diff .ins{background:rgba(92,195,141,.28);border-radius:3px}
.diff .del{background:rgba(240,138,128,.28);border-radius:3px;text-decoration:line-through}
.review-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.settings{border:1px solid var(--line);border-radius:10px;padding:6px 10px;margin:0 0 8px;background:var(--panel)}
.settings summary{cursor:pointer;color:var(--accent);font-size:13px}
.settings .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px 14px;margin-top:8px;font-size:13px}
.settings label{display:flex;align-items:center;gap:6px;margin:0}
.understood{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:4px 8px;margin-top:8px;background:var(--soft);font-size:14px}
.understood>summary{font-size:13px;color:var(--text)}
.understood .us{border-top:1px solid var(--line);padding:6px 0}.understood .us:first-of-type{border-top:0}
.understood .cnl{font-weight:600;overflow-wrap:anywhere;margin-right:6px}
.understood .orig{font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.understood mark,.msg mark{background:rgba(232,170,40,.38);color:inherit;border-radius:3px;padding:0 1px}
.understood .badge{display:inline-block;font-size:11px;line-height:1.5;padding:0 6px;border-radius:9px;border:1px solid var(--line);margin-right:4px;white-space:nowrap;color:var(--muted)}
.understood .badge.ok{border-color:var(--ok);color:var(--ok)}.understood .badge.warn{border-color:var(--bad);color:var(--bad)}
.understood .rw{font-size:13px;margin-top:3px;overflow-wrap:anywhere}
.understood .nr{font-size:13px;color:var(--bad);overflow-wrap:anywhere}
.understood .raw{font-size:13px;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
.understood .note{font-size:12px;color:var(--muted)}
.msg.user.wide{max-width:100%;align-self:stretch}
.msg .emo{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.msg .emo-btn{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:0 6px;font-size:18px;line-height:1.5;cursor:pointer;min-width:34px;min-height:30px}
.msg .emo-btn:focus-visible{outline:2px solid var(--accent)}
.msg .emo-note{font-size:12px;color:var(--muted);white-space:normal;min-height:0}
.msg .pending{font-size:12px;color:var(--muted);margin-top:4px;white-space:normal}
.understood .clarify{border-left:3px solid var(--bad);padding:2px 8px;margin:6px 0;font-size:14px}
.understood .left{font-size:13px;margin:6px 0}.understood .left li{overflow-wrap:anywhere}
.understood .err{font-size:12px;color:var(--bad)}
@media (max-width:560px){.chat{padding:10px 10px 0}.msg{max-width:100%}.review-actions button{flex:1 1 auto}}
`;

const script = `
const $=id=>document.getElementById(id);
const MODEL=document.body.dataset.model;
// Model registry (config/formalizers.json): [{id,label,note,capabilities,state,error,default,default_for}], empty without a registry.
let models=JSON.parse(document.body.dataset.models||'[]');
const DEFAULTS=JSON.parse(document.body.dataset.defaultModels||'{}');
const MODES={chat:'Chat',formalize:'Formalize (SOP Lang)',translate:'Translate to English'};
const EXAMPLES={chat:'Ask anything, for example: What is the capital of France?',formalize:'Ask something, for example: Who works at Alpha Lab?',translate:'Type a message in any language, for example: Unde lucrează Maria?'};
const store={get(key,fallback){try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}};
let conversations=store.get('chatsop.conversations',['default']);
let current=store.get('chatsop.current','default');
if(!conversations.includes(current))conversations.unshift(current);
let sending=false;
// en or ro force the answer language; auto (Any) lets the host infer it from the message.
let language=store.get('chatsop.language','auto');if(!['en','ro','auto'].includes(language))language='auto';
const capable=(m,md)=>(m.capabilities??['formalize']).includes(md);
let mode=store.get('chatsop.mode','formalize');if(!MODES[mode])mode='formalize';
if(models.length&&!models.some(m=>capable(m,mode)))mode='formalize';
const modeModels=()=>models.filter(m=>capable(m,mode));
function pickModel(){
 let chosen=store.get('chatsop.model.'+mode,mode==='formalize'?store.get('chatsop.model',null):null);
 const list=modeModels();
 if(list.length&&!list.some(m=>m.id===chosen))chosen=(list.find(m=>m.id===DEFAULTS[mode])??list.find(m=>m.default)??list[0]).id;
 return chosen;
}
let model=pickModel();
const modelInfo=()=>models.find(m=>m.id===model);
let polling=null;
function showState(){
 const el=$('model-state');if(!el)return;const m=modelInfo();if(!m){el.textContent='';return;}
 const words={stopped:'stopped (starts with the first message)',starting:'starting…',ready:'ready',error:'error'+(m.error?': '+m.error:'')};
 el.textContent=words[m.state]??m.state;el.className='state '+(m.state==='ready'?'ok':m.state==='error'?'bad':'');el.title=m.note||'';
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
function plainTrace(c){
 const details=document.createElement('details');const summary=document.createElement('summary');
 const timing=typeof c.latency_ms==='number'?' · '+(c.latency_ms/1000).toFixed(2)+' s':'';
 summary.textContent='trace: '+c.mode+' · model '+(c.formalizer_model??'?')+timing;details.append(summary);
 const list=document.createElement('dl');
 field(list,'mode',MODES[c.mode]??c.mode);
 field(list,'model',c.model_label?c.model_label+' ('+c.formalizer_model+')':c.formalizer_model);
 if(typeof c.latency_ms==='number')field(list,'latency',c.latency_ms+' ms');
 field(list,'decoding',c.sampling);
 if(c.finish==='length')field(list,'finish','cut at the reply length cap');
 field(list,'system instruction',c.system_prompt??'none');
 if(c.mode==='chat')field(list,'earlier turns sent',String(c.history_turns??0));
 field(list,'answer language',c.mode==='translate'?'not applicable':c.answer_language??'any');
 if(c.usage&&typeof c.usage.completion_tokens==='number')field(list,'tokens',(c.usage.prompt_tokens??'?')+' prompt, '+c.usage.completion_tokens+' generated');
 details.append(list);
 return details;
}
function traceView(c){
 if(c.mode==='chat'||c.mode==='translate')return plainTrace(c);
 const details=document.createElement('details');const summary=document.createElement('summary');
 const timing=typeof c.formalization_ms==='number'?' · '+(c.formalization_ms/1000).toFixed(2)+' s':'';
 summary.textContent='trace: formalize · '+(c.status??'no status')+(c.backend!==undefined?' · backend '+(c.backend??'n/a'):'')+' · model '+(c.formalizer_model??'?')+timing;details.append(summary);
 const list=document.createElement('dl');
 field(list,'mode',MODES.formalize);field(list,'status',c.status);if(c.rejection)field(list,'rejected because',c.rejection);field(list,'backend',c.backend);field(list,'fallback',c.fallback===null?'none':c.fallback);field(list,'complete',c.completeness);field(list,'prompt profile',c.prompt_profile);
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
 const i=u.interpretation;const details=el('details','understood');details.open=true;
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
  if(s.status==='verified'){head.append(el('span','badge ok','verified'));head.append(el('span','cnl',s.cnl_sentences.join(' ')));}
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
 if(u&&showUnderstoodOn&&item.trace.mode==='formalize'&&!item.noPanel)div.append(understoodPanel(u));
 if(item.trace)div.append(traceView(item.trace));
 if(item.time){const meta=document.createElement('div');meta.className='meta';meta.textContent=new Date(item.time).toLocaleTimeString()+(item.mode?' \u00b7 '+(MODES[item.mode]??item.mode):'');div.append(meta);}
 $('log').append(div);
 return div;
}
function renderLog(){$('log').textContent='';const items=transcript(current);if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='Conversation "'+current+'", mode '+MODES[mode]+'. '+EXAMPLES[mode];$('log').append(p);}for(const item of items)add(item);window.scrollTo(0,document.body.scrollHeight);}
function remember(item){const items=transcript(current);items.push(item);saveTranscript(current,items);}
function explain(status,body){
 const message=body&&body.error&&body.error.message;
 if(status===401||status===403)return {text:'You are not signed in (or the session expired).',hint:'<a href="/login?next=%2Fchat">Sign in again</a>'};
 if(status===503)return {text:'The selected model is not available, so no answer could be produced'+(message?': '+message:'.'),hint:'Choose another model in the <b>Model</b> list above; the <a href="/">home page</a> shows the state of every model.'};
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
// on by default, remembered per browser; effective only in Formalize mode.
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
function prefetch(text){if(mode!=='formalize')return;if(emotionOn)api('/v1/emotion/detect',{message:text});if(showUnderstoodOn)api('/v1/understand',{message:text,rewrite:rewriteMode,emotion:emotionOn});}
async function proceedSend(text,cleaning){
 input.value='';
 const sentMode=mode,conversation=current,formalize=sentMode==='formalize';
 const user={id:uid(),role:'user',text,time:Date.now(),mode:sentMode};remember(user);const userDiv=add(user);
 const live=()=>conversation===current&&userDiv.isConnected;
 const pending=(cls,label)=>{const slot=userDiv.querySelector('.'+cls);if(slot)slot.append(el('div','pending',label));};
 // Independent capability calls (docs/api.html), started together and shown as each one arrives; the formalize request below reuses their cached work.
 const calls=[];
 if(formalize&&emotionOn){pending('emo-slot','detecting tone\u2026');calls.push(api('/v1/emotion/detect',{message:text}).then(r=>{if(r.ok){user.emotion=r.body;patchItem(conversation,user.id,{emotion:r.body});}if(live())showEmotion(userDiv,r.ok?r.body:null);}));}
 if(formalize&&showUnderstoodOn){pending('understood-slot','analysing what I understood\u2026');calls.push(api('/v1/understand',{message:text,rewrite:rewriteMode,emotion:emotionOn}).then(r=>{if(r.ok){user.understood=r.body;patchItem(conversation,user.id,{understood:r.body});if(live())showUnderstood(userDiv,r.body);}else if(live())setSlot(userDiv,'understood-slot',el('div','pending','The analysis of what I understood is not available ('+(r.status||'no connection')+').'));}));}
 const waiting=document.createElement('div');waiting.className='msg assistant muted';waiting.textContent=modelInfo()&&modelInfo().state!=='ready'?'starting the model, then thinking\u2026':'thinking\u2026';$('log').append(waiting);window.scrollTo(0,document.body.scrollHeight);
 let status=0,body=null;
 try{const response=await fetch('/v1/chat/completions',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:model??MODEL,mode:sentMode,messages:[{role:'user',content:text}],conversation_id:conversation,language,...(cleaning?{cleaning}:{}),...(formalize?{understanding:{interpret:showUnderstoodOn,rewrite:rewriteMode,emotion:emotionOn}}:{})})});status=response.status;body=await response.json().catch(()=>null);}catch{status=0;}
 await Promise.allSettled(calls);
 waiting.remove();if(models.length)refreshModels();
 const noPanel=Boolean(user.understood);
 if(noPanel&&body&&body.chatSop&&body.chatSop.understanding){const t={...body.chatSop,understanding:{...body.chatSop.understanding,interpretation:null,emotion:null}};body={...body,chatSop:t};}
 const item=status===200&&body&&body.choices?{role:'assistant',text:body.choices[0].message.content,trace:body.chatSop,time:Date.now(),mode:sentMode,noPanel}:{role:'assistant error',...explain(status,body),time:Date.now(),mode:sentMode};
 if(conversation===current){remember(item);add(item);}else{const items=transcript(conversation);items.push(item);saveTranscript(conversation,items);}
 sending=false;$('send').disabled=false;input.focus();window.scrollTo(0,document.body.scrollHeight);
}
function showReview(original,clean){
 const el=$('clean-review');if(!el)return proceedSend(original,null);
 el.hidden=false;el.textContent='';
 const title=document.createElement('p');title.className='review-title';title.textContent='Proposed clean English ('+(clean.backend&&clean.backend!=='none'?clean.backend:'host')+'). Review it, then choose:';el.append(title);
 el.append(diffView(clean.spans));
 if(!clean.spans||!clean.spans.length){const p=document.createElement('p');p.className='diff';p.textContent=clean.clean;el.append(p);}
 if(clean.reasons&&clean.reasons.length){const reasons=document.createElement('p');reasons.className='meta';reasons.textContent='Why: '+clean.reasons.join(', ');el.append(reasons);}
 if(clean.errors&&clean.errors.length){const w=document.createElement('p');w.className='meta';w.textContent='Part of the check could not run ('+clean.errors.map(e=>e.component+(e.span?' on \u201c'+e.span+'\u201d':'')).join(', ')+'); those sentences are left as you wrote them.';el.append(w);}
 prefetch(clean.clean);
 const actions=document.createElement('div');actions.className='review-actions';
 const accept=document.createElement('button');accept.type='button';accept.className='primary';accept.textContent='Accept';
 accept.onclick=()=>{hideReview();sending=true;$('send').disabled=true;proceedSend(clean.clean,{original,backend:clean.backend,changed:true});};
 const edit=document.createElement('button');edit.type='button';edit.textContent='Edit';
 edit.onclick=()=>{hideReview();input.value=clean.clean;input.focus();};
 const useOriginal=document.createElement('button');useOriginal.type='button';useOriginal.textContent='Send original';
 useOriginal.onclick=()=>{hideReview();sending=true;$('send').disabled=true;proceedSend(original,{original,backend:clean.backend,changed:false});};
 actions.append(accept,edit,useOriginal);el.append(actions);
 window.scrollTo(0,document.body.scrollHeight);
}
const input=$('input');
async function send(){
 const text=input.value.trim();if(!text||sending)return;
 sending=true;$('send').disabled=true;
 if(!transcript(current).length)$('log').textContent='';
 if(mode==='formalize'&&cleanBeforeFormalize){
  const checking=document.createElement('div');checking.className='msg assistant muted';checking.textContent='checking the wording…';$('log').append(checking);window.scrollTo(0,document.body.scrollHeight);
  let clean=null;
  const r=await api('/v1/language/proofread',{message:text,sendAll:cleanSendAll});if(r.ok)clean=r.body;
  checking.remove();
  if(clean&&clean.changed){showReview(text,clean);sending=false;$('send').disabled=false;return;}
 }
 await proceedSend(text,null);
}
function newConversation(){const stamp=new Date().toISOString().slice(0,16).replace(/[-:T]/g,'');const id='c'+stamp+'-'+Math.random().toString(36).slice(2,6);conversations.unshift(id);current=id;store.set('chatsop.conversations',conversations.slice(0,50));store.set('chatsop.current',current);renderSelect();renderLog();$('input').focus();}
$('conversation').onchange=e=>{current=e.target.value;store.set('chatsop.current',current);renderLog();};
$('new').onclick=newConversation;
$('clear').onclick=()=>{saveTranscript(current,[]);renderLog();};
$('send').onclick=send;
$('language').value=language;$('language').onchange=e=>{language=e.target.value;store.set('chatsop.language',language);};
if($('clean-toggle')){$('clean-toggle').checked=cleanBeforeFormalize;$('clean-toggle').onchange=e=>{cleanBeforeFormalize=e.target.checked;store.set('chatsop.cleanBeforeFormalize',cleanBeforeFormalize);$('send-all-toggle').disabled=!cleanBeforeFormalize;if(!cleanBeforeFormalize)hideReview();};}
$('send-all-toggle').checked=cleanSendAll;$('send-all-toggle').disabled=!cleanBeforeFormalize;$('send-all-toggle').onchange=e=>{cleanSendAll=e.target.checked;store.set('chatsop.cleanSendAll',cleanSendAll);};
$('rewrite-select').value=rewriteMode;$('rewrite-select').onchange=e=>{rewriteMode=e.target.value;store.set('chatsop.rewrite',rewriteMode);};
$('emotion-toggle').checked=emotionOn;$('emotion-toggle').onchange=e=>{emotionOn=e.target.checked;store.set('chatsop.emotion',emotionOn);};
$('understood-toggle').checked=showUnderstoodOn;$('understood-toggle').onchange=e=>{showUnderstoodOn=e.target.checked;store.set('chatsop.showUnderstood',showUnderstoodOn);renderLog();};
function syncCleanToggle(){const wrap=$('settings');if(wrap)wrap.style.display=mode==='formalize'?'':'none';if(mode!=='formalize')hideReview();}
function syncLanguage(){const off=mode==='translate';$('language').disabled=off;$('language').title=off?'Not applicable in Translate mode':$('language').dataset.title;}
$('language').dataset.title=$('language').title;
function renderModels(){
 const select=$('model');if(!select)return;select.textContent='';
 for(const m of modeModels()){const option=document.createElement('option');option.value=m.id;option.textContent=m.label;option.title=m.note||'';select.append(option);}
 model=pickModel();select.value=model;store.set('chatsop.model.'+mode,model);
}
if($('mode')){
 for(const [id,label] of Object.entries(MODES)){if(!models.some(m=>capable(m,id)))continue;const option=document.createElement('option');option.value=id;option.textContent=label;$('mode').append(option);}
 $('mode').value=mode;
 $('mode').onchange=e=>{mode=e.target.value;store.set('chatsop.mode',mode);renderModels();syncLanguage();syncCleanToggle();showState();startModel();if(!transcript(current).length)renderLog();};
}
syncLanguage();syncCleanToggle();
if($('model')){
 renderModels();
 $('model').onchange=e=>{model=e.target.value;store.set('chatsop.model.'+mode,model);startModel();};
 showState();startModel();
}
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
renderSelect();renderLog();$('input').focus();
`;

export function chatPage({model, ready, models = null, defaultModel = null, defaultModels = null, settings = {}}) {
  const banner = ready ? '' : models
    ? '<p class="notice bad">No formalizer model can run on this server (see the <a href="/">home page</a> for each model\'s state).</p>'
    : '<p class="notice bad">The formalizer endpoint is not ready, so answers will fail with "model unavailable" until it runs. See the <a href="/">home page</a> for details.</p>';
  const modelBar = models ? '<label for="mode" style="margin:0">Mode</label><select id="mode" title="Chat: plain conversation with a base model. Formalize: SOP Lang with a fine-tuned formalizer and the host. Translate: a base model translates the message into English."></select><label for="model" style="margin:0">Model</label><select id="model" title="The models of the chosen mode (config/formalizers.json capabilities)"></select><span id="model-state" class="state" aria-live="polite"></span>' : '';
  const body = `<main class="chat" data-ready="${ready ? 'yes' : 'no'}">
${banner}<div class="bar"><label for="conversation" style="margin:0">Conversation</label><select id="conversation"></select><button id="new" type="button">New conversation</button><button id="clear" type="button" title="Clears only this browser's copy of the transcript; the server keeps the conversation context">Clear view</button></div>
<div class="bar">${modelBar}<label for="language" style="margin:0">Answer language</label><select id="language" title="English or Română force the answer language; Any infers it from the message (an explicit request such as &quot;answer in Romanian&quot;, otherwise English)"><option value="en">English</option><option value="ro">Română</option><option value="auto">Any</option></select></div>
<p class="help" style="font-size:13px;color:var(--muted);margin:0 0 8px">${models ? '<b>Mode</b>: <i>Chat</i> talks with an unmodified base instruct model (SmolLM2 or Gemma 3, not fine-tuned; light sampling, earlier turns of this conversation included) to show its general ability; <i>Formalize (SOP Lang)</i> sends the message alone to a fine-tuned formalizer and the host answers from reviewed knowledge; <i>Translate to English</i> asks a base model for an English translation (greedy, fixed prompt). <b>Model</b>: the models of that mode; a stopped model starts when selected (a few seconds on CPU), at most three run at once, and each stops after 15 idle minutes. ' : ''}<b>Answer language</b>: in Formalize, English or Română always answer in that language and Any answers in English unless the message asks for another language ("răspunde în română"); in Chat, English or Română add the instruction "Answer in …" and Any adds none; Translate ignores it. <b>Settings</b> (Formalize only, remembered in this browser): <i>Clean text before formalizing</i>: a host step proposes clean, correct, English wording before the formalizer sees the message; nothing is sent to the formalizer without your review when it changes the text. The trace under each answer shows the mode, the model and the latency, and in Formalize also the model SOP and the execution circuit.</p>
<details id="settings" class="settings"><summary>Settings (formalize): clean text, rewrite, tone detection, show what I understood</summary><div class="grid">
<label title="Before Formalize, LanguageProofingLLM corrects spelling and grammar and translates or simplifies the message (textToCleanEnglish, a host step, not the formalizer); you review and accept, edit or send the original. Off sends your message exactly as typed."><input type="checkbox" id="clean-toggle">Clean text before formalizing</label>
<label title="On: every sentence goes to LanguageProofingLLM, clean ones too (the gate finds only about 28% of the sentences that need cleaning). Off: only the sentences the gate flags."><input type="checkbox" id="send-all-toggle">Send every sentence</label>
<label title="SymbolicProofingLLM rewrites sentences SymbolicLM does not analyse reliably into the limited English it understands. Off: never. Gated: only sentences whose Stanza trees are not certified, and the rewrite is kept only if it is certified and keeps names, numbers, negation and quantifiers. Always: every sentence, every rewrite kept. Needs the SymbolicLM model."><span>SymbolicProofingLLM rewrite</span><select id="rewrite-select"><option value="off">off</option><option value="gated">gated (trees + certified)</option><option value="always">always</option></select></label>
<label title="EmotionDetectionSystem: classifies greetings, thanks, politeness, urgency, hedges, frustration and similar tone signals, including the parts SymbolicLM could not represent, and lets the reasoner adjust (a short courtesy reply, a shorter answer, a re-check). Advisory only; needs the SymbolicLM model."><input type="checkbox" id="emotion-toggle">Detect tone and courtesy</label>
<label title="Shows, under each answer, the sentences SymbolicLM understood restated in short controlled English, the parts it did not represent and whether its analysis is certified. Needs the SymbolicLM model."><input type="checkbox" id="understood-toggle">Show what I understood (CNL)</label>
</div></details>
<div id="log" aria-live="polite"></div>
<div id="clean-review" class="review" hidden aria-live="polite"></div>
<div class="composer"><textarea id="input" rows="2" placeholder="Type a message. Enter sends, Shift+Enter adds a new line." aria-label="Message"></textarea><button id="send" class="primary" type="button">Send</button></div>
</main>`;
  return layout({title: 'ChatSOP chat', active: 'chat', signedIn: true, body, script: sopCodeScript + '\n' + script, style: style + SOP_CODE_STYLE}).replace('<body>', `<body data-model="${escapeHtml(model)}" data-models="${escapeHtml(JSON.stringify(models ?? []))}" data-default-model="${escapeHtml(defaultModel ?? '')}" data-default-models="${escapeHtml(JSON.stringify(defaultModels ?? {}))}" data-settings="${escapeHtml(JSON.stringify(settings ?? {}))}">`);
}
