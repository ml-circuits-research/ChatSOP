/** Function-free Horn inference. Explicit negation is independent evidence.
 * No negation-as-failure and no explosion from contradictory facts.
 * Temporal joins intersect premise intervals; every invocation has a fresh closure.
 */
import {atomKey,rule,variable} from './types.js';
import {stable,digest} from './util.js';
import {intersect,contains} from './time.js';
import {evaluateExpression} from './sop/expression.js';
export function unify(pattern,value,env={}){if(pattern.p!==value.p||pattern.neg!==value.neg||pattern.a.length!==value.a.length)return null;const next={...env};for(let i=0;i<pattern.a.length;i++){const a=pattern.a[i],b=value.a[i];if(variable(a)){if(Object.hasOwn(next,a)&&next[a]!==b)return null;next[a]=b;}else if(a!==b)return null;}return next;}
export function requiredPredicates(query,rules){const out=new Set(query.where.map(a=>a.p));let changed=true;while(changed){changed=false;for(const r of rules)if(out.has(r.then.p))for(const a of r.if)if(!out.has(a.p)){out.add(a.p);changed=true;}}return out;}
export function join(body,facts,{maxJoins=30000,valid={from:-Infinity,until:Infinity}}={}){let rows=[{binding:{},valid,evidence:[]}],complete=true;let probes=0;for(let stage=0;stage<body.length;stage++){const a=body[stage],next=[];for(const row of rows){for(const f of facts){if(++probes>maxJoins){complete=false;break;}const env=unify(a,f.atom,row.binding);if(!env)continue;const span=intersect(row.valid,f.valid);if(!span)continue;next.push({binding:env,valid:span,evidence:[...row.evidence,f.id]});}if(!complete)break;}rows=next;if(!complete){if(stage<body.length-1)rows=[];break;}if(!rows.length)break;}return {rows,complete,probes};}
const factKey=f=>stable([atomKey(f.atom),f.valid.from===-Infinity?'beginning':f.valid.from,f.valid.until===Infinity?'open':f.valid.until]);
export function closure(input,rules,{maxRounds=32,maxFacts=10000,maxJoins=30000,blockedHeads=new Set()}={}){
 const table=new Map();for(const f of input){const k=factKey(f);if(!table.has(k))table.set(k,f);}
 let changed=true,complete=true,rounds=0;
 while(changed&&rounds<maxRounds){changed=false;rounds++;const prior=[...table.values()];for(const r of rules){const j=join(r.if,prior,{maxJoins,valid:r.valid??{from:-Infinity,until:Infinity}});complete&&=j.complete;for(const x of j.rows){const a={...r.then,a:r.then.a.map(v=>variable(v)?x.binding[v]:v)};if(blockedHeads.has(atomKey(a)))continue;const f={atom:a,valid:x.valid},key=factKey(f);if(table.has(key))continue;if(table.size>=maxFacts)return {facts:[...table.values()],complete:false,rounds};table.set(key,{...f,id:'d_'+digest(key).slice(0,32),kind:'derived',rule:r.id,premises:x.evidence});changed=true;}}}
 if(changed)complete=false;return {facts:[...table.values()],complete,rounds};
}
export function evaluate(q,facts,{complete=true,maxJoins=30000}={}){
 facts=facts.filter(f=>q.at!==undefined?contains(f.valid,q.at):!q.during||intersect(f.valid,q.during));
 const j=join(q.where,facts,{maxJoins,valid:q.during??{from:-Infinity,until:Infinity}});complete&&=j.complete;
 const matches=j.rows.filter(row=>q.filters.every(ast=>evaluateExpression(ast,{variables:row.binding}).value===true));
 let status=matches.length?'supported':'unknown',opposing=[];
 if(q.where.length===1&&q.where[0].a.every(v=>!variable(v))){const neg={...q.where[0],neg:!q.where[0].neg};opposing=facts.filter(f=>unify(neg,f.atom));if(opposing.length){const overlap=matches.some(m=>opposing.some(f=>intersect(m.valid,f.valid)));status=matches.length?(overlap?'both':'mixed_temporal'):'refuted';}}
 const unique=new Map();for(const r of matches){const binding=Object.fromEntries(q.select.map(k=>[k,r.binding[k]]));const key=stable([binding,q.during?r.valid:null]);if(!unique.has(key))unique.set(key,{binding,valid:r.valid,evidence:r.evidence});}
 const all=[...unique.values()],truncated=all.length>q.limit;const answers=all.slice(0,q.limit);const proofMap=new Map(facts.map(f=>[f.id,f])),used=new Set();const trace=id=>{if(used.has(id))return;used.add(id);for(const p of proofMap.get(id)?.premises??[])trace(p);};answers.forEach(a=>a.evidence.forEach(trace));opposing.forEach(f=>trace(f.id));
 const conflictedAnswers=answers.filter(row=>matches.some(full=>q.select.every(v=>full.binding[v]===row.binding[v])&&q.where.some(a=>{const ground={...a,a:a.a.map(x=>variable(x)?full.binding[x]:x),neg:!a.neg};return ground.a.every(x=>x!==undefined)&&facts.some(f=>unify(ground,f.atom)&&intersect(full.valid,f.valid));})));
 return {status,kind:q.mode,query:q,conflictedAnswers,answers,count:q.mode==='count'?new Set(matches.map(r=>stable(q.select.length?Object.fromEntries(q.select.map(k=>[k,r.binding[k]])):r.binding))).size:undefined,proof:[...used].map(id=>proofMap.get(id)).filter(Boolean),complete:complete&&!truncated,truncated,assurance:'Derivation from admitted premises; support is not a calibrated probability of truth.'};
}
export function retrieve(repo,session,q,rules,schema,{maxProbes=50000,maxFacts=10000,allowUnverified=false}={}){
 const needed=requiredPredicates(q,rules),all=new Map();let probes=0,complete=true;
 for(const p of needed){if(!schema[p]){complete=false;continue;}for(const neg of [false,true]){if(probes>=maxProbes){complete=false;break;}const r=repo.recall(session,{p,a:Array.from({length:schema[p].arity},(_,i)=>'?v'+i),neg},q,{maxProbes:maxProbes-probes,limit:maxFacts,allowUnverified});complete&&=r.complete;probes+=r.probes;for(const f of r.rows)all.set(f.id,f);if(all.size>=maxFacts){complete=false;break;}}if(!complete&&probes>=maxProbes)break;}
 return {kind:'retrieval',query:q,facts:[...all.values()].slice(0,maxFacts),rules:rules.filter(r=>needed.has(r.then.p)),complete:complete&&all.size<=maxFacts,probes,needed:[...needed]};
}
export function reason(q,memory,{assumptions=[],...limits}={}){
 const cl=closure([...memory.facts,...assumptions],memory.rules,limits);const out=evaluate(q,cl.facts,{complete:memory.complete&&cl.complete,maxJoins:limits.maxJoins??30000});return {...out,hypothetical:assumptions.length>0,diagnostics:{memoryProbes:memory.probes??0,retrieved:memory.facts.length,closureFacts:cl.facts.length,rounds:cl.rounds}};
}
