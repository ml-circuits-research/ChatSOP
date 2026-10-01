/** The product layer of the chat page (DS031, DS012 "The chat page"): sessions, base memories and the coding agent.
 *
 * - The *session bar* shows the session of the current conversation (its base memory, strategy, circuits and drafts) with *Start
 *   session*, *Base memories*, *Drafts* and *Commit* buttons. Every conversation is bound to a server session (`POST /v1/sessions`);
 *   a new conversation opens the *start dialog* where the base memory is chosen. The chat request carries `session_id`.
 * - The *base memory manager* lists the memories (`GET /v1/memories`), shows one (manifest, provenance, stored facts, circuits),
 *   forks it with a chosen strategy, adds knowledge (validated; problems are shown, nothing is written on failure) and creates or
 *   imports a memory. Writes need the administrator session (the page says so when the server answers 403).
 * - *Attach files* (UTF-8 text) and the *Coding agent* setting (Auto, Always, Off) with the omp model picker (`GET /v1/omp/models`,
 *   subscription models first, with their cost class). `POST /v1/route` decides, for each message, between SymbolicLM and the coding
 *   agent and says why; the "I understood" area shows the path and the reason. Attached files and the Always setting go to the
 *   coding agent; a detected SymbolicLM failure or a scope the model surface cannot write does too; when omp is unavailable the page
 *   says so and SymbolicLM answers.
 * - The coding agent's progress (`POST /v1/author` with `wait: false`, polled) and its draft circuits, with validation, report and
 *   cost, are shown in the conversation with Accept and Reject. Nothing is knowledge until the user accepts a draft.
 * All dynamic text is inserted with textContent; the page never builds markup from server data.
 */

export const PRODUCT_STYLE = `
.session-bar{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:6px 10px;margin:0 0 8px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:13px}
.session-bar .info{flex:1 1 260px;min-width:0;overflow-wrap:anywhere}
.session-bar .info b{font-weight:600}
.session-bar button{padding:4px 10px;font-size:13px}
.pill{display:inline-block;font-size:11px;line-height:1.6;padding:0 7px;border-radius:9px;border:1px solid var(--line);color:var(--muted);white-space:nowrap;margin-left:4px}
.pill.ok{border-color:var(--ok);color:var(--ok)}.pill.warn{border-color:var(--bad);color:var(--bad)}.pill.accent{border-color:var(--accent);color:var(--accent)}
dialog{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:16px 18px;width:min(720px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto}
dialog::backdrop{background:rgba(0,0,0,.45)}
dialog h2{margin:0 0 8px;font-size:1.1rem}
dialog .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
dialog .row label{margin:0;font-size:13px;color:var(--muted)}
dialog .row input[type=text],dialog .row select{flex:1 1 180px;min-width:0}
dialog textarea{width:100%;min-height:110px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
dialog .actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px}
dialog fieldset{border:1px solid var(--line);border-radius:8px;margin:10px 0;padding:6px 10px 10px}
dialog legend{font-size:13px;color:var(--muted);padding:0 4px}
dialog dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin:6px 0;font-size:13px}dialog dt{color:var(--muted)}dialog dd{margin:0;overflow-wrap:anywhere}
dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:6px 8px;max-height:220px;overflow:auto;margin:6px 0}
dialog .msgline{font-size:13px;margin:6px 0;overflow-wrap:anywhere}.msgline.bad{color:var(--bad)}.msgline.ok{color:var(--ok)}
dialog ul.problems{margin:4px 0 4px 18px;padding:0;font-size:13px}
.route-note{font-size:12.5px;margin:6px 0 0;padding:4px 8px;border-left:3px solid var(--accent);background:var(--soft);border-radius:4px;overflow-wrap:anywhere}
.route-note.agent{border-left-color:var(--ok)}.route-note.fallback{border-left-color:var(--bad)}
.agent-msg{border-color:var(--ok);max-width:100%;align-self:stretch;white-space:normal}
.agent-msg .head{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-weight:600}
.agent-msg .status{font-size:13px;color:var(--muted);margin:4px 0}
.agent-msg pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:6px 8px;max-height:260px;overflow:auto;margin:6px 0}
.agent-msg ul{margin:4px 0 4px 18px;padding:0;font-size:13px}
.agent-msg .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--soft);border-radius:14px;padding:1px 4px 1px 10px;font-size:12.5px;max-width:100%}
.chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.chip button{padding:0 7px;border-radius:12px;font-size:14px;line-height:1.4}
.composer .attach{align-self:flex-end}
.settings .sub{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.settings .sub select{max-width:100%;min-width:0;flex:1 1 220px}
@media (max-width:560px){.session-bar button{flex:1 1 auto}dialog{padding:12px}}
`;

export const productBarHtml = `<div id="session-bar" class="session-bar" aria-label="Session and base memory"><span class="info" id="session-info">Loading the session…</span><button id="session-start" type="button" title="Start a new session on a base memory of your choice">Start session…</button><button id="mem-open" type="button" title="List, fork and extend base memories">Base memories…</button><button id="drafts-open" type="button" title="Circuits the coding agent proposed, waiting for you to accept or reject them">Drafts</button><button id="commit-open" type="button" title="Commit the circuits accepted in this session to a new base memory (administrator)">Commit…</button></div>`;

export const productSettingsHtml = `<div class="sub"><label for="authoring-select" title="Auto: attached files, a scope SymbolicLM cannot write and detected SymbolicLM failures go to the coding agent (omp); everything else to SymbolicLM. Always: every message goes to the coding agent when omp is configured, skipping our heuristics and SymbolicLM when you want more correctness. Off: never.">Coding agent (omp)</label><select id="authoring-select"><option value="auto">Auto</option><option value="always">Always</option><option value="off">Off</option></select><label for="omp-model" title="Models omp can use, from GET /v1/omp/models (administrator). Subscription models are listed first.">Model</label><select id="omp-model"><option value="">omp default</option></select><button id="omp-refresh" type="button" title="Read the model list from omp again">Refresh</button></div><p id="omp-note" class="meta" style="grid-column:1/-1;margin:0;font-size:12px;color:var(--muted)"></p>`;

export const productDialogsHtml = `
<dialog id="start-dialog" aria-labelledby="start-title"><h2 id="start-title">Start a session</h2>
<p class="msgline">A session works on its own copy of a base memory. What the conversation adds stays in the session until you commit it to a fork.</p>
<div class="row"><label for="start-base">Base memory</label><select id="start-base"></select></div>
<div id="start-detail" class="msgline"></div>
<div class="row"><label for="start-name">Session name</label><input type="text" id="start-name" maxlength="120" placeholder="optional"></div>
<div id="start-error" class="msgline bad" hidden></div>
<div class="actions"><button id="start-cancel" type="button">Cancel</button><button id="start-go" type="button" class="primary">Start session</button></div></dialog>
<dialog id="mem-dialog" aria-labelledby="mem-title"><h2 id="mem-title">Base memories</h2>
<div class="row"><label for="mem-select">Memory</label><select id="mem-select"></select><button id="mem-refresh" type="button">Reload</button></div>
<div id="mem-detail"></div>
<fieldset><legend>Fork</legend><div class="row"><label for="fork-name">Name</label><input type="text" id="fork-name" maxlength="120" placeholder="name of the fork"><label for="fork-strategy">Strategy</label><select id="fork-strategy"></select><button id="fork-go" type="button">Fork</button></div><div class="msgline">Same strategy: a copy-on-write clone. Another strategy: the circuits are replayed into the new engine.</div></fieldset>
<fieldset><legend>Add knowledge to the selected memory (administrator)</legend><div class="row"><label for="know-name">Circuit name</label><input type="text" id="know-name" maxlength="80" value="circuit"><input type="file" id="know-file" accept=".sop,.txt,text/plain"></div><textarea id="know-text" placeholder="Knowledge wires, for example:&#10;@parent predicate&#10;  args subject:entity object:entity&#10;@f1 fact&#10;  holds parent ann bob&#10;  source &quot;demo&quot;" aria-label="Circuit text"></textarea><div class="row"><label for="know-reason">Reason</label><input type="text" id="know-reason" maxlength="200" placeholder="why it is added"><button id="know-go" type="button" class="primary">Validate and add</button></div></fieldset>
<fieldset><legend>Create an empty memory</legend><div class="row"><label for="new-name">Name</label><input type="text" id="new-name" maxlength="120"><label for="new-strategy">Strategy</label><select id="new-strategy"></select><button id="new-go" type="button">Create</button></div></fieldset>
<div id="mem-msg" class="msgline" role="status"></div>
<div class="actions"><button id="mem-close" type="button">Close</button></div></dialog>
<dialog id="drafts-dialog" aria-labelledby="drafts-title"><h2 id="drafts-title">Draft circuits</h2><div id="drafts-list"></div><div id="drafts-msg" class="msgline" role="status"></div><div class="actions"><button id="drafts-close" type="button">Close</button></div></dialog>
<dialog id="commit-dialog" aria-labelledby="commit-title"><h2 id="commit-title">Commit the session to a base memory</h2>
<p class="msgline">Creates a new base memory: a fork of the session's base memory plus the circuits you accepted in this session, validated again. The original base memory does not change. Administrator action, recorded with provenance.</p>
<div class="row"><label for="commit-name">Name</label><input type="text" id="commit-name" maxlength="120"><label for="commit-strategy">Strategy</label><select id="commit-strategy"></select></div>
<div id="commit-msg" class="msgline" role="status"></div>
<div class="actions"><button id="commit-cancel" type="button">Cancel</button><button id="commit-go" type="button" class="primary">Commit</button></div></dialog>`;

export const attachHtml = `<button id="attach" class="attach" type="button" title="Attach UTF-8 text files (txt, md, sop, csv, json): instructions or sources for the coding agent, which writes SOP circuits from them">Attach</button><input type="file" id="attach-file" multiple hidden>`;
export const chipsHtml = `<div id="chips" class="chips" aria-label="Attached files"></div>`;

export const productScript = String.raw`
// ---- product layer (DS031): sessions, base memories, the coding agent ----
const PROD={session:null,memories:[],strategies:[],omp:null,files:[],busy:false};
async function jcall(method,path,body){
 try{const r=await fetch(path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json();}catch{}
  return {ok:r.ok&&Boolean(j)&&!j.error,status:r.status,body:j,error:j&&j.error?j.error:null};}
 catch{return {ok:false,status:0,body:null,error:{message:'The server could not be reached.'}};}
}
const errText=r=>r.error?r.error.message+(r.error.problems?' ('+r.error.problems.length+' problem'+(r.error.problems.length===1?'':'s')+')':''):'HTTP '+r.status;
function problemList(problems){const ul=el('ul','problems');for(const p of problems||[]){ul.append(el('li','',(p.file?p.file+(p.line?':'+p.line:'')+' ':'')+p.code+(p.wire?' (@'+p.wire+')':'')+': '+p.message));}return ul;}
const sessionMap=()=>store.get('chatsop.sessionOf',{});
const boundSession=()=>sessionMap()[current]||null;
function bindSession(id){const m=sessionMap();m[current]=id;store.set('chatsop.sessionOf',m);}
function sessionBody(){return PROD.session?{session_id:PROD.session.id}:{};}
function renderSessionBar(){
 const info=$('session-info');info.textContent='';const s=PROD.session;
 if(!s){info.textContent='No session yet.';return;}
 info.append(el('b','',s.name||s.id),document.createTextNode(' · base '),el('b','',s.base.name));
 info.append(el('span','pill accent',s.base.strategy));
 const accepted=(s.circuits||[]).length,drafts=(s.drafts||[]).filter(d=>d.state==='draft').length;
 info.append(el('span','pill',accepted+' session circuit'+(accepted===1?'':'s')));
 if(drafts)info.append(el('span','pill warn',drafts+' draft'+(drafts===1?'':'s')));
 if((s.committed_to||[]).length)info.append(el('span','pill ok','committed'));
 info.title='session '+s.id;
 $('authoring-select').value=(s.settings&&s.settings.authoring)||'auto';
 const model=(s.settings&&s.settings.omp_model)||'';if([...$('omp-model').options].some(o=>o.value===model))$('omp-model').value=model;
 $('commit-open').disabled=!accepted;$('drafts-open').textContent=drafts?'Drafts ('+drafts+')':'Drafts';
}
async function refreshSession(){
 if(!PROD.session)return;const r=await jcall('GET','/v1/sessions/'+PROD.session.id);
 if(r.ok)PROD.session=r.body;renderSessionBar();
}
async function startSession(baseId,name){
 const r=await jcall('POST','/v1/sessions',{base:baseId,...(name?{name}:{}),settings:{authoring:store.get('chatsop.authoring','auto'),omp_model:store.get('chatsop.ompModel',null)}});
 if(!r.ok)return r;
 PROD.session=r.body;bindSession(r.body.id);store.set('chatsop.lastBase',baseId);renderSessionBar();return r;
}
async function ensureSession(){
 const id=boundSession();
 if(id){const r=await jcall('GET','/v1/sessions/'+id);if(r.ok){PROD.session=r.body;renderSessionBar();return PROD.session;}}
 PROD.session=null;renderSessionBar();
 let r=await startSession(store.get('chatsop.lastBase','default'));
 if(!r.ok)r=await startSession('default');
 if(!r.ok)$('session-info').textContent='No session: '+errText(r);
 return PROD.session;
}
async function loadMemories(){const r=await jcall('GET','/v1/memories');if(r.ok){PROD.memories=r.body.data;PROD.strategies=r.body.strategies;}return r;}
function fillStrategies(select,selected){select.textContent='';for(const s of PROD.strategies){const o=document.createElement('option');o.value=s.id;o.textContent=s.id;o.title=s.note;select.append(o);}if(selected)select.value=selected;}
const memLabel=m=>m.name+' · '+m.strategy+' · '+m.circuits+' circuit'+(m.circuits===1?'':'s');

// ---- start dialog
function showStartDetail(){
 const m=PROD.memories.find(x=>x.id===$('start-base').value);const box=$('start-detail');box.textContent='';if(!m)return;
 box.append(document.createTextNode((m.description||'No description.')+' '+m.circuits+' circuit(s), '+m.facts+' stored fact(s), strategy '+m.strategy+(m.parent?', forked from '+m.parent.name:'')+'.'));
}
async function openStart(){
 await loadMemories();const select=$('start-base');select.textContent='';
 for(const m of PROD.memories){const o=document.createElement('option');o.value=m.id;o.textContent=memLabel(m);select.append(o);}
 select.value=store.get('chatsop.lastBase','default');if(!select.value&&PROD.memories.length)select.selectedIndex=0;
 $('start-error').hidden=true;$('start-name').value='';showStartDetail();$('start-dialog').showModal();
}
$('start-base').onchange=showStartDetail;
$('start-cancel').onclick=()=>$('start-dialog').close();
$('start-dialog').addEventListener('close',()=>{if(!boundSession())ensureSession();});
$('start-go').onclick=async()=>{
 const r=await startSession($('start-base').value,$('start-name').value.trim());
 if(!r.ok){$('start-error').hidden=false;$('start-error').textContent=errText(r);return;}
 $('start-dialog').close();
};
$('session-start').onclick=()=>openStart();
// A new conversation asks which base memory its session starts from.
$('new').onclick=()=>{newConversation();PROD.session=null;renderSessionBar();openStart();};
$('conversation').addEventListener('change',()=>{ensureSession();});

// ---- base memory manager
let memCurrent=null;
function memMsg(text,cls){const m=$('mem-msg');m.textContent=text||'';m.className='msgline'+(cls?' '+cls:'');}
async function renderMemory(){
 const box=$('mem-detail');box.textContent='';memCurrent=null;const id=$('mem-select').value;if(!id)return;
 const r=await jcall('GET','/v1/memories/'+encodeURIComponent(id)+'?facts=1');if(!r.ok){box.append(el('p','msgline bad',errText(r)));return;}
 const m=r.body;memCurrent=m;const dl=document.createElement('dl');
 field(dl,'id',m.id);field(dl,'strategy',m.strategy+(m.exact?' + exact sidecar':''));field(dl,'created',m.created_at);field(dl,'parent',m.parent?m.parent.name+' ('+m.parent.id+', '+m.parent.strategy+', forked '+m.parent.forked_at+')':'none');
 field(dl,'circuits',m.circuits+' ('+(m.circuit_files||[]).join(', ')+')');field(dl,'stored facts',m.facts);field(dl,'description',m.description);box.append(dl);
 const facts=Object.entries(m.stored_facts||{}).filter(([,rows])=>rows.length);
 if(facts.length){const d=el('details');d.append(el('summary','','stored facts ('+facts.reduce((n,[,rows])=>n+rows.length,0)+')'));const pre=el('pre','',facts.map(([p,rows])=>rows.slice(0,40).map(x=>p+' '+x.args.join(' ')).join('\n')).join('\n'));d.append(pre);box.append(d);}
 if((m.provenance||[]).length){const d=el('details');d.append(el('summary','','provenance ('+m.provenance.length+' latest)'));d.append(el('pre','',m.provenance.map(p=>(p.approved_at||p.at||'')+' '+p.kind+(p.approved_by?' by '+p.approved_by:'')+(p.file?' '+p.file:'')+(p.reason?' ('+p.reason+')':'')+(p.method?' '+p.method:'')).join('\n')));box.append(d);}
}
async function openManager(){
 await loadMemories();const select=$('mem-select');const keep=select.value;select.textContent='';
 for(const m of PROD.memories){const o=document.createElement('option');o.value=m.id;o.textContent=memLabel(m);select.append(o);}
 if(keep&&[...select.options].some(o=>o.value===keep))select.value=keep;else if(PROD.session&&[...select.options].some(o=>o.value===PROD.session.base.id))select.value=PROD.session.base.id;
 fillStrategies($('fork-strategy'));fillStrategies($('new-strategy'));
 await renderMemory();memMsg('');if(!$('mem-dialog').open)$('mem-dialog').showModal();
}
$('mem-open').onclick=openManager;$('mem-close').onclick=()=>$('mem-dialog').close();$('mem-refresh').onclick=openManager;$('mem-select').onchange=()=>{renderMemory();memMsg('');if(memCurrent)$('fork-strategy').value=memCurrent.strategy;};
$('fork-go').onclick=async()=>{
 const name=$('fork-name').value.trim();if(!memCurrent||!name){memMsg('Name the fork first.','bad');return;}
 const r=await jcall('POST','/v1/memories/'+encodeURIComponent(memCurrent.id)+'/fork',{name,strategy:$('fork-strategy').value});
 if(!r.ok){memMsg(r.status===403?'Forking needs the administrator session (sign in on /login).':errText(r),'bad');return;}
 memMsg('Forked as "'+r.body.memory.name+'" ('+r.body.memory.strategy+', '+(r.body.method==='clone'?'copy-on-write clone':'circuits replayed into the new engine')+').','ok');
 $('fork-name').value='';await loadMemories();const select=$('mem-select');select.textContent='';for(const m of PROD.memories){const o=document.createElement('option');o.value=m.id;o.textContent=memLabel(m);select.append(o);}select.value=r.body.memory.id;renderMemory();
};
$('know-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;$('know-text').value=await f.text();$('know-name').value=f.name.replace(/\.[^.]+$/,'').replace(/[^A-Za-z0-9_-]+/g,'-')||'circuit';};
$('know-go').onclick=async()=>{
 const text=$('know-text').value;if(!memCurrent||!text.trim()){memMsg('Choose a memory and paste or load a circuit.','bad');return;}
 const r=await jcall('POST','/v1/memories/'+encodeURIComponent(memCurrent.id)+'/knowledge',{circuits:[{name:$('know-name').value.trim()||'circuit',text}],reason:$('know-reason').value.trim()});
 const box=$('mem-msg');box.textContent='';
 if(!r.ok){box.className='msgline bad';box.append(document.createTextNode(r.status===403?'Adding knowledge needs the administrator session (sign in on /login).':'Not added: '+errText(r)));if(r.error&&r.error.problems)box.append(problemList(r.error.problems));return;}
 const a=r.body.added[0];box.className='msgline ok';box.textContent='Added '+a.file+': '+a.ingest.facts_ingested+' of '+a.ingest.facts_in_circuit+' fact(s) in the memory store, provenance recorded ('+a.approved_by+').'+(r.body.warnings.length?' '+r.body.warnings.length+' warning(s).':'');
 $('know-text').value='';renderMemory();
};
$('new-go').onclick=async()=>{
 const name=$('new-name').value.trim();if(!name){memMsg('Name the memory first.','bad');return;}
 const r=await jcall('POST','/v1/memories',{name,strategy:$('new-strategy').value});
 if(!r.ok){memMsg(r.status===403?'Creating a memory needs the administrator session (sign in on /login).':errText(r),'bad');return;}
 memMsg('Created "'+r.body.name+'".','ok');$('new-name').value='';openManager();
};

// ---- drafts
async function renderDrafts(){
 const list=$('drafts-list');list.textContent='';$('drafts-msg').textContent='';if(!PROD.session)return;
 const r=await jcall('GET','/v1/sessions/'+PROD.session.id+'/drafts');if(!r.ok){list.append(el('p','msgline bad',errText(r)));return;}
 const open=r.body.data.filter(d=>d.state==='draft');
 if(!open.length){list.append(el('p','msgline','No draft is waiting. Circuits the coding agent proposes appear here and in the conversation.'));return;}
 for(const d of open)list.append(draftCard(d,()=>renderDrafts()));
}
function draftCard(d,after){
 const card=el('fieldset');card.append(el('legend','',d.name+(d.model?' · '+d.model:'')));
 const badge=el('span','pill '+(d.validation&&d.validation.ok?'ok':'warn'),d.validation&&d.validation.ok?'valid':'not valid');card.append(badge);
 if(d.validation&&!d.validation.ok)card.append(problemList(d.validation.problems));
 if(d.validation&&d.validation.warnings&&d.validation.warnings.length){const w=el('details');w.append(el('summary','','warnings ('+d.validation.warnings.length+')'),problemList(d.validation.warnings));card.append(w);}
 card.append(el('pre','',d.text));
 if(d.queries){const q=el('details');q.append(el('summary','','test queries'),el('pre','',d.queries));card.append(q);}
 if(d.report){const q=el('details');q.append(el('summary','','agent report'),el('pre','',d.report));card.append(q);}
 const actions=el('div','actions');const msg=el('div','msgline');
 const accept=el('button','primary','Accept into this session');accept.type='button';accept.disabled=!(d.validation&&d.validation.ok);
 accept.onclick=async()=>{const r=await jcall('POST','/v1/sessions/'+PROD.session.id+'/drafts/'+d.id+'/accept');if(!r.ok){msg.className='msgline bad';msg.textContent='Not accepted: '+errText(r);return;}msg.className='msgline ok';msg.textContent='Accepted: '+r.body.record.ingest.facts_ingested+' fact(s) in the session memory; the circuit is in the session theory.';await refreshSession();accept.disabled=true;reject.disabled=true;if(after)after();};
 const reject=el('button','','Reject');reject.type='button';
 reject.onclick=async()=>{const r=await jcall('POST','/v1/sessions/'+PROD.session.id+'/drafts/'+d.id+'/reject');if(!r.ok){msg.className='msgline bad';msg.textContent=errText(r);return;}msg.className='msgline';msg.textContent='Rejected.';await refreshSession();accept.disabled=true;reject.disabled=true;if(after)after();};
 actions.append(accept,reject);card.append(actions,msg);return card;
}
$('drafts-open').onclick=async()=>{await renderDrafts();$('drafts-dialog').showModal();};$('drafts-close').onclick=()=>$('drafts-dialog').close();

// ---- commit to a fork
$('commit-open').onclick=()=>{if(!PROD.session)return;fillStrategies($('commit-strategy'),PROD.session.base.strategy);$('commit-name').value='';$('commit-msg').textContent='';$('commit-dialog').showModal();};
$('commit-cancel').onclick=()=>$('commit-dialog').close();
$('commit-go').onclick=async()=>{
 const name=$('commit-name').value.trim();const box=$('commit-msg');box.textContent='';box.className='msgline';
 if(!name){box.className='msgline bad';box.textContent='Name the new base memory first.';return;}
 const r=await jcall('POST','/v1/sessions/'+PROD.session.id+'/commit',{name,strategy:$('commit-strategy').value});
 if(!r.ok){box.className='msgline bad';box.textContent=r.status===403?'Committing needs the administrator session (sign in on /login).':'Not committed: '+errText(r);if(r.error&&r.error.problems)box.append(problemList(r.error.problems));return;}
 box.className='msgline ok';box.textContent='Committed: new base memory "'+r.body.memory.name+'" ('+r.body.memory.strategy+', '+r.body.memory.circuits+' circuits).';await refreshSession();
};

// ---- omp settings and models
function ompNote(text){$('omp-note').textContent=text||'';}
async function loadOmpModels(refresh){
 const r=await jcall('GET','/v1/omp/models'+(refresh?'?refresh=1':''));const select=$('omp-model');
 if(!r.ok){PROD.omp=null;ompNote(r.status===403?'The model list needs the administrator session; the configured default model is used.':'The model list is not available: '+errText(r));return;}
 PROD.omp=r.body;const keep=select.value||(PROD.session&&PROD.session.settings&&PROD.session.settings.omp_model)||'';select.textContent='';
 const def=document.createElement('option');def.value='';def.textContent='omp default'+(r.body.default_model?' ('+r.body.default_model+')':'');select.append(def);
 if(!r.body.available){ompNote('The coding agent (omp) is not available: '+(r.body.reason||'no models')+'. SymbolicLM answers instead.');return;}
 const groups=[['subscription','Subscription (no per-token cost)'],['paid_api','Paid API'],['unknown','Other']];
 for(const [cls,label] of groups){
  const ms=r.body.models.filter(m=>m.cost_class===cls&&!(m.provider==='openrouter'&&cls==='paid_api'&&r.body.models.length>60&&!/latest$/.test(m.id)));
  if(!ms.length)continue;const g=document.createElement('optgroup');g.label=label;
  for(const m of ms){const o=document.createElement('option');o.value=m.id;o.textContent=m.id+(m.price_per_mtok&&cls==='paid_api'?'  ($'+m.price_per_mtok.input+'/$'+m.price_per_mtok.output+' per Mtok)':'');g.append(o);}
  select.append(g);
 }
 if([...select.options].some(o=>o.value===keep))select.value=keep;
 ompNote((r.body.omp_version||'omp')+' · '+r.body.models.length+' models'+(r.body.cached?' (cached)':'')+'. Subscription models cost nothing per token; prices of paid models are per million tokens.');
}
async function saveSetting(patch){
 if('authoring' in patch)store.set('chatsop.authoring',patch.authoring);if('omp_model' in patch)store.set('chatsop.ompModel',patch.omp_model);
 if(!PROD.session)return;const r=await jcall('POST','/v1/sessions/'+PROD.session.id+'/settings',patch);if(r.ok){PROD.session=r.body;renderSessionBar();}
}
$('authoring-select').onchange=e=>saveSetting({authoring:e.target.value});
$('omp-model').onchange=e=>saveSetting({omp_model:e.target.value||null});
$('omp-refresh').onclick=()=>loadOmpModels(true);

// ---- attachments
const MAX_FILES=10,MAX_BYTES=2000000;
function renderChips(){
 const box=$('chips');box.textContent='';
 PROD.files.forEach((f,i)=>{const c=el('span','chip');c.append(el('span','',f.name+' ('+Math.ceil(f.text.length/1024)+' KB)'));const x=el('button','','×');x.type='button';x.setAttribute('aria-label','Remove '+f.name);x.onclick=()=>{PROD.files.splice(i,1);renderChips();};c.append(x);box.append(c);});
}
$('attach').onclick=()=>$('attach-file').click();
$('attach-file').onchange=async e=>{
 for(const f of e.target.files){
  if(PROD.files.length>=MAX_FILES){break;}
  if(f.size>MAX_BYTES){add({role:'assistant error',text:'The file '+f.name+' is larger than 2 MB and was not attached.',time:Date.now()});continue;}
  const text=await f.text();
  if(text.includes('\u0000')){add({role:'assistant error',text:'The file '+f.name+' is not UTF-8 text and was not attached (attach txt, md, sop, csv, json or html files).',time:Date.now()});continue;}
  PROD.files.push({name:f.name,text});
 }
 e.target.value='';renderChips();
};

// ---- routing and the coding agent
function routeNote(route,fallbackText){
 const agent=route.path==='authoring';const n=el('div','route-note'+(agent?' agent':route.fallback?' fallback':''));
 n.append(el('b','','Path: '+(agent?'coding agent (omp)':'SymbolicLM')),document.createTextNode(' — '+route.reason.text+'.'));
 if(route.fallback)n.append(document.createTextNode(' The coding agent could not be used ('+route.fallback.reason+'), so SymbolicLM answers.'));
 if(agent&&route.omp&&route.omp.model)n.append(el('span','pill',route.omp.model+' · '+route.omp.cost_class));
 n.title='trigger: '+route.reason.trigger;return n;
}
function showRoute(userDiv,route){
 if(!userDiv)return;userDiv.classList.add('wide');let slot=userDiv.querySelector('.route-slot');
 if(!slot){slot=el('div','route-slot');userDiv.append(slot);}slot.textContent='';slot.append(routeNote(route));
}
function agentBlock(route,model){
 const div=el('div','msg assistant agent-msg');div.append(el('div','head','Coding agent (omp)'));
 if(model)div.firstChild.append(el('span','pill',model));
 div.append(el('div','status','starting…'));return div;
}
async function runAuthoring(text,files,route,userDiv){
 const model=PROD.session.settings&&PROD.session.settings.omp_model||null;
 const block=agentBlock(route,model);$('log').append(block);window.scrollTo(0,document.body.scrollHeight);const status=block.querySelector('.status');
 const started=await jcall('POST','/v1/author',{session:PROD.session.id,instructions:text,files,...(model?{model}:{}),wait:false});
 if(!started.ok){
  block.remove();const why=started.error?started.error.message:'HTTP '+started.status;
  showRoute(userDiv,{path:'symbolic',reason:route.reason,fallback:{from:'authoring',to:'symbolic',reason:why},omp:route.omp});return 'fallback';
 }
 const t0=Date.now();let st=null;
 for(;;){
  await new Promise(r=>setTimeout(r,1500));
  const r=await jcall('GET',started.body.status_url);if(!r.ok){status.textContent='The status of the request could not be read: '+errText(r);return 'done';}
  st=r.body;const secs=Math.round((Date.now()-t0)/1000);
  status.textContent=(st.status==='running'?({queued:'queued',writing:'the agent is writing circuits',fixing:'the agent is repairing circuits after validation (round '+st.round+')',validating:'validating the circuits'}[st.phase]||st.phase)+' · '+secs+' s':'finished');
  if(st.status!=='running')break;
 }
 if(!st.result||st.result.status==='failed'){
  status.textContent='The coding agent failed: '+(st.error||(st.result&&st.result.reason)||'no result')+'. SymbolicLM answers this message instead.';block.classList.add('error');
  showRoute(userDiv,{path:'symbolic',reason:route.reason,fallback:{from:'authoring',to:'symbolic',reason:st.error||(st.result&&st.result.reason)||'the run failed'},omp:route.omp});return 'fallback';
 }
 renderAuthoringResult(block,st.result);await refreshSession();return 'done';
}
function renderAuthoringResult(block,res){
 const status=block.querySelector('.status');
 status.textContent=({validated:'Validated',invalid:'Written but not valid after the repair rounds',failed:'The agent failed'}[res.status]||res.status)+' · '+res.rounds+' round'+(res.rounds===1?'':'s')+' · '+(res.duration_ms/1000).toFixed(1)+' s · '+res.usage.turns+' turns · cost '+res.usage.cost_usd.toFixed(4)+' USD ('+res.cost_class+(res.cost_class==='subscription'?', nominal list price':'')+')'+(res.reason?' · '+res.reason:'');
 if(res.draft){block.append(draftCard(res.draft,()=>{}));}
 else if(res.status!=='validated')block.append(el('p','note','No circuit was produced. SymbolicLM can still answer this message.'));
 block.append(el('p','note','Drafts are not knowledge. Accepting one adds it to this session only; committing the session to a base memory is a separate step.'));
}
async function productEarly(text){
 // Attached files and the Always setting go to the coding agent without waiting for SymbolicLM.
 if(mode!=='formalize'||!PROD.session)return false;
 const always=PROD.session.settings&&PROD.session.settings.authoring==='always';
 if(!PROD.files.length&&!always)return false;
 const files=PROD.files.splice(0);renderChips();
 const user={id:uid(),role:'user',text,time:Date.now(),mode,attached:files.map(f=>f.name)};remember(user);const userDiv=add(user);
 if(files.length)userDiv.append(el('div','meta','attached: '+files.map(f=>f.name).join(', ')));
 sending=true;$('send').disabled=true;
 input.value='';
 const r=await api('/v1/route',{session:PROD.session.id,message:text,files:files.length});
 if(!r.ok){add({role:'assistant error',text:'The routing decision failed: '+(r.body&&r.body.error?r.body.error.message:'HTTP '+r.status),time:Date.now()});return true;}
 showRoute(userDiv,r.body);
 if(r.body.path==='authoring'){const outcome=await runAuthoring(text,files,r.body,userDiv);if(outcome==='done')return true;}
 // Fallback: SymbolicLM answers the text alone (attached files cannot be read by it).
 await proceedSend(text,null,{user,userDiv});return true;
}
async function productAfterAnalysis(text,user,calls,userDiv){
 if(!PROD.session||mode!=='formalize'||PROD.session.settings.authoring==='off')return null;
 await Promise.allSettled(calls);
 let understanding=user.understood||null;
 if(!understanding){const r=await api('/v1/understand',{message:text,rewrite:rewriteMode,emotion:false});if(r.ok)understanding=r.body;}
 const r=await api('/v1/route',{session:PROD.session.id,message:text,...(understanding?{understanding}:{})});
 if(!r.ok)return null;
 showRoute(userDiv,r.body);
 if(r.body.path==='authoring'){const outcome=await runAuthoring(text,[],r.body,userDiv);return outcome==='done'?r.body:null;}
 return r.body;
}
ensureSession().then(()=>loadOmpModels(false));
`;
