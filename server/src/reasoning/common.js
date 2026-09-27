import {assert,stable,digest} from '../util.js';
import {atomKey,variable} from '../types.js';
import {contains,intersect} from '../time.js';
export const LIMITS={maxNodes:5000,maxDepth:8,maxHypotheses:64,maxCandidates:512,maxPlans:1,maxRounds:32,maxFacts:10000,maxJoins:30000,maxAssignments:100000,timeoutMs:3000};
export class Budget {
 constructor(limits={}){this.limits={...LIMITS,...limits};for(const k of Object.keys(LIMITS))assert(Number.isSafeInteger(this.limits[k])&&this.limits[k]>0,'Invalid reasoning budget '+k);this.nodes=0;this.started=performance.now();this.exhausted=false;this.reason=null;}
 step(n=1){if(this.exhausted)return false;if(this.nodes+n>this.limits.maxNodes){this.exhausted=true;this.reason='maxNodes';return false;}if(performance.now()-this.started>this.limits.timeoutMs){this.exhausted=true;this.reason='timeout';return false;}this.nodes+=n;return true;}
 stats(){return {nodes:this.nodes,exhausted:this.exhausted,reason:this.reason,limits:this.limits};}
}
export const flat=x=>Array.isArray(x)?x.flatMap(flat):x==null?[]:[x];
export const opposite=a=>({...a,neg:!a.neg});
export const substitute=(a,binding)=>({...a,a:a.a.map(v=>variable(v)?binding[v]??v:v)});
export const ground=a=>a.a.every(x=>!variable(x));
export const timeless={from:-Infinity,until:Infinity};
export function asFact(a,id,kind='assumed'){return {id,atom:a,valid:{...timeless},kind,source:kind,evidence:{local:true},knownAt:0};}
export function partitions(input=[],memory=null,q=null){
 const items=[...flat(input),...(memory?.facts??[]),...(memory?.rules??[])],out={facts:[],rules:[],patterns:[],hypotheses:[],actions:[],goals:[],traces:[],policies:[],theories:[],ignored:[],complete:memory?.complete!==false};
 const map={rule:'rules',pattern:'patterns',hypothesis:'hypotheses',action:'actions',goal:'goals',trace:'traces',policy:'policies',theory:'theories'};
 for(const [i,x]of items.entries()){
  assert(x&&typeof x==='object','Typed SOP inputs required');
  if(x.kind==='retrieval'){const sub=partitions([],x,q);for(const key of ['facts','rules'])out[key].push(...sub[key]);out.complete&&=sub.complete;continue;}
  if(x.atom&&['fact','observed','assumed','derived'].includes(x.kind)){
   // Derived caches must be recomputed from current premises after an intervention.
   if(x.kind==='derived'){out.ignored.push({kind:x.kind,id:x.id,reason:'recomputed-from-premises'});continue;}
   if(q?.asof!==undefined&&(x.knownAt??0)>q.asof)continue;
   let valid=x.valid??timeless;if(q?.at!==undefined&&!contains(valid,q.at))continue;if(q?.during){valid=intersect(valid,q.during);if(!valid)continue;}
   out.facts.push({...x,id:x.id??'local_'+i+'_'+digest(atomKey(x.atom)).slice(0,10),valid,kind:x.kind==='fact'?'observed':x.kind});
  }else if(map[x.kind])out[map[x.kind]].push(x);else throw Error('Unsupported typed knowledge object '+x.kind);
 }
 out.facts=[...new Map(out.facts.map(f=>[stable([atomKey(f.atom),f.valid]),f])).values()];
 out.rules=[...new Map(out.rules.filter(r=>q?.at===undefined||contains(r.valid??timeless,q.at)).map(r=>[r.id,r])).values()];
 return out;
}
export function conflicts(facts){const keys=new Set(facts.map(f=>atomKey(f.atom)));return facts.filter(f=>keys.has(atomKey(opposite(f.atom)))).map(f=>atomKey(f.atom));}
export function queryFor(where,base={}){return {kind:'query',mode:'select',where,select:[...new Set(where.flatMap(a=>a.a.filter(variable)))],filters:[],limit:10000,at:Date.now(),asof:Infinity,...base};}
export function unsupported(code,detail){return {kind:'reasoning',status:'unsupported',code,detail,complete:false,epistemic:'undecided',proof:[]};}
export function packet(kind,status,data={},budget=null){return {kind,status,complete:!budget?.exhausted,epistemic:'candidate',proof:[],assurance:'Result relative to the supplied finite model and the retained memory view; scores are not truth probabilities.',...data,...(budget?{search:budget.stats()}:{} )};}
