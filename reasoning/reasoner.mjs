/** Function-free Horn inference. Explicit negation is independent evidence.
 * No negation-as-failure and no explosion from contradictory facts.
 * Temporal joins intersect premise intervals; every invocation has a fresh closure.
 */
import {atomKey,rule,variable} from '../lib/types.mjs';
import {conditionAtoms} from '../lib/conditions.mjs';
import {stable,digest} from '../lib/util.mjs';
import {intersect,contains} from '../lib/time.mjs';
import {evaluateExpression} from '../sop/expression.mjs';
export function unify(pattern,value,env={}){if(pattern.p!==value.p||pattern.neg!==value.neg||pattern.a.length!==value.a.length)return null;const next={...env};for(let i=0;i<pattern.a.length;i++){const a=pattern.a[i],b=value.a[i];if(variable(a)){if(Object.hasOwn(next,a)&&next[a]!==b)return null;next[a]=b;}else if(a!==b)return null;}return next;}
export function requiredPredicates(query,rules){const out=new Set(conditionAtoms(query.where).map(a=>a.p));let changed=true;while(changed){changed=false;for(const r of rules)if(out.has(r.then.p))for(const a of r.if)if(!out.has(a.p)){out.add(a.p);changed=true;}}return out;}
export function join(body,facts,{maxJoins=30000,valid={from:-Infinity,until:Infinity}}={}){let rows=[{binding:{},valid,evidence:[]}],complete=true;let probes=0;for(let stage=0;stage<body.length;stage++){const a=body[stage],next=[];for(const row of rows){for(const f of facts){if(++probes>maxJoins){complete=false;break;}const env=unify(a,f.atom,row.binding);if(!env)continue;const span=intersect(row.valid,f.valid);if(!span)continue;next.push({binding:env,valid:span,evidence:[...row.evidence,f.id]});}if(!complete)break;}rows=next;if(!complete){if(stage<body.length-1)rows=[];break;}if(!rows.length)break;}return {rows,complete,probes};}
const factKey=f=>stable([atomKey(f.atom),f.valid.from===-Infinity?'beginning':f.valid.from,f.valid.until===Infinity?'open':f.valid.until]);
export function closure(input,rules,{maxRounds=32,maxFacts=10000,maxJoins=30000,blockedHeads=new Set()}={}){
 const table=new Map();for(const f of input){const k=factKey(f);if(!table.has(k))table.set(k,f);}
 let changed=true,complete=true,rounds=0;
 while(changed&&rounds<maxRounds){changed=false;rounds++;const prior=[...table.values()];for(const r of rules){const j=join(r.if,prior,{maxJoins,valid:r.valid??{from:-Infinity,until:Infinity}});complete&&=j.complete;for(const x of j.rows){const a={...r.then,a:r.then.a.map(v=>variable(v)?x.binding[v]:v)};if(blockedHeads.has(atomKey(a)))continue;const f={atom:a,valid:x.valid},key=factKey(f);if(table.has(key))continue;if(table.size>=maxFacts)return {facts:[...table.values()],complete:false,rounds};table.set(key,{...f,id:'d_'+digest(key).slice(0,32),kind:'derived',rule:r.id,premises:x.evidence});changed=true;}}}
 if(changed)complete=false;return {facts:[...table.values()],complete,rounds};
}
/** Query branches share one probe budget; an ALL stage never exposes unfinished joins. */
function joinConditions(conditions,facts,{maxJoins,valid}){
 const budget={probes:0,complete:true};
 const all=(items,input)=>{
  let rows=input;
  for(let i=0;i<items.length;i++){
   rows=one(items[i],rows);
   if(!budget.complete)return i===items.length-1?rows:[];
   if(!rows.length)break;
  }
  return rows;
 };
 const one=(condition,rows)=>{
  if(condition.kind==='all')return all(condition.children,rows);
  if(condition.kind==='any'){
   const alternatives=[];
   for(const child of condition.children){
    alternatives.push(...one(child,rows));
    if(!budget.complete)break;
   }
   return alternatives;
  }
  const next=[];
  for(const row of rows)for(const f of facts){
   if(budget.probes>=maxJoins){budget.complete=false;return next;}
   budget.probes++;
   const binding=unify(condition,f.atom,row.binding);
   if(!binding)continue;
   const span=intersect(row.valid,f.valid);
   if(span)next.push({binding,valid:span,evidence:[...row.evidence,f.id]});
  }
  return next;
 };
 const rows=all(conditions,[{binding:{},valid,evidence:[]}]);
 return {rows,complete:budget.complete,probes:budget.probes};
}
/** Explicit opposite evidence: not ALL is ANY opposite, not ANY is ALL opposite. */
function oppositeConditions(conditions){
 const opposite=condition=>condition.kind==='all'||condition.kind==='any'
  ?{kind:condition.kind==='all'?'any':'all',children:condition.children.map(opposite)}
  :{...condition,neg:!condition.neg};
 return [{kind:'any',children:conditions.map(opposite)}];
}
export function evaluate(q,facts,{complete=true,maxJoins=30000}={}){
 facts=facts.filter(f=>q.at!==undefined?contains(f.valid,q.at):!q.during||intersect(f.valid,q.during));
 const valid=q.during??{from:-Infinity,until:Infinity};
 const positive=joinConditions(q.where,facts,{maxJoins,valid});complete&&=positive.complete;
 const matches=positive.rows.filter(row=>q.filters.every(ast=>evaluateExpression(ast,{variables:row.binding}).value===true));
 const remaining=Math.max(0,maxJoins-positive.probes);
 const ground=conditionAtoms(q.where).every(a=>a.a.every(v=>!variable(v)));
 const negative=ground?joinConditions(oppositeConditions(q.where),facts,{maxJoins:remaining,valid}):{rows:[],complete:true};
 complete&&=negative.complete;
 const opposing=negative.rows,overlap=matches.some(m=>opposing.some(o=>intersect(m.valid,o.valid)));
 const status=matches.length?(opposing.length?(overlap?'both':'mixed_temporal'):'supported'):opposing.length?'refuted':'unknown';
 const proofMap=new Map(facts.map(f=>[f.id,f])),byAtom=new Map();
 if(matches.length)for(const f of facts){const key=atomKey(f.atom);if(!byAtom.has(key))byAtom.set(key,[]);byAtom.get(key).push(f);}
 const contradicted=row=>row.evidence.some(id=>{
  const f=proofMap.get(id);if(!f)return false;
  return (byAtom.get(atomKey({...f.atom,neg:!f.atom.neg}))??[]).some(other=>intersect(row.valid,other.valid));
 });
 const unique=new Map();
 for(const r of matches){
  const binding=Object.fromEntries(q.select.map(k=>[k,r.binding[k]]));
  const key=stable([binding,q.during?r.valid:null]),conflicted=contradicted(r);
  const prior=unique.get(key);
  if(!prior||prior.conflicted&&!conflicted)unique.set(key,{binding,valid:r.valid,evidence:r.evidence,conflicted});
 }
 const all=[...unique.values()],truncated=all.length>q.limit;
 const answers=all.slice(0,q.limit),used=new Set();
 const trace=id=>{if(used.has(id))return;used.add(id);for(const p of proofMap.get(id)?.premises??[])trace(p);};
 answers.forEach(a=>a.evidence.forEach(trace));
 opposing.forEach(row=>row.evidence.forEach(trace));
 const conflictedAnswers=answers.filter(row=>row.conflicted).map(({conflicted,...row})=>row);
 const projectedAnswers=answers.map(({conflicted,...row})=>row);
 return {status,kind:q.mode,query:q,conflictedAnswers,answers:projectedAnswers,count:q.mode==='count'?new Set(matches.map(r=>stable(q.select.length?Object.fromEntries(q.select.map(k=>[k,r.binding[k]])):r.binding))).size:undefined,proof:[...used].map(id=>proofMap.get(id)).filter(Boolean),complete:complete&&!truncated,truncated,assurance:'Derivation from admitted premises; support is not a calibrated probability of truth.'};
}
export function retrieve(repo,session,q,rules,schema,{maxProbes=50000,maxFacts=10000,allowUnverified=false}={}){
 const needed=requiredPredicates(q,rules),all=new Map();let probes=0,complete=true;
 for(const p of needed){if(!schema[p]){complete=false;continue;}for(const neg of [false,true]){if(probes>=maxProbes){complete=false;break;}const r=repo.recall(session,{p,a:Array.from({length:schema[p].arity},(_,i)=>'?v'+i),neg},q,{maxProbes:maxProbes-probes,limit:maxFacts,allowUnverified});complete&&=r.complete;probes+=r.probes;for(const f of r.rows)all.set(f.id,f);if(all.size>=maxFacts){complete=false;break;}}if(!complete&&probes>=maxProbes)break;}
 return {kind:'retrieval',query:q,facts:[...all.values()].slice(0,maxFacts),rules:rules.filter(r=>needed.has(r.then.p)),complete:complete&&all.size<=maxFacts,probes,needed:[...needed]};
}
export function admissibleAssumptions(facts, assumptions = []){
  if(!assumptions.length)return {kept:[],defeated:[]};
  const admitted=new Set(facts.map(f=>atomKey(f.atom)));
  const kept=[],defeated=[];
  for(const assumption of assumptions){
    const contrary={...assumption.atom,neg:!assumption.atom.neg};
    (admitted.has(atomKey(contrary))?defeated:kept).push(assumption);
  }
  return {kept,defeated};
}
export function reason(q,memory,{assumptions=[],...limits}={}){
  const {kept:keptAssumptions,defeated:defeatedAssumptions}=assumptions.length?admissibleAssumptions(memory.facts,assumptions):{kept:[],defeated:[]};
  const cl=closure([...memory.facts,...keptAssumptions],memory.rules,limits);const out=evaluate(q,cl.facts,{complete:memory.complete&&cl.complete,maxJoins:limits.maxJoins??30000});
  const assumeIds=new Set(keptAssumptions.map(a=>a.id));
  const usesAssumption=out.proof.some(p=>assumeIds.has(p.id));
  return {...out,hypothetical:keptAssumptions.length>0&&usesAssumption,defeatedAssumptions:defeatedAssumptions.map(a=>a.id),diagnostics:{memoryProbes:memory.probes??0,retrieved:memory.facts.length,closureFacts:cl.facts.length,rounds:cl.rounds,assumptionsKept:keptAssumptions.length}};
}
