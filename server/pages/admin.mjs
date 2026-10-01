/** Administrator page: server status and API token management. Signing in and
 * choosing the first password happen on `/login`; this page reads
 * `/admin/status` and calls the session-protected `/admin/token*` endpoints. */
import {layout} from './layout.mjs';

const script = `
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const api=async(route,options)=>{const response=await fetch(route,{credentials:'same-origin',...options});const body=await response.json().catch(()=>({}));return {status:response.status,body}};
const post=(route,payload)=>api(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload??{})});
function show(html){$('app').innerHTML=html}
async function render(){
 const s=(await api('/admin/status')).body;
 if(!s.configured){show('<div class="card"><p>No administrator password yet. <a class="button primary" href="/login?next=%2Fadmin">Set the administrator password</a></p></div>');return;}
 if(!s.authenticated){show('<div class="card"><p>You are not signed in. <a class="button primary" href="/login?next=%2Fadmin">Sign in</a></p></div>');return;}
 const tokens=(s.tokens??[]).map(t=>'<li><code>'+esc(t.id)+'</code> '+esc(t.label)+' <span class="muted">created '+esc(t.created)+'</span> <button data-revoke="'+esc(t.id)+'">revoke</button></li>').join('')||'<li class="muted">none yet</li>';
 show('<div class="grid"><a class="tile" href="/chat"><b>Chat</b><span>Open the chat</span></a><a class="tile" href="/audit"><b>Corpus audit</b><span>Review corpus cases</span></a></div>'+
  '<section class="card"><h2>Status</h2><ul class="plain"><li>Formalizer ready: <b class="'+(s.ready?'ok':'bad')+'">'+(s.ready?'yes':'no')+'</b> <span class="muted">(chat answers return 503 until the SymbolicLM service can start; see the home page)</span></li>'+
  '</ul></section>'+
  '<section class="card"><h2>API tokens</h2><p class="muted">For curl, SDKs and scripts: send <code>Authorization: Bearer &lt;token&gt;</code>. A token is shown once.</p><p><input id="label" placeholder="label, e.g. laptop" maxlength="40"> <button class="primary" id="mint">Create token</button></p><div id="fresh"></div><ul class="plain">'+tokens+'</ul></section>');
 $('mint').onclick=mint;
 $('app').querySelectorAll('[data-revoke]').forEach(button=>{button.onclick=()=>revoke(button.dataset.revoke)});
}
async function mint(){const r=await post('/admin/token',{label:$('label').value.trim()||'minted in admin'});if(r.status!==200){$('fresh').innerHTML='<p class="bad">'+esc(r.body.error?.message??('HTTP '+r.status))+'</p>';return;}await render();$('fresh').innerHTML='<p class="notice">Copy it now, it is shown once: <code>'+esc(r.body.token)+'</code></p>';}
async function revoke(id){await post('/admin/token/revoke',{id});render()}
render();
`;

export const adminPage = ({signedIn = false} = {}) => layout({title: 'ChatSOP admin', active: 'admin', signedIn, body: '<main class="wrap"><h1>Admin</h1><div id="app" class="muted">loading…</div></main>', script});
