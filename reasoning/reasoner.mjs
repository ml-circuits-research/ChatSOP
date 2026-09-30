/** Function-free Horn inference. Explicit negation is independent evidence.
 * No negation-as-failure and no explosion from contradictory facts.
 * Temporal joins intersect condition intervals; every invocation has a fresh closure.
 */
import {atomKey,rule,variable} from '../lib/types.mjs';
import {conditionAtoms} from '../lib/conditions.mjs';
import {stable,digest} from '../lib/util.mjs';
import {intersect,contains,formatTime} from '../lib/time.mjs';
import {evaluateExpression} from '../sop/expression.mjs';
export function unify(pattern,value,env={}){if(pattern.p!==value.p||pattern.neg!==value.neg||pattern.a.length!==value.a.length)return null;const next={...env};for(let i=0;i<pattern.a.length;i++){const a=pattern.a[i],b=value.a[i];if(variable(a)){if(Object.hasOwn(next,a)&&next[a]!==b)return null;next[a]=b;}else if(a!==b)return null;}return next;}
export function requiredPredicates(query,rules){const out=new Set(conditionAtoms([...query.where,...(query.scope??[])]).map(a=>a.p));let changed=true;while(changed){changed=false;for(const r of rules)if(out.has(r.then.p))for(const a of r.if)if(!out.has(a.p)){out.add(a.p);changed=true;}}return out;}
export function join(body,facts,{maxJoins=30000,valid={from:-Infinity,until:Infinity}}={}){let rows=[{binding:{},valid,evidence:[]}],complete=true;let probes=0;for(let stage=0;stage<body.length;stage++){const a=body[stage],next=[];for(const row of rows){for(const f of facts){if(++probes>maxJoins){complete=false;break;}const env=unify(a,f.atom,row.binding);if(!env)continue;const span=intersect(row.valid,f.valid);if(!span)continue;next.push({binding:env,valid:span,evidence:[...row.evidence,f.id]});}if(!complete)break;}rows=next;if(!complete){if(stage<body.length-1)rows=[];break;}if(!rows.length)break;}return {rows,complete,probes};}
const factKey=f=>stable([atomKey(f.atom),f.valid.from===-Infinity?'beginning':f.valid.from,f.valid.until===Infinity?'open':f.valid.until]);
export function closure(input,rules,{maxRounds=32,maxFacts=10000,maxJoins=30000,blockedHeads=new Set()}={}){
 const table=new Map();for(const f of input){const k=factKey(f);if(!table.has(k))table.set(k,f);}
 let changed=true,complete=true,rounds=0;
 while(changed&&rounds<maxRounds){changed=false;rounds++;const prior=[...table.values()];for(const r of rules){const j=join(r.if,prior,{maxJoins,valid:r.valid??{from:-Infinity,until:Infinity}});complete&&=j.complete;for(const x of j.rows){const a={...r.then,a:r.then.a.map(v=>variable(v)?x.binding[v]:v)};if(blockedHeads.has(atomKey(a)))continue;const f={atom:a,valid:x.valid},key=factKey(f);if(table.has(key))continue;if(table.size>=maxFacts)return {facts:[...table.values()],complete:false,rounds};table.set(key,{...f,id:'d_'+digest(key).slice(0,32),kind:'derived',rule:r.id,from:x.evidence});changed=true;}}}
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
const DAY=86400000;
/** The value a time variable takes: the matched interval, or its start, end or length in days (`measure`). */
function spanValue(valid,q){
 if(q.measure==='start')return formatTime(valid.from);
 if(q.measure==='end')return formatTime(valid.until);
 if(q.measure==='duration'){const until=Math.min(valid.until,q.now??Date.now());return Number.isFinite(valid.from)&&until>=valid.from?Math.floor((until-valid.from)/DAY):'unbounded';}
 return formatTime(valid.from)+' '+formatTime(valid.until);
}
const substitute=(condition,binding)=>condition.kind==='all'||condition.kind==='any'
 ?{kind:condition.kind,children:condition.children.map(child=>substitute(child,binding))}
 :{...condition,a:condition.a.map(v=>variable(v)&&Object.hasOwn(binding,v)?binding[v]:v)};
/**
 * A universal question (mode every): for each binding of the `where` restriction, the `scope` must hold.
 * A member is supported (the scope is derivable), refuted (its explicit negation is derivable) or unknown.
 * Any refuted member refutes the universal; it is supported only when every known member is supported and
 * the restriction has at least one member. With `select`, members are grouped by the selected variables and
 * the answers are the groups whose members all satisfy the scope. The check covers the known members only.
 */
function evaluateEvery(q,facts,{complete,maxJoins}){
 const valid=q.during??{from:-Infinity,until:Infinity};
 const domain=joinConditions(q.where,facts,{maxJoins,valid});complete&&=domain.complete;
 const members=applyCompares(domain.rows.filter(row=>q.filters.every(ast=>evaluateExpression(ast,{variables:row.binding}).value===true)),q.compares,{});
 let budget=Math.max(0,maxJoins-domain.probes);const groups=new Map(),evidence=new Set();
 for(const row of members){
  const scope=q.scope.map(c=>substitute(c,row.binding));
  const positive=joinConditions(scope,facts,{maxJoins:budget,valid:row.valid});budget=Math.max(0,budget-positive.probes);complete&&=positive.complete;
  let status=positive.rows.length?'supported':'unknown',support=positive.rows[0]?.evidence??[];
  if(!positive.rows.length&&conditionAtoms(scope).every(a=>a.a.every(v=>!variable(v)))){
   const negative=joinConditions(oppositeConditions(scope),facts,{maxJoins:budget,valid:row.valid});budget=Math.max(0,budget-negative.probes);complete&&=negative.complete;
   if(negative.rows.length){status='refuted';support=negative.rows[0].evidence;}
  }
  const key=stable(q.select.map(v=>row.binding[v]));
  if(!groups.has(key))groups.set(key,{binding:Object.fromEntries(q.select.map(v=>[v,row.binding[v]])),members:[],evidence:[]});
  const group=groups.get(key);group.members.push({binding:row.binding,status});group.evidence.push(...row.evidence,...support);
 }
 const statusOf=group=>quantifiedStatus(q.quantifier,group.members);
 const all=[...groups.values()].map(group=>({...group,status:statusOf(group)}));
 const byId=new Map(facts.map(f=>[f.id,f]));
 const trace=id=>{if(evidence.has(id))return;evidence.add(id);for(const p of byId.get(id)?.from??[])trace(p);};
 let status,answers=[];
 if(q.select.length){
  answers=all.filter(g=>g.status==='supported').slice(0,q.limit).map(g=>({binding:g.binding,valid,evidence:g.evidence}));
  status=answers.length?'supported':all.length&&all.every(g=>g.status==='refuted')?'refuted':'unknown';
  for(const g of all.filter(g=>g.status===status))g.evidence.forEach(trace);
 }else{
  status=all.length?all[0].status:'unknown';
  if(all.length)all[0].evidence.forEach(trace);
 }
 const counterexamples=all.flatMap(g=>g.members.filter(m=>m.status==='refuted').map(m=>m.binding));
 const undecided=all.flatMap(g=>g.members.filter(m=>m.status==='unknown').map(m=>m.binding));
 const proof=[...evidence].map(id=>byId.get(id)).filter(Boolean);
 return {status,kind:'every',query:q,conflictedAnswers:[],answers:answers.map(({evidence,...row})=>row),members:members.length,counterexamples,undecided,proof,depth:0,complete,truncated:false,
  assurance:'Universal checked over the members of the restriction known to the host; members it does not know are not covered.'};
}
/**
 * Status of a universal question under a quantifier word (DS021 Q-LANG-2), from the members' statuses
 * (supported, refuted or unknown). `all` (default): refuted by any refuted member, supported when every member is
 * supported. `none`: supported when every member is refuted. `not_all`: supported by any refuted member.
 * `most`: more than half supported. `half`: exactly half supported (every member decided). `at_least N`: N or
 * more supported. A result the unknown members could still change is unknown. No member at all is unknown.
 */
export function quantifiedStatus(quantifier,members){
 const n=members.length,s=members.filter(m=>m.status==='supported').length,r=members.filter(m=>m.status==='refuted').length,u=n-s-r;
 if(!n)return 'unknown';
 const decide=(yes,no)=>yes?'supported':no?'refuted':'unknown';
 switch(quantifier?.word??'all'){
  case 'all':return decide(u===0&&r===0,r>0);
  case 'none':return decide(u===0&&s===0,s>0);
  case 'not_all':return decide(r>0,u===0&&r===0);
  case 'most':return decide(2*s>n,2*(s+u)<=n);
  case 'half':return decide(u===0&&2*s===n,2*s>n||2*r>n||(u===0&&2*s!==n));
  case 'at_least':return decide(s>=quantifier.count,s+u<quantifier.count);
  default:throw Error('Unknown quantifier '+quantifier.word);
 }
}
/** A value read as a number: a number, or a string that starts with one ("2380 lei", "80"). */
export function numericValue(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 const m=typeof value==='string'?value.trim().match(/^(-?\d+(?:\.\d+)?)(?:\s|$)/):null;
 return m?Number(m[1]):null;
}
const COMPARE={above:(a,b)=>a>b,below:(a,b)=>a<b,at_least:(a,b)=>a>=b,at_most:(a,b)=>a<=b};
/** Apply `compare` lines to rows; `state.notComputable` records values that are not numbers for an ordering comparison. */
function applyCompares(rows,compares=[],state){
 if(!compares.length)return rows;
 const test=(node,row)=>{
  if(node.kind==='all')return node.children.every(child=>test(child,row));
  if(node.kind==='any')return node.children.some(child=>test(child,row));
  const {left,op,right}=node,a=row.binding[left],b=variable(right)?row.binding[right]:right;
  if(op==='equal'||op==='not_equal'){const x=numericValue(a),y=numericValue(b),same=x!==null&&y!==null?x===y:a===b;return op==='equal'?same:!same;}
  const x=numericValue(a),y=numericValue(b);
  if(x===null||y===null){state.notComputable=true;return false;}
  return COMPARE[op](x,y);
 };
 return rows.filter(row=>compares.every(node=>test(node,row)));
}
/** `rank highest|lowest ?v`: keep the rows whose value is the best; ties keep every tied row. */
function applyRank(rows,rank,state){
 if(!rank||!rows.length)return rows;
 const valued=rows.map(row=>({row,value:numericValue(row.binding[rank.variable])})).filter(item=>item.value!==null);
 if(!valued.length){state.notComputable=true;return [];}
 if(valued.length<rows.length)state.partial=true;
 const best=rank.direction==='highest'?Math.max(...valued.map(item=>item.value)):Math.min(...valued.map(item=>item.value));
 return valued.filter(item=>item.value===best).map(item=>item.row);
}
const notComputable=(q,reason)=>({status:'not_computable',kind:q.mode,query:q,conflictedAnswers:[],answers:[],proof:[],depth:0,complete:true,truncated:false,reason,
 assurance:'The host understood the question but cannot compute it from the values it has.'});
/**
 * Temporal ordering (DS021 Q-LANG-3, `order ?t1 before ?t2`): each top-level condition of `where` is joined on its
 * own, without intersecting validity, and the time variables take the intervals of the conditions that hold
 * their leaves. `before`/`after` compare the interval starts; `same_time` asks for overlapping intervals.
 * Supported when some combination satisfies the order, refuted when combinations exist with known starts and
 * none does, otherwise unknown.
 */
function evaluateOrder(q,facts,{complete,maxJoins}){
 const top=q.where.length===1&&q.where[0].kind==='all'?q.where[0].children:q.where;
 const whole={from:-Infinity,until:Infinity};
 let offset=0,budget=maxJoins;const parts=[];
 for(const condition of top){
  const count=conditionAtoms([condition]).length,joined=joinConditions([condition],facts,{maxJoins:budget,valid:whole});
  budget=Math.max(0,budget-joined.probes);complete&&=joined.complete;parts.push({from:offset,to:offset+count,rows:joined.rows});offset+=count;
 }
 const partOf=leaf=>parts.findIndex(part=>leaf>=part.from&&leaf<part.to);
 const [li,ri]=q.order.leaves.map(partOf);
 if(li<0||ri<0||li===ri)return notComputable(q,'order_needs_two_conditions');
 let rows=[{binding:{},valids:[],evidence:[]}];
 for(const part of parts){
  const next=[];
  for(const row of rows)for(const r of part.rows){
   if(Object.entries(r.binding).some(([k,v])=>Object.hasOwn(row.binding,k)&&row.binding[k]!==v))continue;
   next.push({binding:{...row.binding,...r.binding},valids:[...row.valids,r.valid],evidence:[...row.evidence,...r.evidence]});
  }
  rows=next;
 }
 const state={};
 const decided=rows.map(row=>{
  const a=row.valids[li],b=row.valids[ri],known=Number.isFinite(a.from)&&Number.isFinite(b.from);
  const holds=q.order.relation==='same_time'?!!intersect(a,b):known&&(q.order.relation==='before'?a.from<b.from:a.from>b.from);
  return {row:{...row,binding:{...row.binding,[q.order.left]:spanValue(a,q),[q.order.right]:spanValue(b,q)}},holds,known:q.order.relation==='same_time'||known};
 });
 let matches=decided.filter(d=>d.holds).map(d=>d.row);
 matches=applyCompares(matches.filter(row=>q.filters.every(ast=>evaluateExpression(ast,{variables:row.binding}).value===true)),q.compares,state);
 const status=matches.length?'supported':decided.length&&decided.every(d=>d.known)?'refuted':'unknown';
 const used=new Set([...(matches.length?matches:decided.map(d=>d.row)).flatMap(row=>row.evidence)]);
 const proof=facts.filter(f=>used.has(f.id));
 const unique=new Map();for(const row of matches){const binding=Object.fromEntries(q.select.map(k=>[k,row.binding[k]]));unique.set(stable(binding),{binding,valid:whole});}
 return {status,kind:q.mode,query:q,conflictedAnswers:[],answers:q.select.length?[...unique.values()].slice(0,q.limit):[],count:q.mode==='count'?unique.size:undefined,proof,depth:0,complete,truncated:false,
  assurance:'Order of the matched validity intervals known to the host.'};
}
export function evaluate(q,facts,{complete=true,maxJoins=30000}={}){
 facts=facts.filter(f=>q.at!==undefined?contains(f.valid,q.at):!q.during||intersect(f.valid,q.during));
 if(q.mode==='every')return evaluateEvery(q,facts,{complete,maxJoins});
 if(q.order)return evaluateOrder(q,facts,{complete,maxJoins});
 const valid=q.during??{from:-Infinity,until:Infinity};
 const positive=joinConditions(q.where,facts,{maxJoins,valid});complete&&=positive.complete;
 // A time variable (`span`) is bound to the interval of the matched facts, or to its start, end or length.
 if(q.span)for(const row of positive.rows)row.binding={...row.binding,[q.span]:spanValue(row.valid,q)};
 const state={},filtered=positive.rows.filter(row=>q.filters.every(ast=>evaluateExpression(ast,{variables:row.binding}).value===true));
 const matches=applyRank(applyCompares(filtered,q.compares,state),q.rank,state);
 // A yes/no question whose known values all fail a numeric comparison is answered no ("Is the Dacia over 5000?" with a price of 4000).
 const comparedAway=!matches.length&&filtered.length>0&&(q.compares?.length??0)>0&&!state.notComputable&&q.mode==='exists';
 if(!matches.length&&state.notComputable)return notComputable(q,'value_not_numeric');
 const remaining=Math.max(0,maxJoins-positive.probes);
 const ground=conditionAtoms(q.where).every(a=>a.a.every(v=>!variable(v)));
 const negative=ground?joinConditions(oppositeConditions(q.where),facts,{maxJoins:remaining,valid}):{rows:[],complete:true};
 complete&&=negative.complete;
 const opposing=negative.rows,overlap=matches.some(m=>opposing.some(o=>intersect(m.valid,o.valid)));
 const status=matches.length?(opposing.length?(overlap?'both':'mixed_temporal'):'supported'):opposing.length||comparedAway?'refuted':'unknown';
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
 const trace=id=>{if(used.has(id))return;used.add(id);for(const p of proofMap.get(id)?.from??[])trace(p);};
 answers.forEach(a=>a.evidence.forEach(trace));
 if(comparedAway)filtered.forEach(row=>row.evidence.forEach(trace));
 opposing.forEach(row=>row.evidence.forEach(trace));
 const conflictedAnswers=answers.filter(row=>row.conflicted).map(({conflicted,...row})=>row);
 const projectedAnswers=answers.map(({conflicted,...row})=>row);
 // Minimal derivation depth: the fewest rule applications needed for the used
 // supporting facts. A directly supplied or observed fact counts as 0; each chained
 // rule application adds 1. Unresolved support ids count as 0.
 const depthOf=fact=>{
  const memo=new Map();
  const walk=id=>{
   if(memo.has(id))return memo.get(id);
   const f=proofMap.get(id);
   const value=!f||!(f.from??[]).length?0:1+Math.max(...f.from.map(walk));
   memo.set(id,value);return value;
  };
  return walk(fact?.id);
 };
 const usedFacts=[...used].map(id=>proofMap.get(id)).filter(Boolean);
 const depth=usedFacts.length?Math.max(...usedFacts.map(depthOf)):0;
 // mode explain: the answer to "why" is the derivation of the asked proposition (or of its negation).
 const explanation=q.mode==='explain'?{kind:!usedFacts.length?'none':usedFacts.some(f=>f.kind==='derived')?'derivation':'recorded',
  steps:usedFacts.map(f=>({atom:f.atom,valid:f.valid,...(f.kind==='derived'?{rule:f.rule,from:f.from}:{source:f.source??f.kind})}))}:undefined;
 return {status,kind:q.mode,query:q,conflictedAnswers,answers:projectedAnswers,...(explanation?{explanation}:{}),count:q.mode==='count'?new Set(matches.map(r=>stable(q.select.length?Object.fromEntries(q.select.map(k=>[k,r.binding[k]])):r.binding))).size:undefined,proof:usedFacts,depth,complete:complete&&!truncated,truncated,assurance:'Derivation from admitted facts; support is not a calibrated probability of truth.'};
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
