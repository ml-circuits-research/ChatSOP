/** Finite generate-and-test abduction. Hypotheses are explicit ground candidates.
 * Enumerate cost-ordered subsets, validate by Horn closure, retain subset-minimal
 * explanations. Removing the observed target avoids the circular explanation
 * "the effect is true because it was observed". No candidates are asserted.
 */
import {generateAbducibles} from './abducibles.js';
import {closure,evaluate} from '../reasoner.js';
import {atomKey} from '../types.js';
import {stable} from '../util.js';
import {Budget,flat,asFact,opposite,partitions,packet,queryFor,conflicts} from './common.js';
export function abduce({query,data,memory,candidates=[],...options}){
 const b=new Budget(options),k=partitions(data,memory,query);let cs=flat(candidates).length?flat(candidates):k.hypotheses;
 if(!query||query.where.some(a=>a.a.some(v=>typeof v==='string'&&v.startsWith('?'))))throw Error('Abduction requires a ground observed target');
 if(cs.some(h=>h.kind!=='hypothesis'))throw Error('Abducibles must be hypothesis declarations');
 const targets=new Set(query.where.map(atomKey)),base=k.facts.filter(f=>!targets.has(atomKey(f.atom))),baseKeys=new Set(base.map(f=>atomKey(f.atom)));
 let generated=null;if(!cs.length){generated=generateAbducibles(query,base,k.rules,b,options.schema);cs=generated.candidates;}
 let complete=k.complete&&(generated?.complete!==false),depthLimited=false;const candidatesUsed=cs.filter(h=>h.status!=='rejected'&&!h.assumptions.some(a=>targets.has(atomKey(a))||baseKeys.has(atomKey(opposite(a)))));
 if(candidatesUsed.length>b.limits.maxCandidates){complete=false;candidatesUsed.length=b.limits.maxCandidates;}
 const frontier=[{indices:[],next:0,cost:0}],answers=[];let checked=0;
 while(frontier.length&&b.step()){
  frontier.sort((a,c)=>a.cost-c.cost||a.indices.length-c.indices.length||stable(a.indices).localeCompare(stable(c.indices)));
  const node=frontier.shift();if(answers.some(a=>a.indices.every(i=>node.indices.includes(i))))continue;
  const hypotheses=node.indices.map(i=>candidatesUsed[i]),assumptions=[...new Map(hypotheses.flatMap(h=>h.assumptions).map(a=>[atomKey(a),a])).values()];
  const cl=closure([...base,...assumptions.map((a,i)=>asFact(a,'hyp_'+i))],k.rules,b.limits);complete&&=cl.complete;checked++;
  const priorConflicts=new Set(conflicts(base)),introduced=conflicts(cl.facts).filter(x=>!priorConflicts.has(x));
  const r=evaluate({...query,mode:'exists',select:[],filters:query.filters??[],limit:1},cl.facts,{complete:cl.complete,maxJoins:b.limits.maxJoins});
  if(r.status==='supported'&&!introduced.length){answers.push({kind:'hypothesis',id:'explanation_'+answers.length,status:'untested',assumptions,cost:node.cost,members:hypotheses.map(h=>h.id),proof:r.proof,indices:node.indices});if(answers.length>=b.limits.maxHypotheses){complete=false;break;}continue;}
  if(node.indices.length>=b.limits.maxDepth){if(node.next<candidatesUsed.length)depthLimited=true;continue;}
  for(let i=node.next;i<candidatesUsed.length;i++){if(frontier.length>=b.limits.maxNodes){complete=false;break;}frontier.push({indices:[...node.indices,i],next:i+1,cost:node.cost+candidatesUsed[i].cost});}
 }
 const minimal=answers.filter(a=>!answers.some(x=>x!==a&&x.indices.length<a.indices.length&&x.indices.every(i=>a.indices.includes(i))));
 return packet('abduction',minimal.length?'hypotheses':'unknown',{explanations:minimal.map(({indices,...a})=>a),complete:complete&&!b.exhausted&&!depthLimited,depthLimited,epistemic:'hypothetical',checked,candidateCount:candidatesUsed.length,generator:generated?{...generated,candidates:undefined}:null,ignored:k.patterns.map(p=>({id:p.id,reason:'pattern-not-a-rule'})),proof:[],query},b);
}
export function diagnose(args){
 const result=abduce(args),k=partitions(args.data,args.memory,args.query),tests=flat(args.tests),ranked=[];let complete=result.complete;
 const budget=new Budget(args);
 for(const test of tests){
  if(test.kind!=='query'||test.where.length!==1||test.where[0].a.some(x=>typeof x==='string'&&x.startsWith('?')))throw Error('Diagnostic tests must be ground single-atom queries');
  const predictions=[];
  for(const e of result.explanations){if(!budget.step()){complete=false;break;}const cl=closure([...k.facts.filter(f=>!args.query.where.some(a=>atomKey(a)===atomKey(f.atom))),...e.assumptions.map((a,i)=>asFact(a,'h_'+i))],k.rules,budget.limits);complete&&=cl.complete;predictions.push({explanation:e.id,status:evaluate(test,cl.facts).status});}
  let separated=0;for(let i=0;i<predictions.length;i++)for(let j=i+1;j<predictions.length;j++)if(predictions[i].status!==predictions[j].status)separated++;
  ranked.push({kind:'test-recommendation',query:test,separatedPairs:separated,predictions,scoreMeaning:'pair-separation heuristic, not expected information gain under a probability model'});
 }
 ranked.sort((a,b)=>b.separatedPairs-a.separatedPairs);
 return {...result,kind:'diagnosis',tests:ranked,complete:complete&&!budget.exhausted,nextTest:ranked.find(t=>t.separatedPairs>0)??null,executedTests:false};
}
