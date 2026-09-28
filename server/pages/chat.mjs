/** Browser chat on top of `POST /v1/chat/completions`. The page uses the
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
@media (max-width:560px){.chat{padding:10px 10px 0}.msg{max-width:100%}}
`;

const script = `
const $=id=>document.getElementById(id);
const MODEL=document.body.dataset.model;
const store={get(key,fallback){try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}};
let conversations=store.get('chatsop.conversations',['default']);
let current=store.get('chatsop.current','default');
if(!conversations.includes(current))conversations.unshift(current);
let sending=false;
// '' = default: English, or the language explicitly requested in the message.
let language=store.get('chatsop.language','');
const transcript=id=>store.get('chatsop.transcript.'+id,[]);
const saveTranscript=(id,items)=>store.set('chatsop.transcript.'+id,items.slice(-100));
function renderSelect(){const select=$('conversation');select.textContent='';for(const id of conversations){const option=document.createElement('option');option.value=id;option.textContent=id;option.selected=id===current;select.append(option);}}
function field(list,label,value){if(value===undefined||value===null||value==='')return;const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=typeof value==='string'?value:JSON.stringify(value);list.append(dt,dd);}
function block(parent,label,text){if(!text)return;const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=label;const pre=document.createElement('pre');pre.textContent=typeof text==='string'?text:JSON.stringify(text,null,2);details.append(summary,pre);parent.append(details);}
function sopBlock(parent,label,text){if(!text)return;const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=label;const pre=document.createElement('pre');const code=document.createElement('code');if(typeof text==='string'&&window.ChatSopCode)code.innerHTML=window.ChatSopCode.render(text);else code.textContent=typeof text==='string'?text:JSON.stringify(text,null,2);pre.append(code);details.append(summary,pre);parent.append(details);}
function traceView(c){
 const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='trace: '+(c.status??'no status')+' · backend '+(c.backend??'n/a');details.append(summary);
 const list=document.createElement('dl');
 field(list,'status',c.status);field(list,'backend',c.backend);field(list,'fallback',c.fallback===null?'none':c.fallback);field(list,'complete',c.completeness);field(list,'prompt profile',c.prompt_profile);field(list,'formalizer',c.formalizer_model);
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
function add(item){
 const div=document.createElement('div');div.className='msg '+item.role;
 const text=document.createElement('div');text.textContent=item.text;div.append(text);
 if(item.hint){const hint=document.createElement('div');hint.className='meta';hint.innerHTML=item.hint;div.append(hint);}
 if(item.trace)div.append(traceView(item.trace));
 if(item.time){const meta=document.createElement('div');meta.className='meta';meta.textContent=new Date(item.time).toLocaleTimeString();div.append(meta);}
 $('log').append(div);
}
function renderLog(){$('log').textContent='';const items=transcript(current);if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='Conversation "'+current+'". Ask something, for example: Who works at Alpha Lab?';$('log').append(p);}for(const item of items)add(item);window.scrollTo(0,document.body.scrollHeight);}
function remember(item){const items=transcript(current);items.push(item);saveTranscript(current,items);}
function explain(status,body){
 const message=body&&body.error&&body.error.message;
 if(status===401||status===403)return {text:'You are not signed in (or the session expired).',hint:'<a href="/login?next=%2Fchat">Sign in again</a>'};
 if(status===503)return {text:'The formalizer model is not available, so no answer could be produced.',hint:'Chat answers need a running formalizer endpoint (<code>formalizer.url</code> in the runtime configuration). See the <a href="/">home page</a> for its current state.'};
 if(status===409)return {text:'This conversation is still answering the previous message. Wait for it, or start a new conversation.'};
 if(status===429)return {text:'The server is busy (too many simultaneous requests). Try again in a moment.'};
 if(status===504)return {text:'The answer took too long and was stopped.',hint:'If the message asked to store something, check the result before sending it again.'};
 if(status===413)return {text:'The message is too long for this server.'};
 if(status===400)return {text:message?'The request was refused: '+message:'The request was refused.'};
 if(status===0)return {text:'The server could not be reached. Check the connection and try again.'};
 return {text:'The server answered HTTP '+status+(message?': '+message:'')};
}
async function send(){
 const input=$('input');const text=input.value.trim();if(!text||sending)return;
 sending=true;$('send').disabled=true;input.value='';
 if(!transcript(current).length)$('log').textContent='';
 const user={role:'user',text,time:Date.now()};remember(user);add(user);
 const waiting=document.createElement('div');waiting.className='msg assistant muted';waiting.textContent='thinking…';$('log').append(waiting);window.scrollTo(0,document.body.scrollHeight);
 const conversation=current;let status=0,body=null;
 try{const response=await fetch('/v1/chat/completions',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,messages:[{role:'user',content:text}],conversation_id:conversation,...(language?{language}:{})})});status=response.status;body=await response.json().catch(()=>null);}catch{status=0;}
 waiting.remove();
 const item=status===200&&body&&body.choices?{role:'assistant',text:body.choices[0].message.content,trace:body.chatSop,time:Date.now()}:{role:'assistant error',...explain(status,body),time:Date.now()};
 if(conversation===current){remember(item);add(item);}else{const items=transcript(conversation);items.push(item);saveTranscript(conversation,items);}
 sending=false;$('send').disabled=false;input.focus();window.scrollTo(0,document.body.scrollHeight);
}
function newConversation(){const stamp=new Date().toISOString().slice(0,16).replace(/[-:T]/g,'');const id='c'+stamp+'-'+Math.random().toString(36).slice(2,6);conversations.unshift(id);current=id;store.set('chatsop.conversations',conversations.slice(0,50));store.set('chatsop.current',current);renderSelect();renderLog();$('input').focus();}
$('conversation').onchange=e=>{current=e.target.value;store.set('chatsop.current',current);renderLog();};
$('new').onclick=newConversation;
$('clear').onclick=()=>{saveTranscript(current,[]);renderLog();};
$('send').onclick=send;
$('language').value=language;$('language').onchange=e=>{language=e.target.value;store.set('chatsop.language',language);};
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
renderSelect();renderLog();$('input').focus();
`;

export function chatPage({model, ready}) {
  const banner = ready ? '' : '<p class="notice bad">The formalizer endpoint is not ready, so answers will fail with "model unavailable" until it runs. See the <a href="/">home page</a> for details.</p>';
  const body = `<main class="chat" data-ready="${ready ? 'yes' : 'no'}">
${banner}<div class="bar"><label for="conversation" style="margin:0">Conversation</label><select id="conversation"></select><button id="new" type="button">New conversation</button><button id="clear" type="button" title="Clears only this browser's copy of the transcript; the server keeps the conversation context">Clear view</button><label for="language" style="margin:0">Answer language</label><select id="language" title="Default answers in English unless the message asks for another language"><option value="">Default (English, or as asked in the message)</option><option value="en">English</option><option value="ro">Română</option></select></div>
<div id="log" aria-live="polite"></div>
<div class="composer"><textarea id="input" rows="2" placeholder="Type a message. Enter sends, Shift+Enter adds a new line." aria-label="Message"></textarea><button id="send" class="primary" type="button">Send</button></div>
</main>`;
  return layout({title: 'ChatSOP chat', active: 'chat', signedIn: true, body, script: sopCodeScript + '\n' + script, style: style + SOP_CODE_STYLE}).replace('<body>', `<body data-model="${escapeHtml(model)}">`);
}
