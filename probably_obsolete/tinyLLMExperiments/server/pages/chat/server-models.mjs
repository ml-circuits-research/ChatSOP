/**
 * The chat's Settings section "Server models" (DS012 "Model lifecycle", owner request 2026-10-01): one row per registry model with its live state,
 * memory and a three-way control (Keep open, On demand, Off), plus the limits (how many models may run at once, the idle timeout).
 * It reads and writes `GET|POST /v1/server/models`; the settings are the server's, not the browser's (persisted in config/server-models.json).
 * The script is part of the page's inline script: no backticks and no template placeholders inside it.
 */
export const serverModelsHtml = `<section id="server-models" class="card set" hidden><h3>Server models</h3>
<p class="help">What the server keeps open and what it does not. <b>Keep open</b>: started when the server starts, warm, never stopped. <b>On demand</b>: started with the first message that needs it and stopped after the idle time. <b>Off</b>: never started.</p>
<div id="sm-summary" class="state" aria-live="polite"></div>
<div class="srow"><div class="what"><b><label class="plain" for="sm-max">Models running at once</label></b><span>At least the number kept open. One chat turn can use four models (SymbolicLM, the cleaner, the translator, the rewriter); one more is room for a chat or base model.</span></div><div class="ctl"><input type="number" id="sm-max" min="1" max="32" step="1"></div></div>
<div class="srow"><div class="what"><b><label class="plain" for="sm-idle">Idle time (minutes)</label></b><span>An on-demand model that nobody used for this long is stopped. Models kept open are never stopped.</span></div><div class="ctl"><input type="number" id="sm-idle" min="1" max="10080" step="1"></div></div>
<div id="sm-rows"></div>
<p id="sm-error" class="hint-note" role="alert" hidden></p>
</section>`;

export const serverModelsScript = `
// Server models (Settings): the server's own lifecycle settings, GET and POST /v1/server/models.
const SM={data:null,timer:null,busy:false};
const SM_LABELS={keep_open:'Keep open',on_demand:'On demand',off:'Off'};
const SM_HELP={keep_open:'warm, never stopped',on_demand:'starts when needed',off:'never starts'};
function smSeconds(ms){return ms>=1000?'about '+Math.max(1,Math.round(ms/1000))+' s':'under 1 s';}
function smMb(mb){return mb==null?'-':mb>=1024?(mb/1024).toFixed(1)+' GB':mb+' MB';}
function smShowError(text){const e=$('sm-error');e.hidden=!text;e.textContent=text||'';}
function smRender(){
 const d=SM.data;const card=$('server-models');if(!d){card.hidden=true;return;}card.hidden=false;
 const s=d.settings;
 if(document.activeElement!==$('sm-max'))$('sm-max').value=s.maxRunning;
 if(document.activeElement!==$('sm-idle'))$('sm-idle').value=s.idleMinutes;
 const w=d.warm||{};
 $('sm-summary').textContent=d.running+' of '+s.maxRunning+' running, about '+smMb(d.memory.estimated_mb)+' of '+smMb(d.memory.budget_mb)+' budget'+(w.state&&w.state!=='disabled'?'; warm-up: '+w.state:'');
 const host=$('sm-rows');
 for(const m of d.models){
  let row=host.querySelector('[data-id="'+m.id+'"]');
  if(!row){
   row=document.createElement('div');row.className='srow';row.dataset.id=m.id;
   const what=document.createElement('div');what.className='what';what.append(document.createElement('b'),document.createElement('span'));
   const ctl=document.createElement('div');ctl.className='ctl';
   const sel=document.createElement('select');sel.setAttribute('aria-label','Mode of '+m.label);
   for(const k of d.modes){const o=document.createElement('option');o.value=k;o.textContent=SM_LABELS[k];sel.append(o);}
   sel.onchange=()=>smSave({models:{[m.id]:sel.value}});
   const st=document.createElement('span');st.className='state';
   ctl.append(sel,st);row.append(what,ctl);host.append(row);
  }
  row.querySelector('b').textContent=m.label;
  const word=m.error&&m.state==='error'?'error: '+m.error:m.state==='ready'?(m.warm?'running, warm':'running'):m.state==='starting'?'starting':'stopped';
  const bits=[word];if(m.running)bits.push(smMb(m.memory_mb)+' RAM');else bits.push('would start in '+smSeconds(m.start_estimate_ms)+', about '+smMb(m.memory_estimate_mb));
  if(m.idle_s!=null&&m.mode==='on_demand')bits.push('idle '+(m.idle_s<90?m.idle_s+' s':Math.round(m.idle_s/60)+' min'));
  row.querySelector('.what span').textContent=bits.join(' \\u00b7 ')+' \\u00b7 '+SM_HELP[m.mode];
  const sel=row.querySelector('select');if(document.activeElement!==sel)sel.value=m.mode;
  const st=row.querySelector('.state');st.textContent=m.state==='ready'?'\\u25cf':m.state==='starting'?'\\u2026':'\\u25cb';st.className='state '+(m.state==='ready'?'ok':m.state==='error'?'bad':'');st.title=m.state;
 }
}
async function smLoad(){
 if(SM.busy)return;
 try{const r=await fetch('/v1/server/models',{credentials:'same-origin'});if(!r.ok){SM.data=null;smRender();return;}SM.data=await r.json();smRender();}catch{}
}
async function smSave(patch){
 SM.busy=true;smShowError('');
 try{
  const r=await fetch('/v1/server/models',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
  const j=await r.json().catch(()=>null);
  if(r.ok&&j){SM.data=j;if(typeof refreshModels==='function')refreshModels();}else smShowError((j&&j.error&&j.error.message)||'The change was not accepted (HTTP '+r.status+').');
 }catch{smShowError('The server could not be reached.');}
 SM.busy=false;smRender();
}
function smNumber(id,key){const el=$(id);el.onchange=()=>{const v=Number(el.value);if(!Number.isInteger(v)){smRender();return;}smSave({[key]:v});};}
smNumber('sm-max','maxRunning');smNumber('sm-idle','idleMinutes');
// Refreshed every few seconds while the Settings tab is open.
SM.timer=setInterval(()=>{if(!$('panel-settings').hidden&&!document.hidden)smLoad();},4000);
$('tab-settings').addEventListener('click',smLoad);
smLoad();
`;
