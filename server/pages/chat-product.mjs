/** The product layer of the chat page (DS022, DS009 "The chat page"): sessions, base memories and the coding agent.
 *
 * - The *session header* of the Chat tab shows the session of the current conversation (its base memory, strategy, circuits and drafts)
 *   with *New session* (opens the start dialog where the base memory is chosen from `GET /v1/memories`), *Drafts* and *Commit*. Every
 *   conversation is bound to a server session (`POST /v1/sessions`); the chat request carries `session_id`.
 * - The *Base Memory* tab lists the memories (name, strategy, size, created, parent) with View (manifest, counts, sample wires), Fork
 *   (name and strategy), Add knowledge (paste or upload a circuit; validation problems are shown, nothing is written on failure) and
 *   Start session; creating an empty memory is there too. Every signed-in user may use them (no admin role yet).
 * - Settings, *Coding agent*: the omp model picker (`GET /v1/omp/models`, subscription models first, with the cost class, filterable); the
 *   chosen model is tried first, before the configured subscription chain. A message is always written into circuits by the coding agent
 *   (`POST /v1/chat/completions`); attached files go to knowledge authoring (`POST /v1/author`).
 * - Authoring progress (`POST /v1/author` with `wait: false`, polled) and the draft circuits (validation, report, cost) are shown as a
 *   card in the conversation with Accept and Reject. Nothing is knowledge until the user accepts a draft.
 * All dynamic text is inserted with textContent; the page never builds markup from server data.
 */

export const sessionHeadHtml = `<header class="chat-head"><div class="info" id="session-info" aria-label="Session and base memory">Loading the session…</div><div class="btns"><label for="conversation" class="muted" style="margin:0;font-weight:400;font-size:13px">Chat</label><select id="conversation" title="Earlier conversations in this browser"></select><button id="new" type="button" aria-label="New conversation (new session)" title="Start a new conversation on a base memory of your choice">New session</button><button id="drafts-open" type="button" title="Circuits the coding agent proposed, waiting for you to accept or reject them">Drafts</button><button id="commit-open" type="button" title="Commit the circuits accepted in this session to a new base memory">Commit…</button><button id="clear" type="button" title="Clears only this browser's copy of the transcript; the server keeps the conversation context">Clear view</button></div></header>`;

const srow = (title, help, control) => `<div class="srow"><div class="what"><b>${title}</b><span>${help}</span></div><div class="ctl">${control}</div></div>`;
export const settingsCodingAgentHtml = [
  srow('<label class="plain" for="omp-model">Coding agent model</label>', 'Models omp can use. Subscription models cost nothing per token; paid models show their price per million tokens.', '<input type="search" id="omp-filter" placeholder="Filter models" aria-label="Filter models"><select id="omp-model"><option value="">omp default</option></select><button id="omp-refresh" type="button" title="Read the model list from omp again">Refresh</button>'),
  '<p id="omp-note" class="hint-note"></p>',
].join('');

export const memoryTabHtml = `<h2>Base Memory</h2><p class="lead">A session works on its own copy of a base memory. What a chat adds stays in the session until you commit it into a new base memory.</p>
<div class="mem-top"><button id="mem-new" type="button" title="Create an empty base memory">Create empty memory…</button><button id="mem-refresh" type="button">Reload</button><span class="spacer"></span><span id="mem-count" class="state"></span></div>
<div id="mem-msg" class="msgline" role="status"></div>
<table class="mem" aria-label="Base memories"><thead><tr><th>Name</th><th>Strategy</th><th>Size</th><th>Created</th><th>Parent</th><th>Actions</th></tr></thead><tbody id="mem-rows"><tr><td colspan="6">Loading…</td></tr></tbody></table>`;

export const productDialogsHtml = `
<dialog id="start-dialog" aria-labelledby="start-title"><h2 id="start-title">New session</h2>
<p class="msgline">A session works on its own copy of a base memory. What the conversation adds stays in the session until you commit it to a new base memory.</p>
<div class="row"><label for="start-base">Base memory</label><select id="start-base"></select></div>
<div id="start-detail" class="msgline"></div>
<div class="row"><label for="start-name">Session name</label><input type="text" id="start-name" maxlength="120" placeholder="optional"></div>
<div id="start-error" class="msgline bad" hidden></div>
<div class="actions"><button id="start-cancel" type="button">Cancel</button><button id="start-go" type="button" class="primary">Start session</button></div></dialog>
<dialog id="view-dialog" aria-labelledby="view-title"><h2 id="view-title">Base memory</h2><div id="view-body"></div><div class="actions"><button id="view-close" type="button">Close</button></div></dialog>
<dialog id="fork-dialog" aria-labelledby="fork-title"><h2 id="fork-title">Fork</h2><p class="msgline">Same strategy: a copy-on-write clone. Another strategy: the circuits are replayed into the new engine.</p>
<div class="row"><label for="fork-name">Name</label><input type="text" id="fork-name" maxlength="120" placeholder="name of the fork"></div><div class="row"><label for="fork-strategy">Strategy</label><select id="fork-strategy"></select></div>
<div id="fork-msg" class="msgline" role="status"></div><div class="actions"><button id="fork-cancel" type="button">Close</button><button id="fork-go" type="button" class="primary">Fork</button></div></dialog>
<dialog id="know-dialog" aria-labelledby="know-title"><h2 id="know-title">Add knowledge</h2><p class="msgline">Paste SOP circuit text or load a .sop file. It is validated first; nothing is written when a problem is found.</p>
<div class="row"><label for="know-name">Circuit name</label><input type="text" id="know-name" maxlength="80" value="circuit"><input type="file" id="know-file" accept=".sop,.txt,text/plain" aria-label="Load a circuit file"></div>
<textarea id="know-text" placeholder="Knowledge wires, for example:&#10;@parent predicate&#10;  args subject:entity object:entity&#10;@f1 fact&#10;  holds parent ann bob&#10;  source &quot;demo&quot;" aria-label="Circuit text"></textarea>
<div class="row"><label for="know-reason">Reason</label><input type="text" id="know-reason" maxlength="200" placeholder="why it is added"></div>
<div id="know-msg" class="msgline" role="status"></div><div class="actions"><button id="know-cancel" type="button">Close</button><button id="know-go" type="button" class="primary">Validate and add</button></div></dialog>
<dialog id="new-dialog" aria-labelledby="new-title"><h2 id="new-title">Create an empty memory</h2>
<div class="row"><label for="new-name">Name</label><input type="text" id="new-name" maxlength="120"></div><div class="row"><label for="new-strategy">Strategy</label><select id="new-strategy"></select></div>
<div id="new-msg" class="msgline" role="status"></div><div class="actions"><button id="new-cancel" type="button">Close</button><button id="new-go" type="button" class="primary">Create</button></div></dialog>
<dialog id="drafts-dialog" aria-labelledby="drafts-title"><h2 id="drafts-title">Draft circuits</h2><div id="drafts-list"></div><div id="drafts-msg" class="msgline" role="status"></div><div class="actions"><button id="drafts-close" type="button">Close</button></div></dialog>
<dialog id="commit-dialog" aria-labelledby="commit-title"><h2 id="commit-title">Commit the session to a base memory</h2>
<p class="msgline">Creates a new base memory: a fork of the session's base memory plus the circuits you accepted in this session, validated again. The original base memory does not change. Recorded with provenance.</p>
<div class="row"><label for="commit-name">Name</label><input type="text" id="commit-name" maxlength="120"><label for="commit-strategy">Strategy</label><select id="commit-strategy"></select></div>
<div id="commit-msg" class="msgline" role="status"></div>
<div class="actions"><button id="commit-cancel" type="button">Cancel</button><button id="commit-go" type="button" class="primary">Commit</button></div></dialog>`;

export const attachHtml = `<input type="file" id="attach-file" multiple hidden>`;
export const chipsHtml = `<div id="chips" class="chips" aria-label="Attached files"></div>`;

export const productScript = String.raw`
// ---- product layer (DS022): sessions, base memories, the coding agent ----
const PROD={session:null,memories:[],strategies:[],omp:null,files:[]};
async function jcall(method,path,body){
 try{const r=await fetch(path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json();}catch{}
  return {ok:r.ok&&Boolean(j)&&!j.error,status:r.status,body:j,error:j&&j.error?j.error:null};}
 catch{return {ok:false,status:0,body:null,error:{message:'The server could not be reached.'}};}
}
const errText=r=>r.error?r.error.message+(r.error.problems?' ('+r.error.problems.length+' problem'+(r.error.problems.length===1?'':'s')+')':''):'HTTP '+r.status;
function problemList(problems){const ul=el('ul','problems');for(const p of problems||[]){ul.append(el('li','',(p.file?p.file+(p.line?':'+p.line:'')+' ':'')+p.code+(p.wire?' (@'+p.wire+')':'')+': '+p.message));}return ul;}
// Every signed-in user may fork, extend and commit base memories and accept drafts (owner decision 2026-10-01: no admin role yet), so no control is gated.
const sessionMap=()=>store.get('chatsop.sessionOf',{});
const boundSession=()=>sessionMap()[current]||null;
function bindSession(id){const m=sessionMap();m[current]=id;store.set('chatsop.sessionOf',m);}
function sessionBody(){return PROD.session?{session_id:PROD.session.id}:{};}
function renderSessionBar(){
 const info=$('session-info');info.textContent='';const s=PROD.session;
 if(!s){info.textContent='No session yet.';$('strategy-info').textContent='no session';return;}
 info.append(el('b','',s.name||s.id),document.createTextNode(' \u00b7 base memory '),el('b','',s.base.name));
 info.append(el('span','pill accent',s.base.strategy));
 const accepted=(s.circuits||[]).length,drafts=(s.drafts||[]).filter(d=>d.state==='draft').length;
 info.append(el('span','pill',accepted+' session circuit'+(accepted===1?'':'s')));
 if(drafts)info.append(el('span','pill warn',drafts+' draft'+(drafts===1?'':'s')));
 if((s.committed_to||[]).length)info.append(el('span','pill ok','committed'));
 info.title='session '+s.id;
 $('strategy-info').textContent=s.base.strategy+' (base memory '+s.base.name+')';
 const model=(s.settings&&s.settings.omp_model)||'';if([...$('omp-model').options].some(o=>o.value===model))$('omp-model').value=model;
 $('commit-open').disabled=!accepted;
 $('drafts-open').textContent=drafts?'Drafts ('+drafts+')':'Drafts';
 if($('mem-rows')&&!$('panel-memory').hidden)renderMemoryRows();
}
async function refreshSession(){
 if(!PROD.session)return;const r=await jcall('GET','/v1/sessions/'+PROD.session.id);
 if(r.ok)PROD.session=r.body;renderSessionBar();
}
async function startSession(baseId,name){
 const r=await jcall('POST','/v1/sessions',{base:baseId,...(name?{name}:{}),settings:{omp_model:store.get('chatsop.ompModel',null)}});
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

// ---- new session dialog
function showStartDetail(){
 const m=PROD.memories.find(x=>x.id===$('start-base').value);const box=$('start-detail');box.textContent='';if(!m)return;
 box.append(document.createTextNode((m.description||'No description.')+' '+m.circuits+' circuit(s), '+m.facts+' stored fact(s), strategy '+m.strategy+(m.parent?', forked from '+m.parent.name:'')+'.'));
}
async function openStart(baseId){
 await loadMemories();const select=$('start-base');select.textContent='';
 for(const m of PROD.memories){const o=document.createElement('option');o.value=m.id;o.textContent=memLabel(m);select.append(o);}
 select.value=baseId||store.get('chatsop.lastBase','default');if(!select.value&&PROD.memories.length)select.selectedIndex=0;
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
// A new conversation asks which base memory its session starts from.
$('new').onclick=()=>{newConversation();PROD.session=null;renderSessionBar();switchTab('chat');openStart();};
$('conversation').addEventListener('change',()=>{ensureSession();});

// ---- base memory tab
function dlg(id){const d=$(id);return d;}
const closeBtn=(btn,id)=>{$(btn).onclick=()=>$(id).close();};
function setMsg(id,text,cls){const m=$(id);m.textContent=text||'';m.className='msgline'+(cls?' '+cls:'');return m;}
const day=iso=>iso?String(iso).slice(0,10):'';

const plainBtn=(label,tip,fn,cls)=>{const b=el('button',cls||'',label);b.type='button';b.title=tip;b.onclick=fn;return b;};
function renderMemoryRows(){
 const body=$('mem-rows');body.textContent='';
 $('mem-count').textContent=PROD.memories.length+' base memor'+(PROD.memories.length===1?'y':'ies');
 for(const m of PROD.memories){
  const tr=document.createElement('tr');if(PROD.session&&PROD.session.base.id===m.id)tr.className='current';
  const cell=(l,text,cls)=>{const td=el('td',cls||'',text);td.dataset.l=l;tr.append(td);return td;};
  cell('Name',m.name,'name').title=m.description||m.id;
  cell('Strategy',m.strategy);
  cell('Size',m.circuits+' circuit'+(m.circuits===1?'':'s')+' \u00b7 '+m.facts+' fact'+(m.facts===1?'':'s'));
  cell('Created',day(m.created_at));
  cell('Parent',m.parent?m.parent.name:'\u2014');
  const acts=cell('','','acts');
  acts.append(plainBtn('View','Manifest, counts and sample wires',()=>openView(m.id)),
   plainBtn('Fork','Fork this memory under a new name and strategy',()=>openFork(m)),
   plainBtn('Add knowledge','Validate and add SOP circuits to this memory',()=>openKnow(m)),
   plainBtn('Start session','Start a new chat session on a copy of this base memory',()=>startFromMemory(m.id),'primary'));
  body.append(tr);
 }
 if(!PROD.memories.length){const tr=document.createElement('tr');const td=el('td','','No base memory yet.');td.colSpan=6;tr.append(td);body.append(tr);}
}
async function renderMemories(){
 const r=await loadMemories();
 if(!r.ok){$('mem-rows').textContent='';const tr=document.createElement('tr');const td=el('td','msgline bad','The base memories could not be read: '+errText(r));td.colSpan=6;tr.append(td);$('mem-rows').append(tr);return;}
 renderMemoryRows();
}
$('mem-refresh').onclick=()=>{setMsg('mem-msg','');renderMemories();};
async function startFromMemory(id){
 newConversation();PROD.session=null;renderSessionBar();
 const r=await startSession(id);
 if(!r.ok){setMsg('mem-msg','The session could not be started: '+errText(r),'bad');return;}
 switchTab('chat');
}
async function openView(id){
 const box=$('view-body');box.textContent='Loading\u2026';$('view-dialog').showModal();
 const r=await jcall('GET','/v1/memories/'+encodeURIComponent(id)+'?facts=1');box.textContent='';
 if(!r.ok){box.append(el('p','msgline bad',errText(r)));return;}
 const m=r.body;$('view-title').textContent=m.name;const dl=document.createElement('dl');
 field(dl,'id',m.id);field(dl,'strategy',m.strategy);field(dl,'created',m.created_at);field(dl,'parent',m.parent?m.parent.name+' ('+m.parent.id+', '+m.parent.strategy+', forked '+m.parent.forked_at+')':'none');
 field(dl,'circuits',m.circuits+((m.circuit_files||[]).length?' ('+m.circuit_files.join(', ')+')':''));field(dl,'stored facts',m.facts);field(dl,'description',m.description);box.append(dl);
 const facts=Object.entries(m.stored_facts||{}).filter(([,rows])=>rows.length);
 if(facts.length){const d=el('details');d.open=true;d.append(el('summary','','sample wires ('+facts.reduce((n,[,rows])=>n+rows.length,0)+' stored facts)'));d.append(el('pre','',facts.map(([pred,rows])=>rows.slice(0,40).map(x=>pred+' '+x.args.join(' ')).join('\n')).join('\n')));box.append(d);}
 else box.append(el('p','msgline','No stored fact yet.'));
 if((m.provenance||[]).length){const d=el('details');d.append(el('summary','','provenance ('+m.provenance.length+' latest)'));d.append(el('pre','',m.provenance.map(x=>(x.approved_at||x.at||'')+' '+x.kind+(x.approved_by?' by '+x.approved_by:'')+(x.file?' '+x.file:'')+(x.reason?' ('+x.reason+')':'')+(x.method?' '+x.method:'')).join('\n')));box.append(d);}
}
closeBtn('view-close','view-dialog');closeBtn('fork-cancel','fork-dialog');closeBtn('know-cancel','know-dialog');closeBtn('new-cancel','new-dialog');
let memCurrent=null;
function openFork(m){memCurrent=m;$('fork-title').textContent='Fork "'+m.name+'"';fillStrategies($('fork-strategy'),m.strategy);$('fork-name').value='';setMsg('fork-msg','');$('fork-dialog').showModal();}
$('fork-go').onclick=async()=>{
 const name=$('fork-name').value.trim();if(!memCurrent||!name){setMsg('fork-msg','Name the fork first.','bad');return;}
 const r=await jcall('POST','/v1/memories/'+encodeURIComponent(memCurrent.id)+'/fork',{name,strategy:$('fork-strategy').value});
 if(!r.ok){setMsg('fork-msg',errText(r),'bad');return;}
 setMsg('fork-msg','Forked as "'+r.body.memory.name+'" ('+r.body.memory.strategy+', '+(r.body.method==='clone'?'copy-on-write clone':'circuits replayed into the new engine')+').','ok');
 $('fork-name').value='';renderMemories();
};
function openKnow(m){memCurrent=m;$('know-title').textContent='Add knowledge to "'+m.name+'"';$('know-text').value='';$('know-reason').value='';setMsg('know-msg','');$('know-dialog').showModal();}
$('know-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;$('know-text').value=await f.text();$('know-name').value=f.name.replace(/\.[^.]+$/,'').replace(/[^A-Za-z0-9_-]+/g,'-')||'circuit';};
$('know-go').onclick=async()=>{
 const text=$('know-text').value;if(!memCurrent||!text.trim()){setMsg('know-msg','Paste or load a circuit first.','bad');return;}
 const r=await jcall('POST','/v1/memories/'+encodeURIComponent(memCurrent.id)+'/knowledge',{circuits:[{name:$('know-name').value.trim()||'circuit',text}],reason:$('know-reason').value.trim()});
 if(!r.ok){const box=setMsg('know-msg','Not added: '+errText(r),'bad');if(r.error&&r.error.problems)box.append(problemList(r.error.problems));return;}
 const a=r.body.added[0];setMsg('know-msg','Added '+a.file+': '+a.ingest.facts_ingested+' of '+a.ingest.facts_in_circuit+' fact(s) in the memory store, provenance recorded ('+a.approved_by+').'+(r.body.warnings.length?' '+r.body.warnings.length+' warning(s).':''),'ok');
 $('know-text').value='';renderMemories();
};
$('mem-new').onclick=()=>{fillStrategies($('new-strategy'));$('new-name').value='';setMsg('new-msg','');$('new-dialog').showModal();};
$('new-go').onclick=async()=>{
 const name=$('new-name').value.trim();if(!name){setMsg('new-msg','Name the memory first.','bad');return;}
 const r=await jcall('POST','/v1/memories',{name,strategy:$('new-strategy').value});
 if(!r.ok){setMsg('new-msg',errText(r),'bad');return;}
 setMsg('new-msg','Created "'+r.body.name+'".','ok');$('new-name').value='';renderMemories();
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
$('commit-open').onclick=()=>{if(!PROD.session||$('commit-open').disabled)return;fillStrategies($('commit-strategy'),PROD.session.base.strategy);$('commit-name').value='';$('commit-msg').textContent='';$('commit-dialog').showModal();};
$('commit-cancel').onclick=()=>$('commit-dialog').close();
$('commit-go').onclick=async()=>{
 const name=$('commit-name').value.trim();const box=$('commit-msg');box.textContent='';box.className='msgline';
 if(!name){box.className='msgline bad';box.textContent='Name the new base memory first.';return;}
 const r=await jcall('POST','/v1/sessions/'+PROD.session.id+'/commit',{name,strategy:$('commit-strategy').value});
 if(!r.ok){box.className='msgline bad';box.textContent='Not committed: '+errText(r);if(r.error&&r.error.problems)box.append(problemList(r.error.problems));return;}
 box.className='msgline ok';box.textContent='Committed: new base memory "'+r.body.memory.name+'" ('+r.body.memory.strategy+', '+r.body.memory.circuits+' circuits).';await refreshSession();
};

// ---- omp settings and models
function ompNote(text){$('omp-note').textContent=text||'';}
const OMP_GROUPS=[['subscription','Subscription (no per-token cost)'],['paid_api','Paid API'],['unknown','Other']];
function renderOmpOptions(){
 const select=$('omp-model'),r=PROD.omp;if(!r)return;
 const keep=select.value||(PROD.session&&PROD.session.settings&&PROD.session.settings.omp_model)||'';const q=$('omp-filter').value.trim().toLowerCase();select.textContent='';
 const def=document.createElement('option');def.value='';def.textContent='omp default'+(r.default_model?' ('+r.default_model+')':'');select.append(def);
 for(const [cls,label] of OMP_GROUPS){
  const ms=r.models.filter(m=>m.cost_class===cls&&(m.id===keep||(q?m.id.toLowerCase().includes(q):!(m.provider==='openrouter'&&cls==='paid_api'&&r.models.length>60&&!/latest$/.test(m.id)))));
  if(!ms.length)continue;const g=document.createElement('optgroup');g.label=label;
  for(const m of ms){const o=document.createElement('option');o.value=m.id;o.textContent=m.id+(m.price_per_mtok&&cls==='paid_api'?'  ($'+m.price_per_mtok.input+'/$'+m.price_per_mtok.output+' per Mtok)':'');g.append(o);}
  select.append(g);
 }
 if([...select.options].some(o=>o.value===keep))select.value=keep;
}
async function loadOmpModels(refresh){
 const r=await jcall('GET','/v1/omp/models'+(refresh?'?refresh=1':''));
 if(!r.ok){PROD.omp=null;ompNote('The model list is not available: '+errText(r));return;}
 PROD.omp=r.body;
 if(!r.body.available){renderOmpOptions();ompNote('The coding agent (omp) is not available: '+(r.body.reason||'no models')+'. Chat answers return parse_unavailable until omp can run a model.');return;}
 renderOmpOptions();
 ompNote((r.body.omp_version||'omp')+' \u00b7 '+r.body.models.length+' models'+(r.body.cached?' (cached)':'')+'. Type in the filter to search the whole catalogue.');
}
async function saveSetting(patch){
 if('omp_model' in patch)store.set('chatsop.ompModel',patch.omp_model);
 if(!PROD.session)return;const r=await jcall('POST','/v1/sessions/'+PROD.session.id+'/settings',patch);if(r.ok){PROD.session=r.body;renderSessionBar();}
}
$('omp-model').onchange=e=>saveSetting({omp_model:e.target.value||null});
$('omp-filter').oninput=()=>renderOmpOptions();
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

// ---- knowledge authoring by the coding agent
function agentBlock(model){
 const div=el('div','msg assistant agent-msg');div.append(el('div','head','Coding agent (omp)'));
 if(model)div.firstChild.append(el('span','pill',model));
 div.append(el('div','status','starting…'));return div;
}
async function runAuthoring(text,files){
 const model=PROD.session.settings&&PROD.session.settings.omp_model||null;
 const block=agentBlock(model);$('log').append(block);const status=block.querySelector('.status');
 const started=await jcall('POST','/v1/author',{session:PROD.session.id,instructions:text,files,...(model?{model}:{}),wait:false});
 if(!started.ok){status.textContent='The coding agent could not start: '+(started.error?started.error.message:'HTTP '+started.status);block.classList.add('error');return 'failed';}
 const t0=Date.now();let st=null;
 for(;;){
  await new Promise(r=>setTimeout(r,1500));
  const r=await jcall('GET',started.body.status_url);if(!r.ok){status.textContent='The status of the request could not be read: '+errText(r);return 'failed';}
  st=r.body;const secs=Math.round((Date.now()-t0)/1000);
  status.textContent=(st.status==='running'?({queued:'queued',writing:'the agent is writing circuits',fixing:'the agent is repairing circuits after validation (round '+st.round+')',validating:'validating the circuits'}[st.phase]||st.phase)+' · '+secs+' s':'finished');
  if(st.status!=='running')break;
 }
 if(!st.result||st.result.status==='failed'){status.textContent='The coding agent failed: '+(st.error||(st.result&&st.result.reason)||'no result');block.classList.add('error');return 'failed';}
 renderAuthoringResult(block,st.result);await refreshSession();return 'done';
}
function renderAuthoringResult(block,res){
 const status=block.querySelector('.status');
 status.textContent=({validated:'Validated',invalid:'Written but not valid after the repair rounds',failed:'The agent failed'}[res.status]||res.status)+' · '+res.rounds+' round'+(res.rounds===1?'':'s')+' · '+(res.duration_ms/1000).toFixed(1)+' s · '+res.usage.turns+' turns · cost '+res.usage.cost_usd.toFixed(4)+' USD ('+res.cost_class+(res.cost_class==='subscription'?', nominal list price':'')+')'+(res.reason?' · '+res.reason:'');
 if(res.draft){block.append(draftCard(res.draft,()=>{}));}
 else if(res.status!=='validated')block.append(el('p','note','No circuit was produced.'));
 block.append(el('p','note','Drafts are not knowledge. Accepting one adds it to this session only; committing the session to a base memory is a separate step.'));
}
/** Attached files go to knowledge authoring (the coding agent writes draft circuits); a message without files is a chat turn. */
async function productEarly(text){
 if(!PROD.session||!PROD.files.length)return false;
 const files=PROD.files.splice(0);renderChips();
 const user={id:uid(),role:'user',text,time:Date.now(),attached:files.map(f=>f.name)};remember(user);const userDiv=add(user);
 userDiv.append(el('div','meta','attached: '+files.map(f=>f.name).join(', ')));
 setBusy(true,'Coding agent working\u2026');
 input.value='';fit();
 await runAuthoring(text,files);
 return true;
}
ensureSession().then(()=>loadOmpModels(false));
initTabs();
`;
