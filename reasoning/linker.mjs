/** Goal-directed linker between SOP query declarations and retrieved knowledge.
 * It resolves canonical predicate signatures and rule-body dependencies before
 * calling a solver. It never treats lexical similarity as a logical implication.
 */
import {assert,stable} from '../lib/util.mjs';
import {variable} from '../lib/types.mjs';
import {conditionAtoms} from '../lib/conditions.mjs';
import {contains,intersect} from '../lib/time.mjs';
import {StrategyRegistry} from '../memory/strategies.mjs';
import {emitAtom} from '../sop/parser.mjs';
const normalized = atom => { const ids=new Map();return {...atom,a:atom.a.map(x=>{if(!variable(x))return x;if(!ids.has(x))ids.set(x,'?v'+ids.size);return ids.get(x);})}; };
const key = a => stable(normalized(a));
/** Unification here is variable-variable as well as variable-constant. Rule
 * variables are standardized apart before every application. */
export function matchRule(goal,rule) {
  if(goal.p!==rule.then.p||goal.neg!==rule.then.neg||goal.a.length!==rule.then.a.length)return null;
  const rename=a=>({...a,a:a.a.map(x=>variable(x)?'?rule_'+x.slice(1):x)});
  const head=rename(rule.then),env=new Map();
  const walk=x=>{let budget=256;while(variable(x)&&env.has(x)){assert(budget-->0,'Cyclic logical substitution');x=env.get(x);}return x;};
  for(let i=0;i<goal.a.length;i++){const a=walk(goal.a[i]),b=walk(head.a[i]);if(a===b)continue;if(variable(a))env.set(a,b);else if(variable(b))env.set(b,a);else return null;}
  return {subgoals:rule.if.map(rename).map(a=>({...a,a:a.a.map(walk)})),
    substitution:Object.fromEntries([...env.keys()].map(x=>[x,walk(x)]))};
}
export function planGoals(query,rules,{maxGoals=256,maxRules=1024}={}) {
  const unique=new Map();for(const r of rules){assert(!unique.has(r.id)||stable(unique.get(r.id))===stable(r),'Conflicting rule ID '+r.id);unique.set(r.id,r);}rules=[...unique.values()];
  const index=new Map(),active=rules.filter(r=>query.at!==undefined?contains(r.valid??{from:-Infinity,until:Infinity},query.at):!!intersect(r.valid??{from:-Infinity,until:Infinity},query.during));
  let complete=active.length<=maxRules;
  for(const r of active.slice(0,maxRules)){const sig=[r.then.p,r.then.a.length,r.then.neg].join('/');if(!index.has(sig))index.set(sig,[]);index.get(sig).push(r);}
  const agenda=[],seen=new Set(),selected=new Map(),steps=[];
  const enqueue=raw=>{const a=normalized(raw),k=key(a);if(seen.has(k))return;if(agenda.length>=maxGoals){complete=false;return;}seen.add(k);agenda.push(a);};
  for(const a of conditionAtoms([...query.where,...(query.scope??[])])){enqueue(a);enqueue({...a,neg:!a.neg});}
  for(let i=0;i<agenda.length;i++){
    const goal=agenda[i],matches=index.get([goal.p,goal.a.length,goal.neg].join('/'))??[];
    for(const rule of matches){const m=matchRule(goal,rule);if(!m)continue;selected.set(rule.id,rule);
      steps.push({goal:emitAtom(goal),producer:rule.id,substitution:m.substitution,requires:m.subgoals.map(emitAtom)});
      for(const sub of m.subgoals){enqueue(sub);enqueue({...sub,neg:!sub.neg});}
    }
  }
  return {goals:agenda,rules:[...selected.values()],steps,complete};
}
export function linkKnowledge({repo=null,session=null,query,rules=[],schema=null,localFacts=[],
  strategy='hybrid',registry=new StrategyRegistry(),limits={}}) {
  limits={maxGoals:256,maxRules:1024,maxProbes:50000,maxShards:256,maxFacts:10000,...limits};
  const plan=planGoals(query,rules,limits),facts=new Map(),retrievals=[];let probes=0,shardsVisited=0,complete=plan.complete;
  for(const f of localFacts){let valid=f.valid;if(query.at!==undefined&&!contains(valid,query.at))continue;if(query.during){valid=intersect(valid,query.during);if(!valid)continue;}facts.set(f.id,{...f,valid});}
  if(repo&&session)for(const pattern of plan.goals){
    if(probes>=limits.maxProbes||shardsVisited>=limits.maxShards){complete=false;break;}
    if(schema&&!schema[pattern.p]){complete=false;retrievals.push({pattern:emitAtom(pattern),status:'unknown_predicate'});continue;}
    const r=registry.retrieve(strategy,{repo,session,pattern,query,limits:{...limits,maxProbes:limits.maxProbes-probes,maxShards:limits.maxShards-shardsVisited}});
    probes+=r.probes;shardsVisited+=r.shardsVisited??0;complete&&=r.complete;
    for(const f of r.rows){assert(f.kind!=='hypothesis'&&f.evidence?.metadataVerified!==false,'Unverified retrieval cannot become logical evidence');if(facts.size>=limits.maxFacts&&!facts.has(f.id)){complete=false;break;}facts.set(f.id,f);}
    retrievals.push({pattern:emitAtom(pattern),strategy,selected:r.selected??strategy,coverage:r.coverage??'provider-defined',rows:r.rows.length,complete:r.complete,probes:r.probes,shardsVisited:r.shardsVisited??0,shardsRouted:r.shardsRouted??null});
  }
  const coverage=repo?'retained-visible-memory':'local-declarations';
  return {kind:'retrieval',query,facts:[...facts.values()].slice(0,limits.maxFacts),rules:plan.rules,
    complete:complete&&facts.size<=limits.maxFacts,probes,shardsVisited,needed:[...new Set(plan.goals.map(a=>a.p))],
    linkPlan:{strategy,coverage,goals:plan.goals.map(emitAtom),steps:plan.steps,retrievals,
      note:'Completeness refers to this retrieval view and budgets, never to all facts in the world.'}};
}
