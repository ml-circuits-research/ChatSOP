import {spawnSync} from 'node:child_process';
import {compileSMT} from '../solvers.js';
import {z3 as z3Decide} from '../backends/constraints.js';
import {assert} from '../util.js';
import {packet,unsupported} from './common.js';
export function valueOf(x,env){if(Number.isSafeInteger(x))return x;if(typeof x==='string'){assert(Object.hasOwn(env,x),'Unbound numeric variable');return env[x];}const a=x.a.map(v=>valueOf(v,env));let n;switch(x.op){case 'add':n=a[0]+a[1];break;case 'sub':n=a[0]-a[1];break;case 'mul':n=a[0]*a[1];break;case 'eq':return a[0]===a[1];case 'ne':return a[0]!==a[1];case 'lt':return a[0]<a[1];case 'le':return a[0]<=a[1];case 'gt':return a[0]>a[1];case 'ge':return a[0]>=a[1];case 'and':return a.every(Boolean);case 'or':return a.some(Boolean);case 'not':return !a[0];default:throw Error('Unsupported numeric operator');}assert(Number.isSafeInteger(n),'Integer overflow');return n;}
export function optimizeFinite(p,{maxAssignments=100000,project=[],timeoutMs=3000}={}){
 compileSMT(p);const names=Object.keys(p.vars),started=performance.now();let total=1;
 for(const name of names){const {min,max}=p.vars[name];if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max))return unsupported('finite_domain_required','Reference optimizer requires explicit finite integer domains');total*=max-min+1;}
 let checked=0,best=null,models=[],cutoff=false;const env={};
 const walk=i=>{if(checked>=maxAssignments||performance.now()-started>timeoutMs){cutoff=true;return;}if(i<names.length){const n=names[i],v=p.vars[n];for(let x=v.min;x<=v.max;x++){env[n]=x;walk(i+1);if(cutoff)break;}return;}checked++;if(!p.constraints.every(x=>valueOf(x,env))||!valueOf(p.claim,env))return;const value=valueOf(p.objective,env),better=best===null||(p.direction==='max'?value>best:value<best);if(better){best=value;models=[{...env}];}else if(value===best)models.push({...env});};walk(0);
 const complete=!cutoff&&checked===total,outputProjection={};for(const spec of project){const values=[...new Set(models.map(m=>m[spec.name]))];outputProjection['?'+spec.name]=!complete?{status:'incomplete'}:best===null?{status:'no_answer'}:spec.mode==='rows'?{status:'bound',value:models}:spec.mode==='many'?{status:'bound',value:values}:values.length===1?{status:'bound',value:values[0]}:{status:'ambiguous',candidates:values.length};}
 return {kind:'constraint',task:'optimize',status:best===null?(complete?'inconsistent':'unknown'):(complete?'optimal':'feasible_bound'),complete,backend:'js',objective:best,direction:p.direction,witness:models[0]??null,outputProjection,checks:{assignments:checked,total,optimalModels:models.length},epistemic:'model-relative'};
}
export function optimizeZ3(p,{timeoutMs=3000,project=[]}={}){
 let objectiveVar='sopobjective';while(Object.hasOwn(p.vars,objectiveVar))objectiveVar+='x';
 const augmented={...p,vars:{...p.vars,[objectiveVar]:{sort:'Int'}},constraints:[...p.constraints,p.claim,{op:'eq',a:[objectiveVar,p.objective]}]}, {prefix}=compileSMT(augmented,{timeoutMs});
 const source=prefix+`\n(${p.direction==='max'?'maximize':'minimize'} ${objectiveVar})\n(check-sat)\n(get-value (${objectiveVar}))\n`;
 const r=spawnSync(process.env.Z3_BIN??'z3',['-in','-smt2'],{input:source,encoding:'utf8',timeout:timeoutMs+1000,maxBuffer:1048576});
 if(r.error)return unsupported('backend_unavailable',r.error.message);
 const status=r.stdout.split(/\s+/).find(x=>['sat','unsat','unknown'].includes(x));if(status==='unsat')return {kind:'constraint',task:'optimize',status:'inconsistent',backend:'z3',complete:true};
 const match=r.stdout.match(new RegExp('\\('+objectiveVar+'\\s+(-?\\d+|\\(-\\s+\\d+\\))\\)'));if(status!=='sat'||!match)return {kind:'constraint',task:'optimize',status:'unknown',backend:'z3',complete:false};
 const optimum=match[1].startsWith('(')?-Number(match[1].replace(/[^0-9]/g,'')):Number(match[1]);if(!Number.isSafeInteger(optimum))return unsupported('unrepresentable_objective','Objective is outside the portable integer representation');
 // Independently prove no strictly better feasible objective exists.
 const better={...augmented,task:'possible',claim:{op:p.direction==='max'?'gt':'lt',a:[objectiveVar,optimum]}};
 const check=z3Decide(better,{timeoutMs}),proven=check.status==='impossible';
 const projected=z3Decide({...augmented,task:'prove',constraints:[...augmented.constraints,{op:'eq',a:[objectiveVar,optimum]}],claim:{op:'eq',a:[objectiveVar,optimum]}},{timeoutMs,project});
 return {...projected,kind:'constraint',task:'optimize',status:proven?'optimal':'feasible_bound',objective:optimum,direction:p.direction,complete:proven&&projected.complete,backend:'z3',optimalityCheck:check.status};
}
