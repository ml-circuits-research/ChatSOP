/** Snapshot search. No hypothetical branch writes to the live repository. */
import {closure,join,evaluate,unify} from '../reasoner.js';
import {atomKey} from '../types.js';
import {stable} from '../util.js';
import {contains} from '../time.js';
import {Budget,flat,partitions,asFact,opposite,substitute,ground,packet,queryFor,conflicts,unsupported} from './common.js';
function assign(facts,adds,removes=[]){const rm=new Set([...removes,...adds.map(opposite)].map(atomKey)),table=new Map(facts.filter(f=>!rm.has(atomKey(f.atom))).map(f=>[atomKey(f.atom),f]));for(const [i,a]of adds.entries())table.set(atomKey(a),asFact(a,'state_'+i+'_'+atomKey(a),'assumed'));return [...table.values()];}
export function plan({data,memory,actions=[],goal,...options}){
 if(!goal||goal.kind!=='goal')throw Error('plan needs a goal declaration');
 const b=new Budget(options),q=queryFor(goal.where,{at:options.now??Date.now()}),k=partitions(data,memory,q),ops=flat(actions).length?flat(actions):k.actions;
 if(ops.some(a=>a.kind!=='action'))throw Error('plan actions must be action declarations');
 const frontier=[{facts:k.facts,cost:0,path:[]}],visited=new Map(),solutions=[];let complete=k.complete,depthLimited=false;
 while(frontier.length&&b.step()){
  frontier.sort((a,c)=>a.cost-c.cost||a.path.length-c.path.length);const node=frontier.shift(),key=stable(node.facts.map(f=>atomKey(f.atom)).sort());
  if(visited.has(key)&&visited.get(key)<=node.cost)continue;visited.set(key,node.cost);
  const cl=closure(node.facts,k.rules,b.limits);complete&&=cl.complete;if(conflicts(cl.facts).length)continue;
  const result=evaluate(q,cl.facts,{complete:cl.complete,maxJoins:b.limits.maxJoins});complete&&=result.complete;
  if(result.status==='supported'){solutions.push({kind:'plan',steps:node.path,cost:node.cost,proof:result.proof,epistemic:'planned-not-executed'});if(solutions.length>=b.limits.maxPlans)break;continue;}
  if(node.path.length>=b.limits.maxDepth){depthLimited=true;continue;}
  for(const op of ops){if(!contains(op.valid??{from:-Infinity,until:Infinity},q.at))continue;const rows=join(op.requires,cl.facts,{maxJoins:b.limits.maxJoins});complete&&=rows.complete;
   for(const row of rows.rows){if(!b.step())break;const adds=op.adds.map(a=>substitute(a,row.binding)),removes=op.removes.map(a=>substitute(a,row.binding));if(![...adds,...removes].every(ground))throw Error('Ungrounded action effect');
    const cost=node.cost+op.cost;if(!Number.isFinite(cost))throw Error('Plan cost overflow');
    if(frontier.length>=b.limits.maxNodes){complete=false;break;}
    frontier.push({facts:assign(node.facts,adds,removes),cost,path:[...node.path,{action:op.id,binding:row.binding,cost:op.cost,requires:row.evidence,adds,removes}]});
   }
  }
 }
 return packet('planning',solutions.length?'plan_found':complete&&!b.exhausted&&!depthLimited?'no_plan':'unknown',{plans:solutions,complete:complete&&!b.exhausted&&!depthLimited,optimal:solutions.length>0&&complete&&!b.exhausted&&!depthLimited,depthLimited,epistemic:'planned',execution:false,selection:'lowest-cost plans for distinct reached goal states; not enumeration of all paths',enumerationComplete:frontier.length===0&&complete&&!b.exhausted&&!depthLimited},b);
}
export function simulate({query,data,memory,intervention,mode='whatif',...options}){
 if(!['whatif','counterfactual'].includes(mode))throw Error('simulate mode must be whatif or counterfactual');
 const b=new Budget(options),k=partitions(data,memory,query),assumptions=flat(intervention).flatMap(h=>{if(h.kind==='hypothesis')return h.assumptions;if(h.kind==='fact')return [h.atom];throw Error('Intervention requires hypothesis/fact declarations');});
 if(!assumptions.every(ground))throw Error('Ground interventions required');
 if(mode==='counterfactual'&&k.rules.some(r=>r.mode!=='causal'))return unsupported('causal_model_required','Counterfactual mode requires an explicit all-causal rule module; ordinary correlations cannot be silently reinterpreted.');
 if(conflicts(assumptions.map((a,i)=>asFact(a,'i'+i))).length)return packet('simulation','inconsistent',{complete:true,hypothetical:true,detail:'The intervention assigns both polarities.'},b);
 if(!b.step())return packet('simulation','unknown',{complete:false,hypothetical:true},b);
 const original=closure(k.facts,k.rules,b.limits),factual=evaluate(query,original.facts,{complete:k.complete&&original.complete,maxJoins:b.limits.maxJoins});
 // Recompute endogenous values from exogenous inputs. This is a deterministic
 // causal Horn model, not a general stochastic structural-causal model.
 const base=mode==='counterfactual'?k.facts.filter(f=>!k.rules.some(r=>unify(r.then,f.atom)||unify({...r.then,neg:!r.then.neg},f.atom))):k.facts;
 const blockedHeads=mode==='counterfactual'?new Set(assumptions.flatMap(a=>[atomKey(a),atomKey(opposite(a))])):new Set();
 const state=assign(base,assumptions,assumptions),cl=closure(state,k.rules,{...b.limits,blockedHeads}),result=evaluate(query,cl.facts,{complete:k.complete&&cl.complete,maxJoins:b.limits.maxJoins});
 return {...result,kind:'simulation',mode,hypothetical:true,epistemic:'hypothetical',factualStatus:factual.status,interventions:assumptions,sourceMemoryModified:false,complete:result.complete&&!b.exhausted,search:b.stats(),semantics:mode==='counterfactual'?'deterministic-causal-Horn-intervention':'fact-replacement-and-rederivation'};
}
