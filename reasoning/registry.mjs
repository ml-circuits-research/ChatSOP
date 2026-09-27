/** Orthogonal reasoning strategy registry. Memory choice never changes syntax.
 * reference: bounded JS algorithms only; advanced: optional SWI/Z3 + the same
 * audited JS controllers. Fallback is explicit in every result route.
 */
import {spawnSync} from 'node:child_process';
import {solveHorn} from './backends/horn.mjs';
import {solveConstraint} from './backends/constraints.mjs';
import {abduce,diagnose} from './abduction.mjs';
import {associate,induce,analogize} from './learning.mjs';
import {plan,simulate} from './worlds.mjs';
import {optimizeFinite,optimizeZ3} from './optimization.mjs';
import {flat,partitions,unsupported,LIMITS} from './common.mjs';
import {assert} from '../lib/util.mjs';
const simple={abduce,diagnose,associate,induce,analogize,plan,simulate};
export const CAPABILITIES={
 reference:{deduce:'finite-function-free-Horn',temporal:'bitemporal-view-and-interval-join',classify:'deductive-rules',abduce:'ground-candidates-subset-minimal',diagnose:'abduction-and-test-partition',associate:'lexical-relational-weaver-score',induce:'bounded-candidate-pattern-evaluation',analogize:'injective-entity-mapping',plan:'deterministic-uniform-cost-search',simulate:'whatif-and-causal-Horn-intervention',constraint:'finite-linear-integers',optimize:'finite-linear-integers'},
 advanced:{deduce:'SWI-when-available-or-audited-JS',constraint:'Z3-when-available-or-finite-JS',optimize:'Z3-plus-optimality-check-or-finite-JS',other:'reference-controllers-no-semantic-change'}
};
const allowedKinds={deduce:['fact','observed','rule'],temporal:['fact','observed','rule'],classify:['fact','observed','rule'],constraint:[],abduce:['fact','observed','rule','hypothesis'],diagnose:['fact','observed','rule','hypothesis'],associate:['trace'],induce:['trace','pattern'],analogize:['trace','fact','hypothesis'],plan:['fact','observed','rule','action','goal'],simulate:['fact','observed','rule','hypothesis']};
export function solverAvailable(name){const cmd=name==='prolog'?(process.env.SWIPL_BIN??'swipl'):(process.env.Z3_BIN??'z3');const r=spawnSync(cmd,['--version'],{encoding:'utf8',timeout:2000,maxBuffer:65536});return !r.error&&r.status===0;}
export class ReasoningRegistry {
 constructor({availability=solverAvailable}={}){this.availability=availability;this.cache=new Map();this.strategies=new Map([['reference',(r)=>this.builtin(r,false)],['advanced',(r)=>this.builtin(r,true)]]);}
 register(name,handler){assert(/^[a-z][a-z0-9-]*$/.test(name)&&typeof handler==='function','Invalid reasoning strategy');assert(!this.strategies.has(name),'Reasoning strategy already registered');this.strategies.set(name,handler);return this;}
 available(name){if(!this.cache.has(name))this.cache.set(name,this.availability(name));return this.cache.get(name);}
 run(name,request){const fn=this.strategies.get(name);assert(fn,'Unknown reasoning strategy '+name);const out=fn(request);assert(out&&typeof out.status==='string'&&typeof out.complete==='boolean','Invalid reasoning result');return {...out,reasoningStrategy:name};}
 builtin(request,advanced){
  const mode=request.mode??'deduce',limits={...LIMITS,...request.limits},items=flat(request.data);
  const allInputs=[...items,...flat(request.candidates),...flat(request.actions),...flat(request.intervention),...flat(request.source),...flat(request.target)];
  const requiredConstraint=items.find(x=>x.kind==='constraint');if(requiredConstraint&&mode!=='constraint')return unsupported('mixed_constraints_require_explicit_stage','This operation cannot drop a constraint; link a numeric solve through SOP output ports.');
  const theory=allInputs.find(x=>x.kind==='theory');if(theory)return {...unsupported('unsupported_theory','No registered compiler for required dialect '+theory.dialect),ignored:[]};
  const ignored=items.filter(x=>!(allowedKinds[mode]??[]).includes(x.kind)&&x.kind!=='retrieval').map(x=>({id:x.id,kind:x.kind,reason:['pattern','hypothesis','trace'].includes(x.kind)?'not-admitted-as-a-deductive-premise':'not-used-by-this-operation'}));
  let out,backend=request.backend??'auto',fallback=null;
  if(!advanced&&!['auto','js'].includes(backend))return unsupported('reference_backend_mismatch','The reference strategy uses JS only; select advanced for external backends.');
  if(['deduce','temporal','classify'].includes(mode)){
   if(backend==='auto'){backend=advanced&&request.query.at!==undefined&&this.available('prolog')?'prolog':'js';if(advanced&&backend==='js')fallback='Prolog unavailable or interval query; using the equivalent JS Horn profile';}
   const k=partitions(request.data,request.memory,request.query);
   out=solveHorn(request.query,{facts:k.facts,rules:k.rules,complete:k.complete,probes:request.memory?.probes??0},{...limits,backend,assumptions:request.assumptions??[]});
  }else if(mode==='constraint'){
   if(backend==='auto'){backend=advanced&&this.available('z3')?'z3':'js';if(advanced&&backend==='js')fallback='Z3 unavailable; using the finite JS profile';}
   if(!['js','z3'].includes(backend))return unsupported('backend_profile_mismatch','Numeric constraints need JS or Z3');
   const p=request.problem,finite=Object.values(p.vars).every(v=>Number.isSafeInteger(v.min)&&Number.isSafeInteger(v.max));
   if(backend==='js'&&!finite)return unsupported('finite_domain_required','Reference numeric reasoning requires finite integer domains');
   out=p.task==='optimize'?(backend==='js'?optimizeFinite(p,{...limits,project:request.project}):optimizeZ3(p,{...limits,project:request.project})):solveConstraint(p,{...limits,backend,project:request.project??[]});
  }else{
   const run=simple[mode];assert(run,'Unsupported reasoning mode '+mode);
   const call={...request,...limits};delete call.mode;if(request.operationMode)call.mode=request.operationMode;out=run(call);backend='js';if(advanced)fallback='This operation uses the shared JS search controller; it is not compiled directly to Prolog/Z3';
  }
  return {...out,ignored:[...ignored,...(out.ignored??[])],route:{operation:mode,backend,fallback,semantics:'no-required-constraint-silently-dropped'}};
 }
}
