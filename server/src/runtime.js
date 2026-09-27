import {ReasoningRegistry} from './reasoning/registry.js';
import {DECLARATIONS,OPERATIONS,LIBRARY_TYPES,lowerDeclaration} from './reasoning/lower.js';
import {queryFor,asFact,flat} from './reasoning/common.js';
import {parse,canonical,one,many,words,unquote,dependencies,validateGraph,replaceReferences,scalar} from './sop/parser.js';
import {lowerFact,lowerRule,lowerQuery,lowerConstraint} from './sop/lower.js';
import {evaluateExpression,parseExpression} from './sop/expression.js';
import {linkKnowledge} from './linker.js';
import {StrategyRegistry} from './strategies.js';
import {outputSpecs,outputRegistry,selectOutput} from './sop/outputs.js';
import {solveHorn} from './backends/horn.js';
import {solveConstraint} from './backends/constraints.js';
import {cnl} from './cnl.js';
import {instant} from './time.js';
import {assert,digest} from './util.js';
const flatten=xs=>xs.flatMap(x=>Array.isArray(x)?flatten(x):[x]);
export const DEFAULT_POLICY={allowWrite:true,allowPin:true,allowRules:false,allowJsEval:true,maxWires:2048,maxEpochs:16,maxGoals:256,maxRules:1024,retrievalStrategy:'hybrid',reasoningStrategy:'reference',maxNodes:5000,maxDepth:8,maxHypotheses:64,maxCandidates:512,maxPlans:1,timeoutMs:3000,maxProbes:50000,maxShards:256,maxFacts:10000,maxRounds:32,maxJoins:30000,maxAssignments:100000,maxExprOps:10000,maxExprBytes:65536};
export class Runtime{
 constructor({repo=null,session=null,schema=null,now=Date.now(),policy={},handlers={},strategies=new StrategyRegistry(),reasoningStrategies=new ReasoningRegistry(),atomGuard=null,factGuard=null}={}){this.repo=repo;this.session=session;this.schema=schema;this.now=now;this.policy={...DEFAULT_POLICY,...policy};this.handlers=handlers;this.strategies=strategies;this.reasoningStrategies=reasoningStrategies;this.atomGuard=atomGuard;this.factGuard=factGuard;}
 library(asof=Infinity){return this.repo&&this.session?this.repo.library(this.session,{asof}):[];}
 rules(q){return this.library(q.asof).filter(x=>x.wireType==='rule').map(x=>{assert(digest(x.sop)===x.hash,'Approved rule checksum mismatch');return lowerRule(parse(x.sop).wires[0],{},this.schema);});}
 async run(source,{origin='trusted'}={}){
  const program=parse(source,{maxWires:this.policy.maxWires,allowTypes:Object.keys(this.handlers)});const originalIds=program.wires.map(w=>w.id);
  // Internal binding wires are created only after an output producer executes.
  assert(!program.wires.some(w=>w.type==='binding'),'binding wires are runtime-generated; declare solve output instead');
  if(origin==='model')for(const w of program.wires){assert(!(w.type==='trace'&&one(w,'closed','false')==='true'),'A closed trace requires reviewed ingestion');assert(!['rule','template','procedure','action','policy','theory','binding'].includes(w.type),'Model can use approved rules/templates, not install executable definitions');}
  // Referenced templates are exact approved modules, not arbitrary Bloom matches.
  const library=new Map(this.library(this.now).map(x=>[x.id,x]));
  const handles=w=>['template','procedure'].includes(w.type)?parse(one(w,'body')).wires.flatMap(handles):dependencies(w).handles;
  for(let i=0;i<program.wires.length;i++)for(const id of handles(program.wires[i]))if(!program.wires.some(w=>w.id===id)){
   const lib=library.get(id);assert(lib&&LIBRARY_TYPES.has(lib.wireType),'Unknown approved definition '+id);assert(digest(lib.sop)===lib.hash,'Approved definition checksum mismatch');
   program.wires.push(...parse(lib.sop).wires);assert(program.wires.length<=this.policy.maxWires,'Library dependency budget exceeded');
  }
  validateGraph(program);const defs=new Map(program.wires.map(w=>[w.id,w])),values=Object.create(null),expanded=new Map(),trace=[],unavailable=new Map(),outputStates=Object.create(null),generated=[];let epoch=0,round=0;
  const chooseReasoning=w=>{const name=one(w,'reasoning',w.fields.backend&&!['auto','js'].includes(one(w,'backend'))?'advanced':this.policy.reasoningStrategy);if(this.policy.allowedReasoningStrategies)assert(this.policy.allowedReasoningStrategies.includes(name),'Reasoning strategy forbidden by host');return name;};
  const val=ref=>{assert(/^\$[A-Za-z][A-Za-z0-9_]*$/.test(ref),'Expected $wire value reference: '+ref);assert(Object.hasOwn(values,ref.slice(1)),'Unresolved '+ref);return values[ref.slice(1)];};
  const dataInputs=(w,key)=>flatten(many(w,key).flatMap(s=>words(s).map(readObject)));
  const deref=ref=>{assert(/^~[A-Za-z][A-Za-z0-9_]*$/.test(ref),'Expected ~wire definition handle');const w=defs.get(ref.slice(1));assert(w,'Unknown handle');return w;};
  const readObject=ref=>{if(ref.startsWith('$'))return val(ref);const d=deref(ref);if(d.type==='rule')return lowerRule(d,values,this.schema);if(DECLARATIONS.has(d.type))return lowerDeclaration(d,values,this.schema);if(['template','procedure'].includes(d.type))return {kind:d.type,id:d.id};throw Error('Expected approved declarative definition '+ref);};
  const materializeEvent=w=>{const text=one(w,'target');let target;if(text.startsWith('$')){const value=val(text);const ids=Array.isArray(value)?value:value?.ids;assert(Array.isArray(ids)&&ids.length===1,'Event target receipt must identify exactly one claim');target=ids[0];}else target=unquote(text);return {kind:'event',action:one(w,'action'),target,effective:one(w,'effective')?instant(one(w,'effective')):undefined,replacement:one(w,'replacement')?val(one(w,'replacement')):undefined,source:unquote(one(w,'source','user'))};};
  while(Object.keys(values).length+unavailable.size<defs.size){assert(++round<=this.policy.maxWires+this.policy.maxEpochs+2,'Scheduler progress budget');
   const ready=[...defs.values()].filter(w=>!Object.hasOwn(values,w.id)&&!unavailable.has(w.id)&&(expanded.has(w.id)?[expanded.get(w.id)]:dependencies(w).values).every(d=>Object.hasOwn(values,d)));
   if(!ready.length){
     let progress=false;
     for(const w of defs.values()){if(Object.hasOwn(values,w.id)||unavailable.has(w.id))continue;
       const ds=expanded.has(w.id)?[expanded.get(w.id)]:dependencies(w).values;
       const missing=ds.filter(id=>unavailable.has(id));if(missing.length){unavailable.set(w.id,{status:'blocked',because:missing});trace.push({wire:w.id,type:w.type,epoch,status:'blocked',because:missing});progress=true;}}
     if(progress)continue;
     throw Error('Unresolved/cyclic execution after expansion');
   }const effectWires=[],expansions=[];
   for(const w of ready){if(expanded.has(w.id)){values[w.id]=values[expanded.get(w.id)];trace.push({wire:w.id,type:w.type,epoch,alias:expanded.get(w.id)});continue;}
    let output;
    switch(w.type){
     case 'value':output=evaluateExpression(parseExpression(one(w,'data')),{refs:values,maxOps:this.policy.maxExprOps,maxBytes:this.policy.maxExprBytes}).value;break;
     case 'fact':output={...lowerFact(w,values,this.schema),sop:canonical({wires:[w]})};break;
     case 'rule':output=lowerRule(w,values,this.schema);break;
     case 'query':output=lowerQuery(w,values,this.schema,{now:this.now});break;
     case 'constraint':output=lowerConstraint(w,values);break;
     case 'event':output=materializeEvent(w);break;
     case 'pack':output=dataInputs(w,'items');break;
     case 'template':
     case 'procedure':output={kind:w.type,id:w.id};break;
     case 'assert':effectWires.push(w);continue;
     case 'recall':
     case 'link':{
      if(w.type==='recall')assert(this.repo&&this.session,'recall needs a memory session');
      const q=val(one(w,'query'));assert(q.kind==='query','link/recall input must be a query');
      const items=w.fields.data?flatten([val(one(w,'data'))]):[];
      assert(items.every(x=>x.kind==='fact'||x.kind==='rule'),'link data must contain fact/rule wires');
      const localFacts=items.filter(x=>x.kind==='fact').map((f,i)=>({...f,id:'local_'+w.id+'_'+i,knownAt:this.now,kind:'observed',evidence:{local:true,metadataVerified:true}}));
      const strategy=one(w,'strategy',this.policy.retrievalStrategy);
      if(this.policy.allowedStrategies)assert(this.policy.allowedStrategies.includes(strategy),'Retrieval strategy forbidden by policy');
      output=linkKnowledge({repo:this.repo,session:this.session,query:q,rules:[...this.rules(q),...items.filter(x=>x.kind==='rule')],schema:this.schema,localFacts,strategy,registry:this.strategies,limits:this.policy});break;
     }
     case 'solve':{
      const specs=outputSpecs(w),isConstraint=!!w.fields.constraint;
      const input=val(one(w,isConstraint?'constraint':'query'));
      assert(input.kind===(isConstraint?'constraint':'query'),'Invalid solve input');
      for(const spec of specs)if(['one','many'].includes(spec.mode))assert(isConstraint?Object.hasOwn(input.vars,spec.name):input.select.includes(spec.variable),'Output '+spec.variable+' must be a selected/declared variable');
      const prefix=w.id+'__',additions=[];
      const node=(id,type,fields)=>({id,type,fields,line:0});
      if(!isConstraint){const fields={query:[one(w,'query')],strategy:[one(w,'strategy',this.policy.retrievalStrategy)]};if(w.fields.data)fields.data=w.fields.data;additions.push(node(prefix+'link','link',fields));}
      const rfields=isConstraint?{constraint:w.fields.constraint}:{query:w.fields.query,memory:['$'+prefix+'link']};
      if(w.fields.backend)rfields.backend=w.fields.backend;if(w.fields.reasoning)rfields.reasoning=w.fields.reasoning;if(w.fields.assume)rfields.assume=w.fields.assume;
      // Numeric output projection is passed through a generated, audited result wire.
      additions.push(node(prefix+'reason','reason',rfields));
      for(const spec of specs)additions.push(node(spec.name,'binding',{result:['$'+prefix+'reason'],variable:[spec.variable],mode:[spec.mode],owner:[w.id]}));
      expansions.push({wire:w,additions,target:prefix+'reason'});continue;
     }
     case 'binding':{
      const result=val(one(w,'result')),spec={variable:one(w,'variable'),mode:one(w,'mode')};
      const selected=selectOutput(result,spec);outputStates[w.id]={...selected,mode:spec.mode,owner:one(w,'owner'),epoch,proof:(result.proof??[]).map(p=>p.id)};
      trace.push({wire:w.id,type:'binding',epoch,status:selected.status});
      if(selected.status!=='bound'){unavailable.set(w.id,selected);continue;}output=selected.value;break;
     }
     case 'reason':{
      if(w.fields.constraint){const c=val(one(w,'constraint'));assert(c.kind==='constraint','constraint wire expected');const owner=[...defs.values()].find(d=>d.type==='solve'&&d.id+'__reason'===w.id);
       const project=owner?outputSpecs(owner).filter(x=>['one','many','rows'].includes(x.mode)).map(x=>({name:x.name,mode:x.mode})):[];
       output=this.reasoningStrategies.run(chooseReasoning(w),{mode:'constraint',problem:c,limits:this.policy,backend:one(w,'backend','auto'),project});break;}
      const q=val(one(w,'query'));assert(q.kind==='query','reason needs query data');let mem;
      if(w.fields.memory){mem=val(one(w,'memory'));assert(mem.kind==='retrieval','reason memory must be a retrieval result');}
      else {const items=w.fields.data?flatten([val(one(w,'data'))]):[];const facts=items.filter(x=>x.kind==='fact').map((f,i)=>({...f,id:'local_'+i,knownAt:this.now,evidence:{local:true},kind:'observed'})),rules=items.filter(x=>x.kind==='rule');mem={facts:filterTime(facts,q),rules,complete:true,probes:0};}
      const assumptions=w.fields.assume?flatten([val(one(w,'assume'))]).map((f,i)=>{assert(f.kind==='fact','Assumptions must be fact wires');return {...f,id:'assume_'+i,kind:'assumed'};}):[];
      output=this.reasoningStrategies.run(chooseReasoning(w),{mode:one(w,'mode','deduce'),query:q,memory:mem,data:w.fields.data?flatten([val(one(w,'data'))]):[],limits:this.policy,assumptions:filterTime(assumptions,q),backend:one(w,'backend','auto')});
      if(mem.linkPlan)output.linkPlan=mem.linkPlan;
      // A fact is reinforced only after it appears in the actual proof/refutation.
      // Candidate retrieval alone never creates positive feedback in the memory.
      if(this.repo&&this.session&&!output.hypothetical&&output.proof?.length){const used=output.proof.filter(f=>f.kind==='observed'&&f.evidence?.metadataVerified&&!f.evidence?.local);if(used.length){const rr=this.repo.reinforce(this.session,used,{usedAt:this.now});if(rr.some(x=>x.reinforced))output.reinforcement={facts:rr.filter(x=>x.reinforced).length,strength:this.session.live.retention().useStrength};}}
      break;
     }
     case 'cnl':output=cnl(val(one(w,'result')),one(w,'language','ro'));break;
     case 'clarify':output={status:'clarify',text:unquote(one(w,'text')),complete:false};break;
     case 'jsEval':assert(this.policy.allowJsEval,'jsEval is disabled by host policy');output=evaluateExpression(parseExpression(one(w,'expr')),{refs:values,maxOps:this.policy.maxExprOps,maxBytes:this.policy.maxExprBytes}).value;break;
     case 'expand':{const template=deref(one(w,'using'));assert(['template','procedure'].includes(template.type),'expand needs a template definition');const params=words(one(template,'params','')),bound=new Map();for(const s of many(w,'with')){const match=s.match(/^(\w+)\s+(.+)$/);assert(match&&params.includes(match[1]),'Invalid template argument');assert(!bound.has(match[1]),'Duplicate template argument');const text=match[2];bound.set(match[1],text.startsWith('$')?val(text):unquote(text));}assert(params.every(p=>bound.has(p)),'Missing template argument');const sub=parse(one(template,'body'));assert(!sub.wires.some(x=>params.includes(x.id)),'Template parameter/name collision');const ports=[...outputRegistry(sub).keys()];assert(!ports.some(p=>params.includes(p)),'Template output/parameter collision');const names=Object.fromEntries([...params,...sub.wires.map(x=>x.id),...ports].map(n=>[n,w.id+'__'+n]));const additions=params.map(p=>({id:names[p],type:'value',fields:{data:[JSON.stringify(bound.get(p))]},line:0}));for(const child of sub.wires){child.id=names[child.id];child.fields=Object.fromEntries(Object.entries(child.fields).map(([key,vs])=>[key,vs.map(s=>{let t=replaceReferences(s,names);if(['query','constraint','solve',...OPERATIONS].includes(child.type))t=renameLogicOutputs(t,ports,names);return t;})]));additions.push(child);}const target=names[one(template,'yield')];assert(target&&(additions.some(x=>x.id===target)||ports.includes(one(template,'yield'))),'Template yield is not a local wire/output');expansions.push({wire:w,additions,target});continue;}
     default:{
      if(DECLARATIONS.has(w.type)){output=lowerDeclaration(w,values,this.schema);break;}
      if(OPERATIONS.has(w.type)){
       const get=k=>w.fields[k]?readObject(one(w,k)):undefined;
       const items=flat(get('data')),request={data:items,now:this.now,schema:this.schema};
       for(const k of ['query','memory','observation','candidates','tests','cue','holdout','source','target','transfer','actions','goal','intervention'])if(w.fields[k])request[k]=get(k);
       if(request.observation&&!request.query){assert(request.observation.kind==='fact','Observation must be fact');request.query=queryFor([request.observation.atom],{at:this.now,asof:this.now});}
       const limits={...this.policy};if(w.fields.policy){const constraint=get('policy');assert(constraint.kind==='policy','Expected policy');for(const [k,v]of Object.entries(constraint.limits))limits[k]=Math.min(limits[k]??v,v);}
       if(['abduce','diagnose'].includes(w.type))assert(request.query,'Abduction requires query or observation');
       let retrievalQuery=request.query;
       if(w.type==='plan'){
        assert(request.goal?.kind==='goal','Plan needs goal');
        const actions=flat(request.actions).length?flat(request.actions):items.filter(x=>x.kind==='action');
        retrievalQuery=queryFor([...request.goal.where,...actions.flatMap(x=>x.requires)],{at:this.now,asof:this.now});
       }
       if(this.repo&&this.session&&retrievalQuery&&!request.memory){
        const facts=items.filter(x=>x.kind==='fact').map((f,i)=>({...f,id:'local_'+w.id+'_'+i,kind:'observed',knownAt:this.now,evidence:{local:true,metadataVerified:true}}));
        request.memory=linkKnowledge({repo:this.repo,session:this.session,query:retrievalQuery,rules:[...this.rules(retrievalQuery),...items.filter(x=>x.kind==='rule')],schema:this.schema,localFacts:facts,strategy:this.policy.retrievalStrategy,registry:this.strategies,limits});
       }
       output=this.reasoningStrategies.run(chooseReasoning(w),{...request,mode:w.type,...(w.fields.mode?{operationMode:one(w,'mode')}:{}),limits});
       const specs=outputSpecs(w),field={abduce:'explanations',diagnose:'explanations',associate:'candidates',induce:'patterns',analogize:'mappings',plan:'plans'}[w.type];
       if(field){const collection=output[field]??[];output.outputProjection??={};for(const spec of specs){if(spec.mode==='status')continue;
        output.outputProjection[spec.variable]=!output.complete?{status:'incomplete'}:spec.mode==='many'||spec.mode==='rows'?{status:'bound',value:collection}:spec.mode==='one'?(collection.length===1?{status:'bound',value:collection[0]}:{status:collection.length?'ambiguous':'no_answer',candidates:collection.length}):{status:'unsupported_projection'};
       }}
       if(specs.length){const additions=specs.map(spec=>({id:spec.name,type:'binding',fields:{result:['$'+w.id],variable:[spec.variable],mode:[spec.mode],owner:[w.id]},line:0}));expansions.push({wire:w,additions,target:w.id,retain:true});}
       break;
      }
      assert(this.handlers[w.type],'No interpreter for '+w.type);output=await this.handlers[w.type]({wire:w,values,now:this.now});} 
    }
    if(output?.kind==='fact'){if(this.atomGuard)this.atomGuard(output.atom,{wire:w,atomIndex:0,outputs:outputStates});if(this.factGuard)this.factGuard(output);}if(this.atomGuard){const checked=output?.kind==='query'||output?.kind==='goal'?output.where:output?.kind==='hypothesis'?output.assumptions:output?.kind==='trace'?output.features:[];checked.forEach((a,i)=>this.atomGuard(a,{wire:w,atomIndex:i,outputs:outputStates}));}
    values[w.id]=output;trace.push({wire:w.id,type:w.type,epoch});
   }
   if(effectWires.length){assert(this.repo&&this.session&&this.policy.allowWrite,'Writes are disabled');const ops=[],slices=[];
    for(const w of effectWires){assert(one(w,'scope','session')==='session','SOP writes target the current session; commit/publish is an explicit host action');const start=ops.length;for(const x of dataInputs(w,'input')){
      if(x.kind==='fact'){assert(x.retention!=='pinned'||this.policy.allowPin,'Pinning disabled');ops.push(x);}
      else if(x.kind==='event'){if(x.action==='correct'){assert(x.replacement?.kind==='fact','correct requires replacement fact');assert(x.replacement.retention!=='pinned'||this.policy.allowPin,'Pinning disabled');ops.push({...x,action:'retract'},x.replacement);}else ops.push(x);}
      else if(LIBRARY_TYPES.has(x.kind)){assert(this.policy.allowRules,'Rule installation requires reviewed ingestion');const def=defs.get(x.id),sop=canonical({wires:[def]});assert(!dependencies(def).values.length,'Persistent library definitions cannot depend on transient value wires');ops.push({kind:'library',id:def.id,wireType:def.type,sop,hash:digest(sop),knownAt:this.now});}
      else throw Error('assert input must be a fact, event or approved library definition');}
     slices.push([w,start,ops.length]);}
    const ids=this.repo.apply(this.session,ops,{knownAt:this.now,allowRules:this.policy.allowRules});for(const [w,start,end]of slices){values[w.id]={status:'stored',ids:ids.slice(start,end),count:end-start,revision:this.session.revision};trace.push({wire:w.id,type:'assert',epoch,revision:this.session.revision});}
   }
   if(expansions.length){assert(++epoch<=this.policy.maxEpochs,'Expansion epoch budget');const additions=expansions.flatMap(e=>e.additions);assert(defs.size+additions.length<=this.policy.maxWires,'Expanded wire budget');for(const w of additions)assert(!defs.has(w.id),'Expansion name collision');const draft={wires:[...defs.values(),...additions]};validateGraph(draft,{allowMaterialized:true});generated.push({epoch,source:canonical({wires:additions})});for(const w of additions)defs.set(w.id,w);for(const e of expansions)if(!e.retain)expanded.set(e.wire.id,e.target);}
  }
  const last=originalIds.at(-1);return {profile:'sop-agent-3',values,result:Object.hasOwn(values,last)?values[last]:{status:'blocked',wire:last,...unavailable.get(last)},trace,epochs:epoch+1,wireCount:defs.size,outputs:outputStates,blocked:Object.fromEntries(unavailable),generated};
 }
}
import {contains,intersect} from './time.js';
function filterTime(facts,q){return facts.flatMap(f=>{if(q.at!==undefined)return contains(f.valid,q.at)?[f]:[];const valid=intersect(f.valid,q.during);return valid?[{...f,valid}]:[];});}

function renameLogicOutputs(text,ports,names){
 let out='',quoted=false,escape=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){out+=c;if(!escape&&c==='"')quoted=false;if(!escape&&c==='\\')escape=true;else escape=false;continue;}if(c==='"'){quoted=true;out+=c;continue;}
 if(c==='?'){const m=text.slice(i+1).match(/^[A-Za-z][A-Za-z0-9_]*/);if(m){out+='?'+(ports.includes(m[0])?names[m[0]]:m[0]);i+=m[0].length;continue;}}out+=c;}return out;
}
